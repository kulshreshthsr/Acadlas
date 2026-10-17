// The Acadlas platform API as one Hono app. Built from its parts (a database and an auth
// instance) rather than importing them, so the server, local mode and the tests all run
// exactly this code against whichever database they hand it.
//
//   /api/auth/*          Better Auth: sign-up, sign-in, sessions, schools, invitations
//   /api/invitations/:id What an invitation link is for (no sign-in needed)
//   /api/school/*        Acadlas School — every route behind the tenant gate
import { Hono } from 'hono';
import type { Context, MiddlewareHandler } from 'hono';
import { bodyLimit } from 'hono/body-limit';
import { cors } from 'hono/cors';
import { secureHeaders } from 'hono/secure-headers';
import type { Auth } from './auth';
import type { Db } from './db';
import { addressBucket, resolveClientIp, withClientIp } from './lib/client-ip';
import { HttpError } from './lib/http';
import { RateLimiter } from './lib/rate-limit';
import { attendanceRoutes } from './school/routes/attendance';
import { coreRoutes } from './school/routes/core';
import { feeRoutes } from './school/routes/fees';
import { reportRoutes } from './school/routes/reports';
import { invitationInfoRoutes, staffRoutes } from './school/routes/staff';
import { structureRoutes } from './school/routes/structure';
import { studentRoutes } from './school/routes/students';
import { tenantGate } from './school/tenant';
import type { AppEnv } from './school/tenant';

type AppOptions = {
  db: Db;
  auth: Auth;
  /** Browser origins allowed to call the API with cookies. */
  origins: string[];
  /**
   * Shared with the Pages Function that forwards the browser's requests. When set, every
   * /api request must carry it, and the client address is taken from that proxy alone.
   * See src/lib/client-ip.ts.
   */
  proxySecret?: string;
};

// How much one caller may ask for. Generous on purpose: a whole school office often shares
// one internet connection, so the per-address limit has to cover every desk in it.
const LIMITS = {
  perAddress: { max: 3000, windowMs: 60_000 },
  perPerson: { max: 600, windowMs: 60_000 },
  /** Looking up an invitation needs no sign-in, so it gets a tight limit. */
  publicLookup: { max: 30, windowMs: 60_000 },
  /** Wrong passwords for one account from one address, before that pair is paused. */
  signInFailuresFromAddress: { max: 10, windowMs: 15 * 60_000 },
  /** Wrong passwords for one account from anywhere — stops a slow attack spread over many addresses. */
  signInFailuresForAccount: { max: 50, windowMs: 60 * 60_000 },
} as const;

const KB = 1024;

/** The longest an email address can be; anything longer is not one, and is never used as a key. */
const MAX_EMAIL = 254;

function tooMany(c: Context, retryAfter: number, message = 'Too many requests. Wait a moment and try again.') {
  return c.json({ error: { code: 'RATE_LIMITED', message } }, 429, { 'Retry-After': String(retryAfter) });
}

const unsafeMethods = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);

export function createApp({ db, auth, origins, proxySecret }: AppOptions) {
  const app = new Hono<AppEnv>();
  const limiter = new RateLimiter();
  const allowedOrigins = new Set(origins);

  // Cross-origin resource policy stays off: the browser app is on another origin and reads
  // these responses through CORS, which the policy would otherwise block.
  app.use('*', secureHeaders({ crossOriginResourcePolicy: false }));

  // First, so that even a refusal below carries the headers a browser needs to read it.
  app.use(
    '/api/*',
    cors({
      origin: origins,
      credentials: true,
      allowHeaders: ['Content-Type', 'Authorization'],
      allowMethods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
      exposeHeaders: ['Content-Disposition'],
      maxAge: 600,
    }),
  );

  // Who is calling, decided once. Refuses anything that did not come through our proxy when
  // a proxy secret is configured, and replaces the request with one that carries only the
  // address we trust (see src/lib/client-ip.ts).
  app.use('/api/*', async (c, next) => {
    const socketIp = (c.env as { incoming?: { socket?: { remoteAddress?: string } } } | undefined)?.incoming?.socket?.remoteAddress;
    const result = resolveClientIp(c.req.raw.headers, proxySecret, socketIp);
    if (!result.ok) return c.json({ error: { code: 'FORBIDDEN', message: 'Requests must come through the Acadlas app.' } }, 403);
    c.set('clientIp', result.ip);
    c.req.raw = withClientIp(c.req.raw, result.ip);

    const key = `addr:${addressBucket(result.ip)}`;
    const { ok, retryAfter } = limiter.hit(key, LIMITS.perAddress.max, LIMITS.perAddress.windowMs);
    if (!ok) return tooMany(c, retryAfter);
    await next();
  });

  // Nothing the app sends is large. A student import (up to 2,000 rows) is the one exception.
  const smallBody = bodyLimit({ maxSize: 256 * KB, onError: (c) => c.json({ error: { code: 'TOO_LARGE', message: 'That request is too large.' } }, 413) });
  const importBody = bodyLimit({ maxSize: 4 * KB * KB, onError: (c) => c.json({ error: { code: 'TOO_LARGE', message: 'That file is too large. Split it into smaller sheets.' } }, 413) });
  app.use('/api/*', (c, next) => (c.req.path === '/api/school/students/import' ? importBody(c, next) : smallBody(c, next)));

  app.use('*', async (c, next) => {
    c.set('db', db);
    c.set('auth', auth);
    await next();
  });

  // Better Auth limits sign-in attempts per address. On top of that, wrong passwords are
  // counted per account, so guessing one person's password is just as slow from a thousand
  // addresses as from one. The same message is returned whether or not the account exists.
  app.post('/api/auth/sign-in/email', async (c) => {
    const email = await c.req.raw
      .clone()
      .json()
      .then((b: unknown) => {
        const value = (b as { email?: unknown } | null)?.email;
        const email = typeof value === 'string' ? value.trim().toLowerCase() : '';
        return email.length <= MAX_EMAIL ? email : '';
      })
      .catch(() => '');
    const pairKey = `signin:${addressBucket(c.get('clientIp'))}:${email}`;
    const accountKey = `signin:${email}`;
    const paused = [
      limiter.blocked(pairKey, LIMITS.signInFailuresFromAddress.max),
      limiter.blocked(accountKey, LIMITS.signInFailuresForAccount.max),
    ].find((b) => b.blocked);
    if (email && paused) {
      return tooMany(c, paused.retryAfter, 'Too many wrong passwords for this account. Wait a while, or reset the password.');
    }

    const res = await auth.handler(c.req.raw);
    if (email && res.status === 401) {
      limiter.record(pairKey, LIMITS.signInFailuresFromAddress.windowMs);
      limiter.record(accountKey, LIMITS.signInFailuresForAccount.windowMs);
    } else if (email && res.ok) {
      limiter.clear(pairKey);
    }
    return res;
  });

  // Every Better Auth endpoint lives under this one path.
  app.on(['GET', 'POST'], '/api/auth/*', (c) => auth.handler(c.req.raw));

  app.use('/api/invitations/*', async (c, next) => {
    const { ok, retryAfter } = limiter.hit(`lookup:${addressBucket(c.get('clientIp'))}`, LIMITS.publicLookup.max, LIMITS.publicLookup.windowMs);
    if (!ok) return tooMany(c, retryAfter);
    await next();
  });
  app.route('/api', invitationInfoRoutes);

  // A change must come from a page of ours. The session cookie is SameSite=Lax and CORS
  // already blocks other sites from reading answers; this refuses the write itself.
  const sameOriginWrites: MiddlewareHandler<AppEnv> = async (c, next) => {
    if (unsafeMethods.has(c.req.method)) {
      const origin = c.req.header('origin');
      if (!origin || !allowedOrigins.has(origin)) {
        return c.json({ error: { code: 'FORBIDDEN', message: 'That request did not come from the Acadlas app.' } }, 403);
      }
    }
    await next();
  };

  const perPerson: MiddlewareHandler<AppEnv> = async (c, next) => {
    const { ok, retryAfter } = limiter.hit(`person:${c.get('tenant').userId}`, LIMITS.perPerson.max, LIMITS.perPerson.windowMs);
    if (!ok) return tooMany(c, retryAfter);
    await next();
  };

  const school = new Hono<AppEnv>();
  school.use('*', sameOriginWrites);
  school.use('*', tenantGate());
  school.use('*', perPerson);
  school.route('/', coreRoutes);
  school.route('/', structureRoutes);
  school.route('/', studentRoutes);
  school.route('/', attendanceRoutes);
  school.route('/', feeRoutes);
  school.route('/', staffRoutes);
  school.route('/', reportRoutes);
  app.route('/api/school', school);

  app.get('/health', (c) => c.json({ ok: true }));

  app.notFound((c) => c.json({ error: { code: 'NOT_FOUND', message: 'There is nothing at this address.' } }, 404));

  app.onError((error, c) => {
    if (error instanceof HttpError) {
      return c.json({ error: { code: error.code, message: error.message, fields: error.fields } }, error.status as 400);
    }
    // Postgres unique-constraint breaches that slipped past a friendlier check.
    const pgCode = (error as { code?: string }).code ?? (error as { cause?: { code?: string } }).cause?.code;
    if (pgCode === '23505') {
      return c.json({ error: { code: 'DUPLICATE', message: 'That would create a duplicate. Refresh and try again.' } }, 409);
    }
    console.error(error);
    return c.json({ error: { code: 'SERVER_ERROR', message: 'Something went wrong on the server. Try again in a moment.' } }, 500);
  });

  return app;
}

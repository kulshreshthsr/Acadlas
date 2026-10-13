// The Acadlas platform API as one Hono app. Built from its parts (a database and an auth
// instance) rather than importing them, so the server, local mode and the tests all run
// exactly this code against whichever database they hand it.
//
//   /api/auth/*          Better Auth: sign-up, sign-in, sessions, schools, invitations
//   /api/invitations/:id What an invitation link is for (no sign-in needed)
//   /api/school/*        Acadlas School — every route behind the tenant gate
import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { secureHeaders } from 'hono/secure-headers';
import type { Auth } from './auth';
import type { Db } from './db';
import { HttpError } from './lib/http';
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
};

export function createApp({ db, auth, origins }: AppOptions) {
  const app = new Hono<AppEnv>();

  // Cross-origin resource policy stays off: the browser app is on another origin and reads
  // these responses through CORS, which the policy would otherwise block.
  app.use('*', secureHeaders({ crossOriginResourcePolicy: false }));

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

  app.use('*', async (c, next) => {
    c.set('db', db);
    c.set('auth', auth);
    await next();
  });

  // Every Better Auth endpoint lives under this one path.
  app.on(['GET', 'POST'], '/api/auth/*', (c) => auth.handler(c.req.raw));

  app.route('/api', invitationInfoRoutes);

  const school = new Hono<AppEnv>();
  school.use('*', tenantGate());
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

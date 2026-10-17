// The Acadlas platform API, running under Node — for development, and for any Node host.
//
// Reads .env.local, opens the database (Neon, or a local PGlite folder — see src/db/index.ts),
// builds auth and the app around it, and serves on PORT (8787 by default).
import './env';

import { serve } from '@hono/node-server';
import { createApp } from './app';
import { createAuth } from './auth';
import { getDatabaseUrl, isLocalDatabase, openDatabase } from './db';

// The browser app runs on an origin of its own — a different port in development, a
// different subdomain in production. Better Auth and CORS read the same list, so the two
// can never drift apart and leave the app rejected by one but allowed by the other.
const origins = (process.env.CORS_ORIGINS ?? 'http://localhost:5173').split(',').map((o) => o.trim());

const url = getDatabaseUrl();
const db = await openDatabase(url);
const auth = createAuth({
  db,
  secret: process.env.BETTER_AUTH_SECRET,
  baseURL: process.env.BETTER_AUTH_URL,
  trustedOrigins: origins,
});
// In production the API only answers requests forwarded by the app's own proxy, which is
// also the only trustworthy source of a caller's address (see src/lib/client-ip.ts).
// Refusing to start without it beats running with rate limits anyone can sidestep.
const proxySecret = process.env.PROXY_SHARED_SECRET || undefined;
if (process.env.NODE_ENV === 'production' && (!proxySecret || proxySecret.length < 32)) {
  console.error('PROXY_SHARED_SECRET must be set to a random string of at least 32 characters in production.');
  process.exit(1);
}

const app = createApp({ db, auth, origins, proxySecret });

const port = Number(process.env.PORT ?? 8787);

serve({ fetch: app.fetch, port }, (info) => {
  console.log(`Acadlas platform API running at http://localhost:${info.port}`);
  console.log(`Database: ${isLocalDatabase(url) ? `local (${url})` : 'Neon'}`);
});

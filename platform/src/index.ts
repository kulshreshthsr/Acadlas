// The Acadlas platform API. Right now this is just shared auth (sign up, log in, organizations),
// but every future product (Acadlas School today, others later) mounts its own routes here too —
// this stays one deployable backend until there's a real reason to split it up.
//
// Runs under plain Node for local development (this file, via `npm run dev`) and will run
// unchanged on Cloudflare Workers once deployed — `auth` and the route handlers don't know or
// care which runtime they're on, which is the point of building on Hono + the Neon HTTP driver.
import './env';

import { serve } from '@hono/node-server';
import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { auth } from './auth';

const app = new Hono();

// Local dev only: lets the React app (running on its own port) call this API and send/receive
// the session cookie. In production, the frontend and this API should share a parent domain
// (e.g. `school.acadlas.com` calling `api.acadlas.com`), configured here before deploying.
const allowedOrigins = (process.env.CORS_ORIGINS ?? 'http://localhost:5173').split(',');

app.use(
  '/api/auth/*',
  cors({
    origin: allowedOrigins,
    credentials: true,
    allowHeaders: ['Content-Type', 'Authorization'],
    allowMethods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  }),
);

// Every Better Auth endpoint (sign-up, sign-in, sessions, organizations, invitations, ...)
// lives under this one path. See https://www.better-auth.com/docs/concepts/api for the full list.
app.on(['GET', 'POST'], '/api/auth/*', (c) => auth.handler(c.req.raw));

app.get('/health', (c) => c.json({ ok: true }));

const port = Number(process.env.PORT ?? 8787);

serve({ fetch: app.fetch, port }, (info) => {
  console.log(`Acadlas platform API running at http://localhost:${info.port}`);
  console.log(`Auth endpoints at          http://localhost:${info.port}/api/auth/*`);
});

// The database connection. Uses Neon's HTTP driver (not a persistent TCP connection) because
// this backend runs on Cloudflare Workers, which can't hold a normal Postgres socket open.
// The same driver works identically when running locally under Node (src/index.ts's dev server).
import { neon } from '@neondatabase/serverless';
import { drizzle } from 'drizzle-orm/neon-http';
import * as schema from './auth-schema';

function getDatabaseUrl(): string {
  const url = process.env.DATABASE_URL;
  if (!url) {
    throw new Error('DATABASE_URL is not set. Check .env.local — see .env.local.example.');
  }
  return url;
}

const sql = neon(getDatabaseUrl());

export const db = drizzle(sql, { schema });
export { schema };

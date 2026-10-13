// Tells drizzle-kit where the schema lives and how to reach the database. Used only by
// `npm run db:push` / `npm run db:studio` — the running app talks to Neon directly (src/db).
import { config } from 'dotenv';
config({ path: '.env.local' });

import { defineConfig } from 'drizzle-kit';

if (!process.env.DATABASE_URL) {
  throw new Error('DATABASE_URL is not set. Check .env.local.');
}

if (process.env.DATABASE_URL.startsWith('pglite:')) {
  throw new Error('db:push is for Neon. A local pglite: database creates its own tables when the server starts.');
}

export default defineConfig({
  schema: ['./src/db/auth-schema.ts', './src/db/school-schema.ts'],
  out: './src/db/migrations',
  dialect: 'postgresql',
  dbCredentials: {
    url: process.env.DATABASE_URL,
  },
});

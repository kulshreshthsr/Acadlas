// The database connection.
//
// Neon, over WebSockets. The earlier HTTP driver could only send one statement at a time,
// and Acadlas School needs real transactions: recording a fee payment takes a receipt
// number, writes the payment, allocates it to charges and writes the audit trail, and all
// of that must succeed or fail together. Neon's WebSocket driver gives full Postgres
// transactions and still runs on Cloudflare Workers.
//
// Local mode: set DATABASE_URL=pglite://.data/acadlas and the whole Postgres database runs
// inside the Node process (PGlite), stored in that folder — no Neon account, no network.
// Useful offline, and it is what the test suite runs on.
import { Pool } from '@neondatabase/serverless';
import { drizzle as drizzleNeon } from 'drizzle-orm/neon-serverless';
import type { PgDatabase, PgQueryResultHKT } from 'drizzle-orm/pg-core';
import * as authSchema from './auth-schema';
import * as schoolSchema from './school-schema';

export const schema = { ...authSchema, ...schoolSchema };

export type Schema = typeof schema;
export type Db = PgDatabase<PgQueryResultHKT, Schema>;
/** A transaction handle. Anything that accepts `DbOrTx` works inside or outside one. */
export type Tx = Parameters<Parameters<Db['transaction']>[0]>[0];
export type DbOrTx = Db | Tx;

export function isLocalDatabase(url: string): boolean {
  return url.startsWith('pglite:');
}

/** Opens the database named by `url`. Local (PGlite) databases get their tables created on first open. */
export async function openDatabase(url: string): Promise<Db> {
  if (isLocalDatabase(url)) {
    return openLocalDatabase(url.replace(/^pglite:(\/\/)?/, '') || undefined);
  }

  if (typeof WebSocket === 'undefined') {
    throw new Error('This Node version has no built-in WebSocket. Use Node 22 or newer.');
  }

  const pool = new Pool({ connectionString: url });
  return drizzleNeon(pool, { schema }) as unknown as Db;
}

/**
 * An in-process Postgres. `dataDir` keeps it on disk; leave it out for a throwaway
 * in-memory database (the tests do). The tables are brought up to date with the schema
 * every time it opens: the database remembers the schema it was last built from, and only
 * the difference is applied — the same SQL `drizzle-kit generate` would write.
 */
export async function openLocalDatabase(dataDir?: string): Promise<Db> {
  const { PGlite } = await import('@electric-sql/pglite');
  const { drizzle } = await import('drizzle-orm/pglite');
  const { generateDrizzleJson, generateMigration } = await import('drizzle-kit/api');

  if (dataDir) {
    // PGlite creates only the last folder of the path itself.
    const { mkdirSync } = await import('node:fs');
    mkdirSync(dataDir, { recursive: true });
  }
  const client = new PGlite(dataDir);

  await client.exec('create table if not exists _acadlas_schema (id int primary key, snapshot jsonb not null)');
  const stored = await client.query<{ snapshot: Parameters<typeof generateMigration>[0] }>('select snapshot from _acadlas_schema where id = 1');
  const previous = stored.rows[0]?.snapshot ?? generateDrizzleJson({});
  const current = generateDrizzleJson(schema);
  const statements = await generateMigration(previous, current);
  if (statements.length > 0) {
    await client.transaction(async (tx) => {
      for (const statement of statements) await tx.exec(statement);
      await tx.query('insert into _acadlas_schema (id, snapshot) values (1, $1) on conflict (id) do update set snapshot = excluded.snapshot', [JSON.stringify(current)]);
    });
  }

  return drizzle(client, { schema }) as unknown as Db;
}

export function getDatabaseUrl(): string {
  const url = process.env.DATABASE_URL;
  if (!url) {
    throw new Error('DATABASE_URL is not set. Check .env.local — see .env.local.example.');
  }
  return url;
}

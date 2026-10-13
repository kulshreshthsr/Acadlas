// Only for `npm run auth:generate`: the Better Auth CLI needs a module that exports a
// ready-made `auth`. The running server builds its own in src/index.ts. The database
// handle here is never queried — the CLI only reads the configuration to write the schema.
import './env';

import { neon } from '@neondatabase/serverless';
import { drizzle } from 'drizzle-orm/neon-http';
import { createAuth } from './auth';
import { schema } from './db';
import type { Db } from './db';

const db = drizzle(neon(process.env.DATABASE_URL ?? 'postgres://cli:cli@localhost/cli'), { schema }) as unknown as Db;

export const auth = createAuth({ db, trustedOrigins: [] });

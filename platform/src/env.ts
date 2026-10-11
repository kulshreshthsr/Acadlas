// Loads .env.local before anything else. Must be the very first import in any entry point
// (src/index.ts, and src/auth.ts for when the Better Auth CLI loads it standalone) — as a
// plain `import './env'` with no named imports, not a function call mixed in with other
// imports. ES modules evaluate sibling imports in the order they're declared, so an `import`
// line runs before a later-declared one's dependencies do; but a function call sitting in a
// file's own body runs after ALL of that file's imports (including transitive ones) have
// already been evaluated — which is why `db/index.ts` kept seeing an empty DATABASE_URL when
// loading dotenv that way.
import { config } from 'dotenv';

config({ path: '.env.local' });

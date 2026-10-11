# Acadlas platform

The shared backend every Acadlas product sits on. Right now that's just authentication and
multi-tenancy (organizations = schools); product-specific routes (Acadlas School's students,
classes, attendance, fees) get added here later, as their own route modules.

Hono + TypeScript, deployed to Cloudflare Workers, Postgres on Neon via Drizzle ORM, auth via
Better Auth's organization plugin. Runs locally under plain Node for development; the same code
runs unchanged on Workers once deployed.

## Setup

```sh
npm install
cp .env.local.example .env.local   # then fill in DATABASE_URL and BETTER_AUTH_SECRET
npm run db:push                    # creates the auth tables in your Neon database
npm run dev                        # starts the API at http://localhost:8787
```

`BETTER_AUTH_SECRET` — any long random string. Generate one with:

```sh
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
```

## What's here

```text
src/
├── env.ts            Loads .env.local. Must stay the first import in any entry point — see
│                      its own comment for why (an ES module ordering gotcha).
├── auth.ts            Better Auth configuration: email+password sign-in, organizations
│                      (schools), invitations. This is the one file that defines the shared
│                      auth/tenancy model for every Acadlas product.
├── index.ts            The running server: mounts auth's routes under /api/auth/*, CORS for
│                       the frontend, a /health check. Future product routes get added here.
└── db/
    ├── index.ts         The Neon database connection (HTTP driver, Workers-compatible).
    └── auth-schema.ts   Generated — do not hand-edit. Regenerate with `npm run auth:generate`
                          after changing anything in auth.ts that affects the data model
                          (enabling a new plugin, adding a field), then `npm run db:push`.
```

## Multi-tenancy, in one paragraph

A school is an `organization`. A user's session carries an "active organization" — that's the
tenant for every request they make. A user can belong to more than one organization (a parent
with kids at two schools; a consulting teacher). Every future product route must read the active
organization off the session and scope its database queries to it — that scoping is what keeps
one school's data from ever being visible to another, and it's enforced server-side, not just
hidden in the UI.

## Commands

| Command                | Action                                                              |
| :---------------------- | :------------------------------------------------------------------- |
| `npm run dev`            | Local dev server at `localhost:8787`, auto-restarts on file changes |
| `npm run db:push`        | Push the current schema to your Neon database                       |
| `npm run db:studio`      | Open Drizzle Studio to browse the database in a browser              |
| `npm run auth:generate`  | Regenerate `src/db/auth-schema.ts` from `src/auth.ts`                |
| `npm run typecheck`      | Type-check without emitting files                                   |

## Trying it by hand

With `npm run dev` running:

```sh
# Create an account
curl -X POST http://localhost:8787/api/auth/sign-up/email \
  -H "Content-Type: application/json" \
  -d '{"email":"owner@example.com","password":"password123","name":"School Owner"}'

# Create a school (an organization) — needs the session cookie from sign-up above;
# easier to try this pair of calls from the browser console once a frontend is wired up.
curl -X POST http://localhost:8787/api/auth/organization/create \
  -H "Content-Type: application/json" \
  -b cookies.txt \
  -d '{"name":"Greenfield Public School","slug":"greenfield"}'
```

## Not done yet, on purpose

- **Real emails.** Sign-up verification and organization invitations currently just log a link
  to the console instead of sending an email (see the two `TODO(resend)` comments in `auth.ts`).
  Wire in Resend when you have an API key.
- **Product-level roles.** Better Auth gives you org-level roles (owner/admin/member — who can
  manage the school's account). What a teacher vs. office staff can do *inside* Acadlas School
  is a second layer, designed once that product's screens exist.
- **Deploying to Cloudflare Workers.** This runs under Node locally for fast iteration. Workers
  deployment (wrangler.toml, `wrangler deploy`) gets added once the API is worth deploying.

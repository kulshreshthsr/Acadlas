// Shared authentication for every Acadlas product. One sign-in, one set of organizations
// (schools), used by Acadlas School today and by any future product later.
//
// Multi-tenancy lives here: the "organization" plugin gives every signed-in user a list of
// organizations they belong to, and an "active organization" on their session. A school in
// Acadlas is an organization. A user can belong to more than one (a parent with two kids at
// two different schools; a teacher who consults for two schools), and switches between them
// without logging out. Every product route checks the active organization on the session
// before touching any data — that check is what keeps one school from ever seeing another's.

// Must stay the first import — see src/env.ts for why. Needed here so DATABASE_URL and
// BETTER_AUTH_SECRET exist whether this file is loaded by the running server (src/index.ts)
// or standalone by the Better Auth CLI (`npm run auth:generate`, which only loads this file).
import './env';

import { betterAuth } from 'better-auth';
import { drizzleAdapter } from 'better-auth/adapters/drizzle';
import { organization } from 'better-auth/plugins';
import { db, schema } from './db';

export const auth = betterAuth({
  database: drizzleAdapter(db, {
    provider: 'pg',
    schema,
  }),

  // Email + password only for now. Google/Microsoft sign-in can be added later without
  // touching anything else, since Better Auth treats them as additional ways to reach the
  // same user record.
  emailAndPassword: {
    enabled: true,
    // Turn this on once Resend is wired in (sendResetPassword below) — until then a user who
    // forgets their password has no self-serve way to recover it.
    requireEmailVerification: false,
  },

  // TODO(resend): once RESEND_API_KEY is set, send real emails here instead of logging.
  // See src/email.ts once it exists — these two hooks are the only things that change.
  emailVerification: {
    sendVerificationEmail: async ({ user, url }) => {
      console.log(`[dev] verification email for ${user.email}: ${url}`);
    },
  },

  plugins: [
    organization({
      // Keep it simple for the first product: owner / admin / member. "Owner" is whoever
      // created the school's account; "admin" is office staff who can manage the school;
      // "member" is anyone else invited in (a teacher, for instance) until Acadlas School
      // adds its own, more specific roles on top of this.
      creatorRole: 'owner',

      // A school's invitation flow needs real email before it's usable by an actual school.
      // For now this just logs the link so you can test the flow by hand.
      async sendInvitationEmail(data) {
        console.log(`[dev] invitation for ${data.email} to join "${data.organization.name}":`, data.id);
      },
    }),
  ],

  secret: process.env.BETTER_AUTH_SECRET,
  baseURL: process.env.BETTER_AUTH_URL,
});

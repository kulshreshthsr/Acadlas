// Shared authentication for every Acadlas product. One sign-in, one set of organizations
// (schools), used by Acadlas School today and by any future product later.
//
// Multi-tenancy lives here: the "organization" plugin gives every signed-in user a list of
// organizations they belong to, and an "active organization" on their session. A school in
// Acadlas is an organization. A user can belong to more than one (a parent with two kids at
// two different schools; a teacher who consults for two schools), and switches between them
// without logging out. Every product route checks the active organization on the session
// before touching any data — see src/school/tenant.ts, which is where that check lives.
//
// This file builds the auth instance from a database handle instead of opening one itself,
// so the server, the local mode and the tests can each hand it the database they use.
import { betterAuth } from 'better-auth';
import { drizzleAdapter } from 'better-auth/adapters/drizzle';
import { organization } from 'better-auth/plugins';
import { and, eq, isNull } from 'drizzle-orm';
import { schema } from './db';
import type { Db } from './db';
import { schoolProfile, staff } from './db/school-schema';
import { CLIENT_IP_HEADER } from './lib/client-ip';
import { appUrl, sendMail } from './lib/mailer';
import { ac, authRoles, roleLabels } from './school/roles';
import type { SchoolRole } from './school/roles';

type AuthOptions = {
  db: Db;
  secret?: string;
  baseURL?: string;
  trustedOrigins: string[];
};

export function createAuth({ db, secret, baseURL, trustedOrigins }: AuthOptions) {
  return betterAuth({
    database: drizzleAdapter(db, {
      provider: 'pg',
      schema,
      // Creating a school writes the organization and its owner's membership; with
      // transactions on, both land or neither does.
      transaction: true,
    }),

    // Email + password. Google sign-in or phone OTP can be added later without touching
    // anything else, since Better Auth treats them as more ways to reach the same user.
    emailAndPassword: {
      enabled: true,
      // Turn on once Resend is configured — until then nobody could receive the link.
      requireEmailVerification: false,
      async sendResetPassword({ user, url }) {
        await sendMail({
          to: user.email,
          subject: 'Reset your Acadlas password',
          text: `Hello ${user.name},\n\nSomeone asked to reset the password for this Acadlas account. If it was you, open this link within an hour to choose a new one:\n\n${url}\n\nIf it was not you, ignore this email and your password stays as it is.`,
        });
      },
    },

    emailVerification: {
      async sendVerificationEmail({ user, url }) {
        await sendMail({
          to: user.email,
          subject: 'Confirm your email for Acadlas',
          text: `Hello ${user.name},\n\nConfirm this email address for your Acadlas account:\n\n${url}`,
        });
      },
    },

    session: {
      // The session is re-read from a signed cookie for five minutes instead of hitting the
      // database on every request. Membership is still checked per request (tenant.ts).
      cookieCache: { enabled: true, maxAge: 5 * 60 },
    },

    // On always, not only when NODE_ENV says production: a host that forgets to set it must
    // not quietly lose the limit on password guessing. Keyed on the one address app.ts
    // decided on (src/lib/client-ip.ts); app.ts also counts wrong passwords per account.
    rateLimit: {
      enabled: true,
      window: 60,
      max: 300,
      customRules: {
        // Better Auth's default is 3 sign-ins per 10 s per address — a whole school's staff
        // arriving at 8 am on one connection would trip that. Guessing one account's password
        // is limited per account in app.ts, so the per-address limit can be roomier.
        '/sign-in/email': { window: 60, max: 20 },
        // Better Auth's own default (3 a minute) for password reset still applies.
        // A staff training day can see a whole school's teachers sign up from one connection.
        '/sign-up/email': { window: 60 * 60, max: 50 },
        '/organization/create': { window: 60 * 60, max: 5 },
        '/organization/invite-member': { window: 60 * 60, max: 100 },
      },
    },

    advanced: {
      ipAddress: { ipAddressHeaders: [CLIENT_IP_HEADER] },
    },

    plugins: [
      organization({
        creatorRole: 'owner',
        // Enough for a group of schools under one person; stops one account minting hundreds.
        organizationLimit: 20,
        ac,
        roles: authRoles,
        // School staff do not check email hourly; a week is a kinder window than 48 hours.
        invitationExpiresIn: 60 * 60 * 24 * 7,

        async sendInvitationEmail(data) {
          const role = roleLabels[data.role as SchoolRole] ?? data.role;
          await sendMail({
            to: data.email,
            subject: `Join ${data.organization.name} on Acadlas`,
            text: `${data.inviter.user.name} has invited you to ${data.organization.name} on Acadlas as ${role}.\n\nOpen this link to accept:\n\n${appUrl()}/invite/${data.id}\n\nThe link works for seven days.`,
          });
        },

        organizationHooks: {
          // Every school starts with a profile row and its owner on the staff list, so no
          // screen ever has to handle a school with neither.
          async afterCreateOrganization({ organization: school, user }) {
            await db.insert(schoolProfile).values({ schoolId: school.id }).onConflictDoNothing();
            await db
              .insert(staff)
              .values({
                schoolId: school.id,
                userId: user.id,
                name: user.name,
                email: user.email.toLowerCase(),
                designation: 'Principal',
              })
              .onConflictDoNothing();
          },

          // Accepting an invitation links the login to the staff record that was created
          // for that email when the invitation was sent.
          async afterAcceptInvitation({ organization: school, user }) {
            const email = user.email.toLowerCase();
            const linked = await db
              .update(staff)
              .set({ userId: user.id, invitationId: null })
              .where(and(eq(staff.schoolId, school.id), eq(staff.email, email), isNull(staff.userId)))
              .returning({ id: staff.id });

            if (linked.length === 0) {
              await db
                .insert(staff)
                .values({ schoolId: school.id, userId: user.id, name: user.name, email })
                .onConflictDoNothing();
            }
          },
        },
      }),
    ],

    trustedOrigins,
    secret,
    baseURL,
  });
}

export type Auth = ReturnType<typeof createAuth>;

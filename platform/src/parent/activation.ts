// Turning a school's invitation link into a parent login. No session needed — the link's
// secret, plus the child's date of birth, is the proof.
//
//   POST /api/parent-invite/lookup    { secret }                 what this link is for
//   POST /api/parent-invite/activate  { secret, dateOfBirth, … }  use it, and sign in
//
// A link is one of three kinds, decided here rather than by the school:
//   new       — nobody has this number yet: the parent chooses a password.
//   existing  — this number already signs in (a child at another Acadlas school): the parent
//               gives that password, and this child is added. Nothing about the existing
//               account changes, and nobody can take it over with a link.
//   reset     — this parent is already in and forgot their password: they choose a new one,
//               and every device they were signed in on is signed out.
//
// Every way a link can be unusable — wrong, used, expired, revoked, out of tries — gets the
// same answer, so the answers say nothing about which links exist.
import { and, eq, gt, inArray, lt, sql } from 'drizzle-orm';
import { Hono } from 'hono';
import { z } from 'zod';
import type { Db } from '../db';
import { organization, user } from '../db/auth-schema';
import { auditEvent, guardian, parentAccess, student, studentGuardian } from '../db/school-schema';
import { HttpError, conflict, invalid, isoDate, readBody } from '../lib/http';
import type { AppEnv } from '../school/tenant';
import { MAX_LINK_ATTEMPTS, hashLinkSecret, looksLikeLinkSecret, maskPhone, placeholderEmail, portalSettings } from './access';

export const activationRoutes = new Hono<AppEnv>();

const linkGone = () =>
  new HttpError(404, 'LINK_INVALID', 'This link has expired or has already been used. Ask the school to send you a new one.');

/** A link that may still be used, or a 404 that looks the same whatever the reason. */
async function liveLink(db: Db, secret: unknown) {
  if (!looksLikeLinkSecret(secret)) throw linkGone();
  const [row] = await db
    .select({ access: parentAccess, guardianName: guardian.name, schoolName: organization.name })
    .from(parentAccess)
    .innerJoin(guardian, eq(guardian.id, parentAccess.guardianId))
    .innerJoin(organization, eq(organization.id, parentAccess.schoolId))
    .where(
      and(
        eq(parentAccess.tokenHash, hashLinkSecret(secret)),
        inArray(parentAccess.status, ['invited', 'active']),
        gt(parentAccess.tokenExpiresAt, new Date()),
        lt(parentAccess.tokenAttempts, MAX_LINK_ATTEMPTS),
      ),
    )
    .limit(1);
  if (!row) throw linkGone();
  const settings = await portalSettings(db, row.access.schoolId);
  if (!settings.enabled) throw new HttpError(409, 'PORTAL_OFF', `${row.schoolName} has paused the parent app. Ask the school about it.`);
  return row;
}

async function linkKind(db: Db, access: typeof parentAccess.$inferSelect) {
  const [owner] = await db.select({ id: user.id }).from(user).where(eq(user.phoneNumber, access.phone)).limit(1);
  if (owner && access.status === 'active' && access.userId === owner.id) return { kind: 'reset' as const, userId: owner.id };
  if (owner) return { kind: 'existing' as const, userId: owner.id };
  return { kind: 'new' as const, userId: null };
}

activationRoutes.post('/parent-invite/lookup', async (c) => {
  const db = c.get('db');
  const body = await readBody(c, z.object({ secret: z.string().max(100) }));
  const row = await liveLink(db, body.secret);
  const { kind } = await linkKind(db, row.access);
  return c.json({
    // Nothing that names the family: a link can leak before its holder proves anything.
    schoolName: row.schoolName,
    phone: maskPhone(row.access.phone),
    kind,
    expiresAt: row.access.tokenExpiresAt,
    attemptsLeft: MAX_LINK_ATTEMPTS - row.access.tokenAttempts,
  });
});

const password = z.string().min(8, 'Use at least 8 characters.').max(128, 'Use at most 128 characters.');

/** Counts a wrong answer against the link; at the limit the link is dead for good. */
async function countWrongAnswer(db: Db, accessId: string, tokenHash: string): Promise<number> {
  const [row] = await db
    .update(parentAccess)
    .set({ tokenAttempts: sql`${parentAccess.tokenAttempts} + 1` })
    .where(and(eq(parentAccess.id, accessId), eq(parentAccess.tokenHash, tokenHash)))
    .returning({ attempts: parentAccess.tokenAttempts });
  const attempts = row?.attempts ?? MAX_LINK_ATTEMPTS;
  if (attempts >= MAX_LINK_ATTEMPTS) {
    await db.update(parentAccess).set({ tokenHash: null, tokenExpiresAt: null }).where(eq(parentAccess.id, accessId));
  }
  return Math.max(0, MAX_LINK_ATTEMPTS - attempts);
}

activationRoutes.post('/parent-invite/activate', async (c) => {
  const db = c.get('db');
  const auth = c.get('auth');
  const body = await readBody(
    c,
    z.object({
      secret: z.string().max(100),
      dateOfBirth: isoDate,
      /** The new password ('new' and 'reset' links). */
      password: password.optional(),
      /** The password the number already signs in with ('existing' links). */
      currentPassword: z.string().max(128).optional(),
    }),
  );
  const row = await liveLink(db, body.secret);
  const access = row.access;
  const tokenHash = access.tokenHash!;

  // The proof: a child of this guardian, studying here now, born on that day.
  const [match] = await db
    .select({ id: student.id })
    .from(studentGuardian)
    .innerJoin(student, eq(student.id, studentGuardian.studentId))
    .where(
      and(
        eq(studentGuardian.schoolId, access.schoolId),
        eq(studentGuardian.guardianId, access.guardianId),
        eq(student.status, 'active'),
        eq(student.dateOfBirth, body.dateOfBirth),
      ),
    )
    .limit(1);
  if (!match) {
    const left = await countWrongAnswer(db, access.id, tokenHash);
    if (left === 0) throw linkGone();
    throw new HttpError(400, 'WRONG_DATE_OF_BIRTH', `That date of birth does not match. ${left} ${left === 1 ? 'try' : 'tries'} left.`, {
      dateOfBirth: 'That date of birth does not match.',
    });
  }

  const ctx = await auth.$context;
  const { kind, userId: ownerId } = await linkKind(db, access);
  let userId: string;
  let signInPassword: string;
  let createdUserId: string | null = null;
  let newHash: string | null = null;

  if (kind === 'existing') {
    // Their number already signs in elsewhere. Only its password links this child to it.
    if (!body.currentPassword) throw invalid('Enter the password you already use with this number.', { currentPassword: 'Required.' });
    const account = (await ctx.internalAdapter.findAccounts(ownerId!)).find((a) => a.providerId === 'credential');
    const ok = account?.password ? await ctx.password.verify({ hash: account.password, password: body.currentPassword }) : false;
    if (!ok) {
      const left = await countWrongAnswer(db, access.id, tokenHash);
      if (left === 0) throw linkGone();
      throw new HttpError(400, 'WRONG_PASSWORD', `That is not the password for this number. ${left} ${left === 1 ? 'try' : 'tries'} left.`, {
        currentPassword: 'That password is not right.',
      });
    }
    userId = ownerId!;
    signInPassword = body.currentPassword;
  } else {
    if (!body.password) throw invalid('Choose a password.', { password: 'Required.' });
    if (body.password.includes(access.phone.slice(-10))) {
      throw invalid('Your password must not contain your phone number.', { password: 'Must not contain your phone number.' });
    }
    const hash = await ctx.password.hash(body.password);
    if (kind === 'reset') {
      // Applied only once the link is spent, below.
      userId = ownerId!;
      newHash = hash;
    } else {
      // Made here, outside any auth route, which is the only place a phone number may be set
      // (see databaseHooks in src/auth.ts).
      try {
        const created = await ctx.internalAdapter.createUser({
          name: row.guardianName,
          email: placeholderEmail(),
          emailVerified: false,
          phoneNumber: access.phone,
          phoneNumberVerified: true,
        }, { method: 'phone-number' });
        await ctx.internalAdapter.linkAccount({ userId: created.id, providerId: 'credential', accountId: created.id, password: hash });
        userId = created.id;
        createdUserId = created.id;
      } catch {
        // Someone activated a link for this same number at this very moment.
        throw conflict('This number was just set up on another link. Open your link again.', 'TRY_AGAIN');
      }
    }
    signInPassword = body.password;
  }

  // Spend the link. Only one request can do this; if another got there first, undo.
  const claimed = await db.transaction(async (tx) => {
    const [done] = await tx
      .update(parentAccess)
      .set({ status: 'active', userId, tokenHash: null, tokenExpiresAt: null, tokenAttempts: 0, activatedAt: access.activatedAt ?? new Date() })
      .where(and(eq(parentAccess.id, access.id), eq(parentAccess.tokenHash, tokenHash)))
      .returning({ id: parentAccess.id });
    if (!done) return false;
    await tx.insert(auditEvent).values({
      schoolId: access.schoolId,
      actorId: userId,
      actorName: row.guardianName,
      action: kind === 'reset' ? 'parents.password_reset' : 'parents.activated',
      entityType: 'guardian',
      entityId: access.guardianId,
      summary: kind === 'reset' ? `${row.guardianName} set a new parent app password` : `${row.guardianName} joined the parent app`,
    });
    return true;
  });
  if (!claimed) {
    if (createdUserId) await ctx.internalAdapter.deleteUser(createdUserId);
    throw linkGone();
  }
  if (newHash) {
    await ctx.internalAdapter.updatePassword(userId, newHash);
    // A forgotten password often means a lost or shared phone: sign out everywhere.
    await ctx.internalAdapter.deleteUserSessions(userId);
  }

  // Sign them in on this device, exactly as the sign-in page would.
  const signedIn = await auth.api.signInPhoneNumber({
    body: { phoneNumber: access.phone, password: signInPassword },
    headers: c.req.raw.headers,
    asResponse: true,
  });
  const res = c.json({ ok: true, kind }, 200);
  for (const cookie of signedIn.headers.getSetCookie()) res.headers.append('Set-Cookie', cookie);
  return res;
});

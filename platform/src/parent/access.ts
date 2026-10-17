// Shared pieces of the parent app: link secrets, phone formats, and what a school lets
// parents see.
//
// How a parent gets in, start to finish:
//   1. Staff press "Invite" on a guardian (src/school/routes/parents.ts). A random secret is
//      made, its SHA-256 stored, and the link `<app>/parent/welcome#<secret>` handed back to
//      share on WhatsApp. The secret sits after '#', so browsers never send it to any server
//      in the address — only in the body of the activation request.
//   2. The parent opens it and must give the child's date of birth, then a password
//      (src/parent/activation.ts). Five wrong dates and the link is dead.
//   3. From then on they sign in with phone number and password, and the parent API
//      (src/parent/routes.ts) shows them their own children only, and only what the school
//      allows here.
import { createHash, randomBytes } from 'node:crypto';
import { and, count, eq, ne } from 'drizzle-orm';
import type { Auth } from '../auth';
import type { DbOrTx } from '../db';
import { parentAccess, parentPortal } from '../db/school-schema';

/** How long an invitation link works. */
export const LINK_TTL_MS = 7 * 24 * 60 * 60 * 1000;
/** Wrong dates of birth allowed against one link before it stops working. */
export const MAX_LINK_ATTEMPTS = 5;

export function newLinkSecret(): { secret: string; hash: string } {
  const secret = randomBytes(32).toString('base64url');
  return { secret, hash: hashLinkSecret(secret) };
}

export function hashLinkSecret(secret: string): string {
  return createHash('sha256').update(secret).digest('hex');
}

/** A link secret is exactly 43 base64url characters; anything else is not worth a lookup. */
export function looksLikeLinkSecret(value: unknown): value is string {
  return typeof value === 'string' && /^[A-Za-z0-9_-]{43}$/.test(value);
}

/** Ten digits (how guardians are stored) to the +91 form a parent's login uses. */
export function toLoginPhone(tenDigits: string): string {
  return `+91${tenDigits}`;
}

/** "+919876543210" → "+91 ••••• •3210", for showing on a page someone else might see. */
export function maskPhone(phone: string): string {
  return `+91 ••••• •${phone.slice(-4)}`;
}

/** A parent account's email. Better Auth needs one; this one can never receive mail (.invalid is reserved). */
export function placeholderEmail(): string {
  return `parent-${crypto.randomUUID()}@parents.acadlas.invalid`;
}

export type PortalSettings = {
  enabled: boolean;
  attendance: 'off' | 'summary' | 'daily';
  fees: boolean;
  receipts: 'off' | 'list' | 'full';
  studentDetails: boolean;
  classTeacher: boolean;
};

/** A school that has never opened the panel: off, with the recommended sections ready. */
export const defaultPortal: PortalSettings = {
  enabled: false,
  attendance: 'daily',
  fees: true,
  receipts: 'full',
  studentDetails: false,
  classTeacher: true,
};

export async function portalSettings(db: DbOrTx, schoolId: string): Promise<PortalSettings & { updatedByName: string | null; updatedAt: Date | null }> {
  const [row] = await db.select().from(parentPortal).where(eq(parentPortal.schoolId, schoolId)).limit(1);
  if (!row) return { ...defaultPortal, updatedByName: null, updatedAt: null };
  return {
    enabled: row.enabled,
    attendance: row.attendance,
    fees: row.fees,
    receipts: row.receipts,
    studentDetails: row.studentDetails,
    classTeacher: row.classTeacher,
    updatedByName: row.updatedByName,
    updatedAt: row.updatedAt,
  };
}

/**
 * Shuts a guardian's access: the link stops working and the parent gate refuses them on
 * their next request. Returns the login that had it, if any, for signOutIfNoAccessLeft.
 */
export async function endAccess(db: DbOrTx, schoolId: string, guardianId: string, byName: string): Promise<{ ended: boolean; userId: string | null }> {
  const [row] = await db
    .update(parentAccess)
    .set({ status: 'revoked', tokenHash: null, tokenExpiresAt: null, revokedAt: new Date(), revokedByName: byName })
    .where(and(eq(parentAccess.schoolId, schoolId), eq(parentAccess.guardianId, guardianId), ne(parentAccess.status, 'revoked')))
    .returning({ userId: parentAccess.userId });
  return { ended: Boolean(row), userId: row?.userId ?? null };
}

/** If this login has no parent access left anywhere, signs it out on every device. */
export async function signOutIfNoAccessLeft(db: DbOrTx, auth: Auth, userId: string | null): Promise<void> {
  if (!userId) return;
  const [left] = await db
    .select({ n: count() })
    .from(parentAccess)
    .where(and(eq(parentAccess.userId, userId), eq(parentAccess.status, 'active')));
  if (Number(left?.n ?? 0) > 0) return;
  const ctx = await auth.$context;
  await ctx.internalAdapter.deleteUserSessions(userId);
}

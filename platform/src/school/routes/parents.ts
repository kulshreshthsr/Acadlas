// The school's side of the parent app: what parents may see, and who may get in.
//
//   GET  /parent-portal                     the settings, and how many parents are in
//   PUT  /parent-portal                     change them (school.manage)
//   GET  /students/:id/parent-access        each guardian of a student and their access
//   POST /guardians/:id/parent-invite       a new one-time link (parents.manage)
//   POST /guardians/:id/parent-revoke       shut a guardian's access at once (parents.manage)
import { and, count, eq, inArray } from 'drizzle-orm';
import { Hono } from 'hono';
import { z } from 'zod';
import { user } from '../../db/auth-schema';
import { guardian, parentAccess, parentPortal, student, studentGuardian } from '../../db/school-schema';
import { conflict, notFound, readBody } from '../../lib/http';
import { appUrl } from '../../lib/mailer';
import { LINK_TTL_MS, endAccess, maskPhone, newLinkSecret, portalSettings, signOutIfNoAccessLeft, toLoginPhone } from '../../parent/access';
import { getStudent } from '../queries';
import { audit, requirePermission } from '../tenant';
import type { AppEnv } from '../tenant';

export const parentRoutes = new Hono<AppEnv>();

parentRoutes.get('/parent-portal', async (c) => {
  const db = c.get('db');
  const t = c.get('tenant');
  requirePermission(t, 'school.manage', 'parents.manage');
  const settings = await portalSettings(db, t.schoolId);
  const counts = await db
    .select({ status: parentAccess.status, n: count() })
    .from(parentAccess)
    .where(eq(parentAccess.schoolId, t.schoolId))
    .groupBy(parentAccess.status);
  const by = Object.fromEntries(counts.map((r) => [r.status, Number(r.n)]));
  return c.json({ settings, counts: { invited: by.invited ?? 0, active: by.active ?? 0, revoked: by.revoked ?? 0 } });
});

const settingsBody = z.object({
  enabled: z.boolean(),
  attendance: z.enum(['off', 'summary', 'daily']),
  fees: z.boolean(),
  receipts: z.enum(['off', 'list', 'full']),
  studentDetails: z.boolean(),
  classTeacher: z.boolean(),
});

parentRoutes.put('/parent-portal', async (c) => {
  const db = c.get('db');
  const t = c.get('tenant');
  requirePermission(t, 'school.manage');
  const body = await readBody(c, settingsBody);
  const before = await portalSettings(db, t.schoolId);
  await db.transaction(async (tx) => {
    await tx
      .insert(parentPortal)
      .values({ schoolId: t.schoolId, ...body, updatedByName: t.userName })
      .onConflictDoUpdate({ target: parentPortal.schoolId, set: { ...body, updatedByName: t.userName } });
    const changed = (Object.keys(body) as (keyof typeof body)[]).filter((k) => before[k] !== body[k]);
    if (changed.length) {
      await audit(tx, t, {
        action: 'parents.settings',
        entityType: 'parent_portal',
        entityId: t.schoolId,
        summary:
          before.enabled !== body.enabled
            ? `Turned the parent app ${body.enabled ? 'on' : 'off'}`
            : `Changed what parents can see: ${changed.join(', ')}`,
        data: { before: Object.fromEntries(changed.map((k) => [k, before[k]])), after: Object.fromEntries(changed.map((k) => [k, body[k]])) },
      });
    }
  });
  return c.json({ settings: await portalSettings(db, t.schoolId) });
});

/** The guardian, checked to be this school's, with their children here. */
async function guardianInSchool(db: Parameters<typeof portalSettings>[0], schoolId: string, guardianId: string) {
  const [g] = await db
    .select()
    .from(guardian)
    .where(and(eq(guardian.schoolId, schoolId), eq(guardian.id, guardianId)))
    .limit(1);
  if (!g) throw notFound('That guardian');
  const children = await db
    .select({ id: student.id, firstName: student.firstName, dateOfBirth: student.dateOfBirth, status: student.status })
    .from(studentGuardian)
    .innerJoin(student, eq(student.id, studentGuardian.studentId))
    .where(and(eq(studentGuardian.schoolId, schoolId), eq(studentGuardian.guardianId, guardianId)));
  return { guardian: g, children };
}

function accessView(a: typeof parentAccess.$inferSelect | undefined) {
  if (!a) return null;
  const linkLive = a.status !== 'revoked' && a.tokenExpiresAt !== null && a.tokenExpiresAt > new Date();
  return {
    status: a.status,
    invitedAt: a.invitedAt,
    invitedByName: a.invitedByName,
    linkExpiresAt: linkLive ? a.tokenExpiresAt : null,
    activatedAt: a.activatedAt,
    lastSeenAt: a.lastSeenAt,
    revokedAt: a.revokedAt,
    revokedByName: a.revokedByName,
  };
}

parentRoutes.get('/students/:id/parent-access', async (c) => {
  const db = c.get('db');
  const t = c.get('tenant');
  requirePermission(t, 'parents.manage');
  const s = await getStudent(db, t, c.req.param('id'));
  const rows = await db
    .select({ guardian, relation: studentGuardian.relation, isPrimary: studentGuardian.isPrimary })
    .from(studentGuardian)
    .innerJoin(guardian, eq(guardian.id, studentGuardian.guardianId))
    .where(and(eq(studentGuardian.schoolId, t.schoolId), eq(studentGuardian.studentId, s.id)));
  const ids = rows.map((r) => r.guardian.id);
  const access = ids.length
    ? await db
        .select()
        .from(parentAccess)
        .where(and(eq(parentAccess.schoolId, t.schoolId), inArray(parentAccess.guardianId, ids)))
    : [];
  const settings = await portalSettings(db, t.schoolId);
  return c.json({
    portalEnabled: settings.enabled,
    hasDateOfBirth: Boolean(s.dateOfBirth),
    guardians: rows.map((r) => ({
      id: r.guardian.id,
      name: r.guardian.name,
      relation: r.relation,
      isPrimary: r.isPrimary,
      phone: r.guardian.phone,
      access: accessView(access.find((a) => a.guardianId === r.guardian.id)),
    })),
  });
});

parentRoutes.post('/guardians/:id/parent-invite', async (c) => {
  const db = c.get('db');
  const t = c.get('tenant');
  requirePermission(t, 'parents.manage');
  await readBody(c, z.object({}).strict());

  const settings = await portalSettings(db, t.schoolId);
  if (!settings.enabled) throw conflict('Turn on the parent app in Settings first.', 'PORTAL_OFF');

  const { guardian: g, children } = await guardianInSchool(db, t.schoolId, c.req.param('id'));
  if (!g.phone) throw conflict(`Add a mobile number for ${g.name} first. It becomes their login.`, 'NO_PHONE');
  const current = children.filter((ch) => ch.status === 'active');
  if (current.length === 0) throw conflict(`${g.name} has no child studying here now.`, 'NO_CHILDREN');
  // The date of birth is what proves the person opening the link is family.
  if (!current.some((ch) => ch.dateOfBirth)) {
    throw conflict(`Add the date of birth of ${current.map((ch) => ch.firstName).join(' or ')} first. The parent confirms it to use the link.`, 'NO_DATE_OF_BIRTH');
  }

  const phone = toLoginPhone(g.phone);
  const { secret, hash } = newLinkSecret();
  const expiresAt = new Date(Date.now() + LINK_TTL_MS);

  const result = await db.transaction(async (tx) => {
    const [existing] = await tx.select().from(parentAccess).where(eq(parentAccess.guardianId, g.id)).limit(1);
    // An active parent keeps their login when sent a fresh link — it is how they reset a
    // forgotten password. If the number has changed since, the old login loses this child:
    // whoever holds the new number has to prove themselves from the start.
    let keepLogin = false;
    if (existing?.status === 'active' && existing.userId) {
      const [u] = await tx.select({ phone: user.phoneNumber }).from(user).where(eq(user.id, existing.userId)).limit(1);
      keepLogin = u?.phone === phone;
    }
    const values = {
      phone,
      tokenHash: hash,
      tokenExpiresAt: expiresAt,
      tokenAttempts: 0,
      invitedByName: t.userName,
      invitedAt: new Date(),
      status: keepLogin ? ('active' as const) : ('invited' as const),
      userId: keepLogin ? existing!.userId : null,
      revokedAt: null,
      revokedByName: null,
    };
    if (existing) await tx.update(parentAccess).set(values).where(eq(parentAccess.id, existing.id));
    else await tx.insert(parentAccess).values({ schoolId: t.schoolId, guardianId: g.id, ...values });
    await audit(tx, t, {
      action: keepLogin ? 'parents.reset_link' : 'parents.invited',
      entityType: 'guardian',
      entityId: g.id,
      summary: keepLogin ? `Sent ${g.name} a link to set a new parent app password` : `Invited ${g.name} to the parent app (${maskPhone(phone)})`,
    });
    return { reset: keepLogin };
  });

  return c.json(
    {
      url: `${appUrl()}/parent/welcome#${secret}`,
      expiresAt,
      phone: g.phone,
      guardianName: g.name,
      reset: result.reset,
    },
    201,
  );
});

parentRoutes.post('/guardians/:id/parent-revoke', async (c) => {
  const db = c.get('db');
  const t = c.get('tenant');
  requirePermission(t, 'parents.manage');
  await readBody(c, z.object({}).strict());
  const { guardian: g } = await guardianInSchool(db, t.schoolId, c.req.param('id'));
  const ended = await db.transaction(async (tx) => {
    const result = await endAccess(tx, t.schoolId, g.id, t.userName);
    if (result.ended) {
      await audit(tx, t, { action: 'parents.revoked', entityType: 'guardian', entityId: g.id, summary: `Removed ${g.name}'s parent app access` });
    }
    return result;
  });
  if (!ended.ended) throw conflict(`${g.name} has no parent app access to remove.`, 'NOT_INVITED');
  // The parent gate already refuses them on their next request. If this was their only way
  // in anywhere, their sessions go too, so nothing is left signed in on a shared phone.
  await signOutIfNoAccessLeft(db, c.get('auth'), ended.userId);
  return c.json({ ok: true });
});


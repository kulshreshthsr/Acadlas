// Staff: the people who work at the school, their roles, and their Acadlas logins.
//
// A staff record exists whether or not the person signs in (the driver, the gardener and
// the visiting music teacher all belong on the list). Giving someone a login sends a
// Better Auth invitation carrying their role; accepting it links the login to this record.
import { and, asc, eq, inArray } from 'drizzle-orm';
import { Hono } from 'hono';
import { z } from 'zod';
import { invitation, member, organization, user } from '../../db/auth-schema';
import { section, staff } from '../../db/school-schema';
import { appUrl } from '../../lib/mailer';
import { HttpError, conflict, email, invalid, isoDate, notFound, optionalText, phone, readBody, requiredText } from '../../lib/http';
import { todayIST } from '../../lib/dates';
import { assignableRoles, parseRoles, roleLabels } from '../roles';
import { audit, requirePermission } from '../tenant';
import type { AppContext, AppEnv } from '../tenant';

export const staffRoutes = new Hono<AppEnv>();

const staffFields = z.object({
  name: requiredText('Name', 80),
  email: email,
  phone: phone,
  designation: optionalText,
  employeeCode: optionalText,
  joinedOn: isoDate.optional().nullable(),
});

/** Better Auth reports its refusals as APIError; this turns them into our own wording. */
async function viaAuth<T>(run: () => Promise<T>): Promise<T> {
  try {
    return await run();
  } catch (error) {
    const err = error as { body?: { code?: string; message?: string }; status?: string | number; statusCode?: number };
    const code = err.body?.code ?? 'AUTH_ERROR';
    const messages: Record<string, string> = {
      USER_IS_ALREADY_A_MEMBER_OF_THIS_ORGANIZATION: 'Someone with that email is already a member of this school.',
      USER_IS_ALREADY_INVITED_TO_THIS_ORGANIZATION: 'That email already has an invitation waiting. Copy the link from their row.',
      YOU_ARE_NOT_ALLOWED_TO_INVITE_USERS_TO_THIS_ORGANIZATION: 'Your role cannot invite people to this school.',
      YOU_CANNOT_LEAVE_THE_ORGANIZATION_AS_THE_ONLY_OWNER: 'The school needs at least one owner.',
    };
    throw new HttpError(typeof err.statusCode === 'number' ? err.statusCode : 400, code, messages[code] ?? err.body?.message ?? 'That could not be done.');
  }
}

function inviteUrl(id: string) {
  return `${appUrl()}/invite/${id}`;
}

async function sendInvite(c: AppContext, emailAddress: string, role: (typeof assignableRoles)[number]) {
  const auth = c.get('auth');
  const t = c.get('tenant');
  const created = await viaAuth(() =>
    auth.api.createInvitation({
      headers: c.req.raw.headers,
      body: { email: emailAddress, role, organizationId: t.schoolId, resend: true },
    }),
  );
  return created as { id: string };
}

staffRoutes.get('/staff', async (c) => {
  const db = c.get('db');
  const t = c.get('tenant');
  const people = await db.select().from(staff).where(eq(staff.schoolId, t.schoolId)).orderBy(asc(staff.status), asc(staff.name));

  const userIds = people.map((p) => p.userId).filter((x): x is string => Boolean(x));
  const members = userIds.length
    ? await db
        .select({ id: member.id, userId: member.userId, role: member.role })
        .from(member)
        .where(and(eq(member.organizationId, t.schoolId), inArray(member.userId, userIds)))
    : [];
  const invites = await db
    .select()
    .from(invitation)
    .where(and(eq(invitation.organizationId, t.schoolId), eq(invitation.status, 'pending')));
  const classes = await db
    .select({ classTeacherId: section.classTeacherId, sectionId: section.id })
    .from(section)
    .where(eq(section.schoolId, t.schoolId));
  const now = new Date();
  const canManage = t.permissions.has('staff.manage');

  return c.json({
    canManage,
    roles: assignableRoles.map((r) => ({ id: r, label: roleLabels[r] })),
    staff: people.map((p) => {
      const m = members.find((mm) => mm.userId === p.userId);
      const inv = invites.find((i) => p.email && i.email.toLowerCase() === p.email && i.expiresAt > now);
      const roles = m ? parseRoles(m.role) : inv ? parseRoles(inv.role) : [];
      return {
        ...p,
        // Contact details are for people who run the school, not for every teacher.
        phone: canManage || p.id === t.staffId ? p.phone : null,
        roles,
        roleLabel: roles.map((r) => roleLabels[r]).join(', ') || null,
        login: m ? 'active' : inv ? 'invited' : 'none',
        isOwner: roles.includes('owner'),
        isYou: p.userId === t.userId,
        invite: inv && canManage ? { id: inv.id, expiresAt: inv.expiresAt, url: inviteUrl(inv.id) } : null,
        classTeacherOf: classes.filter((cl) => cl.classTeacherId === p.id).length,
      };
    }),
  });
});

staffRoutes.post('/staff', async (c) => {
  const db = c.get('db');
  const t = c.get('tenant');
  requirePermission(t, 'staff.manage');
  const body = await readBody(c, staffFields.extend({ role: z.enum(assignableRoles).optional().nullable(), invite: z.boolean().default(false) }));
  if (body.invite && !body.email) throw invalid('An email address is needed to give someone a login.', { email: 'Needed to send the invitation.' });
  if (body.invite && !body.role) throw invalid('Choose what they will do in Acadlas.', { role: 'Choose a role.' });

  if (body.email) {
    const [clash] = await db.select({ id: staff.id }).from(staff).where(and(eq(staff.schoolId, t.schoolId), eq(staff.email, body.email)));
    if (clash) throw conflict('Someone on the staff list already has that email address.');
  }

  const { role, invite, ...fields } = body;
  const [created] = await db.insert(staff).values({ schoolId: t.schoolId, ...fields }).returning();

  let inv: { id: string } | null = null;
  if (invite && body.email && role) {
    try {
      inv = await sendInvite(c, body.email, role);
    } catch (error) {
      // The staff record stays; only the login part failed, and that can be retried from their row.
      await audit(db, t, { action: 'staff.added', entityType: 'staff', entityId: created.id, summary: `Added ${created.name} to the staff list` });
      throw error;
    }
    await db.update(staff).set({ invitationId: inv.id }).where(eq(staff.id, created.id));
  }

  await audit(db, t, {
    action: 'staff.added',
    entityType: 'staff',
    entityId: created.id,
    summary: inv ? `Added ${created.name} and invited them as ${roleLabels[role!]}` : `Added ${created.name} to the staff list`,
  });
  return c.json({ staff: created, invite: inv ? { id: inv.id, url: inviteUrl(inv.id) } : null }, 201);
});

staffRoutes.patch('/staff/:id', async (c) => {
  const db = c.get('db');
  const t = c.get('tenant');
  requirePermission(t, 'staff.manage');
  const id = c.req.param('id');
  const body = await readBody(c, staffFields.partial());
  const [current] = await db.select().from(staff).where(and(eq(staff.schoolId, t.schoolId), eq(staff.id, id)));
  if (!current) throw notFound('That staff member');
  if (body.email !== undefined && body.email !== current.email && current.userId) {
    throw invalid('This person signs in with their email, so it cannot be changed here.');
  }
  await db.update(staff).set(body).where(eq(staff.id, id));
  await audit(db, t, { action: 'staff.updated', entityType: 'staff', entityId: id, summary: `Updated ${body.name ?? current.name}'s details` });
  return c.json({ ok: true });
});

/** Gives someone a login, or sends a fresh link if their invitation lapsed. */
staffRoutes.post('/staff/:id/invite', async (c) => {
  const db = c.get('db');
  const t = c.get('tenant');
  requirePermission(t, 'staff.manage');
  const id = c.req.param('id');
  const body = await readBody(c, z.object({ role: z.enum(assignableRoles), email: email }));
  const [current] = await db.select().from(staff).where(and(eq(staff.schoolId, t.schoolId), eq(staff.id, id)));
  if (!current) throw notFound('That staff member');
  if (current.userId) throw conflict(`${current.name} already has a login.`);
  const address = body.email ?? current.email;
  if (!address) throw invalid('Add their email address first.', { email: 'Needed to send the invitation.' });
  if (address !== current.email) {
    const [clash] = await db.select({ id: staff.id }).from(staff).where(and(eq(staff.schoolId, t.schoolId), eq(staff.email, address)));
    if (clash) throw conflict('Someone on the staff list already has that email address.');
    await db.update(staff).set({ email: address }).where(eq(staff.id, id));
  }

  const inv = await sendInvite(c, address, body.role);
  await db.update(staff).set({ invitationId: inv.id }).where(eq(staff.id, id));
  await audit(db, t, { action: 'staff.invited', entityType: 'staff', entityId: id, summary: `Invited ${current.name} as ${roleLabels[body.role]}` });
  return c.json({ invite: { id: inv.id, url: inviteUrl(inv.id) } });
});

staffRoutes.post('/staff/:id/role', async (c) => {
  const db = c.get('db');
  const auth = c.get('auth');
  const t = c.get('tenant');
  requirePermission(t, 'staff.manage');
  const id = c.req.param('id');
  const body = await readBody(c, z.object({ role: z.enum(assignableRoles) }));
  const [current] = await db.select().from(staff).where(and(eq(staff.schoolId, t.schoolId), eq(staff.id, id)));
  if (!current) throw notFound('That staff member');

  if (current.userId) {
    const [m] = await db.select().from(member).where(and(eq(member.organizationId, t.schoolId), eq(member.userId, current.userId)));
    if (!m) throw conflict(`${current.name} no longer has a login here.`);
    if (parseRoles(m.role).includes('owner')) throw conflict('The owner’s role cannot be changed.');
    if (current.userId === t.userId) throw conflict('You cannot change your own role.');
    await viaAuth(() => auth.api.updateMemberRole({ headers: c.req.raw.headers, body: { memberId: m.id, role: body.role, organizationId: t.schoolId } }));
  } else if (current.email) {
    // Not signed up yet: re-issue the invitation with the new role.
    const inv = await sendInvite(c, current.email, body.role);
    await db.update(staff).set({ invitationId: inv.id }).where(eq(staff.id, id));
  } else {
    throw conflict(`${current.name} has no login to give a role to.`);
  }
  await audit(db, t, { action: 'staff.role', entityType: 'staff', entityId: id, summary: `Changed ${current.name}'s role to ${roleLabels[body.role]}` });
  return c.json({ ok: true });
});

/** Marks someone as having left. Their login to this school is removed; their history stays. */
staffRoutes.post('/staff/:id/leave', async (c) => {
  const db = c.get('db');
  const auth = c.get('auth');
  const t = c.get('tenant');
  requirePermission(t, 'staff.manage');
  const id = c.req.param('id');
  const [current] = await db.select().from(staff).where(and(eq(staff.schoolId, t.schoolId), eq(staff.id, id)));
  if (!current) throw notFound('That staff member');
  if (current.userId === t.userId) throw conflict('You cannot mark yourself as having left.');

  if (current.userId) {
    const [m] = await db.select().from(member).where(and(eq(member.organizationId, t.schoolId), eq(member.userId, current.userId)));
    if (m) {
      if (parseRoles(m.role).includes('owner')) throw conflict('The owner cannot be removed.');
      await viaAuth(() => auth.api.removeMember({ headers: c.req.raw.headers, body: { memberIdOrEmail: m.id, organizationId: t.schoolId } }));
    }
  }
  const pending = await db
    .select({ id: invitation.id })
    .from(invitation)
    .where(and(eq(invitation.organizationId, t.schoolId), eq(invitation.status, 'pending'), eq(invitation.email, current.email ?? '')));
  for (const inv of pending) {
    await db.update(invitation).set({ status: 'canceled' }).where(eq(invitation.id, inv.id));
  }

  await db.transaction(async (tx) => {
    await tx.update(staff).set({ status: 'left', userId: null, invitationId: null, joinedOn: current.joinedOn }).where(eq(staff.id, id));
    await tx.update(section).set({ classTeacherId: null }).where(and(eq(section.schoolId, t.schoolId), eq(section.classTeacherId, id)));
    await audit(tx, t, { action: 'staff.left', entityType: 'staff', entityId: id, summary: `${current.name} left the school (${todayIST()})` });
  });
  return c.json({ ok: true });
});

staffRoutes.post('/staff/:id/rejoin', async (c) => {
  const db = c.get('db');
  const t = c.get('tenant');
  requirePermission(t, 'staff.manage');
  const id = c.req.param('id');
  const updated = await db
    .update(staff)
    .set({ status: 'active' })
    .where(and(eq(staff.schoolId, t.schoolId), eq(staff.id, id)))
    .returning();
  if (updated.length === 0) throw notFound('That staff member');
  await audit(db, t, { action: 'staff.rejoined', entityType: 'staff', entityId: id, summary: `${updated[0].name} rejoined` });
  return c.json({ ok: true });
});

// ---------------------------------------------------------------------------
// Public: what an invitation link is for, before the person has an account
// ---------------------------------------------------------------------------

export const invitationInfoRoutes = new Hono<AppEnv>();

invitationInfoRoutes.get('/invitations/:id', async (c) => {
  const db = c.get('db');
  const [row] = await db
    .select({
      id: invitation.id,
      email: invitation.email,
      role: invitation.role,
      status: invitation.status,
      expiresAt: invitation.expiresAt,
      schoolName: organization.name,
      inviterName: user.name,
    })
    .from(invitation)
    .innerJoin(organization, eq(organization.id, invitation.organizationId))
    .innerJoin(user, eq(user.id, invitation.inviterId))
    .where(eq(invitation.id, c.req.param('id')));
  if (!row) throw notFound('That invitation');
  const roles = parseRoles(row.role);
  const accountExists = Boolean((await db.select({ id: user.id }).from(user).where(eq(user.email, row.email.toLowerCase())))[0]);
  return c.json({
    ...row,
    roleLabel: roles.map((r) => roleLabels[r]).join(', '),
    expired: row.expiresAt < new Date(),
    accountExists,
  });
});

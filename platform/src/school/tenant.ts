// The one gate every Acadlas School request passes through.
//
// It answers four questions before any route runs, and refuses the request if any answer
// is wrong:
//
//   1. Who is this?                    — the Better Auth session (401 if none)
//   2. Which school are they working in? — the session's active organization (409 if none)
//   3. Do they still belong to it?      — a fresh membership lookup, never the cookie alone (403)
//   4. What may they do there?          — their role(s), turned into a permission set
//
// Routes then read `c.get('tenant')` and must filter every query on `tenant.schoolId`.
// The school id never comes from the URL or the request body, so there is no parameter a
// person could change to reach another school's data.
import { and, eq, sql } from 'drizzle-orm';
import type { Context, MiddlewareHandler } from 'hono';
import type { Auth } from '../auth';
import type { Db, DbOrTx } from '../db';
import { member } from '../db/auth-schema';
import { auditEvent, counter, staff } from '../db/school-schema';
import { HttpError, forbidden } from '../lib/http';
import { parseRoles, permissionsFor } from './roles';
import type { Permission, SchoolRole } from './roles';

export type Tenant = {
  schoolId: string;
  userId: string;
  userName: string;
  email: string;
  roles: SchoolRole[];
  permissions: Set<Permission>;
  /** This person's staff record in this school, if they have one. */
  staffId: string | null;
};

export type AppEnv = {
  Variables: {
    db: Db;
    auth: Auth;
    tenant: Tenant;
  };
};

export type AppContext = Context<AppEnv>;

export function tenantGate(): MiddlewareHandler<AppEnv> {
  return async (c, next) => {
    const auth = c.get('auth');
    const db = c.get('db');

    const session = await auth.api.getSession({ headers: c.req.raw.headers });
    if (!session) throw new HttpError(401, 'UNAUTHENTICATED', 'Sign in to continue.');

    const schoolId = session.session.activeOrganizationId;
    if (!schoolId) throw new HttpError(409, 'NO_ACTIVE_SCHOOL', 'Choose a school to work in first.');

    const [membership] = await db
      .select({ role: member.role, staffId: staff.id })
      .from(member)
      .leftJoin(staff, and(eq(staff.schoolId, member.organizationId), eq(staff.userId, member.userId)))
      .where(and(eq(member.organizationId, schoolId), eq(member.userId, session.user.id)))
      .limit(1);

    if (!membership) throw forbidden('You are no longer a member of this school.');

    const roles = parseRoles(membership.role);
    c.set('tenant', {
      schoolId,
      userId: session.user.id,
      userName: session.user.name,
      email: session.user.email,
      roles,
      permissions: permissionsFor(roles),
      staffId: membership.staffId ?? null,
    });

    await next();
  };
}

export function can(tenant: Tenant, permission: Permission): boolean {
  return tenant.permissions.has(permission);
}

/** Passes if the person holds any one of `anyOf`; refuses with 403 otherwise. */
export function requirePermission(tenant: Tenant, ...anyOf: Permission[]): void {
  if (!anyOf.some((p) => tenant.permissions.has(p))) throw forbidden();
}

// ---------------------------------------------------------------------------
// Shared write helpers
// ---------------------------------------------------------------------------

type AuditInput = {
  action: string;
  entityType: string;
  entityId?: string | null;
  studentId?: string | null;
  summary: string;
  data?: Record<string, unknown>;
};

/** Records who did what. Pass the transaction handle so the trail and the change commit together. */
export async function audit(db: DbOrTx, tenant: Tenant, input: AuditInput): Promise<void> {
  await db.insert(auditEvent).values({
    schoolId: tenant.schoolId,
    actorId: tenant.userId,
    actorName: tenant.userName,
    action: input.action,
    entityType: input.entityType,
    entityId: input.entityId ?? null,
    studentId: input.studentId ?? null,
    summary: input.summary,
    data: input.data ?? null,
  });
}

/**
 * The next number in a per-school sequence (admission numbers, receipts). A single
 * INSERT … ON CONFLICT DO UPDATE … RETURNING is atomic, so two clerks recording fees at
 * the same moment can never be handed the same receipt number.
 */
export async function nextNumber(db: DbOrTx, schoolId: string, key: string): Promise<number> {
  const [row] = await db
    .insert(counter)
    .values({ schoolId, key, value: 1 })
    .onConflictDoUpdate({ target: [counter.schoolId, counter.key], set: { value: sql`${counter.value} + 1` } })
    .returning({ value: counter.value });
  return row.value;
}


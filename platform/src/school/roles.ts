// Who may do what inside a school.
//
// Two layers, defined together here so they cannot drift apart:
//
// - Better Auth's access control decides who may manage the school's *account*: invite
//   people, change their roles, remove them. It also makes these role names valid on an
//   invitation, so an invitation can say "teacher" and the person joins as a teacher.
// - `permissionsFor` decides what each role may do *in Acadlas School*: admit a student,
//   take a register, collect a fee. Every product route checks it on the server.
import { createAccessControl } from 'better-auth/plugins/access';
import { adminAc, defaultStatements, memberAc, ownerAc } from 'better-auth/plugins/organization/access';

export const ac = createAccessControl(defaultStatements);

export const authRoles = {
  owner: ac.newRole(ownerAc.statements),
  admin: ac.newRole(adminAc.statements),
  accountant: ac.newRole(memberAc.statements),
  teacher: ac.newRole(memberAc.statements),
  office: ac.newRole(memberAc.statements),
  // Kept so anyone invited before school roles existed still resolves to a role.
  member: ac.newRole(memberAc.statements),
};

export const schoolRoles = ['owner', 'admin', 'accountant', 'teacher', 'office'] as const;
export type SchoolRole = (typeof schoolRoles)[number] | 'member';

/** Roles a school can hand out. Ownership is never handed out by invitation. */
export const assignableRoles = ['admin', 'accountant', 'teacher', 'office'] as const;
export type AssignableRole = (typeof assignableRoles)[number];

export const permissions = [
  'school.manage', // school details, years, classes, subjects, holidays
  'staff.manage',
  'students.view.all',
  'students.view.own', // only students in sections they teach
  'students.edit',
  'attendance.mark.all',
  'attendance.mark.own',
  'attendance.view',
  'fees.view',
  'fees.collect',
  'fees.manage', // plans, heads, concessions, cancelling receipts
  'reports.fees',
  'reports.academic',
  'audit.view',
] as const;

export type Permission = (typeof permissions)[number];

const matrix: Record<SchoolRole, Permission[]> = {
  owner: [...permissions],
  admin: [...permissions],
  accountant: ['students.view.all', 'attendance.view', 'fees.view', 'fees.collect', 'fees.manage', 'reports.fees'],
  office: [
    'students.view.all',
    'students.edit',
    'attendance.mark.all',
    'attendance.view',
    'fees.view',
    'fees.collect',
    'reports.academic',
  ],
  teacher: ['students.view.own', 'attendance.mark.own', 'attendance.view', 'reports.academic'],
  member: ['students.view.own', 'attendance.view'],
};

/** Better Auth stores several roles as "admin,teacher". */
export function parseRoles(role: string | null | undefined): SchoolRole[] {
  return (role ?? 'member')
    .split(',')
    .map((r) => r.trim())
    .filter((r): r is SchoolRole => r in matrix);
}

export function permissionsFor(roles: SchoolRole[]): Set<Permission> {
  const result = new Set<Permission>();
  for (const role of roles) for (const permission of matrix[role]) result.add(permission);
  return result;
}

export const roleLabels: Record<SchoolRole, string> = {
  owner: 'Owner',
  admin: 'Administrator',
  accountant: 'Accountant',
  teacher: 'Teacher',
  office: 'Front office',
  member: 'Member',
};

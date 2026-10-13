// Lookups many routes share. Each one takes the tenant and filters on its school, so a
// route that uses these cannot accidentally reach another school's rows.
import { and, eq, inArray, or } from 'drizzle-orm';
import type { DbOrTx } from '../db';
import { academicYear, enrollment, grade, section, staff, student, teachingAssignment } from '../db/school-schema';
import { HttpError, forbidden, notFound } from '../lib/http';
import { can } from './tenant';
import type { Tenant } from './tenant';

export async function findCurrentYear(db: DbOrTx, schoolId: string) {
  const [year] = await db
    .select()
    .from(academicYear)
    .where(and(eq(academicYear.schoolId, schoolId), eq(academicYear.isCurrent, true)))
    .limit(1);
  return year ?? null;
}

/** The year asked for, or the current one when none is named. 409 if the school has no year yet. */
export async function resolveYear(db: DbOrTx, tenant: Tenant, yearId?: string | null) {
  if (yearId) {
    const [year] = await db
      .select()
      .from(academicYear)
      .where(and(eq(academicYear.schoolId, tenant.schoolId), eq(academicYear.id, yearId)))
      .limit(1);
    if (!year) throw notFound('That academic year');
    return year;
  }
  const year = await findCurrentYear(db, tenant.schoolId);
  if (!year) throw new HttpError(409, 'NO_ACADEMIC_YEAR', 'Set up an academic year first, in Settings.');
  return year;
}

export async function getSection(db: DbOrTx, tenant: Tenant, sectionId: string) {
  const [row] = await db
    .select({
      id: section.id,
      name: section.name,
      yearId: section.yearId,
      gradeId: section.gradeId,
      gradeName: grade.name,
      classTeacherId: section.classTeacherId,
    })
    .from(section)
    .innerJoin(grade, eq(grade.id, section.gradeId))
    .where(and(eq(section.schoolId, tenant.schoolId), eq(section.id, sectionId)))
    .limit(1);
  if (!row) throw notFound('That section');
  return row;
}

export async function getStudent(db: DbOrTx, tenant: Tenant, studentId: string) {
  const [row] = await db
    .select()
    .from(student)
    .where(and(eq(student.schoolId, tenant.schoolId), eq(student.id, studentId)))
    .limit(1);
  if (!row) throw notFound('That student');
  return row;
}

/**
 * Sections a teacher works with: the ones they are class teacher of, plus any they teach a
 * subject to. Returns null for roles that may see every section.
 */
export async function ownSectionIds(db: DbOrTx, tenant: Tenant): Promise<string[] | null> {
  if (can(tenant, 'students.view.all') || can(tenant, 'attendance.mark.all')) return null;
  if (!tenant.staffId) return [];

  const rows = await db
    .selectDistinct({ id: section.id })
    .from(section)
    .leftJoin(teachingAssignment, eq(teachingAssignment.sectionId, section.id))
    .where(
      and(
        eq(section.schoolId, tenant.schoolId),
        or(eq(section.classTeacherId, tenant.staffId), eq(teachingAssignment.staffId, tenant.staffId)),
      ),
    );
  return rows.map((r) => r.id);
}

/** Refuses unless this person may see the student — everyone with view-all, or a teacher of their section. */
export async function assertCanViewStudent(db: DbOrTx, tenant: Tenant, studentId: string, yearId: string | null) {
  if (can(tenant, 'students.view.all')) return;
  if (!can(tenant, 'students.view.own')) throw forbidden();
  const own = await ownSectionIds(db, tenant);
  if (own && own.length > 0 && yearId) {
    const [hit] = await db
      .select({ id: enrollment.id })
      .from(enrollment)
      .where(
        and(
          eq(enrollment.schoolId, tenant.schoolId),
          eq(enrollment.studentId, studentId),
          eq(enrollment.yearId, yearId),
          inArray(enrollment.sectionId, own),
        ),
      )
      .limit(1);
    if (hit) return;
  }
  throw forbidden('Teachers can open the records of students in their own sections.');
}

export async function staffName(db: DbOrTx, tenant: Tenant, staffId: string | null) {
  if (!staffId) return null;
  const [row] = await db
    .select({ name: staff.name })
    .from(staff)
    .where(and(eq(staff.schoolId, tenant.schoolId), eq(staff.id, staffId)))
    .limit(1);
  return row?.name ?? null;
}

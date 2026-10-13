// School-wide reports that are not already a list elsewhere: class strength and the
// month's attendance across every section. Fee reports live with fees (dues, collections,
// summary); class lists are the students list filtered to a section.
import { and, asc, between, eq, sql } from 'drizzle-orm';
import { Hono } from 'hono';
import { z } from 'zod';
import { attendanceRegister, enrollment, grade, section, staff, student } from '../../db/school-schema';
import { monthBounds } from '../../lib/dates';
import { readQuery } from '../../lib/http';
import { ownSectionIds, resolveYear } from '../queries';
import { requirePermission } from '../tenant';
import type { AppEnv } from '../tenant';

export const reportRoutes = new Hono<AppEnv>();

/** How many students in each section, split by gender, as UDISE+ and board returns ask for. */
reportRoutes.get('/reports/strength', async (c) => {
  const db = c.get('db');
  const t = c.get('tenant');
  requirePermission(t, 'reports.academic', 'reports.fees');
  const q = readQuery(c, z.object({ yearId: z.string().optional() }));
  const year = await resolveYear(db, t, q.yearId);

  const rows = await db
    .select({
      sectionId: section.id,
      gradeName: grade.name,
      position: grade.position,
      sectionName: section.name,
      classTeacher: staff.name,
      total: sql<number>`count(${student.id})::int`,
      boys: sql<number>`count(${student.id}) filter (where ${student.gender} = 'male')::int`,
      girls: sql<number>`count(${student.id}) filter (where ${student.gender} = 'female')::int`,
      rte: sql<number>`count(${student.id}) filter (where ${student.isRte})::int`,
    })
    .from(section)
    .innerJoin(grade, eq(grade.id, section.gradeId))
    .leftJoin(staff, eq(staff.id, section.classTeacherId))
    .leftJoin(enrollment, eq(enrollment.sectionId, section.id))
    .leftJoin(student, and(eq(student.id, enrollment.studentId), eq(student.status, 'active')))
    .where(and(eq(section.schoolId, t.schoolId), eq(section.yearId, year.id)))
    .groupBy(section.id, grade.name, grade.position, section.name, staff.name)
    .orderBy(asc(grade.position), asc(section.name));

  const list = rows.map((r) => ({ ...r, label: `${r.gradeName}-${r.sectionName}`, total: Number(r.total), boys: Number(r.boys), girls: Number(r.girls), rte: Number(r.rte) }));
  return c.json({
    year,
    rows: list,
    totals: {
      total: list.reduce((s, r) => s + r.total, 0),
      boys: list.reduce((s, r) => s + r.boys, 0),
      girls: list.reduce((s, r) => s + r.girls, 0),
      rte: list.reduce((s, r) => s + r.rte, 0),
    },
  });
});

/** Each section's month: registers taken and the share of marks that were present or late. */
reportRoutes.get('/reports/attendance', async (c) => {
  const db = c.get('db');
  const t = c.get('tenant');
  requirePermission(t, 'reports.academic', 'attendance.view');
  const q = readQuery(c, z.object({ month: z.string().regex(/^\d{4}-\d{2}$/) }));
  const { from, to } = monthBounds(q.month);
  const year = await resolveYear(db, t);
  const own = await ownSectionIds(db, t);

  const rows = await db
    .select({
      sectionId: section.id,
      gradeName: grade.name,
      position: grade.position,
      sectionName: section.name,
      registers: sql<number>`count(${attendanceRegister.id})::int`,
      present: sql<number>`coalesce(sum(${attendanceRegister.present}), 0)::int`,
      late: sql<number>`coalesce(sum(${attendanceRegister.late}), 0)::int`,
      absent: sql<number>`coalesce(sum(${attendanceRegister.absent}), 0)::int`,
    })
    .from(section)
    .innerJoin(grade, eq(grade.id, section.gradeId))
    .leftJoin(attendanceRegister, and(eq(attendanceRegister.sectionId, section.id), between(attendanceRegister.date, from, to)))
    .where(and(eq(section.schoolId, t.schoolId), eq(section.yearId, year.id)))
    .groupBy(section.id, grade.name, grade.position, section.name)
    .orderBy(asc(grade.position), asc(section.name));

  return c.json({
    month: q.month,
    rows: rows
      .filter((r) => own === null || own.includes(r.sectionId))
      .map((r) => {
        const marks = Number(r.present) + Number(r.late) + Number(r.absent);
        return {
          ...r,
          label: `${r.gradeName}-${r.sectionName}`,
          registers: Number(r.registers),
          present: Number(r.present),
          late: Number(r.late),
          absent: Number(r.absent),
          percent: marks ? Math.round(((Number(r.present) + Number(r.late)) / marks) * 1000) / 10 : null,
        };
      }),
  });
});

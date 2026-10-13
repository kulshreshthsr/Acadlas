// Attendance: one register per section per day, marked from a phone in the classroom.
import { and, asc, between, eq, inArray, sql } from 'drizzle-orm';
import { Hono } from 'hono';
import { z } from 'zod';
import type { DbOrTx } from '../../db';
import { attendanceRegister, enrollment, grade, guardian, holiday, schoolProfile, section, student, studentGuardian } from '../../db/school-schema';
import type { Mark } from '../../db/school-schema';
import { isWorkingDay, monthBounds, todayIST } from '../../lib/dates';
import { forbidden, invalid, isoDate, readBody, readQuery } from '../../lib/http';
import { findCurrentYear, getSection, ownSectionIds, resolveYear } from '../queries';
import { audit, can, requirePermission } from '../tenant';
import type { AppEnv, Tenant } from '../tenant';
import { fullName } from './students';

export const attendanceRoutes = new Hono<AppEnv>();

const markValue = z.enum(['P', 'A', 'L']);
const markLabel: Record<Mark, string> = { P: 'present', A: 'absent', L: 'late' };

async function roster(db: DbOrTx, tenant: Tenant, sectionId: string, onDate?: string) {
  const rows = await db
    .select({
      id: student.id,
      firstName: student.firstName,
      lastName: student.lastName,
      gender: student.gender,
      rollNo: enrollment.rollNo,
      enrolledOn: enrollment.enrolledOn,
      dateOfBirth: student.dateOfBirth,
    })
    .from(enrollment)
    .innerJoin(student, eq(student.id, enrollment.studentId))
    .where(and(eq(enrollment.schoolId, tenant.schoolId), eq(enrollment.sectionId, sectionId), eq(student.status, 'active')))
    .orderBy(asc(enrollment.rollNo), asc(student.firstName));
  // A student who joined the section after the day being marked was not in it that day.
  return rows
    .filter((r) => !onDate || r.enrolledOn <= onDate)
    .map((r) => ({ id: r.id, name: fullName(r), gender: r.gender, rollNo: r.rollNo, birthday: r.dateOfBirth?.slice(5) === onDate?.slice(5) }));
}

async function mayMark(db: DbOrTx, tenant: Tenant, sectionId: string): Promise<boolean> {
  if (can(tenant, 'attendance.mark.all')) return true;
  if (!can(tenant, 'attendance.mark.own')) return false;
  const own = await ownSectionIds(db, tenant);
  return own === null || own.includes(sectionId);
}

async function dayInfo(db: DbOrTx, tenant: Tenant, date: string) {
  const [profile] = await db.select({ workingDays: schoolProfile.workingDays }).from(schoolProfile).where(eq(schoolProfile.schoolId, tenant.schoolId));
  const [h] = await db.select().from(holiday).where(and(eq(holiday.schoolId, tenant.schoolId), eq(holiday.date, date)));
  return { holiday: h ?? null, workingDay: !h && isWorkingDay(date, profile?.workingDays ?? 0b0111111) };
}

attendanceRoutes.get('/attendance/sections', async (c) => {
  const db = c.get('db');
  const t = c.get('tenant');
  requirePermission(t, 'attendance.view', 'attendance.mark.own', 'attendance.mark.all');
  const q = readQuery(c, z.object({ date: isoDate.optional() }));
  const date = q.date ?? todayIST();
  const year = await resolveYear(db, t);
  const own = await ownSectionIds(db, t);

  const sections = await db
    .select({
      id: section.id,
      name: section.name,
      gradeName: grade.name,
      position: grade.position,
      classTeacherId: section.classTeacherId,
      strength: sql<number>`(select count(*)::int from ${enrollment} e join ${student} s on s.id = e.student_id where e.section_id = ${section.id} and s.status = 'active')`,
    })
    .from(section)
    .innerJoin(grade, eq(grade.id, section.gradeId))
    .where(and(eq(section.schoolId, t.schoolId), eq(section.yearId, year.id)))
    .orderBy(asc(grade.position), asc(section.name));
  const registers = await db.select().from(attendanceRegister).where(and(eq(attendanceRegister.schoolId, t.schoolId), eq(attendanceRegister.date, date)));
  const byId = new Map(registers.map((r) => [r.sectionId, r]));
  const markAll = can(t, 'attendance.mark.all');

  return c.json({
    date,
    ...(await dayInfo(db, t, date)),
    sections: sections
      .filter((s) => own === null || own.includes(s.id) || can(t, 'attendance.view'))
      .map((s) => {
        const r = byId.get(s.id);
        return {
          id: s.id,
          label: `${s.gradeName}-${s.name}`,
          strength: Number(s.strength),
          mine: s.classTeacherId !== null && s.classTeacherId === t.staffId,
          canMark: markAll || (own !== null && own.includes(s.id)),
          register: r ? { present: r.present, absent: r.absent, late: r.late, takenByName: r.takenByName, updatedAt: r.updatedAt } : null,
        };
      }),
  });
});

attendanceRoutes.get('/attendance/register', async (c) => {
  const db = c.get('db');
  const t = c.get('tenant');
  const q = readQuery(c, z.object({ sectionId: z.string(), date: isoDate.optional() }));
  const date = q.date ?? todayIST();
  const sec = await getSection(db, t, q.sectionId);
  const canMark = await mayMark(db, t, sec.id);
  if (!canMark && !can(t, 'attendance.view')) throw forbidden();

  const [register] = await db
    .select()
    .from(attendanceRegister)
    .where(and(eq(attendanceRegister.schoolId, t.schoolId), eq(attendanceRegister.sectionId, sec.id), eq(attendanceRegister.date, date)));

  const today = todayIST();
  const editableDate = can(t, 'attendance.mark.all') ? date <= today : date === today;

  return c.json({
    section: { id: sec.id, label: `${sec.gradeName}-${sec.name}` },
    date,
    ...(await dayInfo(db, t, date)),
    roster: await roster(db, t, sec.id, date),
    register: register
      ? { marks: register.marks, takenByName: register.takenByName, createdAt: register.createdAt, updatedAt: register.updatedAt }
      : null,
    canEdit: canMark && editableDate,
    lockedReason: !canMark
      ? 'You can view this register but not mark it.'
      : !editableDate
        ? date > today
          ? 'A register cannot be taken for a day that has not happened yet.'
          : 'Teachers can change today’s register only. Ask the office to correct an earlier day.'
        : null,
  });
});

attendanceRoutes.put('/attendance/register', async (c) => {
  const db = c.get('db');
  const t = c.get('tenant');
  const body = await readBody(c, z.object({ sectionId: z.string(), date: isoDate, marks: z.record(markValue) }));
  const sec = await getSection(db, t, body.sectionId);
  if (!(await mayMark(db, t, sec.id))) throw forbidden('You can only take the register for your own sections.');

  const today = todayIST();
  if (body.date > today) throw invalid('A register cannot be taken for a day that has not happened yet.');
  if (!can(t, 'attendance.mark.all') && body.date !== today) {
    throw forbidden('Teachers can change today’s register only. Ask the office to correct an earlier day.');
  }
  const year = await findCurrentYear(db, t.schoolId);
  if (!year || sec.yearId !== year.id) throw invalid('Registers can only be taken for sections in the current year.');
  if (body.date < year.startsOn || body.date > year.endsOn) throw invalid(`That date is outside ${year.name}.`);

  const students = await roster(db, t, sec.id, body.date);
  if (students.length === 0) throw invalid(`No students were in ${sec.gradeName}-${sec.name} on that date.`);
  const rosterIds = new Set(students.map((s) => s.id));
  const extra = Object.keys(body.marks).filter((id) => !rosterIds.has(id));
  if (extra.length > 0) throw invalid('Some marks are for students who are not in this section.');
  const missing = students.filter((s) => !body.marks[s.id]);
  if (missing.length > 0) throw invalid(`Mark every student before submitting — ${missing.length} still unmarked.`);

  const marks = body.marks as Record<string, Mark>;
  const tally = { present: 0, absent: 0, late: 0 };
  for (const m of Object.values(marks)) {
    if (m === 'P') tally.present += 1;
    else if (m === 'A') tally.absent += 1;
    else tally.late += 1;
  }

  const result = await db.transaction(async (tx) => {
    const [existing] = await tx
      .select()
      .from(attendanceRegister)
      .where(and(eq(attendanceRegister.sectionId, sec.id), eq(attendanceRegister.date, body.date)));

    if (!existing) {
      await tx.insert(attendanceRegister).values({
        schoolId: t.schoolId,
        sectionId: sec.id,
        date: body.date,
        marks,
        ...tally,
        takenBy: t.userId,
        takenByName: t.userName,
      });
      await audit(tx, t, {
        action: 'attendance.taken',
        entityType: 'attendance_register',
        entityId: sec.id,
        summary: `Took ${sec.gradeName}-${sec.name} register for ${body.date}: ${tally.present + tally.late} present, ${tally.absent} absent`,
      });
      return { corrected: 0 };
    }

    // Students who have since moved to another section keep their mark on this day.
    const kept = Object.fromEntries(Object.entries(existing.marks).filter(([id]) => !rosterIds.has(id)));
    const merged = { ...kept, ...marks };
    const full = { present: 0, absent: 0, late: 0 };
    for (const m of Object.values(merged)) {
      if (m === 'P') full.present += 1;
      else if (m === 'A') full.absent += 1;
      else full.late += 1;
    }
    await tx.update(attendanceRegister).set({ marks: merged, ...full }).where(eq(attendanceRegister.id, existing.id));
    // A correction lands on each affected student's own timeline, so it is never silent.
    let corrected = 0;
    for (const s of students) {
      const before = existing.marks[s.id];
      if (before && before !== marks[s.id]) {
        corrected += 1;
        await audit(tx, t, {
          action: 'attendance.corrected',
          entityType: 'attendance_register',
          entityId: existing.id,
          studentId: s.id,
          summary: `Attendance on ${body.date} changed from ${markLabel[before]} to ${markLabel[marks[s.id]]}`,
        });
      }
    }
    if (corrected > 0) {
      await audit(tx, t, {
        action: 'attendance.updated',
        entityType: 'attendance_register',
        entityId: existing.id,
        summary: `Corrected ${sec.gradeName}-${sec.name} register for ${body.date} (${corrected} ${corrected === 1 ? 'mark' : 'marks'})`,
      });
    }
    return { corrected };
  });

  // Absentees with a guardian number, so the office can send a WhatsApp message straight away.
  const absentIds = Object.entries(marks).filter(([, m]) => m === 'A').map(([id]) => id);
  const absentees = absentIds.length ? await guardiansOf(db, t, absentIds) : [];

  return c.json({ ...tally, corrected: result.corrected, absentees });
});

async function guardiansOf(db: DbOrTx, tenant: Tenant, studentIds: string[]) {
  const rows = await db
    .select({
      id: student.id,
      firstName: student.firstName,
      lastName: student.lastName,
      guardianName: guardian.name,
      guardianPhone: guardian.phone,
      isPrimary: studentGuardian.isPrimary,
    })
    .from(student)
    .leftJoin(studentGuardian, eq(studentGuardian.studentId, student.id))
    .leftJoin(guardian, eq(guardian.id, studentGuardian.guardianId))
    .where(and(eq(student.schoolId, tenant.schoolId), inArray(student.id, studentIds)));
  const byStudent = new Map<string, { id: string; name: string; guardianName: string | null; guardianPhone: string | null }>();
  for (const r of rows) {
    const current = byStudent.get(r.id);
    if (!current || r.isPrimary) {
      byStudent.set(r.id, { id: r.id, name: fullName(r), guardianName: r.guardianName, guardianPhone: r.guardianPhone });
    }
  }
  return [...byStudent.values()];
}

/** Every student marked absent on a day, across the sections this person can see. */
attendanceRoutes.get('/attendance/absentees', async (c) => {
  const db = c.get('db');
  const t = c.get('tenant');
  requirePermission(t, 'attendance.view');
  const q = readQuery(c, z.object({ date: isoDate.optional() }));
  const date = q.date ?? todayIST();
  const own = await ownSectionIds(db, t);
  const registers = await db
    .select({ sectionId: attendanceRegister.sectionId, marks: attendanceRegister.marks, gradeName: grade.name, sectionName: section.name })
    .from(attendanceRegister)
    .innerJoin(section, eq(section.id, attendanceRegister.sectionId))
    .innerJoin(grade, eq(grade.id, section.gradeId))
    .where(and(eq(attendanceRegister.schoolId, t.schoolId), eq(attendanceRegister.date, date)));
  const visible = registers.filter((r) => own === null || own.includes(r.sectionId));
  const labelByStudent = new Map<string, string>();
  for (const r of visible) {
    for (const [id, m] of Object.entries(r.marks)) if (m === 'A') labelByStudent.set(id, `${r.gradeName}-${r.sectionName}`);
  }
  const people = labelByStudent.size ? await guardiansOf(db, t, [...labelByStudent.keys()]) : [];
  return c.json(people.map((p) => ({ ...p, classLabel: labelByStudent.get(p.id) ?? null })).sort((a, b) => (a.classLabel ?? '').localeCompare(b.classLabel ?? '', 'en', { numeric: true })));
});

/** A month of one section: students down the side, days across, with totals. */
attendanceRoutes.get('/attendance/month', async (c) => {
  const db = c.get('db');
  const t = c.get('tenant');
  requirePermission(t, 'attendance.view', 'attendance.mark.own', 'attendance.mark.all');
  const q = readQuery(c, z.object({ sectionId: z.string(), month: z.string().regex(/^\d{4}-\d{2}$/) }));
  const sec = await getSection(db, t, q.sectionId);
  const own = await ownSectionIds(db, t);
  if (own !== null && !own.includes(sec.id) && !can(t, 'attendance.view')) throw forbidden();

  const { from, to, days } = monthBounds(q.month);
  const registers = await db
    .select({ date: attendanceRegister.date, marks: attendanceRegister.marks })
    .from(attendanceRegister)
    .where(and(eq(attendanceRegister.schoolId, t.schoolId), eq(attendanceRegister.sectionId, sec.id), between(attendanceRegister.date, from, to)));
  const holidays = await db.select().from(holiday).where(and(eq(holiday.schoolId, t.schoolId), between(holiday.date, from, to)));
  const [profile] = await db.select({ workingDays: schoolProfile.workingDays }).from(schoolProfile).where(eq(schoolProfile.schoolId, t.schoolId));
  const mask = profile?.workingDays ?? 0b0111111;
  const students = await roster(db, t, sec.id);

  const byDate = new Map(registers.map((r) => [r.date, r.marks]));
  return c.json({
    section: { id: sec.id, label: `${sec.gradeName}-${sec.name}` },
    month: q.month,
    days: days.map((d) => ({
      date: d,
      working: isWorkingDay(d, mask) && !holidays.some((h) => h.date === d),
      holiday: holidays.find((h) => h.date === d)?.name ?? null,
      taken: byDate.has(d),
    })),
    students: students.map((s) => {
      const marks: Record<string, Mark> = {};
      let present = 0;
      let absent = 0;
      let late = 0;
      for (const [d, m] of byDate) {
        const mark = m[s.id];
        if (!mark) continue;
        marks[d] = mark;
        if (mark === 'P') present += 1;
        else if (mark === 'A') absent += 1;
        else late += 1;
      }
      const total = present + absent + late;
      return { ...s, marks, present, absent, late, percent: total ? Math.round(((present + late) / total) * 1000) / 10 : null };
    }),
    registersTaken: registers.length,
  });
});

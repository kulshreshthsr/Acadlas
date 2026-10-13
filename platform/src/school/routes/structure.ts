// How the school is organised: class levels, their sections for a year, subjects, who
// teaches what, roll numbers, and moving students up into next year's sections.
import { and, asc, eq, inArray, sql } from 'drizzle-orm';
import { Hono } from 'hono';
import { z } from 'zod';
import {
  enrollment,
  grade,
  gradeSubject,
  section,
  staff,
  student,
  subject,
  teachingAssignment,
} from '../../db/school-schema';
import { conflict, invalid, isoDate, notFound, optionalText, readBody, readQuery, requiredText } from '../../lib/http';
import { todayIST } from '../../lib/dates';
import { syncStudentCharges } from '../fees-engine';
import { getSection, ownSectionIds, resolveYear } from '../queries';
import { audit, requirePermission } from '../tenant';
import type { AppEnv } from '../tenant';

export const structureRoutes = new Hono<AppEnv>();

structureRoutes.get('/structure', async (c) => {
  const db = c.get('db');
  const t = c.get('tenant');
  const q = readQuery(c, z.object({ yearId: z.string().optional() }));
  const year = await resolveYear(db, t, q.yearId);

  const grades = await db.select().from(grade).where(eq(grade.schoolId, t.schoolId)).orderBy(asc(grade.position), asc(grade.name));
  const sections = await db
    .select({
      id: section.id,
      gradeId: section.gradeId,
      name: section.name,
      room: section.room,
      capacity: section.capacity,
      classTeacherId: section.classTeacherId,
      classTeacherName: staff.name,
      strength: sql<number>`(select count(*)::int from ${enrollment} e join ${student} s on s.id = e.student_id where e.section_id = ${section.id} and s.status = 'active')`,
      boys: sql<number>`(select count(*)::int from ${enrollment} e join ${student} s on s.id = e.student_id where e.section_id = ${section.id} and s.status = 'active' and s.gender = 'male')`,
      girls: sql<number>`(select count(*)::int from ${enrollment} e join ${student} s on s.id = e.student_id where e.section_id = ${section.id} and s.status = 'active' and s.gender = 'female')`,
    })
    .from(section)
    .leftJoin(staff, eq(staff.id, section.classTeacherId))
    .where(and(eq(section.schoolId, t.schoolId), eq(section.yearId, year.id)))
    .orderBy(asc(section.name));
  const subjects = await db.select().from(subject).where(eq(subject.schoolId, t.schoolId)).orderBy(asc(subject.name));
  const gradeSubjects = await db.select().from(gradeSubject).where(eq(gradeSubject.schoolId, t.schoolId));
  const assignments = await db
    .select({ sectionId: teachingAssignment.sectionId, subjectId: teachingAssignment.subjectId, staffId: teachingAssignment.staffId })
    .from(teachingAssignment)
    .where(eq(teachingAssignment.schoolId, t.schoolId));
  const people = await db
    .select({ id: staff.id, name: staff.name, designation: staff.designation })
    .from(staff)
    .where(and(eq(staff.schoolId, t.schoolId), eq(staff.status, 'active')))
    .orderBy(asc(staff.name));
  const own = await ownSectionIds(db, t);

  return c.json({
    year,
    grades: grades.map((g) => ({
      ...g,
      subjectIds: gradeSubjects.filter((gs) => gs.gradeId === g.id).map((gs) => gs.subjectId),
      sections: sections
        .filter((s) => s.gradeId === g.id)
        .map((s) => ({
          ...s,
          label: `${g.name}-${s.name}`,
          strength: Number(s.strength),
          boys: Number(s.boys),
          girls: Number(s.girls),
          mine: own === null ? true : own.includes(s.id),
          assignments: assignments.filter((a) => a.sectionId === s.id),
        })),
    })),
    subjects,
    staff: people,
  });
});

// ---- class levels ----

structureRoutes.post('/grades', async (c) => {
  const db = c.get('db');
  const t = c.get('tenant');
  requirePermission(t, 'school.manage');
  const body = await readBody(c, z.object({ name: requiredText('Class name', 30), sections: z.array(requiredText('Section', 10)).max(26).default([]) }));
  const year = await resolveYear(db, t);

  const created = await db.transaction(async (tx) => {
    const [clash] = await tx.select({ id: grade.id }).from(grade).where(and(eq(grade.schoolId, t.schoolId), eq(grade.name, body.name)));
    if (clash) throw conflict(`Class ${body.name} already exists.`);
    const [{ max }] = await tx.select({ max: sql<number>`coalesce(max(${grade.position}), -1)::int` }).from(grade).where(eq(grade.schoolId, t.schoolId));
    const [g] = await tx.insert(grade).values({ schoolId: t.schoolId, name: body.name, position: Number(max) + 1 }).returning();
    const names = [...new Set(body.sections.map((s) => s.toUpperCase()))];
    if (names.length > 0) {
      await tx.insert(section).values(names.map((n) => ({ schoolId: t.schoolId, yearId: year.id, gradeId: g.id, name: n })));
    }
    await audit(tx, t, { action: 'grade.created', entityType: 'grade', entityId: g.id, summary: `Added class ${g.name}` });
    return g;
  });
  return c.json(created, 201);
});

structureRoutes.patch('/grades/:id', async (c) => {
  const db = c.get('db');
  const t = c.get('tenant');
  requirePermission(t, 'school.manage');
  const body = await readBody(c, z.object({ name: requiredText('Class name', 30) }));
  const updated = await db
    .update(grade)
    .set({ name: body.name })
    .where(and(eq(grade.schoolId, t.schoolId), eq(grade.id, c.req.param('id'))))
    .returning();
  if (updated.length === 0) throw notFound('That class');
  return c.json(updated[0]);
});

structureRoutes.post('/grades/reorder', async (c) => {
  const db = c.get('db');
  const t = c.get('tenant');
  requirePermission(t, 'school.manage');
  const body = await readBody(c, z.object({ ids: z.array(z.string()).min(1).max(60) }));
  await db.transaction(async (tx) => {
    for (const [i, id] of body.ids.entries()) {
      await tx.update(grade).set({ position: i }).where(and(eq(grade.schoolId, t.schoolId), eq(grade.id, id)));
    }
  });
  return c.json({ ok: true });
});

structureRoutes.delete('/grades/:id', async (c) => {
  const db = c.get('db');
  const t = c.get('tenant');
  requirePermission(t, 'school.manage');
  const id = c.req.param('id');
  const [used] = await db
    .select({ id: enrollment.id })
    .from(enrollment)
    .innerJoin(section, eq(section.id, enrollment.sectionId))
    .where(and(eq(section.schoolId, t.schoolId), eq(section.gradeId, id)))
    .limit(1);
  if (used) throw conflict('This class has students in it, in this or an earlier year, so it cannot be deleted.');
  const removed = await db.delete(grade).where(and(eq(grade.schoolId, t.schoolId), eq(grade.id, id))).returning();
  if (removed.length === 0) throw notFound('That class');
  await audit(db, t, { action: 'grade.deleted', entityType: 'grade', entityId: id, summary: `Deleted class ${removed[0].name}` });
  return c.json({ ok: true });
});

structureRoutes.put('/grades/:id/subjects', async (c) => {
  const db = c.get('db');
  const t = c.get('tenant');
  requirePermission(t, 'school.manage');
  const id = c.req.param('id');
  const body = await readBody(c, z.object({ subjectIds: z.array(z.string()).max(40) }));
  await db.transaction(async (tx) => {
    const [g] = await tx.select().from(grade).where(and(eq(grade.schoolId, t.schoolId), eq(grade.id, id)));
    if (!g) throw notFound('That class');
    if (body.subjectIds.length > 0) {
      const valid = await tx.select({ id: subject.id }).from(subject).where(and(eq(subject.schoolId, t.schoolId), inArray(subject.id, body.subjectIds)));
      if (valid.length !== new Set(body.subjectIds).size) throw invalid('One of those subjects does not belong to this school.');
    }
    await tx.delete(gradeSubject).where(and(eq(gradeSubject.schoolId, t.schoolId), eq(gradeSubject.gradeId, id)));
    if (body.subjectIds.length > 0) {
      await tx.insert(gradeSubject).values([...new Set(body.subjectIds)].map((sid) => ({ schoolId: t.schoolId, gradeId: id, subjectId: sid })));
    }
  });
  return c.json({ ok: true });
});

// ---- sections ----

const sectionPatch = z.object({
  name: requiredText('Section', 10).optional(),
  room: optionalText,
  capacity: z.number().int().min(1).max(200).optional().nullable(),
  classTeacherId: z.string().optional().nullable(),
});

structureRoutes.post('/sections', async (c) => {
  const db = c.get('db');
  const t = c.get('tenant');
  requirePermission(t, 'school.manage');
  const body = await readBody(c, z.object({ gradeId: z.string(), name: requiredText('Section', 10), yearId: z.string().optional() }));
  const year = await resolveYear(db, t, body.yearId);
  const [g] = await db.select().from(grade).where(and(eq(grade.schoolId, t.schoolId), eq(grade.id, body.gradeId)));
  if (!g) throw notFound('That class');
  const name = body.name.toUpperCase();
  const [clash] = await db
    .select({ id: section.id })
    .from(section)
    .where(and(eq(section.yearId, year.id), eq(section.gradeId, g.id), eq(section.name, name)));
  if (clash) throw conflict(`${g.name}-${name} already exists.`);
  const [created] = await db.insert(section).values({ schoolId: t.schoolId, yearId: year.id, gradeId: g.id, name }).returning();
  await audit(db, t, { action: 'section.created', entityType: 'section', entityId: created.id, summary: `Added section ${g.name}-${name}` });
  return c.json(created, 201);
});

structureRoutes.patch('/sections/:id', async (c) => {
  const db = c.get('db');
  const t = c.get('tenant');
  requirePermission(t, 'school.manage');
  const body = await readBody(c, sectionPatch);
  const current = await getSection(db, t, c.req.param('id'));
  if (body.classTeacherId) {
    const [teacher] = await db.select({ id: staff.id }).from(staff).where(and(eq(staff.schoolId, t.schoolId), eq(staff.id, body.classTeacherId)));
    if (!teacher) throw invalid('That teacher is not on this school’s staff list.');
  }
  const patch: Partial<typeof section.$inferInsert> = {};
  if (body.name !== undefined) patch.name = body.name.toUpperCase();
  if (body.room !== undefined) patch.room = body.room;
  if (body.capacity !== undefined) patch.capacity = body.capacity;
  if (body.classTeacherId !== undefined) patch.classTeacherId = body.classTeacherId;
  await db.update(section).set(patch).where(and(eq(section.schoolId, t.schoolId), eq(section.id, current.id)));
  await audit(db, t, { action: 'section.updated', entityType: 'section', entityId: current.id, summary: `Updated section ${current.gradeName}-${patch.name ?? current.name}` });
  return c.json({ ok: true });
});

structureRoutes.delete('/sections/:id', async (c) => {
  const db = c.get('db');
  const t = c.get('tenant');
  requirePermission(t, 'school.manage');
  const current = await getSection(db, t, c.req.param('id'));
  const [used] = await db.select({ id: enrollment.id }).from(enrollment).where(eq(enrollment.sectionId, current.id)).limit(1);
  if (used) throw conflict('Move the students out of this section before deleting it.');
  await db.delete(section).where(and(eq(section.schoolId, t.schoolId), eq(section.id, current.id)));
  await audit(db, t, { action: 'section.deleted', entityType: 'section', entityId: current.id, summary: `Deleted section ${current.gradeName}-${current.name}` });
  return c.json({ ok: true });
});

structureRoutes.put('/sections/:id/assignments', async (c) => {
  const db = c.get('db');
  const t = c.get('tenant');
  requirePermission(t, 'school.manage');
  const current = await getSection(db, t, c.req.param('id'));
  const body = await readBody(c, z.object({ assignments: z.array(z.object({ subjectId: z.string(), staffId: z.string().nullable() })).max(40) }));

  await db.transaction(async (tx) => {
    const staffIds = body.assignments.map((a) => a.staffId).filter((x): x is string => Boolean(x));
    const subjectIds = body.assignments.map((a) => a.subjectId);
    if (staffIds.length) {
      const ok = await tx.select({ id: staff.id }).from(staff).where(and(eq(staff.schoolId, t.schoolId), inArray(staff.id, staffIds)));
      if (ok.length !== new Set(staffIds).size) throw invalid('One of those teachers is not on this school’s staff list.');
    }
    if (subjectIds.length) {
      const ok = await tx.select({ id: subject.id }).from(subject).where(and(eq(subject.schoolId, t.schoolId), inArray(subject.id, subjectIds)));
      if (ok.length !== new Set(subjectIds).size) throw invalid('One of those subjects does not belong to this school.');
    }
    await tx.delete(teachingAssignment).where(and(eq(teachingAssignment.schoolId, t.schoolId), eq(teachingAssignment.sectionId, current.id)));
    const rows = body.assignments.filter((a) => a.staffId).map((a) => ({ schoolId: t.schoolId, sectionId: current.id, subjectId: a.subjectId, staffId: a.staffId! }));
    if (rows.length) await tx.insert(teachingAssignment).values(rows);
  });
  return c.json({ ok: true });
});

/** Renumbers a section's roll list A to Z, the way most schools assign roll numbers. */
structureRoutes.post('/sections/:id/roll-numbers', async (c) => {
  const db = c.get('db');
  const t = c.get('tenant');
  requirePermission(t, 'students.edit');
  const current = await getSection(db, t, c.req.param('id'));
  const body = await readBody(c, z.object({ order: z.enum(['alphabetical', 'admission']).default('alphabetical') }));

  await db.transaction(async (tx) => {
    const rows = await tx
      .select({ id: enrollment.id, firstName: student.firstName, lastName: student.lastName, admissionNo: student.admissionNo })
      .from(enrollment)
      .innerJoin(student, eq(student.id, enrollment.studentId))
      .where(and(eq(enrollment.schoolId, t.schoolId), eq(enrollment.sectionId, current.id), eq(student.status, 'active')));
    rows.sort((a, b) =>
      body.order === 'admission'
        ? a.admissionNo.localeCompare(b.admissionNo, 'en', { numeric: true })
        : `${a.firstName} ${a.lastName ?? ''}`.localeCompare(`${b.firstName} ${b.lastName ?? ''}`, 'en'),
    );
    for (const [i, row] of rows.entries()) {
      await tx.update(enrollment).set({ rollNo: i + 1 }).where(eq(enrollment.id, row.id));
    }
    await audit(tx, t, {
      action: 'section.renumbered',
      entityType: 'section',
      entityId: current.id,
      summary: `Renumbered ${current.gradeName}-${current.name} roll list (${body.order === 'admission' ? 'by admission number' : 'A to Z'})`,
    });
  });
  return c.json({ ok: true });
});

// ---- subjects ----

structureRoutes.get('/subjects', async (c) => {
  const db = c.get('db');
  const t = c.get('tenant');
  return c.json(await db.select().from(subject).where(eq(subject.schoolId, t.schoolId)).orderBy(asc(subject.name)));
});

structureRoutes.post('/subjects', async (c) => {
  const db = c.get('db');
  const t = c.get('tenant');
  requirePermission(t, 'school.manage');
  const body = await readBody(c, z.object({ name: requiredText('Subject', 60), code: optionalText }));
  const [clash] = await db.select({ id: subject.id }).from(subject).where(and(eq(subject.schoolId, t.schoolId), eq(subject.name, body.name)));
  if (clash) throw conflict(`${body.name} is already a subject.`);
  const [created] = await db.insert(subject).values({ schoolId: t.schoolId, ...body }).returning();
  return c.json(created, 201);
});

structureRoutes.patch('/subjects/:id', async (c) => {
  const db = c.get('db');
  const t = c.get('tenant');
  requirePermission(t, 'school.manage');
  const body = await readBody(c, z.object({ name: requiredText('Subject', 60), code: optionalText }));
  const updated = await db.update(subject).set(body).where(and(eq(subject.schoolId, t.schoolId), eq(subject.id, c.req.param('id')))).returning();
  if (updated.length === 0) throw notFound('That subject');
  return c.json(updated[0]);
});

structureRoutes.delete('/subjects/:id', async (c) => {
  const db = c.get('db');
  const t = c.get('tenant');
  requirePermission(t, 'school.manage');
  const removed = await db.delete(subject).where(and(eq(subject.schoolId, t.schoolId), eq(subject.id, c.req.param('id')))).returning();
  if (removed.length === 0) throw notFound('That subject');
  return c.json({ ok: true });
});

// ---- moving up a year ----

/**
 * Moves students from a section in one year into a section of the next. Students who
 * already have a place in the target year are left where they are, so running it twice
 * is harmless. `graduate` instead marks them as having passed out (Class 12, say).
 */
structureRoutes.post('/promotions', async (c) => {
  const db = c.get('db');
  const t = c.get('tenant');
  requirePermission(t, 'students.edit');
  const body = await readBody(
    c,
    z.object({
      fromSectionId: z.string(),
      toSectionId: z.string().optional().nullable(),
      studentIds: z.array(z.string()).min(1).max(200),
      graduate: z.boolean().default(false),
      date: isoDate.optional(),
    }),
  );
  const from = await getSection(db, t, body.fromSectionId);
  const date = body.date ?? todayIST();

  const result = await db.transaction(async (tx) => {
    const members = await tx
      .select({ studentId: enrollment.studentId })
      .from(enrollment)
      .where(and(eq(enrollment.schoolId, t.schoolId), eq(enrollment.sectionId, from.id), inArray(enrollment.studentId, body.studentIds)));
    if (members.length !== new Set(body.studentIds).size) throw invalid('Some of those students are not in this section.');

    if (body.graduate) {
      await tx
        .update(student)
        .set({ status: 'graduated', leftOn: date, leftReason: `Passed out of ${from.gradeName}` })
        .where(and(eq(student.schoolId, t.schoolId), inArray(student.id, body.studentIds)));
      for (const id of body.studentIds) {
        await audit(tx, t, { action: 'student.graduated', entityType: 'student', entityId: id, studentId: id, summary: `Passed out of ${from.gradeName}-${from.name}` });
      }
      return { moved: 0, graduated: body.studentIds.length, skipped: 0 };
    }

    if (!body.toSectionId) throw invalid('Choose the section to move them into.');
    const to = await getSection(tx, t, body.toSectionId);
    if (to.yearId === from.yearId) throw invalid('To move students within the same year, use “Move section” on their record.');

    const already = await tx
      .select({ studentId: enrollment.studentId })
      .from(enrollment)
      .where(and(eq(enrollment.yearId, to.yearId), inArray(enrollment.studentId, body.studentIds)));
    const skip = new Set(already.map((a) => a.studentId));
    const [{ max }] = await tx
      .select({ max: sql<number>`coalesce(max(${enrollment.rollNo}), 0)::int` })
      .from(enrollment)
      .where(eq(enrollment.sectionId, to.id));

    let roll = Number(max);
    const toMove = body.studentIds.filter((id) => !skip.has(id));
    if (toMove.length > 0) {
      await tx.insert(enrollment).values(
        toMove.map((studentId) => ({ schoolId: t.schoolId, studentId, yearId: to.yearId, sectionId: to.id, rollNo: ++roll, enrolledOn: date })),
      );
      for (const id of toMove) {
        await audit(tx, t, {
          action: 'student.promoted',
          entityType: 'student',
          entityId: id,
          studentId: id,
          summary: `Promoted from ${from.gradeName}-${from.name} to ${to.gradeName}-${to.name}`,
        });
        await syncStudentCharges(tx, t, id, to.yearId);
      }
    }
    return { moved: toMove.length, graduated: 0, skipped: skip.size };
  });

  return c.json(result);
});

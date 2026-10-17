// Students and their guardians: admission, the student record, moving section, leaving,
// bulk import from a spreadsheet, and a full export of one student's data on request.
import { and, asc, count, desc, eq, ilike, inArray, ne, or, sql } from 'drizzle-orm';
import { Hono } from 'hono';
import { z } from 'zod';
import type { DbOrTx } from '../../db';
import {
  academicYear,
  attendanceRegister,
  auditEvent,
  enrollment,
  feeConcession,
  grade,
  guardian,
  payment,
  paymentAllocation,
  schoolProfile,
  section,
  student,
  studentGuardian,
} from '../../db/school-schema';
import { todayIST } from '../../lib/dates';
import { conflict, email, forbidden, invalid, isoDate, notFound, optionalText, parse, phone, readBody, readQuery, requiredText } from '../../lib/http';
import { endAccess, signOutIfNoAccessLeft } from '../../parent/access';
import { studentCharges, syncStudentCharges } from '../fees-engine';
import { assertCanViewStudent, findCurrentYear, getSection, getStudent, ownSectionIds, resolveYear } from '../queries';
import { audit, can, nextNumber, requirePermission } from '../tenant';
import type { AppEnv, Tenant } from '../tenant';

export const studentRoutes = new Hono<AppEnv>();

const relation = z.enum(['father', 'mother', 'guardian', 'other']);

const studentFields = z.object({
  firstName: requiredText('First name', 60),
  lastName: optionalText,
  gender: z.enum(['female', 'male', 'other']).optional().nullable(),
  dateOfBirth: isoDate
    .optional()
    .nullable()
    .refine((d) => !d || d <= todayIST(), 'Date of birth cannot be in the future.'),
  bloodGroup: optionalText,
  apaarId: optionalText,
  pen: optionalText,
  category: optionalText,
  isRte: z.boolean().default(false),
  address: optionalText,
  previousSchool: optionalText,
  notes: z.string().trim().max(2000).optional().nullable(),
});

const guardianFields = z.object({
  name: requiredText('Guardian name', 80),
  phone: phone,
  altPhone: phone,
  email: email,
  occupation: optionalText,
  address: optionalText,
});

const guardianLink = z.union([
  z.object({ existingId: z.string(), relation, isPrimary: z.boolean().default(false) }),
  guardianFields.extend({ relation, isPrimary: z.boolean().default(false) }),
]);

const admissionShape = z.object({
  student: studentFields.extend({ admittedOn: isoDate.optional() }),
  guardians: z.array(guardianLink).min(1, 'Add at least one guardian.').max(4),
  sectionId: z.string({ required_error: 'Choose a class and section.' }),
  admissionNo: z.string().trim().max(40).optional().nullable(),
  consentMethod: z.enum(['paper', 'digital', 'verbal']).nullable(),
});

export function fullName(s: { firstName: string; lastName: string | null }) {
  return [s.firstName, s.lastName].filter(Boolean).join(' ');
}

async function makeAdmissionNo(db: DbOrTx, tenant: Tenant, yearStartsOn: string): Promise<string> {
  const [profile] = await db.select({ prefix: schoolProfile.admissionPrefix }).from(schoolProfile).where(eq(schoolProfile.schoolId, tenant.schoolId));
  const yearPart = yearStartsOn.slice(0, 4);
  // Imports can bring in admission numbers that collide with the sequence, so skip past them.
  for (let attempt = 0; attempt < 50; attempt += 1) {
    const n = await nextNumber(db, tenant.schoolId, `admission:${yearPart}`);
    const candidate = `${profile?.prefix ?? 'ADM'}/${yearPart}/${String(n).padStart(4, '0')}`;
    const [taken] = await db.select({ id: student.id }).from(student).where(and(eq(student.schoolId, tenant.schoolId), eq(student.admissionNo, candidate)));
    if (!taken) return candidate;
  }
  throw conflict('Could not find a free admission number. Enter one by hand.');
}

async function nextRollNo(db: DbOrTx, sectionId: string): Promise<number> {
  const [{ max }] = await db.select({ max: sql<number>`coalesce(max(${enrollment.rollNo}), 0)::int` }).from(enrollment).where(eq(enrollment.sectionId, sectionId));
  return Number(max) + 1;
}

/** Links (or creates and links) each guardian. A guardian found by id must belong to this school. */
async function attachGuardians(db: DbOrTx, tenant: Tenant, studentId: string, links: z.infer<typeof guardianLink>[]) {
  const hasPrimary = links.some((l) => l.isPrimary);
  for (const [i, link] of links.entries()) {
    let guardianId: string;
    if ('existingId' in link) {
      const [g] = await db.select({ id: guardian.id }).from(guardian).where(and(eq(guardian.schoolId, tenant.schoolId), eq(guardian.id, link.existingId)));
      if (!g) throw notFound('That guardian');
      guardianId = g.id;
    } else {
      const { relation: _r, isPrimary: _p, ...fields } = link;
      // The same person entered again — same phone and same name — is the same guardian, which
      // is what puts brothers and sisters in one family. A phone on its own is not enough: a
      // mother and father often share one number.
      const [known] = fields.phone
        ? await db
            .select({ id: guardian.id })
            .from(guardian)
            .where(and(eq(guardian.schoolId, tenant.schoolId), eq(guardian.phone, fields.phone), sql`lower(${guardian.name}) = lower(${fields.name})`))
            .limit(1)
        : [];
      if (known) guardianId = known.id;
      else {
        const [g] = await db.insert(guardian).values({ schoolId: tenant.schoolId, ...fields }).returning({ id: guardian.id });
        guardianId = g.id;
      }
    }
    await db
      .insert(studentGuardian)
      .values({ schoolId: tenant.schoolId, studentId, guardianId, relation: link.relation, isPrimary: hasPrimary ? link.isPrimary : i === 0 })
      .onConflictDoNothing();
  }
}

// ---------------------------------------------------------------------------
// List
// ---------------------------------------------------------------------------

studentRoutes.get('/students', async (c) => {
  const db = c.get('db');
  const t = c.get('tenant');
  requirePermission(t, 'students.view.all', 'students.view.own');
  const q = readQuery(
    c,
    z.object({
      q: z.string().trim().max(80).optional(),
      sectionId: z.string().optional(),
      gradeId: z.string().optional(),
      status: z.enum(['active', 'withdrawn', 'graduated', 'all']).default('active'),
      yearId: z.string().optional(),
      page: z.coerce.number().int().min(1).default(1),
      pageSize: z.coerce.number().int().min(10).max(500).default(50),
    }),
  );
  const year = await resolveYear(db, t, q.yearId);
  const own = await ownSectionIds(db, t);

  const filters = [eq(student.schoolId, t.schoolId)];
  if (q.status !== 'all') filters.push(eq(student.status, q.status));
  if (q.sectionId) filters.push(eq(enrollment.sectionId, q.sectionId));
  if (q.gradeId) filters.push(eq(section.gradeId, q.gradeId));
  if (own !== null) filters.push(own.length ? inArray(enrollment.sectionId, own) : sql`false`);
  if (q.q) {
    const like = `%${q.q.replace(/[%_]/g, '')}%`;
    const digits = q.q.replace(/\D/g, '');
    filters.push(
      or(
        ilike(sql`${student.firstName} || ' ' || coalesce(${student.lastName}, '')`, like),
        ilike(student.admissionNo, like),
        digits.length >= 4
          ? sql`exists (select 1 from ${studentGuardian} sg join ${guardian} g on g.id = sg.guardian_id where sg.student_id = ${student.id} and g.phone like ${`%${digits}%`})`
          : sql`false`,
      )!,
    );
  }

  const where = and(...filters);
  const base = db
    .select({
      id: student.id,
      admissionNo: student.admissionNo,
      firstName: student.firstName,
      lastName: student.lastName,
      gender: student.gender,
      dateOfBirth: student.dateOfBirth,
      status: student.status,
      isRte: student.isRte,
      consentRecordedAt: student.consentRecordedAt,
      sectionId: section.id,
      sectionName: section.name,
      gradeName: grade.name,
      gradePosition: grade.position,
      rollNo: enrollment.rollNo,
      guardianName: sql<string | null>`(select g.name from ${studentGuardian} sg join ${guardian} g on g.id = sg.guardian_id where sg.student_id = ${student.id} order by sg.is_primary desc limit 1)`,
      guardianPhone: sql<string | null>`(select g.phone from ${studentGuardian} sg join ${guardian} g on g.id = sg.guardian_id where sg.student_id = ${student.id} order by sg.is_primary desc limit 1)`,
    })
    .from(student)
    .leftJoin(enrollment, and(eq(enrollment.studentId, student.id), eq(enrollment.yearId, year.id)))
    .leftJoin(section, eq(section.id, enrollment.sectionId))
    .leftJoin(grade, eq(grade.id, section.gradeId))
    .where(where);

  const rows = await base
    .orderBy(asc(grade.position), asc(section.name), asc(enrollment.rollNo), asc(student.firstName))
    .limit(q.pageSize)
    .offset((q.page - 1) * q.pageSize);

  const [{ total }] = await db
    .select({ total: count() })
    .from(student)
    .leftJoin(enrollment, and(eq(enrollment.studentId, student.id), eq(enrollment.yearId, year.id)))
    .leftJoin(section, eq(section.id, enrollment.sectionId))
    .where(where);

  return c.json({
    total: Number(total),
    page: q.page,
    pageSize: q.pageSize,
    rows: rows.map((r) => ({
      ...r,
      name: fullName(r),
      classLabel: r.gradeName ? `${r.gradeName}-${r.sectionName}` : null,
    })),
  });
});

// ---------------------------------------------------------------------------
// Admission
// ---------------------------------------------------------------------------

studentRoutes.post('/students', async (c) => {
  const db = c.get('db');
  const t = c.get('tenant');
  requirePermission(t, 'students.edit');
  const body = await readBody(c, admissionShape);
  const sec = await getSection(db, t, body.sectionId);
  const [year] = await db.select().from(academicYear).where(eq(academicYear.id, sec.yearId));

  const created = await db.transaction(async (tx) => {
    let admissionNo = body.admissionNo?.trim() || null;
    if (admissionNo) {
      const [taken] = await tx.select({ id: student.id }).from(student).where(and(eq(student.schoolId, t.schoolId), eq(student.admissionNo, admissionNo)));
      if (taken) throw invalid(`Admission number ${admissionNo} is already used.`, { admissionNo: 'Already used by another student.' });
    } else {
      admissionNo = await makeAdmissionNo(tx, t, year.startsOn);
    }

    const { admittedOn, ...fields } = body.student;
    const [s] = await tx
      .insert(student)
      .values({
        schoolId: t.schoolId,
        ...fields,
        admissionNo,
        admittedOn: admittedOn ?? todayIST(),
        consentMethod: body.consentMethod,
        consentRecordedAt: body.consentMethod ? new Date() : null,
        consentRecordedBy: body.consentMethod ? t.userId : null,
      })
      .returning();

    await attachGuardians(tx, t, s.id, body.guardians);
    const rollNo = await nextRollNo(tx, sec.id);
    await tx.insert(enrollment).values({ schoolId: t.schoolId, studentId: s.id, yearId: sec.yearId, sectionId: sec.id, rollNo, enrolledOn: s.admittedOn });
    await syncStudentCharges(tx, t, s.id, sec.yearId);

    await audit(tx, t, {
      action: 'student.admitted',
      entityType: 'student',
      entityId: s.id,
      studentId: s.id,
      summary: `Admitted ${fullName(s)} to ${sec.gradeName}-${sec.name} (${admissionNo})`,
    });
    return { ...s, rollNo, classLabel: `${sec.gradeName}-${sec.name}` };
  });

  return c.json(created, 201);
});

// ---------------------------------------------------------------------------
// The record
// ---------------------------------------------------------------------------

studentRoutes.get('/students/:id', async (c) => {
  const db = c.get('db');
  const t = c.get('tenant');
  const id = c.req.param('id');
  const s = await getStudent(db, t, id);
  const year = await findCurrentYear(db, t.schoolId);
  await assertCanViewStudent(db, t, id, year?.id ?? null);

  const guardians = await db
    .select({ guardian, relation: studentGuardian.relation, isPrimary: studentGuardian.isPrimary })
    .from(studentGuardian)
    .innerJoin(guardian, eq(guardian.id, studentGuardian.guardianId))
    .where(and(eq(studentGuardian.schoolId, t.schoolId), eq(studentGuardian.studentId, id)))
    .orderBy(desc(studentGuardian.isPrimary));

  // Brothers and sisters: other students who share a guardian.
  const guardianIds = guardians.map((g) => g.guardian.id);
  const siblings = guardianIds.length
    ? await db
        .selectDistinct({ id: student.id, firstName: student.firstName, lastName: student.lastName, status: student.status, gradeName: grade.name, sectionName: section.name })
        .from(studentGuardian)
        .innerJoin(student, eq(student.id, studentGuardian.studentId))
        .leftJoin(enrollment, year ? and(eq(enrollment.studentId, student.id), eq(enrollment.yearId, year.id)) : sql`false`)
        .leftJoin(section, eq(section.id, enrollment.sectionId))
        .leftJoin(grade, eq(grade.id, section.gradeId))
        .where(and(eq(studentGuardian.schoolId, t.schoolId), inArray(studentGuardian.guardianId, guardianIds), ne(student.id, id)))
    : [];

  const history = await db
    .select({
      yearId: enrollment.yearId,
      yearName: academicYear.name,
      sectionId: section.id,
      gradeId: grade.id,
      label: sql<string>`${grade.name} || '-' || ${section.name}`,
      rollNo: enrollment.rollNo,
      enrolledOn: enrollment.enrolledOn,
      isCurrent: academicYear.isCurrent,
    })
    .from(enrollment)
    .innerJoin(section, eq(section.id, enrollment.sectionId))
    .innerJoin(grade, eq(grade.id, section.gradeId))
    .innerJoin(academicYear, eq(academicYear.id, enrollment.yearId))
    .where(and(eq(enrollment.schoolId, t.schoolId), eq(enrollment.studentId, id)))
    .orderBy(desc(academicYear.startsOn));
  const current = history.find((h) => h.yearId === year?.id) ?? null;

  // Attendance this year, from every register that holds a mark for this student.
  let attendance = null;
  if (year) {
    const marks = await db
      .select({ date: attendanceRegister.date, mark: sql<string>`${attendanceRegister.marks} ->> ${id}` })
      .from(attendanceRegister)
      .where(
        and(
          eq(attendanceRegister.schoolId, t.schoolId),
          sql`${attendanceRegister.marks} ? ${id}`,
          sql`${attendanceRegister.date} between ${year.startsOn} and ${year.endsOn}`,
        ),
      )
      .orderBy(desc(attendanceRegister.date));
    const present = marks.filter((m) => m.mark === 'P').length;
    const late = marks.filter((m) => m.mark === 'L').length;
    const absent = marks.filter((m) => m.mark === 'A').length;
    const total = marks.length;
    attendance = {
      present,
      late,
      absent,
      total,
      percent: total ? Math.round(((present + late) / total) * 1000) / 10 : null,
      recent: marks.slice(0, 42).map((m) => ({ date: m.date, mark: m.mark })),
    };
  }

  let fees = null;
  if (can(t, 'fees.view') && year) {
    const charges = await studentCharges(db, t.schoolId, id, year.id);
    const today = todayIST();
    fees = {
      net: charges.reduce((sum, ch) => sum + ch.net, 0),
      paid: charges.reduce((sum, ch) => sum + ch.paid, 0),
      balance: charges.reduce((sum, ch) => sum + ch.balance, 0),
      overdue: charges.filter((ch) => ch.dueOn < today).reduce((sum, ch) => sum + ch.balance, 0),
      nextDue: charges.find((ch) => ch.balance > 0) ?? null,
    };
  }

  const timeline = await db
    .select({ id: auditEvent.id, action: auditEvent.action, summary: auditEvent.summary, actorName: auditEvent.actorName, createdAt: auditEvent.createdAt })
    .from(auditEvent)
    .where(and(eq(auditEvent.schoolId, t.schoolId), eq(auditEvent.studentId, id)))
    .orderBy(desc(auditEvent.createdAt))
    .limit(60);

  return c.json({
    student: { ...s, name: fullName(s) },
    guardians: guardians.map((g) => ({ ...g.guardian, relation: g.relation, isPrimary: g.isPrimary })),
    siblings: siblings.map((sib) => ({ id: sib.id, name: fullName(sib), status: sib.status, classLabel: sib.gradeName ? `${sib.gradeName}-${sib.sectionName}` : null })),
    current,
    history,
    attendance,
    fees,
    timeline,
    can: {
      edit: can(t, 'students.edit'),
      fees: can(t, 'fees.view'),
      collect: can(t, 'fees.collect'),
      manageFees: can(t, 'fees.manage'),
    },
  });
});

/**
 * The student's family, worked out from the guardians they share: everyone who has a
 * guardian in common, the student included, eldest first. `birthOrder` is the place in that
 * line (1 = eldest), which is what a sibling discount usually goes by. With fee access each
 * child also carries what they owe in all, so a discount can be decided with the figures in view.
 */
studentRoutes.get('/students/:id/siblings', async (c) => {
  const db = c.get('db');
  const t = c.get('tenant');
  const id = c.req.param('id');
  await getStudent(db, t, id);
  const year = await findCurrentYear(db, t.schoolId);
  await assertCanViewStudent(db, t, id, year?.id ?? null);

  const guardians = await db
    .select({ id: guardian.id, name: guardian.name, phone: guardian.phone, relation: studentGuardian.relation, isPrimary: studentGuardian.isPrimary })
    .from(studentGuardian)
    .innerJoin(guardian, eq(guardian.id, studentGuardian.guardianId))
    .where(and(eq(studentGuardian.schoolId, t.schoolId), eq(studentGuardian.studentId, id)))
    .orderBy(desc(studentGuardian.isPrimary));
  const guardianIds = guardians.map((g) => g.id);

  const members = guardianIds.length
    ? await db
        .selectDistinct({
          id: student.id,
          firstName: student.firstName,
          lastName: student.lastName,
          status: student.status,
          dateOfBirth: student.dateOfBirth,
          createdAt: student.createdAt,
          isRte: student.isRte,
          gradeName: grade.name,
          sectionName: section.name,
        })
        .from(studentGuardian)
        .innerJoin(student, eq(student.id, studentGuardian.studentId))
        .leftJoin(enrollment, year ? and(eq(enrollment.studentId, student.id), eq(enrollment.yearId, year.id)) : sql`false`)
        .leftJoin(section, eq(section.id, enrollment.sectionId))
        .leftJoin(grade, eq(grade.id, section.gradeId))
        .where(and(eq(studentGuardian.schoolId, t.schoolId), inArray(studentGuardian.guardianId, guardianIds)))
    : [];

  // Eldest first; a missing date of birth goes last, in the order they were admitted.
  members.sort((a, b) => (a.dateOfBirth ?? '9999').localeCompare(b.dateOfBirth ?? '9999') || a.createdAt.getTime() - b.createdAt.getTime());

  const withFees = can(t, 'fees.view');
  const family = await Promise.all(
    members.map(async (m, i) => ({
      id: m.id,
      name: fullName(m),
      status: m.status,
      classLabel: m.gradeName ? `${m.gradeName}-${m.sectionName}` : null,
      dateOfBirth: m.dateOfBirth,
      birthOrder: i + 1,
      isSelf: m.id === id,
      isRte: m.isRte,
      balance: withFees ? (await studentCharges(db, t.schoolId, m.id)).reduce((sum, ch) => sum + ch.balance, 0) : null,
    })),
  );
  return c.json({ guardians, family });
});

studentRoutes.patch('/students/:id', async (c) => {
  const db = c.get('db');
  const t = c.get('tenant');
  requirePermission(t, 'students.edit');
  const id = c.req.param('id');
  const before = await getStudent(db, t, id);
  const body = await readBody(c, studentFields.partial().extend({ admissionNo: z.string().trim().min(1).max(40).optional(), admittedOn: isoDate.optional() }));

  await db.transaction(async (tx) => {
    if (body.admissionNo && body.admissionNo !== before.admissionNo) {
      const [taken] = await tx.select({ id: student.id }).from(student).where(and(eq(student.schoolId, t.schoolId), eq(student.admissionNo, body.admissionNo)));
      if (taken) throw invalid(`Admission number ${body.admissionNo} is already used.`, { admissionNo: 'Already used by another student.' });
    }
    await tx.update(student).set(body).where(and(eq(student.schoolId, t.schoolId), eq(student.id, id)));

    const changed = Object.keys(body).filter((k) => (body as Record<string, unknown>)[k] !== (before as Record<string, unknown>)[k]);
    if (changed.length > 0) {
      const beforeData = Object.fromEntries(changed.map((k) => [k, (before as Record<string, unknown>)[k]]));
      const afterData = Object.fromEntries(changed.map((k) => [k, (body as Record<string, unknown>)[k]]));
      await audit(tx, t, {
        action: 'student.updated',
        entityType: 'student',
        entityId: id,
        studentId: id,
        summary: `Edited ${changed.length === 1 ? labelFor(changed[0]) : `${changed.length} details`}`,
        data: { before: beforeData, after: afterData },
      });
    }
    if ('isRte' in body && body.isRte !== before.isRte) {
      const year = await findCurrentYear(tx, t.schoolId);
      if (year) await syncStudentCharges(tx, t, id, year.id);
    }
  });
  return c.json({ ok: true });
});

function labelFor(field: string): string {
  const labels: Record<string, string> = {
    firstName: 'first name', lastName: 'last name', dateOfBirth: 'date of birth', admissionNo: 'admission number',
    apaarId: 'APAAR ID', pen: 'PEN', isRte: 'RTE status', bloodGroup: 'blood group', previousSchool: 'previous school',
  };
  return labels[field] ?? field;
}

studentRoutes.post('/students/:id/consent', async (c) => {
  const db = c.get('db');
  const t = c.get('tenant');
  requirePermission(t, 'students.edit');
  const id = c.req.param('id');
  await getStudent(db, t, id);
  const body = await readBody(c, z.object({ method: z.enum(['paper', 'digital', 'verbal']) }));
  await db
    .update(student)
    .set({ consentMethod: body.method, consentRecordedAt: new Date(), consentRecordedBy: t.userId })
    .where(and(eq(student.schoolId, t.schoolId), eq(student.id, id)));
  await audit(db, t, { action: 'student.consent', entityType: 'student', entityId: id, studentId: id, summary: `Recorded guardian consent (${body.method})` });
  return c.json({ ok: true });
});

studentRoutes.post('/students/:id/move', async (c) => {
  const db = c.get('db');
  const t = c.get('tenant');
  requirePermission(t, 'students.edit');
  const id = c.req.param('id');
  const s = await getStudent(db, t, id);
  const body = await readBody(c, z.object({ sectionId: z.string() }));
  const to = await getSection(db, t, body.sectionId);

  await db.transaction(async (tx) => {
    const [current] = await tx
      .select({ id: enrollment.id, sectionId: enrollment.sectionId })
      .from(enrollment)
      .where(and(eq(enrollment.schoolId, t.schoolId), eq(enrollment.studentId, id), eq(enrollment.yearId, to.yearId)));
    const rollNo = await nextRollNo(tx, to.id);
    let fromLabel = 'no section';
    if (current) {
      if (current.sectionId === to.id) throw invalid(`${fullName(s)} is already in ${to.gradeName}-${to.name}.`);
      const from = await getSection(tx, t, current.sectionId);
      fromLabel = `${from.gradeName}-${from.name}`;
      await tx.update(enrollment).set({ sectionId: to.id, rollNo }).where(eq(enrollment.id, current.id));
    } else {
      await tx.insert(enrollment).values({ schoolId: t.schoolId, studentId: id, yearId: to.yearId, sectionId: to.id, rollNo, enrolledOn: todayIST() });
    }
    await syncStudentCharges(tx, t, id, to.yearId);
    await audit(tx, t, { action: 'student.moved', entityType: 'student', entityId: id, studentId: id, summary: `Moved from ${fromLabel} to ${to.gradeName}-${to.name}` });
  });
  return c.json({ ok: true });
});

studentRoutes.post('/students/:id/withdraw', async (c) => {
  const db = c.get('db');
  const t = c.get('tenant');
  requirePermission(t, 'students.edit');
  const id = c.req.param('id');
  const s = await getStudent(db, t, id);
  if (s.status !== 'active') throw conflict(`${fullName(s)} has already left the school.`);
  const body = await readBody(c, z.object({ date: isoDate, reason: requiredText('Reason', 300) }));
  await db.transaction(async (tx) => {
    await tx.update(student).set({ status: 'withdrawn', leftOn: body.date, leftReason: body.reason }).where(and(eq(student.schoolId, t.schoolId), eq(student.id, id)));
    await audit(tx, t, { action: 'student.withdrawn', entityType: 'student', entityId: id, studentId: id, summary: `Left the school: ${body.reason}` });
  });
  return c.json({ ok: true });
});

studentRoutes.post('/students/:id/reinstate', async (c) => {
  const db = c.get('db');
  const t = c.get('tenant');
  requirePermission(t, 'students.edit');
  const id = c.req.param('id');
  const s = await getStudent(db, t, id);
  if (s.status === 'active') throw conflict(`${fullName(s)} is already active.`);
  await db.transaction(async (tx) => {
    await tx.update(student).set({ status: 'active', leftOn: null, leftReason: null }).where(and(eq(student.schoolId, t.schoolId), eq(student.id, id)));
    await audit(tx, t, { action: 'student.reinstated', entityType: 'student', entityId: id, studentId: id, summary: 'Rejoined the school' });
  });
  return c.json({ ok: true });
});

// ---------------------------------------------------------------------------
// Guardians
// ---------------------------------------------------------------------------

/** Finds guardians already on file by phone, so a sibling's admission links to the same family. */
studentRoutes.get('/guardians/lookup', async (c) => {
  const db = c.get('db');
  const t = c.get('tenant');
  requirePermission(t, 'students.edit');
  const { phone: raw } = parse(z.object({ phone: z.string().min(4) }), c.req.query());
  const digits = raw.replace(/\D/g, '').replace(/^(91|0)(?=\d{10}$)/, '');
  if (digits.length < 10) return c.json([]);
  const rows = await db.select().from(guardian).where(and(eq(guardian.schoolId, t.schoolId), eq(guardian.phone, digits))).limit(5);
  const year = await findCurrentYear(db, t.schoolId);
  const result = [];
  for (const g of rows) {
    const children = await db
      .select({ id: student.id, firstName: student.firstName, lastName: student.lastName, gradeName: grade.name, sectionName: section.name })
      .from(studentGuardian)
      .innerJoin(student, eq(student.id, studentGuardian.studentId))
      .leftJoin(enrollment, year ? and(eq(enrollment.studentId, student.id), eq(enrollment.yearId, year.id)) : sql`false`)
      .leftJoin(section, eq(section.id, enrollment.sectionId))
      .leftJoin(grade, eq(grade.id, section.gradeId))
      .where(eq(studentGuardian.guardianId, g.id));
    result.push({ ...g, children: children.map((ch) => ({ id: ch.id, name: fullName(ch), classLabel: ch.gradeName ? `${ch.gradeName}-${ch.sectionName}` : null })) });
  }
  return c.json(result);
});

studentRoutes.post('/students/:id/guardians', async (c) => {
  const db = c.get('db');
  const t = c.get('tenant');
  requirePermission(t, 'students.edit');
  const id = c.req.param('id');
  await getStudent(db, t, id);
  const body = await readBody(c, guardianLink);
  await db.transaction(async (tx) => {
    if (body.isPrimary) {
      await tx.update(studentGuardian).set({ isPrimary: false }).where(and(eq(studentGuardian.schoolId, t.schoolId), eq(studentGuardian.studentId, id)));
    }
    await attachGuardians(tx, t, id, [{ ...body, isPrimary: body.isPrimary }]);
    await audit(tx, t, { action: 'guardian.added', entityType: 'student', entityId: id, studentId: id, summary: 'Added a guardian' });
  });
  return c.json({ ok: true }, 201);
});

studentRoutes.patch('/guardians/:id', async (c) => {
  const db = c.get('db');
  const t = c.get('tenant');
  requirePermission(t, 'students.edit');
  const id = c.req.param('id');
  const body = await readBody(c, guardianFields.partial());
  const [before] = await db.select().from(guardian).where(and(eq(guardian.schoolId, t.schoolId), eq(guardian.id, id)));
  if (!before) throw notFound('That guardian');
  const phoneChanged = body.phone !== undefined && body.phone !== before.phone;
  const ended = await db.transaction(async (tx) => {
    await tx.update(guardian).set(body).where(and(eq(guardian.schoolId, t.schoolId), eq(guardian.id, id)));
    // The parent app login is the old number. Whoever has that number now must not keep
    // seeing this family: access ends, and the school sends a new link to the new number.
    const access = phoneChanged ? await endAccess(tx, t.schoolId, id, t.userName) : { ended: false, userId: null };
    // The change shows on every child of this guardian — that is the point of one record.
    const kids = await tx.select({ studentId: studentGuardian.studentId }).from(studentGuardian).where(eq(studentGuardian.guardianId, id));
    for (const k of kids) {
      await audit(tx, t, {
        action: 'guardian.updated',
        entityType: 'guardian',
        entityId: id,
        studentId: k.studentId,
        summary: body.phone && body.phone !== before.phone ? `Updated ${before.name}'s phone number` : `Updated ${before.name}'s details`,
        data: { before: { phone: before.phone, email: before.email }, after: { phone: body.phone, email: body.email } },
      });
    }
    if (access.ended) {
      await audit(tx, t, {
        action: 'parents.revoked',
        entityType: 'guardian',
        entityId: id,
        summary: `Ended ${before.name}'s parent app access because their phone number changed`,
      });
    }
    return access;
  });
  await signOutIfNoAccessLeft(db, c.get('auth'), ended.userId);
  return c.json({ ok: true, parentAccessEnded: ended.ended });
});

studentRoutes.post('/students/:id/guardians/:guardianId/primary', async (c) => {
  const db = c.get('db');
  const t = c.get('tenant');
  requirePermission(t, 'students.edit');
  const id = c.req.param('id');
  const guardianId = c.req.param('guardianId');
  await db.transaction(async (tx) => {
    await tx.update(studentGuardian).set({ isPrimary: false }).where(and(eq(studentGuardian.schoolId, t.schoolId), eq(studentGuardian.studentId, id)));
    const updated = await tx
      .update(studentGuardian)
      .set({ isPrimary: true })
      .where(and(eq(studentGuardian.schoolId, t.schoolId), eq(studentGuardian.studentId, id), eq(studentGuardian.guardianId, guardianId)))
      .returning();
    if (updated.length === 0) throw notFound('That guardian');
  });
  return c.json({ ok: true });
});

studentRoutes.delete('/students/:id/guardians/:guardianId', async (c) => {
  const db = c.get('db');
  const t = c.get('tenant');
  requirePermission(t, 'students.edit');
  const id = c.req.param('id');
  const links = await db.select().from(studentGuardian).where(and(eq(studentGuardian.schoolId, t.schoolId), eq(studentGuardian.studentId, id)));
  if (links.length <= 1) throw conflict('A student needs at least one guardian on file.');
  const removed = await db
    .delete(studentGuardian)
    .where(and(eq(studentGuardian.schoolId, t.schoolId), eq(studentGuardian.studentId, id), eq(studentGuardian.guardianId, c.req.param('guardianId'))))
    .returning();
  if (removed.length === 0) throw notFound('That guardian');
  if (removed[0].isPrimary) {
    const next = links.find((l) => l.guardianId !== removed[0].guardianId)!;
    await db.update(studentGuardian).set({ isPrimary: true }).where(and(eq(studentGuardian.studentId, id), eq(studentGuardian.guardianId, next.guardianId)));
  }
  await audit(db, t, { action: 'guardian.removed', entityType: 'student', entityId: id, studentId: id, summary: 'Removed a guardian' });
  return c.json({ ok: true });
});

// ---------------------------------------------------------------------------
// Concessions (standing discounts) live with the student but are a fees decision
// ---------------------------------------------------------------------------

studentRoutes.get('/students/:id/concessions', async (c) => {
  const db = c.get('db');
  const t = c.get('tenant');
  requirePermission(t, 'fees.view');
  const id = c.req.param('id');
  await getStudent(db, t, id);
  return c.json(await db.select().from(feeConcession).where(and(eq(feeConcession.schoolId, t.schoolId), eq(feeConcession.studentId, id))));
});

// ---------------------------------------------------------------------------
// Import from a spreadsheet
// ---------------------------------------------------------------------------

const importRow = z.object({
  firstName: requiredText('First name', 60),
  lastName: optionalText,
  gender: z
    .string()
    .optional()
    .nullable()
    .transform((g) => {
      const v = (g ?? '').trim().toLowerCase();
      if (!v) return null;
      if (['m', 'male', 'boy', 'b'].includes(v)) return 'male' as const;
      if (['f', 'female', 'girl', 'g'].includes(v)) return 'female' as const;
      return 'other' as const;
    }),
  dateOfBirth: isoDate.optional().nullable(),
  className: requiredText('Class', 30),
  sectionName: requiredText('Section', 10),
  rollNo: z.coerce.number().int().min(1).max(999).optional().nullable(),
  admissionNo: z.string().trim().max(40).optional().nullable(),
  admittedOn: isoDate.optional().nullable(),
  guardianName: requiredText('Guardian name', 80),
  guardianRelation: z
    .string()
    .optional()
    .nullable()
    .transform((r) => {
      const v = (r ?? '').trim().toLowerCase();
      if (v.startsWith('f')) return 'father' as const;
      if (v.startsWith('m')) return 'mother' as const;
      if (v.startsWith('g') || !v) return 'guardian' as const;
      return 'other' as const;
    }),
  guardianPhone: phone,
  guardianEmail: email,
  address: optionalText,
  apaarId: optionalText,
});

studentRoutes.post('/students/import', async (c) => {
  const db = c.get('db');
  const t = c.get('tenant');
  requirePermission(t, 'students.edit');
  const body = await readBody(
    c,
    z.object({
      rows: z.array(z.record(z.unknown())).min(1).max(2000),
      dryRun: z.boolean().default(true),
      /** Add any class or section the sheet names that the school does not have yet, instead of rejecting those rows. */
      createMissing: z.boolean().default(false),
    }),
  );
  if (body.createMissing) requirePermission(t, 'school.manage');
  const year = await resolveYear(db, t);

  const sections = await db
    .select({ id: section.id, name: section.name, gradeName: grade.name })
    .from(section)
    .innerJoin(grade, eq(grade.id, section.gradeId))
    .where(and(eq(section.schoolId, t.schoolId), eq(section.yearId, year.id)));
  const gradeKey = (g: string) => g.trim().toLowerCase().replace(/^class\s+/, '');
  const sectionKey = (g: string, s: string) => `${gradeKey(g)}|${s.trim().toLowerCase()}`;
  const sectionByKey = new Map(sections.map((s) => [sectionKey(s.gradeName, s.name), s]));
  // A class counts as existing even if it has no section yet this year.
  const gradeByKey = new Map((await db.select({ id: grade.id, name: grade.name }).from(grade).where(eq(grade.schoolId, t.schoolId))).map((g) => [gradeKey(g.name), g]));

  // Every class-and-section the sheet names that the school lacks, listed once with how many rows need it.
  const missing = new Map<string, { className: string; sectionName: string; rows: number; classExists: boolean }>();

  const existingAdmissionNos = new Set(
    (await db.select({ no: student.admissionNo }).from(student).where(eq(student.schoolId, t.schoolId))).map((r) => r.no.toLowerCase()),
  );

  const errors: { row: number; field: string; message: string }[] = [];
  const valid: (z.infer<typeof importRow> & { sectionId: string | null; key: string; row: number })[] = [];
  const seenNos = new Set<string>();

  body.rows.forEach((raw, index) => {
    const row = index + 1;
    const result = importRow.safeParse(raw);
    if (!result.success) {
      for (const issue of result.error.issues) errors.push({ row, field: String(issue.path[0] ?? ''), message: issue.message });
      return;
    }
    const r = result.data;
    const key = sectionKey(r.className, r.sectionName);
    const sec = sectionByKey.get(key);
    if (!sec) {
      const gap = missing.get(key) ?? {
        className: r.className.replace(/^class\s+/i, '').trim(),
        sectionName: r.sectionName.trim().toUpperCase(),
        rows: 0,
        classExists: gradeByKey.has(gradeKey(r.className)),
      };
      gap.rows += 1;
      missing.set(key, gap);
      if (!body.createMissing) {
        errors.push({ row, field: 'sectionName', message: `There is no section ${r.className}-${r.sectionName} in ${year.name}.` });
        return;
      }
    }
    if (r.admissionNo) {
      const key = r.admissionNo.toLowerCase();
      if (existingAdmissionNos.has(key)) {
        errors.push({ row, field: 'admissionNo', message: `Admission number ${r.admissionNo} is already on file.` });
        return;
      }
      if (seenNos.has(key)) {
        errors.push({ row, field: 'admissionNo', message: `Admission number ${r.admissionNo} appears twice in this file.` });
        return;
      }
      seenNos.add(key);
    }
    valid.push({ ...r, sectionId: sec?.id ?? null, key, row });
  });

  const gaps = [...missing.values()];
  if (body.dryRun || errors.length > 0) {
    return c.json({ valid: valid.length, errors, imported: 0, missing: gaps });
  }

  let createdClasses = 0;
  await db.transaction(async (tx) => {
    // Add whatever the sheet needs that the school lacks, in the order the sheet first names it.
    const createdSections = new Map<string, string>();
    if (missing.size > 0) {
      const gradeIds = new Map([...gradeByKey].map(([k, g]) => [k, g.id]));
      const [{ max }] = await tx.select({ max: sql<number>`coalesce(max(${grade.position}), -1)::int` }).from(grade).where(eq(grade.schoolId, t.schoolId));
      let position = Number(max) + 1;
      for (const [key, gap] of missing) {
        const gk = gradeKey(gap.className);
        let gradeId = gradeIds.get(gk);
        if (!gradeId) {
          const [g] = await tx.insert(grade).values({ schoolId: t.schoolId, name: gap.className, position: position++ }).returning({ id: grade.id });
          gradeId = g.id;
          gradeIds.set(gk, gradeId);
          createdClasses += 1;
        }
        const [s] = await tx.insert(section).values({ schoolId: t.schoolId, yearId: year.id, gradeId, name: gap.sectionName }).returning({ id: section.id });
        createdSections.set(key, s.id);
      }
      await audit(tx, t, {
        action: 'structure.imported',
        entityType: 'school',
        summary: `Added ${createdClasses} classes and ${missing.size} sections while importing students`,
        data: { sections: gaps.map((g) => `${g.className}-${g.sectionName}`) },
      });
    }
    for (const r of valid) r.sectionId ??= createdSections.get(r.key) ?? null;

    const guardianByPhone = new Map<string, string>();
    const rollBySection = new Map<string, number>();
    for (const r of valid) {
      const admissionNo = r.admissionNo || (await makeAdmissionNo(tx, t, year.startsOn));
      const [s] = await tx
        .insert(student)
        .values({
          schoolId: t.schoolId,
          admissionNo,
          firstName: r.firstName,
          lastName: r.lastName,
          gender: r.gender,
          dateOfBirth: r.dateOfBirth ?? null,
          address: r.address,
          apaarId: r.apaarId,
          // Students brought in from an existing register were already here when the year began.
          admittedOn: r.admittedOn ?? year.startsOn,
        })
        .returning({ id: student.id, admittedOn: student.admittedOn });

      let guardianId = r.guardianPhone ? guardianByPhone.get(r.guardianPhone) : undefined;
      if (!guardianId && r.guardianPhone) {
        const [existing] = await tx.select({ id: guardian.id }).from(guardian).where(and(eq(guardian.schoolId, t.schoolId), eq(guardian.phone, r.guardianPhone))).limit(1);
        guardianId = existing?.id;
      }
      if (!guardianId) {
        const [g] = await tx
          .insert(guardian)
          .values({ schoolId: t.schoolId, name: r.guardianName, phone: r.guardianPhone, email: r.guardianEmail, address: r.address })
          .returning({ id: guardian.id });
        guardianId = g.id;
      }
      if (r.guardianPhone) guardianByPhone.set(r.guardianPhone, guardianId);
      await tx.insert(studentGuardian).values({ schoolId: t.schoolId, studentId: s.id, guardianId, relation: r.guardianRelation, isPrimary: true });

      const sectionId = r.sectionId!;
      let roll = r.rollNo ?? null;
      if (!roll) {
        const nextRoll = rollBySection.get(sectionId) ?? (await nextRollNo(tx, sectionId));
        roll = nextRoll;
        rollBySection.set(sectionId, nextRoll + 1);
      }
      const enrolledOn = s.admittedOn > year.startsOn ? s.admittedOn : year.startsOn;
      await tx.insert(enrollment).values({ schoolId: t.schoolId, studentId: s.id, yearId: year.id, sectionId, rollNo: roll, enrolledOn });
      await syncStudentCharges(tx, t, s.id, year.id);
      await audit(tx, t, { action: 'student.imported', entityType: 'student', entityId: s.id, studentId: s.id, summary: `Imported from a spreadsheet (${admissionNo})` });
    }
    await audit(tx, t, { action: 'students.imported', entityType: 'student', summary: `Imported ${valid.length} students from a spreadsheet` });
  });

  return c.json({ valid: valid.length, errors: [], imported: valid.length, missing: gaps, createdClasses, createdSections: gaps.length }, 201);
});

// ---------------------------------------------------------------------------
// Everything held about one student, for a guardian's request under the DPDP Act
// ---------------------------------------------------------------------------

studentRoutes.get('/students/:id/export', async (c) => {
  const db = c.get('db');
  const t = c.get('tenant');
  if (!can(t, 'students.edit') && !can(t, 'audit.view')) throw forbidden();
  const id = c.req.param('id');
  const s = await getStudent(db, t, id);

  const guardians = await db
    .select({ guardian, relation: studentGuardian.relation })
    .from(studentGuardian)
    .innerJoin(guardian, eq(guardian.id, studentGuardian.guardianId))
    .where(and(eq(studentGuardian.schoolId, t.schoolId), eq(studentGuardian.studentId, id)));
  const enrollments = await db.select().from(enrollment).where(and(eq(enrollment.schoolId, t.schoolId), eq(enrollment.studentId, id)));
  const marks = await db
    .select({ date: attendanceRegister.date, mark: sql<string>`${attendanceRegister.marks} ->> ${id}` })
    .from(attendanceRegister)
    .where(and(eq(attendanceRegister.schoolId, t.schoolId), sql`${attendanceRegister.marks} ? ${id}`))
    .orderBy(asc(attendanceRegister.date));
  const charges = await studentCharges(db, t.schoolId, id);
  const payments = await db.select().from(payment).where(and(eq(payment.schoolId, t.schoolId), eq(payment.studentId, id)));
  const allocations = payments.length
    ? await db.select().from(paymentAllocation).where(inArray(paymentAllocation.paymentId, payments.map((p) => p.id)))
    : [];
  const trail = await db.select().from(auditEvent).where(and(eq(auditEvent.schoolId, t.schoolId), eq(auditEvent.studentId, id))).orderBy(asc(auditEvent.createdAt));

  await audit(db, t, { action: 'student.exported', entityType: 'student', entityId: id, studentId: id, summary: 'Exported all records held about this student' });

  c.header('Content-Disposition', `attachment; filename="${s.admissionNo.replace(/[^A-Za-z0-9-]/g, '_')}-records.json"`);
  return c.json({
    exportedAt: new Date().toISOString(),
    student: s,
    guardians: guardians.map((g) => ({ ...g.guardian, relation: g.relation })),
    enrollments,
    attendance: marks,
    feeCharges: charges,
    payments: payments.map((p) => ({ ...p, allocations: allocations.filter((a) => a.paymentId === p.id) })),
    changeHistory: trail,
  });
});

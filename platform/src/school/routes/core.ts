// The school as a whole: who am I here, the school's details, first-time setup, academic
// years, holidays, the Today screen, the activity trail and search.
import { and, asc, desc, eq, gte, ilike, inArray, lte, lt, or, sql } from 'drizzle-orm';
import { Hono } from 'hono';
import { z } from 'zod';
import { organization } from '../../db/auth-schema';
import {
  academicYear,
  attendanceRegister,
  auditEvent,
  enrollment,
  feeCharge,
  feeHead,
  feePlan,
  grade,
  guardian,
  holiday,
  payment,
  schoolProfile,
  section,
  staff,
  student,
  studentGuardian,
  subject,
  term,
} from '../../db/school-schema';
import { addDays, isWorkingDay, todayIST } from '../../lib/dates';
import { conflict, invalid, isoDate, notFound, optionalText, parse, readBody, readQuery, requiredText, phone, email } from '../../lib/http';
import { allocatedByCharge } from '../fees-engine';
import { findCurrentYear, ownSectionIds } from '../queries';
import { roleLabels } from '../roles';
import { audit, can, requirePermission } from '../tenant';
import type { AppEnv } from '../tenant';

export const coreRoutes = new Hono<AppEnv>();

// ---------------------------------------------------------------------------
// Me
// ---------------------------------------------------------------------------

coreRoutes.get('/me', async (c) => {
  const db = c.get('db');
  const t = c.get('tenant');

  const [school] = await db
    .select({
      id: organization.id,
      name: organization.name,
      slug: organization.slug,
      board: schoolProfile.board,
      city: schoolProfile.city,
      state: schoolProfile.state,
      workingDays: schoolProfile.workingDays,
      setupCompletedAt: schoolProfile.setupCompletedAt,
    })
    .from(organization)
    .leftJoin(schoolProfile, eq(schoolProfile.schoolId, organization.id))
    .where(eq(organization.id, t.schoolId))
    .limit(1);

  // Schools created before Acadlas School existed have no profile row yet.
  if (school && school.workingDays === null) {
    await db.insert(schoolProfile).values({ schoolId: t.schoolId }).onConflictDoNothing();
  }

  const year = await findCurrentYear(db, t.schoolId);

  return c.json({
    school: { ...school, workingDays: school?.workingDays ?? 0b0111111 },
    user: { id: t.userId, name: t.userName, email: t.email },
    roles: t.roles,
    roleLabel: t.roles.map((r) => roleLabels[r]).join(', '),
    permissions: [...t.permissions],
    staffId: t.staffId,
    currentYear: year,
    today: todayIST(),
  });
});

// ---------------------------------------------------------------------------
// School details
// ---------------------------------------------------------------------------

const profileShape = z.object({
  name: requiredText('School name', 120),
  board: optionalText,
  affiliationNo: optionalText,
  udiseCode: optionalText,
  address: optionalText,
  city: optionalText,
  state: optionalText,
  pincode: optionalText,
  // A school's number is often a landline with an STD code, so it is kept as typed.
  phone: optionalText,
  email: email,
  principalName: optionalText,
  workingDays: z.number().int().min(1).max(127).optional(),
  admissionPrefix: z.string().trim().min(1).max(12).optional(),
  receiptPrefix: z.string().trim().min(1).max(12).optional(),
});

coreRoutes.get('/profile', async (c) => {
  const db = c.get('db');
  const t = c.get('tenant');
  const [row] = await db
    .select()
    .from(organization)
    .leftJoin(schoolProfile, eq(schoolProfile.schoolId, organization.id))
    .where(eq(organization.id, t.schoolId))
    .limit(1);
  if (!row) throw notFound('This school');
  return c.json({ name: row.organization.name, slug: row.organization.slug, ...row.school_profile });
});

coreRoutes.put('/profile', async (c) => {
  const db = c.get('db');
  const t = c.get('tenant');
  requirePermission(t, 'school.manage');
  const body = await readBody(c, profileShape);
  const { name, ...profile } = body;

  await db.transaction(async (tx) => {
    await tx.update(organization).set({ name }).where(eq(organization.id, t.schoolId));
    await tx
      .insert(schoolProfile)
      .values({ schoolId: t.schoolId, ...profile })
      .onConflictDoUpdate({ target: schoolProfile.schoolId, set: profile });
    await audit(tx, t, { action: 'school.updated', entityType: 'school', entityId: t.schoolId, summary: 'Updated the school details' });
  });
  return c.json({ ok: true });
});

// ---------------------------------------------------------------------------
// First-time setup: one atomic submit of the whole wizard
// ---------------------------------------------------------------------------

const termShape = z.object({ name: requiredText('Term name', 60), startsOn: isoDate, endsOn: isoDate });

const yearShape = z
  .object({
    name: requiredText('Year name', 30),
    startsOn: isoDate,
    endsOn: isoDate,
    terms: z.array(termShape).max(6).default([]),
  })
  .refine((y) => y.startsOn < y.endsOn, { message: 'The year must end after it starts.', path: ['endsOn'] });

const setupShape = z.object({
  profile: profileShape,
  year: yearShape,
  classes: z
    .array(z.object({ name: requiredText('Class name', 30), sections: z.array(requiredText('Section', 10)).min(1).max(26) }))
    .min(1, 'Add at least one class.')
    .max(40),
  subjects: z.array(requiredText('Subject', 60)).max(40).default([]),
  feeHeads: z.array(requiredText('Fee head', 60)).max(20).default([]),
});

coreRoutes.post('/setup', async (c) => {
  const db = c.get('db');
  const t = c.get('tenant');
  requirePermission(t, 'school.manage');
  const body = await readBody(c, setupShape);

  const [existingYear] = await db
    .select({ id: academicYear.id })
    .from(academicYear)
    .where(eq(academicYear.schoolId, t.schoolId))
    .limit(1);
  if (existingYear) throw conflict('This school is already set up. Change things from Settings instead.', 'ALREADY_SET_UP');

  const classNames = body.classes.map((cl) => cl.name.toLowerCase());
  if (new Set(classNames).size !== classNames.length) throw invalid('Each class name can only appear once.');

  await db.transaction(async (tx) => {
    const { name, ...profile } = body.profile;
    await tx.update(organization).set({ name }).where(eq(organization.id, t.schoolId));
    await tx
      .insert(schoolProfile)
      .values({ schoolId: t.schoolId, ...profile, setupCompletedAt: new Date() })
      .onConflictDoUpdate({ target: schoolProfile.schoolId, set: { ...profile, setupCompletedAt: new Date() } });

    const [year] = await tx
      .insert(academicYear)
      .values({ schoolId: t.schoolId, name: body.year.name, startsOn: body.year.startsOn, endsOn: body.year.endsOn, isCurrent: true })
      .returning();
    if (body.year.terms.length > 0) {
      await tx.insert(term).values(body.year.terms.map((tm, i) => ({ schoolId: t.schoolId, yearId: year.id, ...tm, position: i })));
    }

    const grades = await tx
      .insert(grade)
      .values(body.classes.map((cl, i) => ({ schoolId: t.schoolId, name: cl.name, position: i })))
      .returning();
    const sectionRows = body.classes.flatMap((cl, i) =>
      [...new Set(cl.sections.map((s) => s.toUpperCase()))].map((s) => ({
        schoolId: t.schoolId,
        yearId: year.id,
        gradeId: grades[i].id,
        name: s,
      })),
    );
    await tx.insert(section).values(sectionRows);

    const subjects = [...new Set(body.subjects)];
    if (subjects.length > 0) {
      await tx.insert(subject).values(subjects.map((s) => ({ schoolId: t.schoolId, name: s }))).onConflictDoNothing();
    }
    const heads = [...new Set(body.feeHeads)];
    if (heads.length > 0) {
      await tx.insert(feeHead).values(heads.map((h, i) => ({ schoolId: t.schoolId, name: h, position: i }))).onConflictDoNothing();
    }

    await audit(tx, t, {
      action: 'school.setup',
      entityType: 'school',
      entityId: t.schoolId,
      summary: `Set up ${body.year.name} with ${grades.length} classes and ${sectionRows.length} sections`,
    });
  });

  return c.json({ ok: true }, 201);
});

// ---------------------------------------------------------------------------
// Academic years and terms
// ---------------------------------------------------------------------------

coreRoutes.get('/years', async (c) => {
  const db = c.get('db');
  const t = c.get('tenant');
  const years = await db.select().from(academicYear).where(eq(academicYear.schoolId, t.schoolId)).orderBy(desc(academicYear.startsOn));
  const terms = await db.select().from(term).where(eq(term.schoolId, t.schoolId)).orderBy(asc(term.position));
  return c.json(years.map((y) => ({ ...y, terms: terms.filter((tm) => tm.yearId === y.id) })));
});

const newYearShape = yearShape.and(
  z.object({
    makeCurrent: z.boolean().default(false),
    /** Copies that year's classes and sections (without students) into the new one. */
    copySectionsFrom: z.string().optional().nullable(),
  }),
);

coreRoutes.post('/years', async (c) => {
  const db = c.get('db');
  const t = c.get('tenant');
  requirePermission(t, 'school.manage');
  const body = await readBody(c, newYearShape);

  const year = await db.transaction(async (tx) => {
    const [clash] = await tx
      .select({ id: academicYear.id })
      .from(academicYear)
      .where(and(eq(academicYear.schoolId, t.schoolId), eq(academicYear.name, body.name)));
    if (clash) throw conflict(`There is already a year called ${body.name}.`);

    if (body.makeCurrent) {
      await tx.update(academicYear).set({ isCurrent: false }).where(eq(academicYear.schoolId, t.schoolId));
    }
    const [created] = await tx
      .insert(academicYear)
      .values({ schoolId: t.schoolId, name: body.name, startsOn: body.startsOn, endsOn: body.endsOn, isCurrent: body.makeCurrent })
      .returning();
    if (body.terms.length > 0) {
      await tx.insert(term).values(body.terms.map((tm, i) => ({ schoolId: t.schoolId, yearId: created.id, ...tm, position: i })));
    }

    if (body.copySectionsFrom) {
      const source = await tx
        .select({ gradeId: section.gradeId, name: section.name, room: section.room, capacity: section.capacity, classTeacherId: section.classTeacherId })
        .from(section)
        .where(and(eq(section.schoolId, t.schoolId), eq(section.yearId, body.copySectionsFrom)));
      if (source.length > 0) {
        await tx.insert(section).values(source.map((s) => ({ ...s, schoolId: t.schoolId, yearId: created.id })));
      }
    }

    await audit(tx, t, { action: 'year.created', entityType: 'academic_year', entityId: created.id, summary: `Created academic year ${created.name}` });
    return created;
  });
  return c.json(year, 201);
});

coreRoutes.patch('/years/:id', async (c) => {
  const db = c.get('db');
  const t = c.get('tenant');
  requirePermission(t, 'school.manage');
  const body = await readBody(c, yearShape);
  const id = c.req.param('id');

  await db.transaction(async (tx) => {
    const updated = await tx
      .update(academicYear)
      .set({ name: body.name, startsOn: body.startsOn, endsOn: body.endsOn })
      .where(and(eq(academicYear.schoolId, t.schoolId), eq(academicYear.id, id)))
      .returning({ id: academicYear.id });
    if (updated.length === 0) throw notFound('That academic year');
    await tx.delete(term).where(and(eq(term.schoolId, t.schoolId), eq(term.yearId, id)));
    if (body.terms.length > 0) {
      await tx.insert(term).values(body.terms.map((tm, i) => ({ schoolId: t.schoolId, yearId: id, ...tm, position: i })));
    }
    await audit(tx, t, { action: 'year.updated', entityType: 'academic_year', entityId: id, summary: `Updated academic year ${body.name}` });
  });
  return c.json({ ok: true });
});

coreRoutes.post('/years/:id/make-current', async (c) => {
  const db = c.get('db');
  const t = c.get('tenant');
  requirePermission(t, 'school.manage');
  const id = c.req.param('id');
  await db.transaction(async (tx) => {
    const [year] = await tx.select().from(academicYear).where(and(eq(academicYear.schoolId, t.schoolId), eq(academicYear.id, id)));
    if (!year) throw notFound('That academic year');
    await tx.update(academicYear).set({ isCurrent: false }).where(eq(academicYear.schoolId, t.schoolId));
    await tx.update(academicYear).set({ isCurrent: true }).where(eq(academicYear.id, id));
    await audit(tx, t, { action: 'year.current', entityType: 'academic_year', entityId: id, summary: `Made ${year.name} the current year` });
  });
  return c.json({ ok: true });
});

// ---------------------------------------------------------------------------
// Holidays
// ---------------------------------------------------------------------------

coreRoutes.get('/holidays', async (c) => {
  const db = c.get('db');
  const t = c.get('tenant');
  const q = readQuery(c, z.object({ from: isoDate.optional(), to: isoDate.optional() }));
  const filters = [eq(holiday.schoolId, t.schoolId)];
  if (q.from) filters.push(gte(holiday.date, q.from));
  if (q.to) filters.push(lte(holiday.date, q.to));
  return c.json(await db.select().from(holiday).where(and(...filters)).orderBy(asc(holiday.date)));
});

coreRoutes.post('/holidays', async (c) => {
  const db = c.get('db');
  const t = c.get('tenant');
  requirePermission(t, 'school.manage');
  const body = await readBody(
    c,
    z.object({ holidays: z.array(z.object({ date: isoDate, name: requiredText('Holiday name', 80) })).min(1).max(100) }),
  );
  await db.transaction(async (tx) => {
    for (const h of body.holidays) {
      await tx
        .insert(holiday)
        .values({ schoolId: t.schoolId, ...h })
        .onConflictDoUpdate({ target: [holiday.schoolId, holiday.date], set: { name: h.name } });
    }
    await audit(tx, t, {
      action: 'holiday.added',
      entityType: 'holiday',
      summary: body.holidays.length === 1 ? `Added holiday: ${body.holidays[0].name}` : `Added ${body.holidays.length} holidays`,
    });
  });
  return c.json({ ok: true }, 201);
});

coreRoutes.delete('/holidays/:id', async (c) => {
  const db = c.get('db');
  const t = c.get('tenant');
  requirePermission(t, 'school.manage');
  const removed = await db
    .delete(holiday)
    .where(and(eq(holiday.schoolId, t.schoolId), eq(holiday.id, c.req.param('id'))))
    .returning();
  if (removed.length === 0) throw notFound('That holiday');
  await audit(db, t, { action: 'holiday.removed', entityType: 'holiday', summary: `Removed holiday: ${removed[0].name}` });
  return c.json({ ok: true });
});

// ---------------------------------------------------------------------------
// Today — the first screen of the day
// ---------------------------------------------------------------------------

coreRoutes.get('/today', async (c) => {
  const db = c.get('db');
  const t = c.get('tenant');
  const today = todayIST();
  const year = await findCurrentYear(db, t.schoolId);

  const [profile] = await db.select({ workingDays: schoolProfile.workingDays }).from(schoolProfile).where(eq(schoolProfile.schoolId, t.schoolId));
  const [todayHoliday] = await db.select().from(holiday).where(and(eq(holiday.schoolId, t.schoolId), eq(holiday.date, today)));
  const workingDay = !todayHoliday && isWorkingDay(today, profile?.workingDays ?? 0b0111111);

  let registers: {
    sectionId: string;
    label: string;
    gradeName: string;
    position: number;
    strength: number;
    taken: boolean;
    present: number;
    absent: number;
    late: number;
    takenByName: string | null;
    mine: boolean;
  }[] = [];

  if (year) {
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

    const taken = await db
      .select()
      .from(attendanceRegister)
      .where(and(eq(attendanceRegister.schoolId, t.schoolId), eq(attendanceRegister.date, today)));
    const takenBySection = new Map(taken.map((r) => [r.sectionId, r]));

    registers = sections.map((s) => {
      const r = takenBySection.get(s.id);
      return {
        sectionId: s.id,
        label: `${s.gradeName}-${s.name}`,
        gradeName: s.gradeName,
        position: s.position,
        strength: Number(s.strength),
        taken: Boolean(r),
        present: r?.present ?? 0,
        absent: r?.absent ?? 0,
        late: r?.late ?? 0,
        takenByName: r?.takenByName ?? null,
        mine: own === null ? false : own.includes(s.id),
      };
    });
    if (own !== null) registers = registers.filter((r) => r.mine);
  }

  let fees = null;
  if (can(t, 'fees.view') && year) {
    const [collected] = await db
      .select({ total: sql<number>`coalesce(sum(${payment.amount}), 0)::int`, count: sql<number>`count(*)::int` })
      .from(payment)
      .where(and(eq(payment.schoolId, t.schoolId), eq(payment.paidOn, today), eq(payment.status, 'valid')));

    const overdueCharges = await db
      .select({ id: feeCharge.id, studentId: feeCharge.studentId, net: sql<number>`(${feeCharge.amount} - ${feeCharge.concession})::int` })
      .from(feeCharge)
      .innerJoin(student, eq(student.id, feeCharge.studentId))
      .where(and(eq(feeCharge.schoolId, t.schoolId), eq(feeCharge.yearId, year.id), lt(feeCharge.dueOn, today), eq(student.status, 'active')));
    const paid = await allocatedByCharge(db, t.schoolId, overdueCharges.map((ch) => ch.id));
    const overdueStudents = new Set<string>();
    let overdue = 0;
    for (const ch of overdueCharges) {
      const due = Number(ch.net) - (paid.get(ch.id) ?? 0);
      if (due > 0) {
        overdue += due;
        overdueStudents.add(ch.studentId);
      }
    }

    const week = await db
      .select({ day: payment.paidOn, total: sql<number>`coalesce(sum(${payment.amount}), 0)::int` })
      .from(payment)
      .where(and(eq(payment.schoolId, t.schoolId), gte(payment.paidOn, addDays(today, -6)), lte(payment.paidOn, today), eq(payment.status, 'valid')))
      .groupBy(payment.paidOn);
    const byDay = new Map(week.map((w) => [w.day, Number(w.total)]));
    const lastSeven = Array.from({ length: 7 }, (_, i) => {
      const d = addDays(today, i - 6);
      return { date: d, total: byDay.get(d) ?? 0 };
    });

    fees = {
      collectedToday: Number(collected?.total ?? 0),
      receiptsToday: Number(collected?.count ?? 0),
      overdue,
      overdueStudents: overdueStudents.size,
      lastSeven,
    };
  }

  // Birthdays today, among students this person can see. Indian schools mark these at assembly.
  let birthdays: { id: string; name: string; classLabel: string | null }[] = [];
  if (year && (can(t, 'students.view.all') || can(t, 'students.view.own'))) {
    const own = await ownSectionIds(db, t);
    const rows = await db
      .select({
        id: student.id,
        firstName: student.firstName,
        lastName: student.lastName,
        gradeName: grade.name,
        sectionName: section.name,
        sectionId: section.id,
      })
      .from(student)
      .leftJoin(enrollment, and(eq(enrollment.studentId, student.id), eq(enrollment.yearId, year.id)))
      .leftJoin(section, eq(section.id, enrollment.sectionId))
      .leftJoin(grade, eq(grade.id, section.gradeId))
      .where(
        and(
          eq(student.schoolId, t.schoolId),
          eq(student.status, 'active'),
          sql`to_char(${student.dateOfBirth}, 'MM-DD') = ${today.slice(5)}`,
        ),
      )
      .limit(20);
    birthdays = rows
      .filter((r) => own === null || (r.sectionId && own.includes(r.sectionId)))
      .map((r) => ({
        id: r.id,
        name: [r.firstName, r.lastName].filter(Boolean).join(' '),
        classLabel: r.gradeName ? `${r.gradeName}-${r.sectionName}` : null,
      }));
  }

  const activity = can(t, 'audit.view')
    ? await db
        .select({ id: auditEvent.id, summary: auditEvent.summary, actorName: auditEvent.actorName, action: auditEvent.action, createdAt: auditEvent.createdAt, studentId: auditEvent.studentId })
        .from(auditEvent)
        .where(eq(auditEvent.schoolId, t.schoolId))
        .orderBy(desc(auditEvent.createdAt))
        .limit(8)
    : [];

  // What is left to set up, for the checklist on a new school's first days.
  let checklist = null;
  if (can(t, 'school.manage')) {
    const [counts] = await db
      .select({
        students: sql<number>`(select count(*)::int from ${student} where ${student.schoolId} = ${t.schoolId})`,
        staff: sql<number>`(select count(*)::int from ${staff} where ${staff.schoolId} = ${t.schoolId})`,
        plans: sql<number>`(select count(*)::int from ${feePlan} where ${feePlan.schoolId} = ${t.schoolId})`,
        registers: sql<number>`(select count(*)::int from ${attendanceRegister} where ${attendanceRegister.schoolId} = ${t.schoolId})`,
        payments: sql<number>`(select count(*)::int from ${payment} where ${payment.schoolId} = ${t.schoolId})`,
      })
      .from(sql`(select 1) as one`);
    checklist = {
      studentsAdded: Number(counts.students) > 0,
      staffInvited: Number(counts.staff) > 1,
      feePlanCreated: Number(counts.plans) > 0,
      firstRegister: Number(counts.registers) > 0,
      firstReceipt: Number(counts.payments) > 0,
    };
  }

  return c.json({
    today,
    workingDay,
    holiday: todayHoliday ?? null,
    year,
    registers,
    fees,
    birthdays,
    activity,
    checklist,
  });
});

// ---------------------------------------------------------------------------
// The trail
// ---------------------------------------------------------------------------

coreRoutes.get('/activity', async (c) => {
  const db = c.get('db');
  const t = c.get('tenant');
  requirePermission(t, 'audit.view');
  const q = readQuery(c, z.object({ before: z.string().optional(), limit: z.coerce.number().int().min(1).max(100).default(40) }));
  const filters = [eq(auditEvent.schoolId, t.schoolId)];
  if (q.before) filters.push(lt(auditEvent.createdAt, new Date(q.before)));
  const rows = await db.select().from(auditEvent).where(and(...filters)).orderBy(desc(auditEvent.createdAt)).limit(q.limit);
  return c.json(rows);
});

// ---------------------------------------------------------------------------
// Search — one box for students, guardians' phone numbers, receipts and staff
// ---------------------------------------------------------------------------

coreRoutes.get('/search', async (c) => {
  const db = c.get('db');
  const t = c.get('tenant');
  const { q } = parse(z.object({ q: z.string().trim().min(1).max(80) }), c.req.query());
  const like = `%${q.replace(/[%_]/g, '')}%`;
  const digits = q.replace(/\D/g, '');
  const year = await findCurrentYear(db, t.schoolId);
  const own = await ownSectionIds(db, t);

  const canSeeStudents = can(t, 'students.view.all') || can(t, 'students.view.own');
  let students: { id: string; name: string; admissionNo: string; classLabel: string | null; status: string; guardianPhone: string | null }[] = [];

  if (canSeeStudents) {
    const matchByPhone =
      digits.length >= 4
        ? await db
            .select({ studentId: studentGuardian.studentId })
            .from(guardian)
            .innerJoin(studentGuardian, eq(studentGuardian.guardianId, guardian.id))
            .where(and(eq(guardian.schoolId, t.schoolId), ilike(guardian.phone, `%${digits}%`)))
            .limit(20)
        : [];
    const phoneIds = matchByPhone.map((m) => m.studentId);

    const rows = await db
      .select({
        id: student.id,
        firstName: student.firstName,
        lastName: student.lastName,
        admissionNo: student.admissionNo,
        status: student.status,
        gradeName: grade.name,
        sectionName: section.name,
        sectionId: section.id,
      })
      .from(student)
      .leftJoin(enrollment, year ? and(eq(enrollment.studentId, student.id), eq(enrollment.yearId, year.id)) : sql`false`)
      .leftJoin(section, eq(section.id, enrollment.sectionId))
      .leftJoin(grade, eq(grade.id, section.gradeId))
      .where(
        and(
          eq(student.schoolId, t.schoolId),
          or(
            ilike(sql`${student.firstName} || ' ' || coalesce(${student.lastName}, '')`, like),
            ilike(student.admissionNo, like),
            phoneIds.length > 0 ? inArray(student.id, phoneIds) : sql`false`,
          ),
        ),
      )
      .orderBy(asc(student.firstName))
      .limit(8);

    const visible = rows.filter((r) => own === null || (r.sectionId && own.includes(r.sectionId)));
    const phones = visible.length
      ? await db
          .select({ studentId: studentGuardian.studentId, phone: guardian.phone })
          .from(studentGuardian)
          .innerJoin(guardian, eq(guardian.id, studentGuardian.guardianId))
          .where(and(eq(studentGuardian.schoolId, t.schoolId), inArray(studentGuardian.studentId, visible.map((v) => v.id)), eq(studentGuardian.isPrimary, true)))
      : [];
    students = visible.map((r) => ({
      id: r.id,
      name: [r.firstName, r.lastName].filter(Boolean).join(' '),
      admissionNo: r.admissionNo,
      classLabel: r.gradeName ? `${r.gradeName}-${r.sectionName}` : null,
      status: r.status,
      guardianPhone: phones.find((p) => p.studentId === r.id)?.phone ?? null,
    }));
  }

  const receipts = can(t, 'fees.view')
    ? await db
        .select({ id: payment.id, receiptNo: payment.receiptNo, amount: payment.amount, paidOn: payment.paidOn, status: payment.status, studentId: payment.studentId, firstName: student.firstName, lastName: student.lastName })
        .from(payment)
        .innerJoin(student, eq(student.id, payment.studentId))
        .where(and(eq(payment.schoolId, t.schoolId), ilike(payment.receiptNo, like)))
        .orderBy(desc(payment.createdAt))
        .limit(5)
    : [];

  const people = await db
    .select({ id: staff.id, name: staff.name, designation: staff.designation, phone: staff.phone })
    .from(staff)
    .where(and(eq(staff.schoolId, t.schoolId), ilike(staff.name, like)))
    .limit(5);

  return c.json({
    students,
    receipts: receipts.map((r) => ({ ...r, studentName: [r.firstName, r.lastName].filter(Boolean).join(' ') })),
    staff: people,
  });
});

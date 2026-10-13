// Fees: heads, plans and their late-fee rule, each student's ledger (including anything
// brought forward from an earlier year), receipts and what can happen to them — a
// cancellation, a bounced cheque — dues, the day's collection and the day book.
import { and, asc, between, desc, eq, inArray, lt, sql } from 'drizzle-orm';
import { Hono } from 'hono';
import { z } from 'zod';
import type { Db, DbOrTx, Tx } from '../../db';
import { organization } from '../../db/auth-schema';
import {
  academicYear,
  enrollment,
  feeCharge,
  feeConcession,
  feeDayClose,
  feeHead,
  feeInstalment,
  feeLine,
  feePlan,
  feePlanGrade,
  grade,
  guardian,
  payment,
  paymentAllocation,
  schoolProfile,
  section,
  student,
  studentGuardian,
} from '../../db/school-schema';
import { formatDateIN, todayIST } from '../../lib/dates';
import { conflict, invalid, isoDate, notFound, optionalText, paise, readBody, readQuery, requiredText } from '../../lib/http';
import { formatINR, rupeesInWords } from '../../lib/money';
import {
  BANK_CHARGE_HEAD,
  allocatedByCharge,
  applyFines,
  assertDayOpen,
  expectedCashFor,
  feeSettings,
  headByName,
  planAllocation,
  studentCharges,
  syncPlanCharges,
  syncStudentCharges,
} from '../fees-engine';
import { assertCanViewStudent, findCurrentYear, getStudent, resolveYear } from '../queries';
import { audit, nextNumber, requirePermission } from '../tenant';
import type { AppEnv } from '../tenant';
import { fullName } from './students';

/** Years of this school that started before `year` — where anything brought forward comes from. */
async function earlierYearIds(db: Db, schoolId: string, startsOn: string): Promise<string[]> {
  const rows = await db
    .select({ id: academicYear.id })
    .from(academicYear)
    .where(and(eq(academicYear.schoolId, schoolId), lt(academicYear.startsOn, startsOn)));
  return rows.map((r) => r.id);
}

export const feeRoutes = new Hono<AppEnv>();

// ---------------------------------------------------------------------------
// Heads
// ---------------------------------------------------------------------------

feeRoutes.get('/fees/heads', async (c) => {
  const db = c.get('db');
  const t = c.get('tenant');
  requirePermission(t, 'fees.view');
  return c.json(await db.select().from(feeHead).where(eq(feeHead.schoolId, t.schoolId)).orderBy(asc(feeHead.position), asc(feeHead.name)));
});

feeRoutes.post('/fees/heads', async (c) => {
  const db = c.get('db');
  const t = c.get('tenant');
  requirePermission(t, 'fees.manage');
  const body = await readBody(c, z.object({ name: requiredText('Fee head', 60) }));
  const [clash] = await db.select({ id: feeHead.id }).from(feeHead).where(and(eq(feeHead.schoolId, t.schoolId), eq(feeHead.name, body.name)));
  if (clash) throw conflict(`${body.name} is already a fee head.`);
  const [{ max }] = await db.select({ max: sql<number>`coalesce(max(${feeHead.position}), -1)::int` }).from(feeHead).where(eq(feeHead.schoolId, t.schoolId));
  const [created] = await db.insert(feeHead).values({ schoolId: t.schoolId, name: body.name, position: Number(max) + 1 }).returning();
  return c.json(created, 201);
});

feeRoutes.patch('/fees/heads/:id', async (c) => {
  const db = c.get('db');
  const t = c.get('tenant');
  requirePermission(t, 'fees.manage');
  const body = await readBody(c, z.object({ name: requiredText('Fee head', 60) }));
  const updated = await db.update(feeHead).set(body).where(and(eq(feeHead.schoolId, t.schoolId), eq(feeHead.id, c.req.param('id')))).returning();
  if (updated.length === 0) throw notFound('That fee head');
  return c.json(updated[0]);
});

feeRoutes.delete('/fees/heads/:id', async (c) => {
  const db = c.get('db');
  const t = c.get('tenant');
  requirePermission(t, 'fees.manage');
  const id = c.req.param('id');
  const [used] = await db.select({ id: feeCharge.id }).from(feeCharge).where(and(eq(feeCharge.schoolId, t.schoolId), eq(feeCharge.headId, id))).limit(1);
  const [inPlan] = await db.select({ id: feeLine.id }).from(feeLine).where(and(eq(feeLine.schoolId, t.schoolId), eq(feeLine.headId, id))).limit(1);
  if (used || inPlan) throw conflict('This head is used in a fee plan or on a student’s charges, so it cannot be deleted.');
  const removed = await db.delete(feeHead).where(and(eq(feeHead.schoolId, t.schoolId), eq(feeHead.id, id))).returning();
  if (removed.length === 0) throw notFound('That fee head');
  return c.json({ ok: true });
});

// ---------------------------------------------------------------------------
// Plans
// ---------------------------------------------------------------------------

/**
 * The school's late-fee policy for this plan; `none` is the default and charges nothing.
 * `mode` is how often it repeats (once, daily, weekly, monthly). `basis` is whether each
 * charge is a fixed `amount` or `rate` basis points (150 = 1.5%) of the instalment.
 */
const fineShape = z
  .object({
    mode: z.enum(['none', 'flat', 'daily', 'weekly', 'monthly']).default('none'),
    basis: z.enum(['amount', 'percent']).default('amount'),
    amount: paise.default(0),
    rate: z.number().int().min(0).max(10_000).default(0),
    graceDays: z.number().int().min(0).max(365).default(0),
    cap: paise.default(0),
  })
  .refine((f) => f.mode === 'none' || f.basis !== 'amount' || f.amount > 0, { message: 'Enter the late fee amount.', path: ['amount'] })
  .refine((f) => f.mode === 'none' || f.basis !== 'percent' || f.rate > 0, { message: 'Enter the late fee percentage.', path: ['rate'] })
  .refine((f) => f.basis !== 'amount' || f.cap === 0 || f.cap >= f.amount, { message: 'The ceiling cannot be less than one late fee.', path: ['cap'] });

const planShape = z.object({
  yearId: z.string().optional(),
  name: requiredText('Plan name', 80),
  gradeIds: z.array(z.string()).min(1, 'Choose at least one class.').max(40),
  fine: fineShape.optional(),
  instalments: z
    .array(
      z.object({
        id: z.string().optional(),
        name: requiredText('Instalment name', 60),
        dueOn: isoDate,
        amounts: z.record(paise),
      }),
    )
    .min(1, 'Add at least one instalment.')
    .max(24),
});

const noFine = { mode: 'none', basis: 'amount', amount: 0, rate: 0, graceDays: 0, cap: 0 } as const;

/** The plan columns a policy is stored in. */
function fineColumns(fine: z.infer<typeof fineShape>) {
  return { fineMode: fine.mode, fineBasis: fine.basis, fineAmount: fine.amount, fineRate: fine.rate, fineGraceDays: fine.graceDays, fineCap: fine.cap };
}

feeRoutes.get('/fees/plans', async (c) => {
  const db = c.get('db');
  const t = c.get('tenant');
  requirePermission(t, 'fees.view');
  const q = readQuery(c, z.object({ yearId: z.string().optional() }));
  const year = await resolveYear(db, t, q.yearId);

  const plans = await db.select().from(feePlan).where(and(eq(feePlan.schoolId, t.schoolId), eq(feePlan.yearId, year.id))).orderBy(asc(feePlan.name));
  const planIds = plans.map((p) => p.id);
  if (planIds.length === 0) return c.json({ year, plans: [] });

  const grades = await db.select().from(feePlanGrade).where(inArray(feePlanGrade.planId, planIds));
  const instalments = await db.select().from(feeInstalment).where(inArray(feeInstalment.planId, planIds)).orderBy(asc(feeInstalment.position), asc(feeInstalment.dueOn));
  const lines = await db.select().from(feeLine).where(inArray(feeLine.planId, planIds));
  const counts = await db
    .select({ gradeId: section.gradeId, n: sql<number>`count(*)::int` })
    .from(enrollment)
    .innerJoin(section, eq(section.id, enrollment.sectionId))
    .innerJoin(student, eq(student.id, enrollment.studentId))
    .where(and(eq(enrollment.schoolId, t.schoolId), eq(enrollment.yearId, year.id), eq(student.status, 'active')))
    .groupBy(section.gradeId);

  return c.json({
    year,
    plans: plans.map((p) => {
      const gradeIds = grades.filter((g) => g.planId === p.id).map((g) => g.gradeId);
      const inst = instalments
        .filter((i) => i.planId === p.id)
        .map((i) => ({
          id: i.id,
          name: i.name,
          dueOn: i.dueOn,
          amounts: Object.fromEntries(lines.filter((l) => l.instalmentId === i.id).map((l) => [l.headId, l.amount])),
        }));
      const total = inst.reduce((sum, i) => sum + Object.values(i.amounts).reduce((a, b) => a + b, 0), 0);
      return {
        ...p,
        gradeIds,
        instalments: inst,
        totalPerStudent: total,
        studentCount: counts.filter((cnt) => gradeIds.includes(cnt.gradeId)).reduce((sum, cnt) => sum + Number(cnt.n), 0),
      };
    }),
  });
});

async function writePlanGrid(
  tx: Tx,
  schoolId: string,
  planId: string,
  instalments: z.infer<typeof planShape>['instalments'],
  headIds: Set<string>,
) {
  const existing = await tx.select().from(feeInstalment).where(and(eq(feeInstalment.schoolId, schoolId), eq(feeInstalment.planId, planId)));
  const keep = new Set(instalments.map((i) => i.id).filter(Boolean));
  const removed = existing.filter((e) => !keep.has(e.id));

  if (removed.length > 0) {
    const removedLines = await tx.select({ id: feeLine.id }).from(feeLine).where(inArray(feeLine.instalmentId, removed.map((r) => r.id)));
    if (removedLines.length > 0) {
      const charges = await tx.select({ id: feeCharge.id }).from(feeCharge).where(inArray(feeCharge.lineId, removedLines.map((l) => l.id)));
      const paid = await allocatedByCharge(tx, schoolId, charges.map((ch) => ch.id));
      if ([...paid.values()].some((v) => v > 0)) {
        throw conflict('Fees have already been collected against an instalment you removed. Set its amounts to zero instead, or cancel those receipts first.');
      }
      if (charges.length) await tx.delete(feeCharge).where(inArray(feeCharge.id, charges.map((ch) => ch.id)));
    }
    await tx.delete(feeInstalment).where(inArray(feeInstalment.id, removed.map((r) => r.id)));
  }

  for (const [position, inst] of instalments.entries()) {
    for (const headId of Object.keys(inst.amounts)) {
      if (!headIds.has(headId)) throw invalid('One of those fee heads does not belong to this school.');
    }
    let instalmentId = inst.id;
    if (instalmentId && existing.some((e) => e.id === instalmentId)) {
      await tx.update(feeInstalment).set({ name: inst.name, dueOn: inst.dueOn, position }).where(eq(feeInstalment.id, instalmentId));
    } else {
      const [created] = await tx.insert(feeInstalment).values({ schoolId, planId, name: inst.name, dueOn: inst.dueOn, position }).returning();
      instalmentId = created.id;
    }
    for (const [headId, amount] of Object.entries(inst.amounts)) {
      await tx
        .insert(feeLine)
        .values({ schoolId, planId, instalmentId: instalmentId!, headId, amount })
        .onConflictDoUpdate({ target: [feeLine.instalmentId, feeLine.headId], set: { amount } });
    }
  }
}

/** Active students whose class follows this plan — whose late fees need recalculating. */
async function studentsOnPlan(db: DbOrTx, schoolId: string, planId: string, yearId: string): Promise<string[]> {
  const rows = await db
    .selectDistinct({ id: enrollment.studentId })
    .from(feePlanGrade)
    .innerJoin(section, and(eq(section.gradeId, feePlanGrade.gradeId), eq(section.yearId, yearId)))
    .innerJoin(enrollment, and(eq(enrollment.sectionId, section.id), eq(enrollment.yearId, yearId)))
    .innerJoin(student, eq(student.id, enrollment.studentId))
    .where(and(eq(feePlanGrade.schoolId, schoolId), eq(feePlanGrade.planId, planId), eq(student.status, 'active')));
  return rows.map((r) => r.id);
}

async function checkGrades(
  db: Db,
  schoolId: string,
  yearId: string,
  gradeIds: string[],
  planId: string | null,
) {
  const valid = await db.select({ id: grade.id, name: grade.name }).from(grade).where(and(eq(grade.schoolId, schoolId), inArray(grade.id, gradeIds)));
  if (valid.length !== new Set(gradeIds).size) throw invalid('One of those classes does not belong to this school.');
  const taken = await db
    .select({ gradeId: feePlanGrade.gradeId, planId: feePlanGrade.planId, planName: feePlan.name })
    .from(feePlanGrade)
    .innerJoin(feePlan, eq(feePlan.id, feePlanGrade.planId))
    .where(and(eq(feePlanGrade.yearId, yearId), inArray(feePlanGrade.gradeId, gradeIds)));
  const clash = taken.find((tk) => tk.planId !== planId);
  if (clash) {
    const name = valid.find((v) => v.id === clash.gradeId)?.name;
    throw conflict(`Class ${name} already follows the plan “${clash.planName}” this year.`);
  }
}

feeRoutes.post('/fees/plans', async (c) => {
  const db = c.get('db');
  const t = c.get('tenant');
  requirePermission(t, 'fees.manage');
  const body = await readBody(c, planShape);
  const year = await resolveYear(db, t, body.yearId);
  await checkGrades(db, t.schoolId, year.id, body.gradeIds, null);
  const heads = new Set((await db.select({ id: feeHead.id }).from(feeHead).where(eq(feeHead.schoolId, t.schoolId))).map((h) => h.id));

  const result = await db.transaction(async (tx) => {
    const [clash] = await tx.select({ id: feePlan.id }).from(feePlan).where(and(eq(feePlan.yearId, year.id), eq(feePlan.name, body.name)));
    if (clash) throw conflict(`There is already a plan called ${body.name} this year.`);
    const fine = body.fine ?? noFine;
    const [plan] = await tx
      .insert(feePlan)
      .values({
        schoolId: t.schoolId,
        yearId: year.id,
        name: body.name,
        ...fineColumns(fine),
      })
      .returning();
    await tx.insert(feePlanGrade).values(body.gradeIds.map((gradeId) => ({ schoolId: t.schoolId, planId: plan.id, yearId: year.id, gradeId })));
    await writePlanGrid(tx, t.schoolId, plan.id, body.instalments.map((i) => ({ ...i, id: undefined })), heads);
    const sync = await syncPlanCharges(tx, t, plan.id);
    const fines = await applyFines(tx, t, { studentIds: await studentsOnPlan(tx, t.schoolId, plan.id, year.id) });
    await audit(tx, t, { action: 'feeplan.created', entityType: 'fee_plan', entityId: plan.id, summary: `Created fee plan ${plan.name} — charges for ${sync.created ? 'students on it' : 'no students yet'}`, data: { ...sync, fines } });
    return { plan, sync, fines };
  });
  return c.json(result, 201);
});

feeRoutes.put('/fees/plans/:id', async (c) => {
  const db = c.get('db');
  const t = c.get('tenant');
  requirePermission(t, 'fees.manage');
  const id = c.req.param('id');
  const body = await readBody(c, planShape);
  const [plan] = await db.select().from(feePlan).where(and(eq(feePlan.schoolId, t.schoolId), eq(feePlan.id, id)));
  if (!plan) throw notFound('That fee plan');
  await checkGrades(db, t.schoolId, plan.yearId, body.gradeIds, plan.id);
  const heads = new Set((await db.select({ id: feeHead.id }).from(feeHead).where(eq(feeHead.schoolId, t.schoolId))).map((h) => h.id));

  const result = await db.transaction(async (tx) => {
    const fine = body.fine ?? noFine;
    await tx
      .update(feePlan)
      .set({ name: body.name, ...fineColumns(fine) })
      .where(eq(feePlan.id, plan.id));

    // Classes taken off the plan lose their unpaid charges from it.
    const before = await tx.select({ gradeId: feePlanGrade.gradeId }).from(feePlanGrade).where(eq(feePlanGrade.planId, plan.id));
    const dropped = before.map((b) => b.gradeId).filter((g) => !body.gradeIds.includes(g));
    await tx.delete(feePlanGrade).where(eq(feePlanGrade.planId, plan.id));
    await tx.insert(feePlanGrade).values(body.gradeIds.map((gradeId) => ({ schoolId: t.schoolId, planId: plan.id, yearId: plan.yearId, gradeId })));

    await writePlanGrid(tx, t.schoolId, plan.id, body.instalments, heads);

    if (dropped.length > 0) {
      const affected = await tx
        .select({ studentId: enrollment.studentId })
        .from(enrollment)
        .innerJoin(section, eq(section.id, enrollment.sectionId))
        .where(and(eq(enrollment.yearId, plan.yearId), inArray(section.gradeId, dropped)));
      for (const a of affected) await syncStudentCharges(tx, t, a.studentId, plan.yearId);
    }
    const sync = await syncPlanCharges(tx, t, plan.id);
    const fines = await applyFines(tx, t, { studentIds: await studentsOnPlan(tx, t.schoolId, plan.id, plan.yearId) });
    await audit(tx, t, { action: 'feeplan.updated', entityType: 'fee_plan', entityId: plan.id, summary: `Updated fee plan ${body.name}`, data: { ...sync, fines } });
    return { sync, fines };
  });
  return c.json(result);
});

feeRoutes.delete('/fees/plans/:id', async (c) => {
  const db = c.get('db');
  const t = c.get('tenant');
  requirePermission(t, 'fees.manage');
  const id = c.req.param('id');
  const [plan] = await db.select().from(feePlan).where(and(eq(feePlan.schoolId, t.schoolId), eq(feePlan.id, id)));
  if (!plan) throw notFound('That fee plan');
  await db.transaction(async (tx) => {
    const lines = await tx.select({ id: feeLine.id }).from(feeLine).where(eq(feeLine.planId, id));
    if (lines.length) {
      const charges = await tx.select({ id: feeCharge.id }).from(feeCharge).where(inArray(feeCharge.lineId, lines.map((l) => l.id)));
      const paid = await allocatedByCharge(tx, t.schoolId, charges.map((ch) => ch.id));
      if ([...paid.values()].some((v) => v > 0)) throw conflict('Fees have been collected on this plan, so it cannot be deleted. Edit it instead.');
      if (charges.length) await tx.delete(feeCharge).where(inArray(feeCharge.id, charges.map((ch) => ch.id)));
    }
    await tx.delete(feePlan).where(eq(feePlan.id, id));
    await audit(tx, t, { action: 'feeplan.deleted', entityType: 'fee_plan', entityId: id, summary: `Deleted fee plan ${plan.name}` });
  });
  return c.json({ ok: true });
});

// ---------------------------------------------------------------------------
// Late fees
// ---------------------------------------------------------------------------

/**
 * Recalculates every late fee in the school as of today.
 *
 * A student's own fees are brought up to date whenever their ledger is opened or money is
 * received from them, so the counter never collects a stale figure. This is for the
 * school-wide picture — the dues list and the reminders sent from it — and is the one call
 * a nightly scheduled task would make.
 */
feeRoutes.post('/fees/fines/apply', async (c) => {
  const db = c.get('db');
  const t = c.get('tenant');
  requirePermission(t, 'fees.manage');
  const result = await db.transaction(async (tx) => {
    const counts = await applyFines(tx, t);
    await audit(tx, t, {
      action: 'fee.fines_applied',
      entityType: 'school',
      summary: `Updated late fees: ${counts.created} added, ${counts.updated} changed, ${counts.removed} dropped`,
      data: counts,
    });
    return counts;
  });
  return c.json(result);
});

// ---------------------------------------------------------------------------
// One student's ledger
// ---------------------------------------------------------------------------

async function primaryGuardian(db: Db, schoolId: string, studentId: string) {
  const [g] = await db
    .select({ name: guardian.name, phone: guardian.phone, relation: studentGuardian.relation })
    .from(studentGuardian)
    .innerJoin(guardian, eq(guardian.id, studentGuardian.guardianId))
    .where(and(eq(studentGuardian.schoolId, schoolId), eq(studentGuardian.studentId, studentId)))
    .orderBy(desc(studentGuardian.isPrimary))
    .limit(1);
  return g ?? null;
}

async function classLabel(db: Db, schoolId: string, studentId: string, yearId: string | null) {
  if (!yearId) return null;
  const [row] = await db
    .select({ gradeName: grade.name, sectionName: section.name, rollNo: enrollment.rollNo })
    .from(enrollment)
    .innerJoin(section, eq(section.id, enrollment.sectionId))
    .innerJoin(grade, eq(grade.id, section.gradeId))
    .where(and(eq(enrollment.schoolId, schoolId), eq(enrollment.studentId, studentId), eq(enrollment.yearId, yearId)));
  return row ? { label: `${row.gradeName}-${row.sectionName}`, rollNo: row.rollNo } : null;
}

feeRoutes.get('/fees/students/:id', async (c) => {
  const db = c.get('db');
  const t = c.get('tenant');
  requirePermission(t, 'fees.view');
  const id = c.req.param('id');
  const s = await getStudent(db, t, id);
  const q = readQuery(c, z.object({ yearId: z.string().optional() }));
  const year = await resolveYear(db, t, q.yearId);
  await assertCanViewStudent(db, t, id, year.id);

  // Bring this student's late fees up to today before showing a figure anyone might
  // collect against. Idempotent, and only ever touches this one student.
  if (t.permissions.has('fees.collect') || t.permissions.has('fees.manage')) {
    await db.transaction(async (tx) => {
      await applyFines(tx, t, { studentIds: [id] });
    });
  }

  // Every year, not just this one: an instalment left unpaid when a student was promoted
  // is still owed, and money handed over the counter clears the oldest of it first.
  const all = await studentCharges(db, t.schoolId, id);
  const charges = all.filter((ch) => ch.yearId === year.id);
  const earlier = await earlierYearIds(db, t.schoolId, year.startsOn);
  const broughtForwardCharges = all.filter((ch) => earlier.includes(ch.yearId));
  const years = await db
    .select({ id: academicYear.id, name: academicYear.name, startsOn: academicYear.startsOn })
    .from(academicYear)
    .where(eq(academicYear.schoolId, t.schoolId));
  const broughtForward = [...new Set(broughtForwardCharges.map((ch) => ch.yearId))]
    .map((yearId) => {
      const rows = broughtForwardCharges.filter((ch) => ch.yearId === yearId);
      const meta = years.find((y) => y.id === yearId);
      return {
        yearId,
        yearName: meta?.name ?? 'An earlier year',
        startsOn: meta?.startsOn ?? '',
        net: rows.reduce((sum, ch) => sum + ch.net, 0),
        paid: rows.reduce((sum, ch) => sum + ch.paid, 0),
        balance: rows.reduce((sum, ch) => sum + ch.balance, 0),
        charges: rows,
      };
    })
    .filter((y) => y.balance > 0)
    .sort((a, b) => a.startsOn.localeCompare(b.startsOn));

  const payments = await db
    .select()
    .from(payment)
    .where(and(eq(payment.schoolId, t.schoolId), eq(payment.studentId, id)))
    .orderBy(desc(payment.paidOn), desc(payment.createdAt));
  const allocations = payments.length
    ? await db
        .select({ paymentId: paymentAllocation.paymentId, chargeId: paymentAllocation.chargeId, amount: paymentAllocation.amount, label: feeCharge.label })
        .from(paymentAllocation)
        .innerJoin(feeCharge, eq(feeCharge.id, paymentAllocation.chargeId))
        .where(inArray(paymentAllocation.paymentId, payments.map((p) => p.id)))
    : [];
  const concessions = await db
    .select({ id: feeConcession.id, headId: feeConcession.headId, headName: feeHead.name, percent: feeConcession.percent, reason: feeConcession.reason, createdAt: feeConcession.createdAt })
    .from(feeConcession)
    .leftJoin(feeHead, eq(feeHead.id, feeConcession.headId))
    .where(and(eq(feeConcession.schoolId, t.schoolId), eq(feeConcession.studentId, id)));
  const today = todayIST();

  return c.json({
    student: { id: s.id, name: fullName(s), admissionNo: s.admissionNo, status: s.status, isRte: s.isRte },
    class: await classLabel(db, t.schoolId, id, year.id),
    guardian: await primaryGuardian(db, t.schoolId, id),
    year,
    charges,
    broughtForward,
    payments: payments.map((p) => ({ ...p, allocations: allocations.filter((a) => a.paymentId === p.id) })),
    concessions,
    totals: {
      gross: charges.reduce((sum, ch) => sum + ch.amount, 0),
      concession: charges.reduce((sum, ch) => sum + ch.concession, 0),
      net: charges.reduce((sum, ch) => sum + ch.net, 0),
      paid: charges.reduce((sum, ch) => sum + ch.paid, 0),
      balance: charges.reduce((sum, ch) => sum + ch.balance, 0),
      overdue: charges.filter((ch) => ch.dueOn < today).reduce((sum, ch) => sum + ch.balance, 0),
      fine: charges.filter((ch) => ch.kind === 'fine').reduce((sum, ch) => sum + ch.balance, 0),
      broughtForward: broughtForward.reduce((sum, y) => sum + y.balance, 0),
      /** What the student actually owes, which is what a payment may be made against. */
      balanceAll: all.reduce((sum, ch) => sum + ch.balance, 0),
    },
  });
});

feeRoutes.post('/fees/students/:id/charges', async (c) => {
  const db = c.get('db');
  const t = c.get('tenant');
  requirePermission(t, 'fees.manage');
  const id = c.req.param('id');
  await getStudent(db, t, id);
  const body = await readBody(c, z.object({ headId: z.string(), label: optionalText, amount: paise.min(1, 'Enter an amount above zero.'), dueOn: isoDate }));
  const year = await resolveYear(db, t);
  const [head] = await db.select().from(feeHead).where(and(eq(feeHead.schoolId, t.schoolId), eq(feeHead.id, body.headId)));
  if (!head) throw notFound('That fee head');

  await db.transaction(async (tx) => {
    const label = body.label || head.name;
    await tx.insert(feeCharge).values({ schoolId: t.schoolId, studentId: id, yearId: year.id, headId: head.id, label, dueOn: body.dueOn, amount: body.amount, createdBy: t.userId });
    await audit(tx, t, { action: 'fee.charged', entityType: 'student', entityId: id, studentId: id, summary: `Added a charge: ${label}, ${formatINR(body.amount)}` });
  });
  return c.json({ ok: true }, 201);
});

feeRoutes.delete('/fees/charges/:id', async (c) => {
  const db = c.get('db');
  const t = c.get('tenant');
  requirePermission(t, 'fees.manage');
  const id = c.req.param('id');
  const [charge] = await db.select().from(feeCharge).where(and(eq(feeCharge.schoolId, t.schoolId), eq(feeCharge.id, id)));
  if (!charge) throw notFound('That charge');
  if (charge.lineId) throw conflict('Charges from a fee plan are changed through the plan, or waived. Only added charges can be removed.');
  const paid = await allocatedByCharge(db, t.schoolId, [id]);
  if ((paid.get(id) ?? 0) > 0) throw conflict('Money has been received against this charge. Cancel that receipt first.');
  await db.transaction(async (tx) => {
    await tx.delete(feeCharge).where(eq(feeCharge.id, id));
    await audit(tx, t, { action: 'fee.charge_removed', entityType: 'student', entityId: charge.studentId, studentId: charge.studentId, summary: `Removed a charge: ${charge.label}, ${formatINR(charge.amount)}` });
  });
  return c.json({ ok: true });
});

/** Writes off what is left on one charge (or part of it), with a reason, and keeps it on the record. */
feeRoutes.post('/fees/charges/:id/waive', async (c) => {
  const db = c.get('db');
  const t = c.get('tenant');
  requirePermission(t, 'fees.manage');
  const id = c.req.param('id');
  const body = await readBody(c, z.object({ amount: paise.optional(), reason: requiredText('Reason', 200) }));
  const [charge] = await db.select().from(feeCharge).where(and(eq(feeCharge.schoolId, t.schoolId), eq(feeCharge.id, id)));
  if (!charge) throw notFound('That charge');
  const paid = (await allocatedByCharge(db, t.schoolId, [id])).get(id) ?? 0;
  const balance = charge.amount - charge.concession - paid;
  const amount = body.amount ?? balance;
  if (amount <= 0 || amount > balance) throw invalid(`You can waive up to ${formatINR(balance)} on this charge.`);
  await db.transaction(async (tx) => {
    await tx
      .update(feeCharge)
      .set({ concession: charge.concession + amount, concessionNote: [charge.concessionNote, `Waived ${formatINR(amount)} — ${body.reason}`].filter(Boolean).join('; ') })
      .where(eq(feeCharge.id, id));
    await audit(tx, t, { action: 'fee.waived', entityType: 'student', entityId: charge.studentId, studentId: charge.studentId, summary: `Waived ${formatINR(amount)} of ${charge.label}: ${body.reason}` });
  });
  return c.json({ ok: true });
});

/**
 * Gives a standing concession. `alsoStudentIds` applies the same one to the student's
 * siblings in the same breath — a sibling discount is decided for the family, not child by
 * child, and doing it in one transaction means it cannot end up on only some of them.
 */
feeRoutes.post('/fees/students/:id/concessions', async (c) => {
  const db = c.get('db');
  const t = c.get('tenant');
  requirePermission(t, 'fees.manage');
  const id = c.req.param('id');
  await getStudent(db, t, id);
  const body = await readBody(
    c,
    z.object({
      headId: z.string().nullable(),
      percent: z.number().int().min(1).max(100),
      reason: requiredText('Reason', 200),
      alsoStudentIds: z.array(z.string()).max(12).optional(),
    }),
  );
  let headName = 'all fees';
  if (body.headId) {
    const [head] = await db.select().from(feeHead).where(and(eq(feeHead.schoolId, t.schoolId), eq(feeHead.id, body.headId)));
    if (!head) throw notFound('That fee head');
    headName = head.name;
  }

  const alsoIds = [...new Set(body.alsoStudentIds ?? [])].filter((other) => other !== id);
  if (alsoIds.length > 0) {
    const found = await db
      .select({ id: student.id })
      .from(student)
      .where(and(eq(student.schoolId, t.schoolId), inArray(student.id, alsoIds)));
    if (found.length !== alsoIds.length) throw invalid('One of those students does not belong to this school.');
  }
  const targets = [id, ...alsoIds];

  const year = await findCurrentYear(db, t.schoolId);
  await db.transaction(async (tx) => {
    for (const studentId of targets) {
      await tx
        .delete(feeConcession)
        .where(and(eq(feeConcession.studentId, studentId), body.headId ? eq(feeConcession.headId, body.headId) : sql`${feeConcession.headId} is null`));
      await tx.insert(feeConcession).values({ schoolId: t.schoolId, studentId, headId: body.headId, percent: body.percent, reason: body.reason, createdBy: t.userId });
      if (year) await syncStudentCharges(tx, t, studentId, year.id);
      await audit(tx, t, {
        action: 'fee.concession',
        entityType: 'student',
        entityId: studentId,
        studentId,
        summary: `Gave a ${body.percent}% concession on ${headName}: ${body.reason}`,
      });
    }
    // The discount lowers what is owed, so a fine worked out on the old figure is stale.
    await applyFines(tx, t, { studentIds: targets });
  });
  return c.json({ ok: true, applied: targets.length }, 201);
});

feeRoutes.delete('/fees/concessions/:id', async (c) => {
  const db = c.get('db');
  const t = c.get('tenant');
  requirePermission(t, 'fees.manage');
  const [row] = await db.select().from(feeConcession).where(and(eq(feeConcession.schoolId, t.schoolId), eq(feeConcession.id, c.req.param('id'))));
  if (!row) throw notFound('That concession');
  const year = await findCurrentYear(db, t.schoolId);
  await db.transaction(async (tx) => {
    await tx.delete(feeConcession).where(eq(feeConcession.id, row.id));
    if (year) await syncStudentCharges(tx, t, row.studentId, year.id);
    await audit(tx, t, { action: 'fee.concession_removed', entityType: 'student', entityId: row.studentId, studentId: row.studentId, summary: `Removed a ${row.percent}% concession` });
  });
  return c.json({ ok: true });
});

// ---------------------------------------------------------------------------
// Receipts
// ---------------------------------------------------------------------------

const modeLabels = { cash: 'Cash', upi: 'UPI', card: 'Card', cheque: 'Cheque', bank: 'Bank transfer' } as const;
const statusLabels = { valid: 'Valid', cancelled: 'Cancelled', bounced: 'Returned by bank' } as const;

feeRoutes.post('/fees/payments', async (c) => {
  const db = c.get('db');
  const t = c.get('tenant');
  requirePermission(t, 'fees.collect');
  const body = await readBody(
    c,
    z
      .object({
        studentId: z.string(),
        amount: paise.min(1, 'Enter an amount above zero.'),
        mode: z.enum(['cash', 'upi', 'card', 'cheque', 'bank']),
        reference: optionalText,
        paidOn: isoDate.optional(),
        note: optionalText,
        allocations: z.array(z.object({ chargeId: z.string(), amount: paise })).optional(),
      })
      .refine((p) => p.mode !== 'cheque' || Boolean(p.reference), { message: 'Enter the cheque number.', path: ['reference'] }),
  );
  const s = await getStudent(db, t, body.studentId);
  const paidOn = body.paidOn ?? todayIST();
  if (paidOn > todayIST()) throw invalid('A payment cannot be dated in the future.', { paidOn: 'Use today or an earlier date.' });
  await assertDayOpen(db, t.schoolId, paidOn);

  const created = await db.transaction(async (tx) => {
    // Bring late fees up to date first, so the lock below covers any fine this creates and
    // two counters cannot both allocate money to a brand-new fine charge.
    await applyFines(tx, t, { studentIds: [s.id] });
    // Lock this student's charges so two counters cannot allocate the same balance twice.
    await tx.execute(sql`select id from ${feeCharge} where ${feeCharge.studentId} = ${s.id} for update`);
    const charges = await studentCharges(tx, t.schoolId, s.id);
    const split = planAllocation(charges, body.amount, body.allocations);

    const year = await findCurrentYear(tx, t.schoolId);
    const yearKey = year ? `${year.startsOn.slice(0, 4)}-${year.endsOn.slice(2, 4)}` : paidOn.slice(0, 4);
    const [profile] = await tx.select({ prefix: schoolProfile.receiptPrefix }).from(schoolProfile).where(eq(schoolProfile.schoolId, t.schoolId));
    const seq = await nextNumber(tx, t.schoolId, `receipt:${yearKey}`);
    const receiptNo = `${profile?.prefix ?? 'RCT'}/${yearKey}/${String(seq).padStart(5, '0')}`;

    const [p] = await tx
      .insert(payment)
      .values({
        schoolId: t.schoolId,
        studentId: s.id,
        receiptNo,
        amount: body.amount,
        mode: body.mode,
        reference: body.reference,
        paidOn,
        note: body.note,
        receivedBy: t.userId,
        receivedByName: t.userName,
      })
      .returning();
    await tx.insert(paymentAllocation).values(split.map((a) => ({ schoolId: t.schoolId, paymentId: p.id, chargeId: a.chargeId, amount: a.amount })));
    await audit(tx, t, {
      action: 'fee.received',
      entityType: 'payment',
      entityId: p.id,
      studentId: s.id,
      summary: `Received ${formatINR(body.amount)} by ${modeLabels[body.mode]} — receipt ${receiptNo}`,
    });
    return p;
  });
  return c.json(created, 201);
});

feeRoutes.get('/fees/payments/:id', async (c) => {
  const db = c.get('db');
  const t = c.get('tenant');
  requirePermission(t, 'fees.view');
  const [p] = await db.select().from(payment).where(and(eq(payment.schoolId, t.schoolId), eq(payment.id, c.req.param('id'))));
  if (!p) throw notFound('That receipt');
  const s = await getStudent(db, t, p.studentId);
  const lines = await db
    .select({ label: feeCharge.label, amount: paymentAllocation.amount, dueOn: feeCharge.dueOn })
    .from(paymentAllocation)
    .innerJoin(feeCharge, eq(feeCharge.id, paymentAllocation.chargeId))
    .where(eq(paymentAllocation.paymentId, p.id))
    .orderBy(asc(feeCharge.dueOn));
  const [school] = await db
    .select({ name: organization.name, profile: schoolProfile })
    .from(organization)
    .leftJoin(schoolProfile, eq(schoolProfile.schoolId, organization.id))
    .where(eq(organization.id, t.schoolId));
  const year = await findCurrentYear(db, t.schoolId);
  // Every year, not just this one: a parent reading "balance due" on a slip means
  // everything they still owe, and an instalment left unpaid last year is part of it.
  const charges = await studentCharges(db, t.schoolId, s.id);

  return c.json({
    payment: p,
    modeLabel: modeLabels[p.mode],
    statusLabel: statusLabels[p.status],
    amountInWords: rupeesInWords(p.amount),
    lines,
    student: { id: s.id, name: fullName(s), admissionNo: s.admissionNo },
    class: await classLabel(db, t.schoolId, s.id, year?.id ?? null),
    guardian: await primaryGuardian(db, t.schoolId, s.id),
    school: {
      name: school?.name,
      address: [school?.profile?.address, school?.profile?.city, school?.profile?.state, school?.profile?.pincode].filter(Boolean).join(', '),
      phone: school?.profile?.phone,
      email: school?.profile?.email,
      affiliationNo: school?.profile?.affiliationNo,
      board: school?.profile?.board,
    },
    balanceNow: charges.reduce((sum, ch) => sum + ch.balance, 0),
  });
});

/** A receipt the school should not have written. The money was never really received. */
feeRoutes.post('/fees/payments/:id/cancel', async (c) => {
  const db = c.get('db');
  const t = c.get('tenant');
  requirePermission(t, 'fees.manage');
  const body = await readBody(c, z.object({ reason: requiredText('Reason', 300) }));
  const [p] = await db.select().from(payment).where(and(eq(payment.schoolId, t.schoolId), eq(payment.id, c.req.param('id'))));
  if (!p) throw notFound('That receipt');
  if (p.status === 'cancelled') throw conflict('This receipt is already cancelled.');
  if (p.status === 'bounced') throw conflict('This receipt was returned by the bank. It is already off the books.');
  await assertDayOpen(db, t.schoolId, p.paidOn);
  await db.transaction(async (tx) => {
    await tx.update(payment).set({ status: 'cancelled', cancelledAt: new Date(), cancelledByName: t.userName, cancelReason: body.reason }).where(eq(payment.id, p.id));
    await audit(tx, t, { action: 'fee.cancelled', entityType: 'payment', entityId: p.id, studentId: p.studentId, summary: `Cancelled receipt ${p.receiptNo} (${formatINR(p.amount)}): ${body.reason}` });
    // The dues are owed again, so a late fee may apply to them again.
    await applyFines(tx, t, { studentIds: [p.studentId] });
  });
  return c.json({ ok: true });
});

/**
 * A cheque (or a transfer) the bank sent back.
 *
 * Deliberately not the same thing as a cancellation: the school did nothing wrong, the
 * parent still owes the money, and the bank usually charges the school for the trouble —
 * which `bankCharge` passes on as a charge on the student's ledger. Because only valid
 * receipts count as paid, marking it bounced puts the whole due back by itself.
 *
 * A bounced receipt is final. A cheque presented again is a new receipt, which is what the
 * second cheque is.
 */
feeRoutes.post('/fees/payments/:id/bounce', async (c) => {
  const db = c.get('db');
  const t = c.get('tenant');
  requirePermission(t, 'fees.manage');
  const body = await readBody(
    c,
    z.object({
      bouncedOn: isoDate.optional(),
      reason: requiredText('Reason', 300),
      /** What the bank charged. Leave out to use the school's default for this kind of receipt; 0 waives it. */
      bankCharge: paise.optional(),
    }),
  );
  const [p] = await db.select().from(payment).where(and(eq(payment.schoolId, t.schoolId), eq(payment.id, c.req.param('id'))));
  if (!p) throw notFound('That receipt');
  if (p.status === 'bounced') throw conflict('This receipt is already marked as returned.');
  if (p.status === 'cancelled') throw conflict('This receipt was cancelled, so there is nothing to return.');
  if (p.mode === 'cash' || p.mode === 'card') {
    throw conflict('Only a cheque or a transfer can be returned by the bank. Cancel the receipt instead.');
  }

  const bouncedOn = body.bouncedOn ?? todayIST();
  if (bouncedOn > todayIST()) throw invalid('The return date cannot be in the future.', { bouncedOn: 'Use today or an earlier date.' });
  if (bouncedOn < p.paidOn) throw invalid('The bank cannot have returned it before it was received.', { bouncedOn: `Use ${formatDateIN(p.paidOn)} or later.` });
  // The receipt leaves the books on the day it was taken, so that day's figures change.
  await assertDayOpen(db, t.schoolId, p.paidOn);

  const s = await getStudent(db, t, p.studentId);
  const year = await findCurrentYear(db, t.schoolId);

  await db.transaction(async (tx) => {
    await tx.update(payment).set({ status: 'bounced', bouncedOn, bounceReason: body.reason }).where(eq(payment.id, p.id));

    // What the bank charged: whatever was entered (0 waives it), otherwise the school's own
    // default for this kind of receipt, under the head name the school has chosen.
    const settings = await feeSettings(tx, t.schoolId);
    const bankCharge = body.bankCharge ?? (p.mode === 'cheque' ? settings.bankChargeCheque : settings.bankChargeTransfer);
    if (bankCharge > 0) {
      if (!year) throw conflict('Set up an academic year before adding a bank charge.');
      const head = await headByName(tx, t.schoolId, settings.bankChargeHead || BANK_CHARGE_HEAD);
      const label = `${head.name} —${p.mode === 'cheque' ? 'cheque' : 'transfer'} ${p.reference ?? p.receiptNo} returned`;
      await tx.insert(feeCharge).values({
        schoolId: t.schoolId,
        studentId: s.id,
        yearId: year.id,
        headId: head.id,
        label,
        dueOn: bouncedOn,
        amount: bankCharge,
        createdBy: t.userId,
      });
    }

    await audit(tx, t, {
      action: 'fee.bounced',
      entityType: 'payment',
      entityId: p.id,
      studentId: p.studentId,
      summary: `Receipt ${p.receiptNo} (${formatINR(p.amount)}) returned by the bank on ${formatDateIN(bouncedOn)}: ${body.reason}`,
      data: { bankCharge, reference: p.reference },
    });
    // The instalment is unpaid again, so its late fee starts counting again from its own
    // due date — the parent's cheque bouncing does not buy them time.
    await applyFines(tx, t, { studentIds: [p.studentId] });
  });
  return c.json({ ok: true });
});

// ---------------------------------------------------------------------------
// Dues, collections, summary
// ---------------------------------------------------------------------------

feeRoutes.get('/fees/dues', async (c) => {
  const db = c.get('db');
  const t = c.get('tenant');
  requirePermission(t, 'fees.view');
  const q = readQuery(
    c,
    z.object({
      gradeId: z.string().optional(),
      sectionId: z.string().optional(),
      overdueOnly: z.enum(['true', 'false']).default('true'),
      yearId: z.string().optional(),
    }),
  );
  const year = await resolveYear(db, t, q.yearId);
  const today = todayIST();
  // Anything left unpaid in an earlier year is still owed and belongs on this list, under
  // the class the student is in now.
  const earlier = await earlierYearIds(db, t.schoolId, year.startsOn);

  const filters = [
    eq(feeCharge.schoolId, t.schoolId),
    inArray(feeCharge.yearId, [year.id, ...earlier]),
    eq(student.status, 'active'),
  ];
  // "Overdue only" applies to this year. An earlier year's dues are overdue by definition.
  if (q.overdueOnly === 'true') filters.push(sql`(${feeCharge.dueOn} < ${today} or ${feeCharge.yearId} <> ${year.id})`);
  if (q.sectionId) filters.push(eq(enrollment.sectionId, q.sectionId));
  if (q.gradeId) filters.push(eq(section.gradeId, q.gradeId));

  const rows = await db
    .select({
      chargeId: feeCharge.id,
      yearId: feeCharge.yearId,
      studentId: student.id,
      firstName: student.firstName,
      lastName: student.lastName,
      admissionNo: student.admissionNo,
      gradeName: grade.name,
      gradePosition: grade.position,
      sectionName: section.name,
      rollNo: enrollment.rollNo,
      dueOn: feeCharge.dueOn,
      fineFor: feeCharge.fineForInstalmentId,
      net: sql<number>`(${feeCharge.amount} - ${feeCharge.concession})::int`,
    })
    .from(feeCharge)
    .innerJoin(student, eq(student.id, feeCharge.studentId))
    .leftJoin(enrollment, and(eq(enrollment.studentId, student.id), eq(enrollment.yearId, year.id)))
    .leftJoin(section, eq(section.id, enrollment.sectionId))
    .leftJoin(grade, eq(grade.id, section.gradeId))
    .where(and(...filters));

  const paid = await allocatedByCharge(db, t.schoolId, rows.map((r) => r.chargeId));
  const byStudent = new Map<
    string,
    {
      studentId: string;
      name: string;
      admissionNo: string;
      classLabel: string | null;
      gradePosition: number;
      rollNo: number | null;
      due: number;
      broughtForward: number;
      fine: number;
      total: number;
      oldestDue: string;
      charges: number;
    }
  >();
  for (const r of rows) {
    const balance = Number(r.net) - (paid.get(r.chargeId) ?? 0);
    if (balance <= 0) continue;
    const entry = byStudent.get(r.studentId) ?? {
      studentId: r.studentId,
      name: fullName(r),
      admissionNo: r.admissionNo,
      classLabel: r.gradeName ? `${r.gradeName}-${r.sectionName}` : null,
      gradePosition: r.gradePosition ?? 999,
      rollNo: r.rollNo,
      due: 0,
      broughtForward: 0,
      fine: 0,
      total: 0,
      oldestDue: r.dueOn,
      charges: 0,
    };
    if (r.yearId === year.id) entry.due += balance;
    else entry.broughtForward += balance;
    if (r.fineFor) entry.fine += balance;
    entry.total += balance;
    entry.charges += 1;
    if (r.dueOn < entry.oldestDue) entry.oldestDue = r.dueOn;
    byStudent.set(r.studentId, entry);
  }

  const list = [...byStudent.values()];
  const phones = list.length
    ? await db
        .select({ studentId: studentGuardian.studentId, name: guardian.name, phone: guardian.phone, isPrimary: studentGuardian.isPrimary })
        .from(studentGuardian)
        .innerJoin(guardian, eq(guardian.id, studentGuardian.guardianId))
        .where(and(eq(studentGuardian.schoolId, t.schoolId), inArray(studentGuardian.studentId, list.map((l) => l.studentId))))
    : [];

  return c.json({
    asOf: today,
    total: list.reduce((sum, l) => sum + l.total, 0),
    thisYear: list.reduce((sum, l) => sum + l.due, 0),
    broughtForward: list.reduce((sum, l) => sum + l.broughtForward, 0),
    fine: list.reduce((sum, l) => sum + l.fine, 0),
    rows: list
      .map((l) => {
        const g = phones.filter((p) => p.studentId === l.studentId).sort((a, b) => Number(b.isPrimary) - Number(a.isPrimary))[0];
        return { ...l, guardianName: g?.name ?? null, guardianPhone: g?.phone ?? null };
      })
      .sort((a, b) => a.gradePosition - b.gradePosition || (a.classLabel ?? '').localeCompare(b.classLabel ?? '') || (a.rollNo ?? 0) - (b.rollNo ?? 0)),
  });
});

feeRoutes.get('/fees/collections', async (c) => {
  const db = c.get('db');
  const t = c.get('tenant');
  requirePermission(t, 'fees.view');
  const today = todayIST();
  const q = readQuery(c, z.object({ from: isoDate.default(today), to: isoDate.default(today) }));
  if (q.from > q.to) throw invalid('The start date must be before the end date.');

  const rows = await db
    .select({
      id: payment.id,
      receiptNo: payment.receiptNo,
      amount: payment.amount,
      mode: payment.mode,
      reference: payment.reference,
      paidOn: payment.paidOn,
      status: payment.status,
      receivedByName: payment.receivedByName,
      cancelReason: payment.cancelReason,
      bounceReason: payment.bounceReason,
      bouncedOn: payment.bouncedOn,
      createdAt: payment.createdAt,
      studentId: student.id,
      firstName: student.firstName,
      lastName: student.lastName,
      admissionNo: student.admissionNo,
    })
    .from(payment)
    .innerJoin(student, eq(student.id, payment.studentId))
    .where(and(eq(payment.schoolId, t.schoolId), between(payment.paidOn, q.from, q.to)))
    .orderBy(desc(payment.paidOn), desc(payment.createdAt));

  const valid = rows.filter((r) => r.status === 'valid');
  const byMode: Record<string, number> = {};
  for (const r of valid) byMode[r.mode] = (byMode[r.mode] ?? 0) + r.amount;

  return c.json({
    from: q.from,
    to: q.to,
    total: valid.reduce((sum, r) => sum + r.amount, 0),
    count: valid.length,
    bounced: rows.filter((r) => r.status === 'bounced').reduce((sum, r) => sum + r.amount, 0),
    byMode,
    rows: rows.map((r) => ({ ...r, studentName: fullName(r), modeLabel: modeLabels[r.mode], statusLabel: statusLabels[r.status] })),
  });
});

// ---------------------------------------------------------------------------
// The day book
// ---------------------------------------------------------------------------

/**
 * One day, as the accountant needs to see it before signing off: what came in, split by
 * how it was paid and by who took it, what the cash drawer should hold, and anything that
 * left the books that day.
 */
feeRoutes.get('/fees/daybook', async (c) => {
  const db = c.get('db');
  const t = c.get('tenant');
  requirePermission(t, 'fees.view');
  const today = todayIST();
  const q = readQuery(c, z.object({ date: isoDate.default(today) }));
  if (q.date > today) throw invalid('There is no day book for a day that has not happened.');

  const rows = await db
    .select({
      id: payment.id,
      receiptNo: payment.receiptNo,
      amount: payment.amount,
      mode: payment.mode,
      reference: payment.reference,
      status: payment.status,
      note: payment.note,
      receivedByName: payment.receivedByName,
      cancelReason: payment.cancelReason,
      bounceReason: payment.bounceReason,
      bouncedOn: payment.bouncedOn,
      createdAt: payment.createdAt,
      studentId: student.id,
      firstName: student.firstName,
      lastName: student.lastName,
      admissionNo: student.admissionNo,
    })
    .from(payment)
    .innerJoin(student, eq(student.id, payment.studentId))
    .where(and(eq(payment.schoolId, t.schoolId), eq(payment.paidOn, q.date)))
    .orderBy(asc(payment.receiptNo));

  const valid = rows.filter((r) => r.status === 'valid');
  const byMode = (['cash', 'upi', 'cheque', 'bank', 'card'] as const)
    .map((mode) => {
      const hits = valid.filter((r) => r.mode === mode);
      return { mode, modeLabel: modeLabels[mode], amount: hits.reduce((s, r) => s + r.amount, 0), count: hits.length };
    })
    .filter((m) => m.count > 0);

  const collectors = new Map<string, { name: string; amount: number; count: number }>();
  for (const r of valid) {
    const name = r.receivedByName ?? 'Not recorded';
    const entry = collectors.get(name) ?? { name, amount: 0, count: 0 };
    entry.amount += r.amount;
    entry.count += 1;
    collectors.set(name, entry);
  }

  const [close] = await db
    .select()
    .from(feeDayClose)
    .where(and(eq(feeDayClose.schoolId, t.schoolId), eq(feeDayClose.day, q.date)))
    .limit(1);

  // Earlier days that took money and were never signed off, so nothing quietly stays open.
  const takings = await db
    .select({ day: payment.paidOn, total: sql<number>`coalesce(sum(${payment.amount}), 0)::int` })
    .from(payment)
    .where(and(eq(payment.schoolId, t.schoolId), eq(payment.status, 'valid'), lt(payment.paidOn, q.date)))
    .groupBy(payment.paidOn)
    .orderBy(desc(payment.paidOn))
    .limit(60);
  const closedDays = new Set(
    (
      await db
        .select({ day: feeDayClose.day })
        .from(feeDayClose)
        .where(eq(feeDayClose.schoolId, t.schoolId))
    ).map((d) => d.day),
  );
  const stillOpen = takings.filter((d) => !closedDays.has(d.day)).slice(0, 14);

  return c.json({
    date: q.date,
    close: close ?? null,
    expectedCash: byMode.find((m) => m.mode === 'cash')?.amount ?? 0,
    totals: {
      collected: valid.reduce((s, r) => s + r.amount, 0),
      count: valid.length,
      cancelled: rows.filter((r) => r.status === 'cancelled').reduce((s, r) => s + r.amount, 0),
      cancelledCount: rows.filter((r) => r.status === 'cancelled').length,
      bounced: rows.filter((r) => r.status === 'bounced').reduce((s, r) => s + r.amount, 0),
      bouncedCount: rows.filter((r) => r.status === 'bounced').length,
    },
    byMode,
    byCollector: [...collectors.values()].sort((a, b) => b.amount - a.amount),
    stillOpen,
    rows: rows.map((r) => ({ ...r, studentName: fullName(r), modeLabel: modeLabels[r.mode], statusLabel: statusLabels[r.status] })),
  });
});

/**
 * Signs a day off. `countedCash` is what was actually counted out of the drawer, so a
 * shortfall is recorded against the day it happened rather than found weeks later.
 * Afterwards nothing dated that day can be received, cancelled or returned.
 */
feeRoutes.post('/fees/daybook/close', async (c) => {
  const db = c.get('db');
  const t = c.get('tenant');
  requirePermission(t, 'fees.manage');
  const body = await readBody(c, z.object({ day: isoDate, countedCash: paise, note: optionalText }));
  if (body.day > todayIST()) throw invalid('A day cannot be closed before it has happened.');

  const result = await db.transaction(async (tx) => {
    const expectedCash = await expectedCashFor(tx, t.schoolId, body.day);
    const variance = body.countedCash - expectedCash;
    const [row] = await tx
      .insert(feeDayClose)
      .values({
        schoolId: t.schoolId,
        day: body.day,
        expectedCash,
        countedCash: body.countedCash,
        variance,
        note: body.note,
        closedBy: t.userId,
        closedByName: t.userName,
      })
      .onConflictDoNothing()
      .returning();
    if (!row) throw conflict(`The day book for ${formatDateIN(body.day)} is already closed.`, 'DAY_CLOSED');
    await audit(tx, t, {
      action: 'fee.day_closed',
      entityType: 'fee_day_close',
      entityId: row.id,
      summary:
        variance === 0
          ? `Closed the day book for ${formatDateIN(body.day)} — cash ${formatINR(expectedCash)}, counted and agreed`
          : `Closed the day book for ${formatDateIN(body.day)} — cash ${formatINR(expectedCash)}, counted ${formatINR(body.countedCash)} (${variance > 0 ? 'over' : 'short'} by ${formatINR(Math.abs(variance))})`,
      data: { expectedCash, countedCash: body.countedCash, variance },
    });
    return row;
  });
  return c.json(result, 201);
});

/** Reopens a day so a mistake in it can be put right. Always recorded, with a reason. */
feeRoutes.post('/fees/daybook/reopen', async (c) => {
  const db = c.get('db');
  const t = c.get('tenant');
  requirePermission(t, 'fees.manage');
  const body = await readBody(c, z.object({ day: isoDate, reason: requiredText('Reason', 300) }));
  const [close] = await db
    .select()
    .from(feeDayClose)
    .where(and(eq(feeDayClose.schoolId, t.schoolId), eq(feeDayClose.day, body.day)))
    .limit(1);
  if (!close) throw notFound('A closed day book for that date');

  await db.transaction(async (tx) => {
    await tx.delete(feeDayClose).where(and(eq(feeDayClose.schoolId, t.schoolId), eq(feeDayClose.id, close.id)));
    await audit(tx, t, {
      action: 'fee.day_reopened',
      entityType: 'fee_day_close',
      entityId: close.id,
      summary: `Reopened the day book for ${formatDateIN(body.day)}: ${body.reason}`,
      data: { expectedCash: close.expectedCash, countedCash: close.countedCash, variance: close.variance },
    });
  });
  return c.json({ ok: true });
});

feeRoutes.get('/fees/summary', async (c) => {
  const db = c.get('db');
  const t = c.get('tenant');
  requirePermission(t, 'reports.fees');
  const q = readQuery(c, z.object({ yearId: z.string().optional() }));
  const year = await resolveYear(db, t, q.yearId);
  const today = todayIST();

  const earlier = await earlierYearIds(db, t.schoolId, year.startsOn);

  const charges = await db
    .select({
      id: feeCharge.id,
      yearId: feeCharge.yearId,
      gradeId: grade.id,
      gradeName: grade.name,
      position: grade.position,
      amount: feeCharge.amount,
      concession: feeCharge.concession,
      dueOn: feeCharge.dueOn,
      fineFor: feeCharge.fineForInstalmentId,
      studentId: feeCharge.studentId,
    })
    .from(feeCharge)
    .innerJoin(student, eq(student.id, feeCharge.studentId))
    .leftJoin(enrollment, and(eq(enrollment.studentId, feeCharge.studentId), eq(enrollment.yearId, year.id)))
    .leftJoin(section, eq(section.id, enrollment.sectionId))
    .leftJoin(grade, eq(grade.id, section.gradeId))
    .where(and(eq(feeCharge.schoolId, t.schoolId), inArray(feeCharge.yearId, [year.id, ...earlier])));
  const paid = await allocatedByCharge(db, t.schoolId, charges.map((ch) => ch.id));

  type Row = {
    gradeId: string | null;
    gradeName: string;
    position: number;
    students: Set<string>;
    billed: number;
    concession: number;
    collected: number;
    outstanding: number;
    overdue: number;
    fine: number;
    /** Still owed from a year before this one, shown against the class they are in now. */
    broughtForward: number;
  };
  const byGrade = new Map<string, Row>();
  for (const ch of charges) {
    const key = ch.gradeId ?? 'none';
    const row =
      byGrade.get(key) ??
      ({
        gradeId: ch.gradeId,
        gradeName: ch.gradeName ?? 'No class',
        position: ch.position ?? 999,
        students: new Set(),
        billed: 0,
        concession: 0,
        collected: 0,
        outstanding: 0,
        overdue: 0,
        fine: 0,
        broughtForward: 0,
      } satisfies Row);
    const p = paid.get(ch.id) ?? 0;
    const balance = ch.amount - ch.concession - p;

    if (ch.yearId !== year.id) {
      // Keep this year's billed and collected figures about this year only, so they still
      // reconcile against the plans; what is older sits in its own column.
      row.broughtForward += balance;
      row.students.add(ch.studentId);
      byGrade.set(key, row);
      continue;
    }

    row.students.add(ch.studentId);
    row.billed += ch.amount;
    row.concession += ch.concession;
    row.collected += p;
    row.outstanding += balance;
    if (ch.dueOn < today) row.overdue += balance;
    if (ch.fineFor) row.fine += balance;
    byGrade.set(key, row);
  }
  const rows = [...byGrade.values()].sort((a, b) => a.position - b.position).map((r) => ({ ...r, students: r.students.size }));
  const sum = (k: 'billed' | 'concession' | 'collected' | 'outstanding' | 'overdue' | 'fine' | 'broughtForward') =>
    rows.reduce((s, r) => s + r[k], 0);

  return c.json({
    year,
    rows,
    totals: {
      billed: sum('billed'),
      concession: sum('concession'),
      collected: sum('collected'),
      outstanding: sum('outstanding'),
      overdue: sum('overdue'),
      fine: sum('fine'),
      broughtForward: sum('broughtForward'),
    },
  });
});


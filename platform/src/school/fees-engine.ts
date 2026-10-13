// The fee rules, in one place.
//
// A fee plan is a grid (instalments × heads) applied to class levels for a year. Each
// student in those classes gets one charge per non-zero cell, with their concessions
// worked out at that moment. Charges are what payments are allocated against, so a
// balance is always: Σ(charge − concession) − Σ(allocations of valid receipts).
//
// Editing a plan re-syncs everyone on it. A charge that already has money against it is
// only changed if its new amount still covers what was paid — a receipt is never left
// pointing at more money than the charge is now worth.
import { and, asc, eq, inArray, isNotNull, sql } from 'drizzle-orm';
import type { DbOrTx } from '../db';
import {
  enrollment,
  feeCharge,
  feeConcession,
  feeHead,
  feeInstalment,
  feeLine,
  feePlan,
  feePlanGrade,
  payment,
  paymentAllocation,
  section,
  student,
} from '../db/school-schema';
import { conflict, invalid } from '../lib/http';
import type { Tenant } from './tenant';

type Concession = { headId: string | null; percent: number; reason: string };

/** RTE admissions owe nothing; otherwise a rule for this head beats a rule for everything. */
export function concessionFor(
  amount: number,
  headId: string,
  isRte: boolean,
  rules: Concession[],
): { amount: number; note: string | null } {
  if (isRte) return { amount, note: 'RTE admission' };
  const rule = rules.find((r) => r.headId === headId) ?? rules.find((r) => r.headId === null);
  if (!rule || rule.percent <= 0) return { amount: 0, note: null };
  return { amount: Math.min(amount, Math.round((amount * rule.percent) / 100)), note: `${rule.percent}% — ${rule.reason}` };
}

/** Paid so far against each charge, counting only receipts that have not been cancelled. */
export async function allocatedByCharge(db: DbOrTx, schoolId: string, chargeIds: string[]): Promise<Map<string, number>> {
  const result = new Map<string, number>();
  if (chargeIds.length === 0) return result;
  const rows = await db
    .select({ chargeId: paymentAllocation.chargeId, total: sql<number>`coalesce(sum(${paymentAllocation.amount}), 0)::int` })
    .from(paymentAllocation)
    .innerJoin(payment, eq(payment.id, paymentAllocation.paymentId))
    .where(
      and(
        eq(paymentAllocation.schoolId, schoolId),
        eq(payment.status, 'valid'),
        inArray(paymentAllocation.chargeId, chargeIds),
      ),
    )
    .groupBy(paymentAllocation.chargeId);
  for (const row of rows) result.set(row.chargeId, Number(row.total));
  return result;
}

/**
 * Brings every student on a plan in line with it. Pass `onlyStudentIds` to sync just those
 * students (a new admission, a changed concession). Returns what changed, for the audit trail.
 */
export async function syncPlanCharges(
  db: DbOrTx,
  tenant: Tenant,
  planId: string,
  onlyStudentIds?: string[],
): Promise<{ created: number; updated: number; skipped: number }> {
  const schoolId = tenant.schoolId;
  const [plan] = await db
    .select()
    .from(feePlan)
    .where(and(eq(feePlan.schoolId, schoolId), eq(feePlan.id, planId)))
    .limit(1);
  if (!plan) return { created: 0, updated: 0, skipped: 0 };

  const lines = await db
    .select({
      id: feeLine.id,
      headId: feeLine.headId,
      headName: feeHead.name,
      amount: feeLine.amount,
      instalmentName: feeInstalment.name,
      dueOn: feeInstalment.dueOn,
    })
    .from(feeLine)
    .innerJoin(feeInstalment, eq(feeInstalment.id, feeLine.instalmentId))
    .innerJoin(feeHead, eq(feeHead.id, feeLine.headId))
    .where(and(eq(feeLine.schoolId, schoolId), eq(feeLine.planId, planId)));

  const gradeRows = await db
    .select({ gradeId: feePlanGrade.gradeId })
    .from(feePlanGrade)
    .where(and(eq(feePlanGrade.schoolId, schoolId), eq(feePlanGrade.planId, planId)));
  const gradeIds = gradeRows.map((g) => g.gradeId);
  if (gradeIds.length === 0) return { created: 0, updated: 0, skipped: 0 };

  const studentFilter = [
    eq(enrollment.schoolId, schoolId),
    eq(enrollment.yearId, plan.yearId),
    inArray(section.gradeId, gradeIds),
    eq(student.status, 'active'),
  ];
  if (onlyStudentIds) {
    if (onlyStudentIds.length === 0) return { created: 0, updated: 0, skipped: 0 };
    studentFilter.push(inArray(enrollment.studentId, onlyStudentIds));
  }

  const students = await db
    .select({ id: student.id, isRte: student.isRte })
    .from(enrollment)
    .innerJoin(section, eq(section.id, enrollment.sectionId))
    .innerJoin(student, eq(student.id, enrollment.studentId))
    .where(and(...studentFilter));
  if (students.length === 0) return { created: 0, updated: 0, skipped: 0 };

  const studentIds = students.map((s) => s.id);
  const rules = await db
    .select({ studentId: feeConcession.studentId, headId: feeConcession.headId, percent: feeConcession.percent, reason: feeConcession.reason })
    .from(feeConcession)
    .where(and(eq(feeConcession.schoolId, schoolId), inArray(feeConcession.studentId, studentIds)));
  const rulesByStudent = new Map<string, Concession[]>();
  for (const r of rules) {
    const list = rulesByStudent.get(r.studentId) ?? [];
    list.push(r);
    rulesByStudent.set(r.studentId, list);
  }

  const existing = await db
    .select()
    .from(feeCharge)
    .where(
      and(
        eq(feeCharge.schoolId, schoolId),
        eq(feeCharge.yearId, plan.yearId),
        inArray(feeCharge.studentId, studentIds),
        isNotNull(feeCharge.lineId),
      ),
    );
  const existingByKey = new Map(existing.map((ch) => [`${ch.studentId}:${ch.lineId}`, ch]));
  const paid = await allocatedByCharge(db, schoolId, existing.map((ch) => ch.id));

  let created = 0;
  let updated = 0;
  let skipped = 0;
  const toInsert: (typeof feeCharge.$inferInsert)[] = [];
  const lineIds = new Set(lines.map((l) => l.id));

  for (const s of students) {
    const studentRules = rulesByStudent.get(s.id) ?? [];
    for (const line of lines) {
      if (line.amount <= 0) continue;
      const concession = concessionFor(line.amount, line.headId, s.isRte, studentRules);
      const label = `${line.headName} — ${line.instalmentName}`;
      const current = existingByKey.get(`${s.id}:${line.id}`);

      if (!current) {
        toInsert.push({
          schoolId,
          studentId: s.id,
          yearId: plan.yearId,
          lineId: line.id,
          headId: line.headId,
          instalmentName: line.instalmentName,
          label,
          dueOn: line.dueOn,
          amount: line.amount,
          concession: concession.amount,
          concessionNote: concession.note,
          createdBy: tenant.userId,
        });
        created += 1;
        continue;
      }

      const unchanged =
        current.amount === line.amount &&
        current.concession === concession.amount &&
        current.dueOn === line.dueOn &&
        current.label === label &&
        current.concessionNote === concession.note;
      if (unchanged) continue;

      const alreadyPaid = paid.get(current.id) ?? 0;
      if (line.amount - concession.amount < alreadyPaid) {
        skipped += 1;
        continue;
      }
      await db
        .update(feeCharge)
        .set({
          amount: line.amount,
          concession: concession.amount,
          concessionNote: concession.note,
          dueOn: line.dueOn,
          label,
          instalmentName: line.instalmentName,
        })
        .where(and(eq(feeCharge.schoolId, schoolId), eq(feeCharge.id, current.id)));
      updated += 1;
    }
  }

  // Charges for cells that are now empty (amount set to zero) go if nothing was paid on them.
  for (const ch of existing) {
    if (!ch.lineId || !lineIds.has(ch.lineId)) continue;
    const line = lines.find((l) => l.id === ch.lineId);
    if (line && line.amount <= 0 && !(paid.get(ch.id) ?? 0)) {
      await db.delete(feeCharge).where(and(eq(feeCharge.schoolId, schoolId), eq(feeCharge.id, ch.id)));
      updated += 1;
    }
  }

  if (toInsert.length > 0) {
    for (let i = 0; i < toInsert.length; i += 500) {
      await db.insert(feeCharge).values(toInsert.slice(i, i + 500)).onConflictDoNothing();
    }
  }

  return { created, updated, skipped };
}

/** Finds the plan a student's class follows this year and syncs just them. */
export async function syncStudentCharges(db: DbOrTx, tenant: Tenant, studentId: string, yearId: string) {
  const [row] = await db
    .select({ planId: feePlanGrade.planId })
    .from(enrollment)
    .innerJoin(section, eq(section.id, enrollment.sectionId))
    .innerJoin(feePlanGrade, and(eq(feePlanGrade.gradeId, section.gradeId), eq(feePlanGrade.yearId, enrollment.yearId)))
    .where(
      and(eq(enrollment.schoolId, tenant.schoolId), eq(enrollment.studentId, studentId), eq(enrollment.yearId, yearId)),
    )
    .limit(1);

  // Plan charges from a plan this student is no longer on (they moved class level) go,
  // as long as nothing has been paid against them.
  const stale = await db
    .select({ id: feeCharge.id, lineId: feeCharge.lineId, planId: feeLine.planId })
    .from(feeCharge)
    .innerJoin(feeLine, eq(feeLine.id, feeCharge.lineId))
    .where(and(eq(feeCharge.schoolId, tenant.schoolId), eq(feeCharge.studentId, studentId), eq(feeCharge.yearId, yearId)));
  const staleIds = stale.filter((s) => s.planId !== row?.planId).map((s) => s.id);
  if (staleIds.length > 0) {
    const paid = await allocatedByCharge(db, tenant.schoolId, staleIds);
    const removable = staleIds.filter((id) => !(paid.get(id) ?? 0));
    if (removable.length > 0) {
      await db.delete(feeCharge).where(and(eq(feeCharge.schoolId, tenant.schoolId), inArray(feeCharge.id, removable)));
    }
  }

  if (row) await syncPlanCharges(db, tenant, row.planId, [studentId]);
}

export type LedgerCharge = {
  id: string;
  label: string;
  headId: string;
  instalmentName: string | null;
  dueOn: string;
  amount: number;
  concession: number;
  concessionNote: string | null;
  net: number;
  paid: number;
  balance: number;
  manual: boolean;
};

export async function studentCharges(db: DbOrTx, schoolId: string, studentId: string, yearId?: string): Promise<LedgerCharge[]> {
  const filters = [eq(feeCharge.schoolId, schoolId), eq(feeCharge.studentId, studentId)];
  if (yearId) filters.push(eq(feeCharge.yearId, yearId));
  const charges = await db
    .select()
    .from(feeCharge)
    .where(and(...filters))
    .orderBy(asc(feeCharge.dueOn), asc(feeCharge.label));
  const paid = await allocatedByCharge(db, schoolId, charges.map((c) => c.id));
  return charges.map((c) => {
    const net = c.amount - c.concession;
    const p = paid.get(c.id) ?? 0;
    return {
      id: c.id,
      label: c.label,
      headId: c.headId,
      instalmentName: c.instalmentName,
      dueOn: c.dueOn,
      amount: c.amount,
      concession: c.concession,
      concessionNote: c.concessionNote,
      net,
      paid: p,
      balance: net - p,
      manual: c.lineId === null,
    };
  });
}

/**
 * Splits a payment across a student's charges. With no explicit split, the oldest dues are
 * cleared first — the way a school office would apply money handed over the counter.
 */
export function planAllocation(
  charges: LedgerCharge[],
  amount: number,
  explicit?: { chargeId: string; amount: number }[],
): { chargeId: string; amount: number }[] {
  if (amount <= 0) throw invalid('Enter an amount above zero.', { amount: 'Enter an amount above zero.' });
  const outstanding = charges.filter((c) => c.balance > 0);
  const totalDue = outstanding.reduce((s, c) => s + c.balance, 0);

  if (explicit && explicit.length > 0) {
    const byId = new Map(charges.map((c) => [c.id, c]));
    let sum = 0;
    for (const part of explicit) {
      const charge = byId.get(part.chargeId);
      if (!charge) throw invalid('One of the selected dues does not belong to this student.');
      if (part.amount <= 0) throw invalid('Each selected due needs an amount above zero.');
      if (part.amount > charge.balance) throw conflict(`More than the balance of “${charge.label}” was allocated to it.`, 'OVER_ALLOCATED');
      sum += part.amount;
    }
    if (sum !== amount) throw invalid('The amounts against each due must add up to the amount received.');
    return explicit;
  }

  if (amount > totalDue) {
    throw conflict('That is more than this student owes. Add the charge first, then record the payment.', 'OVERPAYMENT');
  }
  const result: { chargeId: string; amount: number }[] = [];
  let left = amount;
  for (const c of outstanding) {
    if (left <= 0) break;
    const take = Math.min(left, c.balance);
    result.push({ chargeId: c.id, amount: take });
    left -= take;
  }
  return result;
}

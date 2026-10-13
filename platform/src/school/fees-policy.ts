// Late fees, bank charges and the day book: the parts of the fee rules a school configures.
//
// Re-exported from fees-engine.ts, which is where the rest of the fee rules live.
//
// Each fee plan carries its own late-fee policy (see `feePlan`): how often the fee repeats,
// whether it is a fixed amount or a percentage of the instalment, how many days of grace, and
// a ceiling. The fee for one instalment is a pure function of that policy, the due date, what
// was owed and when it was cleared — so it can be recomputed at any time and always comes out
// the same. A fee stops growing on the day the instalment is paid in full, and is never
// lowered below what has already been collected against it.
import { and, eq, inArray, isNotNull, sql } from 'drizzle-orm';
import type { DbOrTx } from '../db';
import {
  feeCharge,
  feeDayClose,
  feeHead,
  feeInstalment,
  feeLine,
  feePlan,
  payment,
  paymentAllocation,
  schoolProfile,
  student,
} from '../db/school-schema';
import { formatDateIN, todayIST } from '../lib/dates';
import { conflict } from '../lib/http';
import type { Tenant } from './tenant';

// ---------------------------------------------------------------------------
// Heads and the school's own settings
// ---------------------------------------------------------------------------

/** What the bank's returned-cheque charge is booked under until the school names its own head. */
export const BANK_CHARGE_HEAD = 'Bank charges';
export const LATE_FEE_HEAD = 'Late fee';

/** The fee head with this name, created at the end of the list the first time something needs it. */
export async function headByName(db: DbOrTx, schoolId: string, name: string): Promise<{ id: string; name: string }> {
  const find = async () => {
    const [row] = await db
      .select({ id: feeHead.id, name: feeHead.name })
      .from(feeHead)
      .where(and(eq(feeHead.schoolId, schoolId), eq(feeHead.name, name)))
      .limit(1);
    return row;
  };
  const existing = await find();
  if (existing) return existing;
  const [last] = await db
    .select({ position: sql<number>`coalesce(max(${feeHead.position}), -1)::int` })
    .from(feeHead)
    .where(eq(feeHead.schoolId, schoolId));
  await db
    .insert(feeHead)
    .values({ schoolId, name, position: Number(last?.position ?? -1) + 1 })
    .onConflictDoNothing();
  return (await find())!;
}

/** The school's own head names and default returned-cheque charges. */
export async function feeSettings(db: DbOrTx, schoolId: string) {
  const [row] = await db
    .select({
      lateFeeHead: schoolProfile.lateFeeHead,
      bankChargeHead: schoolProfile.bankChargeHead,
      bankChargeCheque: schoolProfile.bankChargeCheque,
      bankChargeTransfer: schoolProfile.bankChargeTransfer,
    })
    .from(schoolProfile)
    .where(eq(schoolProfile.schoolId, schoolId));
  return row ?? { lateFeeHead: LATE_FEE_HEAD, bankChargeHead: BANK_CHARGE_HEAD, bankChargeCheque: 0, bankChargeTransfer: 0 };
}

// ---------------------------------------------------------------------------
// Late fees
// ---------------------------------------------------------------------------

export type FinePolicy = {
  mode: 'none' | 'flat' | 'daily' | 'weekly' | 'monthly';
  /** `amount` = `amount` paise each time; `percent` = `rate` basis points of the instalment each time. */
  basis: 'amount' | 'percent';
  amount: number;
  rate: number;
  graceDays: number;
  /** A ceiling per instalment, in paise. 0 means none. */
  cap: number;
};

function daysBetween(from: string, to: string): number {
  return Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86_400_000);
}

/**
 * The late fee for one instalment, in paise. `asOf` is today, or the day it was paid in full.
 * Flat is charged once. Daily, weekly (7 days) and monthly (30 days) repeat, and a part of a
 * period counts as a whole one.
 */
export function fineFor(policy: FinePolicy, dueOn: string, netDue: number, asOf: string): number {
  if (policy.mode === 'none' || netDue <= 0) return 0;
  const late = daysBetween(dueOn, asOf) - policy.graceDays;
  if (late <= 0) return 0;
  const periods =
    policy.mode === 'flat' ? 1 : policy.mode === 'daily' ? late : policy.mode === 'weekly' ? Math.ceil(late / 7) : Math.ceil(late / 30);
  const each = policy.basis === 'percent' ? Math.round((netDue * policy.rate) / 10_000) : policy.amount;
  const total = periods * each;
  return policy.cap > 0 ? Math.min(total, policy.cap) : total;
}

type Group = {
  studentId: string;
  yearId: string;
  instalmentId: string;
  instalmentName: string;
  dueOn: string;
  policy: FinePolicy;
  net: number;
  paid: number;
  lastPaidOn: string | null;
};

/**
 * Brings late fees in line with today, for the given students or for the whole school.
 * Idempotent: running it twice in a row changes nothing the second time.
 */
export async function applyFines(
  db: DbOrTx,
  tenant: Tenant,
  opts: { studentIds?: string[] } = {},
): Promise<{ created: number; updated: number; removed: number }> {
  const counts = { created: 0, updated: 0, removed: 0 };
  const { schoolId } = tenant;
  const ids = opts.studentIds;
  if (ids && ids.length === 0) return counts;
  const today = todayIST();

  const planRows = await db
    .select({
      studentId: feeCharge.studentId,
      yearId: feeCharge.yearId,
      chargeId: feeCharge.id,
      amount: feeCharge.amount,
      concession: feeCharge.concession,
      instalmentId: feeInstalment.id,
      instalmentName: feeInstalment.name,
      dueOn: feeInstalment.dueOn,
      fineMode: feePlan.fineMode,
      fineBasis: feePlan.fineBasis,
      fineAmount: feePlan.fineAmount,
      fineRate: feePlan.fineRate,
      fineGraceDays: feePlan.fineGraceDays,
      fineCap: feePlan.fineCap,
    })
    .from(feeCharge)
    .innerJoin(feeLine, eq(feeLine.id, feeCharge.lineId))
    .innerJoin(feeInstalment, eq(feeInstalment.id, feeLine.instalmentId))
    .innerJoin(feePlan, eq(feePlan.id, feeInstalment.planId))
    .innerJoin(student, eq(student.id, feeCharge.studentId))
    .where(and(eq(feeCharge.schoolId, schoolId), eq(student.status, 'active'), ids ? inArray(feeCharge.studentId, ids) : undefined));

  const existing = await db
    .select()
    .from(feeCharge)
    .where(and(eq(feeCharge.schoolId, schoolId), isNotNull(feeCharge.fineForInstalmentId), ids ? inArray(feeCharge.studentId, ids) : undefined));

  // Paid so far, and the last day any of it came in, per charge — valid receipts only.
  const paidRows = await db
    .select({
      chargeId: paymentAllocation.chargeId,
      total: sql<number>`coalesce(sum(${paymentAllocation.amount}), 0)::int`,
      lastPaidOn: sql<string>`max(${payment.paidOn})::text`,
    })
    .from(paymentAllocation)
    .innerJoin(payment, eq(payment.id, paymentAllocation.paymentId))
    .where(and(eq(paymentAllocation.schoolId, schoolId), eq(payment.status, 'valid'), ids ? inArray(payment.studentId, ids) : undefined))
    .groupBy(paymentAllocation.chargeId);
  const paid = new Map(paidRows.map((r) => [r.chargeId, { total: Number(r.total), lastPaidOn: r.lastPaidOn }]));

  // A fine that any receipt points at, even a cancelled one, cannot be deleted.
  const referenced = new Set(
    existing.length
      ? (
          await db
            .select({ chargeId: paymentAllocation.chargeId })
            .from(paymentAllocation)
            .where(and(eq(paymentAllocation.schoolId, schoolId), inArray(paymentAllocation.chargeId, existing.map((e) => e.id))))
        ).map((r) => r.chargeId)
      : [],
  );

  const groups = new Map<string, Group>();
  for (const r of planRows) {
    const key = `${r.studentId}:${r.instalmentId}`;
    let g = groups.get(key);
    if (!g) {
      g = {
        studentId: r.studentId,
        yearId: r.yearId,
        instalmentId: r.instalmentId,
        instalmentName: r.instalmentName,
        dueOn: r.dueOn,
        policy: { mode: r.fineMode, basis: r.fineBasis, amount: r.fineAmount, rate: r.fineRate, graceDays: r.fineGraceDays, cap: r.fineCap },
        net: 0,
        paid: 0,
        lastPaidOn: null,
      };
      groups.set(key, g);
    }
    g.net += r.amount - r.concession;
    const p = paid.get(r.chargeId);
    if (p) {
      g.paid += p.total;
      if (p.lastPaidOn && (!g.lastPaidOn || p.lastPaidOn > g.lastPaidOn)) g.lastPaidOn = p.lastPaidOn;
    }
  }

  const settings = await feeSettings(db, schoolId);
  let headId: string | null = null;
  const existingByKey = new Map(existing.map((e) => [`${e.studentId}:${e.fineForInstalmentId}`, e]));

  for (const [key, g] of groups) {
    const cleared = g.net > 0 && g.paid >= g.net;
    const asOf = cleared && g.lastPaidOn && g.lastPaidOn < today ? g.lastPaidOn : today;
    const computed = fineFor(g.policy, g.dueOn, g.net, asOf);
    const row = existingByKey.get(key);
    existingByKey.delete(key);
    const alreadyPaid = row ? (paid.get(row.id)?.total ?? 0) : 0;
    const target = Math.max(computed, alreadyPaid);
    const label = `${settings.lateFeeHead} — ${g.instalmentName}`;

    if (!row) {
      if (target <= 0) continue;
      headId ??= (await headByName(db, schoolId, settings.lateFeeHead)).id;
      await db.insert(feeCharge).values({
        schoolId,
        studentId: g.studentId,
        yearId: g.yearId,
        headId,
        instalmentName: g.instalmentName,
        label,
        dueOn: g.dueOn,
        amount: target,
        fineForInstalmentId: g.instalmentId,
      });
      counts.created++;
    } else if (target <= 0 && !referenced.has(row.id)) {
      await db.delete(feeCharge).where(eq(feeCharge.id, row.id));
      counts.removed++;
    } else if (row.amount !== target || row.label !== label) {
      await db.update(feeCharge).set({ amount: target, label }).where(eq(feeCharge.id, row.id));
      counts.updated++;
    }
  }

  // Fines whose instalment no longer has any plan charge behind it.
  for (const row of existingByKey.values()) {
    const kept = paid.get(row.id)?.total ?? 0;
    if (referenced.has(row.id)) {
      if (row.amount !== kept) {
        await db.update(feeCharge).set({ amount: kept }).where(eq(feeCharge.id, row.id));
        counts.updated++;
      }
    } else {
      await db.delete(feeCharge).where(eq(feeCharge.id, row.id));
      counts.removed++;
    }
  }
  return counts;
}

// ---------------------------------------------------------------------------
// The day book
// ---------------------------------------------------------------------------

/** Throws if the day has been signed off: nothing dated that day may be received, cancelled or returned. */
export async function assertDayOpen(db: DbOrTx, schoolId: string, day: string): Promise<void> {
  const [close] = await db
    .select({ id: feeDayClose.id })
    .from(feeDayClose)
    .where(and(eq(feeDayClose.schoolId, schoolId), eq(feeDayClose.day, day)))
    .limit(1);
  if (close) throw conflict(`The day book for ${formatDateIN(day)} is closed. Reopen it before changing anything dated that day.`, 'DAY_CLOSED');
}

/** Cash that should be in the drawer for a day: valid cash receipts dated that day. */
export async function expectedCashFor(db: DbOrTx, schoolId: string, day: string): Promise<number> {
  const [row] = await db
    .select({ total: sql<number>`coalesce(sum(${payment.amount}), 0)::int` })
    .from(payment)
    .where(and(eq(payment.schoolId, schoolId), eq(payment.paidOn, day), eq(payment.status, 'valid'), eq(payment.mode, 'cash')));
  return Number(row?.total ?? 0);
}

// The parent app's API. Everything a parent can read, and nothing else.
//
//   GET /me                               who they are, and their children
//   GET /children/:id                     one child at a glance
//   GET /children/:id/attendance?month=   a month of attendance
//   GET /children/:id/fees                what is due and paid
//   GET /children/:id/receipts            receipts, newest first
//   GET /receipts/:id                     one receipt, to view or print
//
// Three rules hold on every route:
//   1. Who: the gate re-reads the session and the parent's access rows on every request, so
//      revoking a guardian or switching the app off takes effect on the very next request.
//   2. Whose: a child is only ever found through this parent's own guardian links. A child's
//      id from the address is checked against them, never trusted.
//   3. What: a section the school has switched off is refused before it is queried. Each
//      answer is built field by field — nothing internal (notes, category, consent, staff
//      contacts, who took a payment, the audit trail) is ever copied across.
import { and, asc, between, desc, eq, inArray, sql } from 'drizzle-orm';
import { Hono } from 'hono';
import type { MiddlewareHandler } from 'hono';
import { z } from 'zod';
import type { DbOrTx } from '../db';
import { organization } from '../db/auth-schema';
import {
  academicYear,
  attendanceRegister,
  enrollment,
  feeCharge,
  grade,
  holiday,
  parentAccess,
  parentPortal,
  payment,
  paymentAllocation,
  schoolProfile,
  section,
  staff,
  student,
  studentGuardian,
} from '../db/school-schema';
import { todayIST, isWorkingDay, monthBounds } from '../lib/dates';
import { HttpError, forbidden, readQuery } from '../lib/http';
import { rupeesInWords } from '../lib/money';
import { studentCharges } from '../school/fees-engine';
import type { AppEnv } from '../school/tenant';
import type { PortalSettings } from './access';

export type ParentLink = { accessId: string; schoolId: string; guardianId: string };
export type Parent = {
  userId: string;
  name: string;
  links: ParentLink[];
  /** What each of their schools allows. Only schools with the app switched on are here. */
  settings: Map<string, PortalSettings>;
};

type ParentEnv = AppEnv & { Variables: AppEnv['Variables'] & { parent: Parent } };

/** Seen at most this often, so the gate does not write on every request. */
const LAST_SEEN_EVERY_MS = 5 * 60 * 1000;

export function parentGate(): MiddlewareHandler<ParentEnv> {
  return async (c, next) => {
    const auth = c.get('auth');
    const db = c.get('db');
    // Straight from the database, not the 5-minute cookie cache: a parent signed out
    // everywhere after a password reset must be out now, not in five minutes.
    const session = await auth.api.getSession({ headers: c.req.raw.headers, query: { disableCookieCache: true } });
    if (!session) throw new HttpError(401, 'UNAUTHENTICATED', 'Sign in to continue.');

    const rows = await db
      .select({ access: parentAccess, portal: parentPortal })
      .from(parentAccess)
      .innerJoin(parentPortal, eq(parentPortal.schoolId, parentAccess.schoolId))
      .where(and(eq(parentAccess.userId, session.user.id), eq(parentAccess.status, 'active'), eq(parentPortal.enabled, true)));
    if (rows.length === 0) throw forbidden('This account has no parent app access right now. Ask your child’s school.');

    const settings = new Map<string, PortalSettings>();
    for (const { portal } of rows) {
      settings.set(portal.schoolId, {
        enabled: portal.enabled,
        attendance: portal.attendance,
        fees: portal.fees,
        receipts: portal.receipts,
        studentDetails: portal.studentDetails,
        classTeacher: portal.classTeacher,
      });
    }
    c.set('parent', {
      userId: session.user.id,
      name: session.user.name,
      links: rows.map(({ access }) => ({ accessId: access.id, schoolId: access.schoolId, guardianId: access.guardianId })),
      settings,
    });

    const stale = rows.filter(({ access }) => !access.lastSeenAt || Date.now() - access.lastSeenAt.getTime() > LAST_SEEN_EVERY_MS);
    if (stale.length) {
      await db
        .update(parentAccess)
        .set({ lastSeenAt: new Date() })
        .where(inArray(parentAccess.id, stale.map(({ access }) => access.id)));
    }
    await next();
  };
}

/** This parent's children who are studying now, each with the school and guardian link they came through. */
async function children(db: DbOrTx, parent: Parent, onlyStudentId?: string) {
  const guardianIds = parent.links.map((l) => l.guardianId);
  const filters = [inArray(studentGuardian.guardianId, guardianIds), eq(student.status, 'active')];
  if (onlyStudentId) filters.push(eq(student.id, onlyStudentId));
  const rows = await db
    .select({
      id: student.id,
      schoolId: student.schoolId,
      linkSchoolId: studentGuardian.schoolId,
      guardianId: studentGuardian.guardianId,
      firstName: student.firstName,
      lastName: student.lastName,
      dateOfBirth: student.dateOfBirth,
      bloodGroup: student.bloodGroup,
      address: student.address,
      admissionNo: student.admissionNo,
    })
    .from(studentGuardian)
    .innerJoin(student, eq(student.id, studentGuardian.studentId))
    .where(and(...filters))
    .orderBy(asc(student.firstName));
  // Belt and braces: the guardian link, the student and the access must all be the same school.
  const seen = new Set<string>();
  return rows.filter((r) => {
    const ok = r.schoolId === r.linkSchoolId && parent.links.some((l) => l.guardianId === r.guardianId && l.schoolId === r.schoolId);
    if (!ok || seen.has(r.id)) return false;
    seen.add(r.id);
    return true;
  });
}

const notYours = () => new HttpError(404, 'NOT_FOUND', 'That child was not found on your account.');

async function myChild(db: DbOrTx, parent: Parent, studentId: string) {
  const [child] = await children(db, parent, studentId);
  if (!child) throw notYours();
  return { child, settings: parent.settings.get(child.schoolId)! };
}

function sectionOff(what: string): HttpError {
  return new HttpError(403, 'SECTION_OFF', `Your child’s school does not show ${what} in the parent app.`);
}

const fullName = (s: { firstName: string; lastName: string | null }) => [s.firstName, s.lastName].filter(Boolean).join(' ');

async function currentPlace(db: DbOrTx, schoolId: string, studentId: string) {
  const [row] = await db
    .select({
      yearId: academicYear.id,
      yearName: academicYear.name,
      yearStartsOn: academicYear.startsOn,
      yearEndsOn: academicYear.endsOn,
      sectionId: section.id,
      classLabel: grade.name,
      sectionName: section.name,
      rollNo: enrollment.rollNo,
      classTeacherId: section.classTeacherId,
    })
    .from(academicYear)
    .leftJoin(enrollment, and(eq(enrollment.yearId, academicYear.id), eq(enrollment.studentId, studentId)))
    .leftJoin(section, eq(section.id, enrollment.sectionId))
    .leftJoin(grade, eq(grade.id, section.gradeId))
    .where(and(eq(academicYear.schoolId, schoolId), eq(academicYear.isCurrent, true)))
    .limit(1);
  if (!row) return null;
  return { ...row, classLabel: row.classLabel && row.sectionName ? `${row.classLabel}-${row.sectionName}` : null };
}

async function schoolNames(db: DbOrTx, schoolIds: string[]) {
  if (schoolIds.length === 0) return new Map<string, string>();
  const rows = await db.select({ id: organization.id, name: organization.name }).from(organization).where(inArray(organization.id, schoolIds));
  return new Map(rows.map((r) => [r.id, r.name]));
}

type Mark = 'P' | 'A' | 'L';

function tally(marks: Mark[]) {
  const present = marks.filter((m) => m === 'P').length;
  const late = marks.filter((m) => m === 'L').length;
  const absent = marks.filter((m) => m === 'A').length;
  const total = marks.length;
  return { present, late, absent, total, percent: total ? Math.round(((present + late) / total) * 1000) / 10 : null };
}

/**
 * This child's marks between two dates, from every register that holds one — including a
 * section they have since moved out of. Only their own mark is read out of each register.
 */
async function marksBetween(db: DbOrTx, schoolId: string, studentId: string, from: string, to: string) {
  const rows = await db
    .select({ date: attendanceRegister.date, mark: sql<string>`${attendanceRegister.marks} ->> ${studentId}` })
    .from(attendanceRegister)
    .where(
      and(
        eq(attendanceRegister.schoolId, schoolId),
        sql`${attendanceRegister.marks} ? ${studentId}`,
        between(attendanceRegister.date, from, to),
      ),
    );
  const byDate = new Map<string, Mark>();
  for (const r of rows) if (r.mark === 'P' || r.mark === 'A' || r.mark === 'L') byDate.set(r.date, r.mark);
  return byDate;
}

export const parentApiRoutes = new Hono<ParentEnv>();

parentApiRoutes.use('*', parentGate());

parentApiRoutes.get('/me', async (c) => {
  const db = c.get('db');
  const parent = c.get('parent');
  const kids = await children(db, parent);
  const names = await schoolNames(db, [...parent.settings.keys()]);
  const list = [];
  for (const k of kids) {
    const place = await currentPlace(db, k.schoolId, k.id);
    list.push({ id: k.id, name: fullName(k), firstName: k.firstName, schoolId: k.schoolId, schoolName: names.get(k.schoolId) ?? '', classLabel: place?.classLabel ?? null });
  }
  return c.json({
    parent: { name: parent.name },
    children: list,
    schools: [...parent.settings.entries()].map(([id, s]) => ({ id, name: names.get(id) ?? '', sections: publicSections(s) })),
  });
});

/** Which sections a school shows — enough for the app to draw its tabs. */
function publicSections(s: PortalSettings) {
  return { attendance: s.attendance, fees: s.fees, receipts: s.receipts, studentDetails: s.studentDetails, classTeacher: s.classTeacher };
}

parentApiRoutes.get('/children/:id', async (c) => {
  const db = c.get('db');
  const parent = c.get('parent');
  const { child, settings } = await myChild(db, parent, c.req.param('id'));
  const place = await currentPlace(db, child.schoolId, child.id);
  const [school] = await db
    .select({ name: organization.name, phone: schoolProfile.phone, email: schoolProfile.email, workingDays: schoolProfile.workingDays })
    .from(organization)
    .leftJoin(schoolProfile, eq(schoolProfile.schoolId, organization.id))
    .where(eq(organization.id, child.schoolId));
  const today = todayIST();

  let attendance = null;
  if (settings.attendance !== 'off' && place?.yearId) {
    const marks = await marksBetween(db, child.schoolId, child.id, place.yearStartsOn, today);
    const [hol] = await db.select({ name: holiday.name }).from(holiday).where(and(eq(holiday.schoolId, child.schoolId), eq(holiday.date, today)));
    attendance = {
      thisYear: tally([...marks.values()]),
      today: {
        date: today,
        // Today's mark is the one thing even the summary view shows: "was my child in school?"
        mark: marks.get(today) ?? null,
        holiday: hol?.name ?? null,
        workingDay: isWorkingDay(today, school?.workingDays ?? 0b0111111) && !hol,
      },
    };
  }

  let fees = null;
  if (settings.fees) {
    const charges = await studentCharges(db, child.schoolId, child.id);
    const open = charges.filter((ch) => ch.balance > 0);
    fees = {
      due: open.reduce((sum, ch) => sum + ch.balance, 0),
      overdue: open.filter((ch) => ch.dueOn < today).reduce((sum, ch) => sum + ch.balance, 0),
      nextDue: open[0] ? { label: open[0].label, dueOn: open[0].dueOn, balance: open[0].balance } : null,
    };
  }

  let classTeacher = null;
  if (settings.classTeacher && place?.classTeacherId) {
    const [t] = await db
      .select({ name: staff.name })
      .from(staff)
      .where(and(eq(staff.schoolId, child.schoolId), eq(staff.id, place.classTeacherId), eq(staff.status, 'active')));
    classTeacher = t?.name ?? null;
  }

  return c.json({
    child: {
      id: child.id,
      name: fullName(child),
      firstName: child.firstName,
      admissionNo: child.admissionNo,
      classLabel: place?.classLabel ?? null,
      rollNo: place?.rollNo ?? null,
      yearName: place?.yearName ?? null,
    },
    school: { id: child.schoolId, name: school?.name ?? '', phone: school?.phone ?? null, email: school?.email ?? null },
    sections: publicSections(settings),
    attendance,
    fees,
    classTeacher,
    details: settings.studentDetails
      ? { dateOfBirth: child.dateOfBirth, bloodGroup: child.bloodGroup, address: child.address }
      : null,
  });
});

parentApiRoutes.get('/children/:id/attendance', async (c) => {
  const db = c.get('db');
  const parent = c.get('parent');
  const { child, settings } = await myChild(db, parent, c.req.param('id'));
  if (settings.attendance === 'off') throw sectionOff('attendance');
  const q = readQuery(c, z.object({ month: z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/, 'Use a month like 2026-07.') }));

  const { from, to, days } = monthBounds(q.month);
  const today = todayIST();
  const marks = await marksBetween(db, child.schoolId, child.id, from, to);
  const holidays = await db
    .select({ date: holiday.date, name: holiday.name })
    .from(holiday)
    .where(and(eq(holiday.schoolId, child.schoolId), between(holiday.date, from, to)));
  const [profile] = await db.select({ workingDays: schoolProfile.workingDays }).from(schoolProfile).where(eq(schoolProfile.schoolId, child.schoolId));
  const mask = profile?.workingDays ?? 0b0111111;

  const summary = tally([...marks.values()]);
  if (settings.attendance === 'summary') return c.json({ month: q.month, mode: 'summary', summary, days: null });

  return c.json({
    month: q.month,
    mode: 'daily',
    summary,
    days: days.map((d) => {
      const hol = holidays.find((h) => h.date === d);
      return {
        date: d,
        future: d > today,
        working: isWorkingDay(d, mask) && !hol,
        holiday: hol?.name ?? null,
        mark: marks.get(d) ?? null,
      };
    }),
  });
});

parentApiRoutes.get('/children/:id/fees', async (c) => {
  const db = c.get('db');
  const parent = c.get('parent');
  const { child, settings } = await myChild(db, parent, c.req.param('id'));
  if (!settings.fees) throw sectionOff('fees');
  const place = await currentPlace(db, child.schoolId, child.id);
  const today = todayIST();
  const all = await studentCharges(db, child.schoolId, child.id);
  // This year in full, and anything from earlier years still unpaid.
  const charges = all.filter((ch) => ch.yearId === place?.yearId || ch.balance > 0);
  return c.json({
    yearName: place?.yearName ?? null,
    charges: charges.map((ch) => ({
      id: ch.id,
      label: ch.label,
      instalment: ch.instalmentName,
      lateFee: ch.kind === 'fine',
      dueOn: ch.dueOn,
      amount: ch.amount,
      concession: ch.concession,
      net: ch.net,
      paid: ch.paid,
      balance: ch.balance,
      overdue: ch.balance > 0 && ch.dueOn < today,
      earlierYear: ch.yearId !== place?.yearId,
    })),
    totals: {
      net: charges.reduce((s, ch) => s + ch.net, 0),
      paid: charges.reduce((s, ch) => s + ch.paid, 0),
      due: charges.reduce((s, ch) => s + ch.balance, 0),
      overdue: charges.filter((ch) => ch.dueOn < today).reduce((s, ch) => s + ch.balance, 0),
    },
  });
});

const modeLabels: Record<string, string> = { cash: 'Cash', upi: 'UPI', card: 'Card', cheque: 'Cheque', bank: 'Bank transfer' };

parentApiRoutes.get('/children/:id/receipts', async (c) => {
  const db = c.get('db');
  const parent = c.get('parent');
  const { child, settings } = await myChild(db, parent, c.req.param('id'));
  if (settings.receipts === 'off') throw sectionOff('receipts');
  const rows = await db
    .select({ id: payment.id, receiptNo: payment.receiptNo, amount: payment.amount, mode: payment.mode, paidOn: payment.paidOn, status: payment.status })
    .from(payment)
    .where(and(eq(payment.schoolId, child.schoolId), eq(payment.studentId, child.id)))
    .orderBy(desc(payment.paidOn), desc(payment.createdAt))
    .limit(200);
  return c.json({
    canOpen: settings.receipts === 'full',
    receipts: rows.map((r) => ({ ...r, modeLabel: modeLabels[r.mode] ?? r.mode })),
  });
});

parentApiRoutes.get('/receipts/:id', async (c) => {
  const db = c.get('db');
  const parent = c.get('parent');
  const schoolIds = [...parent.settings.keys()];
  const [p] = await db
    .select()
    .from(payment)
    .where(and(eq(payment.id, c.req.param('id')), inArray(payment.schoolId, schoolIds)))
    .limit(1);
  if (!p) throw new HttpError(404, 'NOT_FOUND', 'That receipt was not found on your account.');
  // The receipt's student must be one of this parent's own children.
  const [child] = await children(db, parent, p.studentId);
  if (!child || child.schoolId !== p.schoolId) throw new HttpError(404, 'NOT_FOUND', 'That receipt was not found on your account.');
  const settings = parent.settings.get(p.schoolId)!;
  if (settings.receipts !== 'full') throw sectionOff('receipts');

  const lines = await db
    .select({ label: feeCharge.label, amount: paymentAllocation.amount, dueOn: feeCharge.dueOn })
    .from(paymentAllocation)
    .innerJoin(feeCharge, eq(feeCharge.id, paymentAllocation.chargeId))
    .where(and(eq(paymentAllocation.schoolId, p.schoolId), eq(paymentAllocation.paymentId, p.id)))
    .orderBy(asc(feeCharge.dueOn));
  const [school] = await db
    .select({ name: organization.name, profile: schoolProfile })
    .from(organization)
    .leftJoin(schoolProfile, eq(schoolProfile.schoolId, organization.id))
    .where(eq(organization.id, p.schoolId));
  const place = await currentPlace(db, p.schoolId, child.id);
  const balanceNow = settings.fees
    ? (await studentCharges(db, p.schoolId, child.id)).reduce((sum, ch) => sum + ch.balance, 0)
    : null;

  return c.json({
    receipt: {
      id: p.id,
      receiptNo: p.receiptNo,
      amount: p.amount,
      amountInWords: rupeesInWords(p.amount),
      mode: p.mode,
      modeLabel: modeLabels[p.mode] ?? p.mode,
      reference: p.mode === 'cash' ? null : p.reference,
      paidOn: p.paidOn,
      status: p.status,
      bouncedOn: p.bouncedOn,
    },
    lines,
    student: { name: fullName(child), admissionNo: child.admissionNo, classLabel: place?.classLabel ?? null },
    school: {
      name: school?.name ?? '',
      address: [school?.profile?.address, school?.profile?.city, school?.profile?.state, school?.profile?.pincode].filter(Boolean).join(', '),
      phone: school?.profile?.phone ?? null,
      email: school?.profile?.email ?? null,
      affiliationNo: school?.profile?.affiliationNo ?? null,
      board: school?.profile?.board ?? null,
    },
    balanceNow,
  });
});

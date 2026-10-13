// End-to-end tests of Acadlas School's API on a real (in-process) Postgres.
// Run with: npm test
import assert from 'node:assert/strict';
import { before, describe, test } from 'node:test';
import { addDays, todayIST } from '../lib/dates';
import { rupeesInWords } from '../lib/money';
import { Client, admit, ownerWithSchool, startTestApp } from './harness';

let ctx: Awaited<ReturnType<typeof startTestApp>>;
let A: Awaited<ReturnType<typeof ownerWithSchool>>;
let B: Awaited<ReturnType<typeof ownerWithSchool>>;
let aStudent: { id: string; admissionNo: string };

// Schools built inside a describe and used by the one after it.
let C: Awaited<ReturnType<typeof ownerWithSchool>>;
let cKid: { id: string };
let E: Awaited<ReturnType<typeof ownerWithSchool>>;
let eHeads: Record<string, string>;
let eElder: { id: string };
let eYounger: { id: string };

before(async () => {
  ctx = await startTestApp();
  A = await ownerWithSchool(ctx.app, 'a');
  B = await ownerWithSchool(ctx.app, 'b');
  aStudent = await admit(A.owner, A.sections['6-A'], 'Aarav', '9811111111');
});

describe('setup', () => {
  test('a new school has a current year, classes and its owner on the staff list', async () => {
    const me = await A.owner.get('/api/school/me');
    assert.equal(me.status, 200);
    assert.equal(me.body.currentYear.name, '2026–27');
    assert.ok(me.body.permissions.includes('fees.manage'));
    assert.ok(me.body.school.setupCompletedAt);
    const staff = await A.owner.get('/api/school/staff');
    assert.equal(staff.body.staff.length, 1);
    assert.equal(staff.body.staff[0].isOwner, true);
  });

  test('setup cannot run twice', async () => {
    const again = await A.owner.post('/api/school/setup', {
      profile: { name: 'x' }, year: { name: 'x', startsOn: '2026-04-01', endsOn: '2027-03-31' }, classes: [{ name: '1', sections: ['A'] }],
    });
    assert.equal(again.status, 409);
  });

  test('requests without a session are refused', async () => {
    const stranger = new Client(ctx.app);
    assert.equal((await stranger.get('/api/school/me')).status, 401);
  });

  test('admission numbers follow the prefix/year/sequence pattern', () => {
    assert.match(aStudent.admissionNo, /^ADM\/2026\/0001$/);
  });
});

describe('isolation between schools', () => {
  test('school B cannot read, change or use anything of school A by id', async () => {
    const b = B.owner;
    assert.equal((await b.get(`/api/school/students/${aStudent.id}`)).status, 404);
    assert.equal((await b.patch(`/api/school/students/${aStudent.id}`, { firstName: 'Hacked' })).status, 404);
    assert.equal((await b.post(`/api/school/students/${aStudent.id}/move`, { sectionId: B.sections['6-A'] })).status, 404);
    assert.equal((await b.post(`/api/school/students/${aStudent.id}/withdraw`, { date: todayIST(), reason: 'x' })).status, 404);
    assert.equal((await b.get(`/api/school/students/${aStudent.id}/export`)).status, 404);
    assert.equal((await b.get(`/api/school/fees/students/${aStudent.id}`)).status, 404);
    assert.equal((await b.post('/api/school/fees/payments', { studentId: aStudent.id, amount: 100, mode: 'cash' })).status, 404);
    assert.equal((await b.get(`/api/school/attendance/register?sectionId=${A.sections['6-A']}`)).status, 404);
    assert.equal((await b.put('/api/school/attendance/register', { sectionId: A.sections['6-A'], date: todayIST(), marks: { [aStudent.id]: 'A' } })).status, 404);
    assert.equal((await b.patch(`/api/school/sections/${A.sections['6-A']}`, { room: 'x' })).status, 404);
    assert.equal((await b.del(`/api/school/sections/${A.sections["6-A"]}`)).status, 404);
    const admitIntoA = await b.post('/api/school/students', {
      student: { firstName: 'Intruder' }, guardians: [{ name: 'x', relation: 'father' }], sectionId: A.sections['6-A'], consentMethod: null,
    });
    assert.equal(admitIntoA.status, 404);
    assert.equal((await b.post('/api/school/promotions', { fromSectionId: A.sections['6-A'], toSectionId: B.sections['6-A'], studentIds: [aStudent.id] })).status, 404);
  });

  test('school B lists, searches and looks up only its own people', async () => {
    const list = await B.owner.get('/api/school/students');
    assert.equal(list.body.total, 0);
    const search = await B.owner.get('/api/school/search?q=Aarav');
    assert.equal(search.body.students.length, 0);
    const lookup = await B.owner.get('/api/school/guardians/lookup?phone=9811111111');
    assert.deepEqual(lookup.body, []);
    const activity = await B.owner.get('/api/school/activity');
    assert.ok(activity.body.every((e: any) => !e.summary.includes('Aarav')));
  });

  test('a guardian id from another school cannot be linked', async () => {
    const rec = await A.owner.get(`/api/school/students/${aStudent.id}`);
    const guardianId = rec.body.guardians[0].id;
    const res = await B.owner.post('/api/school/students', {
      student: { firstName: 'Sibling' }, guardians: [{ existingId: guardianId, relation: 'mother' }], sectionId: B.sections['6-A'], consentMethod: 'paper',
    });
    assert.equal(res.status, 404);
  });

  test('switching the active school to one you do not belong to is refused', async () => {
    const res = await B.owner.post('/api/auth/organization/set-active', { organizationId: A.schoolId });
    assert.notEqual(res.status, 200);
    const me = await B.owner.get('/api/school/me');
    assert.equal(me.body.school.id, B.schoolId);
  });
});

describe('roles', () => {
  let teacher: Client;
  let teacherStaffId: string;
  let accountant: Client;

  before(async () => {
    const invited = await A.owner.post('/api/school/staff', { name: 'Kavita Iyer', email: 'kavita@example.com', role: 'teacher', invite: true, designation: 'TGT English' });
    assert.equal(invited.status, 201, JSON.stringify(invited.body));
    teacherStaffId = invited.body.staff.id;
    teacher = new Client(ctx.app);
    await teacher.signUp('Kavita Iyer', 'kavita@example.com');
    const info = await teacher.get(`/api/invitations/${invited.body.invite.id}`);
    assert.equal(info.body.schoolName, 'School a');
    const accepted = await teacher.post('/api/auth/organization/accept-invitation', { invitationId: invited.body.invite.id });
    assert.equal(accepted.status, 200, JSON.stringify(accepted.body));
    await teacher.post('/api/auth/organization/set-active', { organizationId: A.schoolId });

    const acc = await A.owner.post('/api/school/staff', { name: 'Ravi Accounts', email: 'ravi@example.com', role: 'accountant', invite: true });
    accountant = new Client(ctx.app);
    await accountant.signUp('Ravi', 'ravi@example.com');
    await accountant.post('/api/auth/organization/accept-invitation', { invitationId: acc.body.invite.id });
    await accountant.post('/api/auth/organization/set-active', { organizationId: A.schoolId });
  });

  test('accepting an invitation links the login to the staff record', async () => {
    const me = await teacher.get('/api/school/me');
    assert.equal(me.status, 200);
    assert.deepEqual(me.body.roles, ['teacher']);
    assert.equal(me.body.staffId, teacherStaffId);
  });

  test('a teacher with no sections sees no students and cannot take any register', async () => {
    const list = await teacher.get('/api/school/students');
    assert.equal(list.body.total, 0);
    assert.equal((await teacher.get(`/api/school/students/${aStudent.id}`)).status, 403);
    const res = await teacher.put('/api/school/attendance/register', { sectionId: A.sections['6-A'], date: todayIST(), marks: { [aStudent.id]: 'P' } });
    assert.equal(res.status, 403);
  });

  test('as class teacher they see their section and take its register, but not yesterday’s', async () => {
    await A.owner.patch(`/api/school/sections/${A.sections['6-A']}`, { classTeacherId: teacherStaffId });
    const list = await teacher.get('/api/school/students');
    assert.equal(list.body.total, 1);
    assert.equal((await teacher.get(`/api/school/students/${aStudent.id}`)).status, 200);
    const ok = await teacher.put('/api/school/attendance/register', { sectionId: A.sections['6-A'], date: todayIST(), marks: { [aStudent.id]: 'P' } });
    assert.equal(ok.status, 200, JSON.stringify(ok.body));
    const yesterday = new Date(Date.now() - 86400000).toISOString().slice(0, 10);
    const late = await teacher.put('/api/school/attendance/register', { sectionId: A.sections['6-A'], date: yesterday, marks: { [aStudent.id]: 'P' } });
    assert.equal(late.status, 403);
    const other = await teacher.put('/api/school/attendance/register', { sectionId: A.sections['6-B'], date: todayIST(), marks: {} });
    assert.equal(other.status, 403);
  });

  test('a teacher cannot admit students, see fees or manage staff', async () => {
    assert.equal((await teacher.post('/api/school/students', { student: { firstName: 'x' }, guardians: [{ name: 'y', relation: 'father' }], sectionId: A.sections['6-A'], consentMethod: null })).status, 403);
    assert.equal((await teacher.get(`/api/school/fees/students/${aStudent.id}`)).status, 403);
    assert.equal((await teacher.post('/api/school/staff', { name: 'z' })).status, 403);
    assert.equal((await teacher.get('/api/school/activity')).status, 403);
  });

  test('an accountant collects fees but cannot admit or change the school', async () => {
    assert.equal((await accountant.get(`/api/school/fees/students/${aStudent.id}`)).status, 200);
    assert.equal((await accountant.post('/api/school/students', { student: { firstName: 'x' }, guardians: [{ name: 'y', relation: 'father' }], sectionId: A.sections['6-A'], consentMethod: null })).status, 403);
    assert.equal((await accountant.put('/api/school/profile', { name: 'Renamed' })).status, 403);
  });

  test('someone removed from the school loses access immediately', async () => {
    const left = await A.owner.post(`/api/school/staff/${teacherStaffId}/leave`);
    assert.equal(left.status, 200, JSON.stringify(left.body));
    const res = await teacher.get('/api/school/me');
    assert.ok(res.status === 403 || res.status === 409, `expected refusal, got ${res.status}`);
  });
});

describe('attendance', () => {
  test('every student must be marked, and a correction lands on the student’s timeline', async () => {
    const sid = A.sections['6-A'];
    const second = await admit(A.owner, sid, 'Diya', '9822222222');
    const incomplete = await A.owner.put('/api/school/attendance/register', { sectionId: sid, date: todayIST(), marks: { [aStudent.id]: 'P' } });
    assert.equal(incomplete.status, 400);
    const ok = await A.owner.put('/api/school/attendance/register', { sectionId: sid, date: todayIST(), marks: { [aStudent.id]: 'P', [second.id]: 'A' } });
    assert.equal(ok.status, 200);
    assert.equal(ok.body.absent, 1);
    assert.equal(ok.body.absentees[0].guardianPhone, '9822222222');
    const fix = await A.owner.put('/api/school/attendance/register', { sectionId: sid, date: todayIST(), marks: { [aStudent.id]: 'P', [second.id]: 'L' } });
    assert.equal(fix.body.corrected, 1);
    const rec = await A.owner.get(`/api/school/students/${second.id}`);
    assert.ok(rec.body.timeline.some((e: any) => e.action === 'attendance.corrected'));
    assert.equal(rec.body.attendance.late, 1);
    const future = await A.owner.put('/api/school/attendance/register', { sectionId: sid, date: '2099-01-01', marks: {} });
    assert.equal(future.status, 400);
  });
});

describe('fees', () => {
  let planId: string;
  let heads: Record<string, string>;
  let student: { id: string };

  before(async () => {
    const h = await A.owner.get('/api/school/fees/heads');
    heads = Object.fromEntries(h.body.map((x: any) => [x.name, x.id]));
    const plan = await A.owner.post('/api/school/fees/plans', {
      name: 'Middle school',
      gradeIds: [A.grades['6']],
      instalments: [
        { name: 'Term 1', dueOn: '2026-04-10', amounts: { [heads.Tuition]: 650000, [heads.Transport]: 150000 } },
        { name: 'Term 2', dueOn: '2099-10-10', amounts: { [heads.Tuition]: 650000, [heads.Transport]: 150000 } },
      ],
    });
    assert.equal(plan.status, 201, JSON.stringify(plan.body));
    planId = plan.body.plan.id;
    student = await admit(A.owner, A.sections['6-B'], 'Kabir', '9833333333');
  });

  test('students on the plan are charged, including ones admitted later', async () => {
    const ledger = await A.owner.get(`/api/school/fees/students/${student.id}`);
    assert.equal(ledger.body.charges.length, 4);
    assert.equal(ledger.body.totals.net, 1600000);
    assert.equal(ledger.body.totals.overdue, 800000);
    const early = await A.owner.get(`/api/school/fees/students/${aStudent.id}`);
    assert.equal(early.body.totals.net, 1600000);
  });

  test('a class can follow only one plan a year', async () => {
    const res = await A.owner.post('/api/school/fees/plans', { name: 'Dup', gradeIds: [A.grades['6']], instalments: [{ name: 'x', dueOn: '2026-05-01', amounts: {} }] });
    assert.equal(res.status, 409);
  });

  test('a payment clears the oldest dues first, numbers receipts in sequence, and refuses overpayment', async () => {
    const first = await A.owner.post('/api/school/fees/payments', { studentId: student.id, amount: 700000, mode: 'upi', reference: 'UPI123' });
    assert.equal(first.status, 201, JSON.stringify(first.body));
    const second = await A.owner.post('/api/school/fees/payments', { studentId: student.id, amount: 100000, mode: 'cash' });
    const n1 = Number(first.body.receiptNo.split('/').pop());
    const n2 = Number(second.body.receiptNo.split('/').pop());
    assert.equal(n2, n1 + 1);
    assert.match(first.body.receiptNo, /^RCT\/2026-27\/\d{5}$/);
    const ledger = await A.owner.get(`/api/school/fees/students/${student.id}`);
    assert.equal(ledger.body.totals.paid, 800000);
    assert.equal(ledger.body.totals.overdue, 0);
    const over = await A.owner.post('/api/school/fees/payments', { studentId: student.id, amount: 900000, mode: 'cash' });
    assert.equal(over.status, 409);
    const cheque = await A.owner.post('/api/school/fees/payments', { studentId: student.id, amount: 100, mode: 'cheque' });
    assert.equal(cheque.status, 400);
  });

  test('two payments at the same moment get different receipt numbers', async () => {
    const [p, q] = await Promise.all([
      A.owner.post('/api/school/fees/payments', { studentId: student.id, amount: 1000, mode: 'cash' }),
      A.owner.post('/api/school/fees/payments', { studentId: student.id, amount: 1000, mode: 'cash' }),
    ]);
    assert.equal(p.status, 201);
    assert.equal(q.status, 201);
    assert.notEqual(p.body.receiptNo, q.body.receiptNo);
  });

  test('a receipt shows the amount in words, and cancelling it restores the balance', async () => {
    const pay = await A.owner.post('/api/school/fees/payments', { studentId: student.id, amount: 12550, mode: 'cash' });
    const receipt = await A.owner.get(`/api/school/fees/payments/${pay.body.id}`);
    assert.equal(receipt.body.amountInWords, 'One hundred twenty-five rupees and fifty paise only');
    const beforeCancel = (await A.owner.get(`/api/school/fees/students/${student.id}`)).body.totals.balance;
    await A.owner.post(`/api/school/fees/payments/${pay.body.id}/cancel`, { reason: 'Entered twice' });
    const after = (await A.owner.get(`/api/school/fees/students/${student.id}`)).body.totals.balance;
    assert.equal(after, beforeCancel + 12550);
    const again = await A.owner.post(`/api/school/fees/payments/${pay.body.id}/cancel`, { reason: 'x' });
    assert.equal(again.status, 409);
  });

  test('a concession recomputes unpaid charges but never under what was already paid', async () => {
    const res = await A.owner.post(`/api/school/fees/students/${student.id}/concessions`, { headId: heads.Tuition, percent: 50, reason: 'Sibling' });
    assert.equal(res.status, 201);
    const ledger = await A.owner.get(`/api/school/fees/students/${student.id}`);
    const term2Tuition = ledger.body.charges.find((ch: any) => ch.label === 'Tuition — Term 2');
    assert.equal(term2Tuition.concession, 325000);
    for (const ch of ledger.body.charges) assert.ok(ch.balance >= 0, `negative balance on ${ch.label}`);
  });

  test('an RTE admission owes nothing', async () => {
    const rte = await A.owner.post('/api/school/students', {
      student: { firstName: 'Meher', isRte: true }, guardians: [{ name: 'Parent', relation: 'father', phone: '9844444444' }], sectionId: A.sections['6-A'], consentMethod: 'paper',
    });
    const ledger = await A.owner.get(`/api/school/fees/students/${rte.body.id}`);
    assert.equal(ledger.body.totals.net, 0);
    assert.equal(ledger.body.totals.gross, 1600000);
  });

  test('raising a plan amount updates everyone’s unpaid charges', async () => {
    const plans = await A.owner.get('/api/school/fees/plans');
    const plan = plans.body.plans.find((p: any) => p.id === planId);
    const instalments = plan.instalments.map((i: any) => (i.name === 'Term 2' ? { ...i, amounts: { ...i.amounts, [heads.Transport]: 175000 } } : i));
    const res = await A.owner.put(`/api/school/fees/plans/${planId}`, { name: plan.name, gradeIds: plan.gradeIds, instalments });
    assert.equal(res.status, 200, JSON.stringify(res.body));
    const ledger = await A.owner.get(`/api/school/fees/students/${aStudent.id}`);
    assert.equal(ledger.body.charges.find((ch: any) => ch.label === 'Transport — Term 2').amount, 175000);
  });

  test('dues list, collections and summary agree', async () => {
    const dues = await A.owner.get('/api/school/fees/dues?overdueOnly=false');
    const summary = await A.owner.get('/api/school/fees/summary');
    assert.equal(dues.body.total, summary.body.totals.outstanding);
    const col = await A.owner.get('/api/school/fees/collections');
    assert.equal(col.body.total, summary.body.totals.collected);
  });
});

describe('students', () => {
  test('a sibling admitted with the same phone links to the existing guardian', async () => {
    const lookup = await A.owner.get('/api/school/guardians/lookup?phone=+91 98111 11111');
    assert.equal(lookup.body.length, 1);
    assert.equal(lookup.body[0].children[0].name, 'Aarav Test');
    const sib = await A.owner.post('/api/school/students', {
      student: { firstName: 'Anaya' }, guardians: [{ existingId: lookup.body[0].id, relation: 'mother', isPrimary: true }], sectionId: A.sections['5-A'], consentMethod: 'paper',
    });
    const rec = await A.owner.get(`/api/school/students/${sib.body.id}`);
    assert.equal(rec.body.siblings[0].name, 'Aarav Test');
  });

  test('import checks every row first and then imports all of them', async () => {
    const rows = [
      { firstName: 'Ishaan', lastName: 'Bose', gender: 'M', className: '5', sectionName: 'A', guardianName: 'Mr Bose', guardianPhone: '98555 55555', dateOfBirth: '2016-02-01' },
      { firstName: 'Gauri', className: '9', sectionName: 'A', guardianName: 'Mrs K' },
    ];
    const dry = await A.owner.post('/api/school/students/import', { rows, dryRun: true });
    assert.equal(dry.body.errors.length, 1);
    assert.equal(dry.body.errors[0].row, 2);
    const blocked = await A.owner.post('/api/school/students/import', { rows, dryRun: false });
    assert.equal(blocked.body.imported, 0);
    const good = await A.owner.post('/api/school/students/import', { rows: [rows[0]], dryRun: false });
    assert.equal(good.status, 201);
    assert.equal(good.body.imported, 1);
  });

  test('import lists the classes it is missing once, and can add them', async () => {
    const rows = [
      { firstName: 'Tara', className: 'Class 12', sectionName: 'q', guardianName: 'Mr N', guardianPhone: '98444 44444' },
      { firstName: 'Zoya', className: '12', sectionName: 'Q', guardianName: 'Mr N', guardianPhone: '98444 44444' },
      { firstName: 'Kabir', className: '5', sectionName: 'Q', guardianName: 'Mr M' },
    ];
    const dry = await A.owner.post('/api/school/students/import', { rows, dryRun: true });
    assert.equal(dry.body.errors.length, 3);
    assert.deepEqual(
      dry.body.missing.map((m: any) => [m.className, m.sectionName, m.rows, m.classExists]),
      [['12', 'Q', 2, false], ['5', 'Q', 1, true]],
    );

    const ready = await A.owner.post('/api/school/students/import', { rows, dryRun: true, createMissing: true });
    assert.equal(ready.body.errors.length, 0);
    assert.equal(ready.body.valid, 3);
    const before = await A.owner.get('/api/school/structure');
    assert.ok(!before.body.grades.some((g: any) => g.name === '12'), 'a check alone adds nothing');

    const done = await A.owner.post('/api/school/students/import', { rows, dryRun: false, createMissing: true });
    assert.equal(done.status, 201, JSON.stringify(done.body));
    assert.equal(done.body.imported, 3);
    assert.equal(done.body.createdClasses, 1);
    const after = await A.owner.get('/api/school/structure');
    assert.deepEqual(after.body.grades.find((g: any) => g.name === '12').sections.map((s: any) => s.name), ['Q']);
    assert.equal(after.body.grades.find((g: any) => g.name === '12').sections[0].strength, 2);
  });

  test('promotion moves students into next year once, and leaving keeps the record', async () => {
    const year = await A.owner.post('/api/school/years', { name: '2027–28', startsOn: '2027-04-01', endsOn: '2028-03-31', copySectionsFrom: (await A.owner.get('/api/school/me')).body.currentYear.id });
    assert.equal(year.status, 201);
    const next = await A.owner.get(`/api/school/structure?yearId=${year.body.id}`);
    const target = next.body.grades.find((g: any) => g.name === '6').sections.find((s: any) => s.name === 'B').id;
    const promote = await A.owner.post('/api/school/promotions', { fromSectionId: A.sections['6-A'], toSectionId: target, studentIds: [aStudent.id] });
    assert.equal(promote.body.moved, 1);
    const again = await A.owner.post('/api/school/promotions', { fromSectionId: A.sections['6-A'], toSectionId: target, studentIds: [aStudent.id] });
    assert.equal(again.body.skipped, 1);
    const w = await A.owner.post(`/api/school/students/${aStudent.id}/withdraw`, { date: todayIST(), reason: 'Family moved to Lucknow' });
    assert.equal(w.status, 200);
    const rec = await A.owner.get(`/api/school/students/${aStudent.id}`);
    assert.equal(rec.body.student.status, 'withdrawn');
    assert.ok(rec.body.history.length >= 2);
  });

  test('export returns everything held about one student', async () => {
    const res = await A.owner.get(`/api/school/students/${aStudent.id}/export`);
    assert.equal(res.status, 200);
    assert.ok(res.body.attendance.length >= 1);
    assert.ok(res.body.changeHistory.length >= 1);
  });
});

describe('money in words', () => {
  test('uses lakh and crore', () => {
    assert.equal(rupeesInWords(12_500_000), 'One lakh twenty-five thousand rupees only');
    assert.equal(rupeesInWords(1_234_567_800), 'One crore twenty-three lakh forty-five thousand six hundred seventy-eight rupees only');
  });
});

describe('attendance after a move', () => {
  test('correcting an old register keeps the mark of a student who has since moved section', async () => {
    const { owner, sections } = await ownerWithSchool(ctx.app, 'move');
    const a = await admit(owner, sections['6-A'], 'Mover', '9700000001');
    const b = await admit(owner, sections['6-A'], 'Stayer', '9700000002');
    const today = todayIST();
    await owner.put('/api/school/attendance/register', { sectionId: sections['6-A'], date: today, marks: { [a.id]: 'A', [b.id]: 'P' } });
    await owner.post(`/api/school/students/${a.id}/move`, { sectionId: sections['6-B'] });
    const fix = await owner.put('/api/school/attendance/register', { sectionId: sections['6-A'], date: today, marks: { [b.id]: 'L' } });
    assert.equal(fix.status, 200, JSON.stringify(fix.body));
    const rec = await owner.get(`/api/school/students/${a.id}`);
    assert.equal(rec.body.attendance.absent, 1);
  });

  test('a register with nobody in the section is refused', async () => {
    const res = await A.owner.put('/api/school/attendance/register', { sectionId: A.sections['5-A'], date: '2026-04-02', marks: {} });
    assert.equal(res.status, 400);
  });
});

describe('late fees', () => {
  let heads: Record<string, string>;
  const today = todayIST();
  const longOverdue = addDays(today, -100);
  const justOverdue = addDays(today, -30);

  before(async () => {
    C = await ownerWithSchool(ctx.app, 'c');
    const h = await C.owner.get('/api/school/fees/heads');
    heads = Object.fromEntries(h.body.map((x: any) => [x.name, x.id]));
    // ₹10 a day after five days' grace, never more than ₹500 on one instalment.
    const plan = await C.owner.post('/api/school/fees/plans', {
      name: 'With a late fee',
      gradeIds: [C.grades['6']],
      fine: { mode: 'daily', amount: 1000, graceDays: 5, cap: 50000 },
      instalments: [
        { name: 'Term 1', dueOn: longOverdue, amounts: { [heads.Tuition]: 500000 } },
        { name: 'Term 2', dueOn: justOverdue, amounts: { [heads.Tuition]: 500000 } },
        { name: 'Term 3', dueOn: addDays(today, 60), amounts: { [heads.Tuition]: 500000 } },
      ],
    });
    assert.equal(plan.status, 201, JSON.stringify(plan.body));
    cKid = await admit(C.owner, C.sections['6-A'], 'Ishaan', '9855555555');
  });

  test('a fine is charged per day late, counted after the grace period and held at the ceiling', async () => {
    const ledger = await C.owner.get(`/api/school/fees/students/${cKid.id}`);
    const fines = ledger.body.charges.filter((ch: any) => ch.kind === 'fine');
    assert.equal(fines.length, 2, 'only the two overdue instalments carry a fine');
    assert.equal(fines.find((f: any) => f.instalmentName === 'Term 2').amount, 25000, '25 days past the grace period');
    assert.equal(fines.find((f: any) => f.instalmentName === 'Term 1').amount, 50000, '95 days, held at the ceiling');
    assert.equal(ledger.body.totals.fine, 75000);
  });

  test('a fine falls due with its own instalment, and is collected after it', async () => {
    const ledger = await C.owner.get(`/api/school/fees/students/${cKid.id}`);
    const term2 = ledger.body.charges.filter((ch: any) => ch.instalmentName === 'Term 2');
    assert.equal(term2[0].kind, 'plan', 'the fee comes before its fine');
    assert.equal(term2[1].kind, 'fine');
    assert.equal(term2[1].dueOn, justOverdue);
  });

  test('recalculating changes nothing the second time', async () => {
    const again = await C.owner.post('/api/school/fees/fines/apply');
    assert.equal(again.status, 200, JSON.stringify(again.body));
    assert.deepEqual({ created: again.body.created, updated: again.body.updated }, { created: 0, updated: 0 });
  });

  test('a fine stops growing on the day its instalment was cleared', async () => {
    const before = await C.owner.get(`/api/school/fees/students/${cKid.id}`);
    const term2Fee = before.body.charges.find((ch: any) => ch.label === 'Tuition — Term 2');
    const paid = await C.owner.post('/api/school/fees/payments', {
      studentId: cKid.id,
      amount: 500000,
      mode: 'cash',
      paidOn: addDays(today, -20),
      allocations: [{ chargeId: term2Fee.id, amount: 500000 }],
    });
    assert.equal(paid.status, 201, JSON.stringify(paid.body));

    const after = await C.owner.get(`/api/school/fees/students/${cKid.id}`);
    const fines = after.body.charges.filter((ch: any) => ch.kind === 'fine');
    assert.equal(fines.find((f: any) => f.instalmentName === 'Term 2').amount, 5000, 'five days late, not twenty-five');
    assert.equal(fines.find((f: any) => f.instalmentName === 'Term 1').amount, 50000, 'still unpaid, still at the ceiling');
  });

  test('a fine someone has waived is left alone by later recalculation', async () => {
    const ledger = await C.owner.get(`/api/school/fees/students/${cKid.id}`);
    const fine = ledger.body.charges.find((ch: any) => ch.kind === 'fine' && ch.instalmentName === 'Term 1');
    const waived = await C.owner.post(`/api/school/fees/charges/${fine.id}/waive`, { reason: 'Father was in hospital' });
    assert.equal(waived.status, 200, JSON.stringify(waived.body));
    await C.owner.post('/api/school/fees/fines/apply');
    const after = await C.owner.get(`/api/school/fees/students/${cKid.id}`);
    const same = after.body.charges.find((ch: any) => ch.id === fine.id);
    assert.equal(same.amount, 50000);
    assert.equal(same.balance, 0, 'the waiver stands');
  });

  test('a school with no late fee rule charges none', async () => {
    const ledger = await A.owner.get(`/api/school/fees/students/${aStudent.id}`);
    assert.equal(ledger.body.charges.filter((ch: any) => ch.kind === 'fine').length, 0);
  });
});

describe('dues brought forward from an earlier year', () => {
  let owed: number;
  let newSections: Record<string, string>;
  let newYearReceiptId: string;

  before(async () => {
    owed = (await C.owner.get(`/api/school/fees/students/${cKid.id}`)).body.totals.balance;
    assert.ok(owed > 0, 'the student owes something in 2026–27');

    const years = await C.owner.get('/api/school/years');
    const current = years.body.find((y: any) => y.isCurrent);
    const next = await C.owner.post('/api/school/years', {
      name: '2027–28',
      startsOn: '2027-04-01',
      endsOn: '2028-03-31',
      terms: [],
      makeCurrent: true,
      copySectionsFrom: current.id,
    });
    assert.equal(next.status, 201, JSON.stringify(next.body));

    const structure = await C.owner.get('/api/school/structure');
    newSections = {};
    for (const g of structure.body.grades) for (const s of g.sections) newSections[s.label] = s.id;
    const promoted = await C.owner.post('/api/school/promotions', {
      fromSectionId: C.sections['6-A'],
      toSectionId: newSections['6-B'],
      studentIds: [cKid.id],
    });
    assert.equal(promoted.status, 200, JSON.stringify(promoted.body));
  });

  test('the ledger shows last year’s balance brought forward, kept apart from this year', async () => {
    const ledger = await C.owner.get(`/api/school/fees/students/${cKid.id}`);
    assert.equal(ledger.body.year.name, '2027–28');
    assert.equal(ledger.body.charges.length, 0, 'no fee plan in the new year yet');
    assert.equal(ledger.body.broughtForward.length, 1);
    assert.equal(ledger.body.broughtForward[0].yearName, '2026–27');
    assert.equal(ledger.body.broughtForward[0].balance, owed);
    assert.equal(ledger.body.totals.balance, 0, 'nothing owed for this year');
    assert.equal(ledger.body.totals.broughtForward, owed);
    assert.equal(ledger.body.totals.balanceAll, owed, 'what the parent actually owes');
  });

  test('money received in the new year clears what was brought forward', async () => {
    const pay = await C.owner.post('/api/school/fees/payments', { studentId: cKid.id, amount: 100000, mode: 'cash' });
    assert.equal(pay.status, 201, JSON.stringify(pay.body));
    newYearReceiptId = pay.body.id;
    const ledger = await C.owner.get(`/api/school/fees/students/${cKid.id}`);
    assert.equal(ledger.body.totals.broughtForward, owed - 100000);
    assert.equal(ledger.body.totals.balanceAll, owed - 100000);
  });

  test('the receipt’s balance is everything still owed, not only this year’s share', async () => {
    const receipt = await C.owner.get(`/api/school/fees/payments/${newYearReceiptId}`);
    assert.equal(receipt.status, 200);
    assert.equal(receipt.body.balanceNow, owed - 100000, 'the figure a parent reads on the slip');
  });

  test('the dues list carries the student into the new year', async () => {
    const dues = await C.owner.get('/api/school/fees/dues');
    const row = dues.body.rows.find((r: any) => r.studentId === cKid.id);
    assert.ok(row, 'still on the dues list after being promoted');
    assert.equal(row.due, 0);
    assert.equal(row.broughtForward, owed - 100000);
    assert.equal(row.classLabel, '6-B', 'under the class they are in now');
    assert.equal(dues.body.broughtForward, owed - 100000);
    assert.equal(dues.body.total, owed - 100000);
  });

  test('the summary reports it against the class they are in now', async () => {
    const summary = await C.owner.get('/api/school/fees/summary');
    assert.equal(summary.body.totals.broughtForward, owed - 100000);
    assert.equal(summary.body.totals.billed, 0, 'nothing billed this year');
  });
});

describe('the day book', () => {
  let D: Awaited<ReturnType<typeof ownerWithSchool>>;
  let kid: { id: string };
  let office: Client;
  const today = todayIST();

  before(async () => {
    D = await ownerWithSchool(ctx.app, 'd');
    const h = await D.owner.get('/api/school/fees/heads');
    const heads: Record<string, string> = Object.fromEntries(h.body.map((x: any) => [x.name, x.id]));
    const plan = await D.owner.post('/api/school/fees/plans', {
      name: 'Simple',
      gradeIds: [D.grades['6']],
      instalments: [{ name: 'Term 1', dueOn: addDays(today, -10), amounts: { [heads.Tuition]: 1000000 } }],
    });
    assert.equal(plan.status, 201, JSON.stringify(plan.body));
    kid = await admit(D.owner, D.sections['6-A'], 'Reyansh', '9866666666');

    const invited = await D.owner.post('/api/school/staff', { name: 'Sunita Office', email: 'sunita@example.com', role: 'office', invite: true });
    assert.equal(invited.status, 201, JSON.stringify(invited.body));
    office = new Client(ctx.app);
    await office.signUp('Sunita Office', 'sunita@example.com');
    await office.post('/api/auth/organization/accept-invitation', { invitationId: invited.body.invite.id });
    await office.post('/api/auth/organization/set-active', { organizationId: D.schoolId });
  });

  test('the day’s takings are split by how they were paid and by who took them', async () => {
    await D.owner.post('/api/school/fees/payments', { studentId: kid.id, amount: 300000, mode: 'cash' });
    await office.post('/api/school/fees/payments', { studentId: kid.id, amount: 200000, mode: 'upi', reference: 'UPI900' });
    const book = await D.owner.get('/api/school/fees/daybook');
    assert.equal(book.status, 200, JSON.stringify(book.body));
    assert.equal(book.body.totals.collected, 500000);
    assert.equal(book.body.totals.count, 2);
    assert.equal(book.body.expectedCash, 300000, 'only the cash is in the drawer');
    assert.equal(book.body.byMode.find((m: any) => m.mode === 'cash').amount, 300000);
    assert.equal(book.body.byCollector.length, 2);
    assert.equal(book.body.byCollector[0].amount, 300000);
  });

  test('the front office cannot sign a day off', async () => {
    const res = await office.post('/api/school/fees/daybook/close', { day: today, countedCash: 300000 });
    assert.equal(res.status, 403);
  });

  test('closing the day records what was actually counted, and locks it', async () => {
    const close = await D.owner.post('/api/school/fees/daybook/close', { day: today, countedCash: 299000, note: 'One ₹10 note short' });
    assert.equal(close.status, 201, JSON.stringify(close.body));
    assert.equal(close.body.expectedCash, 300000);
    assert.equal(close.body.countedCash, 299000);
    assert.equal(close.body.variance, -1000, 'a shortfall, recorded on the day it happened');

    const twice = await D.owner.post('/api/school/fees/daybook/close', { day: today, countedCash: 300000 });
    assert.equal(twice.status, 409);

    const late = await D.owner.post('/api/school/fees/payments', { studentId: kid.id, amount: 100000, mode: 'cash' });
    assert.equal(late.status, 409);
    assert.equal(late.body.error.code, 'DAY_CLOSED');
  });

  test('a receipt from a closed day cannot be cancelled until the day is reopened', async () => {
    const book = await D.owner.get('/api/school/fees/daybook');
    const receipt = book.body.rows[0];
    const blocked = await D.owner.post(`/api/school/fees/payments/${receipt.id}/cancel`, { reason: 'Written against the wrong child' });
    assert.equal(blocked.status, 409);
    assert.equal(blocked.body.error.code, 'DAY_CLOSED');

    const reopened = await D.owner.post('/api/school/fees/daybook/reopen', { day: today, reason: 'Receipt written against the wrong child' });
    assert.equal(reopened.status, 200, JSON.stringify(reopened.body));
    const allowed = await D.owner.post(`/api/school/fees/payments/${receipt.id}/cancel`, { reason: 'Written against the wrong child' });
    assert.equal(allowed.status, 200, JSON.stringify(allowed.body));

    const after = await D.owner.get('/api/school/fees/daybook');
    assert.equal(after.body.close, null);
    assert.equal(after.body.totals.cancelledCount, 1);
  });

  test('a day that was never closed is listed as still open', async () => {
    await D.owner.post('/api/school/fees/payments', { studentId: kid.id, amount: 50000, mode: 'cash', paidOn: addDays(today, -3) });
    const book = await D.owner.get('/api/school/fees/daybook');
    assert.ok(book.body.stillOpen.some((d: any) => d.day === addDays(today, -3)));
  });
});

describe('siblings and the family discount', () => {
  before(async () => {
    E = await ownerWithSchool(ctx.app, 'e');
    const h = await E.owner.get('/api/school/fees/heads');
    eHeads = Object.fromEntries(h.body.map((x: any) => [x.name, x.id]));
    const plan = await E.owner.post('/api/school/fees/plans', {
      name: 'One term',
      gradeIds: [E.grades['6']],
      instalments: [{ name: 'Term 1', dueOn: addDays(todayIST(), -10), amounts: { [eHeads.Tuition]: 400000 } }],
    });
    assert.equal(plan.status, 201, JSON.stringify(plan.body));

    // The same father, entered the same way both times — which is all the linkage needs.
    const father = { name: 'Rohit Verma', relation: 'father', phone: '9877777777', isPrimary: true };
    const elder = await E.owner.post('/api/school/students', {
      student: { firstName: 'Aanya', lastName: 'Verma', dateOfBirth: '2013-05-02' },
      guardians: [father],
      sectionId: E.sections['6-A'],
      consentMethod: 'paper',
    });
    assert.equal(elder.status, 201, JSON.stringify(elder.body));
    const younger = await E.owner.post('/api/school/students', {
      student: { firstName: 'Vivaan', lastName: 'Verma', dateOfBirth: '2016-08-19' },
      guardians: [father],
      sectionId: E.sections['6-B'],
      consentMethod: 'paper',
    });
    assert.equal(younger.status, 201, JSON.stringify(younger.body));
    eElder = elder.body;
    eYounger = younger.body;
  });

  test('the family is worked out from the shared guardian, eldest first, with what each owes', async () => {
    const res = await E.owner.get(`/api/school/students/${eYounger.id}/siblings`);
    assert.equal(res.status, 200, JSON.stringify(res.body));
    assert.equal(res.body.family.length, 2);
    assert.equal(res.body.guardians.length, 1);
    assert.equal(res.body.family[0].name, 'Aanya Verma');
    assert.equal(res.body.family[0].birthOrder, 1);
    assert.equal(res.body.family[0].classLabel, '6-A');
    assert.equal(res.body.family[1].birthOrder, 2, 'the second child');
    assert.equal(res.body.family[1].isSelf, true);
    assert.equal(res.body.family[0].balance, 400000);
  });

  test('one concession can be given to the whole family at once', async () => {
    const res = await E.owner.post(`/api/school/fees/students/${eYounger.id}/concessions`, {
      headId: eHeads.Tuition,
      percent: 25,
      reason: 'Second child',
      alsoStudentIds: [eElder.id],
    });
    assert.equal(res.status, 201, JSON.stringify(res.body));
    assert.equal(res.body.applied, 2);
    for (const id of [eElder.id, eYounger.id]) {
      const ledger = await E.owner.get(`/api/school/fees/students/${id}`);
      assert.equal(ledger.body.totals.concession, 100000, 'a quarter off the tuition');
      assert.equal(ledger.body.totals.balance, 300000);
    }
  });

  test('a child from another school cannot be swept into a family discount', async () => {
    const res = await E.owner.post(`/api/school/fees/students/${eYounger.id}/concessions`, {
      headId: eHeads.Tuition,
      percent: 50,
      reason: 'Trying it on',
      alsoStudentIds: [aStudent.id],
    });
    assert.equal(res.status, 400);
    const untouched = await A.owner.get(`/api/school/fees/students/${aStudent.id}`);
    assert.ok(!untouched.body.concessions.some((x: any) => x.reason === 'Trying it on'));
  });
});

describe('a cheque the bank sent back', () => {
  let bounced: { id: string };

  test('marking it returned puts the whole due back and can pass on the bank’s charge', async () => {
    const pay = await E.owner.post('/api/school/fees/payments', { studentId: eElder.id, amount: 300000, mode: 'cheque', reference: '456123' });
    assert.equal(pay.status, 201, JSON.stringify(pay.body));
    bounced = pay.body;
    const cleared = await E.owner.get(`/api/school/fees/students/${eElder.id}`);
    assert.equal(cleared.body.totals.balance, 0, 'the cheque cleared the term');

    const res = await E.owner.post(`/api/school/fees/payments/${pay.body.id}/bounce`, { reason: 'Insufficient funds', bankCharge: 25000 });
    assert.equal(res.status, 200, JSON.stringify(res.body));

    const after = await E.owner.get(`/api/school/fees/students/${eElder.id}`);
    assert.equal(after.body.totals.balance, 325000, 'the fee is owed again, plus the bank charge');
    assert.ok(after.body.charges.some((ch: any) => ch.label.startsWith('Bank charges') && ch.amount === 25000));
  });

  test('the receipt stays on file, marked as returned rather than cancelled', async () => {
    const receipt = await E.owner.get(`/api/school/fees/payments/${bounced.id}`);
    assert.equal(receipt.body.payment.status, 'bounced');
    assert.equal(receipt.body.statusLabel, 'Returned by bank');
    assert.equal(receipt.body.payment.bounceReason, 'Insufficient funds');
    assert.equal(receipt.body.payment.bouncedOn, todayIST());
  });

  test('it cannot then be cancelled, or returned twice', async () => {
    assert.equal((await E.owner.post(`/api/school/fees/payments/${bounced.id}/cancel`, { reason: 'x' })).status, 409);
    assert.equal((await E.owner.post(`/api/school/fees/payments/${bounced.id}/bounce`, { reason: 'x' })).status, 409);
  });

  test('cash cannot be sent back by a bank', async () => {
    const pay = await E.owner.post('/api/school/fees/payments', { studentId: eElder.id, amount: 1000, mode: 'cash' });
    assert.equal(pay.status, 201, JSON.stringify(pay.body));
    const res = await E.owner.post(`/api/school/fees/payments/${pay.body.id}/bounce`, { reason: 'Nonsense' });
    assert.equal(res.status, 409);
  });

  test('a returned receipt is left out of the money collected', async () => {
    const col = await E.owner.get('/api/school/fees/collections');
    assert.equal(col.body.bounced, 300000);
    assert.equal(col.body.total, 1000, 'only the cash still counts');
  });
});

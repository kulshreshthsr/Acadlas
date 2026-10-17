// The parent app, tested from both sides: the school inviting and revoking, and a parent —
// or someone pretending to be one — trying to see more than their own children.
// Run with: npm test
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { before, describe, test } from 'node:test';
import { eq } from 'drizzle-orm';
import { parentAccess } from '../db/school-schema';
import { todayIST } from '../lib/dates';
import { Client, ownerWithSchool, startTestApp } from './harness';

let ctx: Awaited<ReturnType<typeof startTestApp>>;
let A: Awaited<ReturnType<typeof ownerWithSchool>>;
let B: Awaited<ReturnType<typeof ownerWithSchool>>;

const DOB = '2015-01-14'; // what harness admit() gives every child
const PASSWORD = 'family-pass-2026';

/** Admits a child with notes nobody outside the school should read, and returns the guardian. */
async function family(owner: Client, sectionId: string, firstName: string, phone: string) {
  const res = await owner.post('/api/school/students', {
    student: { firstName, lastName: 'Test', gender: 'female', dateOfBirth: DOB, notes: `SECRET-NOTE-${firstName}`, category: 'OBC', bloodGroup: 'B+' },
    guardians: [{ name: `Parent of ${firstName}`, relation: 'mother', phone, isPrimary: true }],
    sectionId,
    consentMethod: 'paper',
  });
  assert.equal(res.status, 201, JSON.stringify(res.body));
  const record = await owner.get(`/api/school/students/${res.body.id}`);
  return { studentId: res.body.id as string, guardianId: record.body.guardians[0].id as string };
}

async function invite(owner: Client, guardianId: string) {
  const res = await owner.post(`/api/school/guardians/${guardianId}/parent-invite`, {});
  assert.equal(res.status, 201, JSON.stringify(res.body));
  const secret = String(res.body.url).split('#')[1];
  assert.ok(secret, 'the secret travels after #');
  return { secret, body: res.body };
}

const portalOn = { enabled: true, attendance: 'daily', fees: true, receipts: 'full', studentDetails: false, classTeacher: true };

let asha: { studentId: string; guardianId: string };
let ravi: { studentId: string; guardianId: string };
let schoolBKid: { studentId: string; guardianId: string };
let parent: Client;
let receiptId: string;

before(async () => {
  ctx = await startTestApp();
  A = await ownerWithSchool(ctx.app, 'pa');
  B = await ownerWithSchool(ctx.app, 'pb');
  asha = await family(A.owner, A.sections['6-A'], 'Asha', '9811100001');
  ravi = await family(A.owner, A.sections['6-A'], 'Ravi', '9811100002');
  schoolBKid = await family(B.owner, B.sections['5-A'], 'Bina', '9811100003');

  // Fees for class 6, and one payment for Asha with a note only staff should see.
  const heads = Object.fromEntries((await A.owner.get('/api/school/fees/heads')).body.map((h: any) => [h.name, h.id]));
  const plan = await A.owner.post('/api/school/fees/plans', {
    name: 'Class 6',
    gradeIds: [A.grades['6']],
    instalments: [
      { name: 'Term 1', dueOn: '2026-04-10', amounts: { [heads.Tuition]: 500000 } },
      { name: 'Term 2', dueOn: '2099-10-10', amounts: { [heads.Tuition]: 500000 } },
    ],
  });
  assert.equal(plan.status, 201, JSON.stringify(plan.body));
  const paid = await A.owner.post('/api/school/fees/payments', { studentId: asha.studentId, amount: 200000, mode: 'cash', note: 'SECRET-RECEIPT-NOTE' });
  assert.equal(paid.status, 201, JSON.stringify(paid.body));
  receiptId = paid.body.id ?? paid.body.payment?.id;
  assert.ok(receiptId, JSON.stringify(paid.body));
});

describe('the school turns the parent app on', () => {
  test('nobody can be invited while it is off', async () => {
    const res = await A.owner.post(`/api/school/guardians/${asha.guardianId}/parent-invite`, {});
    assert.equal(res.status, 409);
    assert.equal(res.body.error.code, 'PORTAL_OFF');
  });

  test('it is off by default, with the recommended sections ready', async () => {
    const res = await A.owner.get('/api/school/parent-portal');
    assert.equal(res.status, 200);
    assert.deepEqual(res.body.settings.enabled, false);
    assert.equal(res.body.settings.attendance, 'daily');
    assert.equal(res.body.settings.fees, true);
    assert.equal(res.body.settings.receipts, 'full');
    assert.equal(res.body.settings.studentDetails, false);
  });

  test('turning it on is recorded in the audit trail', async () => {
    const res = await A.owner.put('/api/school/parent-portal', portalOn);
    assert.equal(res.status, 200, JSON.stringify(res.body));
    assert.equal(res.body.settings.enabled, true);
    const activity = await A.owner.get('/api/school/activity');
    assert.ok(JSON.stringify(activity.body).includes('Turned the parent app on'));
    assert.equal((await B.owner.put('/api/school/parent-portal', portalOn)).status, 200);
  });

  test('a guardian with no child’s date of birth cannot be invited', async () => {
    const res = await A.owner.post('/api/school/students', {
      student: { firstName: 'Nodob', lastName: 'Test', gender: 'male' },
      guardians: [{ name: 'Parent of Nodob', relation: 'father', phone: '9811100009', isPrimary: true }],
      sectionId: A.sections['5-A'],
      consentMethod: 'paper',
    });
    assert.equal(res.status, 201, JSON.stringify(res.body));
    const g = (await A.owner.get(`/api/school/students/${res.body.id}`)).body.guardians[0].id;
    const inv = await A.owner.post(`/api/school/guardians/${g}/parent-invite`, {});
    assert.equal(inv.status, 409);
    assert.equal(inv.body.error.code, 'NO_DATE_OF_BIRTH');
  });

  test('one school cannot invite another school’s guardian', async () => {
    const res = await B.owner.post(`/api/school/guardians/${asha.guardianId}/parent-invite`, {});
    assert.equal(res.status, 404);
  });
});

describe('who at the school may invite parents', () => {
  let teacher: Client;
  let accountant: Client;
  before(async () => {
    for (const [role, email] of [
      ['teacher', 'pt-teacher@example.com'],
      ['accountant', 'pt-acc@example.com'],
    ] as const) {
      const inv = await A.owner.post('/api/school/staff', { name: role, email, role, invite: true });
      const c = new Client(ctx.app);
      await c.signUp(role, email);
      await c.post('/api/auth/organization/accept-invitation', { invitationId: inv.body.invite.id });
      await c.post('/api/auth/organization/set-active', { organizationId: A.schoolId });
      if (role === 'teacher') teacher = c;
      else accountant = c;
    }
  });

  test('teachers and accountants cannot invite, revoke or change settings', async () => {
    for (const c of [teacher, accountant]) {
      assert.equal((await c.post(`/api/school/guardians/${asha.guardianId}/parent-invite`, {})).status, 403);
      assert.equal((await c.post(`/api/school/guardians/${asha.guardianId}/parent-revoke`, {})).status, 403);
      assert.equal((await c.put('/api/school/parent-portal', portalOn)).status, 403);
    }
  });
});

describe('the invitation link', () => {
  test('only a hash of its secret is stored', async () => {
    const { secret } = await invite(A.owner, asha.guardianId);
    const [row] = await ctx.db.select().from(parentAccess).where(eq(parentAccess.guardianId, asha.guardianId));
    assert.notEqual(row.tokenHash, secret);
    assert.equal(row.tokenHash, createHash('sha256').update(secret).digest('hex'));
    assert.ok(!JSON.stringify(row).includes(secret));
  });

  test('says what it is for, without naming any child, and masks the phone', async () => {
    const { secret } = await invite(A.owner, asha.guardianId);
    const res = await new Client(ctx.app).post('/api/parent-invite/lookup', { secret });
    assert.equal(res.status, 200, JSON.stringify(res.body));
    assert.equal(res.body.kind, 'new');
    assert.equal(res.body.schoolName, 'School pa');
    assert.equal(res.body.phone, '+91 ••••• •0001');
    assert.ok(!JSON.stringify(res.body).includes('Asha'));
    assert.ok(!JSON.stringify(res.body).includes('9811100001'));
  });

  test('a made-up, malformed or replaced link gets the same answer', async () => {
    const stranger = new Client(ctx.app);
    const old = await invite(A.owner, asha.guardianId);
    await invite(A.owner, asha.guardianId); // replaces it
    for (const secret of ['nope', 'x'.repeat(43), old.secret]) {
      const res = await stranger.post('/api/parent-invite/lookup', { secret });
      assert.equal(res.status, 404);
      assert.equal(res.body.error.code, 'LINK_INVALID');
    }
  });

  test('five wrong dates of birth kill it, even for someone who then gets it right', async () => {
    const { secret } = await invite(A.owner, asha.guardianId);
    const guesser = new Client(ctx.app);
    for (let i = 0; i < 4; i++) {
      const res = await guesser.post('/api/parent-invite/activate', { secret, dateOfBirth: `2015-02-0${i + 1}`, password: PASSWORD });
      assert.equal(res.status, 400);
      assert.equal(res.body.error.code, 'WRONG_DATE_OF_BIRTH');
      assert.match(res.body.error.message, new RegExp(`${4 - i} tr`));
    }
    const fifth = await guesser.post('/api/parent-invite/activate', { secret, dateOfBirth: '2015-02-09', password: PASSWORD });
    assert.equal(fifth.status, 404);
    const right = await guesser.post('/api/parent-invite/activate', { secret, dateOfBirth: DOB, password: PASSWORD });
    assert.equal(right.status, 404);
  });

  test('cannot be used from another website', async () => {
    const { secret } = await invite(A.owner, asha.guardianId);
    const res = await new Client(ctx.app).request('POST', '/api/parent-invite/activate', { secret, dateOfBirth: DOB, password: PASSWORD }, { Origin: 'https://evil.example' });
    assert.equal(res.status, 403);
  });

  test('a password containing the phone number is refused', async () => {
    const { secret } = await invite(A.owner, asha.guardianId);
    const res = await new Client(ctx.app).post('/api/parent-invite/activate', { secret, dateOfBirth: DOB, password: 'me9811100001' });
    assert.equal(res.status, 400);
  });

  test('with the right date of birth it signs the parent in, and then it is spent', async () => {
    const { secret } = await invite(A.owner, asha.guardianId);
    parent = new Client(ctx.app);
    const res = await parent.post('/api/parent-invite/activate', { secret, dateOfBirth: DOB, password: PASSWORD });
    assert.equal(res.status, 200, JSON.stringify(res.body));
    assert.equal(res.body.kind, 'new');
    const me = await parent.get('/api/parent/me');
    assert.equal(me.status, 200, JSON.stringify(me.body));
    assert.deepEqual(me.body.children.map((ch: any) => ch.firstName), ['Asha']);

    const again = await new Client(ctx.app).post('/api/parent-invite/activate', { secret, dateOfBirth: DOB, password: PASSWORD });
    assert.equal(again.status, 404);

    const status = await A.owner.get(`/api/school/students/${asha.studentId}/parent-access`);
    assert.equal(status.body.guardians[0].access.status, 'active');
    assert.equal(status.body.guardians[0].access.linkExpiresAt, null);
  });
});

describe('signing in as a parent', () => {
  test('works with phone number and password', async () => {
    const c = new Client(ctx.app);
    const res = await c.post('/api/auth/sign-in/phone-number', { phoneNumber: '+919811100001', password: PASSWORD });
    assert.equal(res.status, 200, JSON.stringify(res.body));
    assert.equal((await c.get('/api/parent/me')).status, 200);
  });

  test('a wrong password and an unknown number get the same answer', async () => {
    const wrong = await new Client(ctx.app).post('/api/auth/sign-in/phone-number', { phoneNumber: '+919811100001', password: 'not-it-at-all' });
    const unknown = await new Client(ctx.app).post('/api/auth/sign-in/phone-number', { phoneNumber: '+919811199999', password: 'not-it-at-all' });
    assert.equal(wrong.status, 401);
    assert.equal(unknown.status, 401);
    assert.equal(wrong.body.code, unknown.body.code);
  });

  test('codes by SMS are switched off', async () => {
    const c = new Client(ctx.app);
    for (const path of ['send-otp', 'verify', 'request-password-reset', 'reset-password']) {
      const res = await c.post(`/api/auth/phone-number/${path}`, { phoneNumber: '+919811100001', code: '123456', otp: '123456', newPassword: 'x'.repeat(10) });
      assert.equal(res.status, 404, `${path}: ${res.status}`);
    }
  });
});

describe('nobody can attach a parent’s phone number to their own account', () => {
  test('not at sign-up', async () => {
    const c = new Client(ctx.app);
    const res = await c.post('/api/auth/sign-up/email', { name: 'Thief', email: 'thief@example.com', password: 'password-12345', phoneNumber: '+919811100002' });
    assert.notEqual(res.status, 200);
    const signIn = await new Client(ctx.app).post('/api/auth/sign-in/phone-number', { phoneNumber: '+919811100002', password: 'password-12345' });
    assert.equal(signIn.status, 401);
  });

  test('not by editing their profile', async () => {
    const c = new Client(ctx.app);
    await c.signUp('Thief Two', 'thief2@example.com');
    const res = await c.post('/api/auth/update-user', { phoneNumber: '+919811100002' });
    assert.notEqual(res.status, 200);
    const verified = await c.post('/api/auth/update-user', { phoneNumberVerified: true });
    assert.notEqual(verified.status, 200);
  });
});

describe('a parent sees their own children, and nothing else', () => {
  test('not another family’s child in the same school', async () => {
    for (const path of [`/children/${ravi.studentId}`, `/children/${ravi.studentId}/fees`, `/children/${ravi.studentId}/attendance?month=2026-07`, `/children/${ravi.studentId}/receipts`]) {
      const res = await parent.get(`/api/parent${path}`);
      assert.equal(res.status, 404, path);
    }
  });

  test('not a child in another school', async () => {
    assert.equal((await parent.get(`/api/parent/children/${schoolBKid.studentId}`)).status, 404);
  });

  test('not another family’s receipt', async () => {
    const other = await A.owner.post('/api/school/fees/payments', { studentId: ravi.studentId, amount: 100000, mode: 'cash' });
    assert.equal(other.status, 201);
    const otherId = other.body.id ?? other.body.payment?.id;
    assert.equal((await parent.get(`/api/parent/receipts/${otherId}`)).status, 404);
    assert.equal((await parent.get(`/api/parent/receipts/${receiptId}`)).status, 200);
  });

  test('not the school’s own pages', async () => {
    for (const path of ['/api/school/me', '/api/school/students', `/api/school/students/${asha.studentId}`, '/api/school/staff', '/api/school/fees/dues']) {
      const res = await parent.get(path);
      assert.ok(res.status === 403 || res.status === 409 || res.status === 401, `${path}: ${res.status}`);
    }
  });

  test('cannot create a school', async () => {
    const res = await parent.post('/api/auth/organization/create', { name: 'Parent school', slug: 'parent-school-x' });
    assert.notEqual(res.status, 200);
  });

  test('cannot list the school’s staff through the auth API', async () => {
    const res = await parent.get(`/api/auth/organization/get-full-organization?organizationId=${A.schoolId}`);
    assert.ok(!JSON.stringify(res.body ?? '').includes('owner-pa@example.com'));
  });

  test('nothing internal is ever sent: notes, category, consent, who took the money', async () => {
    const bodies = [
      await parent.get('/api/parent/me'),
      await parent.get(`/api/parent/children/${asha.studentId}`),
      await parent.get(`/api/parent/children/${asha.studentId}/fees`),
      await parent.get(`/api/parent/children/${asha.studentId}/receipts`),
      await parent.get(`/api/parent/receipts/${receiptId}`),
    ].map((r) => {
      assert.equal(r.status, 200, JSON.stringify(r.body));
      return JSON.stringify(r.body);
    });
    for (const text of bodies) {
      for (const secret of ['SECRET-NOTE', 'SECRET-RECEIPT-NOTE', 'OBC', 'consent', 'Owner pa', 'owner-pa@example.com', 'receivedBy']) {
        assert.ok(!text.includes(secret), `leaked "${secret}" in ${text.slice(0, 200)}`);
      }
    }
  });
});

describe('what the school shows is what the parent gets', () => {
  test('the child’s page follows the settings', async () => {
    const page = await parent.get(`/api/parent/children/${asha.studentId}`);
    assert.equal(page.body.fees.due, 800000);
    assert.equal(page.body.details, null); // student details are off by default
    assert.equal(page.body.child.classLabel, '6-A');
  });

  test('a section switched off is refused, not merely hidden', async () => {
    await A.owner.put('/api/school/parent-portal', { ...portalOn, fees: false, receipts: 'off', attendance: 'off', classTeacher: false });
    const page = await parent.get(`/api/parent/children/${asha.studentId}`);
    assert.equal(page.status, 200);
    assert.equal(page.body.fees, null);
    assert.equal(page.body.attendance, null);
    assert.equal((await parent.get(`/api/parent/children/${asha.studentId}/fees`)).body.error.code, 'SECTION_OFF');
    assert.equal((await parent.get(`/api/parent/children/${asha.studentId}/receipts`)).status, 403);
    assert.equal((await parent.get(`/api/parent/receipts/${receiptId}`)).status, 403);
    assert.equal((await parent.get(`/api/parent/children/${asha.studentId}/attendance?month=2026-07`)).status, 403);
  });

  test('receipts as a list only: the list shows, a single receipt does not open', async () => {
    await A.owner.put('/api/school/parent-portal', { ...portalOn, receipts: 'list' });
    const list = await parent.get(`/api/parent/children/${asha.studentId}/receipts`);
    assert.equal(list.status, 200);
    assert.equal(list.body.canOpen, false);
    assert.equal(list.body.receipts.length, 1);
    assert.equal((await parent.get(`/api/parent/receipts/${receiptId}`)).status, 403);
  });

  test('attendance as a summary: the month’s totals, no day-by-day marks', async () => {
    await A.owner.put('/api/school/parent-portal', { ...portalOn, attendance: 'summary' });
    await A.owner.put('/api/school/attendance/register', { sectionId: A.sections['6-A'], date: todayIST(), marks: { [asha.studentId]: 'A', [ravi.studentId]: 'P' } });
    const month = todayIST().slice(0, 7);
    const res = await parent.get(`/api/parent/children/${asha.studentId}/attendance?month=${month}`);
    assert.equal(res.status, 200);
    assert.equal(res.body.days, null);
    assert.equal(res.body.summary.absent, 1);
  });

  test('student details appear only when switched on', async () => {
    await A.owner.put('/api/school/parent-portal', { ...portalOn, studentDetails: true });
    const page = await parent.get(`/api/parent/children/${asha.studentId}`);
    assert.equal(page.body.details.dateOfBirth, DOB);
    assert.equal(page.body.details.bloodGroup, 'B+');
  });

  test('day by day, a child keeps their marks after moving section', async () => {
    await A.owner.put('/api/school/parent-portal', portalOn);
    const moved = await A.owner.post(`/api/school/students/${asha.studentId}/move`, { sectionId: A.sections['6-B'] });
    assert.ok(moved.status < 300, JSON.stringify(moved.body));
    const month = todayIST().slice(0, 7);
    const res = await parent.get(`/api/parent/children/${asha.studentId}/attendance?month=${month}`);
    assert.equal(res.body.mode, 'daily');
    assert.equal(res.body.days.find((d: any) => d.date === todayIST()).mark, 'A');
    // Ravi's mark in the same register is not Asha's to see.
    assert.ok(!JSON.stringify(res.body).includes(ravi.studentId));
  });

  test('switching the whole app off shuts parents out at once', async () => {
    await A.owner.put('/api/school/parent-portal', { ...portalOn, enabled: false });
    assert.equal((await parent.get('/api/parent/me')).status, 403);
    await A.owner.put('/api/school/parent-portal', portalOn);
    assert.equal((await parent.get('/api/parent/me')).status, 200);
  });
});

describe('a parent with children at two schools', () => {
  let bina: { studentId: string; guardianId: string };
  before(async () => {
    // School B has the same mother, on the same number.
    bina = await family(B.owner, B.sections['5-A'], 'Bindu', '9811100001');
  });

  test('the second link asks for the password they already have, not a new one', async () => {
    const { secret } = await invite(B.owner, bina.guardianId);
    const c = new Client(ctx.app);
    assert.equal((await c.post('/api/parent-invite/lookup', { secret })).body.kind, 'existing');
    const noPassword = await c.post('/api/parent-invite/activate', { secret, dateOfBirth: DOB, password: 'trying-to-take-over' });
    assert.equal(noPassword.status, 400);
    const wrong = await c.post('/api/parent-invite/activate', { secret, dateOfBirth: DOB, currentPassword: 'trying-to-take-over' });
    assert.equal(wrong.status, 400);
    assert.equal(wrong.body.error.code, 'WRONG_PASSWORD');
    // The existing password still works: nothing was changed.
    assert.equal((await new Client(ctx.app).post('/api/auth/sign-in/phone-number', { phoneNumber: '+919811100001', password: PASSWORD })).status, 200);

    const ok = await c.post('/api/parent-invite/activate', { secret, dateOfBirth: DOB, currentPassword: PASSWORD });
    assert.equal(ok.status, 200, JSON.stringify(ok.body));
    const me = await parent.get('/api/parent/me');
    assert.deepEqual(me.body.children.map((ch: any) => ch.firstName).sort(), ['Asha', 'Bindu']);
  });

  test('school B removing access leaves school A’s child in place', async () => {
    assert.equal((await B.owner.post(`/api/school/guardians/${bina.guardianId}/parent-revoke`, {})).status, 200);
    const me = await parent.get('/api/parent/me');
    assert.equal(me.status, 200);
    assert.deepEqual(me.body.children.map((ch: any) => ch.firstName), ['Asha']);
  });
});

describe('a forgotten password', () => {
  test('a fresh link resets it and signs out every other device', async () => {
    const other = new Client(ctx.app);
    assert.equal((await other.post('/api/auth/sign-in/phone-number', { phoneNumber: '+919811100001', password: PASSWORD })).status, 200);
    assert.equal((await other.get('/api/parent/me')).status, 200);

    const { secret, body } = await invite(A.owner, asha.guardianId);
    assert.equal(body.reset, true);
    const c = new Client(ctx.app);
    assert.equal((await c.post('/api/parent-invite/lookup', { secret })).body.kind, 'reset');
    const res = await c.post('/api/parent-invite/activate', { secret, dateOfBirth: DOB, password: 'a-brand-new-pass' });
    assert.equal(res.status, 200, JSON.stringify(res.body));

    assert.equal((await other.get('/api/parent/me')).status, 401);
    assert.equal((await parent.get('/api/parent/me')).status, 401);
    assert.equal((await c.get('/api/parent/me')).status, 200);
    assert.equal((await new Client(ctx.app).post('/api/auth/sign-in/phone-number', { phoneNumber: '+919811100001', password: PASSWORD })).status, 401);
    parent = c;
  });
});

describe('removing a parent’s access', () => {
  test('takes effect on their very next request, and signs them out', async () => {
    assert.equal((await parent.get('/api/parent/me')).status, 200);
    const res = await A.owner.post(`/api/school/guardians/${asha.guardianId}/parent-revoke`, {});
    assert.equal(res.status, 200);
    const after = await parent.get('/api/parent/me');
    assert.ok(after.status === 401 || after.status === 403, String(after.status));
    const status = await A.owner.get(`/api/school/students/${asha.studentId}/parent-access`);
    assert.equal(status.body.guardians[0].access.status, 'revoked');
  });

  test('changing a guardian’s phone number ends their access, since the old number may be someone else’s now', async () => {
    const kid = await family(A.owner, A.sections['5-A'], 'Chhaya', '9811100005');
    const { secret } = await invite(A.owner, kid.guardianId);
    const c = new Client(ctx.app);
    assert.equal((await c.post('/api/parent-invite/activate', { secret, dateOfBirth: DOB, password: 'chhaya-mum-pass' })).status, 200);
    assert.equal((await c.get('/api/parent/me')).status, 200);
    const edit = await A.owner.patch(`/api/school/guardians/${kid.guardianId}`, { phone: '9811100006' });
    assert.equal(edit.status, 200, JSON.stringify(edit.body));
    assert.equal(edit.body.parentAccessEnded, true);
    const after = await c.get('/api/parent/me');
    assert.ok(after.status === 401 || after.status === 403, String(after.status));
    // A name-only edit leaves access alone.
    const other = await family(A.owner, A.sections['5-A'], 'Deepa', '9811100007');
    const link = await invite(A.owner, other.guardianId);
    const d = new Client(ctx.app);
    assert.equal((await d.post('/api/parent-invite/activate', { secret: link.secret, dateOfBirth: DOB, password: 'deepa-mum-pass' })).status, 200);
    assert.equal((await A.owner.patch(`/api/school/guardians/${other.guardianId}`, { name: 'Deepa’s mother' })).body.parentAccessEnded, false);
    assert.equal((await d.get('/api/parent/me')).status, 200);
  });

  test('a withdrawn child disappears from the parent app', async () => {
    const { secret } = await invite(A.owner, ravi.guardianId);
    const c = new Client(ctx.app);
    assert.equal((await c.post('/api/parent-invite/activate', { secret, dateOfBirth: DOB, password: 'ravi-mum-pass-1' })).status, 200);
    assert.equal((await c.get(`/api/parent/children/${ravi.studentId}`)).status, 200);
    const w = await A.owner.post(`/api/school/students/${ravi.studentId}/withdraw`, { date: todayIST(), reason: 'Moved city' });
    assert.ok(w.status < 300, JSON.stringify(w.body));
    assert.equal((await c.get(`/api/parent/children/${ravi.studentId}`)).status, 404);
  });
});


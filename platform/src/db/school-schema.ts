// Acadlas School's own tables. Hand-written (unlike auth-schema.ts, which Better Auth
// generates) and pushed with the same `npm run db:push`.
//
// Two rules hold for every table in this file:
//
// 1. It has a `school_id` that points at the school (a Better Auth organization) and is
//    deleted with it. Every query the API makes filters on it — see src/school/tenant.ts.
// 2. Money is stored as whole paise in integer columns, never as a decimal or float, so a
//    fee of ₹6,500 is 650000 and no rupee is ever lost to rounding.
//
// Dates a person reads as dates (date of birth, a due date, the day a register was taken)
// are Postgres `date` columns handled as 'YYYY-MM-DD' strings, so time zones can never move
// a student's birthday or an attendance mark to the day before.
import { relations, sql } from 'drizzle-orm';
import {
  boolean,
  date,
  index,
  integer,
  jsonb,
  pgTable,
  primaryKey,
  smallint,
  text,
  timestamp,
  uniqueIndex,
} from 'drizzle-orm/pg-core';
import { organization, user } from './auth-schema';

export function newId(): string {
  return crypto.randomUUID();
}

const id = () => text('id').primaryKey().$defaultFn(newId);

const schoolId = () =>
  text('school_id')
    .notNull()
    .references(() => organization.id, { onDelete: 'cascade' });

const createdAt = () => timestamp('created_at', { withTimezone: true }).defaultNow().notNull();
const updatedAt = () =>
  timestamp('updated_at', { withTimezone: true })
    .defaultNow()
    .$onUpdate(() => new Date())
    .notNull();

const day = (name: string) => date(name, { mode: 'string' });

// ---------------------------------------------------------------------------
// The school itself
// ---------------------------------------------------------------------------

/** One row per school, created alongside the organization. Everything a receipt or report header needs. */
export const schoolProfile = pgTable('school_profile', {
  schoolId: text('school_id')
    .primaryKey()
    .references(() => organization.id, { onDelete: 'cascade' }),
  board: text('board'),
  affiliationNo: text('affiliation_no'),
  udiseCode: text('udise_code'),
  address: text('address'),
  city: text('city'),
  state: text('state'),
  pincode: text('pincode'),
  phone: text('phone'),
  email: text('email'),
  principalName: text('principal_name'),
  /** Bit 0 = Monday … bit 6 = Sunday. Monday to Saturday by default, as most Indian schools work. */
  workingDays: smallint('working_days').default(0b0111111).notNull(),
  admissionPrefix: text('admission_prefix').default('ADM').notNull(),
  receiptPrefix: text('receipt_prefix').default('RCT').notNull(),
  setupCompletedAt: timestamp('setup_completed_at', { withTimezone: true }),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
});

/** Running numbers (admission numbers, receipt numbers), incremented atomically per school. */
export const counter = pgTable(
  'counter',
  {
    schoolId: schoolId(),
    key: text('key').notNull(),
    value: integer('value').default(0).notNull(),
  },
  (t) => [primaryKey({ columns: [t.schoolId, t.key] })],
);

// ---------------------------------------------------------------------------
// Academic structure
// ---------------------------------------------------------------------------

export const academicYear = pgTable(
  'academic_year',
  {
    id: id(),
    schoolId: schoolId(),
    name: text('name').notNull(),
    startsOn: day('starts_on').notNull(),
    endsOn: day('ends_on').notNull(),
    isCurrent: boolean('is_current').default(false).notNull(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    uniqueIndex('academic_year_school_name_uq').on(t.schoolId, t.name),
    // At most one current year per school.
    uniqueIndex('academic_year_current_uq').on(t.schoolId).where(sql`${t.isCurrent}`),
  ],
);

export const term = pgTable(
  'term',
  {
    id: id(),
    schoolId: schoolId(),
    yearId: text('year_id')
      .notNull()
      .references(() => academicYear.id, { onDelete: 'cascade' }),
    name: text('name').notNull(),
    startsOn: day('starts_on').notNull(),
    endsOn: day('ends_on').notNull(),
    position: smallint('position').default(0).notNull(),
  },
  (t) => [index('term_year_idx').on(t.yearId)],
);

/** A class level that lasts across years: "Nursery", "LKG", "1" … "12". */
export const grade = pgTable(
  'grade',
  {
    id: id(),
    schoolId: schoolId(),
    name: text('name').notNull(),
    position: smallint('position').default(0).notNull(),
    createdAt: createdAt(),
  },
  (t) => [uniqueIndex('grade_school_name_uq').on(t.schoolId, t.name)],
);

/** A section of a class in one academic year: 6-B in 2026–27. */
export const section = pgTable(
  'section',
  {
    id: id(),
    schoolId: schoolId(),
    yearId: text('year_id')
      .notNull()
      .references(() => academicYear.id, { onDelete: 'cascade' }),
    gradeId: text('grade_id')
      .notNull()
      .references(() => grade.id, { onDelete: 'cascade' }),
    name: text('name').notNull(),
    classTeacherId: text('class_teacher_id').references(() => staff.id, { onDelete: 'set null' }),
    room: text('room'),
    capacity: smallint('capacity'),
    createdAt: createdAt(),
  },
  (t) => [
    uniqueIndex('section_year_grade_name_uq').on(t.yearId, t.gradeId, t.name),
    index('section_school_year_idx').on(t.schoolId, t.yearId),
  ],
);

export const subject = pgTable(
  'subject',
  {
    id: id(),
    schoolId: schoolId(),
    name: text('name').notNull(),
    code: text('code'),
    createdAt: createdAt(),
  },
  (t) => [uniqueIndex('subject_school_name_uq').on(t.schoolId, t.name)],
);

/** Which subjects a class level studies. */
export const gradeSubject = pgTable(
  'grade_subject',
  {
    schoolId: schoolId(),
    gradeId: text('grade_id')
      .notNull()
      .references(() => grade.id, { onDelete: 'cascade' }),
    subjectId: text('subject_id')
      .notNull()
      .references(() => subject.id, { onDelete: 'cascade' }),
  },
  (t) => [primaryKey({ columns: [t.gradeId, t.subjectId] })],
);

/** Who teaches a subject to a section. */
export const teachingAssignment = pgTable(
  'teaching_assignment',
  {
    id: id(),
    schoolId: schoolId(),
    sectionId: text('section_id')
      .notNull()
      .references(() => section.id, { onDelete: 'cascade' }),
    subjectId: text('subject_id')
      .notNull()
      .references(() => subject.id, { onDelete: 'cascade' }),
    staffId: text('staff_id')
      .notNull()
      .references(() => staff.id, { onDelete: 'cascade' }),
  },
  (t) => [
    uniqueIndex('teaching_assignment_section_subject_uq').on(t.sectionId, t.subjectId),
    index('teaching_assignment_staff_idx').on(t.staffId),
  ],
);

export const holiday = pgTable(
  'holiday',
  {
    id: id(),
    schoolId: schoolId(),
    date: day('date').notNull(),
    name: text('name').notNull(),
  },
  (t) => [uniqueIndex('holiday_school_date_uq').on(t.schoolId, t.date)],
);

// ---------------------------------------------------------------------------
// People
// ---------------------------------------------------------------------------

/**
 * Everyone who works at the school. A staff member may or may not have an Acadlas login:
 * `userId` is filled in when they accept their invitation (matched by email).
 */
export const staff = pgTable(
  'staff',
  {
    id: id(),
    schoolId: schoolId(),
    userId: text('user_id').references(() => user.id, { onDelete: 'set null' }),
    name: text('name').notNull(),
    email: text('email'),
    phone: text('phone'),
    designation: text('designation'),
    employeeCode: text('employee_code'),
    joinedOn: day('joined_on'),
    status: text('status', { enum: ['active', 'left'] }).default('active').notNull(),
    invitationId: text('invitation_id'),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    index('staff_school_idx').on(t.schoolId),
    uniqueIndex('staff_school_email_uq').on(t.schoolId, t.email).where(sql`${t.email} is not null`),
    uniqueIndex('staff_school_user_uq').on(t.schoolId, t.userId).where(sql`${t.userId} is not null`),
  ],
);

export const student = pgTable(
  'student',
  {
    id: id(),
    schoolId: schoolId(),
    admissionNo: text('admission_no').notNull(),
    firstName: text('first_name').notNull(),
    lastName: text('last_name'),
    gender: text('gender', { enum: ['female', 'male', 'other'] }),
    dateOfBirth: day('date_of_birth'),
    bloodGroup: text('blood_group'),
    /** APAAR ID — the national student identifier CBSE now uses as primary. */
    apaarId: text('apaar_id'),
    /** Permanent Education Number from UDISE+. */
    pen: text('pen'),
    /** Social category as UDISE+ asks for it. Optional and only for official returns. */
    category: text('category'),
    /** Admitted under the RTE 25% quota: fees are fully waived. */
    isRte: boolean('is_rte').default(false).notNull(),
    address: text('address'),
    previousSchool: text('previous_school'),
    notes: text('notes'),
    status: text('status', { enum: ['active', 'withdrawn', 'graduated'] }).default('active').notNull(),
    admittedOn: day('admitted_on').notNull(),
    leftOn: day('left_on'),
    leftReason: text('left_reason'),
    /** When and how a guardian's consent to keep these records was recorded (DPDP Act). */
    consentRecordedAt: timestamp('consent_recorded_at', { withTimezone: true }),
    consentMethod: text('consent_method', { enum: ['paper', 'digital', 'verbal'] }),
    consentRecordedBy: text('consent_recorded_by').references(() => user.id, { onDelete: 'set null' }),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    uniqueIndex('student_school_admission_uq').on(t.schoolId, t.admissionNo),
    index('student_school_status_idx').on(t.schoolId, t.status),
  ],
);

export const guardian = pgTable(
  'guardian',
  {
    id: id(),
    schoolId: schoolId(),
    name: text('name').notNull(),
    /** Ten digits, no +91 or spaces — what WhatsApp links and SMS gateways both want. */
    phone: text('phone'),
    altPhone: text('alt_phone'),
    email: text('email'),
    occupation: text('occupation'),
    address: text('address'),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [index('guardian_school_phone_idx').on(t.schoolId, t.phone)],
);

export const studentGuardian = pgTable(
  'student_guardian',
  {
    schoolId: schoolId(),
    studentId: text('student_id')
      .notNull()
      .references(() => student.id, { onDelete: 'cascade' }),
    guardianId: text('guardian_id')
      .notNull()
      .references(() => guardian.id, { onDelete: 'cascade' }),
    relation: text('relation', { enum: ['father', 'mother', 'guardian', 'other'] }).notNull(),
    isPrimary: boolean('is_primary').default(false).notNull(),
  },
  (t) => [
    primaryKey({ columns: [t.studentId, t.guardianId] }),
    index('student_guardian_guardian_idx').on(t.guardianId),
  ],
);

/** A student's place in one academic year. Moving section updates this row; the audit log keeps the history. */
export const enrollment = pgTable(
  'enrollment',
  {
    id: id(),
    schoolId: schoolId(),
    studentId: text('student_id')
      .notNull()
      .references(() => student.id, { onDelete: 'cascade' }),
    yearId: text('year_id')
      .notNull()
      .references(() => academicYear.id, { onDelete: 'cascade' }),
    sectionId: text('section_id')
      .notNull()
      .references(() => section.id, { onDelete: 'restrict' }),
    rollNo: smallint('roll_no'),
    enrolledOn: day('enrolled_on').notNull(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    uniqueIndex('enrollment_student_year_uq').on(t.studentId, t.yearId),
    index('enrollment_section_idx').on(t.sectionId),
    index('enrollment_school_year_idx').on(t.schoolId, t.yearId),
  ],
);

// ---------------------------------------------------------------------------
// Attendance
// ---------------------------------------------------------------------------

export type Mark = 'P' | 'A' | 'L';

/**
 * One register per section per day, holding every student's mark. Submitted in one write
 * from a teacher's phone, so a flaky connection either saves the whole register or none of
 * it — and it takes a fraction of the space of a row per student per day.
 */
export const attendanceRegister = pgTable(
  'attendance_register',
  {
    id: id(),
    schoolId: schoolId(),
    sectionId: text('section_id')
      .notNull()
      .references(() => section.id, { onDelete: 'cascade' }),
    date: day('date').notNull(),
    marks: jsonb('marks').$type<Record<string, Mark>>().notNull(),
    present: smallint('present').notNull(),
    absent: smallint('absent').notNull(),
    late: smallint('late').notNull(),
    takenBy: text('taken_by').references(() => user.id, { onDelete: 'set null' }),
    takenByName: text('taken_by_name'),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    uniqueIndex('attendance_register_section_date_uq').on(t.sectionId, t.date),
    index('attendance_register_school_date_idx').on(t.schoolId, t.date),
  ],
);

// ---------------------------------------------------------------------------
// Fees
// ---------------------------------------------------------------------------

/** What a charge is for: Tuition, Transport, Annual charges … */
export const feeHead = pgTable(
  'fee_head',
  {
    id: id(),
    schoolId: schoolId(),
    name: text('name').notNull(),
    position: smallint('position').default(0).notNull(),
    createdAt: createdAt(),
  },
  (t) => [uniqueIndex('fee_head_school_name_uq').on(t.schoolId, t.name)],
);

/** A grid of instalments × heads, applied to one or more class levels for one year. */
export const feePlan = pgTable(
  'fee_plan',
  {
    id: id(),
    schoolId: schoolId(),
    yearId: text('year_id')
      .notNull()
      .references(() => academicYear.id, { onDelete: 'cascade' }),
    name: text('name').notNull(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [uniqueIndex('fee_plan_year_name_uq').on(t.yearId, t.name)],
);

export const feePlanGrade = pgTable(
  'fee_plan_grade',
  {
    schoolId: schoolId(),
    planId: text('plan_id')
      .notNull()
      .references(() => feePlan.id, { onDelete: 'cascade' }),
    yearId: text('year_id')
      .notNull()
      .references(() => academicYear.id, { onDelete: 'cascade' }),
    gradeId: text('grade_id')
      .notNull()
      .references(() => grade.id, { onDelete: 'cascade' }),
  },
  // A class level follows exactly one plan in a given year.
  (t) => [primaryKey({ columns: [t.planId, t.gradeId] }), uniqueIndex('fee_plan_grade_year_uq').on(t.yearId, t.gradeId)],
);

export const feeInstalment = pgTable(
  'fee_instalment',
  {
    id: id(),
    schoolId: schoolId(),
    planId: text('plan_id')
      .notNull()
      .references(() => feePlan.id, { onDelete: 'cascade' }),
    name: text('name').notNull(),
    dueOn: day('due_on').notNull(),
    position: smallint('position').default(0).notNull(),
  },
  (t) => [index('fee_instalment_plan_idx').on(t.planId)],
);

/** One cell of the plan grid: this head, in this instalment, costs this much. */
export const feeLine = pgTable(
  'fee_line',
  {
    id: id(),
    schoolId: schoolId(),
    planId: text('plan_id')
      .notNull()
      .references(() => feePlan.id, { onDelete: 'cascade' }),
    instalmentId: text('instalment_id')
      .notNull()
      .references(() => feeInstalment.id, { onDelete: 'cascade' }),
    headId: text('head_id')
      .notNull()
      .references(() => feeHead.id, { onDelete: 'restrict' }),
    amount: integer('amount').notNull(),
  },
  (t) => [uniqueIndex('fee_line_instalment_head_uq').on(t.instalmentId, t.headId)],
);

/** A standing concession for one student: a percentage off one head, or off everything. */
export const feeConcession = pgTable(
  'fee_concession',
  {
    id: id(),
    schoolId: schoolId(),
    studentId: text('student_id')
      .notNull()
      .references(() => student.id, { onDelete: 'cascade' }),
    headId: text('head_id').references(() => feeHead.id, { onDelete: 'cascade' }),
    percent: smallint('percent').notNull(),
    reason: text('reason').notNull(),
    createdBy: text('created_by').references(() => user.id, { onDelete: 'set null' }),
    createdAt: createdAt(),
  },
  (t) => [index('fee_concession_student_idx').on(t.studentId)],
);

/**
 * What one student owes for one thing. Generated from the plan (one per student per plan
 * cell) or added by hand (a late fine, a lost ID card). Net due = amount − concession.
 */
export const feeCharge = pgTable(
  'fee_charge',
  {
    id: id(),
    schoolId: schoolId(),
    studentId: text('student_id')
      .notNull()
      .references(() => student.id, { onDelete: 'cascade' }),
    yearId: text('year_id')
      .notNull()
      .references(() => academicYear.id, { onDelete: 'cascade' }),
    lineId: text('line_id').references(() => feeLine.id, { onDelete: 'set null' }),
    headId: text('head_id')
      .notNull()
      .references(() => feeHead.id, { onDelete: 'restrict' }),
    instalmentName: text('instalment_name'),
    label: text('label').notNull(),
    dueOn: day('due_on').notNull(),
    amount: integer('amount').notNull(),
    concession: integer('concession').default(0).notNull(),
    concessionNote: text('concession_note'),
    createdBy: text('created_by').references(() => user.id, { onDelete: 'set null' }),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    uniqueIndex('fee_charge_student_line_uq').on(t.studentId, t.lineId).where(sql`${t.lineId} is not null`),
    index('fee_charge_school_due_idx').on(t.schoolId, t.dueOn),
    index('fee_charge_student_idx').on(t.studentId),
  ],
);

/** Money received. Never deleted: a mistaken receipt is cancelled, with a reason, and stays on file. */
export const payment = pgTable(
  'payment',
  {
    id: id(),
    schoolId: schoolId(),
    studentId: text('student_id')
      .notNull()
      .references(() => student.id, { onDelete: 'restrict' }),
    receiptNo: text('receipt_no').notNull(),
    amount: integer('amount').notNull(),
    mode: text('mode', { enum: ['cash', 'upi', 'card', 'cheque', 'bank'] }).notNull(),
    reference: text('reference'),
    paidOn: day('paid_on').notNull(),
    note: text('note'),
    receivedBy: text('received_by').references(() => user.id, { onDelete: 'set null' }),
    receivedByName: text('received_by_name'),
    status: text('status', { enum: ['valid', 'cancelled'] }).default('valid').notNull(),
    cancelledAt: timestamp('cancelled_at', { withTimezone: true }),
    cancelledByName: text('cancelled_by_name'),
    cancelReason: text('cancel_reason'),
    createdAt: createdAt(),
  },
  (t) => [
    uniqueIndex('payment_school_receipt_uq').on(t.schoolId, t.receiptNo),
    index('payment_school_paid_idx').on(t.schoolId, t.paidOn),
    index('payment_student_idx').on(t.studentId),
  ],
);

export const paymentAllocation = pgTable(
  'payment_allocation',
  {
    schoolId: schoolId(),
    paymentId: text('payment_id')
      .notNull()
      .references(() => payment.id, { onDelete: 'cascade' }),
    chargeId: text('charge_id')
      .notNull()
      .references(() => feeCharge.id, { onDelete: 'restrict' }),
    amount: integer('amount').notNull(),
  },
  (t) => [primaryKey({ columns: [t.paymentId, t.chargeId] }), index('payment_allocation_charge_idx').on(t.chargeId)],
);

// ---------------------------------------------------------------------------
// The trail
// ---------------------------------------------------------------------------

/** Who changed what, and when. Written in the same transaction as the change it describes. */
export const auditEvent = pgTable(
  'audit_event',
  {
    id: id(),
    schoolId: schoolId(),
    actorId: text('actor_id').references(() => user.id, { onDelete: 'set null' }),
    actorName: text('actor_name'),
    action: text('action').notNull(),
    entityType: text('entity_type').notNull(),
    entityId: text('entity_id'),
    /** Set when the event belongs on a student's own timeline. */
    studentId: text('student_id').references(() => student.id, { onDelete: 'cascade' }),
    summary: text('summary').notNull(),
    data: jsonb('data').$type<Record<string, unknown>>(),
    createdAt: createdAt(),
  },
  (t) => [
    index('audit_event_school_created_idx').on(t.schoolId, t.createdAt),
    index('audit_event_student_idx').on(t.studentId),
  ],
);

// ---------------------------------------------------------------------------
// Relations (for db.query)
// ---------------------------------------------------------------------------

export const sectionRelations = relations(section, ({ one, many }) => ({
  grade: one(grade, { fields: [section.gradeId], references: [grade.id] }),
  year: one(academicYear, { fields: [section.yearId], references: [academicYear.id] }),
  classTeacher: one(staff, { fields: [section.classTeacherId], references: [staff.id] }),
  enrollments: many(enrollment),
}));

export const enrollmentRelations = relations(enrollment, ({ one }) => ({
  student: one(student, { fields: [enrollment.studentId], references: [student.id] }),
  section: one(section, { fields: [enrollment.sectionId], references: [section.id] }),
  year: one(academicYear, { fields: [enrollment.yearId], references: [academicYear.id] }),
}));

export const studentRelations = relations(student, ({ many }) => ({
  enrollments: many(enrollment),
  guardians: many(studentGuardian),
}));

export const studentGuardianRelations = relations(studentGuardian, ({ one }) => ({
  student: one(student, { fields: [studentGuardian.studentId], references: [student.id] }),
  guardian: one(guardian, { fields: [studentGuardian.guardianId], references: [guardian.id] }),
}));

export const guardianRelations = relations(guardian, ({ many }) => ({
  students: many(studentGuardian),
}));

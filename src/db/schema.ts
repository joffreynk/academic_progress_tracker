import { sqliteTable, text, integer, real, uniqueIndex, index } from 'drizzle-orm/sqlite-core';

const id = () => text('id').primaryKey().$defaultFn(() => crypto.randomUUID());
const stamp = () => integer('created_at', { mode: 'timestamp' }).notNull().$defaultFn(() => new Date());
const updated = () => integer('updated_at', { mode: 'timestamp' }).notNull().$defaultFn(() => new Date());

// §15 organizations – timezone default Africa/Bujumbura; domain & logoUrl optional per spec
export const organizations = sqliteTable('organizations', {
  id: id(),
  name: text('name').notNull(),
  code: text('code').notNull().unique(),
  domain: text('domain'),
  logoUrl: text('logo_url'),
  timezone: text('timezone').notNull().default('Africa/Bujumbura'),
  active: integer('active', { mode: 'boolean' }).notNull().default(true),
  primaryAdminUserId: text('primary_admin_user_id'),
  createdAt: stamp(),
  updatedAt: updated(),
});

// §15 users – role: SUPER_ADMIN | ADMIN | TEACHER
export const users = sqliteTable('users', {
  id: id(),
  organizationId: text('organization_id').references(() => organizations.id),
  username: text('username').notNull().unique(),
  email: text('email').notNull().unique(),
  name: text('name').notNull(),
  passwordHash: text('password_hash').notNull(),
  role: text('role').notNull(),
  active: integer('active', { mode: 'boolean' }).notNull().default(true),
  createdAt: stamp(),
  updatedAt: updated(),
  lastLoginAt: integer('last_login_at', { mode: 'timestamp' }),
}, t => [
  index('users_org_idx').on(t.organizationId),
]);

// §10 session security
export const sessions = sqliteTable('sessions', {
  id: id(),
  userId: text('user_id').notNull().references(() => users.id),
  tokenHash: text('token_hash').notNull().unique(),
  expiresAt: integer('expires_at', { mode: 'timestamp' }).notNull(),
  createdAt: stamp(),
}, t => [
  index('sessions_user_idx').on(t.userId),
]);

// §11 brute-force protection
export const loginAttempts = sqliteTable('login_attempts', {
  id: id(),
  key: text('key').notNull().unique(),
  count: integer('count').notNull().default(0),
  blockedUntil: integer('blocked_until', { mode: 'timestamp' }),
  updatedAt: updated(),
});

// §15 grades – Grade 1 through 13
export const grades = sqliteTable('grades', {
  id: id(),
  organizationId: text('organization_id').notNull().references(() => organizations.id),
  name: text('name').notNull(),
  orderIndex: integer('order_index').notNull().default(0),
  active: integer('active', { mode: 'boolean' }).notNull().default(true),
}, t => [
  uniqueIndex('grades_org_name').on(t.organizationId, t.name),
]);

// §15 academic_years
export const academicYears = sqliteTable('academic_years', {
  id: id(),
  organizationId: text('organization_id').notNull().references(() => organizations.id),
  name: text('name').notNull(),
  startDate: text('start_date').notNull(),
  endDate: text('end_date').notNull(),
  active: integer('active', { mode: 'boolean' }).notNull().default(true),
}, t => [
  uniqueIndex('years_org_name').on(t.organizationId, t.name),
]);

// §15 terms
export const terms = sqliteTable('terms', {
  id: id(),
  organizationId: text('organization_id').notNull().references(() => organizations.id),
  academicYearId: text('academic_year_id').notNull().references(() => academicYears.id),
  name: text('name').notNull(),
  startDate: text('start_date').notNull(),
  endDate: text('end_date').notNull(),
  active: integer('active', { mode: 'boolean' }).notNull().default(true),
}, t => [
  index('terms_year_idx').on(t.organizationId, t.academicYearId),
]);

// §15 classes – unique within org/year
export const classes = sqliteTable('classes', {
  id: id(),
  organizationId: text('organization_id').notNull().references(() => organizations.id),
  gradeId: text('grade_id').notNull().references(() => grades.id),
  academicYearId: text('academic_year_id').notNull().references(() => academicYears.id),
  name: text('name').notNull(),
  active: integer('active', { mode: 'boolean' }).notNull().default(true),
  createdAt: stamp(),
  updatedAt: updated(),
}, t => [
  uniqueIndex('classes_org_year_name').on(t.organizationId, t.academicYearId, t.name),
  index('classes_grade_idx').on(t.organizationId, t.gradeId),
]);

// §15 subjects – not hard-coded; admin-managed
export const subjects = sqliteTable('subjects', {
  id: id(),
  organizationId: text('organization_id').notNull().references(() => organizations.id),
  code: text('code').notNull(),
  name: text('name').notNull(),
  active: integer('active', { mode: 'boolean' }).notNull().default(true),
  createdAt: stamp(),
  updatedAt: updated(),
}, t => [
  uniqueIndex('subjects_org_code').on(t.organizationId, t.code),
]);

// §15 teachers
export const teachers = sqliteTable('teachers', {
  id: id(),
  organizationId: text('organization_id').notNull().references(() => organizations.id),
  userId: text('user_id').notNull().unique().references(() => users.id),
  teacherId: text('teacher_id').notNull(),
  name: text('name').notNull(),
  email: text('email').notNull(),
  department: text('department'),
  active: integer('active', { mode: 'boolean' }).notNull().default(true),
  createdAt: stamp(),
  updatedAt: updated(),
}, t => [
  uniqueIndex('teachers_org_code').on(t.organizationId, t.teacherId),
]);

// §15 students – unique by org+studentId; §118 status: ACTIVE|INACTIVE
export const students = sqliteTable('students', {
  id: id(),
  organizationId: text('organization_id').notNull().references(() => organizations.id),
  studentId: text('student_id').notNull(),
  firstName: text('first_name').notNull(),
  lastName: text('last_name').notNull(),
  fullName: text('full_name').notNull(),
  gradeId: text('grade_id').notNull().references(() => grades.id),
  classId: text('class_id').notNull().references(() => classes.id),
  academicYearId: text('academic_year_id').notNull().references(() => academicYears.id),
  status: text('status').notNull().default('ACTIVE'),
  createdAt: stamp(),
  updatedAt: updated(),
}, t => [
  uniqueIndex('students_org_code').on(t.organizationId, t.studentId),
  index('students_roster_idx').on(t.organizationId, t.classId, t.academicYearId),
]);

// §16 teacher_assignments – authoritative permission table; org+teacher+class+subject+year
export const assignments = sqliteTable('teacher_assignments', {
  id: id(),
  organizationId: text('organization_id').notNull().references(() => organizations.id),
  teacherId: text('teacher_id').notNull().references(() => teachers.id),
  classId: text('class_id').notNull().references(() => classes.id),
  subjectId: text('subject_id').notNull().references(() => subjects.id),
  academicYearId: text('academic_year_id').notNull().references(() => academicYears.id),
  active: integer('active', { mode: 'boolean' }).notNull().default(true),
  createdAt: stamp(),
  updatedAt: updated(),
}, t => [
  uniqueIndex('assignment_unique').on(t.organizationId, t.teacherId, t.classId, t.subjectId, t.academicYearId),
  index('assignment_teacher_idx').on(t.organizationId, t.teacherId),
]);

// §18 daily_lessons – one row per class/subject/date; §86 indexes; §63 name snapshots for historical accuracy
export const lessons = sqliteTable('daily_lessons', {
  id: id(),
  organizationId: text('organization_id').notNull().references(() => organizations.id),
  teacherId: text('teacher_id').notNull().references(() => teachers.id),
  classId: text('class_id').notNull().references(() => classes.id),
  subjectId: text('subject_id').notNull().references(() => subjects.id),
  academicYearId: text('academic_year_id').notNull().references(() => academicYears.id),
  termId: text('term_id').references(() => terms.id),
  classNameSnapshot: text('class_name_snapshot'),
  subjectNameSnapshot: text('subject_name_snapshot'),
  teacherNameSnapshot: text('teacher_name_snapshot'),
  academicYearNameSnapshot: text('academic_year_name_snapshot'),
  lessonDate: text('lesson_date').notNull(),
  topic: text('topic').notNull().default(''),
  status: text('status').notNull().default('DRAFT'),
  createdAt: stamp(),
  updatedAt: updated(),
  submittedAt: integer('submitted_at', { mode: 'timestamp' }),
  reviewedAt: integer('reviewed_at', { mode: 'timestamp' }),
  reviewedBy: text('reviewed_by'),
  reviewComment: text('review_comment'),
}, t => [
  uniqueIndex('lesson_unique').on(t.organizationId, t.teacherId, t.classId, t.subjectId, t.lessonDate),
  index('lessons_teacher_date_idx').on(t.organizationId, t.teacherId, t.lessonDate),
  index('lessons_class_date_idx').on(t.organizationId, t.classId, t.lessonDate),
  index('lessons_subject_date_idx').on(t.organizationId, t.subjectId, t.lessonDate),
  index('lessons_status_idx').on(t.organizationId, t.status),
]);

// §19 daily_student_records – §28 PRESENT|LATE|ABSENT; §29 academic fields null when ABSENT; §63 snapshots
export const records = sqliteTable('daily_student_records', {
  id: id(),
  organizationId: text('organization_id').notNull().references(() => organizations.id),
  dailyLessonId: text('daily_lesson_id').notNull().references(() => lessons.id, { onDelete: 'cascade' }),
  studentId: text('student_id').notNull().references(() => students.id),
  studentNameSnapshot: text('student_name_snapshot'),
  studentCodeSnapshot: text('student_code_snapshot'),
  attendanceStatus: text('attendance_status').notNull(),
  performance: text('performance'),
  participation: text('participation'),
  homework: text('homework'),
  conduct: text('conduct'),
  comment: text('comment'),
  createdAt: stamp(),
  updatedAt: updated(),
}, t => [
  uniqueIndex('record_lesson_student').on(t.dailyLessonId, t.studentId),
  index('records_student_idx').on(t.organizationId, t.studentId),
]);

// §77 audit_logs
export const auditLogs = sqliteTable('audit_logs', {
  id: id(),
  organizationId: text('organization_id').references(() => organizations.id),
  userId: text('user_id'),
  action: text('action').notNull(),
  entityType: text('entity_type').notNull(),
  entityId: text('entity_id'),
  metadata: text('metadata', { mode: 'json' }).$type<Record<string, unknown>>(),
  createdAt: stamp(),
}, t => [
  index('audit_org_date_idx').on(t.organizationId, t.createdAt),
]);

// §64 settings – configurable thresholds; §44 performance; §47 homework; §48 punctuality
export const settings = sqliteTable('settings', {
  id: id(),
  organizationId: text('organization_id').notNull().unique().references(() => organizations.id),
  version: integer('version').notNull().default(1),
  excellentThreshold: real('excellent_threshold').notNull().default(2.65),
  goodThreshold: real('good_threshold').notNull().default(1.65),
  homeworkUsuallyThreshold: real('homework_usually_threshold').notNull().default(0.8),
  punctualityOccasionallyMax: real('punctuality_occasionally_max').notNull().default(0.1),
  updatedAt: updated(),
});

// §79 month_closures
export const monthClosures = sqliteTable('month_closures', {
  id: id(),
  organizationId: text('organization_id').notNull().references(() => organizations.id),
  month: text('month').notNull(),
  closed: integer('closed', { mode: 'boolean' }).notNull().default(true),
  updatedAt: updated(),
}, t => [
  uniqueIndex('closure_org_month').on(t.organizationId, t.month),
]);

// §80 monthly_rule_snapshots – historical calculation versioning
export const monthlyRuleSnapshots = sqliteTable('monthly_rule_snapshots', {
  id: id(),
  organizationId: text('organization_id').notNull().references(() => organizations.id),
  month: text('month').notNull(),
  version: integer('version').notNull(),
  excellentThreshold: real('excellent_threshold').notNull(),
  goodThreshold: real('good_threshold').notNull(),
  homeworkUsuallyThreshold: real('homework_usually_threshold').notNull(),
  punctualityOccasionallyMax: real('punctuality_occasionally_max').notNull(),
  createdAt: stamp(),
}, t => [
  uniqueIndex('rule_snapshot_month_idx').on(t.organizationId, t.month),
]);

// §76 behaviour_observations – optional; categories per spec
export const behaviourObservations = sqliteTable('behaviour_observations', {
  id: id(),
  organizationId: text('organization_id').notNull().references(() => organizations.id),
  studentId: text('student_id').notNull().references(() => students.id),
  teacherId: text('teacher_id').notNull().references(() => teachers.id),
  classId: text('class_id').notNull().references(() => classes.id),
  date: text('date').notNull(),
  category: text('category').notNull(),
  severity: text('severity').notNull(),
  description: text('description').notNull(),
  actionTaken: text('action_taken'),
  followUpRequired: integer('follow_up_required', { mode: 'boolean' }).notNull().default(false),
  createdAt: stamp(),
  updatedAt: updated(),
});

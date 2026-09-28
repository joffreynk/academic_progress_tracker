-- Cloudflare D1 Migration for Student Academic Reporting Platform
-- Corresponds to §12, §15, §16, §18, §19, §76, §77, §79, §80, §181, §182

CREATE TABLE IF NOT EXISTS organizations (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  code TEXT NOT NULL UNIQUE,
  domain TEXT,
  logo_url TEXT,
  timezone TEXT NOT NULL DEFAULT 'Africa/Bujumbura',
  active INTEGER NOT NULL DEFAULT 1,
  primary_admin_user_id TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS users (
  id TEXT PRIMARY KEY,
  organization_id TEXT REFERENCES organizations(id),
  username TEXT NOT NULL UNIQUE,
  email TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  password_hash TEXT NOT NULL,
  role TEXT NOT NULL,
  active INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  last_login_at TEXT
);
CREATE INDEX IF NOT EXISTS users_org_idx ON users(organization_id);

CREATE TABLE IF NOT EXISTS sessions (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id),
  token_hash TEXT NOT NULL UNIQUE,
  expires_at TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS sessions_user_idx ON sessions(user_id);

CREATE TABLE IF NOT EXISTS login_attempts (
  id TEXT PRIMARY KEY,
  key TEXT NOT NULL UNIQUE,
  count INTEGER NOT NULL DEFAULT 0,
  blocked_until TEXT,
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS grades (
  id TEXT PRIMARY KEY,
  organization_id TEXT NOT NULL REFERENCES organizations(id),
  name TEXT NOT NULL,
  order_index INTEGER NOT NULL DEFAULT 0,
  active INTEGER NOT NULL DEFAULT 1
);
CREATE UNIQUE INDEX IF NOT EXISTS grades_org_name ON grades(organization_id, name);

CREATE TABLE IF NOT EXISTS academic_years (
  id TEXT PRIMARY KEY,
  organization_id TEXT NOT NULL REFERENCES organizations(id),
  name TEXT NOT NULL,
  start_date TEXT NOT NULL,
  end_date TEXT NOT NULL,
  active INTEGER NOT NULL DEFAULT 1
);
CREATE UNIQUE INDEX IF NOT EXISTS years_org_name ON academic_years(organization_id, name);

CREATE TABLE IF NOT EXISTS terms (
  id TEXT PRIMARY KEY,
  organization_id TEXT NOT NULL REFERENCES organizations(id),
  academic_year_id TEXT NOT NULL REFERENCES academic_years(id),
  name TEXT NOT NULL,
  start_date TEXT NOT NULL,
  end_date TEXT NOT NULL,
  active INTEGER NOT NULL DEFAULT 1
);
CREATE INDEX IF NOT EXISTS terms_year_idx ON terms(organization_id, academic_year_id);

CREATE TABLE IF NOT EXISTS classes (
  id TEXT PRIMARY KEY,
  organization_id TEXT NOT NULL REFERENCES organizations(id),
  grade_id TEXT NOT NULL REFERENCES grades(id),
  academic_year_id TEXT NOT NULL REFERENCES academic_years(id),
  name TEXT NOT NULL,
  active INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE UNIQUE INDEX IF NOT EXISTS classes_org_year_name ON classes(organization_id, academic_year_id, name);
CREATE INDEX IF NOT EXISTS classes_grade_idx ON classes(organization_id, grade_id);

CREATE TABLE IF NOT EXISTS subjects (
  id TEXT PRIMARY KEY,
  organization_id TEXT NOT NULL REFERENCES organizations(id),
  code TEXT NOT NULL,
  name TEXT NOT NULL,
  active INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE UNIQUE INDEX IF NOT EXISTS subjects_org_code ON subjects(organization_id, code);

CREATE TABLE IF NOT EXISTS teachers (
  id TEXT PRIMARY KEY,
  organization_id TEXT NOT NULL REFERENCES organizations(id),
  user_id TEXT NOT NULL UNIQUE REFERENCES users(id),
  teacher_id TEXT NOT NULL,
  name TEXT NOT NULL,
  email TEXT NOT NULL,
  department TEXT,
  active INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE UNIQUE INDEX IF NOT EXISTS teachers_org_code ON teachers(organization_id, teacher_id);

CREATE TABLE IF NOT EXISTS students (
  id TEXT PRIMARY KEY,
  organization_id TEXT NOT NULL REFERENCES organizations(id),
  student_id TEXT NOT NULL,
  first_name TEXT NOT NULL,
  last_name TEXT NOT NULL,
  fullName TEXT NOT NULL,
  grade_id TEXT NOT NULL REFERENCES grades(id),
  class_id TEXT NOT NULL REFERENCES classes(id),
  academic_year_id TEXT NOT NULL REFERENCES academic_years(id),
  status TEXT NOT NULL DEFAULT 'ACTIVE',
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE UNIQUE INDEX IF NOT EXISTS students_org_code ON students(organization_id, student_id);
CREATE INDEX IF NOT EXISTS students_roster_idx ON students(organization_id, class_id, academic_year_id);

CREATE TABLE IF NOT EXISTS teacher_assignments (
  id TEXT PRIMARY KEY,
  organization_id TEXT NOT NULL REFERENCES organizations(id),
  teacher_id TEXT NOT NULL REFERENCES teachers(id),
  class_id TEXT NOT NULL REFERENCES classes(id),
  subject_id TEXT NOT NULL REFERENCES subjects(id),
  academic_year_id TEXT NOT NULL REFERENCES academic_years(id),
  active INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE UNIQUE INDEX IF NOT EXISTS assignment_unique ON teacher_assignments(organization_id, teacher_id, class_id, subject_id, academic_year_id);
CREATE INDEX IF NOT EXISTS assignment_teacher_idx ON teacher_assignments(organization_id, teacher_id);

CREATE TABLE IF NOT EXISTS daily_lessons (
  id TEXT PRIMARY KEY,
  organization_id TEXT NOT NULL REFERENCES organizations(id),
  teacher_id TEXT NOT NULL REFERENCES teachers(id),
  class_id TEXT NOT NULL REFERENCES classes(id),
  subject_id TEXT NOT NULL REFERENCES subjects(id),
  academic_year_id TEXT NOT NULL REFERENCES academic_years(id),
  term_id TEXT REFERENCES terms(id),
  class_name_snapshot TEXT,
  subject_name_snapshot TEXT,
  teacher_name_snapshot TEXT,
  academic_year_name_snapshot TEXT,
  lesson_date TEXT NOT NULL,
  topic TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT 'DRAFT',
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  submitted_at TEXT,
  reviewed_at TEXT,
  reviewed_by TEXT,
  review_comment TEXT
);
CREATE UNIQUE INDEX IF NOT EXISTS lesson_unique ON daily_lessons(organization_id, teacher_id, class_id, subject_id, lesson_date);
CREATE INDEX IF NOT EXISTS lessons_teacher_date_idx ON daily_lessons(organization_id, teacher_id, lesson_date);
CREATE INDEX IF NOT EXISTS lessons_class_date_idx ON daily_lessons(organization_id, class_id, lesson_date);
CREATE INDEX IF NOT EXISTS lessons_subject_date_idx ON daily_lessons(organization_id, subject_id, lesson_date);
CREATE INDEX IF NOT EXISTS lessons_status_idx ON daily_lessons(organization_id, status);

CREATE TABLE IF NOT EXISTS daily_student_records (
  id TEXT PRIMARY KEY,
  organization_id TEXT NOT NULL REFERENCES organizations(id),
  daily_lesson_id TEXT NOT NULL REFERENCES daily_lessons(id) ON DELETE CASCADE,
  student_id TEXT NOT NULL REFERENCES students(id),
  student_name_snapshot TEXT,
  student_code_snapshot TEXT,
  attendance_status TEXT NOT NULL,
  performance TEXT,
  participation TEXT,
  homework TEXT,
  conduct TEXT,
  comment TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE UNIQUE INDEX IF NOT EXISTS record_lesson_student ON daily_student_records(daily_lesson_id, student_id);
CREATE INDEX IF NOT EXISTS records_student_idx ON daily_student_records(organization_id, student_id);

CREATE TABLE IF NOT EXISTS audit_logs (
  id TEXT PRIMARY KEY,
  organization_id TEXT REFERENCES organizations(id),
  user_id TEXT,
  action TEXT NOT NULL,
  entity_type TEXT NOT NULL,
  entity_id TEXT,
  metadata TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS audit_org_date_idx ON audit_logs(organization_id, created_at);

CREATE TABLE IF NOT EXISTS settings (
  id TEXT PRIMARY KEY,
  organization_id TEXT NOT NULL UNIQUE REFERENCES organizations(id),
  version INTEGER NOT NULL DEFAULT 1,
  excellent_threshold REAL NOT NULL DEFAULT 2.65,
  good_threshold REAL NOT NULL DEFAULT 1.65,
  homework_usually_threshold REAL NOT NULL DEFAULT 0.8,
  punctuality_occasionally_max REAL NOT NULL DEFAULT 0.1,
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS month_closures (
  id TEXT PRIMARY KEY,
  organization_id TEXT NOT NULL REFERENCES organizations(id),
  month TEXT NOT NULL,
  closed INTEGER NOT NULL DEFAULT 1,
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE UNIQUE INDEX IF NOT EXISTS closure_org_month ON month_closures(organization_id, month);

CREATE TABLE IF NOT EXISTS monthly_rule_snapshots (
  id TEXT PRIMARY KEY,
  organization_id TEXT NOT NULL REFERENCES organizations(id),
  month TEXT NOT NULL,
  version INTEGER NOT NULL,
  excellent_threshold REAL NOT NULL,
  good_threshold REAL NOT NULL,
  homework_usually_threshold REAL NOT NULL,
  punctuality_occasionally_max REAL NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE UNIQUE INDEX IF NOT EXISTS rule_snapshot_month_idx ON monthly_rule_snapshots(organization_id, month);

CREATE TABLE IF NOT EXISTS behaviour_observations (
  id TEXT PRIMARY KEY,
  organization_id TEXT NOT NULL REFERENCES organizations(id),
  student_id TEXT NOT NULL REFERENCES students(id),
  teacher_id TEXT NOT NULL REFERENCES teachers(id),
  class_id TEXT NOT NULL REFERENCES classes(id),
  date TEXT NOT NULL,
  category TEXT NOT NULL,
  severity TEXT NOT NULL,
  description TEXT NOT NULL,
  action_taken TEXT,
  follow_up_required INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

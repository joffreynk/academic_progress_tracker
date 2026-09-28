import 'dotenv/config';
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { hash } from 'bcryptjs';
import { eq, sql } from 'drizzle-orm';
import { db } from '../src/db';
import {
  academicYears,
  assignments,
  auditLogs,
  behaviourObservations,
  classes,
  grades,
  lessons,
  loginAttempts,
  monthClosures,
  monthlyRuleSnapshots,
  organizations,
  records,
  sessions,
  settings,
  students,
  subjects,
  teachers,
  terms,
  users,
} from '../src/db/schema';

const credentials = {
  superAdmin: { email: 'super@local.school', username: 'superadmin', password: 'LocalSuper!2026' },
  admin: { email: 'admin@local.school', username: 'schooladmin', password: 'LocalAdmin!2026' },
  teacher: { email: 'teacher@local.school', username: 'classteacher', password: 'LocalTeacher!2026' },
};

async function clearDatabase() {
  await db.run(sql`PRAGMA foreign_keys = OFF;`);
  const tables = [
    behaviourObservations,
    monthlyRuleSnapshots,
    monthClosures,
    records,
    lessons,
    assignments,
    students,
    classes,
    terms,
    academicYears,
    subjects,
    grades,
    teachers,
    settings,
    auditLogs,
    sessions,
    loginAttempts,
    users,
    organizations,
  ];

  for (const table of tables) {
    await db.delete(table as any);
  }
  await db.run(sql`PRAGMA foreign_keys = ON;`);
}

async function main() {
  await clearDatabase();

  const [org] = await db.insert(organizations).values({
    name: 'Local Academy',
    code: 'LOCAL',
    timezone: 'Africa/Bujumbura',
    active: true,
  }).returning();

  await db.insert(settings).values({
    organizationId: org.id,
    version: 1,
    excellentThreshold: 2.65,
    goodThreshold: 1.65,
    homeworkUsuallyThreshold: 0.8,
    punctualityOccasionallyMax: 0.1,
  });

  const [superUser] = await db.insert(users).values({
    name: 'System Super Admin',
    username: credentials.superAdmin.username,
    email: credentials.superAdmin.email,
    passwordHash: await hash(credentials.superAdmin.password, 12),
    role: 'SUPER_ADMIN',
    active: true,
  }).returning();

  const [adminUser] = await db.insert(users).values({
    organizationId: org.id,
    name: 'School Admin',
    username: credentials.admin.username,
    email: credentials.admin.email,
    passwordHash: await hash(credentials.admin.password, 12),
    role: 'ADMIN',
    active: true,
  }).returning();

  await db.update(organizations).set({
    primaryAdminUserId: adminUser.id,
    updatedAt: new Date(),
  }).where(eq(organizations.id, org.id));

  const [teacherUser] = await db.insert(users).values({
    organizationId: org.id,
    name: 'Class Teacher',
    username: credentials.teacher.username,
    email: credentials.teacher.email,
    passwordHash: await hash(credentials.teacher.password, 12),
    role: 'TEACHER',
    active: true,
  }).returning();

  const [year] = await db.insert(academicYears).values({
    organizationId: org.id,
    name: '2026-2027',
    startDate: '2026-08-01',
    endDate: '2027-07-31',
    active: true,
  }).returning();

  const [term] = await db.insert(terms).values({
    organizationId: org.id,
    academicYearId: year.id,
    name: 'Term 1',
    startDate: '2026-08-01',
    endDate: '2026-12-20',
    active: true,
  }).returning();

  const [grade7] = await db.insert(grades).values({
    organizationId: org.id,
    name: 'Grade 7',
    orderIndex: 7,
    active: true,
  }).returning();

  const [class7A] = await db.insert(classes).values({
    organizationId: org.id,
    gradeId: grade7.id,
    academicYearId: year.id,
    name: '7A',
    active: true,
  }).returning();

  const [subjectMath] = await db.insert(subjects).values({
    organizationId: org.id,
    code: 'MATH',
    name: 'Mathematics',
    active: true,
  }).returning();

  const [teacher] = await db.insert(teachers).values({
    organizationId: org.id,
    userId: teacherUser.id,
    teacherId: 'T-LOCAL-001',
    name: 'Class Teacher',
    email: credentials.teacher.email,
    department: 'Mathematics',
    active: true,
  }).returning();

  await db.insert(assignments).values({
    organizationId: org.id,
    teacherId: teacher.id,
    classId: class7A.id,
    subjectId: subjectMath.id,
    academicYearId: year.id,
    active: true,
  });

  const studentRows = [
    ['STU-001', 'Alice', 'Niyonkuru'],
    ['STU-002', 'David', 'Habimana'],
    ['STU-003', 'Grace', 'Mugisha'],
    ['STU-004', 'Eric', 'Ndayisenga'],
    ['STU-005', 'Lina', 'Mutoni'],
  ];

  await db.insert(students).values(studentRows.map(([studentId, firstName, lastName]) => ({
    organizationId: org.id,
    studentId,
    firstName,
    lastName,
    fullName: `${firstName} ${lastName}`,
    gradeId: grade7.id,
    classId: class7A.id,
    academicYearId: year.id,
    status: 'ACTIVE',
  })));

  const filePath = join(process.cwd(), 'logins.text');
  const content = [
    'Local application credentials',
    'Do not commit this file.',
    '',
    'Super Admin',
    `Email: ${credentials.superAdmin.email}`,
    `Username: ${credentials.superAdmin.username}`,
    `Password: ${credentials.superAdmin.password}`,
    '',
    'Admin',
    `Email: ${credentials.admin.email}`,
    `Username: ${credentials.admin.username}`,
    `Password: ${credentials.admin.password}`,
    '',
    'Teacher',
    `Email: ${credentials.teacher.email}`,
    `Username: ${credentials.teacher.username}`,
    `Password: ${credentials.teacher.password}`,
    '',
    'Change the passwords after first login.',
  ].join('\n');

  writeFileSync(filePath, content, 'utf8');

  console.log(JSON.stringify({
    organizationId: org.id,
    superAdmin: credentials.superAdmin,
    admin: credentials.admin,
    teacher: credentials.teacher,
    loginFile: filePath,
    note: 'This database has been reset and the credentials were saved locally to logins.text',
  }, null, 2));
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});

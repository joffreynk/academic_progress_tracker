/**
 * Seeds one completed month of demo monthly records (§193) for every assigned
 * class + subject, so the monthly entry, history, review and report screens have data.
 * Usage: npx tsx scripts/seed-monthly-demo.ts [YYYY-MM]   (defaults to last complete month)
 * Idempotent: existing monthly entries for the month are skipped.
 */
import { db, runTransaction } from '../src/db';
import {
  organizations, assignments, classes, subjects, students, academicYears,
  monthlyEntries, monthlyStudentEntries,
} from '../src/db/schema';
import { and, eq, gte, lte } from 'drizzle-orm';

function lastCompleteMonth(today = new Date()): string {
  const d = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth() - 1, 1));
  return d.toISOString().slice(0, 7);
}

function monthEnd(month: string): string {
  const d = new Date(`${month}-01T12:00:00Z`);
  d.setUTCMonth(d.getUTCMonth() + 1);
  d.setUTCDate(0);
  return d.toISOString().slice(0, 10);
}

const hash = (value: string) => {
  let h = 2166136261;
  for (let i = 0; i < value.length; i += 1) { h ^= value.charCodeAt(i); h = Math.imul(h, 16777619); }
  return Math.abs(h);
};

const PERFORMANCE = ['EXCELLENT', 'EXCELLENT', 'GOOD', 'GOOD', 'GOOD', 'NEEDS_IMPROVEMENT'];
const PARTICIPATION = ['ACTIVE', 'ACTIVE', 'ACTIVE', 'MODERATE', 'MODERATE', 'PASSIVE'];
const HOMEWORK = ['ALWAYS_COMPLETED', 'ALWAYS_COMPLETED', 'USUALLY_COMPLETED', 'USUALLY_COMPLETED', 'USUALLY_COMPLETED', 'RARELY_COMPLETED'];

async function main() {
  const month = process.argv[2] || lastCompleteMonth();
  if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(month)) throw new Error(`Invalid month "${month}". Use YYYY-MM.`);
  if (month >= new Date().toISOString().slice(0, 7)) throw new Error(`Month ${month} is not in the past.`);

  const [org] = await db.select().from(organizations).limit(1);
  if (!org) throw new Error('No organization found. Run npm run db:seed first.');
  const years = await db.select().from(academicYears).where(eq(academicYears.organizationId, org.id));
  const year = years.find((y) => `${month}-01` <= y.endDate && monthEnd(month) >= y.startDate);
  if (!year) throw new Error(`No academic year covers ${month}.`);

  const combos = await db
    .select({
      classId: assignments.classId, subjectId: assignments.subjectId, teacherId: assignments.teacherId,
      className: classes.name, subjectName: subjects.name,
    })
    .from(assignments)
    .innerJoin(classes, eq(classes.id, assignments.classId))
    .innerJoin(subjects, eq(subjects.id, assignments.subjectId))
    .where(and(eq(assignments.organizationId, org.id), eq(assignments.active, true), eq(classes.active, true), eq(subjects.active, true)))
    .limit(400);

  const roster = await db
    .select({ id: students.id, name: students.fullName, code: students.studentId, classId: students.classId })
    .from(students)
    .where(and(eq(students.organizationId, org.id), eq(students.status, 'ACTIVE')))
    .limit(2000);

  const classesById = new Map(combos.map((c) => [c.classId, c.className]));
  let created = 0;
  let skipped = 0;

  for (const combo of combos) {
    const [existing] = await db
      .select({ id: monthlyEntries.id })
      .from(monthlyEntries)
      .where(and(
        eq(monthlyEntries.organizationId, org.id),
        eq(monthlyEntries.classId, combo.classId),
        eq(monthlyEntries.subjectId, combo.subjectId),
        eq(monthlyEntries.month, month),
      ))
      .limit(1);
    if (existing) { skipped += 1; continue; }

    const sessions = 16 + (hash(combo.classId + combo.subjectId) % 10);
    const rosterRows = roster.filter((s) => s.classId === combo.classId);
    const now = new Date();
    const topics = `${combo.subjectName} — monthly coursework, continuous assessment and end-of-month review`.slice(0, 500);

    const studentRows = rosterRows.map((student) => {
      const h = hash(student.id + combo.subjectId + month);
      const roll = h % 100;
      // §193 v2: one punctuality/attendance category per student per month.
      let punctuality: string = 'ALWAYS_ON_TIME';
      if (roll >= 55 && roll < 72) punctuality = 'OCCASIONALLY_LATE';
      else if (roll >= 72 && roll < 82) punctuality = 'FREQUENTLY_LATE';
      else if (roll >= 82 && roll < 94) punctuality = 'OCCASIONALLY_ABSENT';
      else if (roll >= 94) punctuality = 'FREQUENTLY_ABSENT';

      const performance = PERFORMANCE[(h >> 3) % PERFORMANCE.length];
      const participation = PARTICIPATION[(h >> 5) % PARTICIPATION.length];
      const homework = HOMEWORK[(h >> 7) % HOMEWORK.length];
      const conduct = performance === 'NEEDS_IMPROVEMENT' ? 'NEEDS_IMPROVEMENT' : (h % 7 === 0 ? 'GOOD' : 'EXCELLENT');
      const needsComment = performance === 'NEEDS_IMPROVEMENT' || conduct === 'NEEDS_IMPROVEMENT';
      const comment = needsComment
        ? `Needs extra support with ${combo.subjectName.toLowerCase()}; follow up next month.`
        : (h % 5 === 0 ? `Consistent effort in ${combo.subjectName.toLowerCase()} this month.` : null);

      return {
        organizationId: org.id, studentId: student.id,
        studentNameSnapshot: student.name, studentCodeSnapshot: student.code,
        punctuality, performance, participation, homework, conduct, comment,
      };
    });

    if (!rosterRows.length) continue;

    await runTransaction(async (tx: any) => {
      const [entry] = await tx
        .insert(monthlyEntries)
        .values({
          organizationId: org.id, classId: combo.classId, subjectId: combo.subjectId,
          academicYearId: year.id, teacherId: combo.teacherId, month,
          sessionsHeld: sessions, topics, status: 'APPROVED',
          classNameSnapshot: combo.className, subjectNameSnapshot: combo.subjectName,
          submittedAt: now, reviewedAt: now,
        })
        .returning();
      await tx.insert(monthlyStudentEntries).values(studentRows.map((r) => ({ ...r, monthlyEntryId: entry.id })));
    });
    created += 1;
  }

  console.log(`Seeded ${month}: ${created} monthly records across ${classesById.size} classes, skipped ${skipped} already present.`);
}

main().catch((e) => { console.error(e); process.exit(1); });

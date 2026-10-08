/**
 * Converts one class's legacy lesson records for a month into monthly records (§193).
 * Usage: npx tsx scripts/convert-legacy-lessons-to-monthly.ts [YYYY-MM]
 * Defaults to the last complete month. Idempotent: existing monthly entries are skipped.
 */
import { db, runTransaction } from '../src/db';
import {
  organizations, lessons, records, students, classes, subjects, teachers,
  academicYears, monthlyEntries, monthlyStudentEntries,
} from '../src/db/schema';
import { and, eq, gte, lte, inArray } from 'drizzle-orm';

type Row = {
  lessonId: string; classId: string; subjectId: string; teacherId: string; academicYearId: string | null;
  topic: string; studentId: string; studentName: string; studentCode: string;
  attendance: string; performance: string | null; participation: string | null;
  homework: string | null; conduct: string | null; comment: string | null;
};

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

const mode = (values: (string | null)[]): string | null => {
  const counts = new Map<string, number>();
  for (const v of values) if (v) counts.set(v, (counts.get(v) || 0) + 1);
  let best: string | null = null;
  let bestN = 0;
  for (const [k, n] of counts) if (n > bestN) { best = k; bestN = n; }
  return best;
};

function toPunctuality(list: { attendance: string }[]): string {
  const total = list.length || 1;
  const absent = list.filter((r) => r.attendance === 'ABSENT').length;
  const late = list.filter((r) => r.attendance === 'LATE').length;
  const absentRate = absent / total;
  const lateRate = late / total;
  if (absentRate >= 0.5) return 'FREQUENTLY_ABSENT';
  if (absentRate >= 0.12) return 'OCCASIONALLY_ABSENT';
  if (lateRate >= 0.3) return 'FREQUENTLY_LATE';
  if (lateRate > 0) return 'OCCASIONALLY_LATE';
  if (absent > 0) return 'OCCASIONALLY_ABSENT';
  return 'ALWAYS_ON_TIME';
}

async function main() {
  const month = process.argv[2] || lastCompleteMonth();
  if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(month)) throw new Error(`Invalid month "${month}". Use YYYY-MM.`);
  const today = new Date().toISOString().slice(0, 10);
  if (month >= today.slice(0, 7)) throw new Error(`Month ${month} is not in the past; choose a completed month.`);

  const [org] = await db.select().from(organizations).limit(1);
  if (!org) throw new Error('No organization found. Run npm run db:seed first.');

  const rows = await db
    .select({
      lessonId: lessons.id, classId: lessons.classId, subjectId: lessons.subjectId,
      teacherId: lessons.teacherId, academicYearId: lessons.academicYearId, topic: lessons.topic,
      studentId: students.id, studentName: students.fullName, studentCode: students.studentId,
      attendance: records.attendanceStatus, performance: records.performance,
      participation: records.participation, homework: records.homework,
      conduct: records.conduct, comment: records.comment,
    })
    .from(records)
    .innerJoin(lessons, eq(lessons.id, records.monthlyLessonId))
    .innerJoin(students, eq(students.id, records.studentId))
    .where(and(
      eq(lessons.organizationId, org.id),
      inArray(lessons.status, ['SUBMITTED', 'UNDER_REVIEW', 'APPROVED']),
      gte(lessons.lessonDate, `${month}-01`),
      lte(lessons.lessonDate, monthEnd(month)),
    ))
    .limit(50000);

  if (!rows.length) {
    console.log(`No submitted legacy records for ${month}. Nothing to convert.`);
    return;
  }

  // One class per run: the class with the most subject coverage in the month.
  const byClass = new Map<string, Set<string>>();
  for (const r of rows) {
    if (!byClass.has(r.classId)) byClass.set(r.classId, new Set());
    byClass.get(r.classId)!.add(r.subjectId);
  }
  const [classId] = [...byClass.entries()].sort((a, b) => b[1].size - a[1].size)[0];
  const targetSubjects = byClass.get(classId)!;

  const [cls] = await db.select().from(classes).where(eq(classes.id, classId));
  console.log(`Converting ${month} for class ${cls?.name || classId} (${targetSubjects.size} subject${targetSubjects.size === 1 ? '' : 's'})…`);

  let created = 0;
  let skipped = 0;
  for (const subjectId of targetSubjects) {
    const combo = rows.filter((r) => r.classId === classId && r.subjectId === subjectId);
    if (!combo.length) continue;

    const [existing] = await db
      .select({ id: monthlyEntries.id })
      .from(monthlyEntries)
      .where(and(
        eq(monthlyEntries.organizationId, org.id),
        eq(monthlyEntries.classId, classId),
        eq(monthlyEntries.subjectId, subjectId),
        eq(monthlyEntries.month, month),
      ))
      .limit(1);
    if (existing) { skipped += 1; continue; }

    const lessonIds = new Set(combo.map((r) => r.lessonId));
    const sessions = Math.max(1, lessonIds.size);
    const topics = [...new Set(combo.map((r) => r.topic.trim()).filter(Boolean))].join('; ').slice(0, 500);
    const [sub] = await db.select().from(subjects).where(eq(subjects.id, subjectId));
    const [teacher] = await db.select().from(teachers).where(eq(teachers.id, combo[0].teacherId));

    let academicYearId: string | null = combo[0].academicYearId;
    if (!academicYearId) {
      const years = await db.select().from(academicYears).where(eq(academicYears.organizationId, org.id));
      academicYearId = years.find((y) => `${month}-01` <= y.endDate && monthEnd(month) >= y.startDate)?.id ?? null;
    }

    const byStudent = new Map<string, Row[]>();
    for (const r of combo) {
      if (!byStudent.has(r.studentId)) byStudent.set(r.studentId, []);
      byStudent.get(r.studentId)!.push(r);
    }

    const studentRows = [...byStudent.entries()].map(([studentId, list]) => {
      // §193 v2: legacy attendance tallies collapse into one punctuality category.
      const punctuality = toPunctuality(list);
      const performance = mode(list.map((r) => r.performance));
      const participation = mode(list.map((r) => r.participation));
      const homework = mode(list.map((r) => r.homework));
      const conduct = mode(list.map((r) => r.conduct));
      return {
        organizationId: org.id, studentId,
        studentNameSnapshot: list[0].studentName, studentCodeSnapshot: list[0].studentCode,
        punctuality,
        performance, participation, homework, conduct,
        comment: list.map((r) => r.comment?.trim() || '').find(Boolean) || null,
      };
    });

    await runTransaction(async (tx: any) => {
      const [entry] = await tx
        .insert(monthlyEntries)
        .values({
          organizationId: org.id, classId, subjectId, academicYearId, teacherId: combo[0].teacherId,
          month, sessionsHeld: sessions, topics, status: 'APPROVED',
          classNameSnapshot: cls?.name || null, subjectNameSnapshot: sub?.name || null,
          teacherNameSnapshot: teacher?.name || null,
          submittedAt: new Date(), reviewedAt: new Date(),
        })
        .returning();
      if (studentRows.length) {
        await tx.insert(monthlyStudentEntries).values(studentRows.map((r) => ({ ...r, monthlyEntryId: entry.id })));
      }
    });
    created += 1;
    console.log(`  + ${sub?.name || subjectId}: ${sessions} sessions, ${studentRows.length} students`);
  }

  console.log(`Done. Created ${created} monthly record${created === 1 ? '' : 's'}, skipped ${skipped} already present.`);
}

main().catch((e) => { console.error(e); process.exit(1); });

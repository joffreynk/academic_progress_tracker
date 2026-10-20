import { and, eq } from 'drizzle-orm';
import { db } from '@/db';
import { students, subjectStudents } from '@/db/schema';
import { AppError } from './security';

// Resolve the students a monthly record covers for a class + subject.
// An empty subject roster (no rows for the pair) means every active class
// student; once the teacher picks a group, only those students count.
export async function loadSubjectRoster(organizationId: string, classId: string, subjectId: string, academicYearId?: string) {
  const classStudents = await db
    .select({ id: students.id, studentCode: students.studentId, studentName: students.fullName })
    .from(students)
    .where(and(
      eq(students.classId, classId),
      eq(students.organizationId, organizationId),
      eq(students.status, 'ACTIVE'),
      academicYearId ? eq(students.academicYearId, academicYearId) : undefined,
    ))
    .orderBy(students.fullName)
    // One extra row: a silent cap would quietly drop students out of every completion rate.
    .limit(201);
  if (classStudents.length > 200) {
    throw new AppError('Class roster exceeds the 200-student record limit. Ask your administrator to split the class.');
  }
  const enrolled = await db
    .select({ studentId: subjectStudents.studentId })
    .from(subjectStudents)
    .where(and(
      eq(subjectStudents.organizationId, organizationId),
      eq(subjectStudents.classId, classId),
      eq(subjectStudents.subjectId, subjectId),
    ));
  const inClass = new Set(classStudents.map((s) => s.id));
  const enrolledIds = new Set(enrolled.map((r) => r.studentId).filter((id) => inClass.has(id)));
  const isDefault = enrolledIds.size === 0;
  return { roster: isDefault ? classStudents : classStudents.filter((s) => enrolledIds.has(s.id)), isDefault };
}

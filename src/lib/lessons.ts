import { db } from '@/db';
import { assignments, classes, subjects, academicYears, terms, students, lessons, records, monthClosures } from '@/db/schema';
import { and, eq } from 'drizzle-orm';
import { z } from 'zod';
import { AppError, audit, orgFor, schoolToday, validLessonDate, teacherFor, reportWindowDays, reportWindowLabel } from './security';
import type { users } from '@/db/schema';

const studentRecord = z.object({studentId:z.string(),attendanceStatus:z.enum(['PRESENT','LATE','ABSENT']),performance:z.enum(['EXCELLENT','GOOD','NEEDS_IMPROVEMENT']).nullable().optional(),conduct:z.enum(['EXCELLENT','GOOD','NEEDS_IMPROVEMENT']).nullable().optional(),punctuality:z.enum(['ALWAYS_ON_TIME','OCCASIONALLY_LATE','FREQUENTLY_LATE']).nullable().optional(),homework:z.enum(['ALWAYS_COMPLETED','USUALLY_COMPLETED','RARELY_COMPLETED']).nullable().optional(),participation:z.enum(['ACTIVE','MODERATE','PASSIVE']).nullable().optional(),comment:z.string().max(1000).nullable().optional()});
export const lessonInput = z.object({id:z.string().optional(),classId:z.string(),subjectId:z.string(),academicYearId:z.string(),lessonDate:z.string(),topic:z.string().max(250),submit:z.boolean(),records:z.array(studentRecord).max(150)});
export async function saveLesson(user: typeof users.$inferSelect, raw: unknown) {
 const data=lessonInput.parse(raw); const org=await orgFor(user); const teacher=await teacherFor(user); const today=schoolToday(org.timezone);
 // Admin configures how many days back reports may be dated (§39); that value is the limit teachers work to.
 const windowDays=await reportWindowDays(org.id);
 if(!validLessonDate(data.lessonDate,today,windowDays)) throw new AppError(`The selected lesson date must be within the last ${reportWindowLabel(windowDays)}.`);
 const [year]=await db.select().from(academicYears).where(and(eq(academicYears.id,data.academicYearId),eq(academicYears.organizationId,org.id),eq(academicYears.active,true)));
 if(!year || data.lessonDate<year.startDate || data.lessonDate>year.endDate) throw new AppError('The lesson date must fall within the selected academic year.');
 const [klass]=await db.select().from(classes).where(and(eq(classes.id,data.classId),eq(classes.organizationId,org.id),eq(classes.academicYearId,year.id),eq(classes.active,true)));
 const [subject]=await db.select().from(subjects).where(and(eq(subjects.id,data.subjectId),eq(subjects.organizationId,org.id),eq(subjects.active,true)));
 const [assignment]=await db.select().from(assignments).where(and(eq(assignments.organizationId,org.id),eq(assignments.teacherId,teacher.id),eq(assignments.classId,data.classId),eq(assignments.subjectId,data.subjectId),eq(assignments.academicYearId,year.id),eq(assignments.active,true)));
 if(!klass || !subject || !assignment) throw new AppError('You are not assigned to this class and subject.',403);
 const [closed]=await db.select().from(monthClosures).where(and(eq(monthClosures.organizationId,org.id),eq(monthClosures.month,data.lessonDate.slice(0,7)),eq(monthClosures.closed,true)));
 if(closed) throw new AppError('This reporting month is closed.',403);
 const [term]=await db.select().from(terms).where(and(eq(terms.organizationId,org.id),eq(terms.academicYearId,year.id))).then(rows=>[rows.find(t=>t.active && t.startDate<=data.lessonDate && t.endDate>=data.lessonDate)]);
 if(!term) throw new AppError('No active term covers this lesson date. Contact your administrator.');
 const roster=await db.select({id:students.id, studentCode:students.studentId, fullName:students.fullName}).from(students).where(and(eq(students.organizationId,org.id),eq(students.classId,klass.id),eq(students.academicYearId,year.id),eq(students.status,'ACTIVE')));
 const rosterById=new Map(roster.map(s=>[s.id,s]));
 const ids=new Set(roster.map(s=>s.id)); const submitted=new Set(data.records.map(r=>r.studentId));
 if(submitted.size!==data.records.length || data.records.some(r=>!ids.has(r.studentId))) throw new AppError('The report contains an unauthorized or duplicate student.',403);
 if(data.submit && (roster.length===0 || roster.length!==submitted.size || !data.topic.trim())) throw new AppError('Please record all active students and a topic before submitting.');
for(const r of data.records) {
   if(r.attendanceStatus==='ABSENT' && [r.performance,r.conduct,r.punctuality,r.homework,r.participation].some(Boolean)) throw new AppError('Absent students cannot have academic observations.');
   if(data.submit && r.attendanceStatus!=='ABSENT' && (!r.performance || !r.conduct || !r.punctuality || !r.homework || !r.participation)) throw new AppError('Complete all observations for present and late students.');
   if(data.submit && (r.performance==='NEEDS_IMPROVEMENT'||r.conduct==='NEEDS_IMPROVEMENT') && !r.comment?.trim()) throw new AppError('Please add a comment for students needing improvement.');
  }
 const [existing]=await db.select().from(lessons).where(and(eq(lessons.organizationId,org.id),eq(lessons.teacherId,teacher.id),eq(lessons.classId,klass.id),eq(lessons.subjectId,subject.id),eq(lessons.lessonDate,data.lessonDate)));
 if(existing && existing.id!==data.id) throw new AppError(`A report for this class, subject and date already exists. Open existing report: ${existing.id}`,409);
 if(data.id && (!existing || existing.id!==data.id)) throw new AppError('Report not found.',404);
 if(existing && !['DRAFT','RETURNED'].includes(existing.status)) throw new AppError('This report cannot be edited.',403);
 const result=await db.transaction(async tx=>{
  const [lesson]=existing ? await tx.update(lessons).set({topic:data.topic.trim(),status:data.submit?'SUBMITTED':'DRAFT',termId:term.id,updatedAt:new Date(),submittedAt:data.submit?new Date():null,reviewComment:data.submit?null:existing.reviewComment}).where(eq(lessons.id,existing.id)).returning() : await tx.insert(lessons).values({organizationId:org.id,teacherId:teacher.id,classId:klass.id,subjectId:subject.id,academicYearId:year.id,termId:term.id,classNameSnapshot:klass.name,subjectNameSnapshot:subject.name,teacherNameSnapshot:teacher.name,academicYearNameSnapshot:year.name,lessonDate:data.lessonDate,topic:data.topic.trim(),status:data.submit?'SUBMITTED':'DRAFT',submittedAt:data.submit?new Date():null}).returning();
for(const r of data.records){
    const absent=r.attendanceStatus==='ABSENT';
    await tx.insert(records).values({organizationId:org.id,dailyLessonId:lesson.id,studentId:r.studentId,studentNameSnapshot:rosterById.get(r.studentId)!.fullName,studentCodeSnapshot:rosterById.get(r.studentId)!.studentCode,attendanceStatus:r.attendanceStatus,performance:absent?null:r.performance||null,conduct:absent?null:r.conduct||null,punctuality:absent?null:r.punctuality||null,homework:absent?null:r.homework||null,participation:absent?null:r.participation||null,comment:r.comment?.trim()||null}).onConflictDoUpdate({target:[records.dailyLessonId,records.studentId],set:{attendanceStatus:r.attendanceStatus,performance:absent?null:r.performance||null,conduct:absent?null:r.conduct||null,punctuality:absent?null:r.punctuality||null,homework:absent?null:r.homework||null,participation:absent?null:r.participation||null,comment:r.comment?.trim()||null,updatedAt:new Date()}});
  }
  return lesson;
 });
 await audit(org.id,user.id,data.submit?'LESSON_SUBMITTED':existing?'LESSON_UPDATED':'LESSON_CREATED','daily_lesson',result.id,{lessonDate:data.lessonDate,classId:klass.id,subjectId:subject.id});
 return result;
}

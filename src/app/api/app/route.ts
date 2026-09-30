import { db } from '@/db';
import { organizations, users, sessions, teachers, students, grades, classes, subjects, academicYears, terms, assignments, lessons, records, auditLogs, settings, monthClosures, monthlyRuleSnapshots, behaviourObservations } from '@/db/schema';
import { and, eq, desc, count, ilike, gte, lt, lte, inArray, or, sql } from 'drizzle-orm';
import { hash } from 'bcryptjs';
import { randomBytes } from 'crypto';
import { z } from 'zod';
import { AppError, audit, checkOrigin, orgFor, requireUser, schoolToday, dateMinus, teacherFor, validLessonDate, reportDatePolicy, reportWindowLabel, MIN_REPORT_WINDOW_DAYS, MAX_REPORT_WINDOW_DAYS } from '@/lib/security';
import { saveLesson } from '@/lib/lessons';
import { groupReports, groupReportsByMonth } from '@/lib/reporting';
import { resolvePeriod, monthStart, monthEnd, periodSlug, MONTH_PATTERN } from '@/lib/period';
import { reviewTransition } from '@/lib/review';
import { normalizeTeacherAssignmentImportRow } from '@/lib/importing';

export const dynamic='force-dynamic';
const fail=(e:unknown)=>{ if(e instanceof AppError){ console.error(`[api] AppError ${e.status}: ${e.message}`); return Response.json({error:e.message},{status:e.status}); } if(e instanceof z.ZodError){ console.error('[api] ZodError:', JSON.stringify(e.issues)); return Response.json({error:e.issues[0]?.message||'Invalid input'},{status:400}); } console.error('Application request failed',e); return Response.json({error:'The request could not be completed.'},{status:500}); };
const str=(v:unknown)=>z.string().max(200).parse(v);
const isValidTimezone=(tz:string)=>{try{new Intl.DateTimeFormat('en-US',{timeZone:tz});return true}catch{return false}};
export async function GET(req:Request){try{
 const user=await requireUser(); const url=new URL(req.url); const view=url.searchParams.get('view')||'overview';
 if(user.role==='SUPER_ADMIN'){
  if(view==='audit')return Response.json({logs:await db.select().from(auditLogs).orderBy(desc(auditLogs.createdAt)).limit(100)});
  if(view==='organizations'){const orgs=await db.select().from(organizations).orderBy(organizations.name); const totals=await Promise.all(orgs.map(async o=>({ ...o,studentCount:(await db.select({n:count()}).from(students).where(eq(students.organizationId,o.id)))[0].n,teacherCount:(await db.select({n:count()}).from(teachers).where(eq(teachers.organizationId,o.id)))[0].n,classCount:(await db.select({n:count()}).from(classes).where(eq(classes.organizationId,o.id)))[0].n }))); return Response.json({organizations:totals});}
  return Response.json({role:user.role,name:user.name,organizations:(await db.select({n:count()}).from(organizations))[0].n});
 }
 const org=await orgFor(user); const teacher=user.role==='TEACHER'?await teacherFor(user):null;
 const myAssignment=teacher ? and(eq(assignments.organizationId,org.id),eq(assignments.teacherId,teacher.id),eq(assignments.active,true)) : eq(assignments.organizationId,org.id);
 if(view==='overview'){
  const today = schoolToday(org.timezone);
  const currentMonth = today.slice(0, 7);
  const nextMonthDate = new Date(`${currentMonth}-01T12:00:00Z`); nextMonthDate.setUTCMonth(nextMonthDate.getUTCMonth() + 1);
  const nextMonthStr = nextMonthDate.toISOString().slice(0, 10);
  const [st,tc,cl,su,ls,thisMonthReports,approvalStats,studentFollowUps]=await Promise.all([
    db.select({n:count()}).from(students).where(and(eq(students.organizationId,org.id),eq(students.status,'ACTIVE'))),
    db.select({n:count()}).from(teachers).where(and(eq(teachers.organizationId,org.id),eq(teachers.active,true))),
    db.select({n:count()}).from(classes).where(and(eq(classes.organizationId,org.id),eq(classes.active,true))),
    db.select({n:count()}).from(subjects).where(and(eq(subjects.organizationId,org.id),eq(subjects.active,true))),
    db.select({status:lessons.status,n:count()}).from(lessons).where(and(eq(lessons.organizationId,org.id),teacher?eq(lessons.teacherId,teacher.id):undefined)).groupBy(lessons.status),
    db.select({n:count()}).from(lessons).where(and(eq(lessons.organizationId,org.id),teacher?eq(lessons.teacherId,teacher.id):undefined,gte(lessons.lessonDate,`${currentMonth}-01`),lt(lessons.lessonDate,nextMonthStr))),
    db.select({status:lessons.status,n:count()}).from(lessons).where(and(eq(lessons.organizationId,org.id),inArray(lessons.status,['SUBMITTED','UNDER_REVIEW','APPROVED','RETURNED']))).groupBy(lessons.status),
    db.select({n:count()}).from(behaviourObservations).where(and(eq(behaviourObservations.organizationId,org.id),eq(behaviourObservations.followUpRequired,true)))
  ]);
  const ass=await db.select({id:assignments.id,classId:classes.id,className:classes.name,subjectId:subjects.id,subjectName:subjects.name,academicYearId:academicYears.id,yearName:academicYears.name,teacherName:teachers.name}).from(assignments).innerJoin(classes,eq(classes.id,assignments.classId)).innerJoin(subjects,eq(subjects.id,assignments.subjectId)).innerJoin(academicYears,eq(academicYears.id,assignments.academicYearId)).innerJoin(teachers,eq(teachers.id,assignments.teacherId)).where(and(myAssignment,eq(classes.active,true),eq(subjects.active,true),eq(academicYears.active,true))).orderBy(classes.name,subjects.name).limit(200);
  const recent=await db.select({id:lessons.id,lessonDate:lessons.lessonDate,topic:lessons.topic,status:lessons.status,className:classes.name,subjectName:subjects.name,teacherName:teachers.name,updatedAt:lessons.updatedAt}).from(lessons).innerJoin(classes,eq(classes.id,lessons.classId)).innerJoin(subjects,eq(subjects.id,lessons.subjectId)).innerJoin(teachers,eq(teachers.id,lessons.teacherId)).where(and(eq(lessons.organizationId,org.id),teacher?eq(lessons.teacherId,teacher.id):undefined)).orderBy(desc(lessons.updatedAt)).limit(8);
  const assignedClasses=[...new Set(ass.map(a=>a.classId))]; const assignedSubjects=[...new Set(ass.map(a=>a.subjectId))]; const visibleStudents=teacher&&assignedClasses.length?(await db.select({n:count()}).from(students).where(and(eq(students.organizationId,org.id),eq(students.status,'ACTIVE'),inArray(students.classId,assignedClasses))))[0].n:0;
  const statusMap=Object.fromEntries(ls.map(r=>[r.status,Number(r.n)]));
  const totalReports=Object.values(statusMap).reduce((a,b)=>a+b,0);
  const totalReviewed=approvalStats.reduce((acc,curr)=>acc+Number(curr.n),0);
  const approvedCount=Number(approvalStats.find(s=>s.status==='APPROVED')?.n||0);
  const approvalRate=totalReviewed>0?Math.round((approvedCount/totalReviewed)*100):100;
  const teacherMonthClasses=teacher?(await db.selectDistinct({classId:lessons.classId}).from(lessons).where(and(eq(lessons.organizationId,org.id),eq(lessons.teacherId,teacher.id),gte(lessons.lessonDate,`${currentMonth}-01`),lt(lessons.lessonDate,nextMonthStr)))).length:0;
  const teacherMonthSubjects=teacher?(await db.selectDistinct({subjectId:lessons.subjectId}).from(lessons).where(and(eq(lessons.organizationId,org.id),eq(lessons.teacherId,teacher.id),gte(lessons.lessonDate,`${currentMonth}-01`),lt(lessons.lessonDate,nextMonthStr)))).length:0;
   const reportPolicy=await reportDatePolicy(org.id);
  return Response.json({role:user.role,name:user.name,organization:org.name,today,windowDays:reportPolicy.days,minDate:dateMinus(today,reportPolicy.days),counts:{students:teacher?visibleStudents:st[0].n,teachers:teacher?1:tc[0].n,classes:teacher?assignedClasses.length:cl[0].n,subjects:teacher?assignedSubjects.length:su[0].n,reports:statusMap,totalReports,reportsThisMonth:Number(thisMonthReports[0]?.n||0),approvalRate,followUpsRequired:Number(studentFollowUps[0]?.n||0),teacherMonthClasses,teacherMonthSubjects},statusCounts:statusMap,assignments:ass,recent});
 }
 if(view==='reference'){
  const [years,ts,gs,cs,ss,teach,ass,allStudents]=await Promise.all([
    db.select().from(academicYears).where(eq(academicYears.organizationId,org.id)).orderBy(academicYears.name),
    db.select().from(terms).where(eq(terms.organizationId,org.id)).orderBy(terms.startDate),
    db.select().from(grades).where(eq(grades.organizationId,org.id)).orderBy(grades.orderIndex),
    db.select().from(classes).where(eq(classes.organizationId,org.id)).orderBy(classes.name),
    db.select().from(subjects).where(eq(subjects.organizationId,org.id)).orderBy(subjects.name),
    user.role==='ADMIN'?db.select({id:teachers.id,name:teachers.name,email:teachers.email,teacherId:teachers.teacherId,department:teachers.department,active:teachers.active}).from(teachers).where(eq(teachers.organizationId,org.id)).orderBy(teachers.name):Promise.resolve([]),
    db.select().from(assignments).where(myAssignment),
    user.role==='ADMIN'?db.select().from(students).where(eq(students.organizationId,org.id)).orderBy(students.fullName).limit(300):Promise.resolve([])
  ]);
   const reportPolicy=await reportDatePolicy(org.id);
  return Response.json({years,terms:ts,grades:user.role==='TEACHER'?gs.filter(g=>cs.some(c=>ass.some(a=>a.classId===c.id)&&c.gradeId===g.id)):gs,classes:user.role==='TEACHER'?cs.filter(c=>ass.some(a=>a.classId===c.id)):cs,subjects:user.role==='TEACHER'?ss.filter(s=>ass.some(a=>a.subjectId===s.id)):ss,teachers:teach,assignments:ass,students:allStudents,today:schoolToday(org.timezone),windowDays:reportPolicy.days,allowFutureDates:user.role==='ADMIN'&&reportPolicy.allowFuture,minDate:dateMinus(schoolToday(org.timezone),reportPolicy.days),organization:{id:org.id,name:org.name,timezone:org.timezone,code:org.code,logoUrl:org.logoUrl,domain:org.domain}});
 }
 if(view==='students'){
  const classId=url.searchParams.get('classId');const search=(url.searchParams.get('search')||'').slice(0,80);const roster=url.searchParams.get('roster')==='1';
  const page=z.coerce.number().int().min(0).max(10000).parse(url.searchParams.get('page')||'0');
  if(teacher){if(!classId||!(await db.select({id:assignments.id}).from(assignments).where(and(myAssignment,eq(assignments.classId,classId))).limit(1)).length)throw new AppError('Class access denied.',403);}
  const rows=await db.select({id:students.id,studentId:students.studentId,fullName:students.fullName,firstName:students.firstName,lastName:students.lastName,classId:students.classId,gradeId:students.gradeId,academicYearId:students.academicYearId,status:students.status,className:classes.name}).from(students).innerJoin(classes,eq(classes.id,students.classId)).where(and(eq(students.organizationId,org.id),classId?eq(students.classId,classId):undefined,teacher?eq(students.status,'ACTIVE'):undefined,search?or(ilike(students.fullName,`%${search}%`),ilike(students.studentId,`%${search}%`)):undefined)).orderBy(students.fullName,students.id).limit(roster?151:51).offset(roster?0:page*50);
  if(roster&&rows.length>150)throw new AppError('Class roster exceeds the 150-student form limit. Contact your administrator.');
  return Response.json({students:roster?rows:rows.slice(0,50),page,hasMore:!roster&&rows.length>50});
 }
 if(view==='studentProfile'){
   if(user.role!=='ADMIN')throw new AppError('Student profile access denied.',403);
   const id=z.string().uuid().parse(url.searchParams.get('id'));
   const [student]=await db.select({id:students.id,studentId:students.studentId,fullName:students.fullName,status:students.status,className:classes.name}).from(students).innerJoin(classes,eq(classes.id,students.classId)).where(and(eq(students.id,id),eq(students.organizationId,org.id))).limit(1);
   if(!student)throw new AppError('Student not found.',404);
   const timeline=await db.select({lessonDate:lessons.lessonDate,subject:sql<string>`coalesce(${lessons.subjectNameSnapshot}, ${subjects.name})`,topic:lessons.topic,attendance:records.attendanceStatus,performance:records.performance,conduct:records.conduct,punctuality:records.punctuality,homework:records.homework,participation:records.participation,comment:records.comment,status:lessons.status}).from(records).innerJoin(lessons,eq(lessons.id,records.dailyLessonId)).innerJoin(subjects,eq(subjects.id,lessons.subjectId)).where(and(eq(records.studentId,id),eq(records.organizationId,org.id),eq(lessons.organizationId,org.id))).orderBy(desc(lessons.lessonDate)).limit(100);
   const significant=await db.select({id:behaviourObservations.id,date:behaviourObservations.date,category:behaviourObservations.category,severity:behaviourObservations.severity,description:behaviourObservations.description,actionTaken:behaviourObservations.actionTaken,followUpRequired:behaviourObservations.followUpRequired}).from(behaviourObservations).where(and(eq(behaviourObservations.organizationId,org.id),eq(behaviourObservations.studentId,id))).orderBy(desc(behaviourObservations.date)).limit(100);
   return Response.json({student,timeline,significant});
  }
  if(view==='reports'){
   const legacyMonth=url.searchParams.get('month');
   const rangeFrom=url.searchParams.get('from')?z.iso.date().parse(url.searchParams.get('from')):legacyMonth?monthStart(legacyMonth):null;
   const rangeTo=url.searchParams.get('to')?z.iso.date().parse(url.searchParams.get('to')):legacyMonth?monthEnd(legacyMonth):rangeFrom;
   const rawReports=await db.select({
    id:lessons.id,
    lessonDate:lessons.lessonDate,
    topic:lessons.topic,
    status:lessons.status,
    classId:lessons.classId,
    subjectId:lessons.subjectId,
    className:classes.name,
    subjectName:subjects.name,
    teacherName:teachers.name,
    submittedAt:lessons.submittedAt,
    updatedAt:lessons.updatedAt,
    reviewComment:lessons.reviewComment,
    recordsCount:sql<number>`CAST((select count(*) from ${records} where ${records.dailyLessonId}=${lessons.id}) AS INTEGER)`,
    rosterCount:sql<number>`CAST((select count(*) from ${students} where ${students.classId}=${lessons.classId} and ${students.status}='ACTIVE') AS INTEGER)`
  }).from(lessons)
    .innerJoin(classes,eq(classes.id,lessons.classId))
    .innerJoin(subjects,eq(subjects.id,lessons.subjectId))
    .innerJoin(teachers,eq(teachers.id,lessons.teacherId))
    .where(and(
      eq(lessons.organizationId,org.id),
      teacher?eq(lessons.teacherId,teacher.id):undefined,
      url.searchParams.get('status')?eq(lessons.status,str(url.searchParams.get('status'))):undefined,
      url.searchParams.get('classId')?eq(lessons.classId,str(url.searchParams.get('classId'))):undefined,
      url.searchParams.get('subjectId')?eq(lessons.subjectId,str(url.searchParams.get('subjectId'))):undefined,
      url.searchParams.get('teacherId')?eq(lessons.teacherId,str(url.searchParams.get('teacherId'))):undefined,
      url.searchParams.get('date')?eq(lessons.lessonDate,z.iso.date().parse(url.searchParams.get('date'))):undefined,
      rangeFrom?gte(lessons.lessonDate,rangeFrom):undefined,
      rangeTo?lte(lessons.lessonDate,rangeTo):undefined
    ))
    .orderBy(desc(lessons.lessonDate),desc(lessons.updatedAt))
    .limit(100);
  const rows=rawReports.map(r=>({
    ...r,
    completionRate:r.rosterCount>0?Math.min(100,Math.round((r.recordsCount/r.rosterCount)*100)):100
  }));
  return Response.json({reports:rows});
 }
 if(view==='lesson'){
  const id=str(url.searchParams.get('id')); const [lesson]=await db.select().from(lessons).where(and(eq(lessons.id,id),eq(lessons.organizationId,org.id),teacher?eq(lessons.teacherId,teacher.id):undefined)); if(!lesson) throw new AppError('Report not found.',404);
const lessonRecords = await db.select({
    id: records.id,
    studentId: records.studentId,
    studentName: sql<string>`coalesce(${records.studentNameSnapshot}, ${students.fullName})`,
    studentCode: sql<string>`coalesce(${records.studentCodeSnapshot}, ${students.studentId})`,
    attendanceStatus: records.attendanceStatus,
    performance: records.performance,
    conduct: records.conduct,
    punctuality: records.punctuality,
    homework: records.homework,
    participation: records.participation,
    comment: records.comment
   }).from(records).innerJoin(students, eq(students.id, records.studentId)).where(and(eq(records.organizationId,org.id),eq(records.dailyLessonId,id))).orderBy(students.fullName);
  return Response.json({lesson,records:lessonRecords});
 }
  if(view==='monthly'){
   const period=resolvePeriod(url.searchParams, schoolToday(org.timezone)); const classId=url.searchParams.get('classId'); const subjectId=url.searchParams.get('subjectId'); const studentId=url.searchParams.get('studentId'); const academicYearId=url.searchParams.get('academicYearId'); const termId=url.searchParams.get('termId'); const gradeId=url.searchParams.get('gradeId'); const teacherId=url.searchParams.get('teacherId');
   if(teacher){if(!classId || !subjectId || !(await db.select({id:assignments.id}).from(assignments).where(and(myAssignment,eq(assignments.classId,classId),eq(assignments.subjectId,subjectId))).limit(1)).length) throw new AppError('Report access denied.',403);}
   const data=await db.select({lessonDate:lessons.lessonDate,topic:lessons.topic,lessonId:lessons.id,status:lessons.status,studentId:students.id,studentName:sql<string>`coalesce(${records.studentNameSnapshot}, ${students.fullName})`,studentCode:sql<string>`coalesce(${records.studentCodeSnapshot}, ${students.studentId})`,className:sql<string>`coalesce(${lessons.classNameSnapshot}, ${classes.name})`,subjectName:sql<string>`coalesce(${lessons.subjectNameSnapshot}, ${subjects.name})`,teacherName:sql<string>`coalesce(${lessons.teacherNameSnapshot}, ${teachers.name})`,attendance:records.attendanceStatus,performance:records.performance,conduct:records.conduct,punctuality:records.punctuality,homework:records.homework,participation:records.participation,comment:records.comment}).from(records).innerJoin(lessons,eq(lessons.id,records.dailyLessonId)).innerJoin(students,eq(students.id,records.studentId)).innerJoin(classes,eq(classes.id,lessons.classId)).innerJoin(subjects,eq(subjects.id,lessons.subjectId)).innerJoin(teachers,eq(teachers.id,lessons.teacherId)).where(and(eq(lessons.organizationId,org.id),inArray(lessons.status,['SUBMITTED','UNDER_REVIEW','APPROVED']),gte(lessons.lessonDate,period.from),lte(lessons.lessonDate,period.to),classId?eq(lessons.classId,classId):undefined,subjectId?eq(lessons.subjectId,subjectId):undefined,studentId?eq(students.id,studentId):undefined,academicYearId?eq(lessons.academicYearId,academicYearId):undefined,termId?eq(lessons.termId,termId):undefined,gradeId?eq(classes.gradeId,gradeId):undefined,teacherId?eq(lessons.teacherId,teacherId):undefined)).orderBy(students.fullName,subjects.name,lessons.lessonDate).limit(20001);
   if(data.length>20000) throw new AppError(`This period covers more than 20,000 observations. Shorten the date range or select a class or subject.`,413);
   const [current]=await db.select().from(settings).where(eq(settings.organizationId,org.id));
   const rules=current;
   const closedMonths=(await db.select({month:monthClosures.month}).from(monthClosures).where(and(eq(monthClosures.organizationId,org.id),eq(monthClosures.closed,true),inArray(monthClosures.month,period.months)))).map(r=>r.month);
   return Response.json({data,summaries:groupReports(data,rules),comparison:groupReportsByMonth(data,rules),rules,organization:org.name,period,closedMonths,coverage:{observations:data.length,lessonReports:new Set(data.map(r=>r.lessonId)).size,students:new Set(data.map(r=>r.studentId)).size}});
  }
  if(view==='dataQuality'){
   if(user.role!=='ADMIN') throw new AppError('Access denied.',403);
   const period=resolvePeriod(url.searchParams, schoolToday(org.timezone));
   const [drafts,returned,activeStudents,studentsWithRecords,activeSubjects,subjectsWithRecords]=await Promise.all([
    db.select({id:lessons.id,lessonDate:lessons.lessonDate,topic:lessons.topic,className:classes.name,subjectName:subjects.name,teacherName:teachers.name,updatedAt:lessons.updatedAt,recordsCount:sql<number>`CAST((select count(*) from ${records} where ${records.dailyLessonId}=${lessons.id}) AS INTEGER)`,rosterCount:sql<number>`CAST((select count(*) from ${students} where ${students.classId}=${lessons.classId} and ${students.status}='ACTIVE') AS INTEGER)`}).from(lessons).innerJoin(classes,eq(classes.id,lessons.classId)).innerJoin(subjects,eq(subjects.id,lessons.subjectId)).innerJoin(teachers,eq(teachers.id,lessons.teacherId)).where(and(eq(lessons.organizationId,org.id),eq(lessons.status,'DRAFT'),gte(lessons.lessonDate,period.from),lte(lessons.lessonDate,period.to))).orderBy(desc(lessons.updatedAt)).limit(50),
    db.select({id:lessons.id,lessonDate:lessons.lessonDate,topic:lessons.topic,className:classes.name,subjectName:subjects.name,teacherName:teachers.name,reviewComment:lessons.reviewComment,updatedAt:lessons.updatedAt}).from(lessons).innerJoin(classes,eq(classes.id,lessons.classId)).innerJoin(subjects,eq(subjects.id,lessons.subjectId)).innerJoin(teachers,eq(teachers.id,lessons.teacherId)).where(and(eq(lessons.organizationId,org.id),eq(lessons.status,'RETURNED'),gte(lessons.lessonDate,period.from),lte(lessons.lessonDate,period.to))).orderBy(desc(lessons.updatedAt)).limit(50),
    db.select({id:students.id,studentId:students.studentId,fullName:students.fullName,className:classes.name}).from(students).innerJoin(classes,eq(classes.id,students.classId)).where(and(eq(students.organizationId,org.id),eq(students.status,'ACTIVE'))),
    db.selectDistinct({studentId:records.studentId}).from(records).innerJoin(lessons,eq(lessons.id,records.dailyLessonId)).where(and(eq(lessons.organizationId,org.id),gte(lessons.lessonDate,period.from),lte(lessons.lessonDate,period.to))),
    db.select({id:subjects.id,name:subjects.name,code:subjects.code}).from(subjects).where(and(eq(subjects.organizationId,org.id),eq(subjects.active,true))),
    db.selectDistinct({subjectId:lessons.subjectId}).from(lessons).where(and(eq(lessons.organizationId,org.id),gte(lessons.lessonDate,period.from),lte(lessons.lessonDate,period.to)))
   ]);
   const recordedStudentIds=new Set(studentsWithRecords.map(r=>r.studentId));
   const studentsWithNoRecords=activeStudents.filter(s=>!recordedStudentIds.has(s.id));
   const recordedSubjectIds=new Set(subjectsWithRecords.map(r=>r.subjectId));
   const subjectsWithNoRecords=activeSubjects.filter(s=>!recordedSubjectIds.has(s.id));
   return Response.json({period,drafts:drafts.map(d=>({...d,completionRate:d.rosterCount>0?Math.min(100,Math.round((d.recordsCount/d.rosterCount)*100)):100})),returned,studentsWithNoRecords:studentsWithNoRecords.slice(0,50),studentsWithNoRecordsCount:studentsWithNoRecords.length,subjectsWithNoRecords,activeStudentsCount:activeStudents.length,recordedStudentsCount:recordedStudentIds.size});
  }
 if(view==='trends'){
  const studentId=z.string().uuid().parse(url.searchParams.get('studentId'));
  const [stu]=await db.select().from(students).where(and(eq(students.id,studentId),eq(students.organizationId,org.id)));
  if(!stu)throw new AppError('Student not found.',404);
  const studentRows=await db.select({lessonDate:lessons.lessonDate,topic:lessons.topic,lessonId:lessons.id,status:lessons.status,studentId:students.id,studentName:sql<string>`coalesce(${records.studentNameSnapshot}, ${students.fullName})`,studentCode:sql<string>`coalesce(${records.studentCodeSnapshot}, ${students.studentId})`,className:sql<string>`coalesce(${lessons.classNameSnapshot}, ${classes.name})`,subjectName:sql<string>`coalesce(${lessons.subjectNameSnapshot}, ${subjects.name})`,attendance:records.attendanceStatus,performance:records.performance,conduct:records.conduct,punctuality:records.punctuality,homework:records.homework,participation:records.participation,comment:records.comment}).from(records).innerJoin(lessons,eq(lessons.id,records.dailyLessonId)).innerJoin(students,eq(students.id,records.studentId)).innerJoin(classes,eq(classes.id,lessons.classId)).innerJoin(subjects,eq(subjects.id,lessons.subjectId)).where(and(eq(lessons.organizationId,org.id),eq(records.studentId,studentId),inArray(lessons.status,['SUBMITTED','UNDER_REVIEW','APPROVED']))).orderBy(lessons.lessonDate);
  const [currentSettings]=await db.select().from(settings).where(eq(settings.organizationId,org.id));
  const {calculateStudentTrends}=await import('@/lib/reporting');
  const trends=calculateStudentTrends(studentRows,currentSettings);
  return Response.json({student:stu,trends});
 }
 if(view==='behaviourObservations'){
  const studentId=url.searchParams.get('studentId'); const classId=url.searchParams.get('classId'); const followUp=url.searchParams.get('followUp');
  const obs=await db.select({id:behaviourObservations.id,date:behaviourObservations.date,category:behaviourObservations.category,severity:behaviourObservations.severity,description:behaviourObservations.description,actionTaken:behaviourObservations.actionTaken,followUpRequired:behaviourObservations.followUpRequired,createdAt:behaviourObservations.createdAt,studentId:behaviourObservations.studentId,studentName:students.fullName,studentCode:students.studentId,className:classes.name,teacherName:teachers.name}).from(behaviourObservations).innerJoin(students,eq(students.id,behaviourObservations.studentId)).innerJoin(classes,eq(classes.id,behaviourObservations.classId)).innerJoin(teachers,eq(teachers.id,behaviourObservations.teacherId)).where(and(eq(behaviourObservations.organizationId,org.id),teacher?eq(behaviourObservations.teacherId,teacher.id):undefined,studentId?eq(behaviourObservations.studentId,studentId):undefined,classId?eq(behaviourObservations.classId,classId):undefined,followUp==='1'?eq(behaviourObservations.followUpRequired,true):undefined)).orderBy(desc(behaviourObservations.date),desc(behaviourObservations.createdAt)).limit(100);
  return Response.json({observations:obs});
 }
 if(view==='audit'){if(user.role!=='ADMIN') throw new AppError('Access denied.',403);return Response.json({logs:await db.select().from(auditLogs).where(eq(auditLogs.organizationId,org.id)).orderBy(desc(auditLogs.createdAt)).limit(100)});}
 if(view==='settings'){if(user.role!=='ADMIN') throw new AppError('Access denied.',403);return Response.json({settings:(await db.select().from(settings).where(eq(settings.organizationId,org.id)))[0],closures:await db.select().from(monthClosures).where(eq(monthClosures.organizationId,org.id)),organization:org});}
 throw new AppError('Unknown view.',404);
 }catch(e){return fail(e);}}

export async function POST(req:Request){try{
 await checkOrigin(req); const user=await requireUser(); const raw=await req.json(); const action=str(raw.action);
 if(action==='saveLesson') return Response.json({lesson:await saveLesson(user,raw.data)});
 if(action==='deleteDraft'){
   const x=z.object({id:z.string().uuid()}).parse(raw.data);
   const org=await orgFor(user),teacher=await teacherFor(user);
   const [draft]=await db.select({id:lessons.id}).from(lessons).where(and(eq(lessons.id,x.id),eq(lessons.organizationId,org.id),eq(lessons.teacherId,teacher.id),eq(lessons.status,'DRAFT')));
   if(!draft)throw new AppError('Only your own draft reports can be deleted.',403);
   await db.transaction(async tx=>{await tx.delete(records).where(and(eq(records.organizationId,org.id),eq(records.dailyLessonId,draft.id)));await tx.delete(lessons).where(and(eq(lessons.id,draft.id),eq(lessons.organizationId,org.id),eq(lessons.teacherId,teacher.id),eq(lessons.status,'DRAFT')));});
   await audit(org.id,user.id,'DRAFT_DELETED','daily_lesson',draft.id);return Response.json({ok:true});
 }
 if(action==='observation'){ 
   if(user.role!=='TEACHER'&&user.role!=='ADMIN')throw new AppError('Teacher or administrator access required.',403);
   const x=z.object({studentId:z.string().uuid(),classId:z.string().uuid(),date:z.iso.date(),category:z.enum(['Behaviour','Academic','Homework','Participation','Punctuality','Other']),severity:z.enum(['LOW','MODERATE','HIGH']),description:z.string().trim().min(5).max(1500),actionTaken:z.string().max(1000).optional(),followUpRequired:z.boolean()}).parse(raw.data);
   const org=await orgFor(user);
   const t=user.role==='TEACHER'?await teacherFor(user):(await db.select().from(teachers).where(eq(teachers.organizationId,org.id)).limit(1))[0];
   if(!t)throw new AppError('No teacher reference available.',400);
   if(user.role==='TEACHER'){const policy=await reportDatePolicy(org.id);if(!validLessonDate(x.date,schoolToday(org.timezone),policy.days))throw new AppError(`Observation date must be within the last ${reportWindowLabel(policy.days)}.`);}
   const [student]=await db.select().from(students).where(and(eq(students.id,x.studentId),eq(students.organizationId,org.id),eq(students.classId,x.classId),eq(students.status,'ACTIVE')));
   if(!student)throw new AppError('Student does not belong to this active class.',403);
   if(user.role==='TEACHER'){
     const [assigned]=await db.select().from(assignments).where(and(eq(assignments.organizationId,org.id),eq(assignments.teacherId,t.id),eq(assignments.classId,x.classId),eq(assignments.academicYearId,student.academicYearId),eq(assignments.active,true)));
     if(!assigned)throw new AppError('You are not assigned to this class.',403);
   }
   const [result]=await db.insert(behaviourObservations).values({organizationId:org.id,teacherId:t.id,...x}).returning({id:behaviourObservations.id});
   await audit(org.id,user.id,'BEHAVIOUR_OBSERVATION_CREATED','behaviour_observation',result.id,{studentId:x.studentId,category:x.category});return Response.json({ok:true,id:result.id});
 }
 if(action==='resolveFollowUp'){
   const org=await orgFor(user);
   const x=z.object({id:z.string().uuid(),resolved:z.boolean()}).parse(raw.data);
   const [obs]=await db.select().from(behaviourObservations).where(and(eq(behaviourObservations.id,x.id),eq(behaviourObservations.organizationId,org.id)));
   if(!obs)throw new AppError('Observation not found.',404);
   await db.update(behaviourObservations).set({followUpRequired:!x.resolved,updatedAt:new Date()}).where(and(eq(behaviourObservations.id,x.id),eq(behaviourObservations.organizationId,org.id)));
   await audit(org.id,user.id,'BEHAVIOUR_FOLLOW_UP_RESOLVED','behaviour_observation',x.id,{resolved:x.resolved});
   return Response.json({ok:true});
 }
  if(action==='export'){ 
    if(!['ADMIN','TEACHER'].includes(user.role))throw new AppError('Export access denied.',403);
    const organization=await orgFor(user);
    const period=resolvePeriod(new URLSearchParams((raw.data??{}) as Record<string,string>), schoolToday(organization.timezone));
    const x=z.object({classId:z.string().optional(),subjectId:z.string().optional(),format:z.enum(['csv','xlsx','print'])}).parse(raw.data);
    if(user.role==='TEACHER'){
     const t=await teacherFor(user);
     if(!x.classId||!x.subjectId||!(await db.select({id:assignments.id}).from(assignments).where(and(eq(assignments.organizationId,organization.id),eq(assignments.teacherId,t.id),eq(assignments.classId,x.classId),eq(assignments.subjectId,x.subjectId),eq(assignments.active,true))).limit(1)).length)throw new AppError('Export access denied.',403);
    }
    await audit(organization.id,user.id,'REPORT_EXPORTED','monthly_report',periodSlug(period),{...period,classId:x.classId,subjectId:x.subjectId,format:x.format});return Response.json({ok:true,period});
  }
 if(user.role==='SUPER_ADMIN'){ 
  if(action==='organization'){
    const data=z.object({name:z.string().min(2),code:z.string().min(2).max(25),timezone:z.string().refine(isValidTimezone,'Timezone must be a valid IANA zone such as Africa/Bujumbura.'),domain:z.string().max(200).optional().nullable(),logoUrl:z.string().max(500).optional().nullable(),id:z.string().optional(),active:z.boolean().optional()}).parse(raw.data);
   const [org]=data.id?await db.update(organizations).set({name:data.name,code:data.code.toUpperCase(),timezone:data.timezone,domain:data.domain||null,logoUrl:data.logoUrl||null,active:data.active??true,updatedAt:new Date()}).where(eq(organizations.id,data.id)).returning():await db.insert(organizations).values({name:data.name,code:data.code.toUpperCase(),timezone:data.timezone,domain:data.domain||null,logoUrl:data.logoUrl||null}).returning();
   if(!org) throw new AppError('Organization not found.',404);
   if(!data.id){await db.insert(settings).values({organizationId:org.id}); await db.insert(grades).values(Array.from({length:13},(_,i)=>({organizationId:org.id,name:`Grade ${i+1}`,orderIndex:i+1})));}
   await audit(null,user.id,data.id?'ORGANIZATION_UPDATED':'ORGANIZATION_CREATED','organization',org.id);return Response.json({ok:true});
  }
  if(action==='resetAdmin'){
   const x=z.object({organizationId:z.string(),password:z.string().min(12)}).parse(raw.data);
   const [org]=await db.select().from(organizations).where(eq(organizations.id,x.organizationId));
   if(!org?.primaryAdminUserId)throw new AppError('Organization administrator not found.',404);
   const [admin]=await db.select({id:users.id}).from(users).where(and(eq(users.id,org.primaryAdminUserId),eq(users.organizationId,org.id),eq(users.role,'ADMIN')));
   if(!admin)throw new AppError('Administrator not found.',404);
   await db.update(users).set({passwordHash:await hash(x.password,12),active:true,updatedAt:new Date()}).where(eq(users.id,admin.id));
   await db.delete(sessions).where(eq(sessions.userId,admin.id));
   await audit(null,user.id,'ADMIN_ACCESS_RESET','user',admin.id,{organizationId:org.id});return Response.json({ok:true});
  }
  if(action==='admin'){
   const data=z.object({organizationId:z.string(),name:z.string().min(2),username:z.string().min(3),email:z.email(),password:z.string().min(12)}).parse(raw.data);
   const [org]=await db.select().from(organizations).where(eq(organizations.id,data.organizationId));if(!org)throw new AppError('Organization not found.',404);
   const passwordHash=await hash(data.password,12);
   const admin=await db.transaction(async tx=>{if(org.primaryAdminUserId){await tx.update(users).set({active:false,updatedAt:new Date()}).where(and(eq(users.id,org.primaryAdminUserId),eq(users.organizationId,org.id)));}const [created]=await tx.insert(users).values({organizationId:org.id,name:data.name,username:data.username.toLowerCase(),email:data.email.toLowerCase(),passwordHash,role:'ADMIN'}).returning();await tx.update(organizations).set({primaryAdminUserId:created.id,updatedAt:new Date()}).where(eq(organizations.id,org.id));return created;});await audit(null,user.id,org.primaryAdminUserId?'ADMIN_REPLACED':'ADMIN_CREATED','user',admin.id,{organizationId:org.id});return Response.json({ok:true});
  }
  throw new AppError('Unknown action.',404);
 }
 if(user.role!=='ADMIN') throw new AppError('Administrator access required.',403);
 const org=await orgFor(user);const oid=org.id;
 if(action==='resetTeacherPassword'){
   const x=z.object({teacherId:z.string().uuid(),password:z.string().min(12)}).parse(raw.data);
   const [target]=await db.select().from(teachers).where(and(eq(teachers.id,x.teacherId),eq(teachers.organizationId,oid)));
   if(!target)throw new AppError('Teacher not found.',404);
   const passwordHash=await hash(x.password,12);
   await db.transaction(async tx=>{
     await tx.update(users).set({passwordHash,updatedAt:new Date()}).where(and(eq(users.id,target.userId),eq(users.organizationId,oid)));
     await tx.delete(sessions).where(eq(sessions.userId,target.userId));
   });
   await audit(oid,user.id,'TEACHER_PASSWORD_RESET','teacher',target.id);
   return Response.json({ok:true});
   }
  if(action==='correctLessonDate'){
    const x=z.object({id:z.string().uuid(),lessonDate:z.iso.date(),reason:z.string().trim().min(10).max(1000)}).parse(raw.data);
    const [old]=await db.select().from(lessons).where(and(eq(lessons.id,x.id),eq(lessons.organizationId,oid)));
    if(!old)throw new AppError('Report not found.',404);
    if(x.lessonDate===old.lessonDate)throw new AppError('Choose a different lesson date.');
    const today=schoolToday(org.timezone);
    // §39: the admin-configured window governs corrections too; future dates only when enabled.
    const policy=await reportDatePolicy(oid);
    const oldest=dateMinus(today,policy.days);
    if(x.lessonDate<oldest)throw new AppError(`The corrected date must fall within the configured ${reportWindowLabel(policy.days)} reporting window (${oldest} to ${today}).`);
    if(x.lessonDate>today&&!policy.allowFuture)throw new AppError('The corrected date cannot be in the future.');
   const [year]=await db.select().from(academicYears).where(and(eq(academicYears.id,old.academicYearId),eq(academicYears.organizationId,oid)));
   if(!year||x.lessonDate<year.startDate||x.lessonDate>year.endDate)throw new AppError('Date must fall within the original academic year.');
   const [term]=await db.select().from(terms).where(and(eq(terms.organizationId,oid),eq(terms.academicYearId,year.id),lte(terms.startDate,x.lessonDate),gte(terms.endDate,x.lessonDate),eq(terms.active,true))).limit(1);
   if(!term)throw new AppError('No active term covers the corrected date.');
   const blocked=await db.select().from(monthClosures).where(and(eq(monthClosures.organizationId,oid),inArray(monthClosures.month,[old.lessonDate.slice(0,7),x.lessonDate.slice(0,7)]),eq(monthClosures.closed,true))).limit(1);
   if(blocked.length)throw new AppError('Reopen the affected reporting month before correcting this report.',403);
   const [duplicate]=await db.select({id:lessons.id}).from(lessons).where(and(eq(lessons.organizationId,oid),eq(lessons.teacherId,old.teacherId),eq(lessons.classId,old.classId),eq(lessons.subjectId,old.subjectId),eq(lessons.lessonDate,x.lessonDate))).limit(1);
   if(duplicate)throw new AppError('A report for this teacher, class, subject and date already exists.',409);
   await db.update(lessons).set({lessonDate:x.lessonDate,termId:term.id,updatedAt:new Date()}).where(and(eq(lessons.id,old.id),eq(lessons.organizationId,oid)));
   await audit(oid,user.id,'ADMIN_DATE_CORRECTION','daily_lesson',old.id,{originalDate:old.lessonDate,newDate:x.lessonDate,reason:x.reason});return Response.json({ok:true});
 }
 if(action==='teacherAccess'){ 
   const x=z.object({teacherId:z.string().uuid(),active:z.boolean()}).parse(raw.data);
   const [target]=await db.select().from(teachers).where(and(eq(teachers.id,x.teacherId),eq(teachers.organizationId,oid)));
   if(!target)throw new AppError('Teacher not found.',404);
   await db.transaction(async tx=>{
     await tx.update(teachers).set({active:x.active,updatedAt:new Date()}).where(eq(teachers.id,target.id));
     await tx.update(users).set({active:x.active,updatedAt:new Date()}).where(and(eq(users.id,target.userId),eq(users.organizationId,oid),eq(users.role,'TEACHER')));
     if(!x.active)await tx.delete(sessions).where(eq(sessions.userId,target.userId));
   });
   await audit(oid,user.id,x.active?'ACCOUNT_ACTIVATED':'ACCOUNT_DEACTIVATED','teacher',target.id,{previous:target.active,new:x.active});return Response.json({ok:true});
 }
 if(action==='import'){
  const input=z.object({kind:z.enum(['students','teachers','assignments']),rows:z.array(z.record(z.string(),z.unknown())).min(1).max(300)}).parse(raw.data);
  const [allClasses,allGrades,allYears,allSubjects,allTeachers]=await Promise.all([db.select().from(classes).where(eq(classes.organizationId,oid)),db.select().from(grades).where(eq(grades.organizationId,oid)),db.select().from(academicYears).where(eq(academicYears.organizationId,oid)),db.select().from(subjects).where(eq(subjects.organizationId,oid)),db.select().from(teachers).where(eq(teachers.organizationId,oid))]);
  const clean=(v:unknown)=>String(v??'').trim();const errors:{row:number;reason:string}[]=[];const credentials:{email:string;password:string}[]=[];let imported=0,updated=0;
  for(let i=0;i<input.rows.length;i++)try{
   const row=input.rows[i];
   if(input.kind==='students'){
    const code=clean(row['Student ID']);const name=clean(row['Student Name']);const gradeName=clean(row['Grade']);const className=clean(row['Class']);const yearName=clean(row['Academic Year']);const status=clean(row['Status']).toUpperCase()||'ACTIVE';
    if(!code||!name||!['ACTIVE','INACTIVE'].includes(status))throw Error('Invalid student ID, name or status.');
    const g=allGrades.find(x=>x.name.toLowerCase()===gradeName.toLowerCase());const y=allYears.find(x=>x.name===yearName);const c=allClasses.find(x=>x.name.toLowerCase()===className.toLowerCase()&&x.gradeId===g?.id&&x.academicYearId===y?.id);if(!g||!y||!c)throw Error('Grade, class and academic year must exist and match.');
    const parts=name.split(/\s+/);const firstName=parts.shift()||name,lastName=parts.join(' ')||'—';const [old]=await db.select().from(students).where(and(eq(students.organizationId,oid),eq(students.studentId,code)));
    if(old){await db.update(students).set({firstName,lastName,fullName:name,gradeId:g.id,classId:c.id,academicYearId:y.id,status,updatedAt:new Date()}).where(eq(students.id,old.id));updated++;}else{await db.insert(students).values({organizationId:oid,studentId:code,firstName,lastName,fullName:name,gradeId:g.id,classId:c.id,academicYearId:y.id,status});imported++;}
   }else if(input.kind==='teachers'){
    const hasRosterColumns = ['NO','NAME','SURNAME','EMAIL','SUBJECTS','CLASSES'].some(key => Object.keys(row).some(k => k.trim().toUpperCase() === key));
    if (hasRosterColumns) {
      const roster = normalizeTeacherAssignmentImportRow(row as Record<string, string>);
      const teacherName = `${roster.name} ${roster.surname}`.trim();
      const email = roster.email.toLowerCase();
      if (!teacherName || !z.email().safeParse(email).success || !roster.subjects.length || !roster.classes.length) {
        throw Error('Teacher roster row requires name, email, at least one subject and at least one class.');
      }
      const teacherId = roster.teacherId || `T-${email.split('@')[0]}`;
      const [existingTeacher] = await db.select().from(teachers).where(and(eq(teachers.organizationId,oid),eq(teachers.teacherId,teacherId)));
      const [existingUser] = existingTeacher ? await db.select().from(users).where(and(eq(users.id,existingTeacher.userId),eq(users.organizationId,oid))) : [null];
      let teacherRecord = existingTeacher;
      if (existingTeacher) {
        await db.transaction(async tx => {
          await tx.update(users).set({name: teacherName, email, updatedAt: new Date()}).where(and(eq(users.id,existingTeacher.userId),eq(users.organizationId,oid)));
          await tx.update(teachers).set({name: teacherName, email, department: roster.nationality || existingTeacher.department || '', updatedAt: new Date()}).where(eq(teachers.id,existingTeacher.id));
        });
        updated++;
      } else {
        const password=randomBytes(18).toString('base64url');
        const username=`t.${teacherId.toLowerCase().replace(/[^a-z0-9]/g,'')}.${oid.slice(0,6)}`;
        const passwordHash=await hash(password,12);
        teacherRecord = await db.transaction(async tx => {
          const [u] = await tx.insert(users).values({organizationId:oid,name:teacherName,email,username,passwordHash,role:'TEACHER'}).returning();
          const [t] = await tx.insert(teachers).values({organizationId:oid,userId:u.id,teacherId,name:teacherName,email,department:roster.nationality || ''}).returning();
          return t;
        });
        credentials.push({email,password});
        imported++;
      }
      for (const subjectName of roster.subjects) {
        const subject = allSubjects.find(x => x.name.toLowerCase() === subjectName.toLowerCase());
        if (!subject) continue;
        for (const className of roster.classes) {
          const classRecord = allClasses.find(x => x.name.toLowerCase() === className.toLowerCase());
          if (!classRecord) continue;
          const [existingAssignment] = await db.select().from(assignments).where(and(eq(assignments.organizationId,oid),eq(assignments.teacherId,teacherRecord.id),eq(assignments.classId,classRecord.id),eq(assignments.subjectId,subject.id),eq(assignments.academicYearId,classRecord.academicYearId)));
          if (existingAssignment) {
            await db.update(assignments).set({active:true,updatedAt:new Date()}).where(eq(assignments.id,existingAssignment.id));
          } else {
            await db.insert(assignments).values({organizationId:oid,teacherId:teacherRecord.id,classId:classRecord.id,subjectId:subject.id,academicYearId:classRecord.academicYearId,active:true});
            imported++;
          }
        }
      }
    } else {
      const teacherId=clean(row['Teacher ID']),name=clean(row['Teacher Name']),email=clean(row['Email']).toLowerCase(),department=clean(row['Department']);if(!teacherId||!name||!z.email().safeParse(email).success)throw Error('Invalid teacher ID, name or email.');
      const [old]=await db.select().from(teachers).where(and(eq(teachers.organizationId,oid),eq(teachers.teacherId,teacherId)));
      if(old){await db.transaction(async tx=>{await tx.update(users).set({name,email,updatedAt:new Date()}).where(and(eq(users.id,old.userId),eq(users.organizationId,oid)));await tx.update(teachers).set({name,department,email,updatedAt:new Date()}).where(eq(teachers.id,old.id));});updated++;}else{const password=randomBytes(18).toString('base64url');const username=`t.${teacherId.toLowerCase().replace(/[^a-z0-9]/g,'')}.${oid.slice(0,6)}`;const passwordHash=await hash(password,12);await db.transaction(async tx=>{const [u]=await tx.insert(users).values({organizationId:oid,name,email,username,passwordHash,role:'TEACHER'}).returning();await tx.insert(teachers).values({organizationId:oid,userId:u.id,teacherId,name,email,department});});credentials.push({email,password});imported++;}
    }
   }else{
    const email=clean(row['Teacher Email']).toLowerCase(),className=clean(row['Class']),subjectName=clean(row['Subject']),yearName=clean(row['Academic Year']);const t=allTeachers.find(x=>x.email.toLowerCase()===email),y=allYears.find(x=>x.name===yearName),c=allClasses.find(x=>x.name.toLowerCase()===className.toLowerCase()&&x.academicYearId===y?.id),s=allSubjects.find(x=>x.name.toLowerCase()===subjectName.toLowerCase());if(!t||!y||!c||!s)throw Error('Teacher, class, subject or year not found in this organization.');const [old]=await db.select().from(assignments).where(and(eq(assignments.organizationId,oid),eq(assignments.teacherId,t.id),eq(assignments.classId,c.id),eq(assignments.subjectId,s.id),eq(assignments.academicYearId,y.id)));const active=!['NO','FALSE','INACTIVE','0'].includes(clean(row['Active']).toUpperCase());if(old){await db.update(assignments).set({active,updatedAt:new Date()}).where(eq(assignments.id,old.id));updated++;}else{await db.insert(assignments).values({organizationId:oid,teacherId:t.id,classId:c.id,subjectId:s.id,academicYearId:y.id,active});imported++;}
   }
  }catch(e){const message=e instanceof Error?e.message:'';const known=['Invalid student ID, name or status.','Grade, class and academic year must exist and match.','Invalid teacher ID, name or email.','Teacher, class, subject or year not found in this organization.','Teacher roster row requires name, email, at least one subject and at least one class.'];errors.push({row:i+2,reason:known.includes(message)?message:'Could not import this row. Check duplicate IDs, email addresses and values.'});}
  await audit(oid,user.id,'DATA_IMPORT',input.kind,undefined,{imported,updated,errors:errors.length});return Response.json({imported,updated,skipped:errors.length,errors,credentials});
 }
 if(action==='create'){
  const type=z.enum(['year','term','grade','class','subject','student','teacher','assignment']).parse(raw.type);const d=raw.data; let entityId='';
  if(type==='year'){const x=z.object({name:z.string().min(3),startDate:z.string(),endDate:z.string()}).parse(d);const [r]=await db.insert(academicYears).values({...x,organizationId:oid}).returning();entityId=r.id;}
  if(type==='term'){const x=z.object({name:z.string().min(2),academicYearId:z.string(),startDate:z.string(),endDate:z.string()}).parse(d);if(!(await db.select().from(academicYears).where(and(eq(academicYears.id,x.academicYearId),eq(academicYears.organizationId,oid)))).length)throw new AppError('Invalid academic year.');const [r]=await db.insert(terms).values({...x,organizationId:oid}).returning();entityId=r.id;}
  if(type==='grade'){const x=z.object({name:z.string().min(2),orderIndex:z.coerce.number().int()}).parse(d);const [r]=await db.insert(grades).values({...x,organizationId:oid}).returning();entityId=r.id;}
  if(type==='class'){const x=z.object({name:z.string().min(1),gradeId:z.string(),academicYearId:z.string()}).parse(d);if(!(await db.select().from(grades).where(and(eq(grades.id,x.gradeId),eq(grades.organizationId,oid)))).length || !(await db.select().from(academicYears).where(and(eq(academicYears.id,x.academicYearId),eq(academicYears.organizationId,oid)))).length)throw new AppError('Invalid grade or year.');const [r]=await db.insert(classes).values({...x,organizationId:oid}).returning();entityId=r.id;}
  if(type==='subject'){const x=z.object({name:z.string().min(2),code:z.string().min(2)}).parse(d);const [r]=await db.insert(subjects).values({...x,organizationId:oid,code:x.code.toUpperCase()}).returning();entityId=r.id;}
  if(type==='student'){const x=z.object({studentId:z.string().min(1),firstName:z.string().min(1),lastName:z.string().min(1),gradeId:z.string(),classId:z.string(),academicYearId:z.string()}).parse(d);const [cl]=await db.select().from(classes).where(and(eq(classes.id,x.classId),eq(classes.organizationId,oid),eq(classes.gradeId,x.gradeId),eq(classes.academicYearId,x.academicYearId)));if(!cl)throw new AppError('Invalid class, grade or year.');const [r]=await db.insert(students).values({...x,fullName:`${x.firstName} ${x.lastName}`,organizationId:oid}).returning();entityId=r.id;}
  if(type==='teacher'){const x=z.object({teacherId:z.string().min(1),name:z.string().min(2),email:z.email(),department:z.string().optional(),username:z.string().min(3),password:z.string().min(12)}).parse(d);const passwordHash=await hash(x.password,12);entityId=await db.transaction(async tx=>{const [u]=await tx.insert(users).values({organizationId:oid,username:x.username.toLowerCase(),email:x.email.toLowerCase(),name:x.name,passwordHash,role:'TEACHER'}).returning();const [r]=await tx.insert(teachers).values({organizationId:oid,userId:u.id,teacherId:x.teacherId,name:x.name,email:x.email,department:x.department}).returning();return r.id;});}
  if(type==='assignment'){const x=z.object({teacherId:z.string(),classId:z.string(),subjectId:z.string(),academicYearId:z.string()}).parse(d);const [t,c,s,y]=await Promise.all([db.select().from(teachers).where(and(eq(teachers.id,x.teacherId),eq(teachers.organizationId,oid))),db.select().from(classes).where(and(eq(classes.id,x.classId),eq(classes.organizationId,oid),eq(classes.academicYearId,x.academicYearId))),db.select().from(subjects).where(and(eq(subjects.id,x.subjectId),eq(subjects.organizationId,oid))),db.select().from(academicYears).where(and(eq(academicYears.id,x.academicYearId),eq(academicYears.organizationId,oid)))]);if(!t.length||!c.length||!s.length||!y.length)throw new AppError('Teacher, class, subject or year is invalid.');const [r]=await db.insert(assignments).values({...x,organizationId:oid}).returning();entityId=r.id;}
  await audit(oid,user.id,`${type.toUpperCase()}_CREATED`,type,entityId);return Response.json({ok:true});
 }
 if(action==='updateEntity'){
  const type=z.enum(['year','term','grade','class','subject','student','teacher','assignment']).parse(raw.type);
  const d=raw.data; const id=z.string().uuid().parse(d.id);
  if(type==='student'){
    const x=z.object({firstName:z.string().min(1),lastName:z.string().min(1),studentId:z.string().min(1),gradeId:z.string(),classId:z.string(),academicYearId:z.string(),status:z.enum(['ACTIVE','INACTIVE'])}).parse(d);
    await db.update(students).set({...x,fullName:`${x.firstName} ${x.lastName}`,updatedAt:new Date()}).where(and(eq(students.id,id),eq(students.organizationId,oid)));
  }
  if(type==='teacher'){
    const x=z.object({name:z.string().min(2),email:z.email(),department:z.string().optional(),active:z.boolean()}).parse(d);
    const [t]=await db.select().from(teachers).where(and(eq(teachers.id,id),eq(teachers.organizationId,oid)));
    if(!t)throw new AppError('Teacher not found.',404);
    await db.transaction(async tx=>{
      await tx.update(teachers).set({...x,updatedAt:new Date()}).where(eq(teachers.id,id));
      await tx.update(users).set({name:x.name,email:x.email.toLowerCase(),active:x.active,updatedAt:new Date()}).where(and(eq(users.id,t.userId),eq(users.organizationId,oid)));
      if(!x.active)await tx.delete(sessions).where(eq(sessions.userId,t.userId));
    });
  }
  if(type==='class'){
    const x=z.object({name:z.string().min(1),active:z.boolean()}).parse(d);
    await db.update(classes).set({...x,updatedAt:new Date()}).where(and(eq(classes.id,id),eq(classes.organizationId,oid)));
  }
  if(type==='subject'){
    const x=z.object({name:z.string().min(2),code:z.string().min(2),active:z.boolean()}).parse(d);
    await db.update(subjects).set({...x,code:x.code.toUpperCase(),updatedAt:new Date()}).where(and(eq(subjects.id,id),eq(subjects.organizationId,oid)));
  }
  if(type==='grade'){
    const x=z.object({name:z.string().min(2),orderIndex:z.coerce.number().int(),active:z.boolean()}).parse(d);
    await db.update(grades).set(x).where(and(eq(grades.id,id),eq(grades.organizationId,oid)));
  }
  if(type==='year'){
    const x=z.object({name:z.string().min(3),startDate:z.string(),endDate:z.string(),active:z.boolean()}).parse(d);
    await db.update(academicYears).set(x).where(and(eq(academicYears.id,id),eq(academicYears.organizationId,oid)));
  }
  if(type==='term'){
    const x=z.object({name:z.string().min(2),startDate:z.string(),endDate:z.string(),active:z.boolean()}).parse(d);
    await db.update(terms).set(x).where(and(eq(terms.id,id),eq(terms.organizationId,oid)));
  }
  if(type==='assignment'){
    const x=z.object({active:z.boolean()}).parse(d);
    await db.update(assignments).set({...x,updatedAt:new Date()}).where(and(eq(assignments.id,id),eq(assignments.organizationId,oid)));
  }
  await audit(oid,user.id,`${type.toUpperCase()}_UPDATED`,type,id);
  return Response.json({ok:true});
 }
 if(action==='deleteEntity'){
  const type=z.enum(['assignment','term','grade','class','subject','student']).parse(raw.type);
  const id=z.string().uuid().parse(raw.id);
  if(type==='assignment'){
    await db.delete(assignments).where(and(eq(assignments.id,id),eq(assignments.organizationId,oid)));
  } else if(type==='student'){
    await db.update(students).set({status:'INACTIVE',updatedAt:new Date()}).where(and(eq(students.id,id),eq(students.organizationId,oid)));
  } else if(type==='class'){
    await db.update(classes).set({active:false,updatedAt:new Date()}).where(and(eq(classes.id,id),eq(classes.organizationId,oid)));
  } else if(type==='subject'){
    await db.update(subjects).set({active:false,updatedAt:new Date()}).where(and(eq(subjects.id,id),eq(subjects.organizationId,oid)));
  }
  await audit(oid,user.id,`${type.toUpperCase()}_DEACTIVATED`,type,id);
  return Response.json({ok:true});
 }
 if(action==='review'){
  const x=z.object({id:z.string(),status:z.enum(['UNDER_REVIEW','APPROVED','RETURNED','SUBMITTED']),comment:z.string().max(1000).optional()}).parse(raw.data);
  const [old]=await db.select().from(lessons).where(and(eq(lessons.id,x.id),eq(lessons.organizationId,oid)));if(!old)throw new AppError('Report not found.',404);
  const transition=reviewTransition(old.status,x.status,x.comment);
  await db.update(lessons).set({status:transition.status,reviewComment:x.comment?.trim()||null,reviewedAt:new Date(),reviewedBy:user.id,updatedAt:new Date()}).where(and(eq(lessons.id,x.id),eq(lessons.organizationId,oid),eq(lessons.status,old.status)));await audit(oid,user.id,transition.auditAction,'daily_lesson',x.id,{previousStatus:old.status,newStatus:transition.status,reason:x.comment});return Response.json({ok:true});
 }
 if(action==='settings'){
  const x=z.object({name:z.string().min(2).optional(),logoUrl:z.string().max(500).optional().nullable(),timezone:z.string().refine(isValidTimezone,'Timezone must be a valid IANA zone such as Africa/Bujumbura.'),excellentThreshold:z.coerce.number().min(1).max(3),goodThreshold:z.coerce.number().min(1).max(3),homeworkUsuallyThreshold:z.coerce.number().min(0).max(1),punctualityOccasionallyMax:z.coerce.number().min(0).max(1)}).parse(raw.data);
  await db.update(organizations).set({name:x.name||org.name,logoUrl:x.logoUrl!==undefined?x.logoUrl:org.logoUrl,timezone:x.timezone,updatedAt:new Date()}).where(eq(organizations.id,oid));
  await db.update(settings).set({excellentThreshold:x.excellentThreshold,goodThreshold:x.goodThreshold,homeworkUsuallyThreshold:x.homeworkUsuallyThreshold,punctualityOccasionallyMax:x.punctualityOccasionallyMax,version:(await db.select().from(settings).where(eq(settings.organizationId,oid)))[0].version+1,updatedAt:new Date()}).where(eq(settings.organizationId,oid));
  await audit(oid,user.id,'CONFIGURATION_CHANGED','settings',oid);
  return Response.json({ok:true});
 }
 if(action==='month'){
   const x=z.object({month:z.string().regex(MONTH_PATTERN),closed:z.boolean()}).parse(raw.data);
   await db.transaction(async tx=>{
    if(x.closed){const [rule]=await tx.select().from(settings).where(eq(settings.organizationId,oid));if(!rule)throw new AppError('Reporting settings are unavailable.');await tx.insert(monthlyRuleSnapshots).values({organizationId:oid,month:x.month,version:rule.version,excellentThreshold:rule.excellentThreshold,goodThreshold:rule.goodThreshold,homeworkUsuallyThreshold:rule.homeworkUsuallyThreshold,punctualityOccasionallyMax:rule.punctualityOccasionallyMax}).onConflictDoNothing();}
    await tx.insert(monthClosures).values({organizationId:oid,month:x.month,closed:x.closed}).onConflictDoUpdate({target:[monthClosures.organizationId,monthClosures.month],set:{closed:x.closed,updatedAt:new Date()}});
   });
   await audit(oid,user.id,x.closed?'MONTH_CLOSED':'MONTH_REOPENED','month',x.month);
   return Response.json({ok:true,month:x.month,closed:x.closed});
  }
  if(action==='adminSettings'){
    if(user.role!=='ADMIN')throw new AppError('Access denied.',403);
    const x=z.object({adminDateOverrideDays:z.number().int().min(MIN_REPORT_WINDOW_DAYS).max(MAX_REPORT_WINDOW_DAYS).optional(),adminCanOverrideFuture:z.boolean().optional(),adminOverrideRequiresReason:z.boolean().optional()}).parse(raw.data);
    const existing=await db.select().from(settings).where(eq(settings.organizationId,oid)).limit(1);
    if(existing.length){
     await db.update(settings).set({...x,updatedAt:new Date()}).where(eq(settings.organizationId,oid));
    }else{
     await db.insert(settings).values({organizationId:oid,...x}).onConflictDoNothing();
    }
    await audit(oid,user.id,'ADMIN_SETTINGS_UPDATED','settings',oid);return Response.json({ok:true});
  }
  throw new AppError('Unknown action.',404);
 }catch(e){return fail(e);}}


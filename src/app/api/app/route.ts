import { db } from '@/db';
import { organizations, users, sessions, teachers, students, grades, classes, subjects, academicYears, terms, assignments, lessons, records, auditLogs, settings, monthClosures, monthlyRuleSnapshots, behaviourObservations, clubs, clubTeachers, clubMembers, clubActivities, clubActivityRecords, monthlyEntries, monthlyStudentEntries, subjectStudents } from '@/db/schema';
import { and, eq, desc, count, like, gte, lt, lte, inArray, or, sql, not } from 'drizzle-orm';
import { hash } from 'bcryptjs';
import { z } from 'zod';
import { AppError, audit, checkOrigin, orgFor, requireUser, schoolToday, dateMinus, teacherFor, validLessonDate, reportDatePolicy, reportWindowLabel, MIN_REPORT_WINDOW_DAYS, MAX_REPORT_WINDOW_DAYS } from '@/lib/security';
import { saveMonthlyRecord } from '@/lib/lessons';
import { loadSubjectRoster } from '@/lib/roster';
import { groupReports, groupReportsByMonth } from '@/lib/reporting';
import { resolvePeriod, monthStart, monthEnd, periodSlug, MONTH_PATTERN } from '@/lib/period';
import { reviewTransition } from '@/lib/review';
import { normalizeTeacherAssignmentImportRow, canonicalSubjectName, gradeNameForClass, placeholderTeacherEmail, subjectCodeFor, subjectKey, usernameFromName } from '@/lib/importing';
import { logoUrlSchema } from '@/lib/logo';
import { passwordSchema, initialTeacherPassword } from '@/lib/passwordSchema';
import { monthlyEntryInput, entryObservations, isValidMonth, monthOverlapsYear, type MonthlyStudentRow } from '@/lib/monthly';
import { runTransaction } from '@/db';

export const dynamic='force-dynamic';
const fail=(e:unknown)=>{ if(e instanceof AppError){ console.error(`[api] AppError ${e.status}: ${e.message}`); return Response.json({error:e.message},{status:e.status}); } if(e instanceof z.ZodError){ console.error('[api] ZodError:', JSON.stringify(e.issues)); const detail=e.issues.slice(0,4).map(i=>`${i.path.join('.')||'value'}: ${i.message}`).join('; '); return Response.json({error:detail||'Invalid input'},{status:400}); } console.error('Application request failed',e); return Response.json({error:'The request could not be completed.'},{status:500}); };
const str=(v:unknown)=>z.string().max(200).parse(v);
const isValidTimezone=(tz:string)=>{try{new Intl.DateTimeFormat('en-US',{timeZone:tz});return true}catch{return false}};
// Roster size for completion rates: whole class until a subject roster exists for the pair.
const rosterCountSql=(classCol:unknown,subjectCol:unknown)=>sql<number>`CAST((select count(*) from ${students} where ${students.classId}=${classCol} and ${students.status}='ACTIVE' and (not exists (select 1 from ${subjectStudents} sx where sx.class_id=${classCol} and sx.subject_id=${subjectCol} and exists (select 1 from ${students} s2 where s2.id=sx.student_id and s2.class_id=${classCol} and s2.status='ACTIVE')) or ${students.id} in (select sy.student_id from ${subjectStudents} sy where sy.class_id=${classCol} and sy.subject_id=${subjectCol}))) AS INTEGER)`;
export async function GET(req:Request){try{
 const user=await requireUser(); const url=new URL(req.url); const view=url.searchParams.get('view')||'overview';
 if(user.role==='SUPER_ADMIN'){
  if(view==='audit')return Response.json({logs:await db.select().from(auditLogs).orderBy(desc(auditLogs.createdAt)).limit(100)});
   if(view==='organizations'){const orgs=await db.select().from(organizations).orderBy(organizations.name); const totals=await Promise.all(orgs.map(async o=>({ ...o,studentCount:(await db.select({n:count()}).from(students).where(eq(students.organizationId,o.id)))[0].n,teacherCount:(await db.select({n:count()}).from(teachers).where(eq(teachers.organizationId,o.id)))[0].n,classCount:(await db.select({n:count()}).from(classes).where(eq(classes.organizationId,o.id)))[0].n,admin:o.primaryAdminUserId?(await db.select({id:users.id,name:users.name,username:users.username,email:users.email}).from(users).where(eq(users.id,o.primaryAdminUserId)).limit(1))[0]||null:null }))); return Response.json({organizations:totals});}
  if(view==='overview'){const today=new Date().toISOString().slice(0,10);return Response.json({role:user.role,name:user.name,organization:'Platform',today,windowDays:14,minDate:dateMinus(today,14),counts:{students:0,teachers:0,classes:0,subjects:0,totalReports:0},statusCounts:{},assignedClasses:[],assignedSubjects:[],assignments:[],recent:[],organizations:(await db.select({n:count()}).from(organizations))[0].n});}
   return Response.json({role:user.role,name:user.name,organizations:(await db.select({n:count()}).from(organizations))[0].n});
 }
 const org=await orgFor(user); const teacher=user.role==='TEACHER'?await teacherFor(user):null;
 const myAssignment=teacher ? and(eq(assignments.organizationId,org.id),eq(assignments.teacherId,teacher.id),eq(assignments.active,true)) : eq(assignments.organizationId,org.id);
 if(view==='overview'){
  const today = schoolToday(org.timezone);
  const currentMonth = today.slice(0, 7);
  const nextMonthDate = new Date(`${currentMonth}-01T12:00:00Z`); nextMonthDate.setUTCMonth(nextMonthDate.getUTCMonth() + 1);
  const nextMonthStr = nextMonthDate.toISOString().slice(0, 10);
  const [st,tc,cl,su,ls,thisMonthReports,approvalStats,studentFollowUps,ms,thisMonthMonthly,monthlyApproval]=await Promise.all([
    db.select({n:count()}).from(students).where(and(eq(students.organizationId,org.id),eq(students.status,'ACTIVE'))),
    db.select({n:count()}).from(teachers).where(and(eq(teachers.organizationId,org.id),eq(teachers.active,true))),
    db.select({n:count()}).from(classes).where(and(eq(classes.organizationId,org.id),eq(classes.active,true))),
    db.select({n:count()}).from(subjects).where(and(eq(subjects.organizationId,org.id),eq(subjects.active,true))),
    db.select({status:lessons.status,n:count()}).from(lessons).where(and(eq(lessons.organizationId,org.id),teacher?eq(lessons.teacherId,teacher.id):undefined)).groupBy(lessons.status),
    db.select({n:count()}).from(lessons).where(and(eq(lessons.organizationId,org.id),teacher?eq(lessons.teacherId,teacher.id):undefined,gte(lessons.lessonDate,`${currentMonth}-01`),lt(lessons.lessonDate,nextMonthStr))),
    db.select({status:lessons.status,n:count()}).from(lessons).where(and(eq(lessons.organizationId,org.id),inArray(lessons.status,['SUBMITTED','UNDER_REVIEW','APPROVED','RETURNED']))).groupBy(lessons.status),
    db.select({n:count()}).from(behaviourObservations).where(and(eq(behaviourObservations.organizationId,org.id),eq(behaviourObservations.followUpRequired,true))),
    // §193: monthly entries count alongside legacy lesson rows so the dashboard reflects every report.
    db.select({status:monthlyEntries.status,n:count()}).from(monthlyEntries).where(and(eq(monthlyEntries.organizationId,org.id),teacher?eq(monthlyEntries.teacherId,teacher.id):undefined)).groupBy(monthlyEntries.status),
    db.select({n:count()}).from(monthlyEntries).where(and(eq(monthlyEntries.organizationId,org.id),teacher?eq(monthlyEntries.teacherId,teacher.id):undefined,eq(monthlyEntries.month,currentMonth))),
    db.select({status:monthlyEntries.status,n:count()}).from(monthlyEntries).where(and(eq(monthlyEntries.organizationId,org.id),inArray(monthlyEntries.status,['SUBMITTED','UNDER_REVIEW','APPROVED','RETURNED']))).groupBy(monthlyEntries.status)
  ]);
  const ass=await db.select({id:assignments.id,classId:classes.id,className:classes.name,subjectId:subjects.id,subjectName:subjects.name,academicYearId:academicYears.id,yearName:academicYears.name,teacherName:teachers.name}).from(assignments).innerJoin(classes,eq(classes.id,assignments.classId)).innerJoin(subjects,eq(subjects.id,assignments.subjectId)).innerJoin(academicYears,eq(academicYears.id,assignments.academicYearId)).innerJoin(teachers,eq(teachers.id,assignments.teacherId)).where(and(myAssignment,eq(classes.active,true),eq(subjects.active,true),eq(academicYears.active,true))).orderBy(classes.name,subjects.name).limit(200);
  const recent=(await db.select({id:lessons.id,lessonDate:lessons.lessonDate,topic:lessons.topic,status:lessons.status,className:classes.name,subjectName:subjects.name,teacherName:teachers.name,updatedAt:lessons.updatedAt}).from(lessons).innerJoin(classes,eq(classes.id,lessons.classId)).innerJoin(subjects,eq(subjects.id,lessons.subjectId)).innerJoin(teachers,eq(teachers.id,lessons.teacherId)).where(and(eq(lessons.organizationId,org.id),teacher?eq(lessons.teacherId,teacher.id):undefined)).orderBy(desc(lessons.updatedAt)).limit(8)).map(r=>({...r,kind:'lesson' as const}));
  const recentMonthly=(await db.select({id:monthlyEntries.id,lessonDate:sql<string>`${monthlyEntries.month}||'-01'`,topic:monthlyEntries.topics,status:monthlyEntries.status,className:classes.name,subjectName:subjects.name,teacherName:teachers.name,updatedAt:monthlyEntries.updatedAt}).from(monthlyEntries).innerJoin(classes,eq(classes.id,monthlyEntries.classId)).innerJoin(subjects,eq(subjects.id,monthlyEntries.subjectId)).innerJoin(teachers,eq(teachers.id,monthlyEntries.teacherId)).where(and(eq(monthlyEntries.organizationId,org.id),teacher?eq(monthlyEntries.teacherId,teacher.id):undefined)).orderBy(desc(monthlyEntries.updatedAt)).limit(8)).map(r=>({...r,kind:'monthly' as const}));
  const mergedRecent=[...recent,...recentMonthly].sort((a,b)=>new Date(b.updatedAt).getTime()-new Date(a.updatedAt).getTime()).slice(0,8);
  const assignedClasses=[...new Set(ass.map(a=>a.classId))]; const assignedSubjects=[...new Set(ass.map(a=>a.subjectId))]; const visibleStudents=teacher&&assignedClasses.length?(await db.select({n:count()}).from(students).where(and(eq(students.organizationId,org.id),eq(students.status,'ACTIVE'),inArray(students.classId,assignedClasses))))[0].n:0;
  const statusMap=Object.fromEntries(ls.map(r=>[r.status,Number(r.n)]));
  for(const r of ms) statusMap[r.status]=(statusMap[r.status]||0)+Number(r.n);
  const totalReports=Object.values(statusMap).reduce((a,b)=>a+b,0);
  const mergedApproval=new Map<string,number>();
  for(const r of [...approvalStats,...monthlyApproval]) mergedApproval.set(r.status,(mergedApproval.get(r.status)||0)+Number(r.n));
  const totalReviewed=[...mergedApproval.values()].reduce((acc,curr)=>acc+curr,0);
  const approvedCount=mergedApproval.get('APPROVED')||0;
  const approvalRate=totalReviewed>0?Math.round((approvedCount/totalReviewed)*100):100;
  const teacherMonthClasses=teacher?(await Promise.all([
    db.selectDistinct({id:lessons.classId}).from(lessons).where(and(eq(lessons.organizationId,org.id),eq(lessons.teacherId,teacher.id),gte(lessons.lessonDate,`${currentMonth}-01`),lt(lessons.lessonDate,nextMonthStr))),
    db.selectDistinct({id:monthlyEntries.classId}).from(monthlyEntries).where(and(eq(monthlyEntries.organizationId,org.id),eq(monthlyEntries.teacherId,teacher.id),eq(monthlyEntries.month,currentMonth)))
  ])).reduce((set,r)=>{for(const x of r)set.add(x.id);return set;},new Set<string>()).size:0;
  const teacherMonthSubjects=teacher?(await Promise.all([
    db.selectDistinct({id:lessons.subjectId}).from(lessons).where(and(eq(lessons.organizationId,org.id),eq(lessons.teacherId,teacher.id),gte(lessons.lessonDate,`${currentMonth}-01`),lt(lessons.lessonDate,nextMonthStr))),
    db.selectDistinct({id:monthlyEntries.subjectId}).from(monthlyEntries).where(and(eq(monthlyEntries.organizationId,org.id),eq(monthlyEntries.teacherId,teacher.id),eq(monthlyEntries.month,currentMonth)))
  ])).reduce((set,r)=>{for(const x of r)set.add(x.id);return set;},new Set<string>()).size:0;
   const reportPolicy=await reportDatePolicy(org.id);
  return Response.json({role:user.role,name:user.name,organization:org.name,today,windowDays:reportPolicy.days,minDate:dateMinus(today,reportPolicy.days),counts:{students:teacher?visibleStudents:st[0].n,teachers:teacher?1:tc[0].n,classes:teacher?assignedClasses.length:cl[0].n,subjects:teacher?assignedSubjects.length:su[0].n,reports:statusMap,totalReports,reportsThisMonth:Number(thisMonthReports[0]?.n||0)+Number(thisMonthMonthly[0]?.n||0),approvalRate,followUpsRequired:Number(studentFollowUps[0]?.n||0),teacherMonthClasses,teacherMonthSubjects},statusCounts:statusMap,assignments:ass,recent:mergedRecent});
 }
 if(view==='reference'){
  const [years,ts,gs,cs,ss,teach,ass,allStudents]=await Promise.all([
    db.select().from(academicYears).where(eq(academicYears.organizationId,org.id)).orderBy(academicYears.name),
    db.select().from(terms).where(eq(terms.organizationId,org.id)).orderBy(terms.startDate),
    db.select().from(grades).where(eq(grades.organizationId,org.id)).orderBy(grades.orderIndex),
    db.select().from(classes).where(eq(classes.organizationId,org.id)).orderBy(classes.name),
    db.select().from(subjects).where(eq(subjects.organizationId,org.id)).orderBy(subjects.name),
    user.role==='ADMIN'?db.select({id:teachers.id,name:teachers.name,email:teachers.email,teacherId:teachers.teacherId,active:teachers.active,username:users.username}).from(teachers).innerJoin(users,eq(users.id,teachers.userId)).where(eq(teachers.organizationId,org.id)).orderBy(teachers.name):Promise.resolve([]),
    db.select().from(assignments).where(myAssignment),
    user.role==='ADMIN'?db.select().from(students).where(eq(students.organizationId,org.id)).orderBy(students.fullName).limit(2000):Promise.resolve([])
  ]);
   const reportPolicy=await reportDatePolicy(org.id);
  return Response.json({years,terms:ts,grades:user.role==='TEACHER'?gs.filter(g=>cs.some(c=>ass.some(a=>a.classId===c.id)&&c.gradeId===g.id)):gs,classes:user.role==='TEACHER'?cs.filter(c=>ass.some(a=>a.classId===c.id)):cs,subjects:user.role==='TEACHER'?ss.filter(s=>ass.some(a=>a.subjectId===s.id)):ss,teachers:teach,assignments:ass,students:allStudents,today:schoolToday(org.timezone),windowDays:reportPolicy.days,allowFutureDates:user.role==='ADMIN'&&reportPolicy.allowFuture,minDate:dateMinus(schoolToday(org.timezone),reportPolicy.days),organization:{id:org.id,name:org.name,timezone:org.timezone,code:org.code,logoUrl:org.logoUrl,domain:org.domain}});
 }
 if(view==='students'){
  const classId=url.searchParams.get('classId');const search=(url.searchParams.get('search')||'').slice(0,80);const roster=url.searchParams.get('roster')==='1';
  const page=z.coerce.number().int().min(0).max(10000).parse(url.searchParams.get('page')||'0');
  if(teacher){if(!classId||!(await db.select({id:assignments.id}).from(assignments).where(and(myAssignment,eq(assignments.classId,classId))).limit(1)).length)throw new AppError('Class access denied.',403);}
  const rows=await db.select({id:students.id,studentId:students.studentId,fullName:students.fullName,firstName:students.firstName,lastName:students.lastName,classId:students.classId,gradeId:students.gradeId,academicYearId:students.academicYearId,status:students.status,className:classes.name}).from(students).innerJoin(classes,eq(classes.id,students.classId)).where(and(eq(students.organizationId,org.id),classId?eq(students.classId,classId):undefined,teacher?eq(students.status,'ACTIVE'):undefined,search?or(like(students.fullName,`%${search}%`),like(students.studentId,`%${search}%`)):undefined)).orderBy(students.fullName,students.id).limit(roster?151:51).offset(roster?0:page*50);
  if(roster&&rows.length>150)throw new AppError('Class roster exceeds the 150-student form limit. Contact your administrator.');
  return Response.json({students:roster?rows:rows.slice(0,50),page,hasMore:!roster&&rows.length>50});
 }
 if(view==='studentProfile'){
   if(user.role!=='ADMIN')throw new AppError('Student profile access denied.',403);
   const id=z.string().uuid().parse(url.searchParams.get('id'));
   const [student]=await db.select({id:students.id,studentId:students.studentId,fullName:students.fullName,status:students.status,className:classes.name}).from(students).innerJoin(classes,eq(classes.id,students.classId)).where(and(eq(students.id,id),eq(students.organizationId,org.id))).limit(1);
   if(!student)throw new AppError('Student not found.',404);
    const timeline=await db.select({lessonDate:lessons.lessonDate,subject:sql<string>`coalesce(${lessons.subjectNameSnapshot}, ${subjects.name})`,topic:lessons.topic,attendance:records.attendanceStatus,performance:records.performance,conduct:records.conduct,punctuality:records.punctuality,homework:records.homework,participation:records.participation,comment:records.comment,status:lessons.status}).from(records).innerJoin(lessons,eq(lessons.id,records.monthlyLessonId)).innerJoin(subjects,eq(subjects.id,lessons.subjectId)).where(and(eq(records.studentId,id),eq(records.organizationId,org.id),eq(lessons.organizationId,org.id))).orderBy(desc(lessons.lessonDate)).limit(100);
    // §193: one monthly row per subject on the student timeline.
    const monthlyTimeline=(await db.select({month:monthlyEntries.month,subject:sql<string>`coalesce(${monthlyEntries.subjectNameSnapshot}, ${subjects.name})`,topic:monthlyEntries.topics,status:monthlyEntries.status,punctuality:monthlyStudentEntries.punctuality,performance:monthlyStudentEntries.performance,conduct:monthlyStudentEntries.conduct,homework:monthlyStudentEntries.homework,participation:monthlyStudentEntries.participation,comment:monthlyStudentEntries.comment}).from(monthlyStudentEntries).innerJoin(monthlyEntries,eq(monthlyEntries.id,monthlyStudentEntries.monthlyEntryId)).innerJoin(subjects,eq(subjects.id,monthlyEntries.subjectId)).where(and(eq(monthlyStudentEntries.studentId,id),eq(monthlyEntries.organizationId,org.id),inArray(monthlyEntries.status,['SUBMITTED','UNDER_REVIEW','APPROVED']))).orderBy(desc(monthlyEntries.month)).limit(100)).map(r=>{
      // §193 v3: pass the selected punctuality category through unchanged; the
      // legacy attendance badge follows the category (absent / late / present).
      const attendance=r.punctuality?.includes('ABSENT')?'ABSENT':r.punctuality?.includes('LATE')?'LATE':'PRESENT';
      return {lessonDate:monthEnd(r.month),subject:r.subject,topic:r.topic||'Monthly record',attendance,performance:r.performance,conduct:r.conduct,punctuality:r.punctuality,homework:r.homework,participation:r.participation,comment:r.comment,status:r.status};
      });
    const mergedTimeline=[...timeline,...monthlyTimeline].sort((a,b)=>String(b.lessonDate).localeCompare(String(a.lessonDate))).slice(0,100);
    const significant=await db.select({id:behaviourObservations.id,date:behaviourObservations.date,category:behaviourObservations.category,severity:behaviourObservations.severity,description:behaviourObservations.description,actionTaken:behaviourObservations.actionTaken,followUpRequired:behaviourObservations.followUpRequired}).from(behaviourObservations).where(and(eq(behaviourObservations.organizationId,org.id),eq(behaviourObservations.studentId,id))).orderBy(desc(behaviourObservations.date)).limit(100);
    return Response.json({student,timeline:mergedTimeline,significant});
  }
  if(view==='reports'){
   const legacyMonth=url.searchParams.get('month');
   const rangeFrom=url.searchParams.get('from')?z.iso.date().parse(url.searchParams.get('from')):legacyMonth?monthStart(legacyMonth):null;
   const rangeTo=url.searchParams.get('to')?z.iso.date().parse(url.searchParams.get('to')):legacyMonth?monthEnd(legacyMonth):rangeFrom;
   const statusFilter=url.searchParams.get('status');
   const dateFilter=url.searchParams.get('date');
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
    recordsCount:sql<number>`CAST((select count(*) from ${records} where ${records.monthlyLessonId}=${lessons.id}) AS INTEGER)`,
    rosterCount:rosterCountSql(lessons.classId,lessons.subjectId)
   }).from(lessons)
    .innerJoin(classes,eq(classes.id,lessons.classId))
    .innerJoin(subjects,eq(subjects.id,lessons.subjectId))
    .innerJoin(teachers,eq(teachers.id,lessons.teacherId))
    .where(and(
      eq(lessons.organizationId,org.id),
      teacher?eq(lessons.teacherId,teacher.id):undefined,
      statusFilter?eq(lessons.status,str(statusFilter)):undefined,
      url.searchParams.get('classId')?eq(lessons.classId,str(url.searchParams.get('classId'))):undefined,
      url.searchParams.get('subjectId')?eq(lessons.subjectId,str(url.searchParams.get('subjectId'))):undefined,
      url.searchParams.get('teacherId')?eq(lessons.teacherId,str(url.searchParams.get('teacherId'))):undefined,
      dateFilter?eq(lessons.lessonDate,z.iso.date().parse(dateFilter)):undefined,
      rangeFrom?gte(lessons.lessonDate,rangeFrom):undefined,
      rangeTo?lte(lessons.lessonDate,rangeTo):undefined
    ))
    .orderBy(desc(lessons.lessonDate),desc(lessons.updatedAt))
    .limit(100);
  type ReportRow=(typeof rawReports)[number]&{kind:'lesson'|'monthly';completionRate:number;month?:string};
  const rows:ReportRow[]=rawReports.map(r=>({
    ...r,
    kind:'lesson' as const,
    completionRate:r.rosterCount>0?Math.min(100,Math.round((r.recordsCount/r.rosterCount)*100)):100
  }));
  // §193 monthly records appear in the same history/review list (a single-date filter matches the month it falls in).
  {
   const monthHeaders=await db.select({entry:monthlyEntries,className:classes.name,subjectName:subjects.name,teacherName:teachers.name,rosterCount:rosterCountSql(monthlyEntries.classId,monthlyEntries.subjectId),recordsCount:sql<number>`CAST((select count(*) from ${monthlyStudentEntries} where ${monthlyStudentEntries.monthlyEntryId}=${monthlyEntries.id}) AS INTEGER)`}).from(monthlyEntries).innerJoin(classes,eq(classes.id,monthlyEntries.classId)).innerJoin(subjects,eq(subjects.id,monthlyEntries.subjectId)).innerJoin(teachers,eq(teachers.id,monthlyEntries.teacherId)).where(and(eq(monthlyEntries.organizationId,org.id),teacher?eq(monthlyEntries.teacherId,teacher.id):undefined,statusFilter?eq(monthlyEntries.status,str(statusFilter)):undefined,url.searchParams.get('classId')?eq(monthlyEntries.classId,str(url.searchParams.get('classId'))):undefined,url.searchParams.get('subjectId')?eq(monthlyEntries.subjectId,str(url.searchParams.get('subjectId'))):undefined,url.searchParams.get('teacherId')?eq(monthlyEntries.teacherId,str(url.searchParams.get('teacherId'))):undefined)).orderBy(desc(monthlyEntries.month),desc(monthlyEntries.updatedAt)).limit(200);
   for(const h of monthHeaders){
    const monthStartsAt=`${h.entry.month}-01`;
    if(dateFilter){ if(h.entry.month!==dateFilter.slice(0,7))continue; }
    else if((rangeFrom&&monthEnd(h.entry.month)<rangeFrom)||(rangeTo&&monthStartsAt>rangeTo))continue;
    rows.push({id:h.entry.id,lessonDate:monthStartsAt,topic:h.entry.topics||'Monthly record',status:h.entry.status,classId:h.entry.classId,subjectId:h.entry.subjectId,className:h.className,subjectName:h.subjectName,teacherName:h.entry.teacherNameSnapshot||h.teacherName,submittedAt:h.entry.submittedAt,updatedAt:h.entry.updatedAt,reviewComment:h.entry.reviewComment,recordsCount:h.recordsCount,rosterCount:h.rosterCount,kind:'monthly' as const,month:h.entry.month,completionRate:h.rosterCount>0?Math.min(100,Math.round((h.recordsCount/h.rosterCount)*100)):100});
   }
   rows.sort((a,b)=>String(b.lessonDate).localeCompare(String(a.lessonDate))||new Date(b.updatedAt).getTime()-new Date(a.updatedAt).getTime());
  }
  return Response.json({reports:rows.slice(0,100)});
 }
  if(view==='monthlyLesson'){
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
   }).from(records).innerJoin(students, eq(students.id, records.studentId)).where(and(eq(records.organizationId,org.id),eq(records.monthlyLessonId,id))).orderBy(students.fullName);
  return Response.json({lesson,records:lessonRecords});
 }
  if(view==='monthly'){
   const period=resolvePeriod(url.searchParams, schoolToday(org.timezone)); const classId=url.searchParams.get('classId'); const subjectId=url.searchParams.get('subjectId'); const studentId=url.searchParams.get('studentId'); const academicYearId=url.searchParams.get('academicYearId'); const termId=url.searchParams.get('termId'); const gradeId=url.searchParams.get('gradeId'); const teacherId=url.searchParams.get('teacherId');
   if(teacher){if(!classId || !subjectId || !(await db.select({id:assignments.id}).from(assignments).where(and(myAssignment,eq(assignments.classId,classId),eq(assignments.subjectId,subjectId))).limit(1)).length) throw new AppError('Report access denied.',403);}
   const [current]=await db.select().from(settings).where(eq(settings.organizationId,org.id));
   const rules=current;
   const allTerms=await db.select({id:terms.id,startDate:terms.startDate,endDate:terms.endDate}).from(terms).where(eq(terms.organizationId,org.id));
   // §193 monthly records take precedence: a (class, subject, month) with a monthly entry is never also read from legacy lesson rows.
   const entryHeader=await db.select({entry:monthlyEntries,className:classes.name,subjectName:subjects.name,teacherName:teachers.name}).from(monthlyEntries).innerJoin(classes,eq(classes.id,monthlyEntries.classId)).innerJoin(subjects,eq(subjects.id,monthlyEntries.subjectId)).innerJoin(teachers,eq(teachers.id,monthlyEntries.teacherId)).where(and(eq(monthlyEntries.organizationId,org.id),inArray(monthlyEntries.status,['SUBMITTED','UNDER_REVIEW','APPROVED']),gte(monthlyEntries.month,period.months[0]||period.from.slice(0,7)),lte(monthlyEntries.month,period.months[period.months.length-1]||period.to.slice(0,7)),classId?eq(monthlyEntries.classId,classId):undefined,subjectId?eq(monthlyEntries.subjectId,subjectId):undefined,academicYearId?eq(monthlyEntries.academicYearId,academicYearId):undefined,gradeId?eq(classes.gradeId,gradeId):undefined,teacherId?eq(monthlyEntries.teacherId,teacherId):undefined)).limit(600);
   const termForMonth=(month:string)=>allTerms.find(t=>t.startDate<=monthEnd(month)&&t.endDate>=monthStart(month));
   const monthlyHeaders=entryHeader.filter(h=>!termId||(termForMonth(h.entry.month)?.id===termId));
   const monthlyKeys=new Set(monthlyHeaders.map(h=>`${h.entry.classId}|${h.entry.subjectId}|${h.entry.month}`));
   const legacyLessonRows=await db.select({classId:lessons.classId,subjectId:lessons.subjectId,lessonDate:lessons.lessonDate,topic:lessons.topic,lessonId:lessons.id,status:lessons.status,studentId:students.id,studentName:sql<string>`coalesce(${records.studentNameSnapshot}, ${students.fullName})`,studentCode:sql<string>`coalesce(${records.studentCodeSnapshot}, ${students.studentId})`,className:sql<string>`coalesce(${lessons.classNameSnapshot}, ${classes.name})`,subjectName:sql<string>`coalesce(${lessons.subjectNameSnapshot}, ${subjects.name})`,teacherName:sql<string>`coalesce(${lessons.teacherNameSnapshot}, ${teachers.name})`,attendance:records.attendanceStatus,performance:records.performance,conduct:records.conduct,punctuality:records.punctuality,homework:records.homework,participation:records.participation,comment:records.comment}).from(records).innerJoin(lessons,eq(lessons.id,records.monthlyLessonId)).innerJoin(students,eq(students.id,records.studentId)).innerJoin(classes,eq(classes.id,lessons.classId)).innerJoin(subjects,eq(subjects.id,lessons.subjectId)).innerJoin(teachers,eq(teachers.id,lessons.teacherId)).where(and(eq(lessons.organizationId,org.id),inArray(lessons.status,['SUBMITTED','UNDER_REVIEW','APPROVED']),gte(lessons.lessonDate,period.from),lte(lessons.lessonDate,period.to),classId?eq(lessons.classId,classId):undefined,subjectId?eq(lessons.subjectId,subjectId):undefined,studentId?eq(students.id,studentId):undefined,academicYearId?eq(lessons.academicYearId,academicYearId):undefined,termId?eq(lessons.termId,termId):undefined,gradeId?eq(classes.gradeId,gradeId):undefined,teacherId?eq(lessons.teacherId,teacherId):undefined)).orderBy(students.fullName,subjects.name,lessons.lessonDate).limit(20001);
   const legacyLessonData=legacyLessonRows.filter(r=>!monthlyKeys.has(`${r.classId}|${r.subjectId}|${r.lessonDate.slice(0,7)}`));
   let monthlyData:(typeof legacyLessonData)[number][]=[];
   if(monthlyHeaders.length){
    const headerIds=monthlyHeaders.map(h=>h.entry.id);
      const studentRows=await db.select({monthlyEntryId:monthlyStudentEntries.monthlyEntryId,studentId:students.id,studentName:sql<string>`coalesce(${monthlyStudentEntries.studentNameSnapshot}, ${students.fullName})`,studentCode:sql<string>`coalesce(${monthlyStudentEntries.studentCodeSnapshot}, ${students.studentId})`,punctuality:monthlyStudentEntries.punctuality,performance:monthlyStudentEntries.performance,participation:monthlyStudentEntries.participation,homework:monthlyStudentEntries.homework,conduct:monthlyStudentEntries.conduct,comment:monthlyStudentEntries.comment}).from(monthlyStudentEntries).innerJoin(students,eq(students.id,monthlyStudentEntries.studentId)).where(inArray(monthlyStudentEntries.monthlyEntryId,headerIds)).orderBy(students.fullName).limit(20000);
    const rowsByEntry=new Map<string,MonthlyStudentRow[]>();
    for(const row of studentRows){const list=rowsByEntry.get(row.monthlyEntryId)||[];list.push(row);rowsByEntry.set(row.monthlyEntryId,list);}
    for(const h of monthlyHeaders){
     const rows=(rowsByEntry.get(h.entry.id)||[]).filter(r=>!studentId||r.studentId===studentId);
     const observations=entryObservations(h.entry,rows as MonthlyStudentRow[],h.className,h.subjectName,h.teacherName,rules);
     monthlyData.push(...observations.map(o=>({classId:h.entry.classId,subjectId:h.entry.subjectId,...o,teacherName:o.teacherName||h.teacherName})));
    }
   }
   const data=[...legacyLessonData,...monthlyData].sort((a,b)=>a.studentName.localeCompare(b.studentName)||a.subjectName.localeCompare(b.subjectName)||a.lessonDate.localeCompare(b.lessonDate));
   if(data.length>20000) throw new AppError(`This period covers more than 20,000 observations. Shorten the date range or select a class or subject.`,413);
   const closedMonths=(await db.select({month:monthClosures.month}).from(monthClosures).where(and(eq(monthClosures.organizationId,org.id),eq(monthClosures.closed,true),inArray(monthClosures.month,period.months)))).map(r=>r.month);
   return Response.json({data,summaries:groupReports(data,rules),comparison:groupReportsByMonth(data,rules),rules,organization:org.name,period,closedMonths,coverage:{observations:data.length,lessonReports:new Set(data.map(r=>r.lessonId)).size,students:new Set(data.map(r=>r.studentId)).size}});
  }
  if(view==='dataQuality'){
   if(user.role!=='ADMIN') throw new AppError('Access denied.',403);
   const period=resolvePeriod(url.searchParams, schoolToday(org.timezone));
   const periodMonths=period.months.length?period.months:[period.from.slice(0,7)];
   const [drafts,returned,activeStudents,studentsWithRecords,activeSubjects,subjectsWithRecords,monthlyDrafts,monthlyReturned,monthlyStudentsWithRecords,monthlySubjectsWithRecords]=await Promise.all([
    db.select({id:lessons.id,lessonDate:lessons.lessonDate,topic:lessons.topic,className:classes.name,subjectName:subjects.name,teacherName:teachers.name,updatedAt:lessons.updatedAt,recordsCount:sql<number>`CAST((select count(*) from ${records} where ${records.monthlyLessonId}=${lessons.id}) AS INTEGER)`,rosterCount:rosterCountSql(lessons.classId,lessons.subjectId)}).from(lessons).innerJoin(classes,eq(classes.id,lessons.classId)).innerJoin(subjects,eq(subjects.id,lessons.subjectId)).innerJoin(teachers,eq(teachers.id,lessons.teacherId)).where(and(eq(lessons.organizationId,org.id),eq(lessons.status,'DRAFT'),gte(lessons.lessonDate,period.from),lte(lessons.lessonDate,period.to))).orderBy(desc(lessons.updatedAt)).limit(50),
    db.select({id:lessons.id,lessonDate:lessons.lessonDate,topic:lessons.topic,className:classes.name,subjectName:subjects.name,teacherName:teachers.name,reviewComment:lessons.reviewComment,updatedAt:lessons.updatedAt}).from(lessons).innerJoin(classes,eq(classes.id,lessons.classId)).innerJoin(subjects,eq(subjects.id,lessons.subjectId)).innerJoin(teachers,eq(teachers.id,lessons.teacherId)).where(and(eq(lessons.organizationId,org.id),eq(lessons.status,'RETURNED'),gte(lessons.lessonDate,period.from),lte(lessons.lessonDate,period.to))).orderBy(desc(lessons.updatedAt)).limit(50),
    db.select({id:students.id,studentId:students.studentId,fullName:students.fullName,className:classes.name}).from(students).innerJoin(classes,eq(classes.id,students.classId)).where(and(eq(students.organizationId,org.id),eq(students.status,'ACTIVE'))),
    db.selectDistinct({studentId:records.studentId}).from(records).innerJoin(lessons,eq(lessons.id,records.monthlyLessonId)).where(and(eq(lessons.organizationId,org.id),gte(lessons.lessonDate,period.from),lte(lessons.lessonDate,period.to))),
    db.select({id:subjects.id,name:subjects.name,code:subjects.code}).from(subjects).where(and(eq(subjects.organizationId,org.id),eq(subjects.active,true))),
    db.selectDistinct({subjectId:lessons.subjectId}).from(lessons).where(and(eq(lessons.organizationId,org.id),gte(lessons.lessonDate,period.from),lte(lessons.lessonDate,period.to))),
    // §193 monthly drafts / returns join the audit lists.
    db.select({id:monthlyEntries.id,lessonDate:sql<string>`${monthlyEntries.month}`,topic:monthlyEntries.topics,className:classes.name,subjectName:subjects.name,teacherName:teachers.name,updatedAt:monthlyEntries.updatedAt,recordsCount:sql<number>`CAST((select count(*) from ${monthlyStudentEntries} where ${monthlyStudentEntries.monthlyEntryId}=${monthlyEntries.id}) AS INTEGER)`,rosterCount:rosterCountSql(monthlyEntries.classId,monthlyEntries.subjectId)}).from(monthlyEntries).innerJoin(classes,eq(classes.id,monthlyEntries.classId)).innerJoin(subjects,eq(subjects.id,monthlyEntries.subjectId)).innerJoin(teachers,eq(teachers.id,monthlyEntries.teacherId)).where(and(eq(monthlyEntries.organizationId,org.id),eq(monthlyEntries.status,'DRAFT'),inArray(monthlyEntries.month,periodMonths))).orderBy(desc(monthlyEntries.updatedAt)).limit(50),
    db.select({id:monthlyEntries.id,lessonDate:sql<string>`${monthlyEntries.month}`,topic:monthlyEntries.topics,className:classes.name,subjectName:subjects.name,teacherName:teachers.name,reviewComment:monthlyEntries.reviewComment,updatedAt:monthlyEntries.updatedAt}).from(monthlyEntries).innerJoin(classes,eq(classes.id,monthlyEntries.classId)).innerJoin(subjects,eq(subjects.id,monthlyEntries.subjectId)).innerJoin(teachers,eq(teachers.id,monthlyEntries.teacherId)).where(and(eq(monthlyEntries.organizationId,org.id),eq(monthlyEntries.status,'RETURNED'),inArray(monthlyEntries.month,periodMonths))).orderBy(desc(monthlyEntries.updatedAt)).limit(50),
    db.selectDistinct({studentId:monthlyStudentEntries.studentId}).from(monthlyStudentEntries).innerJoin(monthlyEntries,eq(monthlyEntries.id,monthlyStudentEntries.monthlyEntryId)).where(and(eq(monthlyEntries.organizationId,org.id),inArray(monthlyEntries.month,periodMonths))),
    db.selectDistinct({subjectId:monthlyEntries.subjectId}).from(monthlyEntries).where(and(eq(monthlyEntries.organizationId,org.id),inArray(monthlyEntries.month,periodMonths)))
   ]);
   const recordedStudentIds=new Set([...studentsWithRecords,...monthlyStudentsWithRecords].map(r=>r.studentId));
   const studentsWithNoRecords=activeStudents.filter(s=>!recordedStudentIds.has(s.id));
   const recordedSubjectIds=new Set([...subjectsWithRecords,...monthlySubjectsWithRecords].map(r=>r.subjectId));
   const subjectsWithNoRecords=activeSubjects.filter(s=>!recordedSubjectIds.has(s.id));
   const withKind=<T extends {id:string}>(rows:T[],kind:'lesson'|'monthly')=>rows.map(r=>({...r,kind}));
   const allDrafts=[...withKind(drafts,'lesson'),...withKind(monthlyDrafts,'monthly')].sort((a,b)=>new Date(b.updatedAt).getTime()-new Date(a.updatedAt).getTime()).slice(0,50);
   const allReturned=[...withKind(returned,'lesson'),...withKind(monthlyReturned,'monthly')].sort((a,b)=>new Date(b.updatedAt).getTime()-new Date(a.updatedAt).getTime()).slice(0,50);
   return Response.json({period,drafts:allDrafts.map(d=>({...d,completionRate:d.rosterCount>0?Math.min(100,Math.round((d.recordsCount/d.rosterCount)*100)):100})),returned:allReturned,studentsWithNoRecords:studentsWithNoRecords.slice(0,50),studentsWithNoRecordsCount:studentsWithNoRecords.length,subjectsWithNoRecords,activeStudentsCount:activeStudents.length,recordedStudentsCount:recordedStudentIds.size});
  }
  if(view==='trends'){
   // §193 student trends back the admin-only profile modal: teachers must not read
   // report data for subjects or classes outside their own assignments.
   if(user.role!=='ADMIN')throw new AppError('Access denied.',403);
   const studentId=z.string().uuid().parse(url.searchParams.get('studentId'));
  const [stu]=await db.select().from(students).where(and(eq(students.id,studentId),eq(students.organizationId,org.id)));
  if(!stu)throw new AppError('Student not found.',404);
  const studentRows=await db.select({lessonDate:lessons.lessonDate,topic:lessons.topic,lessonId:lessons.id,status:lessons.status,studentId:students.id,studentName:sql<string>`coalesce(${records.studentNameSnapshot}, ${students.fullName})`,studentCode:sql<string>`coalesce(${records.studentCodeSnapshot}, ${students.studentId})`,className:sql<string>`coalesce(${lessons.classNameSnapshot}, ${classes.name})`,subjectName:sql<string>`coalesce(${lessons.subjectNameSnapshot}, ${subjects.name})`,attendance:records.attendanceStatus,performance:records.performance,conduct:records.conduct,punctuality:records.punctuality,homework:records.homework,participation:records.participation,comment:records.comment}).from(records).innerJoin(lessons,eq(lessons.id,records.monthlyLessonId)).innerJoin(students,eq(students.id,records.studentId)).innerJoin(classes,eq(classes.id,lessons.classId)).innerJoin(subjects,eq(subjects.id,lessons.subjectId)).where(and(eq(lessons.organizationId,org.id),eq(records.studentId,studentId),inArray(lessons.status,['SUBMITTED','UNDER_REVIEW','APPROVED']))).orderBy(lessons.lessonDate);
  const [currentSettings]=await db.select().from(settings).where(eq(settings.organizationId,org.id));
  const {calculateStudentTrends}=await import('@/lib/reporting');
  // §193: monthly entries expand into the same observation shape so trends cover both report sources.
  const monthlyRows=await db.select({monthlyEntryId:monthlyStudentEntries.monthlyEntryId,studentId:students.id,studentName:sql<string>`coalesce(${monthlyStudentEntries.studentNameSnapshot}, ${students.fullName})`,studentCode:sql<string>`coalesce(${monthlyStudentEntries.studentCodeSnapshot}, ${students.studentId})`,punctuality:monthlyStudentEntries.punctuality,performance:monthlyStudentEntries.performance,participation:monthlyStudentEntries.participation,homework:monthlyStudentEntries.homework,conduct:monthlyStudentEntries.conduct,comment:monthlyStudentEntries.comment}).from(monthlyStudentEntries).innerJoin(students,eq(students.id,monthlyStudentEntries.studentId)).innerJoin(monthlyEntries,eq(monthlyEntries.id,monthlyStudentEntries.monthlyEntryId)).where(and(eq(monthlyStudentEntries.studentId,studentId),eq(monthlyEntries.organizationId,org.id),inArray(monthlyEntries.status,['SUBMITTED','UNDER_REVIEW','APPROVED']))).limit(600);
  const entryIds=[...new Set(monthlyRows.map(r=>r.monthlyEntryId))];
  const monthlyObs=[];
  if(entryIds.length){
    const monthlyHeaders=await db.select({entry:monthlyEntries,className:classes.name,subjectName:subjects.name,teacherName:teachers.name}).from(monthlyEntries).innerJoin(classes,eq(classes.id,monthlyEntries.classId)).innerJoin(subjects,eq(subjects.id,monthlyEntries.subjectId)).innerJoin(teachers,eq(teachers.id,monthlyEntries.teacherId)).where(inArray(monthlyEntries.id,entryIds));
    const rowsByEntry=new Map<string,MonthlyStudentRow[]>();
    for(const row of monthlyRows){const list=rowsByEntry.get(row.monthlyEntryId)||[];list.push(row);rowsByEntry.set(row.monthlyEntryId,list);}
    for(const h of monthlyHeaders) monthlyObs.push(...entryObservations(h.entry,rowsByEntry.get(h.entry.id)||[],h.className,h.subjectName,h.teacherName,currentSettings));
  }
  const trends=calculateStudentTrends([...studentRows,...monthlyObs],currentSettings);
  return Response.json({student:stu,trends});
 }
 if(view==='behaviourObservations'){
  const studentId=url.searchParams.get('studentId'); const classId=url.searchParams.get('classId'); const followUp=url.searchParams.get('followUp');
  const obs=await db.select({id:behaviourObservations.id,date:behaviourObservations.date,category:behaviourObservations.category,severity:behaviourObservations.severity,description:behaviourObservations.description,actionTaken:behaviourObservations.actionTaken,followUpRequired:behaviourObservations.followUpRequired,createdAt:behaviourObservations.createdAt,studentId:behaviourObservations.studentId,studentName:students.fullName,studentCode:students.studentId,className:classes.name,teacherName:teachers.name}).from(behaviourObservations).innerJoin(students,eq(students.id,behaviourObservations.studentId)).innerJoin(classes,eq(classes.id,behaviourObservations.classId)).innerJoin(teachers,eq(teachers.id,behaviourObservations.teacherId)).where(and(eq(behaviourObservations.organizationId,org.id),teacher?eq(behaviourObservations.teacherId,teacher.id):undefined,studentId?eq(behaviourObservations.studentId,studentId):undefined,classId?eq(behaviourObservations.classId,classId):undefined,followUp==='1'?eq(behaviourObservations.followUpRequired,true):undefined)).orderBy(desc(behaviourObservations.date),desc(behaviourObservations.createdAt)).limit(100);
  return Response.json({observations:obs});
 }
  if(view==='monthlyEntries'){
   const month=z.string().regex(MONTH_PATTERN,'Month must be in YYYY-MM format.').parse(url.searchParams.get('month'));
   const classId=url.searchParams.get('classId'); const subjectId=url.searchParams.get('subjectId'); const statusFilter=url.searchParams.get('status'); const teacherFilter=url.searchParams.get('teacherId');
   const [closedRow]=await db.select({closed:monthClosures.closed}).from(monthClosures).where(and(eq(monthClosures.organizationId,org.id),eq(monthClosures.month,month))).limit(1);
   const entryRows=await db.select({entry:monthlyEntries,className:classes.name,subjectName:subjects.name,teacherName:teachers.name,studentCount:sql<number>`CAST((select count(*) from ${monthlyStudentEntries} where ${monthlyStudentEntries.monthlyEntryId}=${monthlyEntries.id}) AS INTEGER)`}).from(monthlyEntries).innerJoin(classes,eq(classes.id,monthlyEntries.classId)).innerJoin(subjects,eq(subjects.id,monthlyEntries.subjectId)).innerJoin(teachers,eq(teachers.id,monthlyEntries.teacherId)).where(and(eq(monthlyEntries.organizationId,org.id),eq(monthlyEntries.month,month),teacher?eq(monthlyEntries.teacherId,teacher.id):undefined,teacherFilter?eq(monthlyEntries.teacherId,teacherFilter):undefined,classId?eq(monthlyEntries.classId,classId):undefined,subjectId?eq(monthlyEntries.subjectId,subjectId):undefined,statusFilter?eq(monthlyEntries.status,statusFilter):undefined)).orderBy(classes.name,subjects.name).limit(300);
   const entries=entryRows.map(r=>({id:r.entry.id,classId:r.entry.classId,subjectId:r.entry.subjectId,teacherId:r.entry.teacherId,month:r.entry.month,status:r.entry.status,sessionsHeld:r.entry.sessionsHeld,topics:r.entry.topics,submittedAt:r.entry.submittedAt,updatedAt:r.entry.updatedAt,className:r.className,subjectName:r.subjectName,teacherName:r.entry.teacherNameSnapshot||r.teacherName,studentCount:r.studentCount}));
   const plannedKeys=new Set(entryRows.map(r=>`${r.entry.classId}|${r.entry.subjectId}`));
   const assignmentRows=await db.select({classId:assignments.classId,subjectId:assignments.subjectId,className:classes.name,subjectName:subjects.name,teacherId:assignments.teacherId,teacherName:teachers.name}).from(assignments).innerJoin(classes,eq(classes.id,assignments.classId)).innerJoin(subjects,eq(subjects.id,assignments.subjectId)).innerJoin(teachers,eq(teachers.id,assignments.teacherId)).where(and(eq(assignments.organizationId,org.id),eq(assignments.active,true),teacher?eq(assignments.teacherId,teacher.id):undefined,teacherFilter?eq(assignments.teacherId,teacherFilter):undefined,classId?eq(assignments.classId,classId):undefined,subjectId?eq(assignments.subjectId,subjectId):undefined)).orderBy(classes.name,subjects.name).limit(400);
   const planned=assignmentRows.filter(a=>!plannedKeys.has(`${a.classId}|${a.subjectId}`)).map(a=>({...a,month,status:'MISSING',studentCount:0}));
    return Response.json({month,entries,planned,closed:!!closedRow?.closed});
  }
  if(view==='monthlyEntry'){
   const entryId=url.searchParams.get('entryId'); const monthParam=url.searchParams.get('month');
   let entry:(typeof monthlyEntries.$inferSelect)|null=null;
   if(entryId){
    const [found]=await db.select().from(monthlyEntries).where(and(eq(monthlyEntries.id,entryId),eq(monthlyEntries.organizationId,org.id),teacher?eq(monthlyEntries.teacherId,teacher.id):undefined)).limit(1);
    entry=found||null;
   }else{
    const month=z.string().regex(MONTH_PATTERN,'Month must be in YYYY-MM format.').parse(monthParam);
    const classId=z.string().min(1).parse(url.searchParams.get('classId')); const subjectId=z.string().min(1).parse(url.searchParams.get('subjectId'));
    const [found]=await db.select().from(monthlyEntries).where(and(eq(monthlyEntries.organizationId,org.id),eq(monthlyEntries.month,month),eq(monthlyEntries.classId,classId),eq(monthlyEntries.subjectId,subjectId),teacher?eq(monthlyEntries.teacherId,teacher.id):undefined)).limit(1);
    entry=found||null;
    if(!entry&&teacher&&!(await db.select({id:assignments.id}).from(assignments).where(and(myAssignment,eq(assignments.classId,classId),eq(assignments.subjectId,subjectId))).limit(1)).length)throw new AppError('You are not assigned to this class and subject.',403);
   }
   const month=entry?entry.month:z.string().regex(MONTH_PATTERN,'Month must be in YYYY-MM format.').parse(monthParam);
   const classId=entry?entry.classId:z.string().min(1).parse(url.searchParams.get('classId'));
   const subjectId=entry?entry.subjectId:z.string().min(1).parse(url.searchParams.get('subjectId'));
   const [cls]=await db.select().from(classes).where(and(eq(classes.id,classId),eq(classes.organizationId,org.id))).limit(1);
   const [sub]=await db.select().from(subjects).where(and(eq(subjects.id,subjectId),eq(subjects.organizationId,org.id))).limit(1);
   if(!cls||!sub)throw new AppError('Class or subject not found.',404);
    const resolved=await loadSubjectRoster(org.id,classId,subjectId);
    const roster=resolved.roster.map(s=>({studentId:s.id,studentCode:s.studentCode,studentName:s.studentName}));
    const records=entry?await db.select({studentId:monthlyStudentEntries.studentId,punctuality:monthlyStudentEntries.punctuality,performance:monthlyStudentEntries.performance,participation:monthlyStudentEntries.participation,homework:monthlyStudentEntries.homework,conduct:monthlyStudentEntries.conduct,comment:monthlyStudentEntries.comment}).from(monthlyStudentEntries).where(eq(monthlyStudentEntries.monthlyEntryId,entry.id)).orderBy(monthlyStudentEntries.studentId):[];
   const [closedRow]=await db.select({closed:monthClosures.closed}).from(monthClosures).where(and(eq(monthClosures.organizationId,org.id),eq(monthClosures.month,month))).limit(1);
   const [owner]=entry?await db.select({name:teachers.name}).from(teachers).where(eq(teachers.id,entry.teacherId)).limit(1):[];
   return Response.json({entry,month,classId,subjectId,className:cls.name,subjectName:sub.name,teacherId:entry?.teacherId||teacher?.id||null,teacherName:entry?.teacherNameSnapshot||owner?.name||null,roster,rosterDefault:resolved.isDefault,records,monthClosed:!!closedRow?.closed,editable:!entry||entry.status==='DRAFT'||entry.status==='RETURNED'});
  }
  if(view==='subjectRoster'){
   const classId=str(url.searchParams.get('classId')); const subjectId=str(url.searchParams.get('subjectId'));
   if(teacher&&!(await db.select({id:assignments.id}).from(assignments).where(and(myAssignment,eq(assignments.classId,classId),eq(assignments.subjectId,subjectId))).limit(1)).length)throw new AppError('You are not assigned to this class and subject.',403);
   const [cls]=await db.select().from(classes).where(and(eq(classes.id,classId),eq(classes.organizationId,org.id))).limit(1);
   const [sub]=await db.select().from(subjects).where(and(eq(subjects.id,subjectId),eq(subjects.organizationId,org.id))).limit(1);
   if(!cls||!sub)throw new AppError('Class or subject not found.',404);
   const allStudents=await db.select({id:students.id,studentCode:students.studentId,studentName:students.fullName}).from(students).where(and(eq(students.classId,classId),eq(students.organizationId,org.id),eq(students.status,'ACTIVE'))).orderBy(students.fullName).limit(200);
   const enrolledRows=await db.select({studentId:subjectStudents.studentId}).from(subjectStudents).where(and(eq(subjectStudents.organizationId,org.id),eq(subjectStudents.classId,classId),eq(subjectStudents.subjectId,subjectId)));
   const activeIds=new Set(allStudents.map(s=>s.id));
   const enrolled=enrolledRows.map(r=>r.studentId).filter(id=>activeIds.has(id));
   return Response.json({students:allStudents,enrolled,isDefault:enrolled.length===0,className:cls.name,subjectName:sub.name});
  }
  if(view==='audit'){if(user.role!=='ADMIN') throw new AppError('Access denied.',403);return Response.json({logs:await db.select().from(auditLogs).where(eq(auditLogs.organizationId,org.id)).orderBy(desc(auditLogs.createdAt)).limit(100)});}
 if(view==='settings'){if(user.role!=='ADMIN') throw new AppError('Access denied.',403);return Response.json({settings:(await db.select().from(settings).where(eq(settings.organizationId,org.id)))[0],closures:await db.select().from(monthClosures).where(eq(monthClosures.organizationId,org.id)),organization:org});}
 if(view==='clubs'){
  const allClubs=await db.select().from(clubs).where(eq(clubs.organizationId,org.id)).orderBy(clubs.name);
  const assigned=teacher?(await db.select({clubId:clubTeachers.clubId}).from(clubTeachers).where(eq(clubTeachers.teacherId,teacher.id))).map(r=>r.clubId):null;
  const scoped=allClubs.filter(c=>assigned?(assigned.includes(c.id)&&c.active):true);
  const ids=scoped.map(c=>c.id);
  let assignedTeachers:{clubId:string;teacherId:string;role:string;teacherName:string;active:boolean}[]=[];
  let members:{clubId:string;studentId:string;studentName:string;studentCode:string;className:string|null}[]=[];
  let activities:(typeof clubActivities.$inferSelect)[]=[];
  let records:{id:string;clubActivityId:string;studentId:string;studentName:string;studentCode:string;punctuality:string|null;performance:string|null;participation:string|null;conduct:string|null;comment:string|null}[]=[];
  if(ids.length){
   const [clubTeacherRows,memberRows,activityRows]=await Promise.all([
    db.select({clubId:clubTeachers.clubId,teacherId:clubTeachers.teacherId,role:clubTeachers.role,teacherName:teachers.name,active:teachers.active}).from(clubTeachers).innerJoin(teachers,eq(teachers.id,clubTeachers.teacherId)).where(inArray(clubTeachers.clubId,ids)).orderBy(teachers.name),
    db.select({clubId:clubMembers.clubId,studentId:clubMembers.studentId,studentName:students.fullName,studentCode:students.studentId,className:classes.name}).from(clubMembers).innerJoin(students,eq(students.id,clubMembers.studentId)).leftJoin(classes,eq(classes.id,students.classId)).where(inArray(clubMembers.clubId,ids)).orderBy(students.fullName),
    db.select().from(clubActivities).where(inArray(clubActivities.clubId,ids)).orderBy(desc(clubActivities.activityDate),desc(clubActivities.createdAt)),
   ]);
   assignedTeachers=clubTeacherRows;members=memberRows;activities=activityRows;
   const activityIds=activityRows.map(a=>a.id);
   if(activityIds.length){
    records=await db.select({id:clubActivityRecords.id,clubActivityId:clubActivityRecords.clubActivityId,studentId:clubActivityRecords.studentId,studentName:sql<string>`coalesce(${clubActivityRecords.studentNameSnapshot}, ${students.fullName})`,studentCode:sql<string>`coalesce(${clubActivityRecords.studentCodeSnapshot}, ${students.studentId})`,punctuality:clubActivityRecords.punctuality,performance:clubActivityRecords.performance,participation:clubActivityRecords.participation,conduct:clubActivityRecords.conduct,comment:clubActivityRecords.comment}).from(clubActivityRecords).innerJoin(students,eq(students.id,clubActivityRecords.studentId)).where(inArray(clubActivityRecords.clubActivityId,activityIds)).orderBy(students.fullName).limit(5000);
   }
  }
  const teacherOptions=user.role==='ADMIN'?await db.select({id:teachers.id,name:teachers.name,active:teachers.active}).from(teachers).where(eq(teachers.organizationId,org.id)).orderBy(teachers.name):[];
  const studentOptions=user.role==='TEACHER'?await db.select({id:students.id,studentId:students.studentId,fullName:students.fullName,classId:students.classId,className:classes.name}).from(students).leftJoin(classes,eq(classes.id,students.classId)).where(and(eq(students.organizationId,org.id),eq(students.status,'ACTIVE'))).orderBy(students.fullName).limit(2000):[];
  return Response.json({clubs:scoped,teachers:assignedTeachers,members,activities,records,teacherOptions,studentOptions,role:user.role});
 }
 throw new AppError('Unknown view.',404);
 }catch(e){return fail(e);}}

export async function POST(req:Request){try{
 await checkOrigin(req); const user=await requireUser(); const raw=await req.json(); const action=str(raw.action);
   if(action==='saveMonthlyRecord') return Response.json({lesson:await saveMonthlyRecord(user,raw.data)});
  if(action==='deleteDraft'){
    const x=z.object({id:z.string().uuid()}).parse(raw.data);
    const org=await orgFor(user),teacher=user.role==='TEACHER'?await teacherFor(user):null;
    const [draft]=await db.select({id:lessons.id}).from(lessons).where(and(eq(lessons.id,x.id),eq(lessons.organizationId,org.id),teacher?eq(lessons.teacherId,teacher.id):undefined,eq(lessons.status,'DRAFT')));
    if(draft){
     await runTransaction(async tx=>{await tx.delete(records).where(and(eq(records.organizationId,org.id),eq(records.monthlyLessonId,draft.id)));await tx.delete(lessons).where(and(eq(lessons.id,draft.id),eq(lessons.organizationId,org.id),teacher?eq(lessons.teacherId,teacher.id):undefined,eq(lessons.status,'DRAFT')));});
     await audit(org.id,user.id,'DRAFT_DELETED','monthly_lesson',draft.id);return Response.json({ok:true});
    }
    const [monthly]=await db.select({id:monthlyEntries.id,status:monthlyEntries.status}).from(monthlyEntries).where(and(eq(monthlyEntries.id,x.id),eq(monthlyEntries.organizationId,org.id),teacher?eq(monthlyEntries.teacherId,teacher.id):undefined));
    if(!monthly)throw new AppError(teacher?'Only your own draft reports can be deleted.':'Report not found.',teacher?403:404);
    if(monthly.status!=='DRAFT'&&monthly.status!=='RETURNED')throw new AppError('Only draft or returned monthly records can be deleted.',403);
    await runTransaction(async tx=>{await tx.delete(monthlyStudentEntries).where(eq(monthlyStudentEntries.monthlyEntryId,monthly.id));await tx.delete(monthlyEntries).where(eq(monthlyEntries.id,monthly.id));});
    await audit(org.id,user.id,'DRAFT_DELETED','monthly_entry',monthly.id);return Response.json({ok:true});
  }
  if(action==='saveMonthlyEntry'){
    if(user.role!=='TEACHER'&&user.role!=='ADMIN')throw new AppError('Teacher or administrator access required.',403);
    const x=monthlyEntryInput.parse(raw.data);
    const org=await orgFor(user),oid=org.id,teacher=user.role==='TEACHER'?await teacherFor(user):null;
    if(!isValidMonth(x.month,schoolToday(org.timezone)))throw new AppError('Month must be in YYYY-MM format and cannot be in the future.',400);
    const [closure]=await db.select().from(monthClosures).where(and(eq(monthClosures.organizationId,oid),eq(monthClosures.month,x.month))).limit(1);
    if(closure?.closed)throw new AppError('This month is closed. Ask an administrator to reopen it before editing.',409);
    const [cls]=await db.select().from(classes).where(and(eq(classes.id,x.classId),eq(classes.organizationId,oid))).limit(1);
    const [sub]=await db.select().from(subjects).where(and(eq(subjects.id,x.subjectId),eq(subjects.organizationId,oid))).limit(1);
    if(!cls||!sub)throw new AppError('Class or subject not found.',404);
    const year=(await db.select().from(academicYears).where(eq(academicYears.organizationId,oid))).find(y=>monthOverlapsYear(x.month,y.startDate,y.endDate));
    if(!year)throw new AppError('No academic year covers this month.',400);
    let teacherId:string,teacherName:string;
    if(teacher){
     const [a]=await db.select({id:assignments.id}).from(assignments).where(and(eq(assignments.organizationId,oid),eq(assignments.teacherId,teacher.id),eq(assignments.active,true),eq(assignments.classId,x.classId),eq(assignments.subjectId,x.subjectId))).limit(1);
     if(!a)throw new AppError('You are not assigned to this class and subject.',403);
     teacherId=teacher.id;teacherName=teacher.name;
     }else{
      const [a]=await db.select({teacherId:assignments.teacherId,teacherName:teachers.name}).from(assignments).innerJoin(teachers,eq(teachers.id,assignments.teacherId)).where(and(eq(assignments.organizationId,oid),eq(assignments.classId,x.classId),eq(assignments.subjectId,x.subjectId),eq(assignments.active,true))).limit(1);
      if(a){teacherId=a.teacherId;teacherName=a.teacherName;}
      else{
       const [prev]=await db.select({teacherId:monthlyEntries.teacherId,teacherNameSnapshot:monthlyEntries.teacherNameSnapshot}).from(monthlyEntries).where(and(eq(monthlyEntries.organizationId,oid),eq(monthlyEntries.classId,x.classId),eq(monthlyEntries.subjectId,x.subjectId),eq(monthlyEntries.month,x.month))).limit(1);
       if(prev){teacherId=prev.teacherId;teacherName=prev.teacherNameSnapshot||'';}
       else throw new AppError('No active teacher is assigned to this class and subject. Assign a teacher first.',409);
      }
     }
    const { roster }=await loadSubjectRoster(oid,x.classId,x.subjectId);
    const rosterNames=new Map<string,{name:string;code:string}>(roster.map(r=>[r.id,{name:r.studentName,code:r.studentCode}]));
    const rosterIds=new Set(roster.map(r=>r.id));
    const seen=new Set<string>();
    for(const r of x.records){
     if(seen.has(r.studentId))throw new AppError('The same student appears twice in this record.',400);
     seen.add(r.studentId);
      if(!rosterIds.has(r.studentId))throw new AppError('A student row does not belong to this class or subject group.',403);
    }
    if(x.submit){
      if(!x.topics.trim())throw new AppError('Content covered is required before submitting.',400);
      if(roster.some(r=>!seen.has(r.id)))throw new AppError('Every student in this subject group needs a row before submitting.',400);
      for(const r of x.records){
       if(!r.punctuality)throw new AppError('Choose punctuality for every student before submitting.',400);
       if(!r.performance||!r.participation||!r.homework||!r.conduct)throw new AppError('Fill every level before submitting.',400);
       if((r.performance==='NEEDS_IMPROVEMENT'||r.conduct==='NEEDS_IMPROVEMENT')&&!(r.comment||'').trim())throw new AppError('Add a comment when performance or conduct needs improvement.',400);
      }
    }
    const rows=x.records.map(r=>({studentId:r.studentId,studentNameSnapshot:rosterNames.get(r.studentId)?.name||null,studentCodeSnapshot:rosterNames.get(r.studentId)?.code||null,punctuality:r.punctuality||null,performance:r.performance||null,participation:r.participation||null,homework:r.homework||null,conduct:r.conduct||null,comment:(r.comment||'').trim()||null}));
    const [existing]=await db.select().from(monthlyEntries).where(and(eq(monthlyEntries.organizationId,oid),eq(monthlyEntries.classId,x.classId),eq(monthlyEntries.subjectId,x.subjectId),eq(monthlyEntries.month,x.month))).limit(1);
    if(existing&&teacher&&existing.teacherId!==teacher.id)throw new AppError('Another teacher has already started this month\u2019s record for this class and subject.',409);
    if(existing&&existing.status!=='DRAFT'&&existing.status!=='RETURNED')throw new AppError('This month\u2019s record has already been submitted and can no longer be edited.',409);
    // A returned record stays RETURNED (and keeps the review note) until the teacher resubmits it.
    const status=x.submit?'SUBMITTED':existing&&existing.status==='RETURNED'?'RETURNED':'DRAFT';
    const entryId=await runTransaction(async tx=>{
     let id:string;
     if(existing){
      id=existing.id;
       await tx.update(monthlyEntries).set({academicYearId:year.id,sessionsHeld:x.sessionsHeld,topics:x.topics.trim(),status,classNameSnapshot:cls.name,subjectNameSnapshot:sub.name,submittedAt:x.submit?new Date():existing.submittedAt,reviewedAt:x.submit?null:existing.reviewedAt,reviewedBy:x.submit?null:existing.reviewedBy,reviewComment:x.submit?null:existing.reviewComment,updatedAt:new Date()}).where(eq(monthlyEntries.id,existing.id));
      await tx.delete(monthlyStudentEntries).where(eq(monthlyStudentEntries.monthlyEntryId,existing.id));
     }else{
      const [created]=await tx.insert(monthlyEntries).values({organizationId:oid,classId:x.classId,subjectId:x.subjectId,academicYearId:year.id,teacherId,month:x.month,sessionsHeld:x.sessionsHeld,topics:x.topics.trim(),status,classNameSnapshot:cls.name,subjectNameSnapshot:sub.name,teacherNameSnapshot:teacherName,submittedAt:x.submit?new Date():null}).returning();
      id=created.id;
     }
      if(rows.length){
       for(const r of rows){await tx.insert(monthlyStudentEntries).values({organizationId:oid,monthlyEntryId:id,studentId:r.studentId,studentNameSnapshot:r.studentNameSnapshot,studentCodeSnapshot:r.studentCodeSnapshot,punctuality:r.punctuality,performance:r.performance,participation:r.participation,homework:r.homework,conduct:r.conduct,comment:r.comment});}
      }
     return id;
    });
    await audit(oid,user.id,x.submit?'MONTHLY_ENTRY_SUBMITTED':'MONTHLY_ENTRY_SAVED','monthly_entry',entryId,{month:x.month,classId:x.classId,subjectId:x.subjectId});
    return Response.json({ok:true,id:entryId,status});
  }
  if(action==='saveSubjectRoster'){
    if(user.role!=='TEACHER'&&user.role!=='ADMIN')throw new AppError('Teacher or administrator access required.',403);
    const x=z.object({classId:z.string().min(1).max(64),subjectId:z.string().min(1).max(64),studentIds:z.array(z.string().min(1).max(64)).max(200)}).parse(raw.data);
    const org=await orgFor(user),oid=org.id,teacher=user.role==='TEACHER'?await teacherFor(user):null;
    if(teacher){
      const [a]=await db.select({id:assignments.id}).from(assignments).where(and(eq(assignments.organizationId,oid),eq(assignments.teacherId,teacher.id),eq(assignments.active,true),eq(assignments.classId,x.classId),eq(assignments.subjectId,x.subjectId))).limit(1);
      if(!a)throw new AppError('You are not assigned to this class and subject.',403);
    }
    const [cls]=await db.select().from(classes).where(and(eq(classes.id,x.classId),eq(classes.organizationId,oid))).limit(1);
    const [sub]=await db.select().from(subjects).where(and(eq(subjects.id,x.subjectId),eq(subjects.organizationId,oid))).limit(1);
    if(!cls||!sub)throw new AppError('Class or subject not found.',404);
    const ids=[...new Set(x.studentIds)];
    const classStudents=await db.select({id:students.id}).from(students).where(and(eq(students.organizationId,oid),eq(students.classId,x.classId),eq(students.status,'ACTIVE')));
    const validIds=new Set(classStudents.map(s=>s.id));
    if(ids.some(id=>!validIds.has(id)))throw new AppError('Every selected student must be active in this class.',400);
    await runTransaction(async tx=>{
      await tx.delete(subjectStudents).where(and(eq(subjectStudents.organizationId,oid),eq(subjectStudents.classId,x.classId),eq(subjectStudents.subjectId,x.subjectId)));
      for(const id of ids)await tx.insert(subjectStudents).values({organizationId:oid,classId:x.classId,subjectId:x.subjectId,studentId:id});
    });
    await audit(oid,user.id,'SUBJECT_ROSTER_SAVED','subject_roster',`${x.classId}|${x.subjectId}`,{classId:x.classId,subjectId:x.subjectId,count:ids.length});
    return Response.json({ok:true,count:ids.length,isDefault:ids.length===0});
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
 if(['createClub','updateClub','updateClubMembers','saveClubActivity','submitClubActivity','reviewClubActivity'].includes(action)){
  if(!['ADMIN','TEACHER'].includes(user.role))throw new AppError('Club access denied.',403);
  const org=await orgFor(user);const oid=org.id;const teacher=user.role==='TEACHER'?await teacherFor(user):null;
  const loadClub=async(clubId:string)=>{const [club]=await db.select().from(clubs).where(and(eq(clubs.id,clubId),eq(clubs.organizationId,oid))).limit(1);if(!club)throw new AppError('Club not found.',404);return club;};
  const canManageClub=async(clubId:string)=>{if(user.role==='ADMIN')return true;if(!teacher)return false;return (await db.select({id:clubTeachers.id}).from(clubTeachers).where(and(eq(clubTeachers.clubId,clubId),eq(clubTeachers.teacherId,teacher.id))).limit(1)).length>0;};
  const loadActivity=async(id:string)=>{const [activity]=await db.select().from(clubActivities).where(and(eq(clubActivities.id,id),eq(clubActivities.organizationId,oid))).limit(1);if(!activity)throw new AppError('Activity not found.',404);return activity;};
  const verifyRows=async(ids:string[],table:typeof teachers|typeof students,label:string)=>{if(!ids.length)return;const rows=await db.select({id:table.id}).from(table).where(and(eq(table.organizationId,oid),inArray(table.id,ids)));if(new Set(rows.map(r=>r.id)).size!==new Set(ids).size)throw new AppError(`One or more ${label} are not part of this school.`);};
  if(action==='createClub'){
   if(user.role!=='ADMIN')throw new AppError('Only administrators can create clubs.',403);
   const x=z.object({name:z.string().trim().min(2).max(80),description:z.string().max(500).optional(),academicYearId:z.string().uuid().nullish(),teacherIds:z.array(z.string().uuid()).max(50).default([]),studentIds:z.array(z.string().uuid()).max(2000).default([])}).parse(raw.data);
   const [dupe]=await db.select({id:clubs.id}).from(clubs).where(and(eq(clubs.organizationId,oid),eq(clubs.name,x.name))).limit(1);
   if(dupe)throw new AppError('A club with that name already exists.');
   await verifyRows(x.teacherIds,teachers,'teachers');await verifyRows(x.studentIds,students,'students');
   const club=await runTransaction(async tx=>{
    const [c]=await tx.insert(clubs).values({organizationId:oid,name:x.name,description:x.description?.trim()||null,academicYearId:x.academicYearId||null}).returning();
     const teacherIds=[...new Set(x.teacherIds)];
     for(let i=0;i<teacherIds.length;i++)await tx.insert(clubTeachers).values({organizationId:oid,clubId:c.id,teacherId:teacherIds[i],role:i===0?'LEAD':'MEMBER'});
     const studentIds=[...new Set(x.studentIds)];
     for(const id of studentIds)await tx.insert(clubMembers).values({organizationId:oid,clubId:c.id,studentId:id});
    return c;
   });
   await audit(oid,user.id,'CLUB_CREATED','club',club.id,{name:club.name});
   return Response.json({ok:true,club});
  }
  if(action==='updateClub'){
   if(user.role!=='ADMIN')throw new AppError('Only administrators can edit clubs.',403);
   const x=z.object({id:z.string().uuid(),name:z.string().trim().min(2).max(80),description:z.string().max(500).nullish(),academicYearId:z.string().uuid().nullish(),active:z.boolean(),teacherIds:z.array(z.string().uuid()).max(50).optional(),studentIds:z.array(z.string().uuid()).max(2000).optional()}).parse(raw.data);
   await loadClub(x.id);
   const [dupe]=await db.select({id:clubs.id}).from(clubs).where(and(eq(clubs.organizationId,oid),eq(clubs.name,x.name))).limit(1);
   if(dupe&&dupe.id!==x.id)throw new AppError('A club with that name already exists.');
   if(x.teacherIds)await verifyRows(x.teacherIds,teachers,'teachers');
   if(x.studentIds)await verifyRows(x.studentIds,students,'students');
   await runTransaction(async tx=>{
    await tx.update(clubs).set({name:x.name,description:x.description||null,academicYearId:x.academicYearId||null,active:x.active,updatedAt:new Date()}).where(and(eq(clubs.id,x.id),eq(clubs.organizationId,oid)));
     if(x.teacherIds){await tx.delete(clubTeachers).where(eq(clubTeachers.clubId,x.id));const teacherIds=[...new Set(x.teacherIds)];for(let i=0;i<teacherIds.length;i++)await tx.insert(clubTeachers).values({organizationId:oid,clubId:x.id,teacherId:teacherIds[i],role:i===0?'LEAD':'MEMBER'});}
     if(x.studentIds){await tx.delete(clubMembers).where(eq(clubMembers.clubId,x.id));const studentIds=[...new Set(x.studentIds)];for(const id of studentIds)await tx.insert(clubMembers).values({organizationId:oid,clubId:x.id,studentId:id});}
   });
   await audit(oid,user.id,'CLUB_UPDATED','club',x.id,{name:x.name,active:x.active});
   return Response.json({ok:true});
  }
  if(action==='updateClubMembers'){
   const x=z.object({clubId:z.string().uuid(),studentIds:z.array(z.string().uuid()).max(2000)}).parse(raw.data);
   const club=await loadClub(x.clubId);
   if(!await canManageClub(club.id))throw new AppError('You can only manage members for your own clubs.',403);
   await verifyRows(x.studentIds,students,'students');
   const ids=[...new Set(x.studentIds)];
   await runTransaction(async tx=>{
    await tx.delete(clubMembers).where(eq(clubMembers.clubId,club.id));
    for(const id of ids)await tx.insert(clubMembers).values({organizationId:oid,clubId:club.id,studentId:id});
   });
   await audit(oid,user.id,'CLUB_MEMBERS_UPDATED','club',club.id,{count:ids.length});
   return Response.json({ok:true,count:ids.length});
  }
  if(action==='saveClubActivity'){
   const x=z.object({id:z.string().uuid().optional(),clubId:z.string().uuid(),title:z.string().trim().min(2).max(120),activityDate:z.iso.date(),description:z.string().max(2000).optional(),records:z.array(z.object({studentId:z.string().uuid(),punctuality:z.string().max(40).nullable().optional(),performance:z.string().max(40).nullable().optional(),participation:z.string().max(40).nullable().optional(),conduct:z.string().max(40).nullable().optional(),comment:z.string().max(1000).optional()})).max(300).optional()}).parse(raw.data);
   const club=await loadClub(x.clubId);
   if(!await canManageClub(club.id))throw new AppError('You can only record activities for your own clubs.',403);
   if(club.active===false)throw new AppError('This club is inactive.',409);
   if(x.records){
    const memberIds=new Set((await db.select({studentId:clubMembers.studentId}).from(clubMembers).where(eq(clubMembers.clubId,club.id))).map(r=>r.studentId));
    const seen=new Set<string>();
    for(const r of x.records){
     if(seen.has(r.studentId))throw new AppError('The same student appears twice in this record.',400);
     seen.add(r.studentId);
     if(!memberIds.has(r.studentId))throw new AppError('A student row does not belong to this club.',403);
    }
   }
   let activityId='';
   let status='DRAFT';
   if(x.id){
    const old=await loadActivity(x.id);
    if(old.clubId!==club.id)throw new AppError('That activity belongs to another club.',409);
    if(!['DRAFT','RETURNED'].includes(old.status))throw new AppError('Only draft or returned activities can be edited.',409);
    const reopened=old.status==='RETURNED';
    const changed=await db.update(clubActivities).set({title:x.title,activityDate:x.activityDate,description:x.description?.trim()||'',updatedAt:new Date(),...(reopened?{status:'DRAFT',submittedAt:null,reviewComment:null,reviewedAt:null,reviewedBy:null}:{})}).where(and(eq(clubActivities.id,old.id),eq(clubActivities.status,old.status))).returning({id:clubActivities.id});
    if(!changed.length)throw new AppError('This activity changed while you were editing it. Reload and try again.',409);
    activityId=old.id;status=reopened?'DRAFT':old.status;
    await audit(oid,user.id,reopened?'CLUB_ACTIVITY_RESUBMITTED_DRAFT':'CLUB_ACTIVITY_UPDATED','club_activity',old.id);
   }else{
    const [created]=await db.insert(clubActivities).values({organizationId:oid,clubId:club.id,title:x.title,activityDate:x.activityDate,description:x.description?.trim()||'',status:'DRAFT',createdBy:user.id}).returning();
    activityId=created.id;
    await audit(oid,user.id,'CLUB_ACTIVITY_CREATED','club_activity',created.id,{clubName:club.name});
   }
   const rowsToSave=x.records;
   if(rowsToSave){
    const roster=await db.select({id:students.id,studentCode:students.studentId,studentName:students.fullName}).from(students).where(eq(students.organizationId,oid)).limit(3000);
    const names=new Map(roster.map(r=>[r.id,{name:r.studentName,code:r.studentCode}]));
    await runTransaction(async tx=>{
     await tx.delete(clubActivityRecords).where(eq(clubActivityRecords.clubActivityId,activityId));
     for(const r of rowsToSave){
      await tx.insert(clubActivityRecords).values({organizationId:oid,clubActivityId:activityId,studentId:r.studentId,studentNameSnapshot:names.get(r.studentId)?.name||null,studentCodeSnapshot:names.get(r.studentId)?.code||null,punctuality:r.punctuality||null,performance:r.performance||null,participation:r.participation||null,conduct:r.conduct||null,comment:(r.comment||'').trim()||null});
     }
    });
   }
   return Response.json({ok:true,id:activityId,status});
  }
  if(action==='submitClubActivity'){
   const x=z.object({id:z.string().uuid()}).parse(raw.data);
   const activity=await loadActivity(x.id);
   if(!await canManageClub(activity.clubId))throw new AppError('You can only submit activities for your own clubs.',403);
   if(!['DRAFT','RETURNED'].includes(activity.status))throw new AppError('Only draft or returned activities can be submitted.',409);
   const memberIds=(await db.select({studentId:clubMembers.studentId}).from(clubMembers).where(eq(clubMembers.clubId,activity.clubId))).map(r=>r.studentId);
   if(!memberIds.length)throw new AppError('Add club members before submitting an activity.',400);
   const rows=await db.select().from(clubActivityRecords).where(eq(clubActivityRecords.clubActivityId,activity.id)).limit(300);
   const memberSet=new Set(memberIds);
   const byStudent=new Map(rows.filter(r=>memberSet.has(r.studentId)).map(r=>[r.studentId,r]));
   if(byStudent.size<memberIds.length)throw new AppError('Every club member needs a record before submitting.',400);
   for(const r of byStudent.values()){
    if(!r.punctuality)throw new AppError('Choose punctuality for every member before submitting.',400);
    if(!r.performance||!r.participation||!r.conduct)throw new AppError('Fill every level before submitting.',400);
    if((r.performance==='NEEDS_IMPROVEMENT'||r.conduct==='NEEDS_IMPROVEMENT')&&!(r.comment||'').trim())throw new AppError('Add a comment when performance or conduct needs improvement.',400);
   }
   const updated=await db.update(clubActivities).set({status:'SUBMITTED',submittedAt:new Date(),reviewComment:null,reviewedAt:null,reviewedBy:null,updatedAt:new Date()}).where(and(eq(clubActivities.id,activity.id),eq(clubActivities.status,activity.status))).returning({id:clubActivities.id});
   if(!updated.length)throw new AppError('This activity changed while you were editing it. Reload and try again.',409);
   await audit(oid,user.id,'CLUB_ACTIVITY_SUBMITTED','club_activity',activity.id,{previousStatus:activity.status});
   return Response.json({ok:true,status:'SUBMITTED'});
  }
  if(action==='reviewClubActivity'){
   if(user.role!=='ADMIN')throw new AppError('Only administrators can review club activities.',403);
   const x=z.object({id:z.string().uuid(),status:z.enum(['UNDER_REVIEW','APPROVED','RETURNED','SUBMITTED']),comment:z.string().max(1000).optional()}).parse(raw.data);
   const old=await loadActivity(x.id);
   const transition=reviewTransition(old.status,x.status,x.comment);
   const updated=await db.update(clubActivities).set({status:transition.status,reviewComment:x.comment?.trim()||null,reviewedAt:new Date(),reviewedBy:user.id,updatedAt:new Date()}).where(and(eq(clubActivities.id,old.id),eq(clubActivities.status,old.status))).returning({id:clubActivities.id});
   if(!updated.length)throw new AppError('This activity changed while you were reviewing it. Reload and try again.',409);
   await audit(oid,user.id,transition.auditAction,'club_activity',old.id,{previousStatus:old.status,newStatus:transition.status,reason:x.comment});
   return Response.json({ok:true,status:transition.status});
  }
 }
 if(user.role==='SUPER_ADMIN'){ 
  if(action==='organization'){
    const data=z.object({name:z.string().min(2),code:z.string().min(2).max(25),timezone:z.string().refine(isValidTimezone,'Timezone must be a valid IANA zone such as Africa/Bujumbura.'),domain:z.string().max(200).optional().nullable(),logoUrl:logoUrlSchema.optional().nullable(),id:z.string().optional(),active:z.boolean().optional()}).parse(raw.data);
   const [org]=data.id?await db.update(organizations).set({name:data.name,code:data.code.toUpperCase(),timezone:data.timezone,domain:data.domain||null,logoUrl:data.logoUrl||null,active:data.active??true,updatedAt:new Date()}).where(eq(organizations.id,data.id)).returning():await db.insert(organizations).values({name:data.name,code:data.code.toUpperCase(),timezone:data.timezone,domain:data.domain||null,logoUrl:data.logoUrl||null}).returning();
   if(!org) throw new AppError('Organization not found.',404);
   if(!data.id){await db.insert(settings).values({organizationId:org.id}); await db.insert(grades).values(Array.from({length:13},(_,i)=>({organizationId:org.id,name:`Grade ${i+1}`,orderIndex:i+1})));}
   await audit(null,user.id,data.id?'ORGANIZATION_UPDATED':'ORGANIZATION_CREATED','organization',org.id);return Response.json({ok:true});
  }
   if(action==='updateAdmin'){
    const data=z.object({organizationId:z.string().uuid(),userId:z.string().uuid(),name:z.string().min(2),username:z.string().min(3),email:z.email()}).parse(raw.data);
    const [targetOrg]=await db.select().from(organizations).where(eq(organizations.id,data.organizationId));
    if(!targetOrg)throw new AppError('Organization not found.',404);
    if(targetOrg.primaryAdminUserId!==data.userId)throw new AppError('That user is not the primary administrator of this school.',409);
    const username=data.username.toLowerCase(),email=data.email.toLowerCase();
    const clashes=await db.select({id:users.id}).from(users).where(or(eq(users.username,username),eq(users.email,email))).limit(5);
    if(clashes.some(u=>u.id!==data.userId))throw new AppError('That username or email is already in use.');
    const [updated]=await db.update(users).set({name:data.name.trim(),username,email,updatedAt:new Date()}).where(and(eq(users.id,data.userId),eq(users.organizationId,data.organizationId),eq(users.role,'ADMIN'))).returning({id:users.id});
    if(!updated)throw new AppError('Administrator not found.',404);
    await audit(null,user.id,'ADMIN_UPDATED','user',data.userId,{organizationId:data.organizationId});
    return Response.json({ok:true});
   }
   if(action==='resetAdmin'){
   const x=z.object({organizationId:z.string(),password:passwordSchema}).parse(raw.data);
   const [org]=await db.select().from(organizations).where(eq(organizations.id,x.organizationId));
   if(!org?.primaryAdminUserId)throw new AppError('Organization administrator not found.',404);
   const [admin]=await db.select({id:users.id}).from(users).where(and(eq(users.id,org.primaryAdminUserId),eq(users.organizationId,org.id),eq(users.role,'ADMIN')));
   if(!admin)throw new AppError('Administrator not found.',404);
   await db.update(users).set({passwordHash:await hash(x.password,8),active:true,updatedAt:new Date()}).where(eq(users.id,admin.id));
   await db.delete(sessions).where(eq(sessions.userId,admin.id));
   await audit(null,user.id,'ADMIN_ACCESS_RESET','user',admin.id,{organizationId:org.id});return Response.json({ok:true});
  }
  if(action==='admin'){
   const data=z.object({organizationId:z.string(),name:z.string().min(2),username:z.string().min(3),email:z.email(),password:passwordSchema}).parse(raw.data);
   const [org]=await db.select().from(organizations).where(eq(organizations.id,data.organizationId));if(!org)throw new AppError('Organization not found.',404);
   if((await db.select({id:users.id}).from(users).where(or(eq(users.username,data.username.toLowerCase()),eq(users.email,data.email.toLowerCase()))).limit(1)).length)throw new AppError('That username or email is already in use.',409);
   const passwordHash=await hash(data.password,8);
   const admin=await runTransaction(async tx=>{if(org.primaryAdminUserId){await tx.update(users).set({active:false,updatedAt:new Date()}).where(and(eq(users.id,org.primaryAdminUserId),eq(users.organizationId,org.id)));}const [created]=await tx.insert(users).values({organizationId:org.id,name:data.name,username:data.username.toLowerCase(),email:data.email.toLowerCase(),passwordHash,role:'ADMIN'}).returning();await tx.update(organizations).set({primaryAdminUserId:created.id,updatedAt:new Date()}).where(eq(organizations.id,org.id));return created;});await audit(null,user.id,org.primaryAdminUserId?'ADMIN_REPLACED':'ADMIN_CREATED','user',admin.id,{organizationId:org.id});return Response.json({ok:true});
  }
  throw new AppError('Unknown action.',404);
 }
  // Logged with the offending action and role so production 403s can be traced to a screen.
  if(user.role!=='ADMIN'){console.error(`[api] blocked action=${action} role=${user.role} user=${user.id}`);throw new AppError('Administrator access required.',403);}
 const org=await orgFor(user);const oid=org.id;
 if(action==='resetTeacherPassword'){
   const x=z.object({teacherId:z.string().uuid(),password:passwordSchema}).parse(raw.data);
   const [target]=await db.select().from(teachers).where(and(eq(teachers.id,x.teacherId),eq(teachers.organizationId,oid)));
   if(!target)throw new AppError('Teacher not found.',404);
   const passwordHash=await hash(x.password,8);
   await runTransaction(async tx=>{
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
   await audit(oid,user.id,'ADMIN_DATE_CORRECTION','monthly_lesson',old.id,{originalDate:old.lessonDate,newDate:x.lessonDate,reason:x.reason});return Response.json({ok:true});
 }
 if(action==='teacherAccess'){ 
   const x=z.object({teacherId:z.string().uuid(),active:z.boolean()}).parse(raw.data);
   const [target]=await db.select().from(teachers).where(and(eq(teachers.id,x.teacherId),eq(teachers.organizationId,oid)));
   if(!target)throw new AppError('Teacher not found.',404);
   await runTransaction(async tx=>{
     await tx.update(teachers).set({active:x.active,updatedAt:new Date()}).where(eq(teachers.id,target.id));
     await tx.update(users).set({active:x.active,updatedAt:new Date()}).where(and(eq(users.id,target.userId),eq(users.organizationId,oid),eq(users.role,'TEACHER')));
     if(!x.active)await tx.delete(sessions).where(eq(sessions.userId,target.userId));
   });
   await audit(oid,user.id,x.active?'ACCOUNT_ACTIVATED':'ACCOUNT_DEACTIVATED','teacher',target.id,{previous:target.active,new:x.active});return Response.json({ok:true});
 }
  if(action==='import'){
   const input=z.object({kind:z.enum(['students','teachers','assignments']),rows:z.array(z.record(z.string(),z.unknown())).min(1).max(1000)}).parse(raw.data);
   const [loadedClasses,loadedGrades,loadedYears,loadedSubjects,allTeachers,loadedAssignments]=await Promise.all([db.select().from(classes).where(eq(classes.organizationId,oid)),db.select().from(grades).where(eq(grades.organizationId,oid)),db.select().from(academicYears).where(eq(academicYears.organizationId,oid)),db.select().from(subjects).where(eq(subjects.organizationId,oid)),db.select().from(teachers).where(eq(teachers.organizationId,oid)),db.select().from(assignments).where(eq(assignments.organizationId,oid))]);
   const allClasses=[...loadedClasses],allGrades=[...loadedGrades],allYears=[...loadedYears],allSubjects=[...loadedSubjects];
   const clean=(v:unknown)=>String(v??'').trim();const errors:{row:number;reason:string}[]=[];
   const credentials:{teacherId:string;name:string;email:string;username:string;password:string;emailProvided:boolean}[]=[];
   const created={grades:0,classes:0,subjects:0,years:0};let imported=0,updated=0,assignmentsCreated=0,assignmentsUpdated=0;
    const assignmentIndex=new Map(loadedAssignments.map(a=>[`${a.teacherId}|${a.classId}|${a.subjectId}|${a.academicYearId}`,a]));
    // Teacher sign-in names come from the spreadsheet name column (lowercase); collisions get a numeric suffix.
    const claimedUsernames=new Set<string>();
    const claimUsername=async(base:string)=>{const root=base||'teacher';let candidate=root;for(let n=2;;n++){const taken=claimedUsernames.has(candidate)||(await db.select({id:users.id}).from(users).where(eq(users.username,candidate)).limit(1)).length>0;if(!taken)break;candidate=`${root}${n}`;}claimedUsernames.add(candidate);return candidate;};
    const activeYear=()=>{const today=new Date().toISOString().slice(0,10);const active=allYears.filter(y=>y.active);const running=active.find(y=>(!y.startDate||y.startDate<=today)&&(!y.endDate||y.endDate>=today));if(running)return running;const latest=[...active].sort((a,b)=>String(b.startDate||'').localeCompare(String(a.startDate||'')))[0];return latest||allYears[0];};
    const ensureYear=async(name:string)=>{const digits=(v:string)=>v.replace(/\D/g,'');const want=digits(name);const found=allYears.find(y=>y.name.toLowerCase()===name.toLowerCase())||(want.length===8?allYears.find(y=>digits(y.name)===want):undefined);if(found)return found;const m=/^(\d{4})\s*[-–—]\s*(\d{4})$/.exec(name);if(!m)throw Error('Academic year does not exist in this school.');const [year]=await db.insert(academicYears).values({organizationId:oid,name:`${m[1]}-${m[2]}`,startDate:`${m[1]}-08-01`,endDate:`${m[2]}-07-31`,active:true}).returning();allYears.push(year);created.years++;return year;};
   const ensureGrade=async(name:string)=>{const found=allGrades.find(g=>g.name.toLowerCase()===name.toLowerCase());if(found)return found;const [grade]=await db.insert(grades).values({organizationId:oid,name,orderIndex:allGrades.length+1,active:true}).returning();allGrades.push(grade);created.grades++;return grade;};
   const ensureClass=async(name:string,gradeId:string,yearId:string)=>{const found=allClasses.find(c=>c.name.toLowerCase()===name.toLowerCase()&&c.academicYearId===yearId);if(found)return found;const [record]=await db.insert(classes).values({organizationId:oid,gradeId,academicYearId:yearId,name,active:true}).returning();allClasses.push(record);created.classes++;return record;};
   const ensureSubject=async(rawName:string)=>{const name=canonicalSubjectName(rawName);if(!name)throw Error('Subject name is required.');const found=allSubjects.find(s=>s.name.toLowerCase()===name.toLowerCase()||subjectKey(s.name)===subjectKey(name));if(found)return found;const [subject]=await db.insert(subjects).values({organizationId:oid,name,code:subjectCodeFor(name,new Set(allSubjects.map(s=>s.code))),active:true}).returning();allSubjects.push(subject);created.subjects++;return subject;};
   // A bare class code such as "7" prefers that year's sections (7A, 7B) over an empty bare class.
    const resolveClasses=async(name:string,yearId:string)=>{const lower=name.toLowerCase();const bare=/^\d+$/.test(name);const sections=bare?allClasses.filter(c=>c.academicYearId===yearId&&new RegExp(`^${name}[a-z]+$`,'i').test(c.name)):[];if(sections.length)return sections;const inYear=allClasses.filter(c=>c.name.toLowerCase()===lower&&c.academicYearId===yearId);if(inYear.length)return inYear;const anywhere=allClasses.filter(c=>c.name.toLowerCase()===lower);if(anywhere.length)return anywhere;const grade=await ensureGrade(gradeNameForClass(name));return [await ensureClass(name,grade.id,yearId)];};
   for(let i=0;i<input.rows.length;i++)try{
   const row=input.rows[i];
    if(input.kind==='students'){
     const code=clean(row['Student ID']);const name=clean(row['Student Name']);const gradeName=clean(row['Grade']);const className=clean(row['Class']);const yearName=clean(row['Academic Year']);const statusRaw=clean(row['Status']).toUpperCase();
     if(!code||!name||!className||(statusRaw&&!['ACTIVE','INACTIVE'].includes(statusRaw)))throw Error('Invalid student ID, name or class.');
     const y=yearName?await ensureYear(yearName):activeYear();if(!y)throw Error('Create an academic year before importing students.');
     // The stored class is the source of truth for the grade so the two can never disagree.
     let c=allClasses.find(x=>x.name.toLowerCase()===className.toLowerCase()&&x.academicYearId===y.id);
     if(!c){const g=await ensureGrade(gradeName||gradeNameForClass(className));c=await ensureClass(className,g.id,y.id);}
     const parts=name.split(/\s+/);const firstName=parts.shift()||name,lastName=parts.join(' ')||'—';const [old]=await db.select().from(students).where(and(eq(students.organizationId,oid),eq(students.studentId,code)));
     if(old){await db.update(students).set({firstName,lastName,fullName:name,gradeId:c.gradeId,classId:c.id,academicYearId:y.id,...(statusRaw?{status:statusRaw}:{}),updatedAt:new Date()}).where(eq(students.id,old.id));updated++;}
     else{const status=statusRaw||'ACTIVE';await db.insert(students).values({organizationId:oid,studentId:code,firstName,lastName,fullName:name,gradeId:c.gradeId,classId:c.id,academicYearId:y.id,status});imported++;}
    }else if(input.kind==='teachers'){
     const keys=Object.keys(row).map(k=>k.trim().toUpperCase());const has=(list:string[])=>list.some(k=>keys.includes(k));
     const hasRosterColumns=(has(['SUBJECTS'])&&has(['CLASSES']))||(has(['NO'])&&has(['NAME'])&&has(['SURNAME']));
     if(hasRosterColumns){
      const roster=normalizeTeacherAssignmentImportRow(row as Record<string,string>);
      const teacherName=`${roster.name} ${roster.surname}`.trim();
      if(!teacherName)throw Error('Teacher row requires a name.');
      const parsedEmail=z.email().safeParse(roster.email.toLowerCase());const hasEmail=parsedEmail.success;
      let teacherId=roster.teacherId;
      if(!teacherId||teacherId==='AUTO-TEACHER')teacherId=hasEmail?`T-${roster.email.split('@')[0]}`:`T-${teacherName.toLowerCase().replace(/[^a-z0-9]+/g,'-').replace(/^-+|-+$/g,'').slice(0,24)}`;
      const email=hasEmail?parsedEmail.data:'';
      const [byCode]=await db.select().from(teachers).where(and(eq(teachers.organizationId,oid),eq(teachers.teacherId,teacherId))).limit(1);
      const byEmail=hasEmail?(await db.select().from(teachers).where(and(eq(teachers.organizationId,oid),eq(teachers.email,email))).limit(1))[0]:undefined;
      const existing=byCode||byEmail;
      let teacherRecord=existing;
      if(existing){
       const current=existing;
       await runTransaction(async tx=>{
        await tx.update(users).set({name:teacherName,updatedAt:new Date(),...(hasEmail?{email}:{})}).where(and(eq(users.id,current.userId),eq(users.organizationId,oid)));
        await tx.update(teachers).set({name:teacherName,updatedAt:new Date(),...(hasEmail?{email}:{})}).where(eq(teachers.id,current.id));
       });
       updated++;
      }else{
        const finalEmail=hasEmail?email:placeholderTeacherEmail(teacherId,teacherName,oid);
        const password=initialTeacherPassword();const username=await claimUsername(usernameFromName(roster.name)||usernameFromName(teacherName)||`t${teacherId}`);const passwordHash=await hash(password,8);
       teacherRecord=await runTransaction(async tx=>{
        const [u]=await tx.insert(users).values({organizationId:oid,name:teacherName,email:finalEmail,username,passwordHash,role:'TEACHER'}).returning();
         const [t]=await tx.insert(teachers).values({organizationId:oid,userId:u.id,teacherId,name:teacherName,email:finalEmail}).returning();
        return t;
       });
       credentials.push({teacherId,name:teacherName,email:finalEmail,username,password,emailProvided:hasEmail});
       imported++;
      }
      if(roster.subjects.length&&roster.classes.length&&teacherRecord){
       const record=teacherRecord;const yearRecord=activeYear();if(!yearRecord)throw Error('Create an academic year before importing teacher assignments.');
       for(const subjectName of roster.subjects){
        const subject=await ensureSubject(subjectName);
        for(const className of roster.classes){
         for(const classRecord of await resolveClasses(className,yearRecord.id)){
          const assignmentKey=`${record.id}|${classRecord.id}|${subject.id}|${classRecord.academicYearId}`;
          const existingAssignment=assignmentIndex.get(assignmentKey);
          if(existingAssignment){if(!existingAssignment.active){await db.update(assignments).set({active:true,updatedAt:new Date()}).where(eq(assignments.id,existingAssignment.id));assignmentsUpdated++;}}
          else{const [stored]=await db.insert(assignments).values({organizationId:oid,teacherId:record.id,classId:classRecord.id,subjectId:subject.id,academicYearId:classRecord.academicYearId,active:true}).returning();assignmentIndex.set(assignmentKey,stored);assignmentsCreated++;}
         }
        }
       }
      }
     }else{
      const teacherId=clean(row['Teacher ID']),name=clean(row['Teacher Name']),email=clean(row['Email']).toLowerCase();if(!teacherId||!name||!z.email().safeParse(email).success)throw Error('Invalid teacher ID, name or email.');
      const [old]=await db.select().from(teachers).where(and(eq(teachers.organizationId,oid),eq(teachers.teacherId,teacherId)));
      if(old){await runTransaction(async tx=>{await tx.update(users).set({name,email,updatedAt:new Date()}).where(and(eq(users.id,old.userId),eq(users.organizationId,oid)));await tx.update(teachers).set({name,email,updatedAt:new Date()}).where(eq(teachers.id,old.id));});updated++;}
      else{const password=initialTeacherPassword();const username=await claimUsername(usernameFromName(name)||`t${teacherId}`);const passwordHash=await hash(password,8);await runTransaction(async tx=>{const [u]=await tx.insert(users).values({organizationId:oid,name,email,username,passwordHash,role:'TEACHER'}).returning();await tx.insert(teachers).values({organizationId:oid,userId:u.id,teacherId,name,email});});credentials.push({teacherId,name,email,username,password,emailProvided:true});imported++;}
     }
   }else{
    const email=clean(row['Teacher Email']).toLowerCase(),className=clean(row['Class']),subjectName=clean(row['Subject']),yearName=clean(row['Academic Year']);const t=allTeachers.find(x=>x.email.toLowerCase()===email),y=allYears.find(x=>x.name===yearName),c=allClasses.find(x=>x.name.toLowerCase()===className.toLowerCase()&&x.academicYearId===y?.id),s=allSubjects.find(x=>x.name.toLowerCase()===subjectName.toLowerCase());if(!t||!y||!c||!s)throw Error('Teacher, class, subject or year not found in this organization.');const [old]=await db.select().from(assignments).where(and(eq(assignments.organizationId,oid),eq(assignments.teacherId,t.id),eq(assignments.classId,c.id),eq(assignments.subjectId,s.id),eq(assignments.academicYearId,y.id)));const active=!['NO','FALSE','INACTIVE','0'].includes(clean(row['Active']).toUpperCase());if(old){await db.update(assignments).set({active,updatedAt:new Date()}).where(eq(assignments.id,old.id));updated++;}else{await db.insert(assignments).values({organizationId:oid,teacherId:t.id,classId:c.id,subjectId:s.id,academicYearId:y.id,active});imported++;}
   }
  }catch(e){const message=e instanceof Error?e.message:'';const known=['Invalid student ID, name or class.','Academic year does not exist in this school.','Create an academic year before importing students.','Create an academic year before importing teacher assignments.','Teacher row requires a name.','Invalid teacher ID, name or email.','Teacher, class, subject or year not found in this organization.'];
   let reason=known.includes(message)?message:'Could not import this row. Check duplicate IDs, email addresses and values.';
   if(/constraint failed/i.test(message))reason='A record with this student ID or email address already exists.';
   const label=input.kind==='students'?clean(input.rows[i]['Student ID'])||clean(input.rows[i]['Student Name']):clean(input.rows[i]['Teacher ID'])||clean(input.rows[i]['Teacher Name'])||clean(input.rows[i]['Teacher Email']);
   errors.push({row:i+2,reason:label?`${label} — ${reason}`:reason});}
   await audit(oid,user.id,'DATA_IMPORT',input.kind,undefined,{imported,updated,errors:errors.length,credentials:credentials.length,assignments:assignmentsCreated,created});
   return Response.json({imported,updated,skipped:errors.length,errors,credentials,created,assignments:{created:assignmentsCreated,updated:assignmentsUpdated}});
 }
 if(action==='create'){
   const type=z.enum(['year','term','grade','class','subject','student','teacher','assignment']).parse(raw.type);const d=raw.data; let entityId=''; let reassignedFrom:string[]=[];
  if(type==='year'){const x=z.object({name:z.string().min(3),startDate:z.string(),endDate:z.string()}).parse(d);const [r]=await db.insert(academicYears).values({...x,organizationId:oid}).returning();entityId=r.id;}
  if(type==='term'){const x=z.object({name:z.string().min(2),academicYearId:z.string(),startDate:z.string(),endDate:z.string()}).parse(d);if(!(await db.select().from(academicYears).where(and(eq(academicYears.id,x.academicYearId),eq(academicYears.organizationId,oid)))).length)throw new AppError('Invalid academic year.');const [r]=await db.insert(terms).values({...x,organizationId:oid}).returning();entityId=r.id;}
  if(type==='grade'){const x=z.object({name:z.string().min(2),orderIndex:z.coerce.number().int()}).parse(d);const [r]=await db.insert(grades).values({...x,organizationId:oid}).returning();entityId=r.id;}
  if(type==='class'){const x=z.object({name:z.string().min(1),gradeId:z.string(),academicYearId:z.string()}).parse(d);if(!(await db.select().from(grades).where(and(eq(grades.id,x.gradeId),eq(grades.organizationId,oid)))).length || !(await db.select().from(academicYears).where(and(eq(academicYears.id,x.academicYearId),eq(academicYears.organizationId,oid)))).length)throw new AppError('Invalid grade or year.');const [r]=await db.insert(classes).values({...x,organizationId:oid}).returning();entityId=r.id;}
  if(type==='subject'){const x=z.object({name:z.string().min(2),code:z.string().min(2)}).parse(d);const [r]=await db.insert(subjects).values({...x,organizationId:oid,code:x.code.toUpperCase()}).returning();entityId=r.id;}
  if(type==='student'){const x=z.object({studentId:z.string().min(1),firstName:z.string().min(1),lastName:z.string().min(1),gradeId:z.string(),classId:z.string(),academicYearId:z.string()}).parse(d);const [cl]=await db.select().from(classes).where(and(eq(classes.id,x.classId),eq(classes.organizationId,oid),eq(classes.gradeId,x.gradeId),eq(classes.academicYearId,x.academicYearId)));if(!cl)throw new AppError('Invalid class, grade or year.');const [r]=await db.insert(students).values({...x,fullName:`${x.firstName} ${x.lastName}`,organizationId:oid}).returning();entityId=r.id;}
  if(type==='teacher'){const x=z.object({teacherId:z.string().min(1),name:z.string().min(2),email:z.email(),username:z.string().min(3),password:passwordSchema}).parse(d);const username=x.username.toLowerCase(),email=x.email.toLowerCase();if((await db.select({id:users.id}).from(users).where(or(eq(users.username,username),eq(users.email,email))).limit(1)).length)throw new AppError('That username or email is already in use.',409);if((await db.select({id:teachers.id}).from(teachers).where(and(eq(teachers.organizationId,oid),eq(teachers.teacherId,x.teacherId))).limit(1)).length)throw new AppError('That teacher ID is already in use.',409);const passwordHash=await hash(x.password,8);entityId=await runTransaction(async tx=>{const [u]=await tx.insert(users).values({organizationId:oid,username,email,name:x.name,passwordHash,role:'TEACHER'}).returning();const [r]=await tx.insert(teachers).values({organizationId:oid,userId:u.id,teacherId:x.teacherId,name:x.name,email:x.email}).returning();return r.id;});}
  if(type==='assignment'){const x=z.object({teacherId:z.string().min(1),classId:z.string().min(1),subjectId:z.string().min(1),academicYearId:z.string().min(1)}).parse(d);const [[t],[c],[s],[y]]=await Promise.all([db.select().from(teachers).where(and(eq(teachers.id,x.teacherId),eq(teachers.organizationId,oid))).limit(1),db.select().from(classes).where(and(eq(classes.id,x.classId),eq(classes.organizationId,oid))).limit(1),db.select().from(subjects).where(and(eq(subjects.id,x.subjectId),eq(subjects.organizationId,oid))).limit(1),db.select().from(academicYears).where(and(eq(academicYears.id,x.academicYearId),eq(academicYears.organizationId,oid))).limit(1)]);if(!t)throw new AppError('Teacher not found.');if(!y)throw new AppError('Academic year not found.');if(!c)throw new AppError('Class not found.');if(c.academicYearId!==y.id)throw new AppError('That class belongs to a different academic year.');if(!s)throw new AppError('Subject not found.');const [existing]=await db.select().from(assignments).where(and(eq(assignments.organizationId,oid),eq(assignments.teacherId,x.teacherId),eq(assignments.classId,x.classId),eq(assignments.subjectId,x.subjectId),eq(assignments.academicYearId,x.academicYearId)));if(existing){if(existing.active)throw new AppError('This assignment already exists.');await db.update(assignments).set({active:true,updatedAt:new Date()}).where(eq(assignments.id,existing.id));entityId=existing.id;}else{const [r]=await db.insert(assignments).values({...x,organizationId:oid,active:true}).returning();entityId=r.id;}
const displaced=await db.select({id:assignments.id,teacherName:teachers.name}).from(assignments).innerJoin(teachers,eq(teachers.id,assignments.teacherId)).where(and(eq(assignments.organizationId,oid),eq(assignments.classId,x.classId),eq(assignments.subjectId,x.subjectId),eq(assignments.academicYearId,x.academicYearId),not(eq(assignments.teacherId,x.teacherId)),eq(assignments.active,true)));
if(displaced.length){await db.update(assignments).set({active:false,updatedAt:new Date()}).where(inArray(assignments.id,displaced.map(r=>r.id)));reassignedFrom=[...new Set(displaced.map(r=>r.teacherName))];for(const row of displaced)await audit(oid,user.id,'ASSIGNMENT_DEACTIVATED','assignment',row.id,{reassignedTo:t.name});}}
   await audit(oid,user.id,`${type.toUpperCase()}_CREATED`,type,entityId);return Response.json({ok:true,...(reassignedFrom.length?{reassignedFrom}:{})});
 }
 if(action==='updateEntity'){
  const type=z.enum(['year','term','grade','class','subject','student','teacher','assignment']).parse(raw.type);
  const d=raw.data; const id=z.string().uuid().parse(d.id); let reassignedFrom:string[]=[];
  if(type==='student'){
    const x=z.object({firstName:z.string().min(1),lastName:z.string().min(1),studentId:z.string().min(1),gradeId:z.string(),classId:z.string(),academicYearId:z.string(),status:z.enum(['ACTIVE','INACTIVE'])}).parse(d);
    await db.update(students).set({...x,fullName:`${x.firstName} ${x.lastName}`,updatedAt:new Date()}).where(and(eq(students.id,id),eq(students.organizationId,oid)));
  }
  if(type==='teacher'){
    const x=z.object({name:z.string().min(2),email:z.email(),username:z.string().max(60).optional(),active:z.boolean()}).parse(d);
    const [t]=await db.select().from(teachers).where(and(eq(teachers.id,id),eq(teachers.organizationId,oid)));
    if(!t)throw new AppError('Teacher not found.',404);
    const username=x.username?.trim().toLowerCase()||undefined;
    if(username){
      if(username.length<3)throw new AppError('Username must be at least 3 characters.');
      if(!/^[a-z0-9._-]+$/.test(username))throw new AppError('Username may use letters, numbers, dot, dash or underscore.');
      const clashes=await db.select({id:users.id}).from(users).where(eq(users.username,username)).limit(5);
      if(clashes.some(c=>c.id!==t.userId))throw new AppError('That username is already in use.',409);
    }
    await runTransaction(async tx=>{
      await tx.update(teachers).set({name:x.name,email:x.email.toLowerCase(),active:x.active,updatedAt:new Date()}).where(eq(teachers.id,id));
      await tx.update(users).set({name:x.name,email:x.email.toLowerCase(),active:x.active,updatedAt:new Date(),...(username?{username}:{})}).where(and(eq(users.id,t.userId),eq(users.organizationId,oid)));
      if(!x.active)await tx.delete(sessions).where(eq(sessions.userId,t.userId));
    });
    if(username)await audit(oid,user.id,'USERNAME_CHANGED','user',t.userId,{username});
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
    const x=z.object({teacherId:z.string().min(1).optional(),classId:z.string().min(1).optional(),subjectId:z.string().min(1).optional(),academicYearId:z.string().min(1).optional(),active:z.boolean().optional()}).parse(d);
    const [current]=await db.select().from(assignments).where(and(eq(assignments.id,id),eq(assignments.organizationId,oid)));
    if(!current)throw new AppError('Assignment not found.',404);
    const next={teacherId:x.teacherId??current.teacherId,classId:x.classId??current.classId,subjectId:x.subjectId??current.subjectId,academicYearId:x.academicYearId??current.academicYearId,active:x.active??current.active};
    const [[t],[c],[s],[y]]=await Promise.all([db.select().from(teachers).where(and(eq(teachers.id,next.teacherId),eq(teachers.organizationId,oid))).limit(1),db.select().from(classes).where(and(eq(classes.id,next.classId),eq(classes.organizationId,oid))).limit(1),db.select().from(subjects).where(and(eq(subjects.id,next.subjectId),eq(subjects.organizationId,oid))).limit(1),db.select().from(academicYears).where(and(eq(academicYears.id,next.academicYearId),eq(academicYears.organizationId,oid))).limit(1)]);
    if(!t)throw new AppError('Teacher not found.');if(!y)throw new AppError('Academic year not found.');if(!c)throw new AppError('Class not found.');if(c.academicYearId!==y.id)throw new AppError('That class belongs to a different academic year.');if(!s)throw new AppError('Subject not found.');
    const clashes=await db.select().from(assignments).where(and(eq(assignments.organizationId,oid),eq(assignments.teacherId,next.teacherId),eq(assignments.classId,next.classId),eq(assignments.subjectId,next.subjectId),eq(assignments.academicYearId,next.academicYearId)));
    if(clashes.some(a=>a.id!==id))throw new AppError('Another assignment already uses this teacher, class, subject and year.');
    await db.update(assignments).set({...next,updatedAt:new Date()}).where(and(eq(assignments.id,id),eq(assignments.organizationId,oid)));
    if(next.active){
      const displaced=await db.select({id:assignments.id,teacherName:teachers.name}).from(assignments).innerJoin(teachers,eq(teachers.id,assignments.teacherId)).where(and(eq(assignments.organizationId,oid),eq(assignments.classId,next.classId),eq(assignments.subjectId,next.subjectId),eq(assignments.academicYearId,next.academicYearId),not(eq(assignments.teacherId,next.teacherId)),eq(assignments.active,true)));
      if(displaced.length){await db.update(assignments).set({active:false,updatedAt:new Date()}).where(inArray(assignments.id,displaced.map(r=>r.id)));reassignedFrom=[...new Set(displaced.map(r=>r.teacherName))];for(const row of displaced)await audit(oid,user.id,'ASSIGNMENT_DEACTIVATED','assignment',row.id,{reassignedTo:t.name});}
    }
  }
  await audit(oid,user.id,`${type.toUpperCase()}_UPDATED`,type,id);
  return Response.json({ok:true,...(reassignedFrom.length?{reassignedFrom}:{})});
 }
 if(action==='deleteEntity'){
  const type=z.enum(['assignment','term','grade','class','subject','student','club']).parse(raw.type);
  const id=z.string().uuid().parse(raw.id);
  if(type==='assignment'){
    await db.delete(assignments).where(and(eq(assignments.id,id),eq(assignments.organizationId,oid)));
  } else if(type==='student'){
    await db.update(students).set({status:'INACTIVE',updatedAt:new Date()}).where(and(eq(students.id,id),eq(students.organizationId,oid)));
  } else if(type==='class'){
    await db.update(classes).set({active:false,updatedAt:new Date()}).where(and(eq(classes.id,id),eq(classes.organizationId,oid)));
  } else if(type==='subject'){
    await db.update(subjects).set({active:false,updatedAt:new Date()}).where(and(eq(subjects.id,id),eq(subjects.organizationId,oid)));
   } else if(type==='club'){
    await db.update(clubs).set({active:false,updatedAt:new Date()}).where(and(eq(clubs.id,id),eq(clubs.organizationId,oid)));
   } else if(type==='term'){
    await db.update(terms).set({active:false}).where(and(eq(terms.id,id),eq(terms.organizationId,oid)));
   } else if(type==='grade'){
    await db.update(grades).set({active:false}).where(and(eq(grades.id,id),eq(grades.organizationId,oid)));
   }
  await audit(oid,user.id,`${type.toUpperCase()}_DEACTIVATED`,type,id);
  return Response.json({ok:true});
 }
 if(action==='review'){
   const x=z.object({id:z.string(),status:z.enum(['UNDER_REVIEW','APPROVED','RETURNED','SUBMITTED']),comment:z.string().max(1000).optional()}).parse(raw.data);
   const [old]=await db.select().from(lessons).where(and(eq(lessons.id,x.id),eq(lessons.organizationId,oid)));
   if(!old){
    const [entry]=await db.select().from(monthlyEntries).where(and(eq(monthlyEntries.id,x.id),eq(monthlyEntries.organizationId,oid))).limit(1);
    if(!entry)throw new AppError('Report not found.',404);
    const transition=reviewTransition(entry.status,x.status,x.comment);
    await db.update(monthlyEntries).set({status:transition.status,reviewComment:x.comment?.trim()||null,reviewedAt:new Date(),reviewedBy:user.id,updatedAt:new Date()}).where(and(eq(monthlyEntries.id,x.id),eq(monthlyEntries.organizationId,oid),eq(monthlyEntries.status,entry.status)));
    await audit(oid,user.id,transition.auditAction,'monthly_entry',x.id,{previousStatus:entry.status,newStatus:transition.status,reason:x.comment});return Response.json({ok:true});
   }
   const transition=reviewTransition(old.status,x.status,x.comment);
   await db.update(lessons).set({status:transition.status,reviewComment:x.comment?.trim()||null,reviewedAt:new Date(),reviewedBy:user.id,updatedAt:new Date()}).where(and(eq(lessons.id,x.id),eq(lessons.organizationId,oid),eq(lessons.status,old.status)));await audit(oid,user.id,transition.auditAction,'monthly_lesson',x.id,{previousStatus:old.status,newStatus:transition.status,reason:x.comment});return Response.json({ok:true});
  }
  if(action==='settings'){
   const x=z.object({name:z.string().min(2).optional(),logoUrl:logoUrlSchema.optional().nullable(),timezone:z.string().refine(isValidTimezone,'Timezone must be a valid IANA zone such as Africa/Bujumbura.'),excellentThreshold:z.coerce.number().min(1).max(3),goodThreshold:z.coerce.number().min(1).max(3),homeworkUsuallyThreshold:z.coerce.number().min(0).max(1),punctualityOccasionallyMax:z.coerce.number().min(0).max(1)}).parse(raw.data);
   await db.update(organizations).set({name:x.name||org.name,logoUrl:x.logoUrl!==undefined?x.logoUrl:org.logoUrl,timezone:x.timezone,updatedAt:new Date()}).where(eq(organizations.id,oid));
    await db.update(settings).set({excellentThreshold:x.excellentThreshold,goodThreshold:x.goodThreshold,homeworkUsuallyThreshold:x.homeworkUsuallyThreshold,punctualityOccasionallyMax:x.punctualityOccasionallyMax,version:(await db.select().from(settings).where(eq(settings.organizationId,oid)))[0].version+1,updatedAt:new Date()}).where(eq(settings.organizationId,oid));
   await audit(oid,user.id,'CONFIGURATION_CHANGED','settings',oid);
   return Response.json({ok:true});
  }
 if(action==='month'){
   const x=z.object({month:z.string().regex(MONTH_PATTERN),closed:z.boolean()}).parse(raw.data);
   await runTransaction(async tx=>{
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
  if(action==='updateMyAccount'){
    const x=z.object({username:z.string().min(3).max(60)}).parse(raw.data);
    const username=x.username.trim().toLowerCase();
    if(!/^[a-z0-9._-]+$/.test(username))throw new AppError('Username may use letters, numbers, dot, dash or underscore.',400);
    const clashes=await db.select({id:users.id}).from(users).where(eq(users.username,username)).limit(5);
    if(clashes.some(c=>c.id!==user.id))throw new AppError('That username is already in use.',409);
    await db.update(users).set({username,updatedAt:new Date()}).where(eq(users.id,user.id));
    await audit(oid,user.id,'USERNAME_CHANGED','user',user.id,{username});
    return Response.json({ok:true,username});
  }
   throw new AppError('Unknown action.',404);
 }catch(e){return fail(e);}}


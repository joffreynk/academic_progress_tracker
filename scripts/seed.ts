import 'dotenv/config';
import { hash } from 'bcryptjs';
import { db } from '../src/db';
import { organizations, users, teachers, students, grades, classes, subjects, academicYears, terms, assignments, lessons, records, settings } from '../src/db/schema';
import { eq } from 'drizzle-orm';

async function main(){
 if(process.env.NODE_ENV==='production')throw Error('Development seed is disabled in production.');
 const password=process.env.DEMO_PASSWORD;if(!password||password.length<12)throw Error('Set DEMO_PASSWORD with at least 12 characters.');
 const superExisting=await db.select().from(users).where(eq(users.email,'super@demo.school')).limit(1);if(!superExisting.length)await db.insert(users).values({name:'Demo Platform Admin',email:'super@demo.school',username:'demo.super',passwordHash:await hash(password,12),role:'SUPER_ADMIN'});
 const existing=await db.select().from(organizations).where(eq(organizations.code,'DEMO')).limit(1);if(existing.length){console.log('Demo organization already exists. Super administrator is available.');return;}
 const [org]=await db.insert(organizations).values({name:'Demo International School',code:'DEMO',timezone:'Africa/Bujumbura'}).returning();await db.insert(settings).values({organizationId:org.id});
 const passwordHash=await hash(password,12);
 const [admin]=await db.insert(users).values({organizationId:org.id,name:'Amara Niyonkuru',email:'admin@demo.school',username:'demo.admin',passwordHash,role:'ADMIN'}).returning();await db.update(organizations).set({primaryAdminUserId:admin.id}).where(eq(organizations.id,org.id));
 const gradeRows=await db.insert(grades).values(Array.from({length:13},(_,i)=>({organizationId:org.id,name:`Grade ${i+1}`,orderIndex:i+1}))).returning();
 const [year]=await db.insert(academicYears).values({organizationId:org.id,name:'2026-2027',startDate:'2026-08-01',endDate:'2027-07-31'}).returning();
 const termRows=await db.insert(terms).values([{organizationId:org.id,academicYearId:year.id,name:'Term 1',startDate:'2026-08-01',endDate:'2026-12-20'},{organizationId:org.id,academicYearId:year.id,name:'Term 2',startDate:'2027-01-05',endDate:'2027-03-31'},{organizationId:org.id,academicYearId:year.id,name:'Term 3',startDate:'2027-04-01',endDate:'2027-07-31'}]).returning();
 const cls=await db.insert(classes).values(['7A','7B','8A','8B','9A','10B','11A'].map(n=>({organizationId:org.id,name:n,gradeId:gradeRows[Number.parseInt(n)-1].id,academicYearId:year.id}))).returning();
 const subj=await db.insert(subjects).values(['English','Mathematics','Science','Computing','Global Citizenship','French','Turkish','Kirundi','Physics'].map(name=>({organizationId:org.id,name,code:name.toUpperCase().replaceAll(' ','_')}))).returning();
 const people=[['John Smith','john@demo.school','T001','Mathematics'],['Sarah Adams','sarah@demo.school','T002','Languages'],['Jean-Pierre Ndayizeye','jean@demo.school','T003','Science'],['Mariam Yusuf','mariam@demo.school','T004','Computing'],['Elena Martin','elena@demo.school','T005','Languages']];
 const tRows:(typeof teachers.$inferSelect)[]=[];for(const [name,email,teacherId,department] of people){const [u]=await db.insert(users).values({organizationId:org.id,name,email,username:email.split('@')[0],passwordHash,role:'TEACHER'}).returning();const [t]=await db.insert(teachers).values({organizationId:org.id,userId:u.id,teacherId,name,email,department}).returning();tRows.push(t);}
 const matches:[[number,string,string],...[number,string,string][]]=[[0,'7A','Mathematics'],[0,'8A','Mathematics'],[0,'10B','Physics'],[0,'11A','Physics'],[1,'7A','English'],[1,'8B','English'],[1,'9A','Global Citizenship'],[2,'7B','Science'],[2,'8A','Science'],[2,'10B','Physics'],[3,'7A','Computing'],[3,'9A','Computing'],[4,'7B','French'],[4,'8B','Turkish'],[4,'11A','Kirundi']];
 const as=await db.insert(assignments).values(matches.map(([ti,cn,sn])=>({organizationId:org.id,teacherId:tRows[ti].id,classId:cls.find(c=>c.name===cn)!.id,subjectId:subj.find(s=>s.name===sn)!.id,academicYearId:year.id}))).returning();
 const first=['Aline','David','Eric','Sarah','Jean','Maya','Noah','Grace','Daniel','Amina','Fatima','Samuel','Lina','Peter','Nadia','Yasmin','Michael','Naomi','Imani','Lucas'];const last=['Niyonzima','Kamau','Habimana','Mugisha','Nkurunziza','Ochieng','Irakoze','Mutoni','Adebayo','Diallo','Uwimana','Sarr','Ndikumana','Nkurikiye','Kamanzi','Ndayisenga'];
 const stu=await db.insert(students).values(Array.from({length:105},(_,i)=>{const c=cls[i%cls.length];const firstName=first[(i*7)%first.length],lastName=last[(i*11)%last.length];return {organizationId:org.id,studentId:`DIS-${String(i+1).padStart(4,'0')}`,firstName,lastName,fullName:`${firstName} ${lastName}`,gradeId:c.gradeId,classId:c.id,academicYearId:year.id};})).returning();
 const dates=['2026-09-15','2026-09-17','2026-09-19','2026-09-22','2026-09-24','2026-09-26'];const topics=['Introduction and review','Foundations','Practice and application','Problem solving','Collaborative learning','Progress check'];
 for(let ai=0;ai<as.length;ai++){const a=as[ai];for(let di=0;di<dates.length;di++){
  const [l]=await db.insert(lessons).values({organizationId:org.id,teacherId:a.teacherId,classId:a.classId,subjectId:a.subjectId,academicYearId:year.id,termId:termRows[0].id,lessonDate:dates[di],topic:topics[di],status:di===5?'SUBMITTED':'APPROVED',submittedAt:new Date(`${dates[di]}T15:00:00Z`),reviewedAt:di===5?null:new Date(`${dates[di]}T16:00:00Z`),reviewedBy:di===5?null:admin.id}).returning();
  await db.insert(records).values(stu.filter(s=>s.classId===a.classId).map((s,si)=>{const n=(si+di+ai)%17,att=n===0?'ABSENT':n===1?'LATE':'PRESENT',perf=att==='ABSENT'?null:n===2?'NEEDS_IMPROVEMENT':n===3?'EXCELLENT':'GOOD';return {organizationId:org.id,dailyLessonId:l.id,studentId:s.id,attendanceStatus:att,performance:perf,participation:att==='ABSENT'?null:n===4?'PASSIVE':n===5?'MODERATE':'ACTIVE',homework:att==='ABSENT'?null:n===6?'NOT_COMPLETED':'COMPLETED',conduct:att==='ABSENT'?null:n===7?'NEEDS_IMPROVEMENT':'GOOD',comment:perf==='NEEDS_IMPROVEMENT'?'Needs extra support with this topic':n===7?'Needs a reminder about classroom expectations':null};}));
 }}
 console.log('Seeded Demo International School:',stu.length,'students,',tRows.length,'teachers,',as.length,'assignments and',as.length*dates.length,'reports.');console.log('Admin: admin@demo.school; teacher: john@demo.school; password: DEMO_PASSWORD from environment.');
}
main().catch(e=>{console.error(e);process.exit(1)});

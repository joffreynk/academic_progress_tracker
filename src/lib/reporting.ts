import { punctualityResultFromTally } from './monthly';
export type Observation={lessonDate:string;topic:string;lessonId:string;status:string;studentId:string;studentName:string;studentCode:string;className:string;subjectName:string;teacherName?:string;attendance:string;performance:string|null;conduct:string|null;punctuality:string|null;homework:string|null;participation:string|null;comment:string|null;source?:'lesson'|'monthly'};
export type Rules={version:number;excellentThreshold:number;goodThreshold:number;homeworkUsuallyThreshold:number;punctualityOccasionallyMax:number}|undefined;
export type MonthlyTrend={month:string;lessons:number;attendanceRate:number|null;performanceResult:string;homeworkResult:string;participationResult:string;conductResult:string;punctualityResult:string};
export type NormalRecord={attendance:'PRESENT'|'LATE'|'ABSENT';performance:'EXCELLENT'|'GOOD'|'NEEDS_IMPROVEMENT';conduct:'EXCELLENT'|'GOOD'|'NEEDS_IMPROVEMENT';punctuality:'ALWAYS_ON_TIME'|'OCCASIONALLY_LATE'|'FREQUENTLY_LATE';homework:'ALWAYS_COMPLETED'|'USUALLY_COMPLETED'|'RARELY_COMPLETED';participation:'ACTIVE'|'MODERATE'|'PASSIVE';comment:string};
const tally=(values:(string|null)[])=>values.reduce<Record<string,number>>((a,v)=>{if(v)a[v]=(a[v]||0)+1;return a;},{})
const scored=(counts:Record<string,number>,positive:string,mid:string,negative:string,rules:Rules)=>{const total=(counts[positive]||0)+(counts[mid]||0)+(counts[negative]||0);if(!total)return 'No data';const avg=((counts[positive]||0)*3+(counts[mid]||0)*2+(counts[negative]||0))/total;return avg>=(rules?.excellentThreshold??2.65)?positive:avg>=(rules?.goodThreshold??1.65)?mid:negative;};
export function buildNormalRecordDefaults(): NormalRecord { return { attendance: 'PRESENT', performance: 'GOOD', conduct: 'GOOD', punctuality: 'ALWAYS_ON_TIME', homework: 'ALWAYS_COMPLETED', participation: 'ACTIVE', comment: '' }; }
// Monthly records answer with the severity-weighted average of the seven punctuality
// categories (absence included), so a mostly-late month can never headline "Always On
// Time"; legacy dated records keep the §48 late-rate derivation below.
const monthlyPunctualityResult=(rows:Observation[]):string|null=>{if(!rows.some(r=>r.source==='monthly'))return null;const counts=tally(rows.filter(r=>r.source==='monthly').map(r=>r.punctuality));return punctualityResultFromTally(counts);};
export function buildReportActivitySeries(rows: Observation[]) {
  const buckets = new Map<string, { date: string; submitted: number; approved: number; returned: number; total: number }>();
  rows.forEach((row) => {
    const key = row.lessonDate;
    const current = buckets.get(key) ?? { date: key, submitted: 0, approved: 0, returned: 0, total: 0 };
    const next = { ...current };
    if (row.status === 'SUBMITTED') next.submitted += 1;
    if (row.status === 'APPROVED') next.approved += 1;
    if (row.status === 'RETURNED') next.returned += 1;
    next.total += 1;
    buckets.set(key, next);
  });
  return [...buckets.values()].sort((a, b) => a.date.localeCompare(b.date));
}
export function summarize(rows:Observation[],rules:Rules){
  const attendance=tally(rows.map(r=>r.attendance));const performance=tally(rows.map(r=>r.performance));const participation=tally(rows.map(r=>r.participation));const homework=tally(rows.map(r=>r.homework));const conduct=tally(rows.map(r=>r.conduct));const punctuality=tally(rows.map(r=>r.punctuality));
 const attended=(attendance.PRESENT||0)+(attendance.LATE||0),total=attended+(attendance.ABSENT||0);
 const hwTotal=(homework.ALWAYS_COMPLETED||0)+(homework.USUALLY_COMPLETED||0)+(homework.RARELY_COMPLETED||0);
 const hwRate=hwTotal?((homework.ALWAYS_COMPLETED||0)+(homework.USUALLY_COMPLETED||0))/hwTotal:null;
 const puncTotal=(punctuality.ALWAYS_ON_TIME||0)+(punctuality.OCCASIONALLY_LATE||0)+(punctuality.FREQUENTLY_LATE||0);
 const latePunc=puncTotal?((punctuality.OCCASIONALLY_LATE||0)+(punctuality.FREQUENTLY_LATE||0))/puncTotal:null;
 return {lessons:new Set(rows.map(r=>r.lessonId)).size,attendance,performance,participation,homework,conduct,punctuality,attendanceRate:total?Math.round(attended/total*100):null,performanceResult:scored(performance,'EXCELLENT','GOOD','NEEDS_IMPROVEMENT',rules),participationResult:scored(participation,'ACTIVE','MODERATE','PASSIVE',rules),conductResult:scored(conduct,'EXCELLENT','GOOD','NEEDS_IMPROVEMENT',rules),homeworkResult:hwRate===null?'No data':hwRate===1?'Always Completed':hwRate>=(rules?.homeworkUsuallyThreshold??0.8)?'Usually Completed':'Rarely Completed',punctualityResult:monthlyPunctualityResult(rows)??(latePunc===null?'No data':latePunc===0?'Always On Time':latePunc<=(rules?.punctualityOccasionallyMax??0.1)?'Occasionally Late':'Frequently Late'), topics:[...new Set(rows.map(r=>r.topic.trim()).filter(Boolean))],observations:(()=>{const seen=new Set<string>();return rows.filter(r=>r.comment || r.performance==='NEEDS_IMPROVEMENT' || r.conduct==='NEEDS_IMPROVEMENT').filter(r=>{const text=r.comment||'Needs improvement observation';const key=`${r.subjectName}|${text}`;if(seen.has(key))return false;seen.add(key);return true;}).map(r=>({date:r.lessonDate,comment:r.comment||'Needs improvement observation',subject:r.subjectName})).slice(0,12);})(),version:rules?.version??1};
}
export function groupReports(rows:Observation[],rules:Rules){const groups=new Map<string,Observation[]>();for(const row of rows){const key=`${row.studentId}|${row.subjectName}`;groups.set(key,[...(groups.get(key)||[]),row]);}return [...groups.values()].map(g=>({studentId:g[0].studentId,studentName:g[0].studentName,studentCode:g[0].studentCode,className:g[0].className,subjectName:g[0].subjectName,teacherName:g[0].teacherName,...summarize(g,rules)}));}
export type SubjectMonthSummary={month:string;lessons:number;attendance:Record<string,number>;performance:Record<string,number>;participation:Record<string,number>;homework:Record<string,number>;conduct:Record<string,number>;punctuality:Record<string,number>;attendanceRate:number|null;performanceResult:string;participationResult:string;homeworkResult:string;conductResult:string;punctualityResult:string;topics:string[];observations:{date:string;comment:string;subject:string}[];version:number};
export type SubjectComparison={studentId:string;studentName:string;studentCode:string;className:string;subjectName:string;teacherName?:string;months:SubjectMonthSummary[];overall:ReturnType<typeof summarize>};
export function summarizeByMonth(rows:Observation[],rules:Rules):SubjectMonthSummary[]{const byMonth=new Map<string,Observation[]>();for(const r of rows){const m=r.lessonDate.slice(0,7);byMonth.set(m,[...(byMonth.get(m)||[]),r]);}return [...byMonth.keys()].sort().map(m=>({month:m,...summarize(byMonth.get(m)!,rules)}));}
export function groupReportsByMonth(rows:Observation[],rules:Rules):SubjectComparison[]{const groups=new Map<string,Observation[]>();for(const row of rows){const key=`${row.studentId}|${row.subjectName}`;groups.set(key,[...(groups.get(key)||[]),row]);}return [...groups.values()].map(g=>({studentId:g[0].studentId,studentName:g[0].studentName,studentCode:g[0].studentCode,className:g[0].className,subjectName:g[0].subjectName,teacherName:g[0].teacherName,months:summarizeByMonth(g,rules),overall:summarize(g,rules)})).sort((a,b)=>a.studentName.localeCompare(b.studentName)||a.subjectName.localeCompare(b.subjectName));}
export const RESULT_RANK:Record<string,number>={EXCELLENT:3,ACTIVE:3,GOOD:2,MODERATE:2,'Always Completed':2,'Always On Time':2,'Usually On Time':2,'NEEDS_IMPROVEMENT':1,PASSIVE:1,'Usually Completed':1,'Occasionally Late':1,'Rarely Completed':0,'Frequently Late':0,'Occasionally Absent':-1,'Frequently Absent':-2,'Always Absent':-3};
export function resultTrend(current:string,previous:string){const a=RESULT_RANK[current];const b=RESULT_RANK[previous];if(a===undefined||b===undefined)return 'flat' as const;if(a>b)return 'up' as const;if(a<b)return 'down' as const;return 'flat' as const;}
export function calculateStudentTrends(rows:Observation[],rules:Rules):MonthlyTrend[]{const byMonth=new Map<string,Observation[]>();for(const r of rows){const m=r.lessonDate.slice(0,7);byMonth.set(m,[...(byMonth.get(m)||[]),r]);}return [...byMonth.keys()].sort().map(m=>{const mr=byMonth.get(m)!;const s=summarize(mr,rules);return {month:m,lessons:s.lessons,attendanceRate:s.attendanceRate,performanceResult:s.performanceResult,homeworkResult:s.homeworkResult,participationResult:s.participationResult,conductResult:s.conductResult,punctualityResult:s.punctualityResult};});}

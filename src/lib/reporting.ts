export type Observation={lessonDate:string;topic:string;lessonId:string;status:string;studentId:string;studentName:string;studentCode:string;className:string;subjectName:string;teacherName?:string;attendance:string;performance:string|null;participation:string|null;homework:string|null;conduct:string|null;comment:string|null};
export type Rules={version:number;excellentThreshold:number;goodThreshold:number;homeworkUsuallyThreshold:number;punctualityOccasionallyMax:number}|undefined;
export type MonthlyTrend={month:string;lessons:number;attendanceRate:number|null;performanceResult:string;homeworkResult:string;participationResult:string;conductResult:string};
export type NormalRecord={attendance:'PRESENT'|'LATE'|'ABSENT';performance:'EXCELLENT'|'GOOD'|'NEEDS_IMPROVEMENT';participation:'ACTIVE'|'MODERATE'|'PASSIVE';homework:'COMPLETED'|'NOT_COMPLETED'|'NOT_APPLICABLE';conduct:'EXCELLENT'|'GOOD'|'NEEDS_IMPROVEMENT';comment:string};
const tally=(values:(string|null)[])=>values.reduce<Record<string,number>>((a,v)=>{if(v)a[v]=(a[v]||0)+1;return a;},{})
const scored=(counts:Record<string,number>,positive:string,mid:string,negative:string,rules:Rules)=>{const total=(counts[positive]||0)+(counts[mid]||0)+(counts[negative]||0);if(!total)return 'No data';const avg=((counts[positive]||0)*3+(counts[mid]||0)*2+(counts[negative]||0))/total;return avg>=(rules?.excellentThreshold??2.65)?positive:avg>=(rules?.goodThreshold??1.65)?mid:negative;};
export function buildNormalRecordDefaults(): NormalRecord { return { attendance: 'PRESENT', performance: 'GOOD', participation: 'ACTIVE', homework: 'COMPLETED', conduct: 'GOOD', comment: '' }; }
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
 const attendance=tally(rows.map(r=>r.attendance));const performance=tally(rows.map(r=>r.performance));const participation=tally(rows.map(r=>r.participation));const homework=tally(rows.map(r=>r.homework));const conduct=tally(rows.map(r=>r.conduct));
 const attended=(attendance.PRESENT||0)+(attendance.LATE||0),total=attended+(attendance.ABSENT||0),hwTotal=(homework.COMPLETED||0)+(homework.NOT_COMPLETED||0), hwRate=hwTotal?(homework.COMPLETED||0)/hwTotal:null,lateRate=attended?(attendance.LATE||0)/attended:null;
 return {lessons:new Set(rows.map(r=>r.lessonId)).size,attendance,performance,participation,homework,conduct,attendanceRate:total?Math.round(attended/total*100):null,performanceResult:scored(performance,'EXCELLENT','GOOD','NEEDS_IMPROVEMENT',rules),participationResult:scored(participation,'ACTIVE','MODERATE','PASSIVE',rules),conductResult:scored(conduct,'EXCELLENT','GOOD','NEEDS_IMPROVEMENT',rules),homeworkResult:hwRate===null?'No data':hwRate===1?'Always Completed':hwRate>=(rules?.homeworkUsuallyThreshold??0.8)?'Usually Completed':'Rarely Completed',punctualityResult:lateRate===null?'No data':lateRate===0?'Always On Time':lateRate<=(rules?.punctualityOccasionallyMax??0.1)?'Occasionally Late':'Frequently Late',topics:[...new Set(rows.map(r=>r.topic.trim()).filter(Boolean))],observations:rows.filter(r=>r.comment || r.performance==='NEEDS_IMPROVEMENT' || r.conduct==='NEEDS_IMPROVEMENT').map(r=>({date:r.lessonDate,comment:r.comment||'Needs improvement observation',subject:r.subjectName})).slice(0,12),version:rules?.version??1};
}
export function groupReports(rows:Observation[],rules:Rules){const groups=new Map<string,Observation[]>();for(const row of rows){const key=`${row.studentId}|${row.subjectName}`;groups.set(key,[...(groups.get(key)||[]),row]);}return [...groups.values()].map(g=>({studentId:g[0].studentId,studentName:g[0].studentName,studentCode:g[0].studentCode,className:g[0].className,subjectName:g[0].subjectName,teacherName:g[0].teacherName,...summarize(g,rules)}));}
export function calculateStudentTrends(rows:Observation[],rules:Rules):MonthlyTrend[]{const byMonth=new Map<string,Observation[]>();for(const r of rows){const m=r.lessonDate.slice(0,7);byMonth.set(m,[...(byMonth.get(m)||[]),r]);}return [...byMonth.keys()].sort().map(m=>{const mr=byMonth.get(m)!;const s=summarize(mr,rules);return {month:m,lessons:s.lessons,attendanceRate:s.attendanceRate,performanceResult:s.performanceResult,homeworkResult:s.homeworkResult,participationResult:s.participationResult,conductResult:s.conductResult};});}

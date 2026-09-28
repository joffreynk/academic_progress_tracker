'use client';
import { useMemo, useState } from 'react';
import { Download, Printer } from 'lucide-react';
import { summarize, type Observation, type Rules } from '@/lib/reporting';

type Summary={studentId:string;studentName:string;studentCode:string;className:string;subjectName:string;teacherName?:string;lessons:number;attendance:Record<string,number>;performance:Record<string,number>;participation:Record<string,number>;homework:Record<string,number>;conduct:Record<string,number>;attendanceRate:number|null;performanceResult:string;participationResult:string;homeworkResult:string;conductResult:string;punctualityResult:string;topics:string[];observations:{date:string;comment:string;subject:string}[];version:number};
const pretty=(s:string)=>s.replaceAll('_',' ').toLowerCase().replace(/\b\w/g,c=>c.toUpperCase());
const countText=(values:Record<string,number>)=>Object.entries(values).map(([key,count])=>`${pretty(key)} ${count}`).join(' · ')||'No observations';
export default function MonthlyOverview({month,school,summaries,data,rules}:{month:string;school:string;summaries:Summary[];data:Observation[];rules:Rules}){
 const [student,setStudent]=useState('');const [search,setSearch]=useState('');
 const names=useMemo(()=>[...new Map(summaries.map(s=>[s.studentId,{id:s.studentId,name:s.studentName,code:s.studentCode,className:s.className}])).values()], [summaries]);
 const selected=student?names.find(n=>n.id===student):undefined;
 const studentRows=useMemo(()=>data.filter(r=>r.studentId===student),[student,data]);
 const overall=useMemo(()=>summarize(studentRows,rules),[studentRows,rules]);
 const all=useMemo(()=>summarize(data,rules),[data,rules]);
 const subjects=summaries.filter(s=>s.studentId===student);
 const visible=summaries.filter(s=>`${s.studentName} ${s.studentCode} ${s.className} ${s.subjectName}`.toLowerCase().includes(search.toLowerCase()));

 const exportStudentMonthly = async () => {
  if (!selected) return;
  const Excel = (await import('exceljs')).default;
  const book = new Excel.Workbook();
  const sheet = book.addWorksheet('Student Follow-Up');
  sheet.addRow(['MONTHLY STUDENT ACADEMIC AND BEHAVIOURAL FOLLOW-UP']);
  sheet.addRow([school]);
  sheet.addRow(['Student Name', selected.name, 'Student ID', selected.code]);
  sheet.addRow(['Class', selected.className, 'Reporting Period', month]);
  sheet.addRow(['Teacher(s)', [...new Set(subjects.map(s=>s.teacherName).filter(Boolean))].join(', ') || 'Assigned faculty']);
  sheet.addRow([]);
  sheet.addRow(['1. ACADEMIC PERFORMANCE']);
  sheet.addRow(['Subject', 'Teacher', 'Topics Covered', 'Performance Level', 'Observations']);
  subjects.forEach(s => {
    sheet.addRow([s.subjectName, s.teacherName || '—', s.topics.join('; '), pretty(s.performanceResult), countText(s.performance)]);
  });
  sheet.addRow([]);
  sheet.addRow(['2. DISCIPLINE & SCHOOL CONDUCT']);
  sheet.addRow(['Class Conduct', pretty(overall.conductResult)]);
  sheet.addRow(['Punctuality', overall.punctualityResult]);
  sheet.addRow(['Homework & Assignments', overall.homeworkResult]);
  sheet.addRow(['Participation in Class', pretty(overall.participationResult)]);
  sheet.addRow([]);
  sheet.addRow(['3. ATTENDANCE']);
  sheet.addRow(['Present', overall.attendance.PRESENT || 0, 'Late coming', overall.attendance.LATE || 0, 'Absent', overall.attendance.ABSENT || 0, 'Attendance %', `${overall.attendanceRate ?? 0}%`]);
  sheet.addRow([]);
  sheet.addRow(['4. TEACHER / SCHOOL COMMENTS']);
  overall.observations.forEach(o => sheet.addRow([o.date, o.subject, o.comment]));
  sheet.addRow([]);
  sheet.addRow(['5. REPORT INFORMATION']);
  sheet.addRow(['Generated Date', new Date().toLocaleDateString('en-GB'), 'Calculation Version', String(overall.version)]);

  sheet.getColumn(1).width = 25;
  sheet.getColumn(2).width = 25;
  sheet.getColumn(3).width = 30;
  sheet.getColumn(4).width = 20;
  sheet.getColumn(5).width = 35;

  const buffer = await book.xlsx.writeBuffer();
  const blob = new Blob([buffer as BlobPart], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `${selected.name.replace(/\s+/g, '_')}-${month}-Monthly-Report.xlsx`;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
 };

 return <section className="panel monthly-extra" aria-label="Monthly report details">
   <div className="list-toolbar"><div><h2>Report perspectives</h2><p>{school} · {month} · {all.lessons} recorded lesson reports · {names.length} students covered · {data.length} student observations</p></div></div>
   <div className="monthly-overview-grid"><div className="metric"><span>Attendance</span><strong>{all.attendanceRate===null?'No data':`${all.attendanceRate}%`}</strong><small>{countText(all.attendance)} · {data.length} observations</small></div><div className="metric"><span>Performance distribution</span><strong>{Object.values(all.performance).reduce((a,b)=>a+b,0)} observations</strong><small>{countText(all.performance)}</small></div><div className="metric"><span>Participation</span><strong>{Object.values(all.participation).reduce((a,b)=>a+b,0)} observations</strong><small>{countText(all.participation)}</small></div><div className="metric"><span>Homework</span><strong>{Object.values(all.homework).reduce((a,b)=>a+b,0)} observations</strong><small>{countText(all.homework)}</small></div></div>
   <div className="monthly-extra-controls"><label>Search student, ID, class or subject<input value={search} onChange={e=>setSearch(e.target.value)} placeholder="Search report rows" /></label><label>Full student monthly report<select value={student} onChange={e=>setStudent(e.target.value)}><option value="">Choose a student</option>{names.map(n=><option key={n.id} value={n.id}>{n.name} · {n.code}</option>)}</select></label></div>
   <p className="monthly-count">{visible.length} of {summaries.length} subject summaries match your search.</p>
   {selected&&<article className="full-student-report"><div className="student-report-top"><div className="eyebrow">MONTHLY STUDENT ACADEMIC AND BEHAVIOURAL FOLLOW-UP</div><div className="student-report-actions"><button className="btn outline" onClick={()=>window.print()}><Printer size={15}/> Print / Save as PDF</button><button className="btn outline" onClick={exportStudentMonthly}><Download size={15}/> Download Full Monthly Excel</button></div></div><h2>{school}</h2><p><strong>{selected.name}</strong> · {selected.code} · Class {selected.className} · {month} · Calculation version {overall.version}</p><p><strong>Teacher(s):</strong> {[...new Set(subjects.map(s=>s.teacherName).filter(Boolean))].join(', ') || 'Assigned faculty'}</p><p><strong>Source coverage:</strong> {overall.lessons} recorded lessons across {subjects.length} subject{subjects.length===1?'':'s'}. Results describe recorded data only.</p>
   <h3>1. Academic performance</h3><div className="table-scroll"><table><thead><tr><th>SUBJECT</th><th>TEACHER</th><th>TOPICS COVERED</th><th>PERFORMANCE LEVEL</th><th>SUPPORTING OBSERVATIONS</th></tr></thead><tbody>{subjects.map(s=><tr key={s.subjectName}><td><strong>{s.subjectName}</strong></td><td>{s.teacherName||'—'}</td><td>{s.topics.join(', ')||'—'}</td><td>{pretty(s.performanceResult)}</td><td>{countText(s.performance)}</td></tr>)}</tbody></table></div>
   <h3>2. Discipline & school conduct</h3><div className="report-facts"><div>Class conduct <strong>{pretty(overall.conductResult)}</strong><small>{countText(overall.conduct)}</small></div><div>Punctuality <strong>{overall.punctualityResult}</strong><small>{countText(overall.attendance)}</small></div><div>Homework & assignments <strong>{overall.homeworkResult}</strong><small>{countText(overall.homework)}</small></div><div>Participation in class <strong>{pretty(overall.participationResult)}</strong><small>{countText(overall.participation)}</small></div></div>
   <h3>3. Attendance</h3><p>Present: {overall.attendance.PRESENT||0} · Late coming: {overall.attendance.LATE||0} · Absent: {overall.attendance.ABSENT||0} · Attendance: {overall.attendanceRate??'—'}%</p>
   <h3>4. Teacher / school comment</h3>{overall.observations.length?<ul>{overall.observations.map((o,i)=><li key={i}>{o.date} · {o.subject}: {o.comment}</li>)}</ul>:<p>No significant observations recorded for this period.</p>}
   <h3>5. Report information</h3><p>Generated {new Date().toLocaleDateString('en-GB')} · Data period: {month} · Rule version {overall.version} · Based on submitted, under-review and approved lesson records.</p></article>}
 </section>;
}

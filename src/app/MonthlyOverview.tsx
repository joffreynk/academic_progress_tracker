'use client';
import { useEffect, useMemo, useState } from 'react';
import { ArrowDown, ArrowRight, ArrowUp, Download, Printer } from 'lucide-react';
import type ExcelJS from 'exceljs';
import { resultTrend, summarize, summarizeByMonth, type Observation, type Rules, type SubjectComparison, type SubjectMonthSummary } from '@/lib/reporting';
import { monthLabelShort, periodLabel, periodSlug, type Period } from '@/lib/period';
import { downloadStudentPdf, downloadClassReportsZip, pretty } from '@/lib/reportPdf';
import { FALLBACK_LOGO_DATA_URL } from '@/lib/defaultLogo';

type Summary={studentId:string;studentName:string;studentCode:string;className:string;subjectName:string;teacherName?:string;lessons:number;attendance:Record<string,number>;performance:Record<string,number>;participation:Record<string,number>;homework:Record<string,number>;conduct:Record<string,number>;punctuality:Record<string,number>;attendanceRate:number|null;performanceResult:string;participationResult:string;homeworkResult:string;conductResult:string;punctualityResult:string;topics:string[];observations:{date:string;comment:string;subject:string}[];version:number};
const countText=(values:Record<string,number>)=>Object.entries(values).sort((a,b)=>b[1]-a[1]).map(([key,count])=>`${pretty(key)} ${count}`).join(' · ')||'No observations';
const PILL_KEYS=['EXCELLENT','GOOD','NEEDS_IMPROVEMENT'];

type Metric={key:string;label:string;render:(m:SubjectMonthSummary)=>string;numeric:(m:SubjectMonthSummary)=>number|null;higherIsBetter:boolean};
const METRICS:Metric[]=[
  {key:'lessons',label:'Lessons recorded',render:m=>String(m.lessons),numeric:m=>m.lessons,higherIsBetter:true},
  {key:'performance',label:'Performance',render:m=>m.performanceResult==='No data'?'—':pretty(m.performanceResult),numeric:()=>null,higherIsBetter:true},
  {key:'participation',label:'Participation',render:m=>m.participationResult==='No data'?'—':pretty(m.participationResult),numeric:()=>null,higherIsBetter:true},
  {key:'homework',label:'Homework',render:m=>m.homeworkResult,numeric:()=>null,higherIsBetter:true},
  {key:'conduct',label:'Conduct',render:m=>m.conductResult==='No data'?'—':pretty(m.conductResult),numeric:()=>null,higherIsBetter:true},
  {key:'punctuality',label:'Punctuality',render:m=>m.punctualityResult,numeric:()=>null,higherIsBetter:true},
];

function Delta({ metric, current, previous }: { metric: Metric; current: SubjectMonthSummary | undefined; previous: SubjectMonthSummary | undefined }) {  if (!current) return null;
  if (metric.numeric) {
    const a = metric.numeric(current);
    const b = previous ? metric.numeric(previous) : null;
    if (a === null || b === null || a === b) return null;
    const rising = a > b;
    return <span className={`compare-delta ${metric.higherIsBetter ? (rising ? 'up' : 'down') : (rising ? 'down' : 'up')}`}>{rising ? <ArrowUp size={9} /> : <ArrowDown size={9} />}{Math.abs(a - b)}{metric.key === 'attendanceRate' ? 'pp' : ''}</span>;
  }
  if (!previous) return null;
  const trend = resultTrend(current[metric.key as keyof SubjectMonthSummary] as string, previous[metric.key as keyof SubjectMonthSummary] as string);
  if (trend === 'flat') return null;
  return <span className={`compare-delta ${trend}`}>{trend === 'up' ? <ArrowUp size={9} /> : <ArrowDown size={9} />}</span>;
}

function addComparisonSheets(book: ExcelJS.Workbook, groups: { subjectName: string; months: SubjectMonthSummary[] }[], months: string[], overallMonths: SubjectMonthSummary[]) {
  if (months.length < 2) return;
  const addSheet = (name: string, rows: SubjectMonthSummary[]) => {
    if (!rows.length) return;
    const sheet = book.addWorksheet(name.replace(/[\\/*?:[\]]/g, '-').slice(0, 31));
    const byMonth = new Map(rows.map((r) => [r.month, r]));
    sheet.addRow(['EVALUATION CRITERION', ...months.map(monthLabelShort)]);
    METRICS.forEach((metric) => sheet.addRow([metric.label, ...months.map((m) => { const cell = byMonth.get(m); return cell ? metric.render(cell) : 'No data'; })]));
    sheet.getColumn(1).width = 26;
  };
  groups.forEach((g) => addSheet(g.subjectName, g.months));
  addSheet('All subjects combined', overallMonths);
}

function ComparisonTable({ title, months, rows, closedMonths }: { title: string; months: string[]; rows: SubjectMonthSummary[]; closedMonths: string[] }) {
  const byMonth = useMemo(() => new Map(rows.map((r) => [r.month, r])), [rows]);
  return (
    <div className="compare-subject">
      <h5>{title}</h5>
      <div className="table-scroll">
        <table className="compare-table">
          <thead>
            <tr>
              <th className="criterion">CRITERION</th>
              {months.map((month) => (
                <th key={month}>
                  {monthLabelShort(month)}
                  {closedMonths.includes(month) && ' 🔒'}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {METRICS.map((metric) => (
              <tr key={metric.key}>
                <td>{metric.label}</td>
                {months.map((month, index) => {
                  const cell = byMonth.get(month);
                  const previous = index > 0 ? byMonth.get(months[index - 1]) : undefined;
                  if (!cell) return <td key={month}><span className="compare-value muted-cell">No data</span></td>;
                  const pill = PILL_KEYS.includes(cell[metric.key as keyof SubjectMonthSummary] as string);
                  return (
                    <td key={month}>
                      <span className={pill ? `compare-pill ${cell[metric.key as keyof SubjectMonthSummary]}` : 'compare-value'}>{metric.render(cell)}</span>
                      <Delta metric={metric} current={cell} previous={previous} />
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

export default function MonthlyOverview({ period, closedMonths = [], school, logoUrl = null, summaries, comparison = [], data = [], rules, search = '', onSearch }:{period:Period;closedMonths?:string[];school:string;logoUrl?:string|null;summaries:Summary[];comparison?:SubjectComparison[];data?:Observation[];rules:Rules;search?:string;onSearch?:(v:string)=>void}){
  const [student,setStudent]=useState('');
const [msg,setMsg]=useState<string|null>(null);const [zipping,setZipping]=useState(false);
useEffect(()=>{if(!msg)return;const t=setTimeout(()=>setMsg(null),7000);return()=>clearTimeout(t);},[msg]);
  const label=periodLabel(period);
  const names=useMemo(()=>[...new Map(summaries.map(s=>[s.studentId,{id:s.studentId,name:s.studentName,code:s.studentCode,className:s.className}])).values()], [summaries]);
  const selected=student?names.find(n=>n.id===student):undefined;
  const studentRows=useMemo(()=>data.filter(r=>r.studentId===student),[student,data]);
  const overall=useMemo(()=>summarize(studentRows,rules),[studentRows,rules]);
  const all=useMemo(()=>summarize(data,rules),[data,rules]);
  const subjects=summaries.filter(s=>s.studentId===student);
  const comparable=useMemo(()=>comparison.filter(c=>c.studentId===student),[comparison,student]);
  const subjectMonths=useMemo(()=>[...new Set(comparable.flatMap(c=>c.months.map(m=>m.month)))].sort(),[comparable]);
  const overallMonths=useMemo(()=>summarizeByMonth(studentRows,rules),[studentRows,rules]);
  const months=period.months;
  const visible=summaries.filter(s=>`${s.studentName} ${s.studentCode} ${s.className} ${s.subjectName}`.toLowerCase().includes(search.toLowerCase()));

const exportStudentMonthly = async () => {
   if (!selected) return;
   const Excel = (await import('exceljs')).default;
   const book = new Excel.Workbook();
    const sheet = book.addWorksheet('Student Follow-Up');
    sheet.addRow(['MONTHLY STUDENT ACADEMIC PROGRESS REPORT']);
   sheet.addRow([school]);
   sheet.addRow(['Student Name', selected.name, 'Student ID', selected.code]);
   sheet.addRow(['Class', selected.className, 'Reporting Period', label]);
   sheet.addRow(['Period From', period.from, 'Period To', period.to]);
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
   sheet.addRow(['3. TEACHER / SCHOOL COMMENTS']);
   overall.observations.forEach(o => sheet.addRow([o.date, o.subject, o.comment]));
   sheet.addRow([]);
   sheet.addRow(['4. REPORT INFORMATION']);
   sheet.addRow(['Generated Date', new Date().toLocaleDateString('en-GB'), 'Calculation Version', String(overall.version)]);
   if (months.length > 1) addComparisonSheets(book, comparable, subjectMonths, overallMonths);

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
    const fileName=`${selected.name.replace(/\s+/g, '_')}-${periodSlug(period)}-Follow-Up.xlsx`;
    a.download = fileName;
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    setMsg(`Excel workbook downloaded: ${fileName}`);
  };

  const exportSubjectMonthly = async (subjectName: string) => {
    if (!selected) return;
    const subjectSummary = subjects.find((s) => s.subjectName === subjectName);
    if (!subjectSummary) return;
    const subjectRows = studentRows.filter((r) => r.subjectName === subjectName);
    const Excel = (await import('exceljs')).default;
    const book = new Excel.Workbook();
    const sheet = book.addWorksheet('Subject Follow-Up');
    sheet.addRow(['MONTHLY STUDENT ACADEMIC PROGRESS REPORT']);
    sheet.addRow([school]);
    sheet.addRow(['Student Name', selected.name, 'Student ID', selected.code]);
    sheet.addRow(['Class', selected.className, 'Reporting Period', label]);
    sheet.addRow(['Period From', period.from, 'Period To', period.to]);
    sheet.addRow(['Subject', subjectName, 'Teacher', subjectSummary.teacherName || '—']);
    sheet.addRow([]);
    sheet.addRow(['1. ACADEMIC PERFORMANCE']);
    sheet.addRow(['Subject', 'Topics Covered', 'Performance Level', 'Observations']);
    sheet.addRow([subjectName, subjectSummary.topics.join('; ') || '—', pretty(subjectSummary.performanceResult), countText(subjectSummary.performance)]);
    sheet.addRow([]);
    sheet.addRow(['2. DISCIPLINE & SCHOOL CONDUCT']);
    sheet.addRow(['Class Conduct', pretty(subjectSummary.conductResult)]);
    sheet.addRow(['Punctuality', subjectSummary.punctualityResult]);
    sheet.addRow(['Homework & Assignments', subjectSummary.homeworkResult]);
    sheet.addRow(['Participation in Class', pretty(subjectSummary.participationResult)]);
    sheet.addRow([]);
    sheet.addRow(['3. REPORT INFORMATION']);
    sheet.addRow(['Generated Date', new Date().toLocaleDateString('en-GB'), 'Calculation Version', String(subjectSummary.version)]);
    if (months.length > 1) {
      const rows = comparable.find((c) => c.subjectName === subjectName)?.months ?? [];
      addComparisonSheets(book, rows.length ? [{ subjectName, months: rows }] : [], subjectMonths, []);
    }

    sheet.getColumn(1).width = 25;
    sheet.getColumn(2).width = 25;
    sheet.getColumn(3).width = 30;
    sheet.getColumn(4).width = 25;

    const buffer = await book.xlsx.writeBuffer();
    const blob = new Blob([buffer as BlobPart], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    const fileName=`${selected.name.replace(/\s+/g, '_')}-${subjectName.replace(/\s+/g, '_')}-${periodSlug(period)}-Subject-Report.xlsx`;
    a.download = fileName;
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    setMsg(`${subjectName} workbook downloaded: ${fileName}`);
  };

  const printStudentPdf = async () => {
    if (!selected) return;
    await downloadStudentPdf({
      school, period, closedMonths, student: { id: selected.id, name: selected.name, code: selected.code, className: selected.className },
      subjects, overall, comparable, overallMonths, raw: studentRows, rules, logoUrl,
    });
    setMsg('Student follow-up PDF downloaded.');
  };

  // §193: one PDF per student for the whole cohort, delivered as a single ZIP archive.
  const printClassZip = async () => {
    if (zipping || !names.length) return;
    setZipping(true);
    setMsg(`Building PDF reports for ${names.length} students…`);
    try {
      const result = await downloadClassReportsZip({
        school, period, closedMonths, summaries, comparison, data, rules, logoUrl,
        onProgress: (done, total) => setMsg(`Building PDF reports… ${done} of ${total}`),
      });
      setMsg(`Class reports ZIP downloaded: ${result.filename} (${result.count} student PDFs).`);
    } catch (e) {
      setMsg(e instanceof Error ? e.message : 'ZIP export failed.');
    } finally {
      setZipping(false);
    }
  };


 return <section className="panel monthly-extra" aria-label="Reporting period details">
   {msg&&<div className="notice-banner" style={{background:'#f0fdf4',color:'#166534',marginBottom:16,borderColor:'#d3f2e0'}}>{msg}</div>}
   <div className="list-toolbar"><div><h2>Report perspectives</h2><p>{school} · {label} · {all.lessons} recorded lesson reports · {names.length} students covered · {data.length} student observations</p></div><button className="btn outline" onClick={printClassZip} disabled={zipping||!names.length}><Download size={15}/>{zipping?' Building ZIP…':' Class Reports ZIP'}</button></div>
   <div className="monthly-overview-grid"><div className="metric"><span>Punctuality</span><strong>{all.punctualityResult==='No data'?'No data':all.punctualityResult}</strong><small>{countText(all.punctuality)} · {data.length} observations</small></div><div className="metric"><span>Performance distribution</span><strong>{Object.values(all.performance).reduce((a,b)=>a+b,0)} observations</strong><small>{countText(all.performance)}</small></div><div className="metric"><span>Participation</span><strong>{Object.values(all.participation).reduce((a,b)=>a+b,0)} observations</strong><small>{countText(all.participation)}</small></div><div className="metric"><span>Homework</span><strong>{Object.values(all.homework).reduce((a,b)=>a+b,0)} observations</strong><small>{countText(all.homework)}</small></div></div>
   <div className="monthly-extra-controls"><label>Search student, ID, class or subject<input value={search} onChange={e=>onSearch?.(e.target.value)} placeholder="Search report rows" /></label><label>Full student period report<select value={student} onChange={e=>setStudent(e.target.value)}><option value="">Choose a student</option>{names.map(n=><option key={n.id} value={n.id}>{n.name} · {n.code}</option>)}</select></label></div>
   <p className="monthly-count">{visible.length} of {summaries.length} subject summaries match your search.</p>
   {selected&&<article className="full-student-report"><div className="student-report-top"><div className="eyebrow">MONTHLY STUDENT ACADEMIC PROGRESS REPORT</div><div className="student-report-actions"><button className="btn outline" onClick={printStudentPdf}><Printer size={15}/> Print / Save as PDF</button><button className="btn outline" onClick={exportStudentMonthly}><Download size={15}/> Download Full Excel</button>{subjects.map(s=><button key={s.subjectName} className="btn outline" onClick={()=>exportSubjectMonthly(s.subjectName)}><Download size={15}/> {s.subjectName} Excel</button>)}</div></div><div className="student-report-brand"><img className="student-report-logo" src={logoUrl||FALLBACK_LOGO_DATA_URL} alt="School logo" onError={(e)=>{const img=e.currentTarget;if(img.dataset.fallback!=='1'){img.dataset.fallback='1';img.src=FALLBACK_LOGO_DATA_URL;}}}/><h2>{school}</h2></div><p><strong>{selected.name}</strong> · Class {selected.className} · {label} · Calculation version {overall.version}</p><p><strong>Period:</strong> {period.from} to {period.to} ({months.length} month{months.length===1?'':'s'}{closedMonths.length>0?`, ${closedMonths.length} closed`:''})</p><p><strong>Teacher(s):</strong> {[...new Set(subjects.map(s=>s.teacherName).filter(Boolean))].join(', ') || 'Assigned faculty'}</p><p><strong>Source coverage:</strong> {overall.lessons} recorded lessons across {subjects.length} subject{subjects.length===1?'':'s'}. Results describe recorded data only.</p>
   <h3>1. Academic performance</h3><div className="table-scroll"><table><thead><tr><th>SUBJECT</th><th>TEACHER</th><th>TOPICS COVERED</th><th>PERFORMANCE LEVEL</th><th>SUPPORTING OBSERVATIONS</th></tr></thead><tbody>{subjects.map(s=><tr key={s.subjectName}><td><strong>{s.subjectName}</strong></td><td>{s.teacherName||'—'}</td><td>{s.topics.join(', ')||'—'}</td><td>{pretty(s.performanceResult)}</td><td>{countText(s.performance)}</td></tr>)}</tbody></table></div>
   <h3>2. Discipline &amp; school conduct</h3><div className="report-facts"><div>Class conduct <strong>{pretty(overall.conductResult)}</strong><small>{countText(overall.conduct)}</small></div><div>Punctuality <strong>{overall.punctualityResult}</strong><small>{countText(overall.punctuality)}</small></div><div>Homework &amp; assignments <strong>{overall.homeworkResult}</strong><small>{countText(overall.homework)}</small></div><div>Participation in class <strong>{pretty(overall.participationResult)}</strong><small>{countText(overall.participation)}</small></div></div>

   {months.length>1&&<div className="compare-block"><div className="compare-head"><h4>Month-over-month comparison</h4><p>{months.length} reporting months compared for {selected.name} · {subjectMonths.length} month{subjectMonths.length===1?'':'s'} with recorded data</p></div>
   {comparable.length>0
     ? <>
       {comparable.map(c=><ComparisonTable key={c.subjectName} title={`${c.subjectName}${c.teacherName?` · ${c.teacherName}`:''}`} months={months} rows={c.months} closedMonths={closedMonths} />)}
       <ComparisonTable title="All subjects combined" months={months} rows={overallMonths} closedMonths={closedMonths} />
       <div className="compare-legend"><span><ArrowUp size={11} className="compare-delta up" /> Improvement vs previous month</span><span><ArrowDown size={11} className="compare-delta down" /> Decline vs previous month</span><span><ArrowRight size={11} /> Arrows compare each month against the month before it</span></div>
       </>
     : <p>No recorded observations for this student inside the selected period.</p>}
   </div>}

   <h3>3. Teacher / school comment</h3>{overall.observations.length?<ul>{overall.observations.map((o,i)=><li key={i}>{o.date} · {o.subject}: {o.comment}</li>)}</ul>:<p>No significant observations recorded for this period.</p>}
   <h3>4. Report information</h3><p>Generated {new Date().toLocaleDateString('en-GB')} · Data period: {label} ({period.from} to {period.to}) · Rule version {overall.version} · Based on submitted, under-review and approved lesson records.</p></article>}
 </section>;
}

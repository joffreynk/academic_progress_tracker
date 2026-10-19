import fs from 'node:fs';
import path from 'node:path';
import { inflateSync } from 'node:zlib';
import { buildClassSummaryPdf, buildClubStudentReport, buildStudentPdf, type ClubAcademicProfile } from '../src/lib/reportPdf';
import { buildPeriod } from '../src/lib/period';
import { groupReports, summarize, summarizeByMonth, groupReportsByMonth, type Observation, type Rules } from '../src/lib/reporting';

const RULES: Rules = { version: 2, excellentThreshold: 2.65, goodThreshold: 1.65, homeworkUsuallyThreshold: 0.8, punctualityOccasionallyMax: 0.1 };
const OUT = path.resolve(process.cwd(), 'demo');

/** Every text-showing string, in draw order — wrapping only inserts line breaks between them. */
function pdfStrings(buf: Buffer): string {
  const out: string[] = [];
  let index = buf.indexOf('stream');
  while (index !== -1) {
    let start = index + 'stream'.length;
    if (buf[start] === 0x0d) start += 1;
    if (buf[start] === 0x0a) start += 1;
    const end = buf.indexOf('endstream', start);
    if (end === -1) break;
    const chunk = buf.subarray(start, end);
    let raw = '';
    try { raw = inflateSync(chunk).toString('latin1'); } catch { raw = chunk.toString('latin1'); }
    const re = /\(((?:[^()\\]|\\.)*)\)/g;
    let match: RegExpExecArray | null;
    while ((match = re.exec(raw))) out.push(match[1].replace(/\\([()\\])/g, '$1'));
    index = buf.indexOf('stream', end + 9);
  }
  return out.join(' ');
}

/** 10 subjects: 5 Needs Improvement, 3 Good, 2 Excellent -> 50% / 30% / 20%. */
const SUBJECTS = [
  { name: 'Mathematics', teacher: 'Basita Mohammed', performance: 'NEEDS_IMPROVEMENT' as const, homework: 'ALWAYS_COMPLETED' as const, punctuality: 'ALWAYS_ON_TIME' as const },
  { name: 'Physics', teacher: 'Alsen Atuhura', performance: 'NEEDS_IMPROVEMENT' as const, homework: 'USUALLY_COMPLETED' as const, punctuality: 'ALWAYS_ON_TIME' as const },
  { name: 'Chemistry', teacher: 'Basita Mohammed', performance: 'NEEDS_IMPROVEMENT' as const, homework: 'ALWAYS_COMPLETED' as const, punctuality: 'ALWAYS_ON_TIME' as const },
  { name: 'Biology', teacher: 'Alsen Atuhura', performance: 'NEEDS_IMPROVEMENT' as const, homework: 'RARELY_COMPLETED' as const, punctuality: 'ALWAYS_ON_TIME' as const },
  { name: 'English', teacher: 'Basita Mohammed', performance: 'NEEDS_IMPROVEMENT' as const, homework: 'ALWAYS_COMPLETED' as const, punctuality: 'OCCASIONALLY_LATE' as const },
  { name: 'French', teacher: 'Alsen Atuhura', performance: 'GOOD' as const, homework: 'ALWAYS_COMPLETED' as const, punctuality: 'ALWAYS_ON_TIME' as const },
  { name: 'History', teacher: 'Basita Mohammed', performance: 'GOOD' as const, homework: 'ALWAYS_COMPLETED' as const, punctuality: 'ALWAYS_ON_TIME' as const },
  { name: 'Geography', teacher: 'Alsen Atuhura', performance: 'GOOD' as const, homework: 'ALWAYS_COMPLETED' as const, punctuality: 'ALWAYS_ON_TIME' as const },
  { name: 'Computer Science', teacher: 'Basita Mohammed', performance: 'EXCELLENT' as const, homework: 'ALWAYS_COMPLETED' as const, punctuality: 'ALWAYS_ON_TIME' as const },
  { name: 'Arts', teacher: 'Alsen Atuhura', performance: 'EXCELLENT' as const, homework: 'ALWAYS_COMPLETED' as const, punctuality: 'ALWAYS_ON_TIME' as const },
];

function rowsFor(studentId: string, studentName: string, code: string, className: string): Observation[] {
  return SUBJECTS.map((s, i) => ({
    lessonDate: `2026-10-${String(5 + i).padStart(2, '0')}`,
    topic: `${s.name} — unit ${i + 1} review`,
    lessonId: `${studentId}-lesson-${i}`,
    status: 'APPROVED' as const,
    studentId, studentName, studentCode: code, className,
    subjectName: s.name, teacherName: s.teacher,
    attendance: 'PRESENT',
    performance: s.performance, conduct: 'GOOD', punctuality: s.punctuality, homework: s.homework, participation: 'ACTIVE',
    comment: i === 0 ? 'Needs extra support with fractions.' : null,
  }));
}

const studentRows = rowsFor('s1', 'Ali Kamberis', 'STU-010', '8B');
const peerRows = rowsFor('s2', 'Grace Mugisha', 'STU-003', '8B').map((r, i) => ({
  ...r,
  performance: i % 4 === 0 ? 'EXCELLENT' : i % 3 === 0 ? 'GOOD' : 'GOOD',
}));
const allRows = [...studentRows, ...peerRows];

async function main() {
  fs.mkdirSync(OUT, { recursive: true });
  const period = buildPeriod('2026-10-01', '2026-10-31');
  if (!period) throw new Error('period');
  const subjects = groupReports(studentRows, RULES);
  const overall = summarize(studentRows, RULES);

  const written: string[] = [];

  // 1. Subject / student follow-up report
  const student = await buildStudentPdf({
    school: 'International Maarif Schools', period,
    student: { id: 's1', name: 'Ali Kamberis', code: 'STU-010', className: '8B' },
    subjects, overall, comparable: groupReportsByMonth(studentRows, RULES), overallMonths: summarizeByMonth(studentRows, RULES),
    raw: studentRows, rules: RULES,
  });
  fs.writeFileSync(path.join(OUT, '01-student-report-subjects.pdf'), Buffer.from(student.doc.output('arraybuffer') as ArrayBuffer));
  written.push('01-student-report-subjects.pdf');

  // 2. Class summary
  const classPdf = await buildClassSummaryPdf({
    school: 'International Maarif Schools', period,
    summaries: [...groupReports(allRows, RULES)], comparison: groupReportsByMonth(allRows, RULES), rules: RULES,
  });
  fs.writeFileSync(path.join(OUT, '02-class-summary.pdf'), Buffer.from(classPdf.doc.output('arraybuffer') as ArrayBuffer));
  written.push('02-class-summary.pdf');

  // 3. Club report driven by the subject academic profile
  const profile: ClubAcademicProfile = {
    label: 'Academic year 2026-2027',
    performance: overall.performance, punctuality: overall.punctuality, homework: overall.homework, conduct: overall.conduct,
    performanceResult: overall.performanceResult, punctualityResult: overall.punctualityResult,
    homeworkResult: overall.homeworkResult, conductResult: overall.conductResult,
  };
  const clubRows = [
    { activityId: 'a1', activityDate: '2026-10-08', title: 'Robotics build session', status: 'APPROVED', punctuality: 'ALWAYS_ON_TIME', performance: 'GOOD', participation: 'ACTIVE', conduct: 'GOOD', comment: 'Led the chassis assembly.' },
    { activityId: 'a2', activityDate: '2026-10-15', title: 'Competition practice', status: 'APPROVED', punctuality: 'USUALLY_ON_TIME', performance: 'EXCELLENT', participation: 'HIGHLY_ENGAGED', conduct: 'GOOD', comment: 'Helped two teammates debug.' },
    { activityId: 'a3', activityDate: '2026-10-22', title: 'Community demo day', status: 'SUBMITTED', punctuality: 'ALWAYS_ON_TIME', performance: 'GOOD', participation: 'ACTIVE', conduct: 'GOOD', comment: null },
  ];
  const club = await buildClubStudentReport({
    school: 'International Maarif Schools', club: { name: 'Robotics Club', description: 'Builds and programs small robots.' },
    student: { name: 'Ali Kamberis', code: 'STU-010', className: '8B' },
    rows: clubRows, activitiesTotal: 3, subjectProfile: profile,
  });
  fs.writeFileSync(path.join(OUT, '03-club-report-academic-profile.pdf'), Buffer.from(club.doc.output('arraybuffer') as ArrayBuffer));
  written.push('03-club-report-academic-profile.pdf');

  // 4. Club report fallback (no subject profile available) — club-record cards only
  const fallback = await buildClubStudentReport({
    school: 'International Maarif Schools', club: { name: 'Robotics Club', description: 'Builds and programs small robots.' },
    student: { name: 'Ali Kamberis', code: 'STU-010', className: '8B' },
    rows: clubRows, activitiesTotal: 3,
  });
  fs.writeFileSync(path.join(OUT, '04-club-report-club-records-fallback.pdf'), Buffer.from(fallback.doc.output('arraybuffer') as ArrayBuffer));
  written.push('04-club-report-club-records-fallback.pdf');

  for (const name of written) {
    const text = pdfStrings(fs.readFileSync(path.join(OUT, name)));
    console.log(`\n=== ${name} ===`);
    for (const line of text.match(/.{1,110}(?:\s|$)/g) ?? []) console.log(`  ${line.trimEnd()}`);
  }
  console.log(`\nWrote ${written.length} demo PDFs to ${OUT}`);
}

main().catch((err) => { console.error(err); process.exit(1); });

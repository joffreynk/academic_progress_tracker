import assert from 'node:assert';
import test from 'node:test';
import { inflateSync } from 'node:zlib';
import { buildStudentPdf, buildClassSummaryPdf, buildClassReportsZip, buildClubStudentReport, loadLogoDataUrl, percentText } from '../src/lib/reportPdf';
import { FALLBACK_LOGO_DATA_URL } from '../src/lib/defaultLogo';
import { buildPeriod } from '../src/lib/period';
import { groupReports, groupReportsByMonth, summarize, summarizeByMonth, type Observation } from '../src/lib/reporting';
import type { Rules } from '../src/lib/reporting';

/** jsPDF 4 dropped output('text'), so decode the content streams ourselves. */
export function pdfText(buf: Buffer): string {
  const out: string[] = [];
  let index = buf.indexOf('stream');
  while (index !== -1) {
    let start = index + 'stream'.length;
    if (buf[start] === 0x0d) start += 1;
    if (buf[start] === 0x0a) start += 1;
    const end = buf.indexOf('endstream', start);
    if (end === -1) break;
    const chunk = buf.subarray(start, end);
    try { out.push(inflateSync(chunk).toString('latin1')); } catch { out.push(chunk.toString('latin1')); }
    index = buf.indexOf('stream', end + 9);
  }
  return out.join('\n');
}

/** Every text-showing string, in draw order — wrapping only inserts line breaks between them. */
export function pdfStrings(buf: Buffer): string {
  const out: string[] = [];
  const re = /\(((?:[^()\\]|\\.)*)\)/g;
  let match: RegExpExecArray | null;
  while ((match = re.exec(pdfText(buf)))) out.push(match[1].replace(/\\([()\\])/g, '$1'));
  return out.join(' ');
}


const RULES: Rules = { version: 2, excellentThreshold: 2.65, goodThreshold: 1.65, homeworkUsuallyThreshold: 0.8, punctualityOccasionallyMax: 0.1 };

function fixture(): Observation[] {
  const rows: Observation[] = [];
  for (let i = 1; i <= 40; i += 1) {
    const day = String(((i - 1) % 28) + 1).padStart(2, '0');
    const month = i <= 20 ? '08' : '09';
    rows.push({
      lessonDate: `2026-${month}-${day}`,
      topic: `Topic ${i}: fractions, decimals and applied measurement`,
      lessonId: `lesson-${i}`,
      status: 'APPROVED',
      studentId: 's1',
      studentName: 'Grace Mugisha',
      studentCode: 'STU-003',
      className: 'Class 7A',
      subjectName: i % 3 === 0 ? 'Science' : 'Mathematics',
      teacherName: 'joffrey',
      attendance: i % 5 === 0 ? 'ABSENT' : i % 4 === 0 ? 'LATE' : 'PRESENT',
      performance: i % 6 === 0 ? 'NEEDS_IMPROVEMENT' : i % 3 === 0 ? 'GOOD' : 'EXCELLENT',
      conduct: 'GOOD',
      punctuality: i % 7 === 0 ? 'FREQUENTLY_LATE' : 'ALWAYS_ON_TIME',
      homework: i % 5 === 0 ? 'RARELY_COMPLETED' : 'ALWAYS_COMPLETED',
      participation: 'ACTIVE',
      comment: i % 9 === 0 ? 'Needs follow-up with parents.' : null,
    });
  }
  return rows;
}

const header = (buf: Buffer) => buf.subarray(0, 5).toString('latin1');
const trailer = (buf: Buffer) => buf.subarray(-64).toString('latin1');

test('pdf: student follow-up fits one page with all summary data', async () => {
  const period = buildPeriod('2026-08-31', '2026-09-30');
  assert.ok(period, 'fixture period must parse');
  const rows = fixture();
  const summaries = groupReports(rows, RULES);
  const overall = summarize(rows, RULES);
  const { doc, filename } = await buildStudentPdf({
    school: 'Ecole Maarif',
    period,
    closedMonths: ['2026-08'],
    student: { id: 's1', name: 'Grace Mugisha', code: 'STU-003', className: 'Class 7A' },
    subjects: summaries,
    overall,
    comparable: groupReportsByMonth(rows, RULES),
    overallMonths: summarizeByMonth(rows, RULES),
    raw: rows,
    rules: RULES,
  });

  const buf = Buffer.from(doc.output('arraybuffer') as ArrayBuffer);
  assert.equal(header(buf), '%PDF-', 'output must be a real PDF header');
  assert.match(trailer(buf), /%%EOF/, 'PDF must be terminated with %%EOF');
  assert.ok(buf.length > 3000, `PDF should carry content, got ${buf.length} bytes`);
  assert.ok(filename.endsWith('-Follow-Up.pdf'), `filename should end with -Follow-Up.pdf, got ${filename}`);
  assert.match(filename, /Grace_Mugisha-STU-003-/, `filename should carry student name and code, got ${filename}`);
  assert.equal(doc.getNumberOfPages(), 1, `a child's report must fit on a single page, got ${doc.getNumberOfPages()}`);

  const text = pdfText(buf);
  assert.ok(text.includes('Grace Mugisha'), 'student name must appear in the document text');
  assert.ok(text.includes('Ecole Maarif'), 'organization name must appear in the document text (header and footer)');
  assert.ok(!text.includes('STU-003'), 'the student ID must not appear in the document text');
  assert.ok(text.includes('2026-08-31'), 'period start must appear in the document text');
  assert.ok(text.includes('Mathematics'), 'subject names must appear');
  assert.ok(text.includes('Science'), 'every subject must appear');
  assert.ok(/Academic performance/i.test(text), 'section 1 must be present');
  assert.ok(text.includes('PUNCTUALITY'), 'the KPI strip must carry the punctuality box');
  assert.ok(!text.includes('ATTENDANCE'), 'attendance must be gone from the student report');
  assert.ok(!text.includes('ATT. %'), 'the subject table must not carry an attendance column');
  assert.ok(/Punctuality & discipline/i.test(text), 'section 2 must be the punctuality and discipline block');
  assert.ok(/Month over month/i.test(text), 'the month-over-month comparison must be present');
  assert.ok(text.includes('All subjects combined'), 'the combined comparison must be present');
  assert.ok(/Teacher comments/i.test(text), 'the teacher comments section must be present');
  assert.ok(/Recent activity/i.test(text), 'the recent activity section must be present');
  assert.ok(text.includes('Class teacher signature'), 'the signature block must be present');
  assert.ok(text.includes('Page 1 of 1'), 'the footer must show the page count');
  assert.ok(!/report information/i.test(text), 'the report information block must not be rendered');
  assert.ok(!/calculation version/i.test(text), 'calculation version metadata must not be rendered');
  assert.ok(text.includes('MONTHLY STUDENT ACADEMIC PROGRESS REPORT'), 'the banner must carry the new monthly progress heading');
  assert.ok(!text.includes('STUDENT ACADEMIC AND BEHAVIOURAL FOLLOW-UP'), 'the old static heading must be gone');
});

test('pdf: KPI counts stay whole and one comment per subject is listed', async () => {
  const period = buildPeriod('2026-08-31', '2026-09-30');
  assert.ok(period, 'fixture period must parse');
  const punctualityCycle = ['ALWAYS_ON_TIME', 'ALWAYS_ON_TIME', 'ALWAYS_ON_TIME', 'ALWAYS_ON_TIME', 'OCCASIONALLY_LATE', 'OCCASIONALLY_LATE', 'FREQUENTLY_LATE', 'OCCASIONALLY_ABSENT', 'FREQUENTLY_ABSENT'];
  const rows: Observation[] = [];
  for (let i = 0; i < 24; i += 1) {
    rows.push({
      lessonId: `kpi-math-${i}`,
      lessonDate: i % 2 === 0 ? `2026-09-${String((i % 20) + 1).padStart(2, '0')}` : `2026-08-${String((i % 20) + 1).padStart(2, '0')}`,
      topic: 'Fractions',
      status: 'APPROVED',
      studentId: 's1',
      studentName: 'Ali Kamberis',
      studentCode: 'STU-010',
      className: '8B',
      subjectName: 'Mathematics',
      teacherName: 'Basita Mohammed',
      attendance: 'PRESENT',
      performance: 'NEEDS_IMPROVEMENT',
      conduct: 'GOOD',
      punctuality: punctualityCycle[i % punctualityCycle.length],
      homework: 'ALWAYS_COMPLETED',
      participation: 'ACTIVE',
      comment: i === 0 ? 'needs improvement on performance' : null,
    });
  }
  for (let i = 0; i < 9; i += 1) {
    rows.push({
      lessonId: `kpi-phys-${i}`,
      lessonDate: '2026-09-15',
      topic: 'Fluids',
      status: 'APPROVED',
      studentId: 's1',
      studentName: 'Ali Kamberis',
      studentCode: 'STU-010',
      className: '8B',
      subjectName: 'Physics',
      teacherName: 'Alsen Atuhura',
      attendance: 'PRESENT',
      performance: 'NEEDS_IMPROVEMENT',
      conduct: 'NEEDS_IMPROVEMENT',
      punctuality: 'ALWAYS_ON_TIME',
      homework: 'ALWAYS_COMPLETED',
      participation: 'ACTIVE',
      comment: 'Needs to focus in class',
    });
  }

  const { doc } = await buildStudentPdf({
    school: 'International Maarif Schools',
    period,
    student: { id: 's1', name: 'Ali Kamberis', code: 'STU-010', className: '8B' },
    subjects: groupReports(rows, RULES),
    overall: summarize(rows, RULES),
    raw: rows,
    rules: RULES,
  });

  const buf = Buffer.from(doc.output('arraybuffer') as ArrayBuffer);
  assert.equal(doc.getNumberOfPages(), 1, `the report must stay a single page, got ${doc.getNumberOfPages()}`);
  const text = pdfStrings(buf);
  assert.ok(
    text.includes('Always On Time 21, Occasionally Late 6, Frequently Late 2, Occasionally Absent 2, Frequently Absent 2'),
    'the punctuality KPI must print every count instead of an ellipsis',
  );
  assert.ok(!/[\u0085\u2026]/.test(text), 'no cell in the report may end with an ellipsis');
  assert.ok(!text.includes('Needs improvement observation'), 'no default comment may be invented for a flagged row');
  const comments = text.slice(text.indexOf('3. TEACHER COMMENTS'), text.indexOf('4. RECENT ACTIVITY'));
  assert.equal(comments.split('needs improvement on performance').length - 1, 1, 'Mathematics lists its written comment exactly once');
  assert.equal(comments.split('Needs to focus in class').length - 1, 1, 'Physics lists its single general comment exactly once');
  assert.ok(text.includes('Basita Mohammed') && text.includes('Alsen Atuhura'), 'teacher names must print in full');
});

test('pdf: per-subject month tables render when space allows', async () => {
  const period = buildPeriod('2026-08-31', '2026-09-30');
  assert.ok(period, 'fixture period must parse');
  const rows = fixture().slice(0, 8);
  const { doc } = await buildStudentPdf({
    school: 'Ecole Maarif',
    period,
    closedMonths: ['2026-08'],
    student: { id: 's1', name: 'Grace Mugisha', code: 'STU-003', className: 'Class 7A' },
    subjects: groupReports(rows, RULES),
    overall: summarize(rows, RULES),
    comparable: groupReportsByMonth(rows, RULES),
    overallMonths: summarizeByMonth(rows, RULES),
    raw: [],
    rules: RULES,
  });
  const buf = Buffer.from(doc.output('arraybuffer') as ArrayBuffer);
  const text = pdfText(buf);
  assert.equal(doc.getNumberOfPages(), 1, `the report must stay a single page, got ${doc.getNumberOfPages()}`);
  assert.ok(text.includes('Mathematics · joffrey'), 'a per-subject month table must render when space allows');
  assert.ok(text.includes('Class teacher signature'), 'signatures must survive the per-subject tables');
  assert.ok(text.includes('Page 1 of 1'), 'the footer must show the page count');
});

test('pdf: student follow-up embeds the organization logo', async () => {
  const period = buildPeriod('2026-08-31', '2026-09-30');
  assert.ok(period, 'fixture period must parse');
  const rows = fixture();
  const { doc } = await buildStudentPdf({
    school: 'Maarif International Schools',
    period,
    student: { id: 's1', name: 'Grace Mugisha', code: 'STU-003', className: 'Class 7A' },
    subjects: groupReports(rows, RULES),
    overall: summarize(rows, RULES),
    raw: rows,
    rules: RULES,
    logoDataUrl: await loadLogoDataUrl('/icons/school_logo.png'),
  });

  const buf = Buffer.from(doc.output('arraybuffer') as ArrayBuffer);
  assert.equal(header(buf), '%PDF-', 'output must be a real PDF header');
  assert.ok(buf.includes(Buffer.from('/Subtype /Image')), 'the logo must be embedded as an image XObject');
  const text = pdfText(buf);
  assert.ok(text.includes('Maarif International Schools'), 'organization name must appear in the document text');
});

test('logo: the logo resolves to an embeddable data URL even when it cannot be fetched', async () => {
  const bundled = await loadLogoDataUrl(null);
  assert.ok(bundled.startsWith('data:image/png;base64,'), `a missing logo must fall back to the bundled logo, got ${bundled.slice(0, 32)}`);
  assert.equal(bundled, FALLBACK_LOGO_DATA_URL, 'the fallback must be the bundled school logo');
  assert.ok(bundled.length > 1000, 'the bundled logo must carry real image bytes');

  const unreachable = await loadLogoDataUrl('/icons/school_logo.png');
  assert.ok(unreachable.startsWith('data:image/png;base64,'), `an unfetchable logo must still resolve to image bytes, got ${unreachable.slice(0, 32)}`);

  const dataUri = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';
  assert.equal(await loadLogoDataUrl(dataUri), dataUri, 'a data URI logo must be used as-is outside the browser');
});

test('pdf: class summary covers every student-subject row and lists every month', async () => {
  const period = buildPeriod('2026-06-01', '2026-09-30');
  assert.ok(period, 'fixture period must parse');
  assert.equal(period.months.length, 4, 'fixture should span four months');
  const rows = fixture();
  const summaries = groupReports(rows, RULES);
  const { doc, filename } = await buildClassSummaryPdf({
    school: 'Ecole Maarif',
    period,
    closedMonths: ['2026-06'],
    summaries,
    comparison: groupReportsByMonth(rows, RULES),
    rules: RULES,
  });

  const buf = Buffer.from(doc.output('arraybuffer') as ArrayBuffer);
  assert.equal(header(buf), '%PDF-', 'output must be a real PDF header');
  assert.match(trailer(buf), /%%EOF/, 'PDF must be terminated with %%EOF');
  assert.match(filename, /^Ecole_Maarif-Class-Summary-.*\.pdf$/, `filename should be class scoped, got ${filename}`);

  const text = pdfText(buf);
  assert.ok(text.includes('Grace Mugisha'), 'every student-subject row must be included');
  assert.ok(text.includes('Ecole Maarif'), 'the organization name must appear in the header and footer');
  assert.ok(!text.includes('STU-003'), 'student IDs must not appear in the class summary');
  assert.ok(text.includes('Mathematics'), 'subject names must be included');
  for (const month of period.months) {
    assert.ok(text.includes(month.slice(0, 4)), `every month in the period must be listed: ${month}`);
  }
  assert.ok(text.includes('Jun'), 'a month with no recorded lessons must still be listed rather than dropped');
  assert.ok(text.includes('Closed'), 'closed months must be flagged');
  assert.ok(text.includes('MONTHLY CLASS ACADEMIC PROGRESS REPORT'), 'the class summary must carry the new monthly progress heading');
});

test('pdf: class reports ZIP packs one valid PDF per student', async () => {
  const period = buildPeriod('2026-08-31', '2026-09-30');
  assert.ok(period, 'fixture period must parse');
  const rows = [...fixture(), ...fixture().map((r) => ({ ...r, studentId: 's2', studentName: 'Ali Nkurunziza', studentCode: 'STU-004' }))];
  const summaries = groupReports(rows, RULES);
  const progress: number[] = [];
  const { bytes, filename, count } = await buildClassReportsZip({
    school: 'Ecole Maarif',
    period,
    summaries,
    comparison: groupReportsByMonth(rows, RULES),
    data: rows,
    rules: RULES,
    onProgress: (done) => progress.push(done),
  });

  assert.equal(count, 2, 'one PDF per student');
  assert.match(filename, /^Ecole_Maarif-Class-Reports-.*\.zip$/, `filename should end with .zip, got ${filename}`);
  assert.deepEqual(progress, [1, 2], 'progress must advance per student');
  assert.equal(Buffer.from(bytes).subarray(0, 2).toString('latin1'), 'PK', 'zip archives start with PK');

  const JSZip = (await import('jszip')).default;
  const zip = await JSZip.loadAsync(bytes);
  const files = Object.keys(zip.files).filter((n) => !zip.files[n].dir);
  assert.equal(files.length, 2, 'both student PDFs must be inside the archive');
  for (const name of files) {
    assert.ok(name.endsWith('-Follow-Up.pdf'), `member should be a student PDF, got ${name}`);
    const content = await zip.files[name].async('nodebuffer');
    assert.equal(content.subarray(0, 5).toString('latin1'), '%PDF-', `${name} must be a real PDF`);
    assert.match(content.subarray(-64).toString('latin1'), /%%EOF/, `${name} must be terminated with %%EOF`);
  }
  assert.ok(files.some((n) => n.includes('Grace_Mugisha')), 'first student must be included');
  assert.ok(files.some((n) => n.includes('Ali_Nkurunziza')), 'second student must be included');
});

test('pdf: club report lists activities by month', async () => {
  const { doc } = await buildClubStudentReport({
    school: 'Ecole Maarif',
    club: { name: 'Robotics Club', description: 'Line-following robots and debate practice.' },
    student: { name: 'Ali Kamberis', code: 'STU-010', className: '8B' },
    rows: [
      { activityId: 'a1', activityDate: '2026-09', title: 'Line-following robots', status: 'APPROVED', punctuality: 'ALWAYS_ON_TIME', performance: 'GOOD', participation: 'ACTIVE', conduct: 'GOOD', comment: 'Good teamwork' },
      { activityId: 'a2', activityDate: '2026-10', title: 'Debate practice', status: 'SUBMITTED', punctuality: 'OCCASIONALLY_LATE', performance: 'NEEDS_IMPROVEMENT', participation: 'MODERATE', conduct: 'GOOD', comment: 'Needs to focus in class' },
    ],
    activitiesTotal: 2,
  });

  const buf = Buffer.from(doc.output('arraybuffer') as ArrayBuffer);
  const text = pdfStrings(buf);
  assert.equal(doc.getNumberOfPages(), 1, `the club report must fit one page, got ${doc.getNumberOfPages()}`);
  assert.ok(text.includes('September 2026') && text.includes('October 2026'), 'activities must be listed by month name');
  assert.ok(text.includes('MONTH'), 'the activity table must be headed MONTH');
  assert.ok(!text.includes('2026-09'), 'the raw month key must not be printed in the report');
  assert.ok(text.includes('Robotics Club'), 'the club name must appear in the report');
  assert.ok(text.includes('PARTICIPATION'), 'without an academic profile the card mix stays club-record based');
});

test('pdf: academic profile percentages divide every rating into shares of the whole', () => {
  assert.equal(
    percentText({ NEEDS_IMPROVEMENT: 5, GOOD: 3, EXCELLENT: 2 }),
    'Needs Improvement 50%, Good 30%, Excellent 20%',
    'ten ratings across subjects must read as 50/30/20 shares that total 100%',
  );
  assert.equal(percentText({ ALWAYS_ON_TIME: 92 }), 'Always On Time 100%', 'a lone category owns the whole set');
  assert.equal(percentText({ USUALLY_COMPLETED: 1, ALWAYS_COMPLETED: 8, RARELY_COMPLETED: 1 }), 'Always Completed 80%, Usually Completed 10%, Rarely Completed 10%', 'homework must order by share');
  assert.equal(percentText({ GOOD: 0, EXCELLENT: 4 }), 'Excellent 100%', 'zero-count categories drop out');
  assert.equal(percentText({}), 'No observations', 'an empty set must say so instead of dividing by zero');
});

test('pdf: club report cards pair the headline result with the subject mix', async () => {
  const { doc } = await buildClubStudentReport({
    school: 'Ecole Maarif',
    club: { name: 'Robotics Club' },
    student: { name: 'Ali Kamberis', code: 'STU-010', className: '8B' },
    rows: [{ activityId: 'a1', activityDate: '2026-09', title: 'Line-following robots', status: 'APPROVED', punctuality: 'ALWAYS_ON_TIME', performance: 'GOOD', participation: 'ACTIVE', conduct: 'GOOD', comment: null }],
    activitiesTotal: 1,
    subjectProfile: {
      label: 'Academic year 2026-2027',
      performance: { NEEDS_IMPROVEMENT: 5, GOOD: 3, EXCELLENT: 2 },
      punctuality: { ALWAYS_ON_TIME: 9, OCCASIONALLY_LATE: 1 },
      homework: { ALWAYS_COMPLETED: 8, USUALLY_COMPLETED: 1, RARELY_COMPLETED: 1 },
      conduct: { GOOD: 10 },
      performanceResult: 'Needs Improvement',
      punctualityResult: 'Always On Time',
      homeworkResult: 'Usually Completed',
      conductResult: 'Good',
    },
  });

  const text = pdfStrings(Buffer.from(doc.output('arraybuffer') as ArrayBuffer));
  for (const label of ['PERFORMANCE', 'PUNCTUALITY', 'HOMEWORK', 'CONDUCT']) {
    assert.ok(text.includes(label), `the ${label} card must be printed`);
  }
  assert.ok(text.includes('Needs Improvement 50%'), 'the performance card must show the 50% share');
  assert.ok(text.includes('Good 30%') && text.includes('Excellent 20%'), 'every performance share must be listed');
  assert.ok(text.includes('Always On Time 90%'), 'the punctuality card must show its share');
  assert.ok(text.includes('Academic year 2026-2027'), 'the identity strip must name the profile window');
  assert.ok(text.includes('Needs Improvement'), 'the headline result must sit above the mix');
  assert.ok(text.includes('ACADEMIC PROFILE'), 'the strip labels the academic profile window');
});

test('pdf: student follow-up carries the clubs the child belongs to', async () => {
  const period = buildPeriod('2026-08-31', '2026-09-30');
  assert.ok(period, 'fixture period must parse');
  const rows = fixture().slice(0, 8);
  const { doc } = await buildStudentPdf({
    school: 'Ecole Maarif',
    period,
    closedMonths: ['2026-08'],
    student: { id: 's1', name: 'Grace Mugisha', code: 'STU-003', className: 'Class 7A' },
    subjects: groupReports(rows, RULES),
    overall: summarize(rows, RULES),
    raw: rows,
    rules: RULES,
    clubs: [
      { clubName: 'Robotics Club', activities: 2, months: ['2026-09'], latest: { title: 'Line-following robots', month: '2026-09', performance: 'GOOD', comment: 'Good teamwork' } },
      { clubName: 'Debate Club', activities: 0, months: [], latest: null },
    ],
  });

  const buf = Buffer.from(doc.output('arraybuffer') as ArrayBuffer);
  const text = pdfStrings(buf);
  assert.equal(doc.getNumberOfPages(), 1, `the report must stay a single page, got ${doc.getNumberOfPages()}`);
  assert.ok(/Clubs & activities/i.test(text), 'the clubs section must be present');
  // The em dash decodes as \u0097 in WinAnsi, so assert on the club name and the summary separately.
  assert.ok(text.includes('Robotics Club') && text.includes('2 activities'), 'a club with activities must print its short record summary');
  assert.ok(text.includes('September 2026') && text.includes('Good teamwork'), 'the summary must name the month and the latest comment');
  assert.ok(text.includes('Debate Club') && text.includes('Member'), 'a club with no activities must still appear as a membership');
  assert.ok(text.includes('Class teacher signature'), 'the signature block must survive the clubs section');
  assert.ok(text.includes('Page 1 of 1'), 'the footer must show the page count');

  const withoutClubs = await buildStudentPdf({
    school: 'Ecole Maarif',
    period,
    student: { id: 's1', name: 'Grace Mugisha', code: 'STU-003', className: 'Class 7A' },
    subjects: groupReports(rows, RULES),
    overall: summarize(rows, RULES),
    raw: rows,
    rules: RULES,
  });
  const plain = pdfStrings(Buffer.from(withoutClubs.doc.output('arraybuffer') as ArrayBuffer));
  assert.ok(!/Clubs & activities/i.test(plain), 'no clubs section is invented when the child belongs to none');
});

test('pdf: class reports ZIP carries each child\'s clubs into their own PDF', async () => {
  const period = buildPeriod('2026-08-31', '2026-09-30');
  assert.ok(period, 'fixture period must parse');
  const rows = [...fixture(), ...fixture().map((r) => ({ ...r, studentId: 's2', studentName: 'Ali Nkurunziza', studentCode: 'STU-004' }))];
  const { bytes } = await buildClassReportsZip({
    school: 'Ecole Maarif',
    period,
    summaries: groupReports(rows, RULES),
    data: rows,
    rules: RULES,
    clubs: {
      s1: [{ clubName: 'Robotics Club', activities: 1, months: ['2026-09'], latest: { title: 'Line-following robots', month: '2026-09', performance: 'GOOD', comment: 'Good teamwork' } }],
      s2: [],
    },
  });

  const JSZip = (await import('jszip')).default;
  const zip = await JSZip.loadAsync(bytes);
  const files = Object.keys(zip.files).filter((n) => !zip.files[n].dir);
  let sawClubs = 0;
  let sawPlain = 0;
  for (const name of files) {
    const text = pdfStrings(await zip.files[name].async('nodebuffer'));
    if (name.includes('Grace_Mugisha')) {
      assert.ok(text.includes('Robotics Club') && text.includes('1 activity'), `the ZIP member for Grace must carry her clubs, got: ${name}`);
      sawClubs += 1;
    } else {
      assert.ok(!/Clubs & activities/i.test(text), `a child with no clubs must not get a clubs section, got: ${name}`);
      sawPlain += 1;
    }
  }
  assert.equal(sawClubs, 1, 'the club member PDF must be in the archive');
  assert.equal(sawPlain, 1, 'the club-less member PDF must be in the archive');
});


import assert from 'node:assert';
import test from 'node:test';
import { inflateSync } from 'node:zlib';
import { buildStudentPdf, buildClassSummaryPdf } from '../src/lib/reportPdf';
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

test('pdf: student follow-up builds a valid multi-page PDF with all data', async () => {
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
  assert.ok(doc.getNumberOfPages() >= 2, `report with 40 observations should span pages, got ${doc.getNumberOfPages()}`);
  assert.ok(doc.getNumberOfPages() < 60, `page count should stay sane, got ${doc.getNumberOfPages()}`);

  const text = pdfText(buf);
  assert.ok(text.includes('Grace Mugisha'), 'student name must appear in the document text');
  assert.ok(text.includes('Ecole Maarif'), 'school name must appear in the document text');
  assert.ok(text.includes('STU-003'), 'student code must appear in the document text');
  assert.ok(text.includes('2026-08-31'), 'period start must appear in the document text');
  assert.ok(text.includes('Mathematics'), 'subject names must appear');
  assert.ok(text.includes('Science'), 'every subject must appear');
  assert.ok(/Academic performance/i.test(text), 'section 1 must be present');
  assert.ok(/lesson-level detail/i.test(text), 'raw observation section must be present');
  assert.ok(text.includes('2026-08-01'), 'individual lesson dates must be present, not just totals');
  assert.ok(text.includes('Version 2'), 'calculation version must be present');
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
  assert.ok(text.includes('STU-003'), 'student codes must be included');
  assert.ok(text.includes('Mathematics'), 'subject names must be included');
  for (const month of period.months) {
    assert.ok(text.includes(month.slice(0, 4)), `every month in the period must be listed: ${month}`);
  }
  assert.ok(text.includes('Jun'), 'a month with no recorded lessons must still be listed rather than dropped');
  assert.ok(text.includes('Closed'), 'closed months must be flagged');
});

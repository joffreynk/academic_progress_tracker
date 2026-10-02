'use client';
import { monthLabelShort, periodLabel, periodSlug, type Period } from '@/lib/period';
import { resultTrend, type Observation, type Rules, type SubjectComparison, type SubjectMonthSummary } from '@/lib/reporting';

type Summary = ReturnType<typeof import('@/lib/reporting').summarize> & {
  studentId: string; studentName: string; studentCode: string; className: string; subjectName: string; teacherName?: string;
};

const INK: [number, number, number] = [30, 52, 68];
const MUTED: [number, number, number] = [116, 134, 149];
const TEAL: [number, number, number] = [13, 122, 110];
const RULE: [number, number, number] = [214, 223, 226];
const ZEBRA: [number, number, number] = [246, 249, 249];

export const pretty = (s: string) => s.replaceAll('_', ' ').toLowerCase().replace(/\b\w/g, (c) => c.toUpperCase());
const countText = (values: Record<string, number>) => Object.entries(values).map(([k, v]) => `${pretty(k)} ${v}`).join(', ') || 'No observations';

const METRICS: { label: string; render: (m: SubjectMonthSummary) => string; numeric?: (m: SubjectMonthSummary) => number | null }[] = [
  { label: 'Lessons recorded', render: (m) => String(m.lessons), numeric: (m) => m.lessons },
  { label: 'Present / Late / Absent', render: (m) => `${m.attendance.PRESENT || 0} / ${m.attendance.LATE || 0} / ${m.attendance.ABSENT || 0}`, numeric: (m) => m.attendanceRate },
  { label: 'Attendance %', render: (m) => (m.attendanceRate === null ? '—' : `${m.attendanceRate}%`), numeric: (m) => m.attendanceRate },
  { label: 'Performance', render: (m) => (m.performanceResult === 'No data' ? '—' : pretty(m.performanceResult)) },
  { label: 'Participation', render: (m) => (m.participationResult === 'No data' ? '—' : pretty(m.participationResult)) },
  { label: 'Homework', render: (m) => m.homeworkResult },
  { label: 'Conduct', render: (m) => (m.conductResult === 'No data' ? '—' : pretty(m.conductResult)) },
  { label: 'Punctuality', render: (m) => m.punctualityResult },
];

const fileSafe = (value: string) => value.replace(/[\\/:*?"<>|]+/g, '-').replace(/\s+/g, '_').slice(0, 80) || 'report';

type Doc = import('jspdf').jsPDF & { lastAutoTable?: { finalY: number } };

/** Small layout cursor over a jsPDF document so sections flow and paginate predictably. */
class PdfWriter {
  doc: Doc;
  y = 0;
  constructor(doc: Doc) { this.doc = doc; }

  get bottom() { return this.doc.internal.pageSize.getHeight() - 46; }
  get width() { return this.doc.internal.pageSize.getWidth(); }
  get margin() { return 40; }
  get content() { return this.width - this.margin * 2; }

  need(height: number) {
    if (this.y + height <= this.bottom) return;
    this.doc.addPage();
    this.y = this.margin;
  }

  space(amount: number) { this.y += amount; }

  text(value: string, opts: { size?: number; color?: [number, number, number]; bold?: boolean; indent?: number; gap?: number } = {}) {
    const size = opts.size ?? 9;
    const lines = this.wrap(value, size, this.content - (opts.indent ?? 0));
    this.doc.setFont('helvetica', opts.bold ? 'bold' : 'normal');
    this.doc.setFontSize(size);
    this.doc.setTextColor(...(opts.color ?? INK));
    this.doc.setFont('helvetica', opts.bold ? 'bold' : 'normal');
    for (const line of lines) {
      this.need(size + 3);
      this.doc.text(line, this.margin + (opts.indent ?? 0), this.y);
      this.y += size + 3;
    }
    this.y += opts.gap ?? 0;
  }

  wrap(value: string, size: number, maxWidth: number) {
    const out: string[] = [];
    for (const paragraph of String(value).split('\n')) {
      let line = '';
      for (const word of paragraph.split(/\s+/).filter(Boolean)) {
        const candidate = line ? `${line} ${word}` : word;
        if (this.doc.getTextWidth(candidate) > maxWidth && line) { out.push(line); line = word; }
        else line = candidate;
      }
      out.push(line);
    }
    return out.length ? out : [''];
  }

  /** Label/value pairs laid out in two columns, wrapping long values. */
  facts(entries: { label: string; value: string }[]) {
    const labelWidth = 118;
    const valueWidth = this.content / 2 - labelWidth - 10;
    let index = 0;
    while (index < entries.length) {
      const row = entries.slice(index, index + 2);
      const heights = row.map((e) => this.wrap(e.value, 9, valueWidth).length * 12 + 4);
      this.need(Math.max(...heights) + 6);
      const rowTop = this.y;
      row.forEach((entry, col) => {
        const x = this.margin + col * (this.content / 2);
        this.doc.setFont('helvetica', 'bold'); this.doc.setFontSize(8); this.doc.setTextColor(...MUTED);
        this.doc.text(entry.label.toUpperCase(), x, rowTop);
        this.doc.setFont('helvetica', 'normal'); this.doc.setFontSize(9); this.doc.setTextColor(...INK);
        const lines = this.wrap(entry.value, 9, valueWidth);
        lines.forEach((line, i) => this.doc.text(line, x + labelWidth, rowTop + i * 12 + 1));
      });
      this.y = rowTop + Math.max(...heights);
      index += 2;
    }
    this.y += 6;
  }

  section(title: string, subtitle?: string) {
    this.need(46);
    this.y += 10;
    this.doc.setDrawColor(...TEAL); this.doc.setLineWidth(1.4);
    this.doc.line(this.margin, this.y - 8, this.margin + 34, this.y - 8);
    this.doc.setFont('helvetica', 'bold'); this.doc.setFontSize(11); this.doc.setTextColor(...TEAL);
    this.doc.text(title.toUpperCase(), this.margin, this.y + 2);
    this.y += 12;
    if (subtitle) { this.text(subtitle, { size: 8, color: MUTED, gap: 2 }); }
    this.y += 4;
  }

  bullet(value: string) {
    const size = 9;
    const lines = this.wrap(value, size, this.content - 12);
    this.need(lines.length * (size + 3));
    const top = this.y;
    this.doc.setFont('helvetica', 'bold'); this.doc.setFontSize(size); this.doc.setTextColor(...TEAL);
    this.doc.text('•', this.margin, top);
    this.doc.setFont('helvetica', 'normal'); this.doc.setTextColor(...INK);
    lines.forEach((line, i) => this.doc.text(line, this.margin + 12, top + i * (size + 3)));
    this.y = top + lines.length * (size + 3) + 2;
  }

  table<T>(head: string[], body: T[][], render: { headStyles?: Record<string, unknown>; columnStyles?: Record<string, unknown>; fontSize?: number; zebra?: boolean } = {}) {
    const rows = body.map((row) => row.map((cell) => (cell == null ? '' : String(cell))));
    if (!rows.length) { this.text('No recorded observations for this period.', { size: 9, color: MUTED, gap: 6 }); return; }
    this.need(60);
    (this.doc as unknown as { autoTable: (o: unknown) => void }).autoTable({
      head: [head],
      body: rows,
      startY: this.y,
      margin: { left: this.margin, right: this.margin, top: this.margin, bottom: 46 },
      theme: 'grid',
      styles: { font: 'helvetica', fontSize: render.fontSize ?? 8, cellPadding: 3.5, textColor: INK, lineColor: RULE, lineWidth: 0.1, overflow: 'linebreak' },
      headStyles: { fillColor: TEAL, textColor: [255, 255, 255], fontStyle: 'bold', fontSize: render.fontSize ?? 8, halign: 'left', valign: 'middle' },
      alternateRowStyles: render.zebra === false ? {} : { fillColor: ZEBRA },
      ...(render.headStyles ?? {}),
      ...(render.columnStyles ?? {}),
      didDrawPage: () => { this.y = this.bottom; },
    });
    this.y = ((this.doc as Doc).lastAutoTable?.finalY ?? this.y) + 8;
  }

  comparisonTable(title: string, months: string[], rows: SubjectMonthSummary[], closedMonths: string[]) {
    this.need(70);
    this.text(title, { size: 10, bold: true, gap: 1 });
    const byMonth = new Map(rows.map((r) => [r.month, r]));
    const head = ['CRITERION', ...months.map((m) => `${monthLabelShort(m)}${closedMonths.includes(m) ? ' (closed)' : ''}`)];
    this.table(head, METRICS.map((metric) => [metric.label, ...months.map((m) => {
      const cell = byMonth.get(m);
      if (!cell) return 'No data';
      const previous = months.indexOf(m) > 0 ? byMonth.get(months[months.indexOf(m) - 1]) : undefined;
      const value = metric.render(cell);
      if (!previous) return value;
      if (metric.numeric) {
        const a = metric.numeric(cell); const b = metric.numeric(previous);
        if (a === null || b === null || a === b) return value;
        return `${value} (${a > b ? '+' : ''}${a - b})`;
      }
      const trend = resultTrend(cell[metric.label as keyof SubjectMonthSummary] as string, previous[metric.label as keyof SubjectMonthSummary] as string);
      return trend === 'flat' ? value : `${value} (${trend === 'up' ? 'improved' : 'declined'})`;
    })]), { fontSize: months.length > 6 ? 6.5 : 7.5 });
  }
}

async function newDoc(orientation: 'portrait' | 'landscape' = 'portrait') {
  const [{ jsPDF }, autoTableModule] = await Promise.all([import('jspdf'), import('jspdf-autotable')]);
  const doc = new jsPDF({ orientation, unit: 'pt', format: 'a4', compress: true }) as Doc;
  const autoTable = (autoTableModule as { default: (doc: Doc, o: unknown) => void }).default;
  (doc as unknown as { autoTable: (o: unknown) => void }).autoTable = (o: unknown) => autoTable(doc, o);
  return doc;
}

function paintChrome(doc: Doc, w: PdfWriter, title: string) {
  const pages = doc.getNumberOfPages();
  for (let page = 1; page <= pages; page += 1) {
    doc.setPage(page);
    const height = doc.internal.pageSize.getHeight();
    const width = doc.internal.pageSize.getWidth();
    doc.setFont('helvetica', 'normal'); doc.setFontSize(7.5); doc.setTextColor(...MUTED);
    doc.text(title, w.margin, height - 26);
    doc.text(`Page ${page} of ${pages}`, width - w.margin, height - 26, { align: 'right' });
    doc.setDrawColor(...RULE); doc.setLineWidth(0.5);
    doc.line(w.margin, height - 34, width - w.margin, height - 34);
  }
}

function save(doc: Doc, filename: string) {
  const blob = doc.output('blob');
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}

/** Loads the organization logo and returns a downscaled PNG data URL the PDF can embed. */
export async function loadLogoDataUrl(url: string, maxPx = 320): Promise<string | null> {
  try {
    const response = await fetch(url, { cache: 'force-cache' });
    if (!response.ok) return null;
    const blob = await response.blob();
    const objectUrl = URL.createObjectURL(blob);
    const image = await new Promise<HTMLImageElement>((resolve, reject) => {
      const img = new Image();
      img.onload = () => resolve(img);
      img.onerror = () => reject(new Error('Logo could not be decoded.'));
      img.src = objectUrl;
    });
    URL.revokeObjectURL(objectUrl);
    const scale = Math.min(1, maxPx / Math.max(image.naturalWidth || image.width, image.naturalHeight || image.height));
    const width = Math.max(1, Math.round((image.naturalWidth || image.width) * scale));
    const height = Math.max(1, Math.round((image.naturalHeight || image.height) * scale));
    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext('2d');
    if (!ctx) return null;
    ctx.drawImage(image, 0, 0, width, height);
    return canvas.toDataURL('image/png');
  } catch {
    return null;
  }
}

function banner(w: PdfWriter, school: string, heading: string, logoDataUrl?: string | null) {
  const top = w.y;
  let textX = w.margin;
  let blockHeight = 34;
  if (logoDataUrl) {
    try {
      const props = w.doc.getImageProperties(logoDataUrl);
      const scale = Math.min(46 / Math.max(props.height, 1), 110 / Math.max(props.width, 1));
      const logoWidth = props.width * scale;
      const logoHeight = props.height * scale;
      w.doc.addImage(logoDataUrl, props.fileType || 'PNG', w.margin, top, logoWidth, logoHeight);
      textX = w.margin + logoWidth + 14;
      blockHeight = Math.max(34, logoHeight);
    } catch {
      textX = w.margin;
    }
  }
  w.doc.setFont('helvetica', 'bold');
  w.doc.setFontSize(17);
  w.doc.setTextColor(...INK);
  for (const line of w.wrap(school, 17, w.width - w.margin - textX)) {
    w.doc.text(line, textX, top + 15);
    break;
  }
  w.doc.setFont('helvetica', 'bold');
  w.doc.setFontSize(9);
  w.doc.setTextColor(...MUTED);
  for (const line of w.wrap(heading, 9, w.width - w.margin - textX)) {
    w.doc.text(line, textX, top + 29);
    break;
  }
  w.y = top + blockHeight + 6;
  w.doc.setDrawColor(...TEAL); w.doc.setLineWidth(1.6);
  w.doc.line(w.margin, w.y, w.width - w.margin, w.y);
  w.space(14);
}

/** Builds the student document without touching the DOM, so it can be unit tested or reused. */
export async function buildStudentPdf(input: {
  school: string; period: Period; closedMonths?: string[]; student: { id: string; name: string; code: string; className: string };
  subjects: Summary[]; overall: ReturnType<typeof import('@/lib/reporting').summarize>;
  comparable?: SubjectComparison[]; overallMonths?: SubjectMonthSummary[]; raw?: Observation[]; rules: Rules;
  logoDataUrl?: string | null;
}): Promise<{ doc: Doc; filename: string }> {
  const { school, period, closedMonths = [], student, subjects, overall, comparable = [], overallMonths = [], raw = [], logoDataUrl = null } = input;
  const months = period.months;
  const doc = await newDoc();
  const w = new PdfWriter(doc);
  const title = `${student.name} — Student Follow-Up`;
  banner(w, school, 'STUDENT ACADEMIC AND BEHAVIOURAL FOLLOW-UP', logoDataUrl);

  w.facts([
    { label: 'Student name', value: student.name },
    { label: 'Student ID', value: student.code },
    { label: 'Class', value: student.className },
    { label: 'Reporting period', value: `${periodLabel(period)} (${period.from} to ${period.to})` },
  ]);

  let sectionNo = 1;
  w.section(`${sectionNo}. Academic performance`);
  w.table(['SUBJECT', 'TEACHER', 'TOPICS COVERED', 'PERFORMANCE', 'SUPPORTING OBSERVATIONS'],
    subjects.map((s) => [s.subjectName, s.teacherName || '—', s.topics.join('; ') || '—', pretty(s.performanceResult), countText(s.performance)]),
    { fontSize: 8 });

  w.section(`${++sectionNo}. Discipline & school conduct`, 'Combined across every subject in the period.');
  w.facts([
    { label: 'Class conduct', value: `${pretty(overall.conductResult)} — ${countText(overall.conduct)}` },
    { label: 'Punctuality', value: `${overall.punctualityResult} — ${countText(overall.punctuality)}` },
    { label: 'Homework & assignments', value: `${overall.homeworkResult} — ${countText(overall.homework)}` },
    { label: 'Participation in class', value: `${pretty(overall.participationResult)} — ${countText(overall.participation)}` },
  ]);

  w.section(`${++sectionNo}. Attendance`);
  w.facts([
    { label: 'Present', value: String(overall.attendance.PRESENT || 0) },
    { label: 'Late coming', value: String(overall.attendance.LATE || 0) },
    { label: 'Absent', value: String(overall.attendance.ABSENT || 0) },
    { label: 'Attendance rate', value: overall.attendanceRate === null ? 'No data' : `${overall.attendanceRate}%` },
  ]);

  if (months.length > 1) {
    w.section(`${++sectionNo}. Month-over-month comparison`, 'Each month is compared with the month immediately before it. Bracketed values show the change.');
    comparable.forEach((c) => w.comparisonTable(`${c.subjectName}${c.teacherName ? ` · ${c.teacherName}` : ''}`, months, c.months, closedMonths));
    w.comparisonTable('All subjects combined', months, overallMonths, closedMonths);
  }

  w.section(`${++sectionNo}. Lesson-level detail`, raw.length ? `All ${raw.length} recorded observation${raw.length === 1 ? '' : 's'} in the period, newest first.` : undefined);
  w.table(['DATE', 'SUBJECT', 'TOPIC', 'TEACHER', 'ATT.', 'PERF.', 'PART.', 'HW', 'COND.', 'PUNCT.', 'COMMENT'],
    [...raw].sort((a, b) => b.lessonDate.localeCompare(a.lessonDate)).map((r) => [
      r.lessonDate, r.subjectName, r.topic || '—', r.teacherName || '—', pretty(r.attendance), r.performance ? pretty(r.performance) : '—',
      r.participation ? pretty(r.participation) : '—', r.homework ? pretty(r.homework) : '—', r.conduct ? pretty(r.conduct) : '—',
      r.punctuality ? pretty(r.punctuality) : '—', r.comment || '—',
    ]), { fontSize: 7 });

  w.section(`${++sectionNo}. Teacher / school comments`);
  if (overall.observations.length) overall.observations.forEach((o) => w.bullet(`${o.date} · ${o.subject}: ${o.comment}`));
  else w.text('No significant observations recorded for this period.', { size: 9, color: MUTED });

  paintChrome(doc, w, title);
  return { doc, filename: `${fileSafe(student.name)}-${fileSafe(student.code)}-${periodSlug(period)}-Follow-Up.pdf` };
}

/** Full individual student follow-up: every subject, every criterion, every month, plus raw lesson detail. */
export async function downloadStudentPdf(input: Parameters<typeof buildStudentPdf>[0] & { logoUrl?: string | null }) {
  const { logoUrl, ...rest } = input;
  const logoDataUrl = logoUrl ? await loadLogoDataUrl(logoUrl) : null;
  const { doc, filename } = await buildStudentPdf({ ...rest, logoDataUrl });
  save(doc, filename);
}

/** Builds the class document without touching the DOM, so it can be unit tested or reused. */
export async function buildClassSummaryPdf(input: {
  school: string; period: Period; closedMonths?: string[]; summaries: Summary[]; comparison?: SubjectComparison[]; rules: Rules; fileTag?: string;
  logoDataUrl?: string | null;
}): Promise<{ doc: Doc; filename: string }> {
  const { school, period, closedMonths = [], summaries, comparison = [], logoDataUrl = null } = input;
  const months = period.months;
  const doc = await newDoc('landscape');
  const w = new PdfWriter(doc);
  const title = `${school} — Class Follow-Up Summary`;
  banner(w, school, 'CLASS ACADEMIC AND BEHAVIOURAL FOLLOW-UP SUMMARY', logoDataUrl);

  const totals = summaries.reduce((acc, s) => {
    acc.lessons += s.lessons;
    acc.present += s.attendance.PRESENT || 0; acc.late += s.attendance.LATE || 0; acc.absent += s.attendance.ABSENT || 0;
    Object.entries(s.performance).forEach(([k, v]) => { acc.performance[k] = (acc.performance[k] || 0) + v; });
    return acc;
  }, { lessons: 0, present: 0, late: 0, absent: 0, performance: {} as Record<string, number> });
  const students = new Set(summaries.map((s) => s.studentId)).size;
  const attTotal = totals.present + totals.late + totals.absent;

  w.facts([
    { label: 'Reporting period', value: `${periodLabel(period)} (${period.from} to ${period.to})` },
    { label: 'Students covered', value: `${students} student${students === 1 ? '' : 's'}` },
    { label: 'Subject rows', value: `${summaries.length} student-subject summar${summaries.length === 1 ? 'y' : 'ies'}` },
    { label: 'Recorded lessons', value: `${totals.lessons} lesson report${totals.lessons === 1 ? '' : 's'}` },
    { label: 'Attendance', value: attTotal ? `${Math.round(((totals.present + totals.late) / attTotal) * 100)}% · ${totals.present} present, ${totals.late} late, ${totals.absent} absent` : 'No data' },
    { label: 'Performance mix', value: countText(totals.performance) },
  ]);

  w.section('1. Student subject summary', 'Every recorded student-subject combination in the selected period.');
  w.table(['STUDENT', 'ID', 'CLASS', 'SUBJECT', 'LESSONS', 'P / L / A', 'ATT. %', 'PERFORMANCE', 'PARTICIPATION', 'HOMEWORK', 'CONDUCT', 'PUNCTUALITY'],
    [...summaries].sort((a, b) => a.studentName.localeCompare(b.studentName) || a.subjectName.localeCompare(b.subjectName)).map((s) => [
      s.studentName, s.studentCode, s.className, s.subjectName, String(s.lessons),
      `${s.attendance.PRESENT || 0} / ${s.attendance.LATE || 0} / ${s.attendance.ABSENT || 0}`,
      s.attendanceRate === null ? '—' : `${s.attendanceRate}%`, pretty(s.performanceResult), pretty(s.participationResult),
      s.homeworkResult, pretty(s.conductResult), s.punctualityResult,
    ]), { fontSize: 7 });

  if (months.length > 1) {
    w.section('2. Month-over-month coverage', 'Lesson volume and attendance per month across the whole cohort. Every month in the period is listed, including months with no recorded lessons.');
    w.table(['MONTH', 'STATUS', 'SUBJECT ROWS', 'LESSON REPORTS', 'STUDENTS', 'P / L / A', 'ATT. %', 'PERFORMANCE MIX'],
      months.map((m) => {
        const groups = comparison.filter((c) => c.months.some((cm) => cm.month === m));
        const cells = groups.map((c) => c.months.find((cm) => cm.month === m)!);
        const present = cells.reduce((a, s) => a + (s.attendance.PRESENT || 0), 0);
        const late = cells.reduce((a, s) => a + (s.attendance.LATE || 0), 0);
        const absent = cells.reduce((a, s) => a + (s.attendance.ABSENT || 0), 0);
        const total = present + late + absent;
        const performance = cells.reduce<Record<string, number>>((acc, s) => { Object.entries(s.performance).forEach(([k, v]) => { acc[k] = (acc[k] || 0) + v; }); return acc; }, {});
        return [
          monthLabelShort(m), closedMonths.includes(m) ? 'Closed' : 'Open', String(cells.length),
          String(cells.reduce((a, s) => a + s.lessons, 0)), String(new Set(groups.map((c) => c.studentId)).size),
          `${present} / ${late} / ${absent}`, total ? `${Math.round(((present + late) / total) * 100)}%` : '—', countText(performance),
        ];
      }), { fontSize: 7.5 });
  }

  paintChrome(doc, w, title);
  return { doc, filename: `${fileSafe(school)}-Class-Summary-${periodSlug(period)}.pdf` };
}

/** Whole-class / whole-cohort summary covering every student-subject row in the period. */
export async function downloadClassSummaryPdf(input: Parameters<typeof buildClassSummaryPdf>[0] & { logoUrl?: string | null }) {
  const { logoUrl, ...rest } = input;
  const logoDataUrl = logoUrl ? await loadLogoDataUrl(logoUrl) : null;
  const { doc, filename } = await buildClassSummaryPdf({ ...rest, logoDataUrl });
  save(doc, filename);
}

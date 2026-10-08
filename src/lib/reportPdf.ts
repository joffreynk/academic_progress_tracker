'use client';
import { monthLabelShort, periodLabel, periodSlug, type Period } from '@/lib/period';
import { resultTrend, summarize, summarizeByMonth, type Observation, type Rules, type SubjectComparison, type SubjectMonthSummary } from '@/lib/reporting';

type Summary = ReturnType<typeof import('@/lib/reporting').summarize> & {
  studentId: string; studentName: string; studentCode: string; className: string; subjectName: string; teacherName?: string;
};

type Color = [number, number, number];

const INK: Color = [30, 52, 68];
const MUTED: Color = [116, 134, 149];
const TEAL: Color = [13, 122, 110];
const RULE: Color = [214, 223, 226];
const ZEBRA: Color = [246, 249, 249];
const WARN: Color = [176, 122, 30];
const BAD: Color = [186, 96, 74];

export const pretty = (s: string) => s.replaceAll('_', ' ').toLowerCase().replace(/\b\w/g, (c) => c.toUpperCase());
const countText = (values: Record<string, number>) => Object.entries(values).map(([k, v]) => `${pretty(k)} ${v}`).join(', ') || 'No observations';

const METRICS: { label: string; render: (m: SubjectMonthSummary) => string; numeric?: (m: SubjectMonthSummary) => number | null }[] = [
  { label: 'Lessons recorded', render: (m) => String(m.lessons), numeric: (m) => m.lessons },
  { label: 'Performance', render: (m) => (m.performanceResult === 'No data' ? '—' : pretty(m.performanceResult)) },
  { label: 'Participation', render: (m) => (m.participationResult === 'No data' ? '—' : pretty(m.participationResult)) },
  { label: 'Homework', render: (m) => m.homeworkResult },
  { label: 'Conduct', render: (m) => (m.conductResult === 'No data' ? '—' : pretty(m.conductResult)) },
  { label: 'Punctuality', render: (m) => m.punctualityResult },
];

const fileSafe = (value: string) => value.replace(/[\\/:*?"<>|]+/g, '-').replace(/\s+/g, '_').slice(0, 80) || 'report';

/** Column widths that add up to exactly the printable width (keeps autoTable's fit check quiet). */
function fitWidths(total: number, weights: number[]) {
  const widths = [...weights];
  const widest = widths.indexOf(Math.max(...widths));
  widths[widest] = total - widths.reduce((sum, w, i) => (i === widest ? sum : sum + w), 0);
  return widths;
}

const todayKey = () => new Date().toISOString().slice(0, 10);

/** Colour for a KPI value: teal for good, amber for caution, red for concern, muted for no data. */
const toneFor = (value: string): Color => {
  const v = String(value).toUpperCase();
  if (v.includes('NO DATA')) return MUTED;
  if (v.includes('NEEDS') || v.includes('FREQUENTLY')) return BAD;
  if (v.includes('OCCASIONALLY') || v.includes('RARELY') || v.includes('PASSIVE')) return WARN;
  if (v.includes('ABSENT')) return BAD;
  if (v.includes('EXCELLENT') || v.includes('ALWAYS') || v.includes('GOOD') || v.includes('ACTIVE')) return TEAL;
  return INK;
};

type Doc = import('jspdf').jsPDF & { lastAutoTable?: { finalY: number } };

/** Single-line ellipsis clip measured with the given font. */
function clipLine(doc: Doc, value: string, size: number, maxWidth: number) {
  const text = String(value ?? '');
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(size);
  if (doc.getTextWidth(text) <= maxWidth) return text;
  let clipped = text;
  while (clipped.length > 1 && doc.getTextWidth(`${clipped}…`) > maxWidth) clipped = clipped.slice(0, -1);
  return `${clipped.replace(/\s+$/, '')}…`;
}

/** Small layout cursor over a jsPDF document so sections flow and paginate predictably. */
class PdfWriter {
  doc: Doc;
  y = 0;
  constructor(doc: Doc) { this.doc = doc; }

  get bottom() { return this.doc.internal.pageSize.getHeight() - 46; }
  get width() { return this.doc.internal.pageSize.getWidth(); }
  get margin() { return 40; }
  get content() { return this.width - this.margin * 2; }

  fits(height: number) { return this.y + height <= this.bottom; }

  need(height: number) {
    if (this.y + height <= this.bottom) return;
    this.doc.addPage();
    this.y = this.margin;
  }

  space(amount: number) { this.y += amount; }

  text(value: string, opts: { size?: number; color?: Color; bold?: boolean; indent?: number; gap?: number } = {}) {
    const size = opts.size ?? 9;
    const lines = this.wrap(value, size, this.content - (opts.indent ?? 0), opts.bold);
    this.doc.setFont('helvetica', opts.bold ? 'bold' : 'normal');
    this.doc.setFontSize(size);
    this.doc.setTextColor(...(opts.color ?? INK));
    for (const line of lines) {
      this.need(size + 3);
      this.doc.text(line, this.margin + (opts.indent ?? 0), this.y);
      this.y += size + 3;
    }
    this.y += opts.gap ?? 0;
  }

  wrap(value: string, size: number, maxWidth: number, bold = false) {
    this.doc.setFont('helvetica', bold ? 'bold' : 'normal');
    this.doc.setFontSize(size);
    const widthOf = (text: string) => this.doc.getTextWidth(text);
    const out: string[] = [];
    for (const paragraph of String(value).split('\n')) {
      let line = '';
      for (const word of paragraph.split(/\s+/).filter(Boolean)) {
        let rest = word;
        while (rest.length) {
          const candidate = line ? `${line} ${rest}` : rest;
          if (widthOf(candidate) <= maxWidth) { line = candidate; rest = ''; break; }
          if (line) { out.push(line); line = ''; continue; }
          let cut = rest.length;
          while (cut > 1 && widthOf(rest.slice(0, cut)) > maxWidth) cut -= 1;
          out.push(rest.slice(0, cut));
          rest = rest.slice(cut);
        }
      }
      out.push(line);
    }
    return out.length ? out : [''];
  }

  /** Truncate a value so it renders within `maxLines` lines at the given size. */
  clip(value: string, size: number, maxWidth: number, maxLines: number) {
    const text = String(value ?? '');
    if (maxLines < 1) return '';
    if (this.wrap(text, size, maxWidth).length <= maxLines) return text;
    let clipped = text;
    while (clipped.length > 1 && this.wrap(`${clipped}…`, size, maxWidth).length > maxLines) clipped = clipped.slice(0, -1);
    return `${clipped.replace(/\s+$/, '')}…`;
  }

  /** Estimated rendered height of an autoTable call (same font metrics autoTable uses). */
  estimateTable(head: string[], rows: string[][], widths: number[], fontSize: number, pad: number, boldHead = false) {
    const lineH = fontSize * 1.15;
    const heightOf = (cells: string[], bold: boolean) => {
      this.doc.setFont('helvetica', bold ? 'bold' : 'normal');
      this.doc.setFontSize(fontSize);
      let lines = 1;
      cells.forEach((cell, i) => {
        const cellWidth = (widths[i] ?? this.content / Math.max(1, cells.length)) - pad * 2;
        lines = Math.max(lines, this.wrap(cell, fontSize, cellWidth, bold).length);
      });
      return lines * lineH + pad * 2;
    };
    return heightOf(head, boldHead) + rows.reduce((sum, row) => sum + heightOf(row, false), 0) + 6;
  }

  /** Label/value pairs laid out in columns, wrapping long values. */
  facts(entries: { label: string; value: string }[], opts: { size?: number; labelSize?: number; labelWidth?: number; lineH?: number; perRow?: number; gap?: number } = {}) {
    const size = opts.size ?? 9;
    const labelSize = opts.labelSize ?? 8;
    const labelWidth = opts.labelWidth ?? 118;
    const lineH = opts.lineH ?? 12;
    const perRow = opts.perRow ?? 2;
    const colWidth = this.content / perRow;
    const valueWidth = colWidth - labelWidth - 10;
    let index = 0;
    while (index < entries.length) {
      const row = entries.slice(index, index + perRow);
      const heights = row.map((e) => this.wrap(e.value, size, valueWidth).length * lineH + 4);
      this.need(Math.max(...heights) + 6);
      const rowTop = this.y;
      row.forEach((entry, col) => {
        const x = this.margin + col * colWidth;
        this.doc.setFont('helvetica', 'bold'); this.doc.setFontSize(labelSize); this.doc.setTextColor(...MUTED);
        this.doc.text(entry.label.toUpperCase(), x, rowTop);
        this.doc.setFont('helvetica', 'normal'); this.doc.setFontSize(size); this.doc.setTextColor(...INK);
        const lines = this.wrap(entry.value, size, valueWidth);
        lines.forEach((line, i) => this.doc.text(line, x + labelWidth, rowTop + i * lineH + 1));
      });
      this.y = rowTop + Math.max(...heights);
      index += perRow;
    }
    this.y += opts.gap ?? 6;
  }

  /** One compact wrapped line of label/value segments (student identity strip). */
  idStrip(entries: { label: string; value: string }[]) {
    if (!entries.length) return;
    const valueSize = 7.5;
    const labelSize = 6;
    const step = 11;
    const rightEdge = this.margin + this.content;
    let x = this.margin;
    let baseline = this.y + 8;
    entries.forEach((entry, i) => {
      const label = `${entry.label.toUpperCase()} `;
      this.doc.setFont('helvetica', 'bold'); this.doc.setFontSize(labelSize);
      const labelWidth = this.doc.getTextWidth(label);
      const value = clipLine(this.doc, entry.value, valueSize, Math.max(40, this.content - labelWidth - 8));
      this.doc.setFont('helvetica', 'normal'); this.doc.setFontSize(valueSize);
      const valueWidth = this.doc.getTextWidth(value);
      const separatorWidth = i ? this.doc.getTextWidth(' · ') : 0;
      if (x + separatorWidth + labelWidth + valueWidth > rightEdge && x > this.margin) { x = this.margin; baseline += step; }
      if (i && x > this.margin) {
        this.doc.setFont('helvetica', 'normal'); this.doc.setFontSize(valueSize); this.doc.setTextColor(...MUTED);
        this.doc.text(' · ', x, baseline);
        x += separatorWidth;
      }
      this.doc.setFont('helvetica', 'bold'); this.doc.setFontSize(labelSize); this.doc.setTextColor(...MUTED);
      this.doc.text(label, x, baseline);
      x += labelWidth;
      this.doc.setFont('helvetica', 'normal'); this.doc.setFontSize(valueSize); this.doc.setTextColor(...INK);
      this.doc.text(value, x, baseline);
      x += valueWidth;
    });
    this.y = baseline + 3;
  }

  /** Row of KPI boxes: uppercase label, bold value, small supporting line. */
  kpiStrip(items: { label: string; value: string; sub?: string; tone?: Color }[]) {
    if (!items.length) return;
    const height = 34;
    this.need(height + 8);
    const gap = 6;
    const boxWidth = (this.content - gap * (items.length - 1)) / items.length;
    const top = this.y;
    items.forEach((item, i) => {
      const x = this.margin + i * (boxWidth + gap);
      this.doc.setFillColor(...ZEBRA);
      this.doc.setDrawColor(...RULE);
      this.doc.setLineWidth(0.4);
      this.doc.roundedRect(x, top, boxWidth, height, 2.5, 2.5, 'FD');
      this.doc.setFont('helvetica', 'normal'); this.doc.setFontSize(6); this.doc.setTextColor(...MUTED);
      this.doc.text(clipLine(this.doc, item.label.toUpperCase(), 6, boxWidth - 12), x + 6, top + 10);
      this.doc.setFont('helvetica', 'bold'); this.doc.setFontSize(10); this.doc.setTextColor(...(item.tone ?? INK));
      this.doc.text(clipLine(this.doc, item.value, 10, boxWidth - 12), x + 6, top + 22);
      if (item.sub) {
        this.doc.setFont('helvetica', 'normal'); this.doc.setFontSize(6); this.doc.setTextColor(...MUTED);
        this.doc.text(clipLine(this.doc, item.sub, 6, boxWidth - 12), x + 6, top + 31);
      }
    });
    this.y = top + height + 8;
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

  /** Compact section heading for the one-page student report. */
  sectionCompact(title: string) {
    this.need(28);
    this.y += 7;
    this.doc.setDrawColor(...TEAL); this.doc.setLineWidth(1.2);
    this.doc.line(this.margin, this.y - 5, this.margin + 24, this.y - 5);
    this.doc.setFont('helvetica', 'bold'); this.doc.setFontSize(9); this.doc.setTextColor(...TEAL);
    this.doc.text(title.toUpperCase(), this.margin, this.y + 4);
    this.y += 10;
  }

  bullet(value: string, opts: { size?: number } = {}) {
    const size = opts.size ?? 9;
    const step = size + 3;
    const lines = this.wrap(value, size, this.content - 12);
    this.need(lines.length * step + 2);
    const top = this.y;
    this.doc.setFont('helvetica', 'bold'); this.doc.setFontSize(size); this.doc.setTextColor(...TEAL);
    this.doc.text('•', this.margin, top);
    this.doc.setFont('helvetica', 'normal'); this.doc.setTextColor(...INK);
    lines.forEach((line, i) => this.doc.text(line, this.margin + 12, top + i * step));
    this.y = top + lines.length * step + 2;
  }

  table<T>(head: string[], body: T[][], render: { headStyles?: Record<string, unknown>; columnStyles?: Record<string, unknown>; fontSize?: number; zebra?: boolean; widths?: number[]; pad?: number } = {}) {
    const rows = body.map((row) => row.map((cell) => (cell == null ? '' : String(cell))));
    if (!rows.length) { this.text('No recorded observations for this period.', { size: 9, color: MUTED, gap: 6 }); return; }
    const fontSize = render.fontSize ?? 8;
    const pad = render.pad ?? 3.5;
    const estimated = this.estimateTable(head, rows, render.widths ?? [], fontSize, pad, true);
    this.need(Math.min(60, estimated));
    const widthStyles = render.widths
      ? Object.fromEntries(render.widths.map((cw, i) => [String(i), { cellWidth: cw }]))
      : {};
    (this.doc as unknown as { autoTable: (o: unknown) => void }).autoTable({
      head: [head],
      body: rows,
      startY: this.y,
      margin: { left: this.margin, right: this.margin, top: this.margin, bottom: 46 },
      theme: 'grid',
      styles: { font: 'helvetica', fontSize, cellPadding: pad, textColor: INK, lineColor: RULE, lineWidth: 0.1, overflow: 'linebreak' },
      headStyles: { fillColor: TEAL, textColor: [255, 255, 255], fontStyle: 'bold', fontSize, halign: 'left', valign: 'middle' },
      alternateRowStyles: render.zebra === false ? {} : { fillColor: ZEBRA },
      ...(render.headStyles ?? {}),
      ...(render.columnStyles ?? {}),
      columnStyles: { ...(render.columnStyles ?? {}), ...widthStyles },
      didDrawPage: () => { this.y = this.bottom; },
    });
    this.y = ((this.doc as Doc).lastAutoTable?.finalY ?? this.y) + 8;
  }

  comparisonTable(title: string, months: string[], rows: SubjectMonthSummary[], closedMonths: string[], opts: { fontSize?: number; widths?: number[]; titleSize?: number } = {}) {
    this.need(70);
    this.text(title, { size: opts.titleSize ?? 10, bold: true, gap: 1 });
    const head = ['CRITERION', ...months.map((m) => `${monthLabelShort(m)}${closedMonths.includes(m) ? ' (closed)' : ''}`)];
    this.table(head, comparisonRows(months, rows), { fontSize: opts.fontSize ?? (months.length > 6 ? 6.5 : 7.5), widths: opts.widths });
  }

  /** Signature lines across the bottom of the page; returns false when there is no room. */
  signatures(roles: string[]) {
    const height = 46;
    if (!this.fits(height)) return false;
    const top = this.y + 8;
    const colWidth = this.content / roles.length;
    roles.forEach((role, i) => {
      const x = this.margin + i * colWidth;
      this.doc.setDrawColor(...RULE); this.doc.setLineWidth(0.6);
      this.doc.line(x, top + 22, x + colWidth - 20, top + 22);
      this.doc.setFont('helvetica', 'normal'); this.doc.setFontSize(7); this.doc.setTextColor(...MUTED);
      this.doc.text(role, x, top + 34);
    });
    this.y = top + 44;
    return true;
  }
}

/** Month-over-month metric rows shared by the student report and its height estimates. */
function comparisonRows(months: string[], rows: SubjectMonthSummary[]): string[][] {
  const byMonth = new Map(rows.map((r) => [r.month, r]));
  return METRICS.map((metric) => [metric.label, ...months.map((m) => {
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
  })]);
}

async function newDoc(orientation: 'portrait' | 'landscape' = 'portrait') {
  const [{ jsPDF }, autoTableModule] = await Promise.all([import('jspdf'), import('jspdf-autotable')]);
  const doc = new jsPDF({ orientation, unit: 'pt', format: 'a4', compress: true }) as Doc;
  const autoTable = (autoTableModule as { default: (doc: Doc, o: unknown) => void }).default;
  (doc as unknown as { autoTable: (o: unknown) => void }).autoTable = (o: unknown) => autoTable(doc, o);
  return doc;
}

function paintChrome(doc: Doc, w: PdfWriter, footer: string) {
  const pages = doc.getNumberOfPages();
  for (let page = 1; page <= pages; page += 1) {
    doc.setPage(page);
    const height = doc.internal.pageSize.getHeight();
    const width = doc.internal.pageSize.getWidth();
    doc.setFont('helvetica', 'normal'); doc.setFontSize(7.5); doc.setTextColor(...MUTED);
    doc.text(clipLine(doc, footer, 7.5, width - w.margin * 2 - 74), w.margin, height - 26);
    doc.text(`Page ${page} of ${pages}`, width - w.margin, height - 26, { align: 'right' });
    doc.setDrawColor(...RULE); doc.setLineWidth(0.5);
    doc.line(w.margin, height - 34, width - w.margin, height - 34);
  }
}

function saveBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}

function save(doc: Doc, filename: string) {
  saveBlob(doc.output('blob'), filename);
}

/** Loads the organization logo and returns a downscaled PNG data URL the PDF can embed. */
export async function loadLogoDataUrl(url: string, maxPx = 320): Promise<string | null> {
  try {
    let source = url;
    let objectUrl: string | null = null;
    if (!url.startsWith('data:')) {
      const response = await fetch(url, { cache: 'force-cache' });
      if (!response.ok) return null;
      objectUrl = URL.createObjectURL(await response.blob());
      source = objectUrl;
    }
    const image = await new Promise<HTMLImageElement>((resolve, reject) => {
      const img = new Image();
      img.onload = () => resolve(img);
      img.onerror = () => reject(new Error('Logo could not be decoded.'));
      img.src = source;
    });
    if (objectUrl) URL.revokeObjectURL(objectUrl);
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

/** Organization name (every wrapped line), report heading, optional right-aligned meta lines and the logo. */
function banner(w: PdfWriter, school: string, heading: string, logoDataUrl?: string | null, meta: string[] = []) {
  const doc = w.doc;
  const top = w.y;
  let textX = w.margin;
  let logoHeight = 0;
  if (logoDataUrl) {
    try {
      const props = doc.getImageProperties(logoDataUrl);
      const scale = Math.min(44 / Math.max(props.height, 1), 96 / Math.max(props.width, 1));
      const logoWidth = props.width * scale;
      logoHeight = props.height * scale;
      doc.addImage(logoDataUrl, props.fileType || 'PNG', w.margin, top + 2, logoWidth, logoHeight);
      textX = w.margin + logoWidth + 12;
    } catch {
      textX = w.margin;
    }
  }
  doc.setFont('helvetica', 'normal'); doc.setFontSize(7.5);
  const metaWidth = meta.length ? Math.max(...meta.map((line) => doc.getTextWidth(line))) : 0;
  const schoolMax = Math.max(140, w.width - w.margin - textX - (meta.length ? metaWidth + 16 : 0));
  const schoolLines = w.wrap(school, 13, schoolMax, true);
  const headingLines = w.wrap(heading, 8.5, schoolMax, true);
  const schoolStep = 15;
  const headingStep = 10;
  let ty = top + 11;
  doc.setFont('helvetica', 'bold'); doc.setFontSize(13); doc.setTextColor(...INK);
  schoolLines.forEach((line) => { doc.text(line, textX, ty); ty += schoolStep; });
  doc.setFont('helvetica', 'bold'); doc.setFontSize(8.5); doc.setTextColor(...MUTED);
  headingLines.forEach((line) => { doc.text(line, textX, ty); ty += headingStep; });
  if (meta.length) {
    doc.setFont('helvetica', 'normal'); doc.setFontSize(7.5); doc.setTextColor(...MUTED);
    let my = top + 11;
    meta.forEach((line) => { doc.text(line, w.width - w.margin, my, { align: 'right' }); my += headingStep; });
  }
  const textHeight = schoolLines.length * schoolStep + headingLines.length * headingStep + 2;
  const metaHeight = meta.length ? meta.length * headingStep + 4 : 0;
  w.y = top + Math.max(logoHeight + 2, textHeight, metaHeight) + 6;
  doc.setDrawColor(...TEAL); doc.setLineWidth(1.6);
  doc.line(w.margin, w.y, w.width - w.margin, w.y);
  w.space(12);
}

/**
 * One-page student progress report: organization name + logo header, identity strip, KPI strip,
 * compact small-font subject table, punctuality & discipline facts, month-over-month comparison,
 * teacher comments, recent activity and a signature block — everything guarded so it stays on one page.
 */
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
  w.y = 16;
  const title = `${student.name} — Student Follow-Up`;
  banner(w, school, 'MONTHLY STUDENT ACADEMIC PROGRESS REPORT', logoDataUrl, [
    `Period: ${periodLabel(period)}`,
    `Generated: ${todayKey()}`,
  ]);

  w.idStrip([
    { label: 'Student', value: student.name },
    { label: 'Class', value: student.className },
    { label: 'Period', value: `${period.from} to ${period.to}` },
  ]);

  w.kpiStrip([
    { label: 'Performance', value: pretty(overall.performanceResult), sub: countText(overall.performance), tone: toneFor(overall.performanceResult) },
    { label: 'Punctuality', value: overall.punctualityResult, sub: countText(overall.punctuality), tone: toneFor(overall.punctualityResult) },
    { label: 'Homework', value: overall.homeworkResult, sub: countText(overall.homework), tone: toneFor(overall.homeworkResult) },
    { label: 'Conduct', value: pretty(overall.conductResult), sub: countText(overall.conduct), tone: toneFor(overall.conductResult) },
  ]);

  let sectionNo = 1;
  w.sectionCompact(`${sectionNo++}. Academic performance`);
  const font = 6.5;
  const pad = 2.5;
  const widths = fitWidths(w.content, [54, 44, 118, 52, 44, 54, 52, 65]);
  const head = ['SUBJECT', 'TEACHER', 'TOPICS COVERED', 'PERF.', 'PART.', 'HOMEWORK', 'CONDUCT', 'PUNCTUALITY'];
  const cellFor = (s: Summary, topicLines: number) => [
    w.clip(s.subjectName, font, widths[0] - pad * 2, 2),
    w.clip(s.teacherName || '—', font, widths[1] - pad * 2, 2),
    w.clip(s.topics.join('; ') || '—', font, widths[2] - pad * 2, topicLines),
    w.clip(pretty(s.performanceResult), font, widths[3] - pad * 2, 2),
    w.clip(pretty(s.participationResult), font, widths[4] - pad * 2, 2),
    w.clip(s.homeworkResult, font, widths[5] - pad * 2, 2),
    w.clip(pretty(s.conductResult), font, widths[6] - pad * 2, 2),
    w.clip(s.punctualityResult, font, widths[7] - pad * 2, 2),
  ];
  const reserve = 110;
  let topicLines = 3;
  let rows = subjects.map((s) => cellFor(s, topicLines));
  let estimated = w.estimateTable(head, rows, widths, font, pad, true);
  let available = w.bottom - w.y;
  for (const level of [2, 1]) {
    if (estimated <= available - reserve) break;
    topicLines = level;
    rows = subjects.map((s) => cellFor(s, topicLines));
    estimated = w.estimateTable(head, rows, widths, font, pad, true);
  }
  let hidden = 0;
  while (estimated > available && rows.length > 1) { rows.pop(); hidden += 1; estimated = w.estimateTable(head, rows, widths, font, pad, true); }
  if (hidden) {
    rows.push([`… ${hidden} more subject${hidden === 1 ? '' : 's'}`, '', '', '', '', '', '', '']);
    estimated = w.estimateTable(head, rows, widths, font, pad, true);
  }
  w.table(head, rows, { fontSize: font, widths, pad });

  w.sectionCompact(`${sectionNo++}. Punctuality & discipline`);
  w.facts([
    { label: 'Punctuality', value: `${overall.punctualityResult} — ${countText(overall.punctuality)}` },
    { label: 'Homework', value: `${overall.homeworkResult} — ${countText(overall.homework)}` },
    { label: 'Participation', value: `${pretty(overall.participationResult)} — ${countText(overall.participation)}` },
    { label: 'Conduct', value: `${pretty(overall.conductResult)} — ${countText(overall.conduct)}` },
    { label: 'Recorded', value: `${overall.lessons} lesson report${overall.lessons === 1 ? '' : 's'} in the period` },
  ], { size: 7.5, labelSize: 6, labelWidth: 84, lineH: 10, gap: 4 });

  const monthHead = ['CRITERION', ...months.map((m) => `${monthLabelShort(m)}${closedMonths.includes(m) ? ' (closed)' : ''}`)];
  const monthShare = (w.content - 150) / Math.max(1, months.length);
  const monthWidths = fitWidths(w.content, [150, ...months.map(() => monthShare)]);
  if (months.length > 1 && overallMonths.length) {
    const monthRows = comparisonRows(months, overallMonths);
    const monthEstimate = w.estimateTable(monthHead, monthRows, monthWidths, 6.5, 2.5, true) + 17 + 14;
    if (w.fits(monthEstimate)) {
      w.sectionCompact(`${sectionNo++}. Month over month`);
      w.comparisonTable('All subjects combined', months, overallMonths, closedMonths, { fontSize: 6.5, widths: monthWidths, titleSize: 8 });
    }
  }

  if (overall.observations.length && w.fits(17 + 24)) {
    w.sectionCompact(`${sectionNo++}. Teacher comments`);
    for (const observation of overall.observations) {
      const line = `${observation.date} · ${observation.subject}: ${observation.comment}`;
      const height = w.wrap(line, 7.5, w.content - 12).length * 10.5 + 4;
      if (!w.fits(height)) break;
      w.bullet(line, { size: 7.5 });
    }
  }

  if (raw.length) {
    const recentFont = 6.5;
    const recentPad = 2.5;
    const recentWidths = fitWidths(w.content, [74, 62, 172, 56, 107]);
    const recentHead = ['DATE(S)', 'SUBJECT', 'TOPIC', 'PERF.', 'COMMENT'];
    const sorted = [...raw].sort((a, b) => b.lessonDate.localeCompare(a.lessonDate));
    type RecentGroup = { from: string; to: string; count: number; subject: string; topic: string; performance: string | null; comment: string | null };
    const groups: RecentGroup[] = [];
    for (const r of sorted) {
      const topic = r.topic || '';
      const performance = r.performance || null;
      const comment = r.comment || null;
      const last = groups[groups.length - 1];
      if (last && last.subject === r.subjectName && last.topic === topic && last.performance === performance && last.comment === comment) {
        last.from = r.lessonDate;
        last.count += 1;
        continue;
      }
      groups.push({ from: r.lessonDate, to: r.lessonDate, count: 1, subject: r.subjectName, topic, performance, comment });
    }
    const recent = groups.slice(0, 6);
    const covered = recent.reduce((sum, g) => sum + g.count, 0);
    const dateLabel = (g: RecentGroup) => (g.count === 1 ? g.from : `${g.from} - ${g.to.slice(5)} (${g.count})`);
    const recentRows = recent.map((g) => [
      w.clip(dateLabel(g), recentFont, recentWidths[0] - recentPad * 2, 1),
      w.clip(g.subject, recentFont, recentWidths[1] - recentPad * 2, 1),
      w.clip(g.topic || '—', recentFont, recentWidths[2] - recentPad * 2, 2),
      g.performance ? w.clip(pretty(g.performance), recentFont, recentWidths[3] - recentPad * 2, 1) : '—',
      w.clip(g.comment || '—', recentFont, recentWidths[4] - recentPad * 2, 2),
    ]);
    const recentEstimate = w.estimateTable(recentHead, recentRows, recentWidths, recentFont, recentPad, true) + 17 + 10 + 14;
    if (w.fits(recentEstimate)) {
      w.sectionCompact(`${sectionNo++}. Recent activity`);
      w.text(`Latest ${recent.length} ${recent.length === 1 ? 'row' : 'rows'} covering ${covered} of ${raw.length} observations; sessions sharing topic and level are grouped.`, { size: 7, color: MUTED, gap: 3 });
      w.table(recentHead, recentRows, { fontSize: recentFont, widths: recentWidths, pad: recentPad });
    }
  }

  if (months.length > 1 && comparable.length) {
    for (const c of comparable) {
      const title = `${c.subjectName}${c.teacherName ? ` · ${c.teacherName}` : ''}`;
      const subjectEstimate = 14 + w.estimateTable(monthHead, comparisonRows(months, c.months), monthWidths, 6.5, 2.5, true) + 14;
      if (!w.fits(subjectEstimate + 52)) break;
      w.comparisonTable(title, months, c.months, closedMonths, { fontSize: 6.5, widths: monthWidths, titleSize: 8 });
    }
  }

  w.signatures(['Class teacher signature', 'Head teacher signature']);
  paintChrome(doc, w, `${school} · ${title} · Generated ${todayKey()}`);
  return { doc, filename: `${fileSafe(student.name)}-${fileSafe(student.code)}-${periodSlug(period)}-Follow-Up.pdf` };
}

/** Full individual student follow-up: one page, organization name and logo in the header. */
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
  w.y = 16;
  const title = `${school} — Class Follow-Up Summary`;
  banner(w, school, 'MONTHLY CLASS ACADEMIC PROGRESS REPORT', logoDataUrl, [
    `Period: ${periodLabel(period)}`,
    `Generated: ${todayKey()}`,
  ]);

  const totals = summaries.reduce((acc, s) => {
    acc.lessons += s.lessons;
    Object.entries(s.performance).forEach(([k, v]) => { acc.performance[k] = (acc.performance[k] || 0) + v; });
    Object.entries(s.punctuality).forEach(([k, v]) => { acc.punctuality[k] = (acc.punctuality[k] || 0) + v; });
    return acc;
  }, { lessons: 0, performance: {} as Record<string, number>, punctuality: {} as Record<string, number> });
  const students = new Set(summaries.map((s) => s.studentId)).size;
  const puncTotal = Object.values(totals.punctuality).reduce((a, b) => a + b, 0);
  const puncOnTime = (totals.punctuality.ALWAYS_ON_TIME || 0) + (totals.punctuality.USUALLY_ON_TIME || 0);

  w.facts([
    { label: 'Reporting period', value: `${periodLabel(period)} (${period.from} to ${period.to})` },
    { label: 'Students covered', value: `${students} student${students === 1 ? '' : 's'}` },
    { label: 'Subject rows', value: `${summaries.length} student-subject summar${summaries.length === 1 ? 'y' : 'ies'}` },
    { label: 'Recorded lessons', value: `${totals.lessons} lesson report${totals.lessons === 1 ? '' : 's'}` },
    { label: 'Punctuality', value: puncTotal ? `${Math.round((puncOnTime / puncTotal) * 100)}% on time · ${countText(totals.punctuality)}` : 'No data' },
    { label: 'Performance mix', value: countText(totals.performance) },
  ]);

  w.section('1. Student subject summary', 'Every recorded student-subject combination in the selected period.');
  w.table(['STUDENT', 'CLASS', 'SUBJECT', 'LESSONS', 'PERFORMANCE', 'PARTICIPATION', 'HOMEWORK', 'CONDUCT', 'PUNCTUALITY'],
    [...summaries].sort((a, b) => a.studentName.localeCompare(b.studentName) || a.subjectName.localeCompare(b.subjectName)).map((s) => [
      s.studentName, s.className, s.subjectName, String(s.lessons),
      pretty(s.performanceResult), pretty(s.participationResult),
      s.homeworkResult, pretty(s.conductResult), s.punctualityResult,
    ]), { fontSize: 6.5 });

  if (months.length > 1) {
    w.section('2. Month-over-month coverage', 'Lesson volume and punctuality mix per month across the whole cohort. Every month in the period is listed, including months with no recorded lessons.');
    w.table(['MONTH', 'STATUS', 'SUBJECT ROWS', 'LESSON REPORTS', 'STUDENTS', 'PUNCTUALITY MIX'],
      months.map((m) => {
        const groups = comparison.filter((c) => c.months.some((cm) => cm.month === m));
        const cells = groups.map((c) => c.months.find((cm) => cm.month === m)!);
        const punctuality = cells.reduce<Record<string, number>>((acc, s) => { Object.entries(s.punctuality).forEach(([k, v]) => { acc[k] = (acc[k] || 0) + v; }); return acc; }, {});
        const performance = cells.reduce<Record<string, number>>((acc, s) => { Object.entries(s.performance).forEach(([k, v]) => { acc[k] = (acc[k] || 0) + v; }); return acc; }, {});
        return [
          monthLabelShort(m), closedMonths.includes(m) ? 'Closed' : 'Open', String(cells.length),
          String(cells.reduce((a, s) => a + s.lessons, 0)), String(new Set(groups.map((c) => c.studentId)).size),
          countText(punctuality), countText(performance),
        ];
      }), { fontSize: 7 });
  }

  paintChrome(doc, w, `${title} · Generated ${todayKey()}`);
  return { doc, filename: `${fileSafe(school)}-Class-Summary-${periodSlug(period)}.pdf` };
}

/** Whole-class / whole-cohort summary covering every student-subject row in the period. */
export async function downloadClassSummaryPdf(input: Parameters<typeof buildClassSummaryPdf>[0] & { logoUrl?: string | null }) {
  const { logoUrl, ...rest } = input;
  const logoDataUrl = logoUrl ? await loadLogoDataUrl(logoUrl) : null;
  const { doc, filename } = await buildClassSummaryPdf({ ...rest, logoDataUrl });
  save(doc, filename);
}

/** One PDF per student for the selected cohort, packed into a single ZIP file (§193). */
export async function buildClassReportsZip(input: {
  school: string; period: Period; closedMonths?: string[]; summaries: Summary[]; comparison?: SubjectComparison[];
  data?: Observation[]; rules: Rules; logoDataUrl?: string | null; onProgress?: (done: number, total: number) => void;
}): Promise<{ bytes: Uint8Array; filename: string; count: number }> {
  const { school, period, closedMonths = [], summaries, comparison = [], data = [], rules, logoDataUrl = null, onProgress } = input;
  const JSZip = (await import('jszip')).default;
  const zip = new JSZip();
  const students = [...new Map(summaries.map((s) => [s.studentId, { id: s.studentId, name: s.studentName, code: s.studentCode, className: s.className }])).values()]
    .sort((a, b) => a.name.localeCompare(b.name));
  let done = 0;
  for (const student of students) {
    const studentRows = data.filter((r) => r.studentId === student.id);
    const subjects = summaries.filter((s) => s.studentId === student.id);
    const overall = summarize(studentRows, rules);
    const comparable = comparison.filter((c) => c.studentId === student.id);
    const { doc, filename } = await buildStudentPdf({
      school, period, closedMonths, student, subjects, overall, comparable,
      overallMonths: summarizeByMonth(studentRows, rules), raw: studentRows, rules, logoDataUrl,
    });
    zip.file(`${fileSafe(student.className)}/${filename}`, doc.output('arraybuffer'));
    done += 1;
    onProgress?.(done, students.length);
  }
  const bytes = await zip.generateAsync({ type: 'uint8array', compression: 'DEFLATE' });
  return { bytes, filename: `${fileSafe(school)}-Class-Reports-${periodSlug(period)}.zip`, count: students.length };
}

/** Downloads every student report in the cohort as one ZIP archive. */
export async function downloadClassReportsZip(input: Parameters<typeof buildClassReportsZip>[0] & { logoUrl?: string | null }) {
  const { logoUrl, ...rest } = input;
  const logoDataUrl = logoUrl ? await loadLogoDataUrl(logoUrl) : null;
  const { bytes, filename, count } = await buildClassReportsZip({ ...rest, logoDataUrl });
  saveBlob(new Blob([bytes as BlobPart], { type: 'application/zip' }), filename);
  return { filename, count };
}

export type ClubActivityRow = {
  activityId: string; activityDate: string; title: string; status: string;
  punctuality: string | null; performance: string | null; participation: string | null; conduct: string | null; comment: string | null;
};

/** Per-member club progress report: identity strip, KPI mix, activity table, comments, signatures. */
export async function buildClubStudentReport(input: {
  school: string; club: { name: string; description?: string | null };
  student: { name: string; code: string; className?: string | null };
  rows: ClubActivityRow[]; activitiesTotal?: number; logoDataUrl?: string | null;
}): Promise<{ doc: Doc; filename: string }> {
  const { school, club, student, activitiesTotal, logoDataUrl = null } = input;
  const rows = [...input.rows].sort((a, b) => a.activityDate.localeCompare(b.activityDate));
  const from = rows[0]?.activityDate || '';
  const to = rows[rows.length - 1]?.activityDate || '';
  const periodText = from ? (from === to ? from : `${from} to ${to}`) : 'No activities recorded';
  const doc = await newDoc();
  const w = new PdfWriter(doc);
  w.y = 16;
  const title = `${student.name} — Club Follow-Up`;
  banner(w, school, 'CLUB & CO-CURRICULAR PROGRESS REPORT', logoDataUrl, [
    `Club: ${club.name}`,
    `Generated: ${todayKey()}`,
  ]);

  w.idStrip([
    { label: 'Student', value: student.name },
    { label: 'Class', value: student.className || 'Not specified' },
    { label: 'Club', value: club.name },
    { label: 'Period', value: periodText },
  ]);

  const tally = (key: 'punctuality' | 'performance' | 'participation' | 'conduct') => {
    const acc: Record<string, number> = {};
    rows.forEach((r) => { const v = r[key]; if (v) acc[v] = (acc[v] || 0) + 1; });
    return acc;
  };
  const topValue = (acc: Record<string, number>) => {
    const entry = Object.entries(acc).sort((a, b) => b[1] - a[1])[0];
    return entry ? pretty(entry[0]) : 'No data';
  };
  const punctuality = tally('punctuality');
  const performance = tally('performance');
  const participation = tally('participation');
  const conduct = tally('conduct');

  w.kpiStrip([
    { label: 'Activities recorded', value: `${rows.length}/${activitiesTotal ?? rows.length}`, sub: rows.length ? 'entries with a record' : 'no rows yet' },
    { label: 'Punctuality', value: topValue(punctuality), sub: countText(punctuality), tone: toneFor(topValue(punctuality)) },
    { label: 'Performance', value: topValue(performance), sub: countText(performance), tone: toneFor(topValue(performance)) },
    { label: 'Participation', value: topValue(participation), sub: countText(participation), tone: toneFor(topValue(participation)) },
    { label: 'Conduct', value: topValue(conduct), sub: countText(conduct), tone: toneFor(topValue(conduct)) },
  ]);

  w.section('1. Activity record', 'One row per club activity for this student, with the observation made on the day.');
  const font = 6.5;
  const pad = 2.5;
  const widths = fitWidths(w.content, [46, 96, 44, 58, 50, 54, 54, 113]);
  w.table(['DATE', 'ACTIVITY', 'STATUS', 'PUNCTUALITY', 'PERF.', 'PARTICIPATION', 'CONDUCT', 'COMMENT'],
    rows.map((r) => [
      w.clip(r.activityDate, font, widths[0] - pad * 2, 2),
      w.clip(r.title, font, widths[1] - pad * 2, 3),
      w.clip(pretty(r.status), font, widths[2] - pad * 2, 2),
      w.clip(r.punctuality ? pretty(r.punctuality) : '—', font, widths[3] - pad * 2, 3),
      w.clip(r.performance ? pretty(r.performance) : '—', font, widths[4] - pad * 2, 2),
      w.clip(r.participation ? pretty(r.participation) : '—', font, widths[5] - pad * 2, 3),
      w.clip(r.conduct ? pretty(r.conduct) : '—', font, widths[6] - pad * 2, 3),
      w.clip(r.comment || '—', font, widths[7] - pad * 2, 3),
    ]), { fontSize: font, pad });

  const comments = rows.filter((r) => (r.comment || '').trim());
  w.section('2. Teacher comments', comments.length ? `${comments.length} entr${comments.length === 1 ? 'y' : 'ies'} carry a written comment.` : undefined);
  if (comments.length) {
    comments.forEach((r) => w.bullet(`${r.activityDate} · ${r.title}: ${r.comment}`, { size: 8.5 }));
  } else {
    w.text('No written comments were recorded for this period.', { size: 9, color: MUTED, gap: 6 });
  }

  if (club.description) w.text(club.description, { size: 8, color: MUTED, gap: 4 });
  if (!w.signatures(['Teacher-in-charge', 'Administrator', 'Parent / Guardian'])) {
    doc.addPage(); w.y = w.margin;
    w.signatures(['Teacher-in-charge', 'Administrator', 'Parent / Guardian']);
  }

  paintChrome(doc, w, `${title} · ${club.name} · Generated ${todayKey()}`);
  return { doc, filename: `${fileSafe(club.name)}-Club-Report-${fileSafe(student.name)}.pdf` };
}

/** One PDF per club member for a club, packed into a single ZIP archive. */
export async function buildClubReportsZip(input: {
  school: string; club: { name: string; description?: string | null };
  members: { id: string; name: string; code: string; className?: string | null }[];
  activities: { id: string; title: string; activityDate: string; status: string }[];
  records: { studentId: string; activityId: string; punctuality: string | null; performance: string | null; participation: string | null; conduct: string | null; comment: string | null }[];
  logoDataUrl?: string | null; onProgress?: (done: number, total: number) => void;
}): Promise<{ bytes: Uint8Array; filename: string; count: number }> {
  const { school, club, members, activities, records, logoDataUrl = null, onProgress } = input;
  const activityById = new Map(activities.map((a) => [a.id, a]));
  const JSZip = (await import('jszip')).default;
  const zip = new JSZip();
  const roster = [...members].sort((a, b) => a.name.localeCompare(b.name));
  const taken = new Set<string>();
  let done = 0;
  for (const member of roster) {
    const rows: ClubActivityRow[] = records.filter((r) => r.studentId === member.id).flatMap((r) => {
      const activity = activityById.get(r.activityId);
      if (!activity) return [];
      return [{
        activityId: activity.id, activityDate: activity.activityDate, title: activity.title, status: activity.status,
        punctuality: r.punctuality, performance: r.performance, participation: r.participation, conduct: r.conduct, comment: r.comment,
      }];
    });
    const { doc, filename } = await buildClubStudentReport({
      school, club, student: { name: member.name, code: member.code, className: member.className || undefined },
      rows, activitiesTotal: activities.length, logoDataUrl,
    });
    let entry = filename;
    if (taken.has(entry)) entry = entry.replace(/\.pdf$/, `-${taken.size + 1}.pdf`);
    taken.add(entry);
    zip.file(entry, doc.output('arraybuffer'));
    done += 1;
    onProgress?.(done, roster.length);
  }
  const bytes = await zip.generateAsync({ type: 'uint8array', compression: 'DEFLATE' });
  const dates = activities.map((a) => a.activityDate).sort();
  const periodTag = dates.length ? `${dates[0]}_to_${dates[dates.length - 1]}` : todayKey();
  return { bytes, filename: `${fileSafe(school)}-${fileSafe(club.name)}-Club-Reports-${periodTag}.zip`, count: roster.length };
}

/** Downloads one report per club member as a single ZIP archive. */
export async function downloadClubReportsZip(input: Parameters<typeof buildClubReportsZip>[0] & { logoUrl?: string | null }) {
  const { logoUrl, ...rest } = input;
  const logoDataUrl = logoUrl ? await loadLogoDataUrl(logoUrl) : null;
  const { bytes, filename, count } = await buildClubReportsZip({ ...rest, logoDataUrl });
  saveBlob(new Blob([bytes as BlobPart], { type: 'application/zip' }), filename);
  return { filename, count };
}

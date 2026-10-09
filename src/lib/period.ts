import { z } from 'zod';

export const MONTH_PATTERN = /^\d{4}-(0[1-9]|1[0-2])$/;
export const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;
export const MAX_PERIOD_MONTHS = 36;

const MONTH_NAMES = ['January','February','March','April','May','June','July','August','September','October','November','December'];
const MONTH_SHORT = MONTH_NAMES.map((m) => m.slice(0, 3));

export const isMonthKey = (value: string) => MONTH_PATTERN.test(value);
export const isDateKey = (value: string) => {
  if (!DATE_PATTERN.test(value)) return false;
  const parsed = new Date(`${value}T12:00:00Z`);
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
};

/** UTC-noon day arithmetic; returns an empty string rather than throwing or silently normalising malformed input. */
export const shiftDays = (date: string, days: number) => { if (!isDateKey(date)) return ''; const d = new Date(`${date}T12:00:00Z`); d.setUTCDate(d.getUTCDate() + days); return d.toISOString().slice(0, 10); };

export const dayBefore = (date: string) => shiftDays(date, -1);
export const dayAfter = (date: string) => shiftDays(date, 1);

export const monthKey = (date: string) => (isDateKey(date) ? date.slice(0, 7) : '');
export const monthStart = (month: string) => (isMonthKey(month) ? `${month}-01` : '');
export const monthEndExclusive = (month: string) => { if (!isMonthKey(month)) return ''; const d = new Date(`${month}-01T12:00:00Z`); d.setUTCMonth(d.getUTCMonth() + 1); return d.toISOString().slice(0, 10); };
export const monthEnd = (month: string) => dayBefore(monthEndExclusive(month));
export const shiftMonth = (month: string, delta: number) => { if (!isMonthKey(month)) return ''; const d = new Date(`${month}-01T12:00:00Z`); d.setUTCMonth(d.getUTCMonth() + delta); return d.toISOString().slice(0, 7); };

/** Uncapped month count between two dates; 0 when either endpoint is not a real date. */
export function monthSpan(from: string, to: string) {
  let cursor = monthKey(from);
  const last = monthKey(to);
  if (!cursor || !last || cursor > last) return 0;
  let count = 0;
  while (cursor <= last) {
    count += 1;
    cursor = shiftMonth(cursor, 1);
    if (!cursor) return 0;
  }
  return count;
}

/** Months covered by the range, ascending. Truncated to MAX_PERIOD_MONTHS as a safety net. */
export function monthsBetween(from: string, to: string) {
  const out: string[] = [];
  let cursor = monthKey(from);
  const last = monthKey(to);
  while (cursor && last && cursor <= last && out.length < MAX_PERIOD_MONTHS) {
    out.push(cursor);
    cursor = shiftMonth(cursor, 1);
  }
  return out;
}

export type Period = { from: string; to: string; months: string[] };

const dateKey = z.string().regex(DATE_PATTERN, 'Dates must use the YYYY-MM-DD format.').refine(isDateKey, 'That calendar date does not exist.');

export const periodSchema = z
  .object({ from: dateKey, to: dateKey })
  .refine((p) => isDateKey(p.from) && isDateKey(p.to) && p.from <= p.to, { message: 'The period start must not fall after the period end.', path: ['from'] })
  .refine((p) => isDateKey(p.from) && isDateKey(p.to) && monthSpan(p.from, p.to) <= MAX_PERIOD_MONTHS, { message: `A reporting period cannot span more than ${MAX_PERIOD_MONTHS} months.`, path: ['from'] });

export function thisMonthPeriod(today: string): Period {
  const month = monthKey(today);
  return { from: monthStart(month), to: monthEnd(month), months: [month] };
}

/** Client-side counterpart of resolvePeriod; returns null when the range is not usable. */
export function buildPeriod(from: string, to: string): Period | null {
  const parsed = periodSchema.safeParse({ from, to });
  if (!parsed.success) return null;
  return { from: parsed.data.from, to: parsed.data.to, months: monthsBetween(parsed.data.from, parsed.data.to) };
}

/** Accepts from/to, falls back to a legacy single `month`, then to the current school month. */
export function resolvePeriod(params: { get(name: string): string | null }, today: string): Period {
  const month = params.get('month');
  const fallback = thisMonthPeriod(today);
  const from = params.get('from') || (month && isMonthKey(month) ? monthStart(month) : fallback.from);
  const to = params.get('to') || (month && isMonthKey(month) ? monthEnd(month) : fallback.to);
  const { from: f, to: t } = periodSchema.parse({ from, to });
  return { from: f, to: t, months: monthsBetween(f, t) };
}

export type PeriodPreset = { id: string; label: string; from: string; to: string };

export function periodPresets(today: string): PeriodPreset[] {
  const current = monthKey(today);
  const previous = shiftMonth(current, -1);
  return [
    { id: 'this-month', label: 'This month', from: monthStart(current), to: monthEnd(current) },
    { id: 'last-month', label: 'Last month', from: monthStart(previous), to: monthEnd(previous) },
    { id: 'last-3-months', label: 'Last 3 months', from: monthStart(shiftMonth(current, -2)), to: monthEnd(current) },
    { id: 'last-6-months', label: 'Last 6 months', from: monthStart(shiftMonth(current, -5)), to: monthEnd(current) },
    { id: 'year-to-date', label: 'Year to date', from: `${today.slice(0, 4)}-01-01`, to: today },
  ];
}

export const formatDate = (date: string) => (isDateKey(date) ? `${Number(date.slice(8, 10))} ${monthLabelShort(date.slice(0, 7))}` : date);
export const monthLabel = (month: string) => (isMonthKey(month) ? `${MONTH_NAMES[Number(month.slice(5, 7)) - 1]} ${month.slice(0, 4)}` : month);
export const monthLabelShort = (month: string) => (isMonthKey(month) ? `${MONTH_SHORT[Number(month.slice(5, 7)) - 1]} ${month.slice(0, 4)}` : month);

export const periodLabel = (period: Period) => (period.months.length === 1 ? monthLabel(period.months[0]) : `${formatDate(period.from)} – ${formatDate(period.to)}`);
export const periodMonthsLabel = (months: string[]) => (months.length === 1 ? monthLabel(months[0]) : months.map(monthLabelShort).join(', '));
export const periodSlug = (period: Period) => `${period.from}_${period.to}`;
export const daysInPeriod = (period: Period) => Math.round((Date.parse(`${period.to}T12:00:00Z`) - Date.parse(`${period.from}T12:00:00Z`)) / 86400000) + 1;

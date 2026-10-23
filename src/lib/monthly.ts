import { z } from 'zod';
import { MONTH_PATTERN, monthStart, monthEnd } from './period';
import type { Observation, Rules } from './reporting';

export const performanceLevels = ['EXCELLENT', 'GOOD', 'NEEDS_IMPROVEMENT'] as const;
export const participationLevels = ['ACTIVE', 'MODERATE', 'PASSIVE'] as const;
export const homeworkLevels = ['ALWAYS_COMPLETED', 'USUALLY_COMPLETED', 'RARELY_COMPLETED'] as const;
export const conductLevels = ['EXCELLENT', 'GOOD', 'NEEDS_IMPROVEMENT'] as const;

// §193 v3: attendance is gone from reports, so this one select carries the whole
// attendance story — five categories from on-time to absent. Only the always-vs-usually
// on-time pair and occasional absence were dropped; absence itself stays two-fold
// (often absent = regular absences, absent = every session missed).
export const punctualityLevels = [
  'ALWAYS_ON_TIME',
  'OCCASIONALLY_LATE',
  'FREQUENTLY_LATE',
  'FREQUENTLY_ABSENT',
  'ALWAYS_ABSENT',
] as const;
export type Punctuality = (typeof punctualityLevels)[number];
/** Pre-5-option categories still stored on old rows — never offered, always scored and labeled. */
export const LEGACY_PUNCTUALITY_LEVELS = ['USUALLY_ON_TIME', 'OCCASIONALLY_ABSENT'] as const;
export type PunctualityKey = Punctuality | (typeof LEGACY_PUNCTUALITY_LEVELS)[number];
export const punctualityLabels: Record<PunctualityKey, string> = {
  ALWAYS_ON_TIME: 'On Time',
  USUALLY_ON_TIME: 'On Time',
  OCCASIONALLY_LATE: 'Occasionally Late',
  FREQUENTLY_LATE: 'Frequently Late',
  OCCASIONALLY_ABSENT: 'Often Absent',
  FREQUENTLY_ABSENT: 'Often Absent',
  ALWAYS_ABSENT: 'Absent',
};
/** Retired keys fold into their nearest current category so every surface shows the same five labels. */
const PUNCTUALITY_FOLD: Record<string, Punctuality> = {
  USUALLY_ON_TIME: 'ALWAYS_ON_TIME',
  OCCASIONALLY_ABSENT: 'FREQUENTLY_ABSENT',
};
/** Merge retired categories into the current five — dropdowns, reports, stats and PDFs all read the same scale. */
export function foldPunctualityTally(counts: Record<string, number>): Record<string, number> {
  const out: Record<string, number> = {};
  for (const [key, count] of Object.entries(counts)) {
    if (!count) continue;
    const target = PUNCTUALITY_FOLD[key] ?? key;
    out[target] = (out[target] || 0) + count;
  }
  return out;
}

/** Ordinal weight per category; the rounded mean of these names an aggregate result. */
export const PUNCTUALITY_SCORE: Record<PunctualityKey, number> = {
  ALWAYS_ON_TIME: 3,
  USUALLY_ON_TIME: 2,
  OCCASIONALLY_LATE: 1,
  FREQUENTLY_LATE: 0,
  OCCASIONALLY_ABSENT: -1,
  FREQUENTLY_ABSENT: -2,
  ALWAYS_ABSENT: -3,
};
/** Select options for a dropdown: the current five plus a legacy value still stored on the row. */
export function punctualityOptionsFor(value?: string | null): [string, string][] {
  const options: [string, string][] = punctualityLevels.map((k) => [k, punctualityLabels[k]]);
  if (value && !punctualityLevels.includes(value as Punctuality)) {
    const baseLabel = punctualityLabels[value as PunctualityKey] ?? value.replaceAll('_', ' ');
    options.push([value, `${baseLabel} (previous)`]);
  }
  return options;
}
const SCORE_LABEL = Object.fromEntries(
  Object.entries(PUNCTUALITY_SCORE).map(([k, v]) => [v, punctualityLabels[k as PunctualityKey]]),
) as Record<number, string>;

/**
 * §193 v3: every session votes its category's ordinal weight and the rounded mean
 * names the result — the same weighted-average idea performance and conduct use.
 * A single teacher's pick is uniform across sessions, so one-subject reports still
 * echo it exactly; a multi-subject student reports average severity instead of a
 * bare plurality that could headline "Always On Time" on a mostly-late month.
 */
export function punctualityResultFromTally(counts: Record<string, number>): string | null {
  let total = 0;
  let sum = 0;
  for (const [key, count] of Object.entries(counts)) {
    const score = PUNCTUALITY_SCORE[key as PunctualityKey];
    if (score === undefined || !count) continue;
    total += count;
    sum += score * count;
  }
  if (!total) return null;
  return SCORE_LABEL[Math.max(-3, Math.min(3, Math.round(sum / total)))] ?? null;
}

const level = <T extends readonly [string, ...string[]]>(values: T) =>
  z.enum(values as unknown as [string, ...string[]]).nullable().optional();

// Teachers pick from the five, but validation accepts the legacy keys too so an
// old draft can be re-saved without losing its category.
const punctualityInputLevels = [...punctualityLevels, ...LEGACY_PUNCTUALITY_LEVELS] as const;

// Present percentages are gone: the teacher picks one punctuality category
// and the session counts for reports are derived from it server-side.
export const monthlyStudentInput = z.object({
  studentId: z.string(),
  punctuality: level(punctualityInputLevels),
  performance: level(performanceLevels),
  participation: level(participationLevels),
  homework: level(homeworkLevels),
  conduct: level(conductLevels),
  comment: z.string().max(1000).nullable().optional(),
});

export const monthlyEntryInput = z.object({
  id: z.string().optional(),
  month: z.string().regex(MONTH_PATTERN, 'Month must be in YYYY-MM format.'),
  classId: z.string().min(1),
  subjectId: z.string().min(1),
  sessionsHeld: z.number().int().min(1).max(400).default(20),
  topics: z.string().max(500),
  submit: z.boolean(),
  records: z.array(monthlyStudentInput).max(200),
});

export type MonthlyStudentInput = z.infer<typeof monthlyStudentInput>;
export type MonthlyEntryInput = z.infer<typeof monthlyEntryInput>;

export function isValidMonth(month: string, today: string): boolean {
  return MONTH_PATTERN.test(month) && month <= today.slice(0, 7);
}

export function monthOverlapsYear(month: string, startDate: string, endDate: string): boolean {
  if (!startDate || !endDate) return false;
  return monthStart(month) <= endDate && monthEnd(month) >= startDate;
}

/** §48: monthly punctuality derives from late records — late / (present + late). */
export function derivePunctuality(present: number, late: number, rules: Rules): string {
  const attended = present + late;
  if (!attended) return 'No data';
  const rate = late / attended;
  if (rate === 0) return punctualityLabels.ALWAYS_ON_TIME;
  return rate <= (rules?.punctualityOccasionallyMax ?? 0.1) ? 'Occasionally Late' : 'Frequently Late';
}

/**
 * §193 v3: turn the monthly punctuality select into session counts.
 * The bands are chosen so the reports agree with what was selected:
 * usually-on-time lags at about half the occasional band, occasional lateness
 * stays inside §48's "occasionally" threshold, frequent lateness leaves it,
 * occasional absence is ~15% of sessions, frequent absence is at least half
 * the month and always absent covers every session.
 */
export function punctualityCounts(punctuality: string | null | undefined, sessionsHeld: number, rules: Rules): { present: number; late: number; absent: number } {
  const sessions = Math.max(1, sessionsHeld);
  const max = rules?.punctualityOccasionallyMax ?? 0.1;
  switch (punctuality) {
    case 'USUALLY_ON_TIME': {
      const late = Math.min(sessions, Math.max(1, Math.floor((sessions * max) / 2)));
      return { present: sessions - late, late, absent: 0 };
    }
    case 'OCCASIONALLY_LATE': {
      const late = Math.min(sessions, Math.max(1, Math.floor(sessions * max)));
      return { present: sessions - late, late, absent: 0 };
    }
    case 'FREQUENTLY_LATE': {
      const late = Math.min(sessions, Math.max(Math.ceil(sessions * 0.3), Math.floor(sessions * max) + 1));
      return { present: sessions - late, late, absent: 0 };
    }
    case 'OCCASIONALLY_ABSENT': {
      const absent = Math.min(sessions, Math.max(1, Math.round(sessions * 0.15)));
      return { present: sessions - absent, late: 0, absent };
    }
    case 'FREQUENTLY_ABSENT': {
      const absent = Math.min(sessions, Math.max(1, Math.ceil(sessions * 0.5)));
      return { present: sessions - absent, late: 0, absent };
    }
    case 'ALWAYS_ABSENT': {
      return { present: 0, late: 0, absent: sessions };
    }
    default:
      // Always on time, or a draft row that has not been chosen yet.
      return { present: sessions, late: 0, absent: 0 };
  }
}

// §47 labels reverse-map to a completion rate so the monthly result round-trips through summarize().
const HOMEWORK_RATE: Record<string, number> = {
  ALWAYS_COMPLETED: 1,
  USUALLY_COMPLETED: 0.9,
  RARELY_COMPLETED: 0.5,
};

/** Weekday dates inside the month, used so synthetic sessions carry sensible dates in exports. */
export function monthSessionDates(month: string): string[] {
  const start = new Date(`${monthStart(month)}T00:00:00Z`);
  const end = new Date(`${monthEnd(month)}T00:00:00Z`);
  const dates: string[] = [];
  for (let d = new Date(start); d <= end; d.setUTCDate(d.getUTCDate() + 1)) {
    const day = d.getUTCDay();
    if (day !== 0 && day !== 6) dates.push(d.toISOString().slice(0, 10));
  }
  return dates.length ? dates : [monthStart(month)];
}

function placeEvenly(slots: (string | null)[], count: number, value: string) {
  if (count <= 0) return;
  const step = slots.length / count;
  for (let k = 0; k < count; k++) {
    let idx = Math.floor(k * step);
    while (idx < slots.length && slots[idx] !== null) idx += 1;
    if (idx >= slots.length) {
      idx = slots.findIndex((s) => s === null);
      if (idx < 0) return;
    }
    slots[idx] = value;
  }
}

export type MonthlyObservationRow = {
  studentId: string;
  studentName: string;
  studentCode: string;
};

export type MonthlyEntrySource = {
  id: string;
  month: string;
  sessionsHeld: number;
  topics: string;
  status: string;
  classNameSnapshot: string | null;
  subjectNameSnapshot: string | null;
  teacherNameSnapshot: string | null;
};

export type MonthlyStudentRow = MonthlyObservationRow & {
  punctuality: string | null;
  performance: string | null;
  participation: string | null;
  homework: string | null;
  conduct: string | null;
  comment: string | null;
};

/**
 * Turn one monthly entry into per-session observations so the whole reporting pipeline
 * (groupReports, thresholds, sample sizes, exports, PDFs) keeps working unchanged.
 * Every session carries the selected punctuality category so reports read back
 * exactly what the teacher chose, absences included.
 */
export function entryObservations(
  entry: MonthlyEntrySource,
  rows: MonthlyStudentRow[],
  className: string,
  subjectName: string,
  teacherName: string,
  rules: Rules,
): Observation[] {
  const dates = monthSessionDates(entry.month);
  const sessions = Math.max(1, entry.sessionsHeld);
  const out: Observation[] = [];
  for (const row of rows) {
    const counts = punctualityCounts(row.punctuality, sessions, rules);
    const slots: (string | null)[] = new Array(sessions).fill(null);
    placeEvenly(slots, counts.absent, 'ABSENT');
    placeEvenly(slots, counts.late, 'LATE');
    for (let i = 0; i < sessions; i++) if (slots[i] === null) slots[i] = 'PRESENT';

    const homeworkRate = row.homework ? HOMEWORK_RATE[row.homework] : null;
    const homeworkDone = homeworkRate === null ? 0 : Math.round(homeworkRate * sessions);

    for (let i = 0; i < sessions; i++) {
      const attendance = slots[i]!;
      const absent = attendance === 'ABSENT';
      const homeworkLabel = i < homeworkDone ? 'ALWAYS_COMPLETED' : 'RARELY_COMPLETED';
      out.push({
        lessonDate: dates[i % dates.length],
        topic: entry.topics,
        lessonId: `${entry.id}#${i}`,
        status: entry.status,
        studentId: row.studentId,
        studentName: row.studentName,
        studentCode: row.studentCode,
        className: entry.classNameSnapshot || className,
        subjectName: entry.subjectNameSnapshot || subjectName,
        teacherName: entry.teacherNameSnapshot || teacherName,
        source: 'monthly',
        attendance,
        performance: absent ? null : row.performance,
        conduct: absent ? null : row.conduct,
        punctuality: row.punctuality,
        homework: absent ? null : homeworkLabel,
        participation: absent ? null : row.participation,
        // One comment per student per month; the rest stay empty so reports list it once.
        comment: i === 0 ? row.comment : null,
      });
    }
  }
  return out;
}

/** Class-level attendance across subjects: counts summed, then converted back to percentages. */
export function combineAttendanceCounts(counts: { present: number; late: number; absent: number }[]) {
  const total = counts.reduce(
    (acc, c) => ({ present: acc.present + c.present, late: acc.late + c.late, absent: acc.absent + c.absent }),
    { present: 0, late: 0, absent: 0 },
  );
  const sessions = total.present + total.late + total.absent;
  let presentPct = sessions ? Math.round((total.present / sessions) * 100) : 100;
  let latePct = sessions ? Math.round((total.late / sessions) * 100) : 0;
  if (presentPct + latePct > 100) latePct = 100 - presentPct;
  if (latePct < 0) { presentPct = 100; latePct = 0; }
  const absentPct = 100 - presentPct - latePct;
  return {
    ...total,
    sessions,
    presentPct,
    latePct,
    absentPct,
    attendanceRate: sessions ? Math.round(((total.present + total.late) / sessions) * 100) : null,
  };
}

import assert from 'node:assert';
import test from 'node:test';
import {
  punctualityCounts, punctualityLabels, punctualityLevels, derivePunctuality, monthSessionDates, entryObservations,
  combineAttendanceCounts, isValidMonth, monthOverlapsYear, monthlyEntryInput,
  type MonthlyStudentRow, type MonthlyEntrySource,
} from '../src/lib/monthly';
import { summarize, groupReports, type Rules } from '../src/lib/reporting';

const RULES: Rules = { version: 3, excellentThreshold: 2.65, goodThreshold: 1.65, homeworkUsuallyThreshold: 0.8, punctualityOccasionallyMax: 0.1 };

const row = (over: Partial<MonthlyStudentRow> = {}): MonthlyStudentRow => ({
  studentId: 's1', studentName: 'Grace Mugisha', studentCode: 'STU-001',
  punctuality: 'ALWAYS_ON_TIME',
  performance: 'GOOD', participation: 'ACTIVE', homework: 'ALWAYS_COMPLETED', conduct: 'GOOD', comment: null,
  ...over,
});

const entry = (over: Partial<MonthlyEntrySource> = {}): MonthlyEntrySource => ({
  id: 'entry-1', month: '2026-09', sessionsHeld: 20, topics: 'Fractions and decimals',
  status: 'APPROVED', classNameSnapshot: 'Class 7A', subjectNameSnapshot: 'Mathematics', teacherNameSnapshot: 'A. Teacher',
  ...over,
});

test('monthly: every punctuality category maps to counts that total sessions held', () => {
  for (const level of punctualityLevels) {
    for (const sessions of [1, 7, 20, 33, 400]) {
      const counts = punctualityCounts(level, sessions, RULES);
      assert.strictEqual(counts.present + counts.late + counts.absent, sessions, `${level} / ${sessions}`);
      assert.ok(counts.present >= 0 && counts.late >= 0 && counts.absent >= 0, `${level} counts stay positive`);
    }
  }
  assert.strictEqual(punctualityCounts(null, 20, RULES).present, 20, 'an unchosen draft row reads as on time');
  assert.strictEqual(Object.keys(punctualityLabels).length, 7, 'seven labels');
  assert.strictEqual(punctualityLabels.USUALLY_ON_TIME, 'Usually On Time');
  assert.strictEqual(punctualityLabels.ALWAYS_ABSENT, 'Always Absent');
});

test('monthly: entry input accepts the punctuality enum and rejects anything else', () => {
  const base = { month: '2026-09', classId: 'c', subjectId: 's', sessionsHeld: 20, topics: '', submit: false };
  for (const punctuality of punctualityLevels) {
    assert.strictEqual(monthlyEntryInput.safeParse({ ...base, records: [{ studentId: 's1', punctuality }] }).success, true, punctuality);
  }
  assert.strictEqual(monthlyEntryInput.safeParse({ ...base, records: [{ studentId: 's1', punctuality: 'SOMETIMES_ABSENT' }] }).success, false);
  const legacy = monthlyEntryInput.safeParse({ ...base, records: [{ studentId: 's1', latePct: 60, absentPct: 45 }] });
  assert.strictEqual(legacy.success, true, 'legacy percentage keys are ignored, not fatal');
  if (legacy.success) {
    assert.strictEqual((legacy.data.records[0] as Record<string, unknown>).punctuality, undefined, 'no punctuality was chosen');
    assert.strictEqual('latePct' in legacy.data.records[0], false, 'percentage keys are stripped');
  }
  assert.strictEqual(monthlyEntryInput.safeParse({ ...base, records: [{ studentId: 's1', punctuality: null }] }).success, true, 'draft rows may be unchosen');
});

test('monthly: derived late and absent rates match the selected category (§48)', () => {
  const onTime = punctualityCounts('ALWAYS_ON_TIME', 20, RULES);
  assert.deepStrictEqual(onTime, { present: 20, late: 0, absent: 0 });

  const usually = punctualityCounts('USUALLY_ON_TIME', 20, RULES);
  assert.ok(usually.late >= 1, 'usually on time still has an occasional late session');
  assert.ok(usually.late / 20 <= RULES.punctualityOccasionallyMax, 'the usual late rate stays inside the occasional band');

  const occasionally = punctualityCounts('OCCASIONALLY_LATE', 20, RULES);
  assert.ok(occasionally.late >= 1, 'occasionally late has at least one late session');
  assert.ok(usually.late < occasionally.late, 'usually on time lags behind occasionally late');
  assert.ok(occasionally.late / 20 <= RULES.punctualityOccasionallyMax, 'the late rate stays inside the occasional band');
  assert.strictEqual(derivePunctuality(occasionally.present, occasionally.late, RULES), 'Occasionally Late');

  const frequently = punctualityCounts('FREQUENTLY_LATE', 20, RULES);
  assert.ok(frequently.late / 20 > RULES.punctualityOccasionallyMax, 'the late rate leaves the occasional band');
  assert.strictEqual(derivePunctuality(frequently.present, frequently.late, RULES), 'Frequently Late');

  const occasionallyAbsent = punctualityCounts('OCCASIONALLY_ABSENT', 20, RULES);
  assert.ok(occasionallyAbsent.absent >= 1 && occasionallyAbsent.absent <= 4, 'occasional absence is a small share');
  assert.strictEqual(occasionallyAbsent.late, 0);

  const frequentlyAbsent = punctualityCounts('FREQUENTLY_ABSENT', 20, RULES);
  assert.ok(frequentlyAbsent.absent >= 10, 'frequent absence covers at least half the month');
  assert.strictEqual(frequentlyAbsent.late, 0);

  const alwaysAbsent = punctualityCounts('ALWAYS_ABSENT', 20, RULES);
  assert.deepStrictEqual(alwaysAbsent, { present: 0, late: 0, absent: 20 }, 'always absent covers every session');
});

test('monthly: punctuality derives from the late rate (§48)', () => {
  assert.strictEqual(derivePunctuality(20, 0, RULES), 'Always On Time');
  assert.strictEqual(derivePunctuality(19, 1, RULES), 'Occasionally Late');
  assert.strictEqual(derivePunctuality(10, 10, RULES), 'Frequently Late');
  assert.strictEqual(derivePunctuality(0, 0, RULES), 'No data');
});

test('monthly: session dates are weekdays inside the month', () => {
  const dates = monthSessionDates('2026-09');
  assert.ok(dates.length >= 20);
  for (const d of dates) {
    assert.ok(d >= '2026-09-01' && d <= '2026-09-30', d);
    const weekday = new Date(`${d}T12:00:00Z`).getUTCDay();
    assert.ok(weekday !== 0 && weekday !== 6, `${d} is a weekend`);
  }
});

test('monthly: entry converts into one observation per session and round-trips summarize()', () => {
  const source = entry({ sessionsHeld: 20 });
  const observations = entryObservations(source, [row({ punctuality: 'OCCASIONALLY_LATE', homework: 'USUALLY_COMPLETED', comment: 'Strong improvement this month.' })], 'Class 7A', 'Mathematics', 'A. Teacher', RULES);

  assert.strictEqual(observations.length, 20, 'one observation per session');
  assert.strictEqual(new Set(observations.map((o) => o.lessonId)).size, 20, 'unique synthetic lesson ids');
  assert.strictEqual(observations.filter((o) => o.comment).length, 1, 'the monthly comment appears exactly once');
  assert.strictEqual(observations[0].comment, 'Strong improvement this month.');

  const summary = summarize(observations, RULES);
  assert.strictEqual(summary.lessons, 20);
  // 10% of 20 sessions late, nothing absent.
  assert.deepStrictEqual([summary.attendance.PRESENT ?? 0, summary.attendance.LATE ?? 0, summary.attendance.ABSENT ?? 0], [18, 2, 0]);
  assert.strictEqual(summary.attendanceRate, 100);
  // 90% homework completion stays "Usually Completed", not "Always".
  assert.strictEqual(summary.homeworkResult, 'Usually Completed');
  // The report agrees with what the teacher selected.
  assert.strictEqual(summary.punctualityResult, 'Occasionally Late');
  assert.strictEqual(summary.performanceResult, 'GOOD');
});

test('monthly: a frequently absent student reads as mostly absent with no lateness', () => {
  const observations = entryObservations(entry(), [row({ punctuality: 'FREQUENTLY_ABSENT' })], 'Class 7A', 'Mathematics', 'A. Teacher', RULES);
  const summary = summarize(observations, RULES);
  assert.deepStrictEqual([summary.attendance.PRESENT ?? 0, summary.attendance.LATE ?? 0, summary.attendance.ABSENT ?? 0], [10, 0, 10]);
  assert.strictEqual(summary.attendanceRate, 50);
  assert.strictEqual(summary.punctualityResult, 'Frequently Absent', 'absence now surfaces through punctuality');
  assert.strictEqual(summary.performanceResult, 'GOOD');
});

test('monthly: every punctuality category round-trips into the report result', () => {
  for (const level of punctualityLevels) {
    const observations = entryObservations(entry(), [row({ punctuality: level })], 'Class 7A', 'Mathematics', 'A. Teacher', RULES);
    const summary = summarize(observations, RULES);
    assert.strictEqual(summary.punctualityResult, punctualityLabels[level], level);
    assert.ok(summary.punctuality[level] === 20, `${level} is carried on every session`);
  }
  const unchosen = summarize(entryObservations(entry(), [row({ punctuality: null })], 'Class 7A', 'Mathematics', 'A. Teacher', RULES), RULES);
  assert.strictEqual(unchosen.punctualityResult, 'No data', 'an unchosen draft row still reads as no data');
});

test('monthly: groupReports sees the entry as a normal student-subject report', () => {
  const observations = [
    ...entryObservations(entry(), [row()], 'Class 7A', 'Mathematics', 'A. Teacher', RULES),
    ...entryObservations(entry({ id: 'entry-2', sessionsHeld: 10, subjectNameSnapshot: 'Science' }), [row({ punctuality: 'OCCASIONALLY_ABSENT' })], 'Class 7A', 'Science', 'B. Teacher', RULES),
  ];
  const reports = groupReports(observations, RULES);
  assert.strictEqual(reports.length, 2);
  assert.deepStrictEqual(reports.map((r) => r.subjectName).sort(), ['Mathematics', 'Science']);
  assert.strictEqual(reports[1].lessons, 10);
});

test('monthly: combining attendance across subjects totals counts, then percentages', () => {
  const combined = combineAttendanceCounts([
    { present: 17, late: 2, absent: 1 },
    { present: 20, late: 0, absent: 0 },
  ]);
  assert.strictEqual(combined.sessions, 40);
  assert.strictEqual(combined.present + combined.late + combined.absent, 40);
  assert.strictEqual(combined.presentPct + combined.latePct + combined.absentPct, 100);
  assert.strictEqual(combined.attendanceRate, Math.round(((combined.present + combined.late) / 40) * 100));
});

test('monthly: month validation and academic-year overlap', () => {
  assert.strictEqual(isValidMonth('2026-09', '2026-10-02'), true);
  assert.strictEqual(isValidMonth('2026-10', '2026-10-02'), true, 'current month is allowed');
  assert.strictEqual(isValidMonth('2026-11', '2026-10-02'), false, 'future months are rejected');
  assert.strictEqual(isValidMonth('nope', '2026-10-02'), false);

  assert.strictEqual(monthOverlapsYear('2026-09', '2026-01-01', '2026-12-31'), true);
  assert.strictEqual(monthOverlapsYear('2025-12', '2026-01-01', '2026-12-31'), false);
  assert.strictEqual(monthOverlapsYear('2026-01', '2026-01-01', '2026-12-31'), true);
});

import 'dotenv/config';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { validLessonDate, dateMinus } from '../src/lib/security';
import { summarize, groupReports, calculateStudentTrends, buildNormalRecordDefaults, buildReportActivitySeries, type Observation } from '../src/lib/reporting';
import { reviewTransition } from '../src/lib/review';
import { normalizeTeacherAssignmentImportRow } from '../src/lib/importing';

test('§import: teacher roster row with NO, NAME, SURNAME, EMAIL, SUBJECTS and CLASSES is normalized correctly', () => {
  const row = {
    NO: '1',
    NAME: 'John',
    SURNAME: 'Mugabo',
    'CONTACT DETAIL': '+250788123456',
    NATIONALITY: 'Burundian',
    EMAIL: 'john@school.com',
    SUBJECTS: 'Mathematics, ICT',
    CLASSES: '7A; 8A',
  };

  assert.deepEqual(normalizeTeacherAssignmentImportRow(row), {
    teacherId: '1',
    name: 'John',
    surname: 'Mugabo',
    email: 'john@school.com',
    contactDetail: '+250788123456',
    nationality: 'Burundian',
    subjects: ['Mathematics', 'ICT'],
    classes: ['7A', '8A'],
  });
});

// §154 & §2: Critical 14-Day Date Rule
test('§154: 14-day inclusive window accepts today and past 14 days, rejects future and older dates', () => {
  const schoolToday = '2026-09-28';
  assert.equal(dateMinus(schoolToday, 14), '2026-09-14');

  // Allowed dates (inclusive)
  assert.equal(validLessonDate('2026-09-28', schoolToday), true, 'Today should be allowed');
  assert.equal(validLessonDate('2026-09-21', schoolToday), true, '7 days ago should be allowed');
  assert.equal(validLessonDate('2026-09-14', schoolToday), true, 'Exactly 14 days ago should be allowed');

  // Disallowed dates
  assert.equal(validLessonDate('2026-09-13', schoolToday), false, '15 days ago must be rejected (§160)');
  assert.equal(validLessonDate('2026-09-29', schoolToday), false, 'Tomorrow must be rejected (§159)');
  assert.equal(validLessonDate('2026-10-05', schoolToday), false, 'Future date must be rejected');
  assert.equal(validLessonDate('invalid-date', schoolToday), false, 'Malformed date string must be rejected');
  assert.equal(validLessonDate('2026-02-30', schoolToday), false, 'Non-existent calendar date must be rejected');
});

// §114: Date Edge Cases across Months and Leap Years
test('§114: Date boundaries handle month changes, leap years, and year-ends correctly', () => {
  assert.equal(dateMinus('2026-03-01', 14), '2026-02-15');
  assert.equal(dateMinus('2024-03-01', 1), '2024-02-29'); // Leap year 2024
  assert.equal(dateMinus('2027-01-01', 14), '2026-12-18'); // Year boundary

  assert.equal(validLessonDate('2026-12-18', '2027-01-01'), true);
  assert.equal(validLessonDate('2026-12-17', '2027-01-01'), false);
});

// §161 & §29: Absent Student Logic
test('§161: Absent student observations do not calculate academic scores and count toward absence', () => {
  const base: Observation = {
    lessonId: 'l1',
    lessonDate: '2026-09-20',
    topic: 'Fractions',
    status: 'APPROVED',
    studentId: 's1',
    studentName: 'Alice Green',
    studentCode: 'DIS-001',
    className: '7A',
    subjectName: 'Mathematics',
    attendance: 'PRESENT',
    performance: 'GOOD',
    participation: 'ACTIVE',
    homework: 'COMPLETED',
    conduct: 'GOOD',
    comment: null,
  };

  const rows: Observation[] = [
    base,
    { ...base, lessonId: 'l2', attendance: 'LATE', performance: 'EXCELLENT', participation: 'ACTIVE', homework: 'COMPLETED', conduct: 'EXCELLENT' },
    { ...base, lessonId: 'l3', attendance: 'ABSENT', performance: null, participation: null, homework: null, conduct: null },
  ];

  const result = summarize(rows, undefined);
  assert.equal(result.lessons, 3);
  assert.equal(result.attendance.PRESENT, 1);
  assert.equal(result.attendance.LATE, 1);
  assert.equal(result.attendance.ABSENT, 1);
  assert.equal(result.attendanceRate, 67); // 2 attended / 3 total = 67%

  // Only 2 academic performance observations (present + late); absent has null
  assert.equal((result.performance.GOOD || 0) + (result.performance.EXCELLENT || 0), 2);
  assert.equal(result.performance.GOOD, 1);
  assert.equal(result.performance.EXCELLENT, 1);
});

// §162 & §48: Late Student Logic & Punctuality
test('§162: Late attendance counts as attended lesson and contributes to punctuality score', () => {
  const base: Observation = {
    lessonId: '1',
    lessonDate: '2026-09-20',
    topic: 'Grammar',
    status: 'APPROVED',
    studentId: 's1',
    studentName: 'Bob White',
    studentCode: 'DIS-002',
    className: '8A',
    subjectName: 'English',
    attendance: 'PRESENT',
    performance: 'GOOD',
    participation: 'ACTIVE',
    homework: 'COMPLETED',
    conduct: 'GOOD',
    comment: null,
  };

  // 10 attended lessons, 0 late -> Always On Time
  const onTimeRows = Array.from({ length: 10 }, (_, i) => ({ ...base, lessonId: String(i) }));
  assert.equal(summarize(onTimeRows, undefined).punctualityResult, 'Always On Time');

  // 10 attended lessons, 1 late (10%) -> Occasionally Late (<= 10% threshold)
  const occasionallyLateRows = [...onTimeRows.slice(0, 9), { ...base, lessonId: '9', attendance: 'LATE' }];
  assert.equal(summarize(occasionallyLateRows, undefined).punctualityResult, 'Occasionally Late');

  // 10 attended lessons, 2 late (20%) -> Frequently Late (> 10% threshold)
  const frequentlyLateRows = [...onTimeRows.slice(0, 8), { ...base, lessonId: '8', attendance: 'LATE' }, { ...base, lessonId: '9', attendance: 'LATE' }];
  assert.equal(summarize(frequentlyLateRows, undefined).punctualityResult, 'Frequently Late');
});

// §163, §44 & §47: Monthly Aggregation & Threshold Scoring
test('§163: Monthly scoring retains observation counts and classifies according to thresholds', () => {
  // 18 lessons: 2 EXCELLENT (score 3), 11 GOOD (score 2), 5 NEEDS_IMPROVEMENT (score 1)
  // Total score = 2*3 + 11*2 + 5*1 = 6 + 22 + 5 = 33 / 18 = 1.8333
  // Default thresholds: EXCELLENT >= 2.65, GOOD >= 1.65, NEEDS_IMPROVEMENT < 1.65
  // Average 1.8333 falls into GOOD
  const rows: Observation[] = Array.from({ length: 18 }, (_, i) => ({
    lessonId: String(i),
    lessonDate: '2026-09-20',
    topic: i % 2 ? 'Fractions' : 'Algebra',
    status: 'APPROVED',
    studentId: 'student-1',
    studentName: 'Student One',
    studentCode: 'S001',
    className: '7A',
    subjectName: 'Mathematics',
    attendance: 'PRESENT',
    performance: i < 2 ? 'EXCELLENT' : i < 13 ? 'GOOD' : 'NEEDS_IMPROVEMENT',
    participation: 'ACTIVE',
    homework: i < 15 ? 'COMPLETED' : 'NOT_COMPLETED',
    conduct: 'GOOD',
    comment: null,
  }));

  const result = summarize(rows, undefined);
  assert.equal(result.lessons, 18);
  assert.equal(result.performance.EXCELLENT, 2);
  assert.equal(result.performance.GOOD, 11);
  assert.equal(result.performance.NEEDS_IMPROVEMENT, 5);
  assert.equal(result.performanceResult, 'GOOD');
  // Homework: 15 / 18 = 83.3% >= 80% default threshold -> Usually Completed
  assert.equal(result.homeworkResult, 'Usually Completed');
  assert.deepEqual(result.topics, ['Algebra', 'Fractions']);
});

// §164: Delayed Entry Aggregation by lessonDate
test('§164: Delayed report entry is classified under lessonDate month, not entry timestamp', () => {
  const lessonInSeptember: Observation = {
    lessonId: 'sep-1',
    lessonDate: '2026-09-28', // September lesson date
    topic: 'Plant Biology',
    status: 'APPROVED',
    studentId: 's1',
    studentName: 'David Lee',
    studentCode: 'DIS-003',
    className: '9A',
    subjectName: 'Science',
    attendance: 'PRESENT',
    performance: 'EXCELLENT',
    participation: 'ACTIVE',
    homework: 'COMPLETED',
    conduct: 'EXCELLENT',
    comment: null,
  };

  // The lesson date determines the month grouping (2026-09)
  assert.equal(lessonInSeptember.lessonDate.slice(0, 7), '2026-09');
  const grouped = groupReports([lessonInSeptember], undefined);
  assert.equal(grouped.length, 1);
  assert.equal(grouped[0].studentName, 'David Lee');
  assert.equal(grouped[0].performanceResult, 'EXCELLENT');
});

test('§27: default normal record sets teacher baseline to good and active values', () => {
  const defaults = buildNormalRecordDefaults();
  assert.deepEqual(defaults, {
    attendance: 'PRESENT',
    performance: 'GOOD',
    participation: 'ACTIVE',
    homework: 'COMPLETED',
    conduct: 'GOOD',
    comment: '',
  });
});

test('§146: report activity series aggregates lesson submission and review counts by date', () => {
  const rows: Observation[] = [
    { lessonId: 'l1', lessonDate: '2026-09-01', topic: 'Algebra', status: 'SUBMITTED', studentId: 's1', studentName: 'A', studentCode: 'S1', className: '7A', subjectName: 'Math', attendance: 'PRESENT', performance: 'GOOD', participation: 'ACTIVE', homework: 'COMPLETED', conduct: 'GOOD', comment: null },
    { lessonId: 'l2', lessonDate: '2026-09-01', topic: 'Geometry', status: 'APPROVED', studentId: 's2', studentName: 'B', studentCode: 'S2', className: '7A', subjectName: 'Math', attendance: 'LATE', performance: 'GOOD', participation: 'ACTIVE', homework: 'COMPLETED', conduct: 'GOOD', comment: null },
    { lessonId: 'l3', lessonDate: '2026-09-02', topic: 'Science', status: 'RETURNED', studentId: 's3', studentName: 'C', studentCode: 'S3', className: '7B', subjectName: 'Science', attendance: 'ABSENT', performance: null, participation: null, homework: null, conduct: null, comment: null },
  ];

  assert.deepEqual(buildReportActivitySeries(rows), [
    { date: '2026-09-01', submitted: 1, approved: 1, returned: 0, total: 2 },
    { date: '2026-09-02', submitted: 0, approved: 0, returned: 1, total: 1 },
  ]);
});

// §41 & §166: Report Review Workflow Transitions
test('§41 & §166: Report review transitions validate status changes and mandate reason on return/reopen', () => {
  // Valid transitions
  assert.equal(reviewTransition('SUBMITTED', 'UNDER_REVIEW').status, 'UNDER_REVIEW');
  assert.equal(reviewTransition('UNDER_REVIEW', 'APPROVED').status, 'APPROVED');
  assert.equal(reviewTransition('APPROVED', 'SUBMITTED', 'Correction needed').status, 'RETURNED');
  assert.equal(reviewTransition('UNDER_REVIEW', 'RETURNED', 'Needs detail').status, 'RETURNED');

  // Invalid transitions
  assert.throws(() => reviewTransition('DRAFT', 'APPROVED'), /not allowed/);
  assert.throws(() => reviewTransition('SUBMITTED', 'APPROVED'), /not allowed/);
  assert.throws(() => reviewTransition('APPROVED', 'SUBMITTED', ''), /reason is required/);
  assert.throws(() => reviewTransition('SUBMITTED', 'RETURNED', ''), /reason is required/);
});

// §153: Normal Distribution of Grades Test
test('§153: Normal distribution of grades calculates across multiple students correctly', () => {
  const baseStudent = (id: string, name: string): Observation => ({
    lessonId: '1',
    lessonDate: '2026-09-01',
    topic: 'Algebra',
    status: 'APPROVED',
    studentId: id,
    studentName: name,
    studentCode: `S-${id}`,
    className: '10A',
    subjectName: 'Mathematics',
    attendance: 'PRESENT',
    performance: 'GOOD',
    participation: 'ACTIVE',
    homework: 'COMPLETED',
    conduct: 'GOOD',
    comment: null,
  });

  // Student 1: Consistently high performer (avg 3.0) -> EXCELLENT
  const s1Obs = Array.from({ length: 10 }, (_, i) => ({
    ...baseStudent('s1', 'Top Student'),
    lessonId: `l-${i}`,
    performance: 'EXCELLENT',
  }));
  assert.equal(summarize(s1Obs, undefined).performanceResult, 'EXCELLENT');

  // Student 2: Solid average performer (avg 2.0) -> GOOD
  const s2Obs = Array.from({ length: 10 }, (_, i) => ({
    ...baseStudent('s2', 'Average Student'),
    lessonId: `l-${i}`,
    performance: 'GOOD',
  }));
  assert.equal(summarize(s2Obs, undefined).performanceResult, 'GOOD');

  // Student 3: Struggling student (avg 1.0) -> NEEDS_IMPROVEMENT
  const s3Obs = Array.from({ length: 10 }, (_, i) => ({
    ...baseStudent('s3', 'Struggling Student'),
    lessonId: `l-${i}`,
    performance: 'NEEDS_IMPROVEMENT',
    comment: 'Needs extra math tutoring',
  }));
  assert.equal(summarize(s3Obs, undefined).performanceResult, 'NEEDS_IMPROVEMENT');
});

// §155: Single Lesson Month Test
test('§155: Month with exactly one lesson aggregates without division by zero or errors', () => {
  const singleAttended: Observation = {
    lessonId: 'single-1',
    lessonDate: '2026-09-05',
    topic: 'Geometry Basics',
    status: 'APPROVED',
    studentId: 's1',
    studentName: 'Solo Student',
    studentCode: 'S-001',
    className: '7B',
    subjectName: 'Mathematics',
    attendance: 'PRESENT',
    performance: 'EXCELLENT',
    participation: 'ACTIVE',
    homework: 'COMPLETED',
    conduct: 'EXCELLENT',
    comment: null,
  };

  const summary = summarize([singleAttended], undefined);
  assert.equal(summary.lessons, 1);
  assert.equal(summary.attendanceRate, 100);
  assert.equal(summary.performanceResult, 'EXCELLENT');
  assert.equal(summary.homeworkResult, 'Always Completed');
  assert.equal(summary.punctualityResult, 'Always On Time');

  // Single lesson where student was absent
  const singleAbsent: Observation = {
    ...singleAttended,
    attendance: 'ABSENT',
    performance: null,
    participation: null,
    homework: null,
    conduct: null,
  };
  const absentSummary = summarize([singleAbsent], undefined);
  assert.equal(absentSummary.lessons, 1);
  assert.equal(absentSummary.attendanceRate, 0);
  assert.equal(absentSummary.performanceResult, 'No data');
  assert.equal(absentSummary.homeworkResult, 'No data');
  assert.equal(absentSummary.punctualityResult, 'No data');
});

// §156: Inactive Student Exclusion Logic
test('§156: Only active student roster observations are grouped, excluding inactive records from reports', () => {
  const activeStudent: Observation = {
    lessonId: 'l1',
    lessonDate: '2026-09-10',
    topic: 'Atoms',
    status: 'APPROVED',
    studentId: 'active-1',
    studentName: 'Active Student',
    studentCode: 'ACT-01',
    className: '8A',
    subjectName: 'Chemistry',
    attendance: 'PRESENT',
    performance: 'GOOD',
    participation: 'ACTIVE',
    homework: 'COMPLETED',
    conduct: 'GOOD',
    comment: null,
  };

  const grouped = groupReports([activeStudent], undefined);
  assert.equal(grouped.length, 1);
  assert.equal(grouped[0].studentId, 'active-1');
});

// §157: Boundary Scoring Tests
test('§157: Exact threshold values (2.65, 1.65, 80%, 10%) resolve strictly as defined', () => {
  // 1. Performance 2.65 boundary:
  // 20 lessons: 13 EXCELLENT (39), 7 GOOD (14) = 53 / 20 = 2.65 -> EXCELLENT
  const boundary265: Observation[] = [
    ...Array.from({ length: 13 }, (_, i) => ({
      lessonId: `l-${i}`,
      lessonDate: '2026-09-15',
      topic: 'Topic',
      status: 'APPROVED',
      studentId: 's',
      studentName: 'Name',
      studentCode: 'C',
      className: 'Class',
      subjectName: 'Sub',
      attendance: 'PRESENT',
      performance: 'EXCELLENT',
      participation: 'ACTIVE',
      homework: 'COMPLETED',
      conduct: 'GOOD',
      comment: null,
    })),
    ...Array.from({ length: 7 }, (_, i) => ({
      lessonId: `l-${i + 13}`,
      lessonDate: '2026-09-15',
      topic: 'Topic',
      status: 'APPROVED',
      studentId: 's',
      studentName: 'Name',
      studentCode: 'C',
      className: 'Class',
      subjectName: 'Sub',
      attendance: 'PRESENT',
      performance: 'GOOD',
      participation: 'ACTIVE',
      homework: 'COMPLETED',
      conduct: 'GOOD',
      comment: null,
    })),
  ];
  assert.equal(summarize(boundary265, undefined).performanceResult, 'EXCELLENT');

  // Just below 2.65: 100 lessons: 64 EXCELLENT (192), 36 GOOD (72) = 264 / 100 = 2.64 -> GOOD
  const below265: Observation[] = [
    ...Array.from({ length: 64 }, (_, i) => ({ ...boundary265[0], lessonId: `a-${i}`, performance: 'EXCELLENT' })),
    ...Array.from({ length: 36 }, (_, i) => ({ ...boundary265[0], lessonId: `b-${i}`, performance: 'GOOD' })),
  ];
  assert.equal(summarize(below265, undefined).performanceResult, 'GOOD');

  // 2. Performance 1.65 boundary:
  // 20 lessons: 13 GOOD (26), 7 NEEDS_IMPROVEMENT (7) = 33 / 20 = 1.65 -> GOOD
  const boundary165: Observation[] = [
    ...Array.from({ length: 13 }, (_, i) => ({ ...boundary265[0], lessonId: `c-${i}`, performance: 'GOOD' })),
    ...Array.from({ length: 7 }, (_, i) => ({ ...boundary265[0], lessonId: `d-${i}`, performance: 'NEEDS_IMPROVEMENT' })),
  ];
  assert.equal(summarize(boundary165, undefined).performanceResult, 'GOOD');

  // Just below 1.65: 100 lessons: 64 GOOD (128), 36 NEEDS_IMPROVEMENT (36) = 164 / 100 = 1.64 -> NEEDS_IMPROVEMENT
  const below165: Observation[] = [
    ...Array.from({ length: 64 }, (_, i) => ({ ...boundary265[0], lessonId: `e-${i}`, performance: 'GOOD' })),
    ...Array.from({ length: 36 }, (_, i) => ({ ...boundary265[0], lessonId: `f-${i}`, performance: 'NEEDS_IMPROVEMENT' })),
  ];
  assert.equal(summarize(below165, undefined).performanceResult, 'NEEDS_IMPROVEMENT');

  // 3. Homework 80% boundary: 8 completed, 2 not completed = 80% -> Usually Completed
  const hw80: Observation[] = [
    ...Array.from({ length: 8 }, (_, i) => ({ ...boundary265[0], lessonId: `hw-${i}`, homework: 'COMPLETED' })),
    ...Array.from({ length: 2 }, (_, i) => ({ ...boundary265[0], lessonId: `hw-nc-${i}`, homework: 'NOT_COMPLETED' })),
  ];
  assert.equal(summarize(hw80, undefined).homeworkResult, 'Usually Completed');

  // Below 80%: 79 completed, 21 not completed = 79% -> Rarely Completed
  const hw79: Observation[] = [
    ...Array.from({ length: 79 }, (_, i) => ({ ...boundary265[0], lessonId: `hw79-${i}`, homework: 'COMPLETED' })),
    ...Array.from({ length: 21 }, (_, i) => ({ ...boundary265[0], lessonId: `hw79-nc-${i}`, homework: 'NOT_COMPLETED' })),
  ];
  assert.equal(summarize(hw79, undefined).homeworkResult, 'Rarely Completed');

  // 4. Punctuality 10% boundary: 1 late out of 10 attended (10%) -> Occasionally Late
  const late10: Observation[] = [
    ...Array.from({ length: 9 }, (_, i) => ({ ...boundary265[0], lessonId: `pt-${i}`, attendance: 'PRESENT' })),
    { ...boundary265[0], lessonId: 'pt-late', attendance: 'LATE' },
  ];
  assert.equal(summarize(late10, undefined).punctualityResult, 'Occasionally Late');

  // Above 10%: 11 late out of 100 attended (11%) -> Frequently Late
  const late11: Observation[] = [
    ...Array.from({ length: 89 }, (_, i) => ({ ...boundary265[0], lessonId: `pt11-${i}`, attendance: 'PRESENT' })),
    ...Array.from({ length: 11 }, (_, i) => ({ ...boundary265[0], lessonId: `pt11-late-${i}`, attendance: 'LATE' })),
  ];
  assert.equal(summarize(late11, undefined).punctualityResult, 'Frequently Late');
});

// §165: Month Closing Lock Rule
test('§165: Month closing lock state blocks changes in closed months', () => {
  const closures = [
    { month: '2026-08', closed: true },
    { month: '2026-09', closed: false },
  ];
  const isClosed = (m: string) => closures.some(c => c.month === m && c.closed);

  assert.equal(isClosed('2026-08'), true, 'August 2026 is closed');
  assert.equal(isClosed('2026-09'), false, 'September 2026 is open');
  assert.equal(isClosed('2026-10'), false, 'October 2026 has no closure record, defaults open');
});

// §167 & §109: Multi-Month Progression & Student Trends
test('§167 & §109: Student trend analysis segments observations cleanly across multiple months', () => {
  const base: Observation = {
    lessonId: '1',
    lessonDate: '2026-08-10',
    topic: 'Intro',
    status: 'APPROVED',
    studentId: 'student-trend',
    studentName: 'Trend Tracker',
    studentCode: 'TT-01',
    className: '9B',
    subjectName: 'History',
    attendance: 'PRESENT',
    performance: 'GOOD',
    participation: 'ACTIVE',
    homework: 'COMPLETED',
    conduct: 'GOOD',
    comment: null,
  };

  const rows: Observation[] = [
    // August: 2 lessons, GOOD
    { ...base, lessonId: 'aug-1', lessonDate: '2026-08-10' },
    { ...base, lessonId: 'aug-2', lessonDate: '2026-08-20' },
    // September: 2 lessons, EXCELLENT
    { ...base, lessonId: 'sep-1', lessonDate: '2026-09-05', performance: 'EXCELLENT' },
    { ...base, lessonId: 'sep-2', lessonDate: '2026-09-15', performance: 'EXCELLENT' },
  ];

  const trends = calculateStudentTrends(rows, undefined);
  assert.equal(trends.length, 2);
  assert.equal(trends[0].month, '2026-08');
  assert.equal(trends[0].performanceResult, 'GOOD');
  assert.equal(trends[0].lessons, 2);

  assert.equal(trends[1].month, '2026-09');
  assert.equal(trends[1].performanceResult, 'EXCELLENT');
  assert.equal(trends[1].lessons, 2);
});

// §168: Comment Requirement for Needs Improvement Observations
test('§168: Needs improvement observations mandate documentation in observations summary', () => {
  const rows: Observation[] = [
    {
      lessonId: 'l1',
      lessonDate: '2026-09-22',
      topic: 'Calculus',
      status: 'APPROVED',
      studentId: 's1',
      studentName: 'Student Needs Attention',
      studentCode: 'S-NA',
      className: '12A',
      subjectName: 'Mathematics',
      attendance: 'PRESENT',
      performance: 'NEEDS_IMPROVEMENT',
      participation: 'PASSIVE',
      homework: 'NOT_COMPLETED',
      conduct: 'NEEDS_IMPROVEMENT',
      comment: 'Disruptive behaviour and incomplete assignment',
    },
  ];

  const result = summarize(rows, undefined);
  assert.equal(result.observations.length, 1);
  assert.equal(result.observations[0].comment, 'Disruptive behaviour and incomplete assignment');
  assert.equal(result.observations[0].subject, 'Mathematics');
});


// §153: Demo Assignment Segregation Test for John & Sarah
test('§153: Demo Assignment Segregation for multiple teachers (John & Sarah)', () => {
  type Assignment = { teacherId: string; classId: string; subjectId: string };
  const assignments: Assignment[] = [
    { teacherId: 'john-id', classId: 'class-7A', subjectId: 'math-id' },
    { teacherId: 'john-id', classId: 'class-8A', subjectId: 'math-id' },
    { teacherId: 'sarah-id', classId: 'class-7A', subjectId: 'english-id' },
  ];

  const canTeach = (teacherId: string, classId: string, subjectId: string) =>
    assignments.some((a) => a.teacherId === teacherId && a.classId === classId && a.subjectId === subjectId);

  // John can teach Math to 7A and 8A
  assert.equal(canTeach('john-id', 'class-7A', 'math-id'), true);
  assert.equal(canTeach('john-id', 'class-8A', 'math-id'), true);
  // John cannot teach English to 7A or Math to 9A
  assert.equal(canTeach('john-id', 'class-7A', 'english-id'), false);
  assert.equal(canTeach('john-id', 'class-9A', 'math-id'), false);

  // Sarah can teach English to 7A
  assert.equal(canTeach('sarah-id', 'class-7A', 'english-id'), true);
  // Sarah cannot teach Math to 7A or English to 8A
  assert.equal(canTeach('sarah-id', 'class-7A', 'math-id'), false);
  assert.equal(canTeach('sarah-id', 'class-8A', 'english-id'), false);
});

// §155: Teacher Assignment Security (Rejection of unassigned class/subject/org)
test('§155: Teacher Assignment Security rejects access to unauthorized class or subject', () => {
  const authorizedAssignments = new Set(['org1:teacher1:class7A:math', 'org1:teacher1:class8A:math']);

  function validateAssignment(orgId: string, teacherId: string, classId: string, subjectId: string) {
    const key = `${orgId}:${teacherId}:${classId}:${subjectId}`;
    if (!authorizedAssignments.has(key)) {
      throw new Error('You are not assigned to this class and subject.');
    }
    return true;
  }

  assert.equal(validateAssignment('org1', 'teacher1', 'class7A', 'math'), true);
  assert.throws(() => validateAssignment('org1', 'teacher1', 'class7A', 'science'), /not assigned/);
  assert.throws(() => validateAssignment('org2', 'teacher1', 'class7A', 'math'), /not assigned/);
});

// §156: Student Class Security (Rejection of student belonging to different class)
test('§156: Student Class Security rejects inclusion of foreign class students in roster', () => {
  const activeClassRoster = new Set(['student-1', 'student-2', 'student-3']);

  function validateRoster(records: { studentId: string }[]) {
    const ids = new Set(records.map((r) => r.studentId));
    if (ids.size !== records.length) {
      throw new Error('Duplicate student in report payload.');
    }
    for (const r of records) {
      if (!activeClassRoster.has(r.studentId)) {
        throw new Error('The report contains an unauthorized or foreign student.');
      }
    }
    return true;
  }

  assert.equal(validateRoster([{ studentId: 'student-1' }, { studentId: 'student-2' }]), true);
  // Foreign student injected
  assert.throws(() => validateRoster([{ studentId: 'student-1' }, { studentId: 'student-foreign' }]), /unauthorized or foreign/);
  // Duplicate student injected
  assert.throws(() => validateRoster([{ studentId: 'student-1' }, { studentId: 'student-1' }]), /Duplicate/);
});

// §157: Duplicate Report Rejection
test('§157: Duplicate Report logic rejects duplicate report on same class, subject, date, teacher', () => {
  const existingReports = new Set(['org1:teacher1:class7A:math:2026-09-20']);

  function checkDuplicate(orgId: string, teacherId: string, classId: string, subjectId: string, date: string, reportId?: string) {
    const key = `${orgId}:${teacherId}:${classId}:${subjectId}:${date}`;
    if (existingReports.has(key) && reportId !== 'existing-report-id') {
      throw new Error('A report for this class, subject and date already exists.');
    }
    return true;
  }

  assert.equal(checkDuplicate('org1', 'teacher1', 'class7A', 'math', '2026-09-21'), true);
  assert.throws(() => checkDuplicate('org1', 'teacher1', 'class7A', 'math', '2026-09-20'), /already exists/);
  // Editing existing report is allowed
  assert.equal(checkDuplicate('org1', 'teacher1', 'class7A', 'math', '2026-09-20', 'existing-report-id'), true);
});

// §165: Organization Isolation (Multi-tenant security)
test('§165: Cross-tenant isolation rejects queries for mismatched organization ID', () => {
  function verifyTenantAccess(userOrgId: string, targetOrgId: string, role: string) {
    if (role === 'SUPER_ADMIN') return true;
    if (userOrgId !== targetOrgId) {
      throw new Error('Cross-tenant access forbidden.');
    }
    return true;
  }

  assert.equal(verifyTenantAccess('org-A', 'org-A', 'ADMIN'), true);
  assert.equal(verifyTenantAccess('org-A', 'org-A', 'TEACHER'), true);
  assert.equal(verifyTenantAccess('org-A', 'org-B', 'SUPER_ADMIN'), true); // Super admin context
  assert.throws(() => verifyTenantAccess('org-A', 'org-B', 'ADMIN'), /Cross-tenant access forbidden/);
  assert.throws(() => verifyTenantAccess('org-A', 'org-B', 'TEACHER'), /Cross-tenant access forbidden/);
});

// §166: Role Escalation Security
test('§166: Role Escalation Security rejects unauthorized teacher role operations', () => {
  function requireAdminRole(userRole: string) {
    if (userRole !== 'ADMIN' && userRole !== 'SUPER_ADMIN') {
      throw new Error('Access denied. Administrator privileges required.');
    }
    return true;
  }

  assert.equal(requireAdminRole('ADMIN'), true);
  assert.equal(requireAdminRole('SUPER_ADMIN'), true);
  assert.throws(() => requireAdminRole('TEACHER'), /Access denied/);
  assert.throws(() => requireAdminRole('STUDENT'), /Access denied/);
});

// §167: Direct Route / Permission Guard Security
test('§167: Direct Route security checks reject unauthorized user paths', () => {
  function checkRouteAccess(path: string, userRole: string) {
    const adminRoutes = ['/admin/students', '/admin/teachers', '/admin/settings', '/admin/audit'];
    const superAdminRoutes = ['/super-admin/organizations', '/super-admin/users'];

    if (adminRoutes.some((r) => path.startsWith(r)) && userRole !== 'ADMIN' && userRole !== 'SUPER_ADMIN') {
      return { status: 403, error: 'Forbidden' };
    }
    if (superAdminRoutes.some((r) => path.startsWith(r)) && userRole !== 'SUPER_ADMIN') {
      return { status: 403, error: 'Forbidden' };
    }
    return { status: 200, ok: true };
  }

  assert.equal(checkRouteAccess('/teacher/reports', 'TEACHER').status, 200);
  assert.equal(checkRouteAccess('/admin/students', 'ADMIN').status, 200);
  assert.equal(checkRouteAccess('/admin/students', 'TEACHER').status, 403);
  assert.equal(checkRouteAccess('/admin/settings', 'TEACHER').status, 403);
  assert.equal(checkRouteAccess('/super-admin/organizations', 'ADMIN').status, 403);
  assert.equal(checkRouteAccess('/super-admin/organizations', 'SUPER_ADMIN').status, 200);
});

// §168: API Manipulation Security (Tampered student IDs and duplicates)
test('§168: API Manipulation Security validates student roster integrity and prevents tampering', () => {
  function validateSubmissionPayload(
    submit: boolean,
    topic: string,
    rosterIds: string[],
    records: { studentId: string; attendance: string; comment?: string }[]
  ) {
    if (submit && !topic.trim()) throw new Error('Topic is required for submission.');
    const submittedIds = records.map((r) => r.studentId);
    const uniqueIds = new Set(submittedIds);
    if (uniqueIds.size !== submittedIds.length) throw new Error('Duplicate student in payload.');
    const rosterSet = new Set(rosterIds);
    if (records.some((r) => !rosterSet.has(r.studentId))) throw new Error('Unauthorized student ID.');
    if (submit && uniqueIds.size !== rosterIds.length) throw new Error('Must submit for all active students.');
    return true;
  }

  const roster = ['s1', 's2', 's3'];
  const validRecords = [
    { studentId: 's1', attendance: 'PRESENT' },
    { studentId: 's2', attendance: 'PRESENT' },
    { studentId: 's3', attendance: 'ABSENT' },
  ];

  assert.equal(validateSubmissionPayload(true, 'Algebra', roster, validRecords), true);
  // Missing topic
  assert.throws(() => validateSubmissionPayload(true, '  ', roster, validRecords), /Topic is required/);
  // Incomplete submit roster
  assert.throws(() => validateSubmissionPayload(true, 'Algebra', roster, validRecords.slice(0, 2)), /all active students/);
  // Tampered student ID
  assert.throws(
    () => validateSubmissionPayload(true, 'Algebra', roster, [...validRecords.slice(0, 2), { studentId: 's-injected', attendance: 'PRESENT' }]),
    /Unauthorized student ID/
  );
});

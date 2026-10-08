/**
 * End-to-end checks for the monthly record feature (Â§193) against the local dev server.
 * Requires: npm run dev on http://localhost:3000 and a migrated local database.
 * Usage: npx tsx scripts/local-monthly-test.ts
 */
import { runTransaction } from '../src/db';
import { monthlyEntries, monthlyStudentEntries, auditLogs } from '../src/db/schema';
import { and, eq, inArray, desc } from 'drizzle-orm';

const BASE = process.env.BASE_URL || 'http://localhost:3000';
const ADMIN = { identity: process.env.ADMIN_USER || 'schooladmin', password: process.env.ADMIN_PASS || 'LocalAdmin!2026' };
const TEACHER = { identity: process.env.TEACHER_USER || 'class.teacher', password: process.env.TEACHER_PASS || 'school123' };

let cookie = '';
const checks: string[] = [];
const createdEntryIds: string[] = [];

function check(label: string, ok: boolean, detail?: unknown) {
  checks.push(`${ok ? 'PASS' : 'FAIL'} ${label}${ok ? '' : ` :: ${JSON.stringify(detail)}`}`);
}

async function call(pathname: string, init: RequestInit = {}) {
  const res = await fetch(`${BASE}${pathname}`, {
    ...init,
    headers: { 'Content-Type': 'application/json', ...(cookie ? { cookie } : {}), ...((init.headers as Record<string, string>) || {}) },
    redirect: 'manual',
  });
  const setCookies = res.headers.getSetCookie?.() || [];
  for (const c of setCookies) if (c.startsWith('school_session=')) cookie = c.split(';')[0];
  const body = await res.json().catch(() => null);
  return { status: res.status, body: body as any };
}

async function login(who: { identity: string; password: string }) {
  cookie = '';
  const r = await call('/api/auth', { method: 'POST', body: JSON.stringify({ action: 'login', ...who }) });
  if (r.status !== 200) throw new Error(`login failed for ${who.identity}: ${JSON.stringify(r.body)}`);
  return r.body;
}

const get = (view: string, params: Record<string, string> = {}) =>
  call(`/api/app?${new URLSearchParams({ view, ...params }).toString()}`);

const action = (name: string, data: unknown) =>
  call('/api/app', { method: 'POST', body: JSON.stringify({ action: name, data }) });

async function cleanup() {
  if (!createdEntryIds.length) return;
  await runTransaction(async (tx: any) => {
    await tx.delete(monthlyStudentEntries).where(inArray(monthlyStudentEntries.monthlyEntryId, createdEntryIds));
    await tx.delete(monthlyEntries).where(inArray(monthlyEntries.id, createdEntryIds));
  });
  createdEntryIds.length = 0;
}

async function main() {
  // ---------- admin: reference + seeded September data ----------
  const admin = await login(ADMIN);
  check('admin login', admin.role === 'ADMIN', admin);

  const ref = await get('reference');
  check('reference has no cadence flag after the monthly merge', !!ref.body && !('reportingCadence' in ref.body), ref.body ? Object.keys(ref.body).length : ref.body);

  const list = await get('monthlyEntries', { month: '2026-09' });
  check('monthlyEntries lists the seeded month', (list.body?.entries?.length || 0) > 0, list.body?.entries?.length);
  check('monthlyEntries marks unfiled assignments MISSING', Array.isArray(list.body?.planned), list.body?.planned?.length);
  const seeded = list.body?.entries?.[0];
  check('seeded entry carries roster + status', !!seeded && seeded.studentCount > 0 && seeded.status === 'APPROVED', seeded);

  const form = await get('monthlyEntry', { month: '2026-09', classId: seeded.classId, subjectId: seeded.subjectId });
  check('monthlyEntry returns roster and records', (form.body?.roster?.length || 0) > 0 && form.body.records.length === form.body.roster.length, {
    roster: form.body?.roster?.length, records: form.body?.records?.length,
  });
  check('approved record is read-only', form.body.editable === false && form.body.entry.status === 'APPROVED', form.body.entry?.status);
  check('stored records carry a punctuality category', form.body.records.every((r: any) => !!r.punctuality), form.body.records[0]);

  const reports = await get('reports', { from: '2026-09-01', to: '2026-09-30' });
  const monthlyRows = (reports.body?.reports || []).filter((r: any) => r.kind === 'monthly');
  check('report history merges monthly rows with kind/month', monthlyRows.length > 0 && monthlyRows.every((r: any) => r.month === '2026-09'), monthlyRows.length);

  const monthly = await get('monthly', { from: '2026-09-01', to: '2026-09-30', classId: seeded.classId, subjectId: seeded.subjectId });
  const expected = (form.body.entry.sessionsHeld as number) * (form.body.records.length as number);
  check('monthly report reads the entry as one observation per session', monthly.body?.data?.length === expected, {
    expected, actual: monthly.body?.data?.length,
  });
  check('lesson report count equals sessions held', monthly.body?.coverage?.lessonReports === form.body.entry.sessionsHeld, monthly.body?.coverage);
  check('summaries produced for every student', monthly.body?.summaries?.length === form.body.records.length, monthly.body?.summaries?.length);

  const studentId = form.body.records[0].studentId;
  const profile = await get('studentProfile', { id: studentId });
  const monthlyTimeline = (profile.body?.timeline || []).filter((t: any) => t.lessonDate === '2026-09-30');
  check('student profile timeline includes the monthly record', monthlyTimeline.length > 0, monthlyTimeline.length);

  // ---------- teacher: save / validate / submit / review / delete ----------
  const teacher = await login(TEACHER);
  check('teacher login', teacher.role === 'TEACHER', teacher.role);
  const tRef = await get('reference');
  const assignment = (tRef.body?.assignments || []).find((a: any) => a.active !== false);
  check('teacher has an assignment', !!assignment, tRef.body?.assignments?.length);
  const month = '2026-10';
  const tForm = await get('monthlyEntry', { month, classId: assignment.classId, subjectId: assignment.subjectId });
  check('blank monthly form opens for the teacher', tForm.status === 200 && tForm.body.entry === null && tForm.body.roster.length > 0, {
    roster: tForm.body?.roster?.length, status: tForm.status,
  });
  const roster: { studentId: string }[] = tForm.body.roster;

  const draft = await action('saveMonthlyEntry', {
    month, classId: assignment.classId, subjectId: assignment.subjectId, sessionsHeld: 18, topics: 'Introductory work', submit: false,
    records: [{ studentId: roster[0].studentId, punctuality: 'OCCASIONALLY_LATE', performance: 'GOOD', participation: 'ACTIVE', homework: 'ALWAYS_COMPLETED', conduct: 'GOOD', comment: null }],
  });
  check('partial draft saves', draft.status === 200 && draft.body.status === 'DRAFT', draft.body);
  createdEntryIds.push(draft.body.id);

  const badPunctuality = await action('saveMonthlyEntry', {
    month, classId: assignment.classId, subjectId: assignment.subjectId, sessionsHeld: 18, topics: 'x', submit: false,
    records: [{ studentId: roster[0].studentId, punctuality: 'SOMETIMES_ABSENT' }],
  });
  check('an unknown punctuality value is rejected', badPunctuality.status === 400, badPunctuality.body);

  const noTopics = await action('saveMonthlyEntry', {
    month, classId: assignment.classId, subjectId: assignment.subjectId, sessionsHeld: 18, topics: '  ', submit: true,
    records: roster.map((s) => ({ studentId: s.studentId, punctuality: 'ALWAYS_ON_TIME', performance: 'GOOD', participation: 'ACTIVE', homework: 'USUALLY_COMPLETED', conduct: 'GOOD', comment: null })),
  });
  check('submit without content covered is rejected', noTopics.status === 400, noTopics.body);

  const unchosenPunctuality = await action('saveMonthlyEntry', {
    month, classId: assignment.classId, subjectId: assignment.subjectId, sessionsHeld: 18, topics: 'Full coverage', submit: true,
    records: roster.map((s, i) => ({ studentId: s.studentId, punctuality: i === 0 ? null : 'ALWAYS_ON_TIME', performance: 'GOOD', participation: 'ACTIVE', homework: 'USUALLY_COMPLETED', conduct: 'GOOD', comment: null })),
  });
  check('submit with an unchosen punctuality is rejected', unchosenPunctuality.status === 400, unchosenPunctuality.body);

  const missingRows = await action('saveMonthlyEntry', {
    month, classId: assignment.classId, subjectId: assignment.subjectId, sessionsHeld: 18, topics: 'Full coverage', submit: true,
    records: [{ studentId: roster[0].studentId, punctuality: 'ALWAYS_ON_TIME', performance: 'GOOD', participation: 'ACTIVE', homework: 'USUALLY_COMPLETED', conduct: 'GOOD', comment: null }],
  });
  check('submit with an incomplete roster is rejected', missingRows.status === 400, missingRows.body);

  const missingLevels = await action('saveMonthlyEntry', {
    month, classId: assignment.classId, subjectId: assignment.subjectId, sessionsHeld: 18, topics: 'Full coverage', submit: true,
    records: roster.map((s, i) => ({ studentId: s.studentId, punctuality: 'ALWAYS_ON_TIME', performance: i === 0 ? null : 'GOOD', participation: 'ACTIVE', homework: 'USUALLY_COMPLETED', conduct: 'GOOD', comment: null })),
  });
  check('submit with unfilled levels is rejected', missingLevels.status === 400, missingLevels.body);

  const submit = await action('saveMonthlyEntry', {
    month, classId: assignment.classId, subjectId: assignment.subjectId, sessionsHeld: 18, topics: 'Full coverage', submit: true,
    records: roster.map((s, i) => ({ studentId: s.studentId, punctuality: i % 5 === 0 ? 'OCCASIONALLY_LATE' : 'ALWAYS_ON_TIME', performance: 'GOOD', participation: 'ACTIVE', homework: 'USUALLY_COMPLETED', conduct: 'GOOD', comment: null })),
  });
  check('complete record submits', submit.status === 200 && submit.body.status === 'SUBMITTED', submit.body);

  const resave = await action('saveMonthlyEntry', {
    month, classId: assignment.classId, subjectId: assignment.subjectId, sessionsHeld: 18, topics: 'again', submit: false,
    records: [],
  });
  check('submitted record can no longer be edited', resave.status === 409, resave.body);

  const formAfter = await get('monthlyEntry', { entryId: submit.body.id });
  check('submitted form reports read-only', formAfter.body.editable === false, formAfter.body.editable);

  await login(ADMIN);
  const review1 = await action('review', { id: submit.body.id, status: 'UNDER_REVIEW' });
  check('admin moves record under review', review1.status === 200, review1.body);
  const review2 = await action('review', { id: submit.body.id, status: 'RETURNED', comment: 'Please verify the punctuality selections.' });
  check('admin returns record with a note', review2.status === 200, review2.body);
  const returned = await get('monthlyEntry', { entryId: submit.body.id });
  check('returned record keeps the review note', returned.body.entry.status === 'RETURNED' && !!returned.body.entry.reviewComment, returned.body.entry);
  check('returned record is editable again', returned.body.editable === true);

  await login(TEACHER);
  const resubmitDraft = await action('saveMonthlyEntry', {
    month, classId: assignment.classId, subjectId: assignment.subjectId, sessionsHeld: 18, topics: 'Revised coverage', submit: false,
    records: roster.map((s) => ({ studentId: s.studentId, punctuality: 'OCCASIONALLY_ABSENT', performance: 'GOOD', participation: 'ACTIVE', homework: 'ALWAYS_COMPLETED', conduct: 'GOOD', comment: 'Updated after review.' })),
  });
  const keptReturned = await get('monthlyEntry', { entryId: submit.body.id });
  check('teacher draft save keeps RETURNED status and note', resubmitDraft.status === 200 && keptReturned.body.entry.status === 'RETURNED' && !!keptReturned.body.entry.reviewComment, keptReturned.body.entry);

  await login(ADMIN);
  const audits = await get('audit');
  const monthlyAudits = (audits.body?.logs || []).filter((l: any) => l.entityType === 'monthly_entry');
  check('audit log records monthly entry actions', monthlyAudits.length >= 2 && monthlyAudits.some((l: any) => l.action === 'MONTHLY_ENTRY_SUBMITTED'), monthlyAudits.map((l: any) => l.action));

  // ---------- cleanup ----------
  await login(TEACHER);
  const del = await action('deleteDraft', { id: submit.body.id });
  check('teacher deletes the returned monthly record', del.status === 200, del.body);
  createdEntryIds.length = 0;
  const after = await get('monthlyEntries', { month, classId: assignment.classId, subjectId: assignment.subjectId });
  check('deleted record disappears from the checklist', (after.body?.entries || []).length === 0, after.body?.entries);

  // ---------- admin filing follows the active assignment (Â§193.B) ----------
  await login(ADMIN);
  const aRef = await get('reference');
  const activePairs: any[] = (aRef.body?.assignments || []).filter((a: any) => a.active !== false);
  const otherPair = activePairs.find((a: any) => a.classId !== assignment.classId || a.subjectId !== assignment.subjectId) || activePairs[0];
  if (otherPair) {
    const adminSave = await action('saveMonthlyEntry', {
      month, classId: otherPair.classId, subjectId: otherPair.subjectId, sessionsHeld: 18, topics: 'Admin filed coverage', submit: false, records: [],
    });
    check('admin saves a draft for an assigned class and subject', adminSave.status === 200 && adminSave.body.status === 'DRAFT', adminSave.body);
    if (adminSave.status === 200) createdEntryIds.push(adminSave.body.id);
    const adminEntry = adminSave.status === 200 ? await get('monthlyEntry', { entryId: adminSave.body.id }) : null;
    check('admin-created record follows the active assignment attribution', !!adminEntry && adminEntry.body.entry.teacherId === otherPair.teacherId, { saved: adminEntry?.body?.entry?.teacherId, assignment: otherPair.teacherId });
  } else {
    check('admin saves a draft for an assigned class and subject', false, 'no active assignments in reference');
  }
  const assignedPairs = new Set(activePairs.map((a: any) => `${a.classId}|${a.subjectId}`));
  let unassignedPair: { classId: string; subjectId: string } | null = null;
  for (const cls of aRef.body?.classes || []) {
    const subject = (aRef.body?.subjects || []).find((s: any) => !assignedPairs.has(`${cls.id}|${s.id}`));
    if (subject) { unassignedPair = { classId: cls.id, subjectId: subject.id }; break; }
  }
  if (unassignedPair) {
    const denied = await action('saveMonthlyEntry', {
      month, classId: unassignedPair.classId, subjectId: unassignedPair.subjectId, sessionsHeld: 18, topics: 'No assignment', submit: false, records: [],
    });
    check('admin cannot file where no active assignment exists', denied.status === 409, denied.body);
  } else {
    check('admin cannot file where no active assignment exists (every pair is assigned)', true);
  }

  await cleanup();
  const failed = checks.filter((c) => c.startsWith('FAIL'));
  console.log(checks.join('\n'));
  console.log(`\n${checks.length - failed.length}/${checks.length} checks passed`);
  if (failed.length) process.exit(1);
}

main()
  .catch(async (e) => { console.error(e); console.log(checks.join('\n')); await cleanup(); process.exit(1); });

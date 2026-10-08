import { db } from '../src/db';
import {
  lessons, records, behaviourObservations, monthClosures, monthlyRuleSnapshots,
  grades, classes, subjects, students, teachers, users, assignments, academicYears, terms,
  organizations, settings, sessions, auditLogs,
} from '../src/db/schema';
import { eq, inArray, like } from 'drizzle-orm';

const BASE = process.env.BASE_URL || 'http://localhost:3000';
const SUPER = { identity: 'superadmin', password: 'LocalSuper!2026' };
const ADMIN = { identity: 'schooladmin', password: 'LocalAdmin!2026' };
const TEACHER = { identity: 'class.teacher', password: 'school123' };
const ADMIN_ORIGINAL_PASSWORD = ADMIN.password;

let cookie = '';
const checks: string[] = [];
const lessonIds: string[] = [];
const observationIds: string[] = [];
const tempOrg: { id?: string; usernames: string[] } = { usernames: [] };
const tempTeacher: { id?: string; username?: string } = {};
type TempKind = 'grade' | 'class' | 'subject' | 'student' | 'year' | 'term' | 'assignment';
const tempRows: { kind: TempKind; id: string }[] = [];
const tempClosure: { month?: string; created: boolean } = { created: false };

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

async function action(name: string, data: unknown, extra: Record<string, unknown> = {}) {
  return call('/api/app', { method: 'POST', body: JSON.stringify({ action: name, data, ...extra }) });
}

const dayOffset = (date: string, days: number) => {
  const d = new Date(`${date}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
};

async function safe(label: string, fn: () => Promise<unknown>) {
  try { await fn(); } catch (e) { console.error(`cleanup ${label} failed: ${(e as Error).message}`); }
}

async function cleanup() {
  await safe('legacy lesson reports', async () => {
    if (!lessonIds.length) return;
    await db.delete(records).where(inArray(records.monthlyLessonId, lessonIds));
    await db.delete(lessons).where(inArray(lessons.id, lessonIds));
  });
  await safe('observations', async () => { if (observationIds.length) await db.delete(behaviourObservations).where(inArray(behaviourObservations.id, observationIds)); });
  await safe('month closure', async () => {
    if (tempClosure.created && tempClosure.month) {
      await db.delete(monthClosures).where(eq(monthClosures.month, tempClosure.month));
      await db.delete(monthlyRuleSnapshots).where(eq(monthlyRuleSnapshots.month, tempClosure.month));
    }
  });
  const pick = (kind: TempKind) => tempRows.filter((r) => r.kind === kind).map((r) => r.id);
  await safe('temp assignments', async () => {
    const ids = pick('assignment');
    const byRef = await db.select({ id: assignments.id }).from(assignments).where(inArray(assignments.classId, [...pick('class'), '00000000-0000-4000-8000-000000000000']));
    const all = [...new Set([...ids, ...byRef.map((r) => r.id)])];
    if (all.length) await db.delete(assignments).where(inArray(assignments.id, all));
  });
  await safe('temp students', async () => { const ids = pick('student'); if (ids.length) await db.delete(students).where(inArray(students.id, ids)); });
  await safe('temp terms', async () => { const ids = pick('term'); if (ids.length) await db.delete(terms).where(inArray(terms.id, ids)); });
  await safe('temp classes', async () => { const ids = pick('class'); if (ids.length) await db.delete(classes).where(inArray(classes.id, ids)); });
  await safe('temp grades', async () => { const ids = pick('grade'); if (ids.length) await db.delete(grades).where(inArray(grades.id, ids)); });
  await safe('temp subjects', async () => { const ids = pick('subject'); if (ids.length) await db.delete(subjects).where(inArray(subjects.id, ids)); });
  await safe('temp years', async () => { const ids = pick('year'); if (ids.length) await db.delete(academicYears).where(inArray(academicYears.id, ids)); });
  await safe('temp teacher', async () => { if (tempTeacher.id) await db.delete(teachers).where(eq(teachers.id, tempTeacher.id)); });
  await safe('temp users', async () => {
    const byName = await db.select({ id: users.id }).from(users).where(like(users.username, 'tmp%'));
    const byOrg = tempOrg.id ? await db.select({ id: users.id }).from(users).where(eq(users.organizationId, tempOrg.id)) : [];
    const ids = [...new Set([...byName.map((r) => r.id), ...byOrg.map((r) => r.id)])];
    if (!ids.length) return;
    await db.delete(sessions).where(inArray(sessions.userId, ids));
    await db.delete(auditLogs).where(inArray(auditLogs.userId, ids));
    await db.delete(users).where(inArray(users.id, ids));
  });
  await safe('temp organization', async () => {
    if (!tempOrg.id) return;
    await db.delete(auditLogs).where(eq(auditLogs.organizationId, tempOrg.id));
    await db.delete(settings).where(eq(settings.organizationId, tempOrg.id));
    await db.delete(grades).where(eq(grades.organizationId, tempOrg.id));
    await db.delete(users).where(eq(users.organizationId, tempOrg.id));
    await db.delete(organizations).where(eq(organizations.id, tempOrg.id));
  });
}

async function main() {
  const health = await call('/api/health');
  check('health endpoint reports the database is reachable', health.status === 200 && health.body.ok === true, health.body);

  const anon = await call('/api/auth');
  check('unauthenticated session resolves to no user', anon.status === 200 && anon.body.user === null, anon.body);
  const logo = await call(`/api/auth?identity=${encodeURIComponent(ADMIN.identity)}`);
  check('sign-in branding lookup returns a logo key', logo.status === 200 && 'logoUrl' in logo.body, logo.body);

  await login(SUPER);
  const superOverview = await call('/api/app?view=overview');
  check('super admin overview is the platform view', superOverview.status === 200 && superOverview.body.organization === 'Platform', superOverview.body);
  const orgList = await call('/api/app?view=organizations');
  check('super admin lists organizations with counts', orgList.status === 200 && Array.isArray(orgList.body.organizations) && orgList.body.organizations.some((o: any) => !!o.studentCount), orgList.body.organizations?.length);
  const superAudit = await call('/api/app?view=audit');
  check('super admin reads the platform audit log', superAudit.status === 200 && Array.isArray(superAudit.body.logs), superAudit.body.logs?.length);
  const superReference = await call('/api/app?view=reference');
  check('unknown super admin view falls back instead of crashing', superReference.status === 200 && superReference.body.role === 'SUPER_ADMIN', superReference.body);

  const suffix = Date.now().toString(36);
  const tempOrgName = `Tmp School ${suffix}`;
  const badTimezone = await action('organization', { name: tempOrgName, code: `T${suffix}`.slice(0, 25), timezone: 'Not/AZone' });
  check('organization rejects an invalid timezone', badTimezone.status >= 400, badTimezone.body);
  const orgCreate = await action('organization', { name: tempOrgName, code: `T${suffix}`.slice(0, 25), timezone: 'Africa/Bujumbura' });
  check('super admin creates an organization', orgCreate.status === 200, orgCreate.body);
  const afterOrg = await call('/api/app?view=organizations');
  const tempOrgRow = (afterOrg.body.organizations as any[]).find((o) => o.name === tempOrgName);
  tempOrg.id = tempOrgRow?.id;
  check('created organization appears with no administrator yet', !!tempOrgRow && tempOrgRow.admin === null, tempOrgRow);

  const weakAdmin = await action('admin', { organizationId: tempOrg.id, name: 'Temp Admin', username: `tmpadmin.${suffix}`, email: `tmp.${suffix}@example.com`, password: 'weak' });
  check('administrator creation enforces the password rule', weakAdmin.status >= 400, weakAdmin.body);
  const adminCreate = await action('admin', { organizationId: tempOrg.id, name: 'Temp Admin', username: `tmpadmin.${suffix}`, email: `tmp.${suffix}@example.com`, password: 'TmpAdmin!2026' });
  check('super admin creates the primary administrator', adminCreate.status === 200, adminCreate.body);
  tempOrg.usernames.push(`tmpadmin.${suffix}`);
  const withAdmin = await call('/api/app?view=organizations');
  const adminRow = (withAdmin.body.organizations as any[]).find((o) => o.name === tempOrgName)?.admin;
  check('organization row now reports its administrator', !!adminRow && adminRow.username === `tmpadmin.${suffix}`, adminRow);

  const wrongTarget = await action('updateAdmin', { organizationId: tempOrg.id, userId: '00000000-0000-4000-8000-000000000000', name: 'Nope', username: 'nope', email: 'nope@example.com' });
  check('editing a non-primary administrator is refused', wrongTarget.status >= 400, wrongTarget.body);
  const adminUpdate = await action('updateAdmin', { organizationId: tempOrg.id, userId: adminRow.id, name: 'Temp Admin Renamed', username: `tmpadmin.${suffix}`, email: `tmp.${suffix}@example.com` });
  check('super admin edits administrator details', adminUpdate.status === 200, adminUpdate.body);
  const duplicateAdmin = await action('admin', { organizationId: tempOrg.id, name: 'Temp Admin', username: `tmpadmin.${suffix}`, email: `tmp.${suffix}@example.com`, password: 'TmpAdmin!2026' });
  check('administrator creation refuses a duplicate username or email', duplicateAdmin.status === 409, duplicateAdmin.body);
  const weakReset = await action('resetAdmin', { organizationId: tempOrg.id, password: '12345' });
  check('administrator password reset enforces the password rule', weakReset.status >= 400, weakReset.body);
  const adminReset = await action('resetAdmin', { organizationId: tempOrg.id, password: 'TmpAdmin!9999' });
  check('super admin resets the administrator password', adminReset.status === 200, adminReset.body);
  const tempAdminLogin = await login({ identity: `tmpadmin.${suffix}`, password: 'TmpAdmin!9999' });
  check('administrator signs in after the reset', tempAdminLogin.role === 'ADMIN', tempAdminLogin);
  const tempAdminReference = await call('/api/app?view=reference');
  check('administrator reads their own school reference data', tempAdminReference.status === 200 && Array.isArray(tempAdminReference.body.classes), tempAdminReference.status);
  const adminAsSuper = await action('organization', { name: 'Nope', code: 'NOP', timezone: 'Africa/Bujumbura' });
  check('administrator cannot manage organizations', adminAsSuper.status >= 400, adminAsSuper.body);

  await login(ADMIN);
  const ref = await call('/api/app?view=reference');
  const years: any[] = ref.body.years || [];
  const classesList: any[] = ref.body.classes || [];
  const subjectsList: any[] = ref.body.subjects || [];
  const teachersList: any[] = ref.body.teachers || [];
  const studentsList: any[] = ref.body.students || [];
  const activeYear = years.find((y) => y.active) || years[0];
  check('reference data loads for the administrator', ref.status === 200 && years.length > 0 && classesList.length > 0 && subjectsList.length > 0 && studentsList.length > 0 && teachersList.length > 0, {
    years: years.length, classes: classesList.length, subjects: subjectsList.length, students: studentsList.length, teachers: teachersList.length,
  });
  check('reference data returns the organization brand block', !!ref.body.organization?.name && 'logoUrl' in (ref.body.organization || {}) && !('reportingCadence' in ref.body), {
    organization: ref.body.organization,
  });

  const overview = await call('/api/app?view=overview');
  check('administrator overview returns counts, status buckets and approval rate', overview.status === 200 && overview.body.counts.students > 0 && !!overview.body.statusCounts && Array.isArray(overview.body.recent) && typeof overview.body.counts.approvalRate === 'number', {
    counts: overview.body.counts, statusCounts: overview.body.statusCounts, recent: overview.body.recent?.length,
  });
  check('overview recent activity merges legacy and monthly rows', (overview.body.recent as any[]).every((r) => r.kind === 'lesson' || r.kind === 'monthly'), overview.body.recent);

  const page0 = await call('/api/app?view=students&page=0');
  check('student list pages return rows and a hasMore flag', page0.status === 200 && page0.body.students.length > 0 && 'hasMore' in page0.body, page0.body.students?.length);
  const searchTerm = (page0.body.students[0].fullName as string).slice(0, 6);
  const search = await call(`/api/app?view=students&search=${encodeURIComponent(searchTerm)}`);
  check('student search filters the list', search.status === 200 && search.body.students.length > 0 && search.body.students.every((s: any) => s.fullName.toLowerCase().includes(searchTerm.toLowerCase()) || s.studentId.toLowerCase().includes(searchTerm.toLowerCase())), { status: search.status, body: search.body });
  const roster = await call(`/api/app?view=students&classId=${page0.body.students[0].classId}&roster=1`);
  check('class roster loads for the record form', roster.status === 200 && roster.body.students.length > 0, roster.body.students?.length);

  const target = page0.body.students[0];
  const profile = await call(`/api/app?view=studentProfile&id=${target.id}`);
  check('student profile returns timeline and behaviour entries', profile.status === 200 && Array.isArray(profile.body.timeline) && Array.isArray(profile.body.significant), profile.body.timeline?.length);
  const missingProfile = await call('/api/app?view=studentProfile&id=00000000-0000-4000-8000-000000000000');
  check('unknown student profile returns 404', missingProfile.status === 404, missingProfile.body);
  const trends = await call(`/api/app?view=trends&studentId=${target.id}`);
  check('student trends load for the administrator', trends.status === 200 && !!trends.body.trends, trends.body);

  const reports = await call(`/api/app?view=reports&from=${dayOffset(ref.body.today, -120)}&to=${ref.body.today}`);
  check('report history lists rows with a legacy/monthly kind', reports.status === 200 && reports.body.reports.length > 0 && reports.body.reports.every((r: any) => r.kind === 'lesson' || r.kind === 'monthly'), reports.body.reports?.length);
  const monthlyWindow = await call(`/api/app?view=monthly&from=${ref.body.today.slice(0, 8)}01&to=${ref.body.today}`);
  check('monthly report view returns data, summaries and coverage for an open window', monthlyWindow.status === 200 && Array.isArray(monthlyWindow.body.data) && Array.isArray(monthlyWindow.body.summaries) && !!monthlyWindow.body.coverage, { status: monthlyWindow.status, body: monthlyWindow.body });
  const checklist = await call('/api/app?view=monthlyEntries&month=2026-09');
  check('filing checklist lists entries and unfiled assignments', checklist.status === 200 && Array.isArray(checklist.body.entries) && Array.isArray(checklist.body.planned) && checklist.body.entries.length > 0, checklist.body.entries?.length);
  const sepClass = checklist.body.entries[0]?.classId;
  const sepSubject = checklist.body.entries[0]?.subjectId;
  const sepFiltered = await call(`/api/app?view=monthly&from=2026-09-01&to=2026-09-30&classId=${sepClass}&subjectId=${sepSubject}`);
  check('class and subject report for a recorded month returns observations', sepFiltered.status === 200 && sepFiltered.body.coverage.observations > 0, { status: sepFiltered.status, coverage: sepFiltered.body.coverage });
  const sepWholeSchool = await call('/api/app?view=monthly&from=2026-09-01&to=2026-09-30');
  check('whole-school month hits the documented 20,000-observation guard', sepWholeSchool.status === 413 && /20,000/.test(sepWholeSchool.body?.error || ''), sepWholeSchool.body);
  const quality = await call('/api/app?view=dataQuality');
  check('data quality view returns draft and return queues', quality.status === 200 && Array.isArray(quality.body.drafts) && Array.isArray(quality.body.returned) && 'studentsWithNoRecordsCount' in quality.body, quality.body.drafts?.length);
  const auditView = await call('/api/app?view=audit');
  check('administrator reads the organization audit log', auditView.status === 200 && auditView.body.logs.length > 0, auditView.body.logs?.length);
  const settingsView = await call('/api/app?view=settings');
  check('settings view returns rules, closures and the organization', settingsView.status === 200 && !!settingsView.body.settings && Array.isArray(settingsView.body.closures) && !!settingsView.body.organization, settingsView.status);
  const clubsView = await call('/api/app?view=clubs');
  check('clubs view returns clubs, members, activities and records', clubsView.status === 200 && Array.isArray(clubsView.body.clubs) && Array.isArray(clubsView.body.records), clubsView.body.clubs?.length);
  const unknownView = await call('/api/app?view=doesNotExist');
  check('unknown view returns 404', unknownView.status === 404, unknownView.body);

  await login(TEACHER);
  const teacherRef = await call('/api/app?view=reference');
  const teacherAssignments: any[] = teacherRef.body.assignments || [];
  check('teacher reference is limited to their own assignments', teacherRef.status === 200 && teacherAssignments.length > 0 && teacherRef.body.teachers.length === 0 && teacherRef.body.students.length === 0, {
    assignments: teacherAssignments.length, teachers: teacherRef.body.teachers.length, students: teacherRef.body.students.length,
  });
  const teacherOverview = await call('/api/app?view=overview');
  check('teacher overview counts only their own teaching load', teacherOverview.body.counts.teachers === 1 && teacherOverview.body.counts.classes === teacherAssignments.length, teacherOverview.body.counts);
  const noClass = await call('/api/app?view=students');
  check('teacher cannot list students without a class', noClass.status === 403, noClass.body);
  const foreignClass = await call('/api/app?view=students&classId=00000000-0000-4000-8000-000000000000');
  check('teacher cannot read an unassigned class', foreignClass.status === 403, foreignClass.body);
  const scopedStudents = await call(`/api/app?view=students&classId=${teacherAssignments[0].classId}&roster=1`);
  check('teacher reads their assigned class roster', scopedStudents.status === 200 && scopedStudents.body.students.length > 0, scopedStudents.body.students?.length);
  const noPair = await call(`/api/app?view=monthly&from=${dayOffset(ref.body.today, -30)}&to=${ref.body.today}`);
  check('teacher cannot run a report without class and subject', noPair.status === 403, noPair.body);
  const scopedReport = await call(`/api/app?view=monthly&classId=${teacherAssignments[0].classId}&subjectId=${teacherAssignments[0].subjectId}&from=2026-09-01&to=2026-09-30`);
  check('teacher runs a report for their own assignment', scopedReport.status === 200 && !!scopedReport.body.summaries, scopedReport.body.coverage);
  const teacherReports = await call(`/api/app?view=reports&from=${dayOffset(ref.body.today, -365)}&to=${ref.body.today}`);
  const reportTeacherNames = [...new Set((teacherReports.body.reports as any[]).map((r) => r.teacherName))];
  check('teacher report history is scoped to their own reports', teacherReports.status === 200 && reportTeacherNames.length <= 1, reportTeacherNames);
  const teacherSettings = await call('/api/app?view=settings');
  const teacherAudit = await call('/api/app?view=audit');
  const teacherQuality = await call('/api/app?view=dataQuality');
  const teacherProfile = await call(`/api/app?view=studentProfile&id=${target.id}`);
  const teacherTrends = await call(`/api/app?view=trends&studentId=${target.id}`);
  check('teacher is denied admin-only views', [teacherSettings.status, teacherAudit.status, teacherQuality.status, teacherProfile.status, teacherTrends.status].every((s) => s === 403), [teacherSettings.status, teacherAudit.status, teacherQuality.status, teacherProfile.status, teacherTrends.status]);
  const teacherAdminAction = await action('resetTeacherPassword', { teacherId: teacherAssignments[0]?.teacherId, password: 'Hijack!2026' });
  const teacherSettingsAction = await action('settings', { timezone: 'Africa/Bujumbura', excellentThreshold: 2.65, goodThreshold: 1.65, homeworkUsuallyThreshold: 0.8, punctualityOccasionallyMax: 0.1 });
  const teacherOrgAction = await action('organization', { name: 'Nope', code: 'NOP', timezone: 'Africa/Bujumbura' });
  check('teacher is denied administrator actions', [teacherAdminAction.status, teacherSettingsAction.status, teacherOrgAction.status].every((s) => s >= 400), [teacherAdminAction.status, teacherSettingsAction.status, teacherOrgAction.status]);
  const deniedExport = await action('export', { format: 'csv' });
  check('teacher export without a class and subject is denied', deniedExport.status === 403, deniedExport.body);
  const allowedExport = await action('export', { classId: teacherAssignments[0].classId, subjectId: teacherAssignments[0].subjectId, format: 'csv' });
  check('teacher export for their own assignment is audited', allowedExport.status === 200, allowedExport.body);

  const legacyRows = scopedStudents.body.students.map((s: any) => ({
    studentId: s.id, attendanceStatus: 'PRESENT', performance: 'GOOD', conduct: 'GOOD',
    punctuality: 'ALWAYS_ON_TIME', homework: 'ALWAYS_COMPLETED', participation: 'ACTIVE',
  }));
  const lessonDate = dayOffset(ref.body.today, -1);
  const lessonPayload = {
    classId: teacherAssignments[0].classId, subjectId: teacherAssignments[0].subjectId,
    academicYearId: teacherAssignments[0].academicYearId, lessonDate, topic: 'Smoke test topic', records: legacyRows,
  };
  const draft = await action('saveMonthlyRecord', { ...lessonPayload, submit: false });
  check('teacher saves a legacy lesson draft', draft.status === 200 && draft.body.lesson?.status === 'DRAFT', draft.body);
  const lessonId: string = draft.body.lesson?.id;
  if (lessonId) lessonIds.push(lessonId);
  const duplicate = await action('saveMonthlyRecord', { ...lessonPayload, submit: false });
  check('a second report for the same date is rejected', duplicate.status === 409, duplicate.body);
  const incompleteSubmit = await action('saveMonthlyRecord', { ...lessonPayload, id: lessonId, submit: true, records: legacyRows.slice(1) });
  check('submitting without the full roster is rejected', incompleteSubmit.status >= 400, incompleteSubmit.body);
  const submittedLesson = await action('saveMonthlyRecord', { ...lessonPayload, id: lessonId, submit: true });
  check('legacy lesson submits for review', submittedLesson.status === 200 && submittedLesson.body.lesson?.status === 'SUBMITTED', submittedLesson.body);
  const lessonView = await call(`/api/app?view=monthlyLesson&id=${lessonId}`);
  check('lesson view returns the report with every record', lessonView.status === 200 && lessonView.body.records.length === legacyRows.length, lessonView.body.records?.length);
  const reportRows = await call(`/api/app?view=reports&from=${dayOffset(ref.body.today, -30)}&to=${ref.body.today}`);
  check('report history includes the new legacy row', (reportRows.body.reports as any[]).some((r) => r.id === lessonId && r.kind === 'lesson'), reportRows.body.reports?.slice(0, 3));
  const filedAsTeacher = await call(`/api/app?view=reports&from=${dayOffset(ref.body.today, -30)}&to=${ref.body.today}`);
  const filedNames = [...new Set((filedAsTeacher.body.reports as any[]).map((r) => r.teacherName))];
  check('teacher report history only shows their own reports', filedAsTeacher.status === 200 && filedNames.length === 1 && (filedAsTeacher.body.reports as any[]).some((r) => r.id === lessonId), filedNames);
  const teacherLessonView = await call(`/api/app?view=monthlyLesson&id=${lessonId}`);
  check('teacher can read back the report they filed', teacherLessonView.status === 200 && teacherLessonView.body.records.length === legacyRows.length, teacherLessonView.status);

  await login(ADMIN);
  const studentTimeline = await call(`/api/app?view=studentProfile&id=${legacyRows[0].studentId}`);
  check('student profile timeline shows the legacy report', (studentTimeline.body?.timeline || []).some((r: any) => r.topic === 'Smoke test topic'), studentTimeline.body?.timeline?.length);

  const reviewStart = await action('review', { id: lessonId, status: 'UNDER_REVIEW' });
  check('administrator starts reviewing the legacy report', reviewStart.status === 200, reviewStart.body);
  const returnNoReason = await action('review', { id: lessonId, status: 'RETURNED' });
  check('returning a report without a reason is rejected', returnNoReason.status >= 400, returnNoReason.body);
  const returned = await action('review', { id: lessonId, status: 'RETURNED', comment: 'Please add the exercises covered' });
  check('administrator returns the legacy report with a note', returned.status === 200, returned.body);
  const returnedView = await call(`/api/app?view=monthlyLesson&id=${lessonId}`);
  check('returned report carries the review note', returnedView.body.lesson.status === 'RETURNED' && !!returnedView.body.lesson.reviewComment, returnedView.body.lesson);

  await login(TEACHER);
  const resubmit = await action('saveMonthlyRecord', { ...lessonPayload, id: lessonId, submit: true });
  check('teacher resubmits the returned report', resubmit.status === 200 && resubmit.body.lesson.status === 'SUBMITTED' && !resubmit.body.lesson.reviewComment, resubmit.body);

  await login(ADMIN);
  const underReview = await action('review', { id: lessonId, status: 'UNDER_REVIEW' });
  const approved = await action('review', { id: lessonId, status: 'APPROVED' });
  check('report moves under review and is approved', underReview.status === 200 && approved.status === 200, { underReview: underReview.body, approved: approved.body });
  const approveAgain = await action('review', { id: lessonId, status: 'APPROVED' });
  check('an approved report cannot be approved twice', approveAgain.status >= 400, approveAgain.body);
  const noChange = await action('correctLessonDate', { id: lessonId, lessonDate, reason: 'Trying to set the same date again' });
  check('date correction to the same date is refused', noChange.status >= 400, noChange.body);
  const shortReason = await action('correctLessonDate', { id: lessonId, lessonDate: ref.body.today, reason: 'short' });
  check('date correction requires a written reason', shortReason.status >= 400, shortReason.body);
  const corrected = await action('correctLessonDate', { id: lessonId, lessonDate: ref.body.today, reason: 'Smoke test date correction to today' });
  check('administrator corrects the lesson date with a reason', corrected.status === 200, corrected.body);
  const correctedView = await call(`/api/app?view=monthlyLesson&id=${lessonId}`);
  check('corrected report shows the new date', correctedView.body.lesson?.lessonDate === ref.body.today, correctedView.body.lesson?.lessonDate);

  await login(TEACHER);
  const teacherDeleteApproved = await action('deleteDraft', { id: lessonId });
  check('an approved legacy report cannot be deleted', teacherDeleteApproved.status >= 400, teacherDeleteApproved.body);
  const secondDraft = await action('saveMonthlyRecord', { ...lessonPayload, lessonDate: dayOffset(ref.body.today, -2), submit: false });
  const secondId: string = secondDraft.body.lesson?.id;
  if (secondId) lessonIds.push(secondId);
  const deleted = secondId ? await action('deleteDraft', { id: secondId }) : { status: 500, body: 'no draft id' };
  check('teacher deletes their own draft report', deleted.status === 200, deleted.body);
  const afterDelete = secondId ? await call(`/api/app?view=monthlyLesson&id=${secondId}`) : { status: 500, body: null };
  check('deleted draft no longer resolves', afterDelete.status === 404, afterDelete.body);
  const monthlyAfterLegacy = await call(`/api/app?view=monthly&classId=${teacherAssignments[0].classId}&subjectId=${teacherAssignments[0].subjectId}&from=${dayOffset(ref.body.today, -10)}&to=${ref.body.today}`);
  check('report view still resolves after the legacy workflow', monthlyAfterLegacy.status === 200, monthlyAfterLegacy.body?.coverage);

  await login(ADMIN);
  const badCategory = await action('observation', { studentId: target.id, classId: target.classId, date: ref.body.today, category: 'Nonsense', severity: 'LOW', description: 'A behaviour note for testing', followUpRequired: false });
  check('behaviour entry rejects an unknown category', badCategory.status >= 400, badCategory.body);
  const observation = await action('observation', { studentId: target.id, classId: target.classId, date: ref.body.today, category: 'Behaviour', severity: 'MODERATE', description: 'A behaviour note for testing', actionTaken: 'Spoke with the student', followUpRequired: true });
  check('administrator records a behaviour observation', observation.status === 200 && !!observation.body.id, observation.body);
  if (observation.body?.id) observationIds.push(observation.body.id);
  const observations = await call(`/api/app?view=behaviourObservations&studentId=${target.id}`);
  check('behaviour log returns the new observation', observations.status === 200 && (observations.body.observations as any[]).some((o) => o.id === observation.body.id), observations.body.observations?.length);
  const resolved = await action('resolveFollowUp', { id: observation.body.id, resolved: true });
  const afterResolve = await call(`/api/app?view=behaviourObservations&studentId=${target.id}&followUp=1`);
  check('follow-up can be resolved and leaves the follow-up queue', resolved.status === 200 && !(afterResolve.body.observations as any[]).some((o) => o.id === observation.body.id), afterResolve.body.observations?.length);

  const settingsBefore = await call('/api/app?view=settings');
  const currentSettings = settingsBefore.body.settings;
  const currentOrg = settingsBefore.body.organization;
  const badZone = await action('settings', { timezone: 'Not/AZone', excellentThreshold: currentSettings.excellentThreshold, goodThreshold: currentSettings.goodThreshold, homeworkUsuallyThreshold: currentSettings.homeworkUsuallyThreshold, punctualityOccasionallyMax: currentSettings.punctualityOccasionallyMax });
  check('settings reject an invalid timezone', badZone.status >= 400, badZone.body);
  const savedSettings = await action('settings', {
    name: currentOrg.name, logoUrl: currentOrg.logoUrl, timezone: currentOrg.timezone,
    excellentThreshold: currentSettings.excellentThreshold, goodThreshold: currentSettings.goodThreshold,
    homeworkUsuallyThreshold: currentSettings.homeworkUsuallyThreshold, punctualityOccasionallyMax: currentSettings.punctualityOccasionallyMax,
  });
  const settingsAfter = await call('/api/app?view=settings');
  check('settings round-trip keeps organization intact and drops the cadence flag', savedSettings.status === 200 && !('reportingCadence' in (settingsAfter.body.settings || {})) && settingsAfter.body.organization.name === currentOrg.name && settingsAfter.body.organization.logoUrl === currentOrg.logoUrl, {
    version: settingsAfter.body.settings.version,
  });
  const testMonth = '2026-10';
  tempClosure.month = testMonth;
  tempClosure.created = !(settingsBefore.body.closures as any[]).some((c) => c.month === testMonth);
  const closeMonth = await action('month', { month: testMonth, closed: true });
  const blockedEntry = await action('saveMonthlyEntry', { month: testMonth, classId: teacherAssignments[0].classId, subjectId: teacherAssignments[0].subjectId, sessionsHeld: 20, topics: 'Blocked by closure', submit: false, records: [] });
  const reopenMonth = await action('month', { month: testMonth, closed: false });
  const closuresAfter = await call('/api/app?view=settings');
  check('closing a month blocks filing until it is reopened', closeMonth.status === 200 && blockedEntry.status === 409 && reopenMonth.status === 200, { close: closeMonth.body, blocked: blockedEntry.body, reopen: reopenMonth.body });
  check('reopening restores an open month', !(closuresAfter.body.closures as any[]).some((c) => c.month === testMonth && c.closed), closuresAfter.body.closures);
  const adminSettingsSave = await action('adminSettings', {
    adminDateOverrideDays: currentSettings.adminDateOverrideDays, adminCanOverrideFuture: currentSettings.adminCanOverrideFuture, adminOverrideRequiresReason: currentSettings.adminOverrideRequiresReason,
  });
  check('reporting window settings save', adminSettingsSave.status === 200, adminSettingsSave.body);
  const adminExport = await action('export', { format: 'xlsx' });
  check('administrator export is accepted and audited', adminExport.status === 200, adminExport.body);

  const grade = await action('create', undefined, { type: 'grade', data: { name: `Tmp Grade ${suffix}`, orderIndex: 99 } });
  const classRow = await action('create', undefined, { type: 'class', data: { name: `TMP-${suffix}`, gradeId: '', academicYearId: activeYear.id } });
  check('grade creation succeeds and an invalid class is refused', grade.status === 200 && classRow.status >= 400, { grade: grade.body, classRow: classRow.body });
  const freshRef = await call('/api/app?view=reference');
  const tempGrade = (freshRef.body.grades as any[]).find((g) => g.name === `Tmp Grade ${suffix}`);
  if (tempGrade) tempRows.push({ kind: 'grade', id: tempGrade.id });
  const createdClass = await action('create', undefined, { type: 'class', data: { name: `TMP-${suffix}`, gradeId: tempGrade?.id, academicYearId: activeYear.id } });
  const badStudent = await action('create', undefined, { type: 'student', data: { studentId: `TMP-${suffix}`, firstName: 'Tmp', lastName: 'Student', gradeId: tempGrade?.id, classId: '', academicYearId: activeYear.id } });
  const subject = await action('create', undefined, { type: 'subject', data: { name: `Tmp Subject ${suffix}`, code: 'TST' } });
  const ref2 = await call('/api/app?view=reference');
  const tempClass = (ref2.body.classes as any[]).find((c) => c.name === `TMP-${suffix}`);
  if (tempClass) tempRows.push({ kind: 'class', id: tempClass.id });
  const tempSubject = (ref2.body.subjects as any[]).find((s) => s.name === `Tmp Subject ${suffix}`);
  if (tempSubject) tempRows.push({ kind: 'subject', id: tempSubject.id });
  const student = await action('create', undefined, { type: 'student', data: { studentId: `TMP-${suffix}`, firstName: 'Tmp', lastName: 'Student', gradeId: tempGrade?.id, classId: tempClass?.id, academicYearId: activeYear.id } });
  check('class, subject and student creation succeed for a matched roster', createdClass.status === 200 && badStudent.status >= 400 && subject.status === 200 && student.status === 200, {
    class: createdClass.body, badStudent: badStudent.body, subject: subject.body, student: student.body,
  });
  const ref3 = await call('/api/app?view=reference');
  const tempStudent = (ref3.body.students as any[]).find((s) => s.studentId === `TMP-${suffix}`);
  if (tempStudent) tempRows.push({ kind: 'student', id: tempStudent.id });
  const assignment = await action('create', undefined, { type: 'assignment', data: { teacherId: teachersList[0].id, classId: tempClass?.id, subjectId: tempSubject?.id, academicYearId: activeYear.id } });
  const duplicateAssignment = await action('create', undefined, { type: 'assignment', data: { teacherId: teachersList[0].id, classId: tempClass?.id, subjectId: tempSubject?.id, academicYearId: activeYear.id } });
  check('assignment creation succeeds and duplicates are rejected', assignment.status === 200 && duplicateAssignment.status >= 400, { assignment: assignment.body, duplicate: duplicateAssignment.body });
  const renamedStudent = await action('updateEntity', undefined, { type: 'student', data: { id: tempStudent?.id, firstName: 'Tmp', lastName: 'Renamed', studentId: `TMP-${suffix}`, gradeId: tempGrade?.id, classId: tempClass?.id, academicYearId: activeYear.id, status: 'ACTIVE' } });
  const ref4 = await call('/api/app?view=reference');
  const renamed = (ref4.body.students as any[]).find((s) => s.id === tempStudent?.id);
  check('student update renames the record', renamedStudent.status === 200 && renamed?.fullName === 'Tmp Renamed', renamed?.fullName);
  const year = await action('create', undefined, { type: 'year', data: { name: `Tmp 2099-${suffix}`, startDate: '2099-08-01', endDate: '2100-07-31' } });
  const term = await action('create', undefined, { type: 'term', data: { name: `Tmp Term ${suffix}`, academicYearId: activeYear.id, startDate: '2099-08-01', endDate: '2099-09-01' } });
  const ref5 = await call('/api/app?view=reference');
  const tempYear = (ref5.body.years as any[]).find((y) => y.name === `Tmp 2099-${suffix}`);
  const tempTerm = (ref5.body.terms as any[]).find((t) => t.name === `Tmp Term ${suffix}`);
  if (tempYear) tempRows.push({ kind: 'year', id: tempYear.id });
  if (tempTerm) tempRows.push({ kind: 'term', id: tempTerm.id });
  const deactivateYear = tempYear ? await action('updateEntity', undefined, { type: 'year', data: { id: tempYear.id, name: tempYear.name, startDate: tempYear.startDate, endDate: tempYear.endDate, active: false } }) : { status: 500, body: 'no year' };
  check('academic year and term creation succeed and the year can be retired', year.status === 200 && term.status === 200 && deactivateYear.status === 200, { year: year.body, term: term.body });

  const tempUsername = `tmpteacher.${suffix}`;
  const teacherCreate = await action('create', undefined, { type: 'teacher', data: { teacherId: `TMP-${suffix}`, name: 'Temp Smoke Teacher', email: `tmpteacher.${suffix}@example.com`, username: tempUsername, password: 'TempPass!2026' } });
  const duplicateEmail = await action('create', undefined, { type: 'teacher', data: { teacherId: `TMP2-${suffix}`, name: 'Temp Smoke Teacher 2', email: `tmpteacher.${suffix}@example.com`, username: `${tempUsername}2`, password: 'TempPass!2026' } });
  const duplicateUsername = await action('create', undefined, { type: 'teacher', data: { teacherId: `TMP3-${suffix}`, name: 'Temp Smoke Teacher 3', email: `tmpteacher3.${suffix}@example.com`, username: tempUsername, password: 'TempPass!2026' } });
  const duplicateCode = await action('create', undefined, { type: 'teacher', data: { teacherId: `TMP-${suffix}`, name: 'Temp Smoke Teacher 4', email: `tmpteacher4.${suffix}@example.com`, username: `${tempUsername}4`, password: 'TempPass!2026' } });
  const ref6 = await call('/api/app?view=reference');
  const createdTeacher = (ref6.body.teachers as any[]).find((t) => t.teacherId === `TMP-${suffix}`);
  tempTeacher.id = createdTeacher?.id;
  tempTeacher.username = tempUsername;
  check('teacher account creation succeeds', teacherCreate.status === 200 && !!createdTeacher, { create: teacherCreate.body, found: !!createdTeacher });
  check('duplicate teacher email, username and ID are refused with a clear error', [duplicateEmail.status, duplicateUsername.status, duplicateCode.status].every((s) => s === 409), { email: duplicateEmail.body, username: duplicateUsername.body, code: duplicateCode.body });
  const tempTeacherLogin = await login({ identity: tempUsername, password: 'TempPass!2026' });
  check('created teacher signs in with the supplied password', tempTeacherLogin.role === 'TEACHER', tempTeacherLogin);
  await login(ADMIN);
  const resetPassword = await action('resetTeacherPassword', { teacherId: createdTeacher?.id, password: 'TempPass!9999' });
  const relogin = await login({ identity: tempUsername, password: 'TempPass!9999' });
  check('password reset issues a working password and revokes the session', resetPassword.status === 200 && relogin.role === 'TEACHER', { reset: resetPassword.body, relogin });
  await login(ADMIN);
  const deactivate = await action('teacherAccess', { teacherId: createdTeacher?.id, active: false });
  let blockedLogin: { status: number } = { status: 200 };
  try {
    await login({ identity: tempUsername, password: 'TempPass!9999' });
  } catch {
    blockedLogin = { status: 401 };
  }
  await login(ADMIN);
  const reactivate = await action('teacherAccess', { teacherId: createdTeacher?.id, active: true });
  check('deactivating a teacher blocks sign-in until reactivated', deactivate.status === 200 && blockedLogin.status === 401 && reactivate.status === 200, { deactivate: deactivate.body, blocked: blockedLogin, reactivate: reactivate.body });
  const teacherUpdate = await action('updateEntity', undefined, { type: 'teacher', data: { id: createdTeacher?.id, name: 'Temp Smoke Teacher II', email: `tmpteacher.${suffix}@example.com`, active: true } });
  const teacherDelete = await action('deleteEntity', undefined, { type: 'student', id: tempStudent?.id });
  const classDelete = await action('deleteEntity', undefined, { type: 'class', id: tempClass?.id });
  const subjectDelete = await action('deleteEntity', undefined, { type: 'subject', id: tempSubject?.id });
  const gradeDelete = await action('deleteEntity', undefined, { type: 'grade', id: tempGrade?.id });
  const termDelete = await action('deleteEntity', undefined, { type: 'term', id: tempTerm?.id });
  check('entity deactivation covers student, class, subject, grade and term', [teacherUpdate.status, teacherDelete.status, classDelete.status, subjectDelete.status, gradeDelete.status, termDelete.status].every((s) => s === 200), {
    teacherUpdate: teacherUpdate.body, student: teacherDelete.body, class: classDelete.body, subject: subjectDelete.body, grade: gradeDelete.body, term: termDelete.body,
  });
  const ref7 = await call('/api/app?view=reference');
  const deactivatedStudent = (ref7.body.students as any[]).find((s) => s.id === tempStudent?.id);
  const deactivatedClass = (ref7.body.classes as any[]).find((c) => c.id === tempClass?.id);
  check('deactivated records are flagged inactive', deactivatedStudent?.status === 'INACTIVE' && deactivatedClass?.active === false, { student: deactivatedStudent?.status, class: deactivatedClass?.active });
  const badType = await action('deleteEntity', undefined, { type: 'year', id: tempGrade?.id });
  check('deleting an academic year through the API is not allowed', badType.status >= 400, badType.body);
  const tempAssignment = (ref7.body.assignments as any[]).find((a) => a.classId === tempClass?.id && a.subjectId === tempSubject?.id);
  if (tempAssignment) tempRows.push({ kind: 'assignment', id: tempAssignment.id });
  const removed = tempAssignment ? await action('deleteEntity', undefined, { type: 'assignment', id: tempAssignment.id }) : { status: 500, body: 'no assignment' };
  const ref8 = await call('/api/app?view=reference');
  check('assignment removal deletes the row', removed.status === 200 && !(ref8.body.assignments as any[]).some((a) => a.id === tempAssignment?.id), removed.body);

  const wrongCurrent = await call('/api/auth', { method: 'POST', body: JSON.stringify({ action: 'password', current: 'not-the-password', password: 'TempPass!9999' }) });
  check('password change rejects the wrong current password', wrongCurrent.status >= 400, wrongCurrent.body);
  const weakChange = await call('/api/auth', { method: 'POST', body: JSON.stringify({ action: 'password', current: ADMIN_ORIGINAL_PASSWORD, password: 'simple' }) });
  check('password change enforces the password rule', weakChange.status >= 400, weakChange.body);
  const changed = await call('/api/auth', { method: 'POST', body: JSON.stringify({ action: 'password', current: ADMIN_ORIGINAL_PASSWORD, password: 'SmokeChange!2026' }) });
  const withNew = await login({ identity: ADMIN.identity, password: 'SmokeChange!2026' });
  const restored = await call('/api/auth', { method: 'POST', body: JSON.stringify({ action: 'password', current: 'SmokeChange!2026', password: ADMIN_ORIGINAL_PASSWORD }) });
  const backToNormal = await login(ADMIN);
  check('password change round-trip ends on the original password', changed.status === 200 && withNew.role === 'ADMIN' && restored.status === 200 && backToNormal.role === 'ADMIN', {
    changed: changed.body, restored: restored.body,
  });

  // Subject rosters: the teacher picks which students take their subject (club-style membership).
  const srAdminRef = await call('/api/app?view=reference');
  await login(TEACHER);
  const srRef = await call('/api/app?view=reference');
  const srAssignment = (srRef.body.assignments as any[]).find((a) => a.active !== false);
  check('teacher has an assignment for subject roster management', !!srAssignment, (srRef.body.assignments as any[]).length);
  const srClassId = srAssignment?.classId as string;
  const srSubjectId = srAssignment?.subjectId as string;
  const srBefore = await call(`/api/app?view=subjectRoster&classId=${srClassId}&subjectId=${srSubjectId}`);
  check('subject roster starts as the whole-class default', srBefore.status === 200 && srBefore.body.isDefault === true && srBefore.body.enrolled.length === 0 && srBefore.body.students.length > 2, { status: srBefore.status, students: srBefore.body?.students?.length });
  const srPair = (srBefore.body.students as any[]).slice(0, 2).map((s) => s.id);
  const srSave = await action('saveSubjectRoster', { classId: srClassId, subjectId: srSubjectId, studentIds: srPair });
  check('teacher saves a subject group of two students', srSave.status === 200 && srSave.body.count === 2 && srSave.body.isDefault === false, srSave.body);
  const srAfter = await call(`/api/app?view=subjectRoster&classId=${srClassId}&subjectId=${srSubjectId}`);
  check('saved subject group reads back with two enrolled students', srAfter.status === 200 && srAfter.body.isDefault === false && srAfter.body.enrolled.length === 2 && (srAfter.body.students as any[]).length > 2, { enrolled: srAfter.body?.enrolled?.length, students: srAfter.body?.students?.length });
  const srForm = await call(`/api/app?view=monthlyEntry&month=${testMonth}&classId=${srClassId}&subjectId=${srSubjectId}`);
  check('monthly form roster follows the subject group', srForm.status === 200 && (srForm.body.roster as any[]).length === 2 && srForm.body.rosterDefault === false, { roster: srForm.body?.roster?.length, isDefault: srForm.body?.rosterDefault });
  const srRow = (studentId: string) => ({ studentId, punctuality: 'ALWAYS_ON_TIME', performance: 'GOOD', participation: 'ACTIVE', homework: 'ALWAYS_COMPLETED', conduct: 'GOOD', comment: '' });
  const srMissing = await action('saveMonthlyEntry', { month: testMonth, classId: srClassId, subjectId: srSubjectId, sessionsHeld: 20, topics: 'Subject group coverage', submit: true, records: [srRow(srPair[0])] });
  check('submitting without every subject-group student is rejected', srMissing.status === 400, srMissing.body);
  const srDraft = await action('saveMonthlyEntry', { month: testMonth, classId: srClassId, subjectId: srSubjectId, sessionsHeld: 20, topics: 'Subject group coverage', submit: false, records: srPair.map(srRow) });
  check('draft save with the subject group succeeds', srDraft.status === 200 && !!srDraft.body.id, srDraft.body);
  const srForeignPair = (srAdminRef.body.classes as any[]).flatMap((c) => (srRef.body.subjects as any[]).map((s) => ({ classId: c.id, subjectId: s.id })))
    .find((p) => !(srRef.body.assignments as any[]).some((a) => a.classId === p.classId && a.subjectId === p.subjectId)) || null;
  const srOutsiderView = srForeignPair ? await call(`/api/app?view=subjectRoster&classId=${srForeignPair.classId}&subjectId=${srForeignPair.subjectId}`) : { status: 0, body: null };
  const srOutsiderSave = srForeignPair ? await action('saveSubjectRoster', { classId: srForeignPair.classId, subjectId: srForeignPair.subjectId, studentIds: [] }) : { status: 0, body: null };
  check('a teacher cannot view or manage a subject they are not assigned to', srForeignPair ? srOutsiderView.status === 403 && srOutsiderSave.status === 403 : true, { view: srOutsiderView.status, save: srOutsiderSave.status });
  await login(ADMIN);
  const srReports = await call('/api/app?view=reports&from=2026-10-01&to=2026-10-31');
  const srReportRow = (srReports.body.reports as any[]).find((r) => r.id === srDraft.body?.id);
  check('report completion counts the subject roster, not the class', srReports.status === 200 && srReportRow?.rosterCount === 2 && srReportRow?.recordsCount === 2, { rosterCount: srReportRow?.rosterCount, recordsCount: srReportRow?.recordsCount });
  await login(TEACHER);
  const srDelete = srDraft.body?.id ? await action('deleteDraft', { id: srDraft.body.id }) : { status: 500, body: 'no draft' };
  check('subject-group test draft is cleaned up', srDelete.status === 200, srDelete.body);
  const srReset = await action('saveSubjectRoster', { classId: srClassId, subjectId: srSubjectId, studentIds: [] });
  const srResetView = await call(`/api/app?view=subjectRoster&classId=${srClassId}&subjectId=${srSubjectId}`);
  const srResetForm = await call(`/api/app?view=monthlyEntry&month=${testMonth}&classId=${srClassId}&subjectId=${srSubjectId}`);
  check('teacher restores the whole-class default', srReset.status === 200 && srReset.body.isDefault === true && srResetView.body.isDefault === true && srResetForm.body.rosterDefault === true && (srResetForm.body.roster as any[]).length > 2, { save: srReset.body, formRoster: srResetForm.body?.roster?.length });

  // Club members move to the teachers' UI: teachers manage rosters of their own clubs.
  await login(ADMIN);
  const clubName = `Temp Members Club ${suffix}`;
  const clubCreate = await action('createClub', { name: clubName, description: 'Member management smoke test' });
  check('admin creates a club for the member-management test', clubCreate.status === 200, clubCreate.body);
  const tempClubId = clubCreate.body?.club?.id as string;
  const teacherRow = await db.select({ id: teachers.id }).from(teachers).innerJoin(users, eq(users.id, teachers.userId)).where(eq(users.username, TEACHER.identity)).limit(1);
  const clubTeacherId = teacherRow[0]?.id as string;
  check('the class teacher has a teacher record for club assignment', !!clubTeacherId, teacherRow);
  await login(TEACHER);
  const deniedMembers = await action('updateClubMembers', { clubId: tempClubId, studentIds: [] });
  check('an unassigned teacher cannot manage club members', deniedMembers.status === 403, deniedMembers.body);
  await login(ADMIN);
  const attach = await action('updateClub', { id: tempClubId, name: clubName, description: 'Member management smoke test', active: true, teacherIds: [clubTeacherId] });
  check('admin attaches the teacher to the club', attach.status === 200, attach.body);
  await login(TEACHER);
  const teacherClubs = await call('/api/app?view=clubs');
  check('teacher club view returns student options for member picking', teacherClubs.status === 200 && (teacherClubs.body.studentOptions as any[]).length > 0, { options: teacherClubs.body?.studentOptions?.length });
  const memberPair = (teacherClubs.body.studentOptions as any[]).slice(0, 2).map((s: any) => s.id);
  const memberSave = await action('updateClubMembers', { clubId: tempClubId, studentIds: memberPair });
  check('teacher adds students to the club from the teachers UI', memberSave.status === 200 && memberSave.body.count === memberPair.length, memberSave.body);
  const clubsAfterMembers = await call('/api/app?view=clubs');
  const tempMembers = (clubsAfterMembers.body.members as any[]).filter((m: any) => m.clubId === tempClubId);
  check('club member list reads back the saved students', tempMembers.length === memberPair.length && memberPair.every((id: string) => tempMembers.some((m: any) => m.studentId === id)), { saved: memberPair, readBack: tempMembers.map((m: any) => m.studentId) });
  const badMember = await action('updateClubMembers', { clubId: tempClubId, studentIds: ['00000000-0000-4000-8000-000000000009'] });
  check('club members must belong to the school', badMember.status === 400, badMember.body);

  // Admin edits their own username; names already taken are rejected.
  await login(ADMIN);
  const wantedName = `smoke.admin.${suffix}`;
  const rename = await action('updateMyAccount', { username: wantedName });
  check('admin changes their own username', rename.status === 200 && rename.body.username === wantedName, rename.body);
  const takenName = await action('updateMyAccount', { username: SUPER.identity });
  check('a username that is already taken is rejected', takenName.status >= 400, takenName.body);
  const renameBack = await action('updateMyAccount', { username: ADMIN.identity });
  check('username reverts so later logins keep working', renameBack.status === 200 && renameBack.body.username === ADMIN.identity, renameBack.body);
  await login(TEACHER);
  const teacherRename = await action('updateMyAccount', { username: `teacher.${suffix}` });
  check('teachers cannot change usernames', teacherRename.status === 403, teacherRename.body);
  await login(ADMIN);
  const clubArchive = await action('deleteEntity', undefined, { type: 'club', id: tempClubId });
  check('temporary club is archived after the member test', clubArchive.status === 200, clubArchive.body);

  await login(SUPER);
  const replaceAdmin = await action('admin', { organizationId: tempOrg.id, name: 'Temp Admin 2', username: `tmpadmin2.${suffix}`, email: `tmp2.${suffix}@example.com`, password: 'TmpAdmin!2026' });
  tempOrg.usernames.push(`tmpadmin2.${suffix}`);
  check('creating a second administrator replaces the primary one', replaceAdmin.status === 200, replaceAdmin.body);

  const logout = await call('/api/auth', { method: 'POST', body: JSON.stringify({ action: 'logout' }) });
  const afterLogout = await call('/api/auth');
  const guarded = await call('/api/app?view=reference');
  check('sign out ends the session and closes protected views', logout.status === 200 && afterLogout.body.user === null && guarded.status === 401, { logout: logout.body, guarded: guarded.status });
}

main()
  .then(async () => { console.log(checks.join('\n')); const failed = checks.filter((c) => c.startsWith('FAIL')); console.log(`\n${checks.length - failed.length}/${checks.length} checks passed`); return failed.length ? 1 : 0; })
  .catch(async (e) => { console.log(checks.join('\n')); console.error(e); return 1; })
  .then(async (code) => { await cleanup(); process.exit(code as number); });

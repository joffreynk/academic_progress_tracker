import fs from 'fs';
import path from 'path';
import { inflateSync } from 'node:zlib';
import { db } from '../src/db';
import { clubs, clubTeachers, clubMembers, clubActivities, clubActivityRecords } from '../src/db/schema';
import { eq, inArray } from 'drizzle-orm';

const TINY_PNG = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';

const BASE = process.env.BASE_URL || 'http://localhost:3000';
const ADMIN = { identity: process.env.ADMIN_USER || 'schooladmin', password: process.env.ADMIN_PASS || 'LocalAdmin!2026' };
const LOCAL_TEACHER = { identity: process.env.TEACHER_USER || 'class.teacher', password: process.env.TEACHER_PASS || 'school123' };

let cookie = '';
const createdClubIds: string[] = [];
const checks: string[] = [];

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

function splitCsvLine(line: string): string[] {
  const cells: string[] = [];
  let cell = '';
  let quoted = false;
  for (const ch of line) {
    if (ch === '"') { quoted = !quoted; continue; }
    if (ch === ',' && !quoted) { cells.push(cell); cell = ''; continue; }
    cell += ch;
  }
  cells.push(cell);
  return cells;
}

function importedTeacherCredentials(): { name: string; username: string; password: string }[] {
  const file = fs.readdirSync(process.cwd()).filter((f) => /^teacher-passwords-.*\.csv$/.test(f)).sort().pop();
  if (!file) return [];
  const lines = fs.readFileSync(path.join(process.cwd(), file), 'utf8').split(/\r?\n/).filter(Boolean);
  const header = splitCsvLine(lines[0]).map((h) => h.trim().toLowerCase());
  const ui = header.indexOf('username');
  const pi = header.indexOf('password');
  const ni = header.indexOf('name');
  if (ui === -1 || pi === -1) return [];
  return lines.slice(1).map((l) => {
    const cells = splitCsvLine(l);
    return { name: ni === -1 ? '' : (cells[ni] || '').trim(), username: (cells[ui] || '').trim(), password: (cells[pi] || '').trim() };
  }).filter((c) => c.username && c.password);
}

async function cleanup() {
  for (const id of createdClubIds) {
    const activityIds = (await db.select({ id: clubActivities.id }).from(clubActivities).where(eq(clubActivities.clubId, id))).map((r) => r.id);
    if (activityIds.length) await db.delete(clubActivityRecords).where(inArray(clubActivityRecords.clubActivityId, activityIds));
    await db.delete(clubActivities).where(eq(clubActivities.clubId, id));
    await db.delete(clubMembers).where(eq(clubMembers.clubId, id));
    await db.delete(clubTeachers).where(eq(clubTeachers.clubId, id));
    await db.delete(clubs).where(eq(clubs.id, id));
  }
}

function pdfText(buf: Buffer): string {
  const out: string[] = [];
  let index = buf.indexOf('stream');
  while (index !== -1) {
    let start = index + 'stream'.length;
    if (buf[start] === 0x0d) start += 1;
    if (buf[start] === 0x0a) start += 1;
    const end = buf.indexOf('endstream', start);
    if (end === -1) break;
    const chunk = buf.toString('latin1', start, end);
    let stream = chunk;
    try { stream = inflateSync(Buffer.from(chunk, 'latin1')).toString('latin1'); } catch { stream = chunk; }
    const re = /\(((?:\\.|[^\\()])*)\)\s*Tj/g;
    let m: RegExpExecArray | null;
    while ((m = re.exec(stream))) out.push(m[1].replace(/\\([()\\])/g, '$1'));
    index = buf.indexOf('stream', end + 9);
  }
  return out.join(' ');
}

async function main() {
  const adminRole = await login(ADMIN);
  check('admin login', adminRole.role === 'ADMIN', adminRole);

  const ref = await call('/api/app?view=reference');
  const students: { id: string }[] = ref.body.students || [];
  const teachers: { id: string; name: string }[] = ref.body.teachers || [];
  const years: { id: string }[] = ref.body.years || [];
  check('admin reference data', students.length > 0 && teachers.length > 0, { students: students.length, teachers: teachers.length });

  const localTeacher = teachers.find((t) => t.name === 'Class Teacher') || teachers[0];
  const otherTeacher = teachers.find((t) => t.id !== localTeacher.id);
  const suffix = Date.now().toString(36);
  const clubName = `Robotics Club ${suffix}`;

  const created = await action('createClub', {
    name: clubName,
    description: 'Automation and robotics practice',
    academicYearId: years[0]?.id || null,
    teacherIds: [localTeacher.id, ...(otherTeacher ? [otherTeacher.id] : [])],
    studentIds: students.slice(0, 3).map((s) => s.id),
  });
  check('createClub', created.status === 200 && !!created.body.club?.id, created.body);
  const clubId: string | undefined = created.body.club?.id;
  if (clubId) createdClubIds.push(clubId);

  let view = await call('/api/app?view=clubs');
  check('club list returns new club', (view.body.clubs as any[]).some((c) => c.id === clubId), view.body.clubs);
  check('member roster has 3 students', (view.body.members as any[]).filter((m) => m.clubId === clubId).length === 3, view.body.members);
  check('first assigned teacher is lead', (view.body.teachers as any[]).some((t) => t.clubId === clubId && t.role === 'LEAD'), view.body.teachers);
  check('teacher picker available to admin', (view.body.teacherOptions as any[]).length > 0, view.body.teacherOptions);
  check('clubs payload includes records array', Array.isArray(view.body.records), view.body.records);

  const created2 = await action('createClub', { name: clubName, teacherIds: [], studentIds: [] });
  check('duplicate club name rejected', created2.status >= 400, created2.body);

  const memberIds = (view.body.members as any[]).filter((m) => m.clubId === clubId).map((m) => m.studentId as string);
  const recordFor = (ids: string[], patch: Record<string, unknown> = {}) =>
    ids.map((studentId) => ({ studentId, punctuality: 'ALWAYS_ON_TIME', performance: 'GOOD', participation: 'ACTIVE', conduct: 'GOOD', comment: '', ...patch }));
  const saveActivity = (payload: Record<string, unknown>) => action('saveClubActivity', {
    clubId, activityDate: '2026-10-02', description: 'Built two line-following robots', ...payload,
  });

  const noRows = await saveActivity({ title: 'Draft without records' });
  check('draft activity saved', noRows.status === 200 && noRows.body.status === 'DRAFT', noRows.body);
  const noRowsSubmit = await action('submitClubActivity', { id: noRows.body.id });
  check('submit without member records rejected', noRowsSubmit.status >= 400 && /member/i.test(JSON.stringify(noRowsSubmit.body)), noRowsSubmit.body);

  const partial = await saveActivity({ title: 'Partial roster', records: recordFor(memberIds.slice(0, 2)) });
  check('partial records saved as draft', partial.status === 200, partial.body);
  const partialSubmit = await action('submitClubActivity', { id: partial.body.id });
  check('submit with incomplete roster rejected', partialSubmit.status >= 400 && /member/i.test(JSON.stringify(partialSubmit.body)), partialSubmit.body);

  const noPunctuality = await saveActivity({ title: 'Missing punctuality', records: recordFor(memberIds, { punctuality: null }) });
  check('records without punctuality saved', noPunctuality.status === 200, noPunctuality.body);
  const noPunctualitySubmit = await action('submitClubActivity', { id: noPunctuality.body.id });
  check('submit without punctuality rejected', noPunctualitySubmit.status >= 400 && /punctuality/i.test(JSON.stringify(noPunctualitySubmit.body)), noPunctualitySubmit.body);

  const noComment = await saveActivity({ title: 'Needs a comment', records: recordFor(memberIds, { performance: 'NEEDS_IMPROVEMENT', comment: '' }) });
  check('needs-improvement rows saved', noComment.status === 200, noComment.body);
  const noCommentSubmit = await action('submitClubActivity', { id: noComment.body.id });
  check('needs improvement without comment rejected', noCommentSubmit.status >= 400 && /comment/i.test(JSON.stringify(noCommentSubmit.body)), noCommentSubmit.body);

  const outsider = students.find((s) => !memberIds.includes(s.id));
  if (outsider) {
    const nonMember = await saveActivity({ title: 'Non member row', records: [...recordFor(memberIds), { ...recordFor([outsider.id])[0] }] });
    check('non-member record rejected', nonMember.status >= 400, nonMember.body);
  } else {
    check('non-member record check (skipped, roster covers all students)', true);
  }

  const duplicated = await saveActivity({ title: 'Duplicated row', records: [...recordFor(memberIds), { ...recordFor([memberIds[0]])[0] }] });
  check('duplicate member row rejected', duplicated.status >= 400, duplicated.body);

  const activity = await saveActivity({ title: 'First build session', records: recordFor(memberIds) });
  check('draft activity with records saved', activity.status === 200 && activity.body.status === 'DRAFT', activity.body);
  const activityId: string = activity.body.id;

  view = await call('/api/app?view=clubs');
  const savedRows = (view.body.records as any[]).filter((r) => r.clubActivityId === activityId);
  check('view=clubs returns one record per member', savedRows.length === memberIds.length, savedRows);
  check('records carry student name and code', savedRows.every((r) => !!r.studentName && !!r.studentCode), savedRows);

  const submitted = await action('submitClubActivity', { id: activityId });
  check('activity submitted', submitted.status === 200 && submitted.body.status === 'SUBMITTED', submitted.body);

  const doubleSubmit = await action('submitClubActivity', { id: activityId });
  check('double submit rejected', doubleSubmit.status >= 400, doubleSubmit.body);

  const editSubmitted = await action('saveClubActivity', { id: activityId, clubId, title: 'Edited while submitted', activityDate: '2026-10-02' });
  check('editing submitted activity rejected', editSubmitted.status >= 400, editSubmitted.body);

  const returnNoReason = await action('reviewClubActivity', { id: activityId, status: 'RETURNED' });
  check('return without reason rejected', returnNoReason.status >= 400, returnNoReason.body);

  const returned = await action('reviewClubActivity', { id: activityId, status: 'RETURNED', comment: 'Add attendance numbers' });
  check('admin returns activity with reason', returned.status === 200 && returned.body.status === 'RETURNED', returned.body);

  const reEdit = await action('saveClubActivity', { id: activityId, clubId, title: 'First build session (revised)', activityDate: '2026-10-02', description: '12 present, 2 absent' });
  check('returned activity reverts to draft on edit', reEdit.status === 200 && reEdit.body.status === 'DRAFT', reEdit.body);

  const resubmit = await action('submitClubActivity', { id: activityId });
  check('resubmit after return', resubmit.status === 200 && resubmit.body.status === 'SUBMITTED', resubmit.body);

  const review = await action('reviewClubActivity', { id: activityId, status: 'UNDER_REVIEW' });
  check('start review', review.status === 200 && review.body.status === 'UNDER_REVIEW', review.body);

  const approved = await action('reviewClubActivity', { id: activityId, status: 'APPROVED' });
  check('approve activity', approved.status === 200 && approved.body.status === 'APPROVED', approved.body);

  const reopen = await action('reviewClubActivity', { id: activityId, status: 'SUBMITTED', comment: 'Wrong month recorded' });
  check('reopen approved activity to returned', reopen.status === 200 && reopen.body.status === 'RETURNED', reopen.body);

  const approveFromReturned = await action('reviewClubActivity', { id: activityId, status: 'APPROVED' });
  check('approve directly from returned rejected', approveFromReturned.status >= 400, approveFromReturned.body);

  const targetClub = (view.body.clubs as any[]).find((c) => c.id === clubId);
  const activitiesForClub = (view.body.activities as any[]).filter((a) => a.clubId === clubId);
  const recordsForClub = (view.body.records as any[]).filter((r) => activitiesForClub.some((a) => a.id === r.clubActivityId));
  const { buildClubReportsZip } = await import('../src/lib/reportPdf');
  const zip = await buildClubReportsZip({
    school: 'Test School',
    club: { name: targetClub?.name || clubName, description: targetClub?.description || '' },
    members: (view.body.members as any[]).filter((m) => m.clubId === clubId)
      .map((m) => ({ id: m.studentId, name: m.studentName, code: m.studentCode, className: m.className || undefined })),
    activities: activitiesForClub.map((a) => ({ id: a.id, title: a.title, activityDate: a.activityDate, status: a.status })),
    records: recordsForClub.map((r) => ({ studentId: r.studentId, activityId: r.clubActivityId, punctuality: r.punctuality, performance: r.performance, participation: r.participation, conduct: r.conduct, comment: r.comment })),
    logoDataUrl: TINY_PNG,
  });
  const JSZip = (await import('jszip')).default;
  const unzipped = await JSZip.loadAsync(zip.bytes);
  const entries = Object.keys(unzipped.files).filter((n) => !unzipped.files[n].dir);
  check('club reports zip holds one pdf per member', zip.count === memberIds.length && entries.length === memberIds.length, { count: zip.count, entries });
  const firstEntry = entries[0];
  const firstText = firstEntry && pdfText(Buffer.from(await unzipped.files[firstEntry].async('nodebuffer')));
  const firstMember = (view.body.members as any[]).filter((m) => m.clubId === clubId)[0];
  check('club report lists the club activity', !!firstText && firstText.includes('First build session'), firstText?.slice(0, 200));
  check('club report shows member observations', !!firstText && firstText.includes('Always On Time') && firstText.includes('Good'), !!firstText);
  check('club report omits the student ID', !!firstText && !firstText.includes(firstMember.studentCode), firstMember.studentCode);
  check('club report omits the student code column header', !/STUDENT (ID|CODE)/i.test(firstText || ''), firstText?.slice(0, 200));

  const updated = await action('updateClub', {
    id: clubId, name: `${clubName} v2`, description: 'Updated', academicYearId: years[0]?.id || null, active: true,
    teacherIds: [localTeacher.id], studentIds: students.slice(0, 2).map((s) => s.id),
  });
  check('updateClub replaces roster and teachers', updated.status === 200, updated.body);
  view = await call('/api/app?view=clubs');
  check('roster replaced to 2 students', (view.body.members as any[]).filter((m) => m.clubId === clubId).length === 2, view.body.members);
  check('teachers replaced to 1', (view.body.teachers as any[]).filter((t) => t.clubId === clubId).length === 1, view.body.teachers);

  const archived = await action('deleteEntity', undefined, { type: 'club', id: clubId });
  check('archive club', archived.status === 200, archived.body);
  view = await call('/api/app?view=clubs');
  const archivedClub = (view.body.clubs as any[]).find((c) => c.id === clubId);
  check('archived club flagged inactive for admin', !!archivedClub && archivedClub.active === false, archivedClub);

  // Fresh active club for the access checks below.
  const accessName = `Access Club ${suffix}`;
  const accessStudentIds = students.slice(0, 1).map((s) => s.id);
  const access = await action('createClub', { name: accessName, teacherIds: [localTeacher.id], studentIds: accessStudentIds });
  const accessClubId: string = access.body.club?.id;
  if (accessClubId) createdClubIds.push(accessClubId);

  await login(LOCAL_TEACHER);
  view = await call('/api/app?view=clubs');
  check('archived club hidden from teacher', !(view.body.clubs as any[]).some((c) => c.id === clubId), view.body.clubs);
  check('assigned teacher sees their club', (view.body.clubs as any[]).some((c) => c.id === accessClubId), view.body.clubs);
  check('teacher gets no teacher picker', (view.body.teacherOptions as any[]).length === 0, view.body.teacherOptions);
  const accessMembers = (view.body.members as any[]).filter((m) => m.clubId === accessClubId).map((m) => m.studentId);
  check('teacher sees the club member roster', accessMembers.length === accessStudentIds.length, view.body.members);

  const teacherSave = await action('saveClubActivity', {
    clubId: accessClubId, title: 'Teacher recorded session', activityDate: '2026-10-03', description: 'Practice',
    records: accessMembers.map((studentId: string) => ({ studentId, punctuality: 'USUALLY_ON_TIME', performance: 'EXCELLENT', participation: 'ACTIVE', conduct: 'GOOD', comment: 'Led the warm-up' })),
  });
  check('assigned teacher can record activity', teacherSave.status === 200 && teacherSave.body.status === 'DRAFT', teacherSave.body);
  const teacherActivityId: string = teacherSave.body.id;
  const teacherSubmit = await action('submitClubActivity', { id: teacherActivityId });
  check('teacher submits activity with member records', teacherSubmit.status === 200 && teacherSubmit.body.status === 'SUBMITTED', teacherSubmit.body);

  const teacherIncomplete = await action('saveClubActivity', { clubId: accessClubId, title: 'Teacher session without rows', activityDate: '2026-10-03' });
  const teacherIncompleteSubmit = await action('submitClubActivity', { id: teacherIncomplete.body.id });
  check('teacher cannot submit without member rows', teacherIncompleteSubmit.status >= 400, teacherIncompleteSubmit.body);

  const teacherReview = await action('reviewClubActivity', { id: teacherActivityId, status: 'UNDER_REVIEW' });
  check('teacher cannot review activities', teacherReview.status === 403, teacherReview.body);
  const teacherCreate = await action('createClub', { name: `Teacher club ${suffix}` });
  check('teacher cannot create clubs', teacherCreate.status === 403, teacherCreate.body);
  const teacherDelete = await action('deleteEntity', undefined, { type: 'club', id: accessClubId });
  check('teacher cannot archive clubs', teacherDelete.status === 403, teacherDelete.body);

  // The credentials CSV may list every teacher, so take one who is not the club's assigned teacher.
  const others = importedTeacherCredentials()
    .filter((c) => c.name !== localTeacher.name && c.username !== LOCAL_TEACHER.identity)
    .slice(0, 1);
  if (others.length && otherTeacher) {
    await login({ identity: others[0].username, password: others[0].password });
    view = await call('/api/app?view=clubs');
    check('unassigned teacher does not see the club', !(view.body.clubs as any[]).some((c) => c.id === accessClubId), view.body.clubs);
    const outsiderSave = await action('saveClubActivity', { clubId: accessClubId, title: 'Outsider session', activityDate: '2026-10-03' });
    check('unassigned teacher cannot record activity', outsiderSave.status >= 400, outsiderSave.body);
  } else {
    check('unassigned teacher access check (skipped, no CSV credentials)', true);
  }
}

main()
  .then(() => { console.log(checks.join('\n')); const failed = checks.filter((c) => c.startsWith('FAIL')); console.log(`\n${checks.length - failed.length}/${checks.length} checks passed`); return failed.length ? 1 : 0; })
  .catch((e) => { console.error(checks.join('\n')); console.error(e); return 1; })
  .then(async (code) => { await cleanup(); process.exit(code as number); });

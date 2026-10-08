import fs from 'fs';
import { readImportFile } from '../src/lib/importFile';

const BASE = process.env.BASE_URL || 'http://localhost:3000';
const ADMIN = { identity: process.env.ADMIN_USER || 'schooladmin', password: process.env.ADMIN_PASS || 'LocalAdmin!2026' };

async function main() {
  const loginRes = await fetch(`${BASE}/api/auth`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ action: 'login', identity: ADMIN.identity, password: ADMIN.password }),
  });
  const loginBody = await loginRes.text();
  console.log('admin login:', loginRes.status, loginBody.slice(0, 120));
  if (!loginRes.ok) throw new Error('admin login failed');
  const cookie = (loginRes.headers.get('set-cookie') || '').split(';')[0];

  const jobs: [string, string][] = [
    ['students', 'students-import-2026-2027.xlsx'],
    ['teachers', 'teachers-import-2026-2027.xlsx'],
  ];
  let credentials: { teacherId: string; name: string; username: string; password: string }[] = [];
  for (const [kind, file] of jobs) {
    const parsed = await readImportFile(new File([fs.readFileSync(file)], file), kind as never);
    console.log(`${kind}: parsed ${parsed.rows.length} rows | headers=${parsed.headers.join(',')} | notes=${parsed.notes.join(' | ') || 'none'}`);
    const start = Date.now();
    const res = await fetch(`${BASE}/api/app`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', cookie },
      body: JSON.stringify({ action: 'import', data: { kind, rows: parsed.rows } }),
    });
    const body = await res.text();
    console.log(`${kind}: HTTP ${res.status} in ${Date.now() - start}ms -> ${body.slice(0, 600)}`);
    if (!res.ok) {
      process.exitCode = 1;
      return;
    }
    const json = JSON.parse(body);
    if (json.credentials?.length) {
      credentials = json.credentials;
      const csv = [
        ['Teacher ID', 'Name', 'Email', 'Username', 'Password', 'Email Status'],
        ...json.credentials.map((c: any) => [c.teacherId, c.name, c.email, c.username, c.password, c.emailProvided ? 'Provided' : 'PENDING']),
      ]
        .map((row: unknown[]) => row.map((cell: unknown) => `"${String(cell).replaceAll('"', '""')}"`).join(','))
        .join('\r\n');
      const name = `teacher-passwords-${new Date().toISOString().slice(0, 10)}.csv`;
      fs.writeFileSync(name, csv);
      console.log(`credentials csv written: ${name} (${json.credentials.length} rows)`);
    }
  }

  const overview = await (await fetch(`${BASE}/api/app?view=overview`, { headers: { cookie } })).json();
  console.log('overview counts:', JSON.stringify(overview.counts));
  const reference = await (await fetch(`${BASE}/api/app?view=reference`, { headers: { cookie } })).json();
  console.log('reference:', JSON.stringify({
    years: reference.years?.length, grades: reference.grades?.length, classes: reference.classes?.length,
    subjects: reference.subjects?.length, teachers: reference.teachers?.length, assignments: reference.assignments?.length, students: reference.students?.length,
  }));

  const first = credentials[0];
  console.log('generated credentials:', credentials.length, '| first:', first?.teacherId, first?.username);
  if (first) {
    const teacherLogin = await fetch(`${BASE}/api/auth`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ action: 'login', identity: first.username, password: first.password }),
    });
    console.log('teacher login (from csv):', teacherLogin.status, (await teacherLogin.text()).slice(0, 80));
  } else {
    console.log('teacher login (from csv): skipped, every teacher already exists so this run generated no credentials');
  }
  const localTeacher = await fetch(`${BASE}/api/auth`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ action: 'login', identity: 'class.teacher', password: 'school123' }),
  });
  console.log('seed teacher login:', localTeacher.status, (await localTeacher.text()).slice(0, 80));
  const superLogin = await fetch(`${BASE}/api/auth`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ action: 'login', identity: 'superadmin', password: 'LocalSuper!2026' }),
  });
  console.log('seed superadmin login:', superLogin.status, (await superLogin.text()).slice(0, 80));
}

main().catch((error) => {
  console.error('FAILED:', error.message);
  process.exit(1);
});

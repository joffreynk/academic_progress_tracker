import 'dotenv/config';
import fs from 'fs';
import path from 'path';
import { randomBytes } from 'crypto';
import { readImportFile } from '../src/lib/importFile';

// One-shot provisioning for a fresh deployment: first-time setup, organization,
// primary admin, then the two bulk import workbooks. Configuration comes from the
// environment; passwords are generated here and printed once at the end.

const BASE = process.env.PROD_URL ?? 'https://student.reporting2.workers.dev';
const SETUP_TOKEN = process.env.SETUP_TOKEN ?? '';
const ORG = {
  name: process.env.ORG_NAME ?? 'Maarif International Schools',
  code: process.env.ORG_CODE ?? 'MIS',
  timezone: process.env.ORG_TIMEZONE ?? 'Africa/Bujumbura',
  domain: process.env.ORG_DOMAIN ?? 'bi.maarifschools.org',
  logoUrl: process.env.ORG_LOGO ?? '/icons/school_logo.png',
};
const MANAGER = {
  name: process.env.MANAGER_NAME ?? 'Joffrey ICT',
  username: process.env.MANAGER_USERNAME ?? 'joffreyict',
  email: process.env.MANAGER_EMAIL ?? 'joffreyict@gmail.com',
};
const ADMIN = {
  name: process.env.ADMIN_NAME ?? 'Joffrey',
  username: process.env.ADMIN_USERNAME ?? 'joffrey',
  email: process.env.ADMIN_EMAIL ?? 'ict@bi.maarifschools.org',
};
const STUDENTS_FILE = process.env.STUDENTS_FILE ?? 'students-import-2026-2027.xlsx';
const TEACHERS_FILE = process.env.TEACHERS_FILE ?? 'teachers-import-2026-2027.xlsx';

let cookie = '';

function randomPassword(): string {
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789';
  const bytes = randomBytes(22);
  return Array.from(bytes, (b) => alphabet[b % alphabet.length]).join('') + '!7a';
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

// Workers count a cold start against a tight per-request CPU budget, so every request first
// touches the cheap endpoints to load the route modules in the same isolate.
const warm = async () => {
  for (const path of ['/api/health', '/api/auth', '/api/app?view=overview']) {
    try {
      await fetch(`${BASE}${path}`);
    } catch {
      /* warming is best effort */
    }
  }
};

async function req(url: string, init: RequestInit = {}, attempts = 5): Promise<any> {
  let lastError: unknown;
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      const res = await fetch(url, {
        ...init,
        headers: { 'Content-Type': 'application/json', ...(cookie ? { cookie } : {}), ...((init.headers as object) || {}) },
      });
      const setCookie = res.headers.get('set-cookie');
      if (setCookie) cookie = setCookie.split(';')[0];
      const text = await res.text();
      let body: any = {};
      try {
        body = JSON.parse(text);
      } catch {
        body = { raw: text };
      }
      if (!res.ok) {
        const error: any = new Error(`${init.method || 'GET'} ${url} -> ${res.status}: ${body.error || text.slice(0, 240)}`);
        error.status = res.status;
        throw error;
      }
      return body;
    } catch (error: any) {
      lastError = error;
      if (error.status !== 503 || attempt === attempts) throw error;
      await warm();
      await sleep(700 * attempt);
    }
  }
  throw lastError;
}

const post = (url: string, payload: unknown) => req(url, { method: 'POST', body: JSON.stringify(payload) });
const login = (identity: string, password: string) => post(`${BASE}/api/auth`, { action: 'login', identity, password });
const app = (action: string, data: unknown) => post(`${BASE}/api/app`, { action, data });

async function readRows(file: string, kind: 'students' | 'teachers') {
  const abs = path.resolve(file);
  if (!fs.existsSync(abs)) throw new Error(`Missing file: ${abs}`);
  const parsed = await readImportFile(new File([new Uint8Array(fs.readFileSync(abs))], path.basename(abs)), kind);
  return parsed.rows;
}

async function main() {
  const managerPassword = process.env.MANAGER_PASSWORD || randomPassword();
  const adminPassword = process.env.ADMIN_PASSWORD || randomPassword();
  const log = (...args: unknown[]) => console.log(...args);

  // 1. First-time setup (falls back to a normal sign-in if it already ran).
  try {
    await post(`${BASE}/api/auth`, {
      action: 'setup',
      setupToken: SETUP_TOKEN,
      ...MANAGER,
      password: managerPassword,
    });
    log('Platform manager created through first-time setup.');
  } catch (error: any) {
    if (!String(error.message).includes('already been completed')) throw error;
    log('Setup already completed; signing in as the platform manager.');
    await login(MANAGER.username, managerPassword);
  }

  // 2. Organization.
  const listed = async () => (await req(`${BASE}/api/app?view=organizations`)).organizations || [];
  let org = (await listed()).find((o: any) => o.code === ORG.code.toUpperCase());
  if (org) {
    log(`Organization already exists: ${org.name} (${org.code}).`);
  } else {
    await app('organization', ORG);
    org = (await listed()).find((o: any) => o.code === ORG.code.toUpperCase());
    if (!org) throw new Error('Organization was not created.');
    log(`Organization created: ${org.name} (${org.code}) ${org.id}`);
  }

  // 3. Primary administrator of the organization (reset the password if one already exists).
  if (org.primaryAdminUserId) {
    await app('resetAdmin', { organizationId: org.id, password: adminPassword });
    log(`Administrator password reset: ${ADMIN.username} <${ADMIN.email}>`);
  } else {
    await app('admin', { organizationId: org.id, ...ADMIN, password: adminPassword });
    log(`Administrator created: ${ADMIN.username} <${ADMIN.email}>`);
  }

  // 4. Sign in as the administrator and run the bulk imports (students first).
  await login(ADMIN.username, adminPassword);

  const studentRows = await readRows(STUDENTS_FILE, 'students');
  const studentsResult = await app('import', { kind: 'students', rows: studentRows });
  log('Students import:', JSON.stringify({ imported: studentsResult.imported, updated: studentsResult.updated, skipped: studentsResult.skipped, created: studentsResult.created }));

  const teacherRows = await readRows(TEACHERS_FILE, 'teachers');
  const chunkSize = Number(process.env.TEACHER_CHUNK || 4);
  const teacherTotals = { imported: 0, updated: 0, skipped: 0, assignmentsCreated: 0, assignmentsUpdated: 0, credentials: [] as any[] };
  const sendChunk = async (chunk: any[]) => {
    const started = Date.now();
    const part: any = await app('import', { kind: 'teachers', rows: chunk });
    teacherTotals.imported += part.imported ?? 0;
    teacherTotals.updated += part.updated ?? 0;
    teacherTotals.skipped += part.skipped ?? 0;
    teacherTotals.assignmentsCreated += part.assignments?.created ?? 0;
    teacherTotals.assignmentsUpdated += part.assignments?.updated ?? 0;
    teacherTotals.credentials.push(...(part.credentials ?? []));
    log(
      `Teachers rows ${chunk[0]?.['Teacher ID'] ?? '?'}-${chunk[chunk.length - 1]?.['Teacher ID'] ?? '?'}: +${part.imported ?? 0} created, ${
        part.updated ?? 0
      } updated, ${part.assignments?.created ?? 0} assignments (${Date.now() - started} ms)`
    );
  };
  const importRows = async (rows: any[]): Promise<void> => {
    for (let attempt = 1; attempt <= 3; attempt += 1) {
      try {
        await warm();
        await sendChunk(rows);
        return;
      } catch (error: any) {
        log(`Chunk of ${rows.length} row(s) failed (attempt ${attempt}/3): ${String(error.message).slice(0, 70)}`);
        if (attempt < 3) {
          await sleep(600 * attempt);
          continue;
        }
        if (rows.length === 1) throw error;
      }
    }
    const middle = Math.ceil(rows.length / 2);
    await importRows(rows.slice(0, middle));
    await importRows(rows.slice(middle));
  };
  for (let i = 0; i < teacherRows.length; i += chunkSize) await importRows(teacherRows.slice(i, i + chunkSize));
  const teachersResult = teacherTotals;
  log(
    'Teachers import:',
    JSON.stringify({
      imported: teachersResult.imported,
      updated: teachersResult.updated,
      skipped: teachersResult.skipped,
      assignments: { created: teachersResult.assignmentsCreated, updated: teachersResult.assignmentsUpdated },
      generatedPasswords: teachersResult.credentials.length,
    })
  );
  if (teachersResult.credentials.length) {
    const file = `teacher-passwords-${new Date().toISOString().slice(0, 10)}.csv`;
    const csv = [
      ['Teacher ID', 'Name', 'Email', 'Username', 'Password', 'Email Status'],
      ...teachersResult.credentials.map((c: any) => [c.teacherId, c.name, c.email, c.username, c.password, c.emailProvided ? 'Provided' : 'PENDING']),
    ]
      .map((row) => row.map((cell: unknown) => `"${String(cell).replaceAll('"', '""')}"`).join(','))
      .join('\r\n');
    fs.writeFileSync(path.resolve(file), csv);
    log(`Credentials CSV written to ${file} (${teachersResult.credentials.length} teachers).`);

    // Attach the generated credentials to the teachers workbook itself.
    try {
      const { cellText } = await import('../src/lib/importing');
      const Excel = (await import('exceljs')).default;
      const workbookPath = path.resolve(TEACHERS_FILE);
      const book = new Excel.Workbook();
      await book.xlsx.readFile(workbookPath);
      // The workbook carries a "READ ME" sheet first: pick the roster sheet by its header row.
      let sheet: import('exceljs').Worksheet | undefined;
      let headers: string[] = [];
      let maxColumn = 0;
      book.eachSheet((candidate) => {
        if (sheet) return;
        const candidateHeaders: string[] = [];
        let candidateMax = 0;
        candidate.getRow(1).eachCell({ includeEmpty: true }, (cell, column) => {
          candidateHeaders[column] = cellText(cell.value as never) || '';
          candidateMax = Math.max(candidateMax, column);
        });
        const index = (name: string) => {
          for (let column = 1; column <= candidateMax; column += 1) {
            if ((candidateHeaders[column] || '').trim().toLowerCase() === name) return column;
          }
          return 0;
        };
        if (index('email') && (index('no') || index('teacher id'))) {
          sheet = candidate;
          headers = candidateHeaders;
          maxColumn = candidateMax;
        }
      });
      if (!sheet) throw new Error('Teachers worksheet not found (expected NO/NAME/SURNAME/EMAIL headers).');
      const roster = sheet;
      const headerIndex = (match: (header: string) => boolean) => {
        for (let column = 1; column <= maxColumn; column += 1) if (match((headers[column] || '').trim())) return column;
        return 0;
      };
      const emailColumn = headerIndex((h) => h.toLowerCase() === 'email');
      const idColumn = headerIndex((h) => ['no', 'teacher id', 'id', 'code'].includes(h.toLowerCase()));
      const headerRow = roster.getRow(1);
      let usernameColumn = headerIndex((h) => h.toLowerCase() === 'username');
      let passwordColumn = headerIndex((h) => h.toLowerCase() === 'password');
      let nextColumn = maxColumn + 1;
      if (!usernameColumn) { usernameColumn = nextColumn; nextColumn += 1; }
      if (!passwordColumn) { passwordColumn = nextColumn; nextColumn += 1; }
      headerRow.getCell(usernameColumn).value = 'Username';
      headerRow.getCell(passwordColumn).value = 'Password';
      headerRow.commit();
      const byEmail = new Map(teachersResult.credentials.map((c: any) => [String(c.email || '').trim().toLowerCase(), c]));
      const byId = new Map(teachersResult.credentials.map((c: any) => [String(c.teacherId || '').trim(), c]));
      let attached = 0;
      for (let r = 2; r <= roster.rowCount; r += 1) {
        const row = roster.getRow(r);
        const email = emailColumn ? cellText(row.getCell(emailColumn).value as never).toLowerCase() : '';
        const teacherId = idColumn ? cellText(row.getCell(idColumn).value as never).trim() : '';
        const credential = (email && byEmail.get(email)) || (teacherId && byId.get(teacherId));
        if (!credential) continue;
        row.getCell(usernameColumn).value = credential.username;
        row.getCell(passwordColumn).value = credential.password;
        row.commit();
        attached += 1;
      }
      await book.xlsx.writeFile(workbookPath);
      log(`Username and password attached to ${TEACHERS_FILE} (${attached} rows).`);
    } catch (error: any) {
      log(`Could not write credentials into ${TEACHERS_FILE}: ${error.message}`);
    }
  }

  console.log(
    JSON.stringify(
      {
        url: BASE,
        organization: { name: org.name, code: org.code, id: org.id },
        platformManager: { ...MANAGER, password: managerPassword, role: 'SUPER_ADMIN' },
        administrator: { ...ADMIN, password: adminPassword, role: 'ADMIN' },
        students: { imported: studentsResult.imported, updated: studentsResult.updated, skipped: studentsResult.skipped },
        teachers: { imported: teachersResult.imported, updated: teachersResult.updated, skipped: teachersResult.skipped, assignments: { created: teachersResult.assignmentsCreated, updated: teachersResult.assignmentsUpdated } },
        generatedTeacherPasswords: teachersResult.credentials?.length ?? 0,
      },
      null,
      2
    )
  );
}

main().catch((error) => {
  console.error('PROVISIONING FAILED:', error.message);
  process.exit(1);
});

import 'dotenv/config';
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import Excel from 'exceljs';
import { hash } from 'bcryptjs';
import { eq } from 'drizzle-orm';
import { db } from '../src/db';
import { users, teachers } from '../src/db/schema';
import { usernameFromName, toCsv } from '../src/lib/importing';
import { initialTeacherPassword } from '../src/lib/passwordSchema';

/**
 * Teacher credential cut-over (every teacher in the database).
 *
 * For each teacher row: the sign-in username becomes the roster NAME column in lowercase
 * (a numeric suffix breaks collisions; teachers absent from the roster fall back to their own
 * name), and the password becomes the small shared initial password (TEACHER_INITIAL_PASSWORD,
 * default "school123"). Teachers replace it themselves from Change Password after signing in.
 *
 * Modes:
 *   default                        apply to DATABASE_URL, write teacher-passwords-<date>.csv
 *                                   and write the Username/Password columns back into the roster
 *                                   workbook
 *   --dry-run                      show the changes, write nothing
 *   --sql                          print UPDATE statements keyed on teachers.teacher_id (the key
 *                                   that survives across environments) for the remote database:
 *       npx tsx scripts/set-teacher-credentials.ts --sql > teacher-credentials.sql
 *       npx wrangler d1 execute student-academic-reporting-db --remote --file teacher-credentials.sql
 *
 * Existing sessions are kept: teachers already signed in stay signed in.
 *
 * RESERVED_USERNAMES=admin1,admin2 keeps those names free in environments where the administrator
 * accounts are not visible to the database being read (production admins differ from local ones).
 */

const FILE = process.env.TEACHERS_FILE || 'teachers-import-2026-2027.xlsx';
const SHEET = process.env.TEACHERS_SHEET || 'Teachers';
const DRY_RUN = process.argv.includes('--dry-run');
const SQL_MODE = process.argv.includes('--sql');
const log = (...args: unknown[]) => (SQL_MODE ? console.error(...args) : console.log(...args));

type RosterRow = { rowNumber: number; teacherId: string; name: string; surname: string; email: string };
type Change = { userId: string; teacherId: string; name: string; email: string; username: string; password: string; passwordHash: string; rosterRow?: number };

async function readRoster(): Promise<{ rows: RosterRow[]; skipped: number }> {
  const book = new Excel.Workbook();
  await book.xlsx.readFile(FILE);
  const sheet = book.getWorksheet(SHEET);
  if (!sheet) throw new Error(`Sheet "${SHEET}" not found in ${FILE}.`);
  const header: Record<string, number> = {};
  sheet.getRow(1).eachCell((cell, col) => {
    header[String(cell.value ?? '').trim().toUpperCase()] = col;
  });
  if (!('NAME' in header)) throw new Error(`${FILE} is missing the NAME column.`);
  const cell = (row: Excel.Row, key: string) => {
    const col = header[key];
    return col ? String(row.getCell(col).value ?? '').trim() : '';
  };
  const rows: RosterRow[] = [];
  let skipped = 0;
  sheet.eachRow({ includeEmpty: false }, (row, rn) => {
    if (rn === 1) return;
    const name = cell(row, 'NAME');
    if (!name) {
      if (cell(row, 'SURNAME') || cell(row, 'EMAIL')) skipped++;
      return;
    }
    rows.push({
      rowNumber: rn,
      teacherId: cell(row, 'NO') || cell(row, 'TEACHER ID') || cell(row, 'ID'),
      name,
      surname: cell(row, 'SURNAME'),
      email: cell(row, 'EMAIL').toLowerCase(),
    });
  });
  return { rows, skipped };
}

// Writes the credentials back into the roster workbook so the sheet always carries the
// usernames and initial passwords the database accepts.
async function writeWorkbook(changes: Change[]): Promise<void> {
  const book = new Excel.Workbook();
  await book.xlsx.readFile(FILE);
  const sheet = book.getWorksheet(SHEET);
  if (!sheet) throw new Error(`Sheet "${SHEET}" not found in ${FILE}.`);
  const header = sheet.getRow(1);
  const headerIndex: Record<string, number> = {};
  header.eachCell((cell, col) => {
    headerIndex[String(cell.value ?? '').trim().toUpperCase()] = col;
  });
  let userCol = headerIndex['USERNAME'];
  let passCol = headerIndex['PASSWORD'];
  if (!userCol) { userCol = header.cellCount + 1; header.getCell(userCol).value = 'Username'; }
  if (!passCol) { passCol = header.cellCount + 1; if (passCol === userCol) passCol += 1; header.getCell(passCol).value = 'Password'; }
  for (const c of changes) {
    if (!c.rosterRow) continue;
    sheet.getRow(c.rosterRow).getCell(userCol).value = c.username;
    sheet.getRow(c.rosterRow).getCell(passCol).value = c.password;
  }
  await book.xlsx.writeFile(FILE);
}

const sqlValue = (value: string) => `'${value.replace(/'/g, "''")}'`;

async function main() {
  const { rows: roster, skipped } = await readRoster();
  const password = initialTeacherPassword();

  const allUsers = await db.select({ id: users.id, username: users.username }).from(users);
  const usernameOwner = new Map(allUsers.map((u) => [u.username, u.id]));
  const teacherRows = await db
    .select({ id: teachers.id, userId: teachers.userId, teacherId: teachers.teacherId, email: teachers.email, name: teachers.name })
    .from(teachers);
  const byCode = new Map(roster.filter((r) => r.teacherId).map((r) => [r.teacherId, r]));
  const byEmail = new Map(roster.filter((r) => r.email).map((r) => [r.email, r]));

  const claimed = new Set<string>();
  // Account names that must stay free even when the database being read cannot see them
  // (the deployed database has administrator accounts the local one does not):
  //   RESERVED_USERNAMES=joffrey,joffreyict npx tsx scripts/set-teacher-credentials.ts
  for (const reserved of (process.env.RESERVED_USERNAMES || '').split(',').map((s) => s.trim().toLowerCase()).filter(Boolean)) claimed.add(reserved);
  const matchedRoster = new Set<number>();
  const changes: Change[] = [];
  const rosterWithoutTeacher: string[] = [];

  for (const t of teacherRows) {
    const row = byCode.get(t.teacherId) || (t.email ? byEmail.get(t.email.toLowerCase()) : undefined);
    if (row) matchedRoster.add(row.rowNumber);

    const root = usernameFromName(row?.name || t.name) || `t${t.teacherId || t.id.slice(0, 6)}`;
    let candidate = root;
    for (let n = 2; ; n++) {
      const owner = usernameOwner.get(candidate);
      if (!claimed.has(candidate) && (owner === undefined || owner === t.userId)) break;
      candidate = `${root}${n}`;
    }
    claimed.add(candidate);

    const passwordHash = await hash(password, 8);
    changes.push({
      userId: t.userId,
      teacherId: t.teacherId,
      name: row ? `${row.name} ${row.surname}`.trim() || t.name : t.name,
      email: row?.email || t.email,
      username: candidate,
      password,
      passwordHash,
      rosterRow: row?.rowNumber,
    });
    if (!SQL_MODE && !DRY_RUN) {
      await db.update(users).set({ username: candidate, passwordHash, updatedAt: new Date() }).where(eq(users.id, t.userId));
      const newEmail = row?.email;
      if (newEmail && newEmail !== t.email) await db.update(teachers).set({ email: newEmail, updatedAt: new Date() }).where(eq(teachers.id, t.id));
    }
  }

  for (const r of roster) if (!matchedRoster.has(r.rowNumber)) rosterWithoutTeacher.push(`${r.teacherId || '?'} ${r.name} ${r.surname}`.trim());

  if (SQL_MODE) {
    const now = Math.floor(Date.now() / 1000);
    const statements = changes.map(
      (c) =>
        `UPDATE users SET username=${sqlValue(c.username)}, password_hash=${sqlValue(c.passwordHash)}, updated_at=${now} WHERE id = (SELECT user_id FROM teachers WHERE teacher_id=${sqlValue(c.teacherId)} LIMIT 1);`
    );
    // Written here as UTF-8: shell redirection on Windows emits UTF-16, which D1 cannot ingest.
    const sqlPath = join(process.cwd(), 'teacher-credentials.sql');
    writeFileSync(
      sqlPath,
      [
        `-- ${changes.length} teacher accounts, initial password ${password}`,
        ...statements,
        ...(rosterWithoutTeacher.length ? [`-- roster rows with no teacher account (${rosterWithoutTeacher.length}): ${rosterWithoutTeacher.join(' | ')}`] : []),
        ...(skipped ? [`-- skipped ${skipped} roster row(s) without a NAME value`] : []),
      ].join('\n'),
      'utf8'
    );
    console.log(statements.join('\n'));
    log(`-- ${changes.length} teacher accounts, initial password ${password}`);
    log(`sql file: ${sqlPath}`);
    if (rosterWithoutTeacher.length) log(`-- roster rows with no teacher account (${rosterWithoutTeacher.length}): ${rosterWithoutTeacher.join(' | ')}`);
    if (skipped) log(`-- skipped ${skipped} roster row(s) without a NAME value`);
    return;
  }

  const csvPath = join(process.cwd(), `teacher-passwords-${new Date().toISOString().slice(0, 10)}.csv`);
  const csv = toCsv(
    ['Teacher ID', 'Name', 'Email', 'Username', 'Password'],
    changes.map((c) => ({ 'Teacher ID': c.teacherId, Name: c.name, Email: c.email, Username: c.username, Password: c.password }))
  );
  if (!DRY_RUN) {
    writeFileSync(csvPath, csv, 'utf8');
    await writeWorkbook(changes);
  }

  log(`${DRY_RUN ? '[dry-run] ' : ''}teachers in the database: ${teacherRows.length}`);
  log(`${DRY_RUN ? '[dry-run] ' : ''}credentials updated: ${changes.length}${roster.length ? ` (roster rows matched: ${matchedRoster.size}/${roster.length}${skipped ? `, ${skipped} without a NAME` : ''})` : ''}`);
  if (changes.length) console.table(changes.map((c) => ({ Teacher: c.name, Username: c.username, Password: c.password })));
  if (rosterWithoutTeacher.length) log(`roster rows with no teacher account (${rosterWithoutTeacher.length}): ${rosterWithoutTeacher.join(' | ')}`);
  if (!DRY_RUN) {
    log(`credentials CSV: ${csvPath}`);
    log(`workbook updated: ${FILE}`);
  }
  log(`initial password: ${password}${process.env.TEACHER_INITIAL_PASSWORD ? ' (TEACHER_INITIAL_PASSWORD)' : ' (default)'} — teachers replace it from Change Password.`);
}

main()
  .then(() => process.exit(0))
  .catch((e) => {
    console.error(e);
    process.exit(1);
  });

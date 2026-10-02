import Excel from 'exceljs';
import {
  academicYearFromFileName,
  buildStudentImportRows,
  buildTeacherImportRows,
  canonicalSubjectName,
  cellText,
  norm,
  type SheetData,
} from '../src/lib/importing';

const STUDENTS_IN = 'List of students 2026-2027.xlsx';
const TEACHERS_IN = 'LIST OF TEACHERS 2026-2027.xlsx';
const STUDENTS_OUT = 'students-import-2026-2027.xlsx';
const TEACHERS_OUT = 'teachers-import-2026-2027.xlsx';

const readSheets = async (path: string): Promise<SheetData[]> => {
  const book = new Excel.Workbook();
  await book.xlsx.readFile(path);
  const sheets: SheetData[] = [];
  book.eachSheet((sheet) => {
    const rows: string[][] = [];
    sheet.eachRow({ includeEmpty: false }, (row) => {
      const values: string[] = [];
      for (let column = 1; column <= sheet.columnCount; column++) values.push(cellText(row.getCell(column).value));
      if (values.some((value) => value)) rows.push(values);
    });
    sheets.push({ name: sheet.name, rows });
  });
  return sheets;
};

const hasHeader = (row: string[], labels: string[]) => labels.every((label) => row.some((cell) => norm(cell) === label));

const titleCase = (value: string) =>
  value
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .replace(/(^|[\s'-])([a-z])/g, (_m, lead: string, letter: string) => `${lead}${letter.toUpperCase()}`)
    .trim();

type StudentSheet = { name: string; rows: string[][] };

// One clean No | Name | Surname | Year table per class sheet (both side-by-side blocks kept).
const extractStudentSheets = (sheets: SheetData[]): StudentSheet[] => {
  const out: StudentSheet[] = [];
  for (const sheet of sheets) {
    if (/^mp/i.test(sheet.name.trim())) continue;
    const data = sheet.rows;
    const headerIndexes: number[] = [];
    data.forEach((row, index) => {
      if (hasHeader(row, ['no', 'name', 'surname'])) headerIndexes.push(index);
    });
    if (!headerIndexes.length) continue;

    const rows: string[][] = [];
    for (const headerIndex of headerIndexes) {
      const header = data[headerIndex];
      const starts: number[] = [];
      header.forEach((cell, index) => {
        if (norm(cell) === 'no' && norm(header[index + 1]) === 'name') starts.push(index);
      });
      for (const start of starts) {
        for (let i = headerIndex + 1; i < data.length; i++) {
          const row = data[i];
          if (hasHeader(row, ['no', 'name', 'surname'])) break;
          const no = (row[start] || '').trim();
          const name = (row[start + 1] || '').trim();
          const surname = (row[start + 2] || '').trim();
          const year = (row[start + 3] || '').trim() || sheet.name.trim();
          if (!no && !name && !surname) continue;
          if (!name && !surname) continue;
          rows.push([no, name, surname, year]);
        }
      }
    }
    if (rows.length) out.push({ name: sheet.name.trim(), rows });
  }
  return out;
};

const splitList = (value: string) =>
  value
    .split(/[,;/]+/)
    .map((part) => part.trim())
    .filter(Boolean);

const writeReadMe = (book: Excel.Workbook, lines: string[]) => {
  const sheet = book.addWorksheet('READ ME');
  lines.forEach((line, index) => {
    sheet.getCell(index + 1, 1).value = line;
  });
  sheet.getColumn(1).width = 118;
};

async function buildStudents() {
  const parsed = await readSheets(STUDENTS_IN);
  const classSheets = extractStudentSheets(parsed);
  const book = new Excel.Workbook();
  writeReadMe(book, [
    'STUDENTS UPLOAD - ready to import (academic year taken from this file name)',
    '',
    `File name: ${STUDENTS_OUT}  ->  academic year ${academicYearFromFileName(STUDENTS_OUT)}`,
    '',
    'How it works:',
    '1. Every sheet except this one holds one class with the header row: No | Name | Surname | Year.',
    '2. Year holds the class code (7A, 10, 5). The grade is derived from it: 7A -> Grade 7, 10 -> Grade 10.',
    '3. Student ID is generated as <Year>-<Class>-<No>, so No only needs to be unique inside its class.',
    '4. The import creates any missing academic year, grade and class automatically.',
    '5. Re-uploading the same file updates the existing students instead of duplicating them.',
    '6. MP (pre-school) sheets were removed from this workbook - add them back only if you want them imported.',
    '7. Upload this file first, then upload the teachers file so assignments land in the same academic year.',
    '',
    'Do not rename the header cells and keep one class per sheet.',
    '',
    'Classes in this file:',
  ]);
  const summary = book.getWorksheet('READ ME')!;
  classSheets.forEach((sheet, index) => {
    summary.getCell(17 + index, 1).value = `  ${sheet.name}: ${sheet.rows.length} students`;
  });

  for (const sheet of classSheets) {
    const ws = book.addWorksheet(sheet.name.slice(0, 31));
    ws.addRow(['No', 'Name', 'Surname', 'Year']);
    for (const row of sheet.rows) ws.addRow(row);
    ws.getRow(1).font = { bold: true };
    ws.columns = [{ width: 6 }, { width: 22 }, { width: 26 }, { width: 10 }];
  }

  await book.xlsx.writeFile(STUDENTS_OUT);
  return classSheets;
}

async function buildTeachers() {
  const parsed = await readSheets(TEACHERS_IN);
  let roster: ReturnType<typeof buildTeacherImportRows> | null = null;
  for (const sheet of parsed) {
    try {
      roster = buildTeacherImportRows(sheet.rows);
      break;
    } catch {
      /* try the next sheet */
    }
  }
  if (!roster) throw new Error('No teacher roster found in the source workbook.');

  const book = new Excel.Workbook();
  writeReadMe(book, [
    'TEACHERS UPLOAD - ready to import (teachers, subjects, classes and teaching assignments in one file)',
    '',
    `File name: ${TEACHERS_OUT}`,
    '',
    'How it works:',
    '1. One row per teacher: NO | NAME | SURNAME | CONTACT DETAIL | NATIONALITY | EMAIL | SUBJECTS | CLASSES',
    '2. SUBJECTS and CLASSES are comma separated. Every value becomes a teaching assignment in the active year.',
    '3. Subject codes were expanded to full names (BIO -> Biology, MATHS -> Mathematics, GC -> Global Citizenship).',
    '4. Bare class codes such as 7, 8, 9 are assigned to every section of that grade (7A, 7B, ...).',
    '5. Missing subjects and classes are created during the import; missing grades/classes for students are too.',
    '6. Teachers without an email get a pending login address and sign in with the generated username.',
    '7. After the upload the passwords CSV downloads automatically - distribute it securely, then delete it.',
    '8. Teachers listed with no SUBJECTS or CLASSES still get a login; they simply have no assignments yet.',
    '9. Upload the students file first so this file attaches its assignments to that academic year.',
    '',
    `Teachers: ${roster.rows.length}`,
  ]);

  const ws = book.addWorksheet('Teachers');
  ws.addRow(['NO', 'NAME', 'SURNAME', 'CONTACT DETAIL', 'NATIONALITY', 'EMAIL', 'SUBJECTS', 'CLASSES']);
  for (const row of roster.rows) {
    const fullName = row['Teacher Name'].trim();
    const space = fullName.indexOf(' ');
    const first = space > 0 ? fullName.slice(0, space) : fullName;
    const last = space > 0 ? fullName.slice(space + 1) : '';
    ws.addRow([
      row['Teacher ID'],
      first,
      last,
      row['Contact Detail'],
      row['Nationality'],
      row['Email'].toLowerCase(),
      splitList(row['Subjects'])
        .map((subject) => canonicalSubjectName(subject) || titleCase(subject))
        .join(', '),
      splitList(row['Classes']).join(', '),
    ]);
  }
  ws.getRow(1).font = { bold: true };
  ws.columns = [{ width: 6 }, { width: 16 }, { width: 24 }, { width: 20 }, { width: 14 }, { width: 44 }, { width: 46 }, { width: 30 }];

  await book.xlsx.writeFile(TEACHERS_OUT);
  return roster;
}

async function main() {
  const classSheets = await buildStudents();
  const roster = await buildTeachers();

  const studentCount = classSheets.reduce((total, sheet) => total + sheet.rows.length, 0);
  console.log(`students -> ${STUDENTS_OUT}`);
  console.log(`  ${classSheets.length} class sheets, ${studentCount} students`);
  console.log(`  classes: ${classSheets.map((s) => s.name).join(', ')}`);
  const removed = (await readSheets(STUDENTS_IN)).filter((sheet) => /^mp/i.test(sheet.name.trim()));
  console.log(`  removed: ${removed.map((s) => s.name).join(', ') || 'none'} (${removed.length} sheet(s))`);

  console.log(`teachers -> ${TEACHERS_OUT}`);
  console.log(`  ${roster.rows.length} teachers`);
  const subjects = new Set<string>();
  for (const row of roster.rows) for (const subject of splitList(row['Subjects'])) subjects.add(subject);
  console.log(`  subjects: ${[...subjects].sort().join(', ')}`);
  const pending = roster.rows.filter((row) => !row['Email']);
  console.log(`  pending emails: ${pending.map((row) => row['Teacher Name']).join(', ') || 'none'}`);

  // Round-trip: the generated files must parse back to the same records.
  const outStudents = buildStudentImportRows(await readSheets(STUDENTS_OUT), academicYearFromFileName(STUDENTS_OUT));
  const sourceStudents = buildStudentImportRows(await readSheets(STUDENTS_IN), academicYearFromFileName(STUDENTS_IN));
  const isMp = (row: Record<string, string>) => /^mp/i.test(row['Class'] || '');
  const sourceIds = new Set(sourceStudents.rows.filter((row) => !isMp(row)).map((row) => row['Student ID']));
  const outIds = new Set(outStudents.rows.map((row) => row['Student ID']));
  const mpLeft = outStudents.rows.filter(isMp).map((row) => row['Student ID']);
  const missing = [...sourceIds].filter((id) => !outIds.has(id));
  console.log('\nround-trip check');
  console.log(`  source students ${sourceIds.size} -> output ${outIds.size} (removed ${sourceIds.size - outIds.size}, MP left in output ${mpLeft.length})`);
  console.log(`  non-MP students lost: ${missing.length}${missing.length ? ` -> ${missing.slice(0, 5).join(', ')}` : ''}`);
  console.log(`  output academic year: ${outStudents.rows[0]?.['Academic Year'] || 'none'}`);
  const notes = outStudents.notes.join(' | ');
  console.log(`  parser notes: ${notes}`);

  let outTeachers: ReturnType<typeof buildTeacherImportRows> | null = null;
  for (const sheet of await readSheets(TEACHERS_OUT)) {
    try {
      outTeachers = buildTeacherImportRows(sheet.rows);
      break;
    } catch {
      /* READ ME sheet has no roster header - try the next one */
    }
  }
  console.log(`  teachers parsed back: ${outTeachers?.rows.length ?? 0} (source ${roster.rows.length})`);
  const pairs = (parsed: { rows: Record<string, string>[] }) => {
    const set = new Set<string>();
    for (const row of parsed.rows) {
      for (const subject of splitList(row['Subjects']).map((value) => canonicalSubjectName(value) || value)) {
        for (const className of splitList(row['Classes'])) set.add(`${row['Teacher ID']}|${subject}|${className}`);
      }
    }
    return set;
  };
  const sourcePairs = pairs(roster);
  const outputPairs = pairs(outTeachers ?? { rows: [] });
  const lostPairs = [...sourcePairs].filter((pair) => !outputPairs.has(pair));
  console.log(`  teaching assignments: source ${sourcePairs.size} -> output ${outputPairs.size} (lost ${lostPairs.length})`);
  if (lostPairs.length) console.log(`    ${lostPairs.slice(0, 5).join(' ; ')}`);
  if (mpLeft.length || missing.length || lostPairs.length || (outTeachers?.rows.length ?? 0) !== roster.rows.length) process.exitCode = 1;
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});

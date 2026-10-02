export type ImportKind = 'students' | 'teachers';

export type TeacherAssignmentImportRow = {
  teacherId: string;
  name: string;
  surname: string;
  email: string;
  contactDetail: string;
  nationality: string;
  subjects: string[];
  classes: string[];
};

export type SheetData = { name: string; rows: string[][] };

export type ParsedRows = { headers: string[]; rows: Record<string, string>[]; notes: string[] };

export const importFields: Record<ImportKind, string[]> = {
  students: ['Student ID', 'Student Name', 'Grade', 'Class', 'Academic Year', 'Status'],
  teachers: ['Teacher ID', 'Teacher Name', 'Email', 'Contact Detail', 'Nationality', 'Subjects', 'Classes'],
};

// Columns that may stay blank: the server fills them in or derives them.
export const requiredImportFields: Record<ImportKind, string[]> = {
  students: ['Student ID', 'Student Name', 'Class'],
  teachers: ['Teacher Name'],
};

const normalizeValue = (value: unknown) => String(value ?? '').trim();

export const norm = (value: unknown) => normalizeValue(value).toLowerCase().replace(/\s+/g, ' ');

const pickFirst = (row: Record<string, string>, keys: string[]) => {
  const normalized = Object.keys(row).reduce<Record<string, string>>((acc, key) => {
    acc[norm(key)] = normalizeValue(row[key]);
    return acc;
  }, {});
  for (const key of keys) {
    const value = normalized[norm(key)];
    if (value) return value;
  }
  return '';
};

const splitList = (value: unknown) => {
  const raw = normalizeValue(value)
    .replace(/\r/g, '')
    .replace(/;/g, ',')
    .replace(/\|/g, ',');

  if (!raw) return [];

  return raw
    .split(',')
    .map((part) => part.trim())
    .filter(Boolean);
};

// Excel cells can be strings, numbers, rich text runs, hyperlinks or formula results.
export const cellText = (value: unknown): string => {
  if (value === null || value === undefined) return '';
  if (typeof value === 'string') return value.trim();
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  if (value instanceof Date) return value.toISOString().slice(0, 10);
  if (typeof value === 'object') {
    const v = value as { richText?: { text?: string }[]; text?: unknown; hyperlink?: string; result?: unknown };
    if (Array.isArray(v.richText)) return v.richText.map((run) => run.text ?? '').join('').trim();
    if (typeof v.text === 'string') return v.text.trim();
    if (v.hyperlink) return v.hyperlink.replace(/^mailto:/i, '').replace(/^tel:/i, '').trim();
    if (v.result !== undefined && v.result !== null && typeof v.result !== 'object') return String(v.result).trim();
  }
  return '';
};

// "7A" → "Grade 7", "10" → "Grade 10", "MP1" → "MP", anything else → itself.
export const gradeNameForClass = (className: string): string => {
  const name = normalizeValue(className);
  const numeric = /^(\d+)\s*[A-Za-z]*$/.exec(name);
  if (numeric) return `Grade ${numeric[1]}`;
  const lettered = /^([A-Za-z]+)\s*\d+$/.exec(name);
  if (lettered) return lettered[1].toUpperCase();
  return name;
};

export const academicYearFromFileName = (fileName: string): string => {
  const match = /(\d{4})\s*[-–—]\s*(\d{4})/.exec(fileName);
  return match ? `${match[1]}-${match[2]}` : '';
};

const SUBJECT_ALIASES: Record<string, string> = {
  MATH: 'Mathematics', MATHS: 'Mathematics', MTC: 'Mathematics',
  SCI: 'Science',
  COMP: 'Computing', CS: 'Computing',
  FRE: 'French',
  PHY: 'Physics',
  GC: 'Global Citizenship',
  EASL: 'English', ENG: 'English',
  ICT: 'ICT', IT: 'ICT',
  BIO: 'Biology', CHEM: 'Chemistry', GEOG: 'Geography', HIST: 'History',
  ECON: 'Economics', BUS: 'Business Studies', MECAN: 'Mechanics',
  FRENCH: 'French', TURKISH: 'Turkish', KIRUNDI: 'Kirundi',
};

export const subjectKey = (name: string) => normalizeValue(name).toUpperCase().replace(/[^A-Z0-9]/g, '');

// Map a subject code from a spreadsheet onto a friendly name ("MATHS" → "Mathematics").
export const canonicalSubjectName = (name: string): string => {
  const trimmed = normalizeValue(name);
  if (!trimmed) return '';
  return SUBJECT_ALIASES[subjectKey(trimmed)] || trimmed;
};

export const subjectCodeFor = (name: string, used: Set<string>): string => {
  let base = subjectKey(name) || 'SUBJ';
  if (base.length < 2) base = `${base}SUBJ`.slice(0, 4);
  let code = base;
  let attempt = 1;
  while (used.has(code)) {
    attempt += 1;
    code = `${base.slice(0, 6)}${attempt}`;
  }
  used.add(code);
  return code;
};

// Pending addresses must be unique across every organization (users.email is globally unique).
export const placeholderTeacherEmail = (teacherId: string, name: string, organization = ''): string => {
  const slug = (value: string) =>
    normalizeValue(value).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 32);
  const local = ['pending', slug(organization), slug(teacherId) || 'teacher', slug(name) || 'x']
    .filter(Boolean)
    .join('-')
    .replace(/-+/g, '-');
  return `${local.slice(0, 60)}@placeholder.invalid`;
};

export function normalizeTeacherAssignmentImportRow(row: Record<string, string>): TeacherAssignmentImportRow {
  const teacherId = pickFirst(row, ['Teacher ID', 'teacherId', 'NO', 'No', 'ID']);
  const name = pickFirst(row, ['NAME', 'Name', 'First Name', 'First name', 'Teacher Name']);
  const surname = pickFirst(row, ['SURNAME', 'Surname', 'Last Name', 'Last name']);
  const email = pickFirst(row, ['EMAIL', 'Email', 'email']);
  const contactDetail = pickFirst(row, ['CONTACT DETAIL', 'Contact Detail', 'Contact', 'Phone', 'Phone Number']);
  const nationality = pickFirst(row, ['NATIONALITY', 'Nationality', 'Country']);
  const subjects = splitList(pickFirst(row, ['SUBJECTS', 'Subjects', 'Subject']));
  const classes = splitList(pickFirst(row, ['CLASSES', 'Classes', 'Class']));

  return {
    teacherId: teacherId || (email ? `T-${email.split('@')[0]}` : 'AUTO-TEACHER'),
    name: name,
    surname: surname,
    email: email,
    contactDetail: contactDetail,
    nationality: nationality,
    subjects,
    classes,
  };
}

const isHeaderRow = (row: string[], required: string[]) => {
  const cells = row.map((cell) => norm(cell)).filter(Boolean);
  return required.every((key) => cells.includes(key));
};

// Reads every worksheet of a student workbook: header rows ("No | Name | Surname | Year"),
// including sheets that carry two side-by-side class tables.
export function buildStudentImportRows(sheets: SheetData[], academicYear: string): ParsedRows {
  const rows: Record<string, string>[] = [];
  const notes: string[] = [];
  const seen = new Map<string, number>();
  const classes = new Set<string>();
  let skippedSheets = 0;
  let skippedRows = 0;

  for (const sheet of sheets) {
    const data = sheet.rows;
    const headerIndexes: number[] = [];
    data.forEach((row, index) => {
      if (isHeaderRow(row, ['no', 'name', 'surname'])) headerIndexes.push(index);
    });
    if (!headerIndexes.length) {
      if (data.some((row) => row.some((cell) => cell.trim()))) skippedSheets += 1;
      continue;
    }

    for (const headerIndex of headerIndexes) {
      const header = data[headerIndex];
      const starts: number[] = [];
      header.forEach((cell, index) => {
        if (norm(cell) === 'no' && norm(header[index + 1]) === 'name') starts.push(index);
      });

      for (const start of starts) {
        for (let i = headerIndex + 1; i < data.length; i++) {
          const row = data[i];
          if (isHeaderRow(row, ['no', 'name', 'surname'])) break;
        const no = normalizeValue(row[start]);
        const firstName = normalizeValue(row[start + 1]);
        const lastName = normalizeValue(row[start + 2]);
        const yearCell = normalizeValue(row[start + 3]);
        const statusColumn = norm(header[start + 4]) === 'status';
        if (!firstName && !lastName && !no) continue;
        const fullName = [firstName, lastName].filter(Boolean).join(' ');
        if (!fullName) continue;
        // The class comes from the Year column; the sheet name only helps when it is written like a class (7A, 10).
        const className = yearCell || (/^\d/.test(sheet.name.trim()) ? sheet.name.trim() : '');
        if (!className) {
          skippedRows += 1;
          continue;
        }
        // The academic year is part of the ID so a later year's file can never overwrite another child's record.
        let studentId = `${academicYear ? `${academicYear}-` : ''}${className}-${no || fullName}`.replace(/\s+/g, '');
        const repeats = seen.get(studentId) ?? 0;
        seen.set(studentId, repeats + 1);
        if (repeats) studentId = `${studentId}-${repeats + 1}`;
        classes.add(className);
        rows.push({
          'Student ID': studentId,
          'Student Name': fullName,
          'Grade': gradeNameForClass(className),
          'Class': className,
          'Academic Year': academicYear,
          'Status': statusColumn ? normalizeValue(row[start + 4]).toUpperCase() : '',
        });
        }
      }
    }
  }

  notes.push(`${rows.length} students found in ${sheets.length} sheet(s).`);
  notes.push(`Classes detected: ${[...classes].sort().join(', ') || 'none'}.`);
  if (academicYear) notes.push(`Student IDs are prefixed with ${academicYear} so each year's roster stays separate.`);
  if (skippedSheets) notes.push(`${skippedSheets} sheet(s) skipped because they have no No/Name/Surname header row.`);
  if (skippedRows) notes.push(`${skippedRows} row(s) skipped because they have no class in the Year column.`);
  return { headers: importFields.students, rows, notes };
}

type TeacherDraft = {
  teacherId: string;
  name: string;
  email: string;
  contactDetail: string;
  nationality: string;
  subjects: string[];
  classes: string[];
  sourceRow: number;
};

const mergeList = (target: string[], values: string[]) => {
  for (const value of values) if (!target.includes(value)) target.push(value);
};

// Reads a teacher roster (title rows, padded headers, hyperlink emails, one teacher
// spread over several rows) and returns one merged row per teacher.
export function buildTeacherImportRows(table: string[][]): ParsedRows {
  const rosterHeader = table.findIndex((row) => isHeaderRow(row, ['no', 'name', 'surname']));
  const index = rosterHeader >= 0 ? rosterHeader : table.findIndex((row) => isHeaderRow(row, ['name', 'email']));
  if (index < 0) {
    throw new Error('No teacher header row found. Expected columns NO, NAME, SURNAME, EMAIL, SUBJECTS, CLASSES.');
  }

  const header = table[index];
  const column = (aliases: string[]) => header.findIndex((cell) => aliases.some((alias) => norm(cell) === norm(alias)));
  const columns = {
    no: column(['NO', 'Teacher ID', 'ID', 'Code']),
    name: column(['NAME', 'First Name', 'Teacher Name']),
    surname: column(['SURNAME', 'Last Name']),
    email: column(['EMAIL']),
    contact: column(['CONTACT DETAIL', 'Contact', 'Phone', 'Phone Number']),
    nationality: column(['NATIONALITY', 'Country']),
    subjects: column(['SUBJECTS', 'Subject']),
    classes: column(['CLASSES', 'Class']),
  };

  const merged = new Map<string, TeacherDraft>();
  const duplicates = new Set<string>();

  for (let i = index + 1; i < table.length; i++) {
    const row = table[i];
    if (!row.some((cell) => normalizeValue(cell))) continue;
    const get = (position: number) => (position >= 0 ? normalizeValue(row[position]) : '');
    const fullName = [get(columns.name), get(columns.surname)].filter(Boolean).join(' ');
    const email = get(columns.email);
    if (!fullName && !email) continue;
    const no = get(columns.no);
    const key = no ? `no:${no}` : email ? `email:${email.toLowerCase()}` : `name:${fullName.toLowerCase()}`;
    const existing = merged.get(key);
    if (!existing) {
      merged.set(key, {
        teacherId: no,
        name: fullName,
        email,
        contactDetail: get(columns.contact),
        nationality: get(columns.nationality),
        subjects: splitList(get(columns.subjects)),
        classes: splitList(get(columns.classes).replace(/\.0$/, '')),
        sourceRow: i + 1,
      });
      continue;
    }
    duplicates.add(key);
    if (!existing.email && email) existing.email = email;
    if (!existing.contactDetail) existing.contactDetail = get(columns.contact);
    if (!existing.nationality) existing.nationality = get(columns.nationality);
    mergeList(existing.subjects, splitList(get(columns.subjects)));
    mergeList(existing.classes, splitList(get(columns.classes).replace(/\.0$/, '')));
  }

  const rows: Record<string, string>[] = [];
  const pendingEmails: string[] = [];
  const withoutAssignments: string[] = [];
  merged.forEach((teacher) => {
    const teacherId = teacher.teacherId || (teacher.email ? `T-${teacher.email.split('@')[0]}` : '');
    rows.push({
      'Teacher ID': teacherId,
      'Teacher Name': teacher.name,
      'Email': teacher.email,
      'Contact Detail': teacher.contactDetail,
      'Nationality': teacher.nationality,
      'Subjects': teacher.subjects.join(', '),
      'Classes': teacher.classes.join(', '),
    });
    if (!teacher.email) pendingEmails.push(teacher.name || teacherId);
    if (!teacher.subjects.length || !teacher.classes.length) withoutAssignments.push(teacher.name || teacherId);
  });

  const notes = [`${rows.length} teachers found (${duplicates.size} merged from multiple rows).`];
  if (pendingEmails.length) {
    notes.push(`${pendingEmails.length} teacher(s) have no email: a pending login will be generated — ${pendingEmails.join(', ')}.`);
  }
  if (withoutAssignments.length) {
    notes.push(`No subjects/classes yet for: ${withoutAssignments.join(', ')}.`);
  }
  return { headers: importFields.teachers, rows, notes };
}

// RFC-4180 style CSV parser (quote aware), used for .csv uploads.
export const parseCsvTable = (text: string): string[][] => {
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = '';
  let quoted = false;
  const source = text.replace(/^\uFEFF/, '');
  for (let i = 0; i < source.length; i++) {
    const ch = source[i];
    if (quoted) {
      if (ch === '"' && source[i + 1] === '"') { cell += '"'; i += 1; }
      else if (ch === '"') quoted = false;
      else cell += ch;
      continue;
    }
    if (ch === '"') { quoted = true; continue; }
    if (ch === ',') { row.push(cell); cell = ''; continue; }
    if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && source[i + 1] === '\n') i += 1;
      row.push(cell); cell = '';
      if (row.some((value) => value.trim())) rows.push(row);
      row = [];
      continue;
    }
    cell += ch;
  }
  row.push(cell);
  if (row.some((value) => value.trim())) rows.push(row);
  return rows;
};

// Guards CSV cells against spreadsheet formula injection.
export const safeCsvCell = (value: unknown): string => {
  const text = normalizeValue(value);
  const guarded = /^[=+\-@\t\r]/.test(text) ? `'${text}` : text;
  return `"${guarded.replace(/"/g, '""')}"`;
};

export const toCsv = (headers: string[], rows: Record<string, string>[]): string =>
  [headers.map(safeCsvCell).join(','), ...rows.map((row) => headers.map((h) => safeCsvCell(row[h] ?? '')).join(','))].join('\r\n');

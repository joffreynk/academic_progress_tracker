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

const normalizeValue = (value: unknown) => String(value ?? '').trim();

const pickFirst = (row: Record<string, string>, keys: string[]) => {
  for (const key of keys) {
    const direct = row[key];
    if (direct !== undefined && direct !== null && normalizeValue(direct) !== '') return normalizeValue(direct);
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

export function normalizeTeacherAssignmentImportRow(row: Record<string, string>): TeacherAssignmentImportRow {
  const teacherId = pickFirst(row, ['Teacher ID', 'teacherId', 'NO', 'No', 'ID']);
  const name = pickFirst(row, ['NAME', 'Name', 'First Name', 'First name', 'Teacher Name', 'Teacher Name ']);
  const surname = pickFirst(row, ['SURNAME', 'Surname', 'Last Name', 'Last name']);
  const email = pickFirst(row, ['EMAIL', 'Email', 'email']);
  const contactDetail = pickFirst(row, ['CONTACT DETAIL', 'Contact Detail', 'CONTACT DETAIL ', 'Contact', 'Phone']);
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

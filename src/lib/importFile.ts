import {
  academicYearFromFileName,
  buildStudentImportRows,
  buildTeacherImportRows,
  cellText,
  parseCsvTable,
  type ImportKind,
  type ParsedRows,
  type SheetData,
} from './importing';

const MAX_FILE_SIZE = 10 * 1024 * 1024;

const readSheets = async (file: File): Promise<SheetData[]> => {
  if (/\.csv$/i.test(file.name)) {
    const text = await file.text();
    return [{ name: file.name.replace(/\.[^.]+$/, ''), rows: parseCsvTable(text) }];
  }
  if (!/\.xlsx$/i.test(file.name)) throw new Error('Choose a CSV or XLSX file.');
  const Excel = (await import('exceljs')).default;
  const book = new Excel.Workbook();
  await book.xlsx.load((await file.arrayBuffer()) as never);
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

export const readImportFile = async (file: File, kind: ImportKind): Promise<ParsedRows> => {
  if (file.size > MAX_FILE_SIZE) throw new Error('File must be under 10 MB.');
  const sheets = await readSheets(file);
  if (!sheets.some((sheet) => sheet.rows.length)) throw new Error('The file has no data rows.');

  if (kind === 'students') {
    const parsed = buildStudentImportRows(sheets, academicYearFromFileName(file.name));
    if (!parsed.rows.length) {
      throw new Error('No students found. Every class sheet needs a No / Name / Surname header row.');
    }
    return parsed;
  }

  let lastError: unknown = null;
  for (const sheet of sheets) {
    try {
      return buildTeacherImportRows(sheet.rows);
    } catch (error) {
      lastError = error;
    }
  }
  throw lastError instanceof Error ? lastError : new Error('No teacher roster found in this file.');
};

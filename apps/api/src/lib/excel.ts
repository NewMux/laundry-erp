import ExcelJS from 'exceljs';

export type ColType = 'text' | 'money' | 'number' | 'date' | 'percent';

export interface TableColumn {
  key: string;
  header: string;
  type?: ColType;
  width?: number;
}

export interface Table {
  name: string;
  title?: string;
  subtitle?: string;
  columns: TableColumn[];
  rows: Record<string, unknown>[];
  totals?: Record<string, unknown> | null;
}

const MONEY_FMT = '#,##0.000';

/** Build an .xlsx workbook from one or more tables. */
export async function tablesToXlsx(tables: Table[]): Promise<Buffer> {
  const wb = new ExcelJS.Workbook();
  wb.creator = 'NewMux Laundry';
  wb.created = new Date();
  for (const t of tables) {
    const ws = wb.addWorksheet(t.name.replace(/[\\/?*[\]:]/g, ' ').slice(0, 31) || 'Sheet');
    let headerRow = 1;
    if (t.title) {
      ws.addRow([t.title]).font = { bold: true, size: 14 };
      headerRow++;
      if (t.subtitle) {
        ws.addRow([t.subtitle]).font = { italic: true, color: { argb: 'FF555555' } };
        headerRow++;
      }
      ws.addRow([]);
      headerRow++;
    }
    const header = ws.addRow(t.columns.map((c) => c.header));
    header.font = { bold: true };
    header.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFE8EEF6' } };
    for (const r of t.rows) ws.addRow(t.columns.map((c) => cellValue(r[c.key], c.type)));
    if (t.totals) {
      const tr = ws.addRow(t.columns.map((c) => cellValue(t.totals![c.key], c.type)));
      tr.font = { bold: true };
      tr.border = { top: { style: 'thin' } };
    }
    t.columns.forEach((c, i) => {
      const col = ws.getColumn(i + 1);
      col.width = c.width ?? Math.min(40, Math.max(10, c.header.length + 4));
      if (c.type === 'money') col.numFmt = MONEY_FMT;
      if (c.type === 'percent') col.numFmt = '0.00"%"';
    });
    ws.views = [{ state: 'frozen', ySplit: headerRow }];
  }
  return Buffer.from(await wb.xlsx.writeBuffer());
}

function cellValue(v: unknown, type?: ColType): ExcelJS.CellValue {
  if (v === null || v === undefined) return null;
  if (type === 'money' || type === 'number' || type === 'percent') {
    const n = Number(v);
    return Number.isFinite(n) ? n : String(v);
  }
  if (v instanceof Date) return v;
  if (Array.isArray(v)) return v.join(', ');
  if (typeof v === 'object') return JSON.stringify(v);
  return v as ExcelJS.CellValue;
}

/** CSV with a UTF-8 BOM so Excel opens Arabic text correctly. */
export function tableToCsv(t: Table): string {
  const esc = (v: unknown) => {
    if (v === null || v === undefined) return '';
    const s = v instanceof Date ? v.toISOString() : String(v);
    return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const lines = [t.columns.map((c) => esc(c.header)).join(',')];
  for (const r of t.rows) lines.push(t.columns.map((c) => esc(r[c.key])).join(','));
  return `﻿${lines.join('\r\n')}`;
}

/** Read the first sheet of an .xlsx or a .csv upload into objects keyed by normalised header. */
export async function readSheet(buf: Buffer, mime: string, filename = ''): Promise<Record<string, string>[]> {
  const isCsv = mime.includes('csv') || filename.toLowerCase().endsWith('.csv') || mime === 'text/plain';
  let matrix: string[][];
  if (isCsv) {
    matrix = parseCsv(buf.toString('utf8').replace(/^﻿/, ''));
  } else {
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(buf as unknown as ArrayBuffer);
    const ws = wb.worksheets[0];
    if (!ws) return [];
    matrix = [];
    ws.eachRow({ includeEmpty: false }, (row) => {
      const vals = (row.values as unknown[]).slice(1).map((v) => {
        if (v === null || v === undefined) return '';
        if (typeof v === 'object' && v && 'text' in (v as object)) return String((v as { text: unknown }).text);
        if (typeof v === 'object' && v && 'result' in (v as object)) return String((v as { result: unknown }).result ?? '');
        if (v instanceof Date) return v.toISOString().slice(0, 10);
        return String(v);
      });
      matrix.push(vals);
    });
  }
  if (!matrix.length) return [];
  const headers = matrix[0].map((h) => h.trim().toLowerCase().replace(/[^a-z0-9]+/g, ''));
  return matrix
    .slice(1)
    .filter((r) => r.some((c) => String(c).trim() !== ''))
    .map((r) => Object.fromEntries(headers.map((h, i) => [h, String(r[i] ?? '').trim()])));
}

function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = '';
  let q = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (q) {
      if (ch === '"' && text[i + 1] === '"') {
        cell += '"';
        i++;
      } else if (ch === '"') q = false;
      else cell += ch;
    } else if (ch === '"') q = true;
    else if (ch === ',') {
      row.push(cell);
      cell = '';
    } else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && text[i + 1] === '\n') i++;
      row.push(cell);
      rows.push(row);
      row = [];
      cell = '';
    } else cell += ch;
  }
  if (cell !== '' || row.length) {
    row.push(cell);
    rows.push(row);
  }
  return rows;
}

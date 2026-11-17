import { ColumnMeta, DataRow } from '../types/interfaces';

export const MAX_IMPORT_ROWS = 200_000;
export const MAX_IMPORT_COLUMNS = 1_000;
export const MAX_IMPORT_BYTES = 50 * 1024 * 1024;

const MISSING_TOKENS = new Set(['', 'na', 'n/a', '#n/a', 'nan', 'null', 'none', '-', '.', '?', '#null!', '#div/0!', '#value!']);

export interface ImportResult {
  rows: DataRow[];
  warnings: string[];
}

export class ImportError extends Error {
  constructor(
    public code: string,
    public messageTr: string,
    public messageEn: string,
  ) {
    super(messageTr);
    this.name = 'ImportError';
  }
}

export function isMissing(v: unknown): boolean {
  if (v === null || v === undefined) return true;
  if (typeof v === 'number') return !Number.isFinite(v);
  if (typeof v === 'string') return MISSING_TOKENS.has(v.trim().toLowerCase());
  return false;
}

/**
 * Parses a numeric cell written in either "1234.5", "1,5" (decimal comma) or "1.234,56" / "1,234.56"
 * (thousands separators). Returns null when the text is not a plain number.
 */
export function parseNumber(raw: string): number | null {
  let s = raw.trim().replace(/\u00a0|\s/g, '');
  if (!s) return null;
  if (!/^[+-]?[\d.,]+(e[+-]?\d+)?$/i.test(s)) return null;
  const lastDot = s.lastIndexOf('.');
  const lastComma = s.lastIndexOf(',');
  if (lastDot >= 0 && lastComma >= 0) {
    if (lastComma > lastDot) s = s.replace(/\./g, '').replace(',', '.');
    else s = s.replace(/,/g, '');
  } else if (lastComma >= 0) {
    const commas = (s.match(/,/g) || []).length;
    if (commas > 1) s = s.replace(/,/g, '');
    else s = s.replace(',', '.');
  } else if ((s.match(/\./g) || []).length > 1) {
    s = s.replace(/\./g, '');
  }
  const n = Number(s);
  return Number.isFinite(n) ? n : null;
}

function detectDelimiter(text: string): string {
  const firstLine = text.split(/\r?\n/, 1)[0] ?? '';
  const candidates = [',', ';', '\t', '|'];
  let best = ',';
  let bestCount = 0;
  for (const c of candidates) {
    let count = 0;
    let inQ = false;
    for (const ch of firstLine) {
      if (ch === '"') inQ = !inQ;
      else if (ch === c && !inQ) count++;
    }
    if (count > bestCount) {
      best = c;
      bestCount = count;
    }
  }
  return best;
}

/** RFC 4180 tokenizer: quoted fields, escaped quotes ("") and newlines inside quotes. */
function tokenize(text: string, delim: string): string[][] {
  const records: string[][] = [];
  let field = '';
  let record: string[] = [];
  let inQuotes = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (inQuotes) {
      if (ch === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i++;
        } else inQuotes = false;
      } else field += ch;
      continue;
    }
    if (ch === '"' && field.trim() === '') {
      inQuotes = true;
      field = '';
    } else if (ch === delim) {
      record.push(field);
      field = '';
    } else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && text[i + 1] === '\n') i++;
      record.push(field);
      records.push(record);
      record = [];
      field = '';
    } else field += ch;
  }
  if (field !== '' || record.length) {
    record.push(field);
    records.push(record);
  }
  return records.filter((r) => r.some((c) => c.trim() !== ''));
}

/** Makes headers non-empty and unique (Yas, Yas_2, Yas_3 ...). */
export function normalizeHeaders(raw: unknown[]): string[] {
  const seen = new Map<string, number>();
  return raw.map((h, i) => {
    let name = String(h ?? '').replace(/\s+/g, ' ').trim();
    if (!name) name = `Degisken_${i + 1}`;
    const key = name.toLocaleLowerCase('tr');
    const n = (seen.get(key) ?? 0) + 1;
    seen.set(key, n);
    return n === 1 ? name : `${name}_${n}`;
  });
}

function cellValue(raw: string): string | number | null {
  const t = raw.trim();
  if (isMissing(t)) return null;
  const n = parseNumber(t);
  return n === null ? t : n;
}

export function parseDelimitedText(input: string): ImportResult {
  const warnings: string[] = [];
  const text = input.replace(/^\ufeff/, '');
  if (!text.trim()) throw new ImportError('empty_file', 'Dosya boş.', 'The file is empty.');
  const delim = detectDelimiter(text);
  const records = tokenize(text, delim);
  if (records.length < 2) throw new ImportError('no_rows', 'Dosyada başlık satırı dışında veri yok.', 'The file has no data rows below the header.');
  const headers = normalizeHeaders(records[0]);
  if (headers.length > MAX_IMPORT_COLUMNS)
    throw new ImportError('too_many_columns', `En fazla ${MAX_IMPORT_COLUMNS} sütun desteklenir.`, `At most ${MAX_IMPORT_COLUMNS} columns are supported.`);
  let body = records.slice(1);
  if (body.length > MAX_IMPORT_ROWS) {
    warnings.push(`İlk ${MAX_IMPORT_ROWS} satır alındı.`);
    body = body.slice(0, MAX_IMPORT_ROWS);
  }
  let ragged = 0;
  const rows = body.map((cells) => {
    if (cells.length !== headers.length) ragged++;
    const row: DataRow = {};
    headers.forEach((h, j) => {
      row[h] = cellValue(cells[j] ?? '');
    });
    return row;
  });
  if (ragged) warnings.push(`${ragged} satırın sütun sayısı başlıkla uyuşmuyor; eksik hücreler boş bırakıldı.`);
  return { rows, warnings };
}

/** Normalizes rows coming from a spreadsheet reader (dates, booleans, header gaps). */
export function normalizeSheetRows(sheetRows: unknown[][]): ImportResult {
  const warnings: string[] = [];
  const nonEmpty = sheetRows.filter((r) => Array.isArray(r) && r.some((c) => !isMissing(c)));
  if (nonEmpty.length < 2) throw new ImportError('no_rows', 'Sayfada başlık satırı dışında veri yok.', 'The sheet has no data rows below the header.');
  const width = Math.max(...nonEmpty.map((r) => r.length));
  const headerRaw = Array.from({ length: width }, (_, i) => nonEmpty[0][i]);
  const headers = normalizeHeaders(headerRaw);
  let body = nonEmpty.slice(1);
  if (body.length > MAX_IMPORT_ROWS) {
    warnings.push(`İlk ${MAX_IMPORT_ROWS} satır alındı.`);
    body = body.slice(0, MAX_IMPORT_ROWS);
  }
  const rows = body.map((cells) => {
    const row: DataRow = {};
    headers.forEach((h, j) => {
      const v = cells[j];
      if (isMissing(v)) row[h] = null;
      else if (v instanceof Date) row[h] = Number.isNaN(v.getTime()) ? null : v.toISOString().slice(0, 10);
      else if (typeof v === 'number') row[h] = v;
      else if (typeof v === 'boolean') row[h] = v ? 1 : 0;
      else row[h] = cellValue(String(v));
    });
    return row;
  });
  return { rows, warnings };
}

/**
 * Infers column metadata over the union of keys in all rows. Columns that are mostly numeric
 * are coerced: stray text cells become missing (and are counted) instead of silently mixing types.
 */
export function inferAndCoerce(rows: DataRow[]): { columns: ColumnMeta[]; rows: DataRow[]; warnings: string[] } {
  const warnings: string[] = [];
  if (!rows.length) return { columns: [], rows: [], warnings };
  const keys: string[] = [];
  const seen = new Set<string>();
  for (const r of rows) for (const k of Object.keys(r)) if (!seen.has(k)) { seen.add(k); keys.push(k); }

  const out = rows.map((r) => {
    const o: DataRow = {};
    for (const k of keys) o[k] = isMissing(r[k]) ? null : (r[k] as DataRow[string]);
    return o;
  });

  const columns: ColumnMeta[] = keys.map((name) => {
    const vals = out.map((r) => r[name]).filter((v) => v !== null);
    const nums = vals.map((v) => (typeof v === 'number' ? v : typeof v === 'string' ? parseNumber(v) : typeof v === 'boolean' ? Number(v) : null));
    const numCount = nums.filter((v) => v !== null).length;
    const isNum = vals.length > 0 && numCount / vals.length >= 0.9;
    if (isNum && numCount < vals.length) {
      warnings.push(`"${name}": ${vals.length - numCount} sayısal olmayan hücre eksik veri olarak işaretlendi.`);
    }
    if (isNum) {
      for (const r of out) {
        const v = r[name];
        if (v === null) continue;
        const n = typeof v === 'number' ? v : typeof v === 'string' ? parseNumber(v) : typeof v === 'boolean' ? Number(v) : null;
        r[name] = n;
      }
    }
    const finalVals = out.map((r) => r[name]).filter((v) => v !== null);
    const unique = new Set(finalVals.map((v) => String(v)));
    const numVals = finalVals.filter((v): v is number => typeof v === 'number');
    const isInt = isNum && numVals.every((v) => Number.isInteger(v));
    let valueType: ColumnMeta['valueType'] = 'string';
    let scale: ColumnMeta['scale'] = 'nominal';
    if (isNum) {
      valueType = 'numeric';
      scale = isInt && unique.size <= 2 ? 'nominal' : isInt && unique.size <= 7 ? 'ordinal' : 'scale';
    } else if (unique.size <= 25 || unique.size <= finalVals.length * 0.2) {
      valueType = 'categorical';
    }
    if (finalVals.length === 0) warnings.push(`"${name}" sütununun tamamı boş.`);
    else if (unique.size === 1) warnings.push(`"${name}" sabit değerli; analizlerde kullanılamaz.`);
    return {
      name,
      label: name,
      valueType,
      scale,
      decimals: isInt ? 0 : 2,
      uniqueCount: unique.size,
      missingCount: out.length - finalVals.length,
    };
  });
  return { columns, rows: out, warnings };
}

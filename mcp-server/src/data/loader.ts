import fs from 'node:fs/promises';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import * as XLSX from 'xlsx';
import { isPiiColumn, resolveSafeFilePath } from '../security/sandbox.js';

export const SUPPORTED_DATA_EXTENSIONS = [
  '.csv',
  '.tsv',
  '.xlsx',
  '.xls',
  '.json',
  '.sqlite',
  '.db',
  '.sqlite3',
] as const;

const MAX_ROWS = 200_000;
const MISSING_TOKENS = new Set([
  '',
  'na',
  'n/a',
  '#n/a',
  'nan',
  'null',
  'none',
  '-',
  '.',
  '?',
  '#null!',
  '#div/0!',
  '#value!',
]);

export type DataValue = string | number | boolean | null;
export type DataRow = Record<string, DataValue>;

export interface ColumnSummaryMeta {
  name: string;
  valueType: 'numeric' | 'categorical' | 'string' | 'boolean';
  measurementScale: 'scale' | 'ordinal' | 'nominal';
  missingCount: number;
  missingRate: number;
  uniqueCount: number;
  piiProtected: boolean;
  numericRange?: { min: number; max: number };
  categories?: string[];
}

export interface LoadedDataset {
  source: string;
  format: string;
  tableOrSheet: string;
  availableTablesOrSheets: string[];
  rowCount: number;
  columns: ColumnSummaryMeta[];
  rows: DataRow[];
  warnings: string[];
}

function getXlsxApi(): typeof XLSX {
  const mod = XLSX as unknown as typeof XLSX & { default?: typeof XLSX };
  return typeof mod.read === 'function' ? mod : mod.default!;
}

export function isMissingValue(v: unknown): boolean {
  if (v === null || v === undefined) return true;
  if (typeof v === 'number') return !Number.isFinite(v);
  if (typeof v === 'string') return MISSING_TOKENS.has(v.trim().toLowerCase());
  return false;
}

export function parseTurkishOrIntlNumber(raw: string): number | null {
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

function detectDelimiter(text: string, fallback = ','): string {
  const firstLine = text.split(/\r?\n/, 1)[0] ?? '';
  const candidates = [',', ';', '\t', '|'];
  let best = fallback;
  let bestCount = 0;
  for (const delim of candidates) {
    let count = 0;
    let inQuotes = false;
    for (const ch of firstLine) {
      if (ch === '"') inQuotes = !inQuotes;
      else if (ch === delim && !inQuotes) count++;
    }
    if (count > bestCount) {
      best = delim;
      bestCount = count;
    }
  }
  return best;
}

function tokenizeCsv(text: string, delim: string): string[][] {
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
        } else {
          inQuotes = false;
        }
      } else {
        field += ch;
      }
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
    } else {
      field += ch;
    }
  }
  if (field !== '' || record.length) {
    record.push(field);
    records.push(record);
  }
  return records.filter((r) => r.some((c) => c.trim() !== ''));
}

function normalizeHeaders(raw: unknown[]): string[] {
  const seen = new Map<string, number>();
  return raw.map((h, i) => {
    let name = String(h ?? '').replace(/\s+/g, ' ').trim();
    if (!name) name = `Degisken_${i + 1}`;
    const key = name.toLocaleLowerCase('tr');
    const count = (seen.get(key) ?? 0) + 1;
    seen.set(key, count);
    return count === 1 ? name : `${name}_${count}`;
  });
}

function coerceCellValue(raw: unknown): DataValue {
  if (isMissingValue(raw)) return null;
  if (typeof raw === 'number') return Number.isFinite(raw) ? raw : null;
  if (typeof raw === 'boolean') return raw;
  if (typeof raw === 'bigint') return Number(raw);
  if (raw instanceof Date) return Number.isNaN(raw.getTime()) ? null : raw.toISOString().slice(0, 10);
  const text = String(raw).trim();
  if (isMissingValue(text)) return null;
  const num = parseTurkishOrIntlNumber(text);
  return num === null ? text : num;
}

function inferSchemaAndCoerce(rawRows: DataRow[]): {
  columns: ColumnSummaryMeta[];
  rows: DataRow[];
  warnings: string[];
} {
  const warnings: string[] = [];
  if (!rawRows.length) {
    return { columns: [], rows: [], warnings };
  }

  const keys: string[] = [];
  const seen = new Set<string>();
  for (const row of rawRows) {
    for (const k of Object.keys(row)) {
      if (!seen.has(k)) {
        seen.add(k);
        keys.push(k);
      }
    }
  }

  const rows: DataRow[] = rawRows.map((row) => {
    const normalized: DataRow = {};
    for (const k of keys) {
      normalized[k] = isMissingValue(row[k]) ? null : row[k];
    }
    return normalized;
  });

  const columns: ColumnSummaryMeta[] = keys.map((name) => {
    const rawVals = rows.map((r) => r[name]);
    const piiProtected = isPiiColumn(name, rawVals);
    const nonNull = rawVals.filter((v) => v !== null);
    const parsedNums = nonNull.map((v) => {
      if (typeof v === 'number') return v;
      if (typeof v === 'boolean') return Number(v);
      if (typeof v === 'string') return parseTurkishOrIntlNumber(v);
      return null;
    });
    const numCount = parsedNums.filter((v) => v !== null).length;
    const isBool = nonNull.length > 0 && nonNull.every((v) => typeof v === 'boolean');
    const isNum = !piiProtected && !isBool && nonNull.length > 0 && numCount / nonNull.length >= 0.9;

    if (isNum) {
      for (const r of rows) {
        const v = r[name];
        if (v === null) continue;
        if (typeof v === 'number') continue;
        if (typeof v === 'boolean') r[name] = Number(v);
        else if (typeof v === 'string') r[name] = parseTurkishOrIntlNumber(v);
      }
    }

    const finalVals = rows.map((r) => r[name]).filter((v) => v !== null);
    const uniqueSet = new Set(finalVals.map((v) => String(v)));
    const numVals = finalVals.filter((v): v is number => typeof v === 'number');
    const isInt = isNum && numVals.every((v) => Number.isInteger(v));

    let valueType: ColumnSummaryMeta['valueType'] = 'string';
    let measurementScale: ColumnSummaryMeta['measurementScale'] = 'nominal';

    if (isBool) {
      valueType = 'boolean';
      measurementScale = 'nominal';
    } else if (isNum) {
      valueType = 'numeric';
      measurementScale =
        isInt && uniqueSet.size <= 2 ? 'nominal' : isInt && uniqueSet.size <= 7 ? 'ordinal' : 'scale';
    } else if (!piiProtected && (uniqueSet.size <= 25 || uniqueSet.size <= finalVals.length * 0.2)) {
      valueType = 'categorical';
      measurementScale = 'nominal';
    }

    if (piiProtected) {
      warnings.push(
        `KVKK/Etik koruması: "${name}" sütunu kişisel veri içerdiği için istatistik ve şema değerlerinden gizlendi.`,
      );
    }

    const missingCount = rows.length - finalVals.length;
    const missingRate = rows.length > 0 ? Number((missingCount / rows.length).toFixed(4)) : 0;

    const meta: ColumnSummaryMeta = {
      name,
      valueType,
      measurementScale,
      missingCount,
      missingRate,
      uniqueCount: uniqueSet.size,
      piiProtected,
    };

    if (!piiProtected && isNum && numVals.length > 0) {
      let min = numVals[0];
      let max = numVals[0];
      for (const n of numVals) {
        if (n < min) min = n;
        if (n > max) max = n;
      }
      meta.numericRange = { min, max };
    } else if (!piiProtected && (valueType === 'categorical' || valueType === 'boolean')) {
      meta.categories = Array.from(uniqueSet).slice(0, 15);
    }

    return meta;
  });

  return { columns, rows, warnings };
}

export async function loadDataset(
  dataDir: string,
  relativeSource: string,
  tableOrSheet?: string,
): Promise<LoadedDataset> {
  const safePath = await resolveSafeFilePath(dataDir, relativeSource, SUPPORTED_DATA_EXTENSIONS);
  const ext = path.extname(safePath).toLowerCase();

  let rawRows: DataRow[] = [];
  let selectedTarget = 'default';
  let availableTargets: string[] = [];
  let format = ext.slice(1);
  const loaderWarnings: string[] = [];

  if (ext === '.csv' || ext === '.tsv') {
    const rawText = (await fs.readFile(safePath, 'utf8')).replace(/^\ufeff/, '');
    const delim = detectDelimiter(rawText, ext === '.tsv' ? '\t' : ',');
    const records = tokenizeCsv(rawText, delim);
    if (records.length < 2) {
      throw new Error(`"${relativeSource}" dosyasında başlık dışında veri satırı bulunamadı.`);
    }
    const headers = normalizeHeaders(records[0]);
    const body = records.slice(1, MAX_ROWS + 1);
    if (records.length - 1 > MAX_ROWS) {
      loaderWarnings.push(`Performans sınırı nedeniyle ilk ${MAX_ROWS} satır yüklendi.`);
    }
    rawRows = body.map((cells) => {
      const row: DataRow = {};
      headers.forEach((h, i) => {
        row[h] = coerceCellValue(cells[i] ?? '');
      });
      return row;
    });
    selectedTarget = path.basename(safePath);
    availableTargets = [selectedTarget];
  } else if (ext === '.xlsx' || ext === '.xls') {
    const xlsxApi = getXlsxApi();
    const buf = await fs.readFile(safePath);
    const workbook = xlsxApi.read(buf, { type: 'buffer', cellDates: true });
    availableTargets = workbook.SheetNames;
    if (!availableTargets.length) {
      throw new Error(`"${relativeSource}" Excel dosyasında sayfa bulunamadı.`);
    }
    selectedTarget = tableOrSheet && availableTargets.includes(tableOrSheet)
      ? tableOrSheet
      : tableOrSheet
        ? (() => {
            throw new Error(
              `Sayfa "${tableOrSheet}" bulunamadı. Mevcut sayfalar: ${availableTargets.join(', ')}`,
            );
          })()
        : availableTargets[0];

    const sheet = workbook.Sheets[selectedTarget];
    const sheetRows = xlsxApi.utils.sheet_to_json<unknown[]>(sheet, { header: 1, defval: null });
    const nonEmpty = sheetRows.filter((r) => Array.isArray(r) && r.some((c) => !isMissingValue(c)));
    if (nonEmpty.length < 2) {
      throw new Error(`"${selectedTarget}" sayfasında veri satırı bulunamadı.`);
    }
    const width = Math.max(...nonEmpty.map((r) => r.length));
    const headers = normalizeHeaders(Array.from({ length: width }, (_, i) => nonEmpty[0][i]));
    rawRows = nonEmpty.slice(1, MAX_ROWS + 1).map((cells) => {
      const row: DataRow = {};
      headers.forEach((h, i) => {
        row[h] = coerceCellValue(cells[i]);
      });
      return row;
    });
  } else if (ext === '.json') {
    const text = await fs.readFile(safePath, 'utf8');
    const parsed = JSON.parse(text) as unknown;
    const arr = Array.isArray(parsed)
      ? parsed
      : parsed && typeof parsed === 'object' && Array.isArray((parsed as { rows?: unknown[] }).rows)
        ? (parsed as { rows: unknown[] }).rows
        : null;
    if (!arr || !arr.length) {
      throw new Error(`"${relativeSource}" JSON dosyası boş veya satır dizisi içermiyor.`);
    }
    rawRows = arr.slice(0, MAX_ROWS).map((item) => {
      const row: DataRow = {};
      if (item && typeof item === 'object') {
        for (const [k, v] of Object.entries(item as Record<string, unknown>)) {
          row[k] = coerceCellValue(v);
        }
      }
      return row;
    });
    selectedTarget = path.basename(safePath);
    availableTargets = [selectedTarget];
  } else {
    format = 'sqlite';
    const db = new DatabaseSync(safePath, { open: true, readOnly: true });
    try {
      const tableRows = db
        .prepare(
          "SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name",
        )
        .all() as { name: string }[];
      availableTargets = tableRows.map((t) => t.name);
      if (!availableTargets.length) {
        throw new Error(`"${relativeSource}" SQLite veritabanında tablo bulunamadı.`);
      }
      if (tableOrSheet) {
        if (!availableTargets.includes(tableOrSheet)) {
          throw new Error(
            `Tablo "${tableOrSheet}" bulunamadı. Mevcut tablolar: ${availableTargets.join(', ')}`,
          );
        }
        selectedTarget = tableOrSheet;
      } else {
        selectedTarget = availableTargets[0];
      }

      const escapedTable = selectedTarget.replace(/"/g, '""');
      const records = db
        .prepare(`SELECT * FROM "${escapedTable}" LIMIT ?`)
        .all(MAX_ROWS) as Record<string, unknown>[];

      rawRows = records.map((rec) => {
        const row: DataRow = {};
        for (const [k, v] of Object.entries(rec)) {
          row[k] = coerceCellValue(v);
        }
        return row;
      });
    } finally {
      db.close();
    }
  }

  const inferred = inferSchemaAndCoerce(rawRows);
  return {
    source: relativeSource,
    format,
    tableOrSheet: selectedTarget,
    availableTablesOrSheets: availableTargets,
    rowCount: inferred.rows.length,
    columns: inferred.columns,
    rows: inferred.rows,
    warnings: [...loaderWarnings, ...inferred.warnings],
  };
}

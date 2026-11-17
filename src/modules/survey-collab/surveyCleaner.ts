import { ColumnMeta, DataRow, Dataset } from '../../types/interfaces';
import { StatInputError } from '../../engine/core/errors';
import { mean, stdDev } from '../../engine/core/linalg';
import { rNum } from '../../engine/classical/helpers';

export interface SurveyCleanReport {
  cleanedDataset: Dataset;
  mappedColumns: { column: string; convertedCount: number }[];
  reversedColumns: string[];
  compositesCreated: string[];
  straightLinerIndices: number[];
  duplicateRowIndices: number[];
  summaryTextTr: string;
  summaryTextEn: string;
}

export interface CompositeSpec {
  name: string;
  items: string[];
}

export interface SurveyCleanOptions {
  mapVerbalCols?: string[];
  reverseCols?: string[];
  likertMin?: number;
  likertMax?: number;
  composites?: CompositeSpec[];
  removeDuplicates?: boolean;
  removeStraightLiners?: boolean;
}

/**
 * Normalize Turkish & English text into lowercase ASCII without diacritics
 * or redundant whitespace so verbal Likert labels match reliably.
 */
export function normalizeLikertText(input: string): string {
  const trMapped = input
    .replace(/İ/g, 'i')
    .replace(/I/g, 'i')
    .replace(/ı/g, 'i')
    .replace(/Ş/g, 's')
    .replace(/ş/g, 's')
    .replace(/Ğ/g, 'g')
    .replace(/ğ/g, 'g')
    .replace(/Ü/g, 'u')
    .replace(/ü/g, 'u')
    .replace(/Ö/g, 'o')
    .replace(/ö/g, 'o')
    .replace(/Ç/g, 'c')
    .replace(/ç/g, 'c');

  return trMapped
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[.,;:!?'"()\[\]{}\/\\-]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

const VERBAL_LIKERT_DICT: Record<string, number> = {
  // 5-point Agreement (Turkish & English)
  'kesinlikle katilmiyorum': 1,
  'hic katilmiyorum': 1,
  'tamamen katilmiyorum': 1,
  'strongly disagree': 1,
  'completely disagree': 1,
  'definitely disagree': 1,
  'katilmiyorum': 2,
  'disagree': 2,
  'somewhat disagree': 2,
  'kararsizim': 3,
  'ne katiliyorum ne katilmiyorum': 3,
  'tarafsizim': 3,
  'neutral': 3,
  'neither': 3,
  'neither agree nor disagree': 3,
  'undecided': 3,
  'katiliyorum': 4,
  'agree': 4,
  'somewhat agree': 4,
  'kesinlikle katiliyorum': 5,
  'tamamen katiliyorum': 5,
  'strongly agree': 5,
  'completely agree': 5,
  'definitely agree': 5,

  // 5-point Frequency (Turkish & English)
  'hicbir zaman': 1,
  'asla': 1,
  'never': 1,
  'nadiren': 2,
  'cok nadir': 2,
  'rarely': 2,
  'seldom': 2,
  'bazen': 3,
  'ara sira': 3,
  'sometimes': 3,
  'occasionally': 3,
  'sik sik': 4,
  'siklikla': 4,
  'cogunlukla': 4,
  'often': 4,
  'frequently': 4,
  'usually': 4,
  'her zaman': 5,
  'daima': 5,
  'surekli': 5,
  'always': 5,
};

const MISSING_TOKENS = new Set(['', 'na', 'n/a', 'null', 'nan', 'none', '-', '--', '.']);

type LikertMatchKind = 'number' | 'numeric_string' | 'verbal' | 'leading_int' | 'none';

function parseLikertCell(
  raw: unknown,
  leadMin = 1,
  leadMax = 10,
): { value: number | null; kind: LikertMatchKind } {
  if (raw === null || raw === undefined || typeof raw === 'boolean') {
    return { value: null, kind: 'none' };
  }
  if (typeof raw === 'number') {
    return Number.isFinite(raw) ? { value: raw, kind: 'number' } : { value: null, kind: 'none' };
  }

  const trimmed = String(raw).trim();
  if (MISSING_TOKENS.has(trimmed.toLowerCase())) {
    return { value: null, kind: 'none' };
  }

  // Exact numeric string (supports comma decimal)
  if (/^[+-]?\d+(?:[.,]\d+)?$/.test(trimmed)) {
    const num = Number(trimmed.replace(',', '.'));
    if (Number.isFinite(num)) {
      return { value: num, kind: 'numeric_string' };
    }
  }

  // Dictionary lookup (case/whitespace/diacritic-insensitive)
  const normalized = normalizeLikertText(trimmed);
  if (normalized in VERBAL_LIKERT_DICT) {
    return { value: VERBAL_LIKERT_DICT[normalized], kind: 'verbal' };
  }

  // Leading integer extraction: e.g. "1 - Kesinlikle Katılmıyorum", "5 (Çok Yüksek)"
  const leadMatch = trimmed.match(/^\s*(\d+)\s*(?:[-–—.:)\/(\[]|\s).*$/);
  if (leadMatch) {
    const n = Number(leadMatch[1]);
    if (Number.isInteger(n) && n >= leadMin && n <= leadMax) {
      return { value: n, kind: 'leading_int' };
    }
  }

  return { value: null, kind: 'none' };
}

function getColumnNames(dataset: Dataset): string[] {
  if (dataset.columns.length > 0) {
    return dataset.columns.map((c) => c.name);
  }
  if (dataset.rows.length > 0) {
    return Object.keys(dataset.rows[0]);
  }
  return [];
}

function isReverseNamedColumn(colName: string): boolean {
  const spaced = colName
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .replace(/[_\-.()[\]]+/g, ' ');
  const tokens = normalizeLikertText(spaced).split(' ').filter(Boolean);
  if (tokens.length === 0) return false;

  const reverseKeywords = new Set([
    'ters',
    'reverse',
    'reversed',
    'rev',
    'neg',
    'negative',
    'olumsuz',
  ]);
  if (tokens.some((t) => reverseKeywords.has(t))) {
    return true;
  }
  // Trailing single 'r' marker such as Q4_R or Item3_r (require at least 2 tokens so column "R" alone isn't matched)
  if (tokens.length >= 2 && tokens[tokens.length - 1] === 'r') {
    return true;
  }
  return false;
}

function pairwiseCorr(xs: (number | null)[], ys: (number | null)[]): number | null {
  const pairedX: number[] = [];
  const pairedY: number[] = [];
  for (let i = 0; i < xs.length; i++) {
    const xv = xs[i];
    const yv = ys[i];
    if (xv !== null && yv !== null && Number.isFinite(xv) && Number.isFinite(yv)) {
      pairedX.push(xv);
      pairedY.push(yv);
    }
  }
  if (pairedX.length < 5) return null;
  const mx = mean(pairedX);
  const my = mean(pairedY);
  let num = 0;
  let dx2 = 0;
  let dy2 = 0;
  for (let i = 0; i < pairedX.length; i++) {
    const dx = pairedX[i] - mx;
    const dy = pairedY[i] - my;
    num += dx * dy;
    dx2 += dx * dx;
    dy2 += dy * dy;
  }
  const den = Math.sqrt(dx2 * dy2);
  return den > 1e-12 ? num / den : null;
}

function isLikelyIdOrDemoColumn(colName: string): boolean {
  const norm = normalizeLikertText(colName.replace(/[_\-.]+/g, ' '));
  const tokens = norm.split(' ').filter(Boolean);
  const excluded = new Set(['id', 'yanit', 'katilimci', 'participant', 'yas', 'age', 'yil', 'year', 'no']);
  return tokens.some((t) => excluded.has(t));
}

/**
 * Inspect dataset columns to detect verbal Likert columns (Turkish/English
 * agreement/frequency or leading-integer labeled strings) and likely reverse-coded items.
 */
export function autoDetectLikertColumns(dataset: Dataset): {
  verbalColumns: string[];
  suspectReverseColumns: string[];
} {
  const colNames = getColumnNames(dataset);
  const verbalColumns: string[] = [];
  const candidateNumericMap = new Map<string, (number | null)[]>();

  for (const col of colNames) {
    let nonEmpty = 0;
    let verbalOrLead = 0;
    let numericLikert = 0;
    const parsedSeries: (number | null)[] = [];

    for (const row of dataset.rows) {
      const parsed = parseLikertCell(row[col], 1, 7);
      parsedSeries.push(parsed.value);
      const raw = row[col];
      if (raw !== null && raw !== undefined && String(raw).trim() !== '' && !MISSING_TOKENS.has(String(raw).trim().toLowerCase())) {
        nonEmpty++;
        if (parsed.kind === 'verbal' || parsed.kind === 'leading_int') {
          verbalOrLead++;
        } else if (
          (parsed.kind === 'number' || parsed.kind === 'numeric_string') &&
          parsed.value !== null &&
          Number.isInteger(parsed.value) &&
          parsed.value >= 1 &&
          parsed.value <= 7
        ) {
          numericLikert++;
        }
      }
    }

    if (nonEmpty > 0 && verbalOrLead > 0 && (verbalOrLead + numericLikert) / nonEmpty >= 0.5) {
      verbalColumns.push(col);
      candidateNumericMap.set(col, parsedSeries);
    } else if (
      nonEmpty > 0 &&
      numericLikert === nonEmpty &&
      !isLikelyIdOrDemoColumn(col)
    ) {
      candidateNumericMap.set(col, parsedSeries);
    }
  }

  const suspectSet = new Set<string>();
  const candidateCols = Array.from(candidateNumericMap.keys());

  for (const col of candidateCols) {
    if (isReverseNamedColumn(col)) {
      suspectSet.add(col);
    }
  }

  // Also check explicit reverse-named columns in dataset even if sparse
  for (const col of colNames) {
    if (isReverseNamedColumn(col) && (verbalColumns.includes(col) || candidateNumericMap.has(col))) {
      suspectSet.add(col);
    }
  }

  // Psychometric negative inter-item correlation check among >= 3 candidate Likert columns
  if (candidateCols.length >= 3) {
    for (const col of candidateCols) {
      const series = candidateNumericMap.get(col)!;
      const corrsWithOthers: number[] = [];
      const otherInternalCorrs: number[] = [];

      for (let i = 0; i < candidateCols.length; i++) {
        const c1 = candidateCols[i];
        if (c1 === col) continue;
        const r = pairwiseCorr(series, candidateNumericMap.get(c1)!);
        if (r !== null) corrsWithOthers.push(r);

        for (let j = i + 1; j < candidateCols.length; j++) {
          const c2 = candidateCols[j];
          if (c2 === col) continue;
          const rOther = pairwiseCorr(candidateNumericMap.get(c1)!, candidateNumericMap.get(c2)!);
          if (rOther !== null) otherInternalCorrs.push(rOther);
        }
      }

      if (
        corrsWithOthers.length >= 2 &&
        mean(corrsWithOthers) < -0.2 &&
        (otherInternalCorrs.length === 0 || mean(otherInternalCorrs) > 0.1)
      ) {
        suspectSet.add(col);
      }
    }
  }

  const suspectReverseColumns = colNames.filter((c) => suspectSet.has(c));
  return { verbalColumns, suspectReverseColumns };
}

function buildUpdatedColumns(rows: DataRow[], preferredOrder: string[], numericOverrides: Set<string>): ColumnMeta[] {
  const keysSet = new Set<string>(preferredOrder);
  for (const row of rows) {
    for (const k of Object.keys(row)) {
      keysSet.add(k);
    }
  }
  const keys = Array.from(keysSet);

  return keys.map((name) => {
    const vals = rows
      .map((r) => r[name])
      .filter((v) => v !== null && v !== undefined && v !== '');
    const missingCount = rows.length - vals.length;
    const unique = new Set(vals.map((v) => String(v)));
    const numVals = vals
      .map((v) => (typeof v === 'number' ? v : Number(String(v).replace(',', '.'))))
      .filter((v) => Number.isFinite(v));
    const isNum = numericOverrides.has(name) || (vals.length > 0 && numVals.length / vals.length >= 0.9);
    const isInt = isNum && numVals.every((v) => Math.abs(v % 1) < 1e-9);

    let valueType: ColumnMeta['valueType'] = 'string';
    let scale: ColumnMeta['scale'] = 'nominal';
    if (isNum) {
      valueType = 'numeric';
      scale = !numericOverrides.has(name) && isInt && unique.size === 2 ? 'nominal' : 'scale';
    } else if (unique.size <= 25) {
      valueType = 'categorical';
      scale = 'nominal';
    }

    return {
      name,
      label: name,
      valueType,
      scale,
      decimals: isInt ? 0 : 2,
      uniqueCount: unique.size,
      missingCount,
    };
  });
}

function findParticipantLabels(rows: DataRow[], colNames: string[], indices: number[]): string[] {
  const idCol = colNames.find((c) => {
    const norm = normalizeLikertText(c.replace(/[_\-.]+/g, ' '));
    return norm.includes('id') || norm.includes('katilimci') || norm.includes('yanit');
  });
  return indices.map((idx) => {
    if (idCol && rows[idx]?.[idCol] !== null && rows[idx]?.[idCol] !== undefined) {
      return String(rows[idx][idCol]);
    }
    return `#${idx + 1}`;
  });
}

/**
 * Clean messy survey exports: convert Turkish/English verbal Likert items to numeric,
 * detect straight-liners (SD === 0 across >= 3 items) and exact duplicates,
 * reverse-code negatively-keyed items, optionally drop flagged rows, and compute
 * composite scale means when >= half of items are answered.
 */
export function cleanSurveyDataset(dataset: Dataset, opts: SurveyCleanOptions = {}): SurveyCleanReport {
  if (!dataset || (!dataset.columns?.length && !dataset.rows?.length)) {
    throw new StatInputError(
      'EMPTY_DATA',
      'Temizlenecek veri seti boş.',
      'The dataset to clean is empty.',
    );
  }
  const likertMin = opts.likertMin ?? 1;
  const likertMax = opts.likertMax ?? 5;
  if (!Number.isFinite(likertMin) || !Number.isFinite(likertMax) || likertMin >= likertMax) {
    throw new StatInputError(
      'INVALID_PARAMETER',
      'Likert alt sınırı üst sınırdan küçük ve sonlu bir sayı olmalıdır.',
      'Likert minimum must be a finite number strictly less than maximum.',
    );
  }
  const detected = autoDetectLikertColumns(dataset);

  const mapVerbalCols = opts.mapVerbalCols !== undefined ? opts.mapVerbalCols : detected.verbalColumns;
  const reverseCols = opts.reverseCols ?? [];
  const composites = opts.composites ?? [];
  const removeDuplicates = opts.removeDuplicates ?? false;
  const removeStraightLiners = opts.removeStraightLiners ?? false;

  const colNames = getColumnNames(dataset);
  const existingColSet = new Set(colNames);
  const leadMin = Math.min(1, likertMin);
  const leadMax = Math.max(10, likertMax);

  // Deep clone rows so caller dataset stays immutable
  const workingRows: DataRow[] = dataset.rows.map((r) => ({ ...r }));
  const conversionCountMap = new Map<string, number>();

  for (const col of mapVerbalCols) {
    conversionCountMap.set(col, 0);
  }

  const colsToMapSet = new Set<string>(mapVerbalCols);
  // Also ensure any column requested for reverse-coding converts verbal strings first
  const activeReverseCols = reverseCols.filter((c) => existingColSet.has(c));

  for (const row of workingRows) {
    for (const col of colsToMapSet) {
      if (!existingColSet.has(col) && !(col in row)) continue;
      const raw = row[col];
      if (typeof raw === 'string') {
        const parsed = parseLikertCell(raw, leadMin, leadMax);
        if (parsed.value !== null) {
          row[col] = parsed.value;
          conversionCountMap.set(col, (conversionCountMap.get(col) ?? 0) + 1);
        } else if (MISSING_TOKENS.has(raw.trim().toLowerCase())) {
          row[col] = null;
        }
      } else if (raw === undefined) {
        row[col] = null;
      }
    }

    for (const col of activeReverseCols) {
      if (colsToMapSet.has(col)) continue;
      const raw = row[col];
      if (typeof raw === 'string') {
        const parsed = parseLikertCell(raw, leadMin, leadMax);
        if (parsed.value !== null) {
          row[col] = parsed.value;
          conversionCountMap.set(col, (conversionCountMap.get(col) ?? 0) + 1);
        }
      }
    }
  }

  const mappedColumns: { column: string; convertedCount: number }[] = [];
  for (const [column, convertedCount] of conversionCountMap.entries()) {
    mappedColumns.push({ column, convertedCount });
  }

  // Determine Likert item columns for straight-lining detection (BEFORE reverse-coding)
  const likertItemSet = new Set<string>([
    ...mapVerbalCols.filter((c) => existingColSet.has(c)),
    ...activeReverseCols,
    ...composites.flatMap((c) => c.items.filter((item) => existingColSet.has(item))),
  ]);

  if (likertItemSet.size < 3) {
    for (const col of colNames) {
      if (likertItemSet.has(col) || isLikelyIdOrDemoColumn(col)) continue;
      const vals = workingRows
        .map((r) => r[col])
        .filter((v) => v !== null && v !== undefined && v !== '');
      if (
        vals.length > 0 &&
        vals.every(
          (v) => typeof v === 'number' && Number.isInteger(v) && v >= likertMin && v <= likertMax,
        )
      ) {
        likertItemSet.add(col);
      }
    }
  }

  const likertItemCols = colNames.filter((c) => likertItemSet.has(c));

  // Straight-lining detection: SD === 0 across >= 3 Likert items
  const straightLinerIndices: number[] = [];
  if (likertItemCols.length >= 3) {
    for (let i = 0; i < workingRows.length; i++) {
      const row = workingRows[i];
      const vals: number[] = [];
      for (const col of likertItemCols) {
        const v = row[col];
        if (typeof v === 'number' && Number.isFinite(v)) {
          vals.push(v);
        }
      }
      if (vals.length >= 3 && stdDev(vals, 1) < 1e-12) {
        straightLinerIndices.push(i);
      }
    }
  }

  // Exact duplicate response detection across all dataset columns
  const duplicateRowIndices: number[] = [];
  const seenSignatures = new Set<string>();
  const sigKeys = colNames.length > 0 ? colNames : (workingRows[0] ? Object.keys(workingRows[0]) : []);

  for (let i = 0; i < workingRows.length; i++) {
    const row = workingRows[i];
    const sig = JSON.stringify(
      sigKeys.map((k) => {
        const v = row[k];
        if (v === undefined || v === null || v === '') return null;
        return typeof v === 'string' ? v.trim() : v;
      }),
    );
    if (seenSignatures.has(sig)) {
      duplicateRowIndices.push(i);
    } else {
      seenSignatures.add(sig);
    }
  }

  // Reverse-coding: likertMin + likertMax - x
  const reversedColumns: string[] = [];
  for (const col of activeReverseCols) {
    let anyReversed = false;
    for (const row of workingRows) {
      const v = row[col];
      if (typeof v === 'number' && Number.isFinite(v)) {
        const flipped = rNum(likertMin + likertMax - v, 6);
        row[col] = flipped !== null ? flipped : likertMin + likertMax - v;
        anyReversed = true;
      }
    }
    if (anyReversed || workingRows.length === 0) {
      reversedColumns.push(col);
    }
  }

  // Filter rows if requested
  const excludedSet = new Set<number>();
  if (removeStraightLiners) {
    for (const idx of straightLinerIndices) excludedSet.add(idx);
  }
  if (removeDuplicates) {
    for (const idx of duplicateRowIndices) excludedSet.add(idx);
  }
  const finalRows = workingRows.filter((_, idx) => !excludedSet.has(idx));

  // Composite scale mean scoring (ignore missing when >= half of items are answered)
  const compositesCreated: string[] = [];
  const seenCompNames = new Set<string>();
  for (const spec of composites) {
    const compName = spec.name.trim();
    const items = spec.items.filter((c) => existingColSet.has(c));
    if (!compName || items.length === 0) continue;
    const compKey = compName.toLocaleLowerCase('tr');
    if (seenCompNames.has(compKey)) continue;
    seenCompNames.add(compKey);

    const minAnswered = Math.ceil(items.length / 2);
    for (const row of finalRows) {
      const vals: number[] = [];
      for (const item of items) {
        const raw = row[item];
        const parsed = typeof raw === 'number' ? raw : parseLikertCell(raw, leadMin, leadMax).value;
        if (parsed !== null && Number.isFinite(parsed)) {
          vals.push(parsed);
        }
      }
      row[compName] = vals.length >= minAnswered ? rNum(mean(vals), 4) : null;
    }
    compositesCreated.push(compName);
  }

  const numericOverrides = new Set<string>([
    ...mappedColumns.filter((m) => m.convertedCount > 0).map((m) => m.column),
    ...reversedColumns,
    ...compositesCreated,
  ]);
  const updatedOrder = [...colNames, ...compositesCreated.filter((c) => !existingColSet.has(c))];
  const updatedColumns = buildUpdatedColumns(finalRows, updatedOrder, numericOverrides);

  const totalConvertedCells = mappedColumns.reduce((acc, m) => acc + m.convertedCount, 0);
  const straightIds = findParticipantLabels(workingRows, colNames, straightLinerIndices);
  const straightListText = straightIds.length > 0 ? ` (${straightIds.join(', ')})` : '';

  const summaryTextTr = [
    `${mappedColumns.length} sözel sütunda ${totalConvertedCells} hücre sayısala çevrildi.`,
    reversedColumns.length > 0
      ? `Ters kodlanan (${likertMin}..${likertMax}): ${reversedColumns.join(', ')}.`
      : 'Ters kodlanan sütun yok.',
    `Straight-liner (SS=0): ${straightLinerIndices.length} satır${straightListText}${removeStraightLiners ? ' (çıkarıldı)' : ' (işaretlendi)'}.`,
    `Tekrarlanan satır: ${duplicateRowIndices.length}${removeDuplicates ? ' (çıkarıldı)' : ''}.`,
    compositesCreated.length > 0 ? `Oluşturulan bileşik ölçekler: ${compositesCreated.join(', ')}.` : '',
    `Sonuç veri seti: N=${finalRows.length} satır, ${updatedColumns.length} sütun.`,
  ]
    .filter(Boolean)
    .join(' ');

  const summaryTextEn = [
    `Converted ${totalConvertedCells} verbal cells across ${mappedColumns.length} column(s).`,
    reversedColumns.length > 0
      ? `Reverse-coded (${likertMin}..${likertMax}): ${reversedColumns.join(', ')}.`
      : 'No columns reverse-coded.',
    `Straight-liners (SD=0): ${straightLinerIndices.length} row(s)${straightListText}${removeStraightLiners ? ' (removed)' : ' (flagged)'}.`,
    `Exact duplicate rows: ${duplicateRowIndices.length}${removeDuplicates ? ' (removed)' : ''}.`,
    compositesCreated.length > 0 ? `Composite scales created: ${compositesCreated.join(', ')}.` : '',
    `Resulting dataset: N=${finalRows.length} rows, ${updatedColumns.length} columns.`,
  ]
    .filter(Boolean)
    .join(' ');

  const cleanedDataset: Dataset = {
    id: dataset.id,
    name: dataset.name,
    description: dataset.description,
    columns: updatedColumns,
    rows: finalRows,
    createdAt: dataset.createdAt,
  };

  return {
    cleanedDataset,
    mappedColumns,
    reversedColumns,
    compositesCreated,
    straightLinerIndices,
    duplicateRowIndices,
    summaryTextTr,
    summaryTextEn,
  };
}

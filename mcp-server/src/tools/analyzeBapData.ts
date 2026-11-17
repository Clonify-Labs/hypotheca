import { ColumnSummaryMeta, DataRow, loadDataset } from '../data/loader.js';

export interface AnalyzeBapDataInput {
  source: string;
  tableOrSheet?: string;
  variables?: string[];
  groupBy?: string;
  includeCorrelations?: boolean;
}

export interface NumericSummary {
  variable: string;
  n: number;
  missing: number;
  mean: number;
  stdError: number;
  median: number;
  sd: number;
  variance: number;
  min: number;
  max: number;
  q1: number;
  q3: number;
  iqr: number;
  skewness: number | null;
  kurtosis: number | null;
}

export interface CategoricalSummary {
  variable: string;
  n: number;
  missing: number;
  levels: { value: string; count: number; percent: number }[];
}

export interface GroupComparisonSummary {
  dependentVariable: string;
  groupBy: string;
  testType: 'welch_t' | 'one_way_anova';
  statisticName: 't' | 'F';
  statistic: number;
  df1: number;
  df2?: number;
  pValue: number;
  effectSizeName: 'cohens_d' | 'eta_squared';
  effectSize: number;
  groups: { group: string; n: number; mean: number; sd: number }[];
}

export interface CorrelationPair {
  varA: string;
  varB: string;
  n: number;
  r: number;
  pValue: number;
}

function round(n: number, decimals = 4): number {
  const f = 10 ** decimals;
  return Math.round(n * f) / f;
}

function mean(arr: number[]): number {
  return arr.reduce((acc, v) => acc + v, 0) / arr.length;
}

function sampleVariance(arr: number[], m = mean(arr)): number {
  if (arr.length < 2) return 0;
  let sumSq = 0;
  for (const x of arr) {
    const d = x - m;
    sumSq += d * d;
  }
  return sumSq / (arr.length - 1);
}

function quantile(sorted: number[], p: number): number {
  if (!sorted.length) return 0;
  if (sorted.length === 1) return sorted[0];
  const idx = (sorted.length - 1) * p;
  const lo = Math.floor(idx);
  const hi = Math.ceil(idx);
  if (lo === hi) return sorted[lo];
  return sorted[lo] + (sorted[hi] - sorted[lo]) * (idx - lo);
}

function spssSkewKurt(arr: number[], m: number, sd: number): { skewness: number | null; kurtosis: number | null } {
  const n = arr.length;
  if (n < 3 || sd === 0) {
    return { skewness: null, kurtosis: null };
  }
  let m3 = 0;
  let m4 = 0;
  for (const x of arr) {
    const z = (x - m) / sd;
    m3 += z ** 3;
    m4 += z ** 4;
  }
  const skewness = (n / ((n - 1) * (n - 2))) * m3;
  if (n < 4) {
    return { skewness: round(skewness, 4), kurtosis: null };
  }
  const term1 = (n * (n + 1)) / ((n - 1) * (n - 2) * (n - 3));
  const term2 = (3 * (n - 1) ** 2) / ((n - 2) * (n - 3));
  const kurtosis = term1 * m4 - term2;
  return { skewness: round(skewness, 4), kurtosis: round(kurtosis, 4) };
}

function logGamma(z: number): number {
  const coef = [
    76.18009172947146,
    -86.50532032941677,
    24.01409824083091,
    -1.231739572450155,
    0.1208650973866179e-2,
    -0.5395239384953e-5,
  ];
  let x = z;
  let y = z;
  let tmp = x + 5.5;
  tmp -= (x + 0.5) * Math.log(tmp);
  let ser = 1.000000000190015;
  for (let j = 0; j < coef.length; j++) {
    y += 1;
    ser += coef[j] / y;
  }
  return -tmp + Math.log((2.5066282746310005 * ser) / x);
}

function betacf(a: number, b: number, x: number): number {
  const MAXIT = 200;
  const EPS = 3e-12;
  const FPMIN = 1e-30;
  const qab = a + b;
  const qap = a + 1;
  const qam = a - 1;
  let c = 1;
  let d = 1 - (qab * x) / qap;
  if (Math.abs(d) < FPMIN) d = FPMIN;
  d = 1 / d;
  let h = d;
  for (let m = 1; m <= MAXIT; m++) {
    const m2 = 2 * m;
    let aa = (m * (b - m) * x) / ((qam + m2) * (a + m2));
    d = 1 + aa * d;
    if (Math.abs(d) < FPMIN) d = FPMIN;
    c = 1 + aa / c;
    if (Math.abs(c) < FPMIN) c = FPMIN;
    d = 1 / d;
    h *= d * c;
    aa = (-(a + m) * (qab + m) * x) / ((a + m2) * (qap + m2));
    d = 1 + aa * d;
    if (Math.abs(d) < FPMIN) d = FPMIN;
    c = 1 + aa / c;
    if (Math.abs(c) < FPMIN) c = FPMIN;
    d = 1 / d;
    const del = d * c;
    h *= del;
    if (Math.abs(del - 1) < EPS) break;
  }
  return h;
}

function regularizedIncompleteBeta(a: number, b: number, x: number): number {
  if (x <= 0) return 0;
  if (x >= 1) return 1;
  const bt = Math.exp(logGamma(a + b) - logGamma(a) - logGamma(b) + a * Math.log(x) + b * Math.log(1 - x));
  if (x < (a + 1) / (a + b + 2)) {
    return (bt * betacf(a, b, x)) / a;
  }
  return 1 - (bt * betacf(b, a, 1 - x)) / b;
}

function twoTailedTPValue(tAbs: number, df: number): number {
  if (!Number.isFinite(tAbs) || df <= 0) return 1;
  if (tAbs === 0) return 1;
  const x = df / (df + tAbs * tAbs);
  const p = regularizedIncompleteBeta(df / 2, 0.5, x);
  return Math.max(0, Math.min(1, p));
}

function fRightTailPValue(fStat: number, df1: number, df2: number): number {
  if (!Number.isFinite(fStat) || fStat <= 0 || df1 <= 0 || df2 <= 0) return 1;
  const x = df2 / (df2 + df1 * fStat);
  const p = regularizedIncompleteBeta(df2 / 2, df1 / 2, x);
  return Math.max(0, Math.min(1, p));
}

function extractNumericColumn(rows: DataRow[], colName: string): number[] {
  const values: number[] = [];
  for (const row of rows) {
    const val = row[colName];
    if (typeof val === 'number' && Number.isFinite(val)) {
      values.push(val);
    }
  }
  return values;
}

function computeNumericSummary(rows: DataRow[], colName: string): NumericSummary | null {
  const arr = extractNumericColumn(rows, colName);
  const n = arr.length;
  if (n === 0) return null;
  const sorted = [...arr].sort((a, b) => a - b);
  const m = mean(arr);
  const vr = sampleVariance(arr, m);
  const sd = Math.sqrt(vr);
  const q1 = quantile(sorted, 0.25);
  const q3 = quantile(sorted, 0.75);
  const { skewness, kurtosis } = spssSkewKurt(arr, m, sd);

  return {
    variable: colName,
    n,
    missing: rows.length - n,
    mean: round(m, 4),
    stdError: round(sd / Math.sqrt(n), 4),
    median: round(quantile(sorted, 0.5), 4),
    sd: round(sd, 4),
    variance: round(vr, 4),
    min: round(sorted[0], 4),
    max: round(sorted[n - 1], 4),
    q1: round(q1, 4),
    q3: round(q3, 4),
    iqr: round(q3 - q1, 4),
    skewness,
    kurtosis,
  };
}

function computeGroupComparison(
  rows: DataRow[],
  depVar: string,
  groupBy: string,
): GroupComparisonSummary | null {
  const buckets = new Map<string, number[]>();
  for (const row of rows) {
    const gRaw = row[groupBy];
    const yVal = row[depVar];
    if (gRaw === null || gRaw === undefined || typeof yVal !== 'number' || !Number.isFinite(yVal)) {
      continue;
    }
    const key = String(gRaw);
    const list = buckets.get(key) ?? [];
    list.push(yVal);
    buckets.set(key, list);
  }

  const groups = Array.from(buckets.entries())
    .filter(([, vals]) => vals.length >= 2)
    .map(([group, vals]) => {
      const m = mean(vals);
      const vr = sampleVariance(vals, m);
      return {
        group,
        vals,
        n: vals.length,
        mean: m,
        variance: vr,
        sd: Math.sqrt(vr),
      };
    });

  if (groups.length < 2 || groups.length > 15) {
    return null;
  }

  if (groups.length === 2) {
    const [g1, g2] = groups;
    const se1 = g1.variance / g1.n;
    const se2 = g2.variance / g2.n;
    const seTotal = Math.sqrt(se1 + se2);
    if (seTotal === 0) return null;
    const t = (g1.mean - g2.mean) / seTotal;
    const num = (se1 + se2) ** 2;
    const den = se1 ** 2 / (g1.n - 1) + se2 ** 2 / (g2.n - 1);
    const df = den > 0 ? num / den : g1.n + g2.n - 2;
    const pooledSd = Math.sqrt(
      ((g1.n - 1) * g1.variance + (g2.n - 1) * g2.variance) / (g1.n + g2.n - 2),
    );
    const cohensD = pooledSd > 0 ? (g1.mean - g2.mean) / pooledSd : 0;

    return {
      dependentVariable: depVar,
      groupBy,
      testType: 'welch_t',
      statisticName: 't',
      statistic: round(t, 4),
      df1: round(df, 2),
      pValue: round(twoTailedTPValue(Math.abs(t), df), 6),
      effectSizeName: 'cohens_d',
      effectSize: round(cohensD, 4),
      groups: groups.map((g) => ({
        group: g.group,
        n: g.n,
        mean: round(g.mean, 4),
        sd: round(g.sd, 4),
      })),
    };
  }

  const totalN = groups.reduce((acc, g) => acc + g.n, 0);
  const grandMean =
    groups.reduce((acc, g) => acc + g.vals.reduce((s, x) => s + x, 0), 0) / totalN;

  let ssBetween = 0;
  let ssWithin = 0;
  for (const g of groups) {
    ssBetween += g.n * (g.mean - grandMean) ** 2;
    for (const x of g.vals) {
      ssWithin += (x - g.mean) ** 2;
    }
  }

  const dfBetween = groups.length - 1;
  const dfWithin = totalN - groups.length;
  if (dfWithin <= 0 || ssWithin === 0) return null;

  const msBetween = ssBetween / dfBetween;
  const msWithin = ssWithin / dfWithin;
  const fStat = msBetween / msWithin;
  const ssTotal = ssBetween + ssWithin;
  const etaSquared = ssTotal > 0 ? ssBetween / ssTotal : 0;

  return {
    dependentVariable: depVar,
    groupBy,
    testType: 'one_way_anova',
    statisticName: 'F',
    statistic: round(fStat, 4),
    df1: dfBetween,
    df2: dfWithin,
    pValue: round(fRightTailPValue(fStat, dfBetween, dfWithin), 6),
    effectSizeName: 'eta_squared',
    effectSize: round(etaSquared, 4),
    groups: groups.map((g) => ({
      group: g.group,
      n: g.n,
      mean: round(g.mean, 4),
      sd: round(g.sd, 4),
    })),
  };
}

function computeCorrelations(rows: DataRow[], numericCols: string[]): CorrelationPair[] {
  const limited = numericCols.slice(0, 12);
  const pairs: CorrelationPair[] = [];

  for (let i = 0; i < limited.length; i++) {
    for (let j = i + 1; j < limited.length; j++) {
      const varA = limited[i];
      const varB = limited[j];
      const xs: number[] = [];
      const ys: number[] = [];
      for (const row of rows) {
        const a = row[varA];
        const b = row[varB];
        if (typeof a === 'number' && Number.isFinite(a) && typeof b === 'number' && Number.isFinite(b)) {
          xs.push(a);
          ys.push(b);
        }
      }
      const n = xs.length;
      if (n < 3) continue;
      const mx = mean(xs);
      const my = mean(ys);
      let num = 0;
      let dx2 = 0;
      let dy2 = 0;
      for (let k = 0; k < n; k++) {
        const dx = xs[k] - mx;
        const dy = ys[k] - my;
        num += dx * dy;
        dx2 += dx * dx;
        dy2 += dy * dy;
      }
      const den = Math.sqrt(dx2 * dy2);
      if (den === 0) continue;
      const r = Math.max(-1, Math.min(1, num / den));
      const df = n - 2;
      const tVal = Math.abs(r) >= 1 ? Number.POSITIVE_INFINITY : (r * Math.sqrt(df)) / Math.sqrt(1 - r * r);
      const pValue = Number.isFinite(tVal) ? twoTailedTPValue(Math.abs(tVal), df) : 0;
      pairs.push({
        varA,
        varB,
        n,
        r: round(r, 4),
        pValue: round(pValue, 6),
      });
    }
  }

  return pairs;
}

export async function analyzeBapData(
  dataDir: string,
  input: AnalyzeBapDataInput,
): Promise<{
  source: string;
  format: string;
  tableOrSheet: string;
  observations: number;
  privacyNotice: string;
  suppressedPiiColumns: string[];
  warnings: string[];
  numericDescriptives: NumericSummary[];
  categoricalFrequencies: CategoricalSummary[];
  groupComparisons: GroupComparisonSummary[];
  correlations: CorrelationPair[];
}> {
  const dataset = await loadDataset(dataDir, input.source, input.tableOrSheet);
  const suppressedPiiColumns = dataset.columns.filter((c) => c.piiProtected).map((c) => c.name);
  const colMap = new Map<string, ColumnSummaryMeta>(dataset.columns.map((c) => [c.name, c]));

  let selectedCols: ColumnSummaryMeta[];
  if (input.variables && input.variables.length > 0) {
    selectedCols = [];
    for (const v of input.variables) {
      const meta = colMap.get(v);
      if (!meta) {
        throw new Error(`Değişken "${v}" veri setinde bulunamadı.`);
      }
      if (meta.piiProtected) {
        throw new Error(
          `KVKK koruması: "${v}" kişisel veri sütunu istatistiksel analize dahil edilemez.`,
        );
      }
      selectedCols.push(meta);
    }
  } else {
    selectedCols = dataset.columns.filter((c) => !c.piiProtected);
  }

  const numericCols = selectedCols.filter((c) => c.valueType === 'numeric').map((c) => c.name);
  const numericDescriptives = numericCols
    .map((col) => computeNumericSummary(dataset.rows, col))
    .filter((s): s is NumericSummary => s !== null);

  const categoricalCols = selectedCols.filter(
    (c) => (c.valueType === 'categorical' || c.valueType === 'boolean') && c.uniqueCount <= 25,
  );
  const categoricalFrequencies: CategoricalSummary[] = categoricalCols.map((c) => {
    const counts = new Map<string, number>();
    let validN = 0;
    for (const row of dataset.rows) {
      const val = row[c.name];
      if (val === null || val === undefined) continue;
      validN++;
      const label = String(val);
      counts.set(label, (counts.get(label) ?? 0) + 1);
    }
    const levels = Array.from(counts.entries())
      .sort((a, b) => b[1] - a[1])
      .slice(0, 15)
      .map(([value, count]) => ({
        value,
        count,
        percent: validN > 0 ? round((count / validN) * 100, 2) : 0,
      }));
    return {
      variable: c.name,
      n: validN,
      missing: dataset.rowCount - validN,
      levels,
    };
  });

  const groupComparisons: GroupComparisonSummary[] = [];
  if (input.groupBy) {
    const groupMeta = colMap.get(input.groupBy);
    if (!groupMeta) {
      throw new Error(`Gruplama değişkeni "${input.groupBy}" bulunamadı.`);
    }
    if (groupMeta.piiProtected) {
      throw new Error(
        `KVKK koruması: "${input.groupBy}" kişisel veri sütunu gruplama değişkeni olarak kullanılamaz.`,
      );
    }
    for (const depVar of numericCols) {
      if (depVar === input.groupBy) continue;
      const cmp = computeGroupComparison(dataset.rows, depVar, input.groupBy);
      if (cmp) groupComparisons.push(cmp);
    }
  }

  const includeCorr = input.includeCorrelations !== false;
  const correlations = includeCorr ? computeCorrelations(dataset.rows, numericCols) : [];

  return {
    source: dataset.source,
    format: dataset.format,
    tableOrSheet: dataset.tableOrSheet,
    observations: dataset.rowCount,
    privacyNotice:
      'Yalnızca toplulaştırılmış istatistiksel özetler üretildi; ham katılımcı satırları ve KVKK hassas sütunları dışarı aktarılmadı.',
    suppressedPiiColumns,
    warnings: dataset.warnings,
    numericDescriptives,
    categoricalFrequencies,
    groupComparisons,
    correlations,
  };
}

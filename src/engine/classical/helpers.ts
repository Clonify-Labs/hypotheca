import { AnalysisOutput, DataRow, StatChart, StatTable } from '../../types/interfaces';
import { fCdf } from '../core/distributions';
import { mean, stdDev } from '../core/linalg';
import { StatInputError, toFiniteNumber } from '../core/errors';

export function rNum(val: number | null | undefined, digits = 3): number | null {
  if (val === null || val === undefined || !Number.isFinite(val)) return null;
  const f = Math.pow(10, digits);
  return Math.round(val * f) / f;
}

/** rNum for prose: never prints null / NaN / Infinity (uses '-' for unavailable values). */
export function fmtNum(val: number | null | undefined, digits = 3): number | string {
  return rNum(val, digits) ?? '-';
}

export function sigStars(p: number | null): string {
  if (p === null || !Number.isFinite(p)) return '';
  if (p < 0.01) return '**';
  if (p < 0.05) return '*';
  return '';
}

export function extractNum(rows: DataRow[], col: string): number[] {
  const out: number[] = [];
  for (const r of rows) {
    const v = toFiniteNumber(r[col]);
    if (v !== null) out.push(v);
  }
  return out;
}

export function extractNumMatrix(rows: DataRow[], cols: string[]): number[][] {
  const out: number[][] = [];
  for (const r of rows) {
    const vec: number[] = [];
    let ok = true;
    for (const c of cols) {
      const v = toFiniteNumber(r[c]);
      if (v === null) {
        ok = false;
        break;
      }
      vec.push(v);
    }
    if (ok) out.push(vec);
  }
  return out;
}

export function leveneTest(groups: number[][], center: 'mean' | 'median' = 'mean'): { f: number; df1: number; df2: number; p: number } {
  const k = groups.length;
  const zs: number[][] = groups.map((g) => {
    let c: number;
    if (center === 'median') {
      const s = [...g].sort((a, b) => a - b);
      const mid = Math.floor(s.length / 2);
      c = s.length % 2 === 1 ? s[mid] : 0.5 * (s[mid - 1] + s[mid]);
    } else {
      c = mean(g);
    }
    return g.map((v) => Math.abs(v - c));
  });
  const allZ = zs.flat();
  const N = allZ.length;
  if (k < 2 || N <= k) return { f: 0, df1: Math.max(1, k - 1), df2: 1, p: 1 };
  const gm = mean(allZ);
  let ssb = 0;
  let ssw = 0;
  for (const z of zs) {
    const zm = mean(z);
    ssb += z.length * (zm - gm) ** 2;
    for (const v of z) ssw += (v - zm) ** 2;
  }
  const df1 = k - 1;
  const df2 = N - k;
  const msb = ssb / df1;
  const msw = ssw / df2;
  const f = msw > 0 ? msb / msw : 0;
  const p = 1 - fCdf(f, df1, df2);
  return { f, df1, df2, p };
}

export function pearsonPair(x: number[], y: number[]): { r: number; t: number; p: number } {
  const n = Math.min(x.length, y.length);
  if (n < 3) return { r: 0, t: 0, p: 1 };
  const mx = mean(x);
  const my = mean(y);
  let num = 0;
  let dx2 = 0;
  let dy2 = 0;
  for (let i = 0; i < n; i++) {
    const dx = x[i] - mx;
    const dy = y[i] - my;
    num += dx * dy;
    dx2 += dx * dx;
    dy2 += dy * dy;
  }
  const den = Math.sqrt(dx2 * dy2);
  const r = den > 0 ? Math.max(-1, Math.min(1, num / den)) : 0;
  const df = n - 2;
  const t = Math.abs(r) < 1 - 1e-12 ? r * Math.sqrt(df / (1 - r * r)) : r >= 0 ? 1e6 : -1e6;
  // Lazy circular-safe tCdf import avoided by caller or direct formula:
  return { r, t, p: NaN };
}

export function buildOutput(
  analysisType: string,
  title: string,
  params: Record<string, unknown>,
  summary: Record<string, unknown>,
  tables: StatTable[],
  charts: StatChart[] = [],
  narrativeTr = '',
  narrativeEn = '',
): AnalysisOutput {
  return {
    id: `ana-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
    analysisType,
    title,
    createdAt: new Date().toISOString(),
    params,
    summary,
    tables,
    charts,
    narrativeTr,
    narrativeEn,
  };
}

export function groupNumericBy(rows: DataRow[], numCol: string, groupCol: string): Map<string, number[]> {
  const map = new Map<string, number[]>();
  for (const r of rows) {
    const g = r[groupCol];
    if (g === null || g === undefined || g === '' || (typeof g === 'number' && !Number.isFinite(g))) continue;
    const v = toFiniteNumber(r[numCol]);
    if (v === null) continue;
    const key = String(g);
    if (key.trim() === '') continue;
    if (!map.has(key)) map.set(key, []);
    map.get(key)!.push(v);
  }
  return map;
}

export function twoSamplePooledSD(x1: number[], x2: number[]): number {
  const n1 = x1.length;
  const n2 = x2.length;
  const s1 = stdDev(x1, 1);
  const s2 = stdDev(x2, 1);
  return Math.sqrt(((n1 - 1) * s1 * s1 + (n2 - 1) * s2 * s2) / Math.max(1, n1 + n2 - 2));
}

/**
 * Listwise paired extraction for two numeric columns (same missing-value rules as extractNum).
 */
export function extractPaired(rows: DataRow[], var1: string, var2: string): { x: number[]; y: number[] } {
  const x: number[] = [];
  const y: number[] = [];
  for (const r of rows) {
    const a = toFiniteNumber(r[var1]);
    const b = toFiniteNumber(r[var2]);
    if (a === null || b === null) continue;
    x.push(a);
    y.push(b);
  }
  return { x, y };
}

/** Throws when a numeric variable has no valid values at all (all missing / non-numeric). */
export function assertVariableHasData(rows: DataRow[], col: string): number[] {
  const arr = extractNum(rows, col);
  if (arr.length === 0) {
    throw new StatInputError(
      'ALL_MISSING',
      `"${col}" değişkeninde geçerli sayısal değer yok (tümü eksik veya sayısal olmayan).`,
      `"${col}" has no valid numeric values (all missing or non-numeric).`,
    );
  }
  return arr;
}

/** Throws SINGLE_GROUP when the grouping variable has fewer than 2 usable levels. */
export function assertAtLeastTwoGroups(nGroups: number, groupVar: string, minPerGroup: number): void {
  if (nGroups < 2) {
    throw new StatInputError(
      nGroups === 0 ? 'EMPTY_DATA' : 'SINGLE_GROUP',
      `"${groupVar}" değişkeninde her birinde en az ${minPerGroup} geçerli gözlem bulunan en az 2 grup gereklidir (bulunan: ${nGroups}).`,
      `"${groupVar}" must have at least 2 groups with at least ${minPerGroup} valid observations each (found: ${nGroups}).`,
    );
  }
}

/** Throws TOO_MANY_GROUPS when a 2-group test receives more than 2 levels without an explicit selection. */
export function assertExactlyTwoGroups(keys: string[], groupVar: string): void {
  if (keys.length > 2) {
    throw new StatInputError(
      'TOO_MANY_GROUPS',
      `"${groupVar}" değişkeninde ${keys.length} grup var (${keys.slice(0, 5).join(', ')}); bu test yalnızca 2 grubu karşılaştırır. Karşılaştırılacak 2 grubu seçin veya ANOVA / Kruskal-Wallis kullanın.`,
      `"${groupVar}" has ${keys.length} groups (${keys.slice(0, 5).join(', ')}); this test compares exactly 2 groups. Select 2 groups or use ANOVA / Kruskal-Wallis.`,
    );
  }
}

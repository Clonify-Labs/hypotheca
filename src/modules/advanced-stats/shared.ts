import { DataRow } from '../../types/interfaces';
import { StatInputError, isConstant } from '../../engine/core/errors';

/**
 * Common input validation for listwise numeric models: distinct variables, enough complete
 * cases and no zero-variance column. Throws StatInputError with a specific code.
 */
export function assertModelInputs(mat: number[][], cols: string[], minN: number, labelTr: string, labelEn: string): void {
  if (cols.some((c) => !c)) {
    throw new StatInputError('NO_VARIABLES', `${labelTr}: tüm model değişkenleri seçilmelidir.`, `${labelEn}: all model variables must be selected.`);
  }
  if (new Set(cols).size !== cols.length) {
    throw new StatInputError('DUPLICATE_VARIABLES', `${labelTr}: aynı değişken modelde birden fazla role atanamaz.`, `${labelEn}: the same variable cannot fill more than one model role.`);
  }
  if (mat.length < minN) {
    throw new StatInputError(
      mat.length === 0 ? 'EMPTY_DATA' : 'INSUFFICIENT_N',
      `${labelTr}: tam vaka sayısı (${mat.length}) yetersiz; en az ${minN} gereklidir.`,
      `${labelEn}: number of complete cases (${mat.length}) is insufficient; at least ${minN} are required.`,
    );
  }
  const constant = cols.filter((_, j) => isConstant(mat.map((r) => r[j])));
  if (constant.length) {
    throw new StatInputError(
      'ZERO_VARIANCE',
      `${labelTr}: şu değişkenlerin varyansı sıfır: ${constant.join(', ')}.`,
      `${labelEn}: the following variables have zero variance: ${constant.join(', ')}.`,
    );
  }
}

/** Deterministic Mulberry32 PRNG so bootstrap results are reproducible run-to-run. */
export function makeRng(seed: number): () => number {
  let s = seed | 0;
  return () => {
    s = (s + 0x6d2b79f5) | 0;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function toNum(v: DataRow[string]): number | null {
  if (typeof v === 'number') return Number.isFinite(v) ? v : null;
  if (typeof v === 'string' && v.trim() !== '') {
    const n = Number(v.replace(',', '.'));
    return Number.isFinite(n) ? n : null;
  }
  return null;
}

/** Listwise-complete numeric matrix plus the original row indices kept. */
export function completeNumeric(rows: DataRow[], cols: string[]): { mat: number[][]; idx: number[] } {
  const mat: number[][] = [];
  const idx: number[] = [];
  rows.forEach((r, i) => {
    const vals = cols.map((c) => toNum(r[c]));
    if (vals.every((v) => v !== null)) {
      mat.push(vals as number[]);
      idx.push(i);
    }
  });
  return { mat, idx };
}

export function percentile(sorted: number[], q: number): number {
  if (!sorted.length || !Number.isFinite(q)) return NaN;
  q = Math.min(1, Math.max(0, q));
  const pos = (sorted.length - 1) * q;
  const lo = Math.floor(pos);
  const hi = Math.ceil(pos);
  return sorted[lo] + (sorted[hi] - sorted[lo]) * (pos - lo);
}

/**
 * BFGS quasi-Newton minimizer with central finite-difference gradients and
 * Armijo backtracking. Adequate for the 10–80 parameter ML-SEM problems here.
 */
export function bfgsMinimize(
  fn: (x: number[]) => number,
  x0: number[],
  maxIter = 300,
  gtol = 1e-6,
): { x: number[]; fx: number; iterations: number } {
  const n = x0.length;
  const h = 1e-5;
  const grad = (x: number[]): number[] => {
    const g = new Array<number>(n);
    for (let i = 0; i < n; i++) {
      const xp = x.slice();
      const xm = x.slice();
      xp[i] += h;
      xm[i] -= h;
      g[i] = (fn(xp) - fn(xm)) / (2 * h);
    }
    return g;
  };
  let x = x0.slice();
  let fx = fn(x);
  let g = grad(x);
  let H: number[][] = Array.from({ length: n }, (_, i) => Array.from({ length: n }, (__, j) => (i === j ? 1 : 0)));
  let it = 0;
  for (; it < maxIter; it++) {
    const gNorm = Math.sqrt(g.reduce((s, v) => s + v * v, 0));
    if (gNorm < gtol) break;
    let d = H.map((row) => -row.reduce((s, v, j) => s + v * g[j], 0));
    let slope = d.reduce((s, v, i) => s + v * g[i], 0);
    if (slope >= 0) {
      H = H.map((row, i) => row.map((_, j) => (i === j ? 1 : 0)));
      d = g.map((v) => -v);
      slope = -gNorm * gNorm;
    }
    let step = 1;
    let xNew = x;
    let fNew = fx;
    let accepted = false;
    for (let k = 0; k < 40; k++) {
      xNew = x.map((v, i) => v + step * d[i]);
      fNew = fn(xNew);
      if (Number.isFinite(fNew) && fNew <= fx + 1e-4 * step * slope) {
        accepted = true;
        break;
      }
      step *= 0.5;
    }
    if (!accepted) break;
    const gNew = grad(xNew);
    const s = xNew.map((v, i) => v - x[i]);
    const y = gNew.map((v, i) => v - g[i]);
    const sy = s.reduce((acc, v, i) => acc + v * y[i], 0);
    if (sy > 1e-12) {
      const Hy = H.map((row) => row.reduce((acc, v, j) => acc + v * y[j], 0));
      const yHy = y.reduce((acc, v, i) => acc + v * Hy[i], 0);
      for (let i = 0; i < n; i++) {
        for (let j = 0; j < n; j++) {
          H[i][j] += ((sy + yHy) * s[i] * s[j]) / (sy * sy) - (Hy[i] * s[j] + s[i] * Hy[j]) / sy;
        }
      }
    }
    const converged = Math.abs(fx - fNew) < 1e-12 * (1 + Math.abs(fx));
    x = xNew;
    fx = fNew;
    g = gNew;
    if (converged) break;
  }
  return { x, fx, iterations: it };
}

/** Composite Simpson integration of f on [a, b] with an even number of panels. */
export function simpson(f: (x: number) => number, a: number, b: number, panels = 400): number {
  const n = panels % 2 === 0 ? panels : panels + 1;
  const h = (b - a) / n;
  let s = f(a) + f(b);
  for (let i = 1; i < n; i++) s += (i % 2 === 1 ? 4 : 2) * f(a + i * h);
  return (s * h) / 3;
}

/** log(sum(exp(v))) computed stably. */
export function logSumExp(v: number[]): number {
  if (!v.length) return -Infinity;
  const m = Math.max(...v);
  if (!Number.isFinite(m)) return m;
  return m + Math.log(v.reduce((s, x) => s + Math.exp(x - m), 0));
}

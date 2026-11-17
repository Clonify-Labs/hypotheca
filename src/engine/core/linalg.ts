/**
 * Pure TypeScript linear algebra, SPSS descriptive moments, OLS regression,
 * Jacobi symmetric eigensolver, Varimax/Promax rotations, and Nelder-Mead optimizer.
 */

import { fCdf, tCdf } from './distributions';
import { StatInputError } from './errors';

/** Thrown when a matrix that must be inverted / factorized is singular or not positive definite. */
export class SingularMatrixError extends StatInputError {
  constructor(code: 'SINGULAR_MATRIX' | 'NOT_POSITIVE_DEFINITE' | 'NON_FINITE_MATRIX', context = '') {
    const ctxTr = context ? ` (${context})` : '';
    const msgs: Record<string, [string, string]> = {
      SINGULAR_MATRIX: [
        `Matris tekil veya tekile çok yakın${ctxTr}; değişkenler arasında tam doğrusal bağımlılık (çoklu doğrusallık) veya sabit sütun olabilir.`,
        `Matrix is singular or nearly singular${ctxTr}; variables may be perfectly collinear or constant.`,
      ],
      NOT_POSITIVE_DEFINITE: [
        `Matris pozitif tanımlı değil${ctxTr}; Cholesky ayrıştırması yapılamadı.`,
        `Matrix is not positive definite${ctxTr}; Cholesky decomposition failed.`,
      ],
      NON_FINITE_MATRIX: [
        `Matris sonlu olmayan değerler (NaN/Sonsuz) içeriyor${ctxTr}.`,
        `Matrix contains non-finite values (NaN/Infinity)${ctxTr}.`,
      ],
    };
    super(code, msgs[code][0], msgs[code][1]);
    this.name = 'SingularMatrixError';
    Object.setPrototypeOf(this, SingularMatrixError.prototype);
  }
}

function allFinite(A: number[][]): boolean {
  for (const row of A) for (const v of row) if (!Number.isFinite(v)) return false;
  return true;
}

export function mean(arr: number[]): number {
  if (arr.length === 0) return NaN;
  let s = 0;
  for (let i = 0; i < arr.length; i++) s += arr[i];
  return s / arr.length;
}

export function variance(arr: number[], ddof = 1): number {
  const n = arr.length;
  if (n <= ddof) return 0;
  const m = mean(arr);
  let ss = 0;
  for (let i = 0; i < n; i++) {
    const d = arr[i] - m;
    ss += d * d;
  }
  return ss / (n - ddof);
}

export function stdDev(arr: number[], ddof = 1): number {
  return Math.sqrt(Math.max(0, variance(arr, ddof)));
}

export function quantile(sorted: number[], q: number): number {
  if (sorted.length === 0) return NaN;
  const pos = (sorted.length - 1) * q;
  const base = Math.floor(pos);
  const rest = pos - base;
  if (sorted[base + 1] !== undefined) {
    return sorted[base] + rest * (sorted[base + 1] - sorted[base]);
  }
  return sorted[base];
}

export function spssMoments(arr: number[]): {
  skewness: number | null;
  skewnessSE: number | null;
  skewnessZ: number | null;
  kurtosis: number | null;
  kurtosisSE: number | null;
  kurtosisZ: number | null;
} {
  const x = arr.filter(Number.isFinite);
  const n = x.length;
  if (n < 3) {
    return { skewness: null, skewnessSE: null, skewnessZ: null, kurtosis: null, kurtosisSE: null, kurtosisZ: null };
  }
  const m = mean(x);
  const sd = stdDev(x, 1);
  const skewSE = Math.sqrt((6 * n * (n - 1)) / ((n - 2) * (n + 1) * (n + 3)));
  const kurtSE = n >= 4 ? 2 * skewSE * Math.sqrt((n * n - 1) / ((n - 3) * (n + 5))) : null;
  if (sd === 0) {
    return { skewness: 0, skewnessSE: skewSE, skewnessZ: 0, kurtosis: n >= 4 ? 0 : null, kurtosisSE: kurtSE, kurtosisZ: 0 };
  }
  let s3 = 0;
  let s4 = 0;
  for (let i = 0; i < n; i++) {
    const z = (x[i] - m) / sd;
    s3 += z * z * z;
    s4 += z * z * z * z;
  }
  const skew = (n / ((n - 1) * (n - 2))) * s3;
  const kurt =
    n >= 4
      ? ((n * (n + 1)) / ((n - 1) * (n - 2) * (n - 3))) * s4 - (3 * (n - 1) * (n - 1)) / ((n - 2) * (n - 3))
      : null;

  return {
    skewness: skew,
    skewnessSE: skewSE,
    skewnessZ: skew / skewSE,
    kurtosis: kurt,
    kurtosisSE: kurtSE,
    kurtosisZ: kurt !== null && kurtSE ? kurt / kurtSE : null,
  };
}

export function rankArray(arr: number[]): number[] {
  const indexed = arr.map((v, i) => ({ v, i })).sort((a, b) => a.v - b.v);
  const ranks = new Array<number>(arr.length);
  let i = 0;
  while (i < indexed.length) {
    let j = i;
    while (j + 1 < indexed.length && indexed[j + 1].v === indexed[i].v) j++;
    const avgRank = 0.5 * (i + j) + 1;
    for (let k = i; k <= j; k++) ranks[indexed[k].i] = avgRank;
    i = j + 1;
  }
  return ranks;
}

export function matMul(A: number[][], B: number[][]): number[][] {
  const m = A.length;
  const k = A[0]?.length || 0;
  const n = B[0]?.length || 0;
  const out = Array.from({ length: m }, () => new Array<number>(n).fill(0));
  for (let i = 0; i < m; i++) {
    for (let p = 0; p < k; p++) {
      const aip = A[i][p];
      if (aip === 0) continue;
      for (let j = 0; j < n; j++) {
        out[i][j] += aip * B[p][j];
      }
    }
  }
  return out;
}

export function transpose(A: number[][]): number[][] {
  const m = A.length;
  const n = A[0]?.length || 0;
  const out = Array.from({ length: n }, () => new Array<number>(m).fill(0));
  for (let i = 0; i < m; i++) {
    for (let j = 0; j < n; j++) out[j][i] = A[i][j];
  }
  return out;
}

export function eye(n: number): number[][] {
  return Array.from({ length: n }, (_, i) => Array.from({ length: n }, (__, j) => (i === j ? 1 : 0)));
}

export function covMatrix(X: number[][], ddof = 1): number[][] {
  const n = X.length;
  const p = X[0]?.length || 0;
  const means = new Array<number>(p).fill(0);
  for (let i = 0; i < n; i++) for (let j = 0; j < p; j++) means[j] += X[i][j];
  for (let j = 0; j < p; j++) means[j] /= Math.max(1, n);
  const S = Array.from({ length: p }, () => new Array<number>(p).fill(0));
  const denom = Math.max(1, n - ddof);
  for (let i = 0; i < n; i++) {
    for (let j = 0; j < p; j++) {
      const dj = X[i][j] - means[j];
      for (let k = j; k < p; k++) {
        S[j][k] += dj * (X[i][k] - means[k]);
      }
    }
  }
  for (let j = 0; j < p; j++) {
    for (let k = j; k < p; k++) {
      S[j][k] /= denom;
      S[k][j] = S[j][k];
    }
  }
  return S;
}

export function corrMatrix(X: number[][]): number[][] {
  const S = covMatrix(X, 1);
  const p = S.length;
  const R = Array.from({ length: p }, () => new Array<number>(p).fill(0));
  for (let i = 0; i < p; i++) {
    for (let j = 0; j < p; j++) {
      if (i === j) {
        R[i][j] = 1;
      } else {
        const d = Math.sqrt(Math.max(0, S[i][i] * S[j][j]));
        R[i][j] = d > 0 ? S[i][j] / d : 0;
      }
    }
  }
  return R;
}

/**
 * Gauss-Jordan inverse with partial pivoting; returns null if singular.
 */
export function invMatrix(A: number[][]): number[][] | null {
  const n = A.length;
  if (n === 0 || !allFinite(A) || A.some((r) => r.length !== n)) return null;
  const aug = A.map((row, i) => [...row, ...Array.from({ length: n }, (_, j) => (i === j ? 1 : 0))]);
  for (let col = 0; col < n; col++) {
    let pivotRow = col;
    let maxVal = Math.abs(aug[col][col]);
    for (let r = col + 1; r < n; r++) {
      if (Math.abs(aug[r][col]) > maxVal) {
        maxVal = Math.abs(aug[r][col]);
        pivotRow = r;
      }
    }
    if (maxVal < 1e-12) return null;
    if (pivotRow !== col) {
      const tmp = aug[col];
      aug[col] = aug[pivotRow];
      aug[pivotRow] = tmp;
    }
    const piv = aug[col][col];
    for (let j = 0; j < 2 * n; j++) aug[col][j] /= piv;
    for (let r = 0; r < n; r++) {
      if (r === col) continue;
      const factor = aug[r][col];
      if (factor === 0) continue;
      for (let j = 0; j < 2 * n; j++) aug[r][j] -= factor * aug[col][j];
    }
  }
  const inv = aug.map((row) => row.slice(n));
  return allFinite(inv) ? inv : null;
}

/**
 * Inverse that throws a typed SingularMatrixError instead of returning null.
 * Also rejects ill-conditioned matrices whose pivots are tiny relative to the matrix scale.
 */
export function invMatrixStrict(A: number[][], context = ''): number[][] {
  if (!allFinite(A)) throw new SingularMatrixError('NON_FINITE_MATRIX', context);
  const n = A.length;
  let scale = 0;
  for (const row of A) for (const v of row) scale = Math.max(scale, Math.abs(v));
  if (n === 0 || scale === 0) throw new SingularMatrixError('SINGULAR_MATRIX', context);
  const inv = invMatrix(A.map((r) => r.map((v) => v / scale)));
  if (!inv) throw new SingularMatrixError('SINGULAR_MATRIX', context);
  // Reciprocal condition estimate in the infinity norm.
  const normInf = (M: number[][]): number => Math.max(...M.map((r) => r.reduce((s, v) => s + Math.abs(v), 0)));
  const rcond = 1 / (normInf(A.map((r) => r.map((v) => v / scale))) * normInf(inv));
  if (!(rcond > 1e-14)) throw new SingularMatrixError('SINGULAR_MATRIX', context);
  return inv.map((r) => r.map((v) => v / scale));
}

/**
 * Cholesky factorization A = L L^T for symmetric positive-definite A.
 * Throws SingularMatrixError('NOT_POSITIVE_DEFINITE') instead of returning NaN-filled garbage.
 */
export function cholesky(A: number[][], context = ''): number[][] {
  if (!allFinite(A)) throw new SingularMatrixError('NON_FINITE_MATRIX', context);
  const n = A.length;
  let scale = 0;
  for (let i = 0; i < n; i++) scale = Math.max(scale, Math.abs(A[i][i]));
  const tol = 1e-12 * Math.max(1, scale);
  const L = Array.from({ length: n }, () => new Array<number>(n).fill(0));
  for (let i = 0; i < n; i++) {
    for (let j = 0; j <= i; j++) {
      let s = A[i][j];
      for (let k = 0; k < j; k++) s -= L[i][k] * L[j][k];
      if (i === j) {
        if (!(s > tol)) throw new SingularMatrixError('NOT_POSITIVE_DEFINITE', context);
        L[i][j] = Math.sqrt(s);
      } else {
        L[i][j] = s / L[j][j];
      }
    }
  }
  return L;
}

/**
 * Symmetric Jacobi eigensolver returning sorted descending eigenvalues & column eigenvectors.
 */
export function jacobiEigen(A: number[][], maxIter = 200): { values: number[]; vectors: number[][] } {
  const n = A.length;
  const D = A.map((r) => [...r]);
  const V = eye(n);

  for (let iter = 0; iter < maxIter * n * n; iter++) {
    let p = 0;
    let q = 1;
    let maxOff = 0;
    for (let i = 0; i < n; i++) {
      for (let j = i + 1; j < n; j++) {
        const val = Math.abs(D[i][j]);
        if (val > maxOff) {
          maxOff = val;
          p = i;
          q = j;
        }
      }
    }
    if (maxOff < 1e-12) break;
    const app = D[p][p];
    const aqq = D[q][q];
    const apq = D[p][q];
    const tau = (aqq - app) / (2 * apq);
    const t = tau >= 0 ? 1 / (tau + Math.sqrt(1 + tau * tau)) : -1 / (-tau + Math.sqrt(1 + tau * tau));
    const c = 1 / Math.sqrt(1 + t * t);
    const s = t * c;

    D[p][p] = app - t * apq;
    D[q][q] = aqq + t * apq;
    D[p][q] = 0;
    D[q][p] = 0;
    for (let r = 0; r < n; r++) {
      if (r !== p && r !== q) {
        const drp = D[r][p];
        const drq = D[r][q];
        D[r][p] = D[p][r] = c * drp - s * drq;
        D[r][q] = D[q][r] = s * drp + c * drq;
      }
    }
    for (let r = 0; r < n; r++) {
      const vrp = V[r][p];
      const vrq = V[r][q];
      V[r][p] = c * vrp - s * vrq;
      V[r][q] = s * vrp + c * vrq;
    }
  }

  const pairs = D.map((row, idx) => ({ val: row[idx], vec: V.map((r) => r[idx]) })).sort((a, b) => b.val - a.val);
  const values = pairs.map((p) => p.val);
  const vectors = Array.from({ length: n }, (_, i) => pairs.map((p) => p.vec[i]));
  return { values, vectors };
}

/**
 * Moore-Penrose pseudoinverse via symmetric eigendecomposition of A^T A or symmetric A.
 */
export function pinvSymmetric(A: number[][], tol = 1e-9): number[][] {
  if (!allFinite(A)) throw new SingularMatrixError('NON_FINITE_MATRIX', 'pseudo-inverse');
  const { values, vectors } = jacobiEigen(A);
  const n = A.length;
  const invDiag = values.map((v) => (Math.abs(v) > tol ? 1 / v : 0));
  const out = Array.from({ length: n }, () => new Array<number>(n).fill(0));
  for (let i = 0; i < n; i++) {
    for (let j = 0; j < n; j++) {
      let s = 0;
      for (let k = 0; k < n; k++) {
        s += vectors[i][k] * invDiag[k] * vectors[j][k];
      }
      out[i][j] = s;
    }
  }
  return out;
}

export function detAndLogDet(A: number[][]): { det: number; logDet: number; pd: boolean } {
  const n = A.length;
  const M = A.map((r) => [...r]);
  let det = 1;
  let logDet = 0;
  for (let i = 0; i < n; i++) {
    let piv = i;
    for (let r = i + 1; r < n; r++) {
      if (Math.abs(M[r][i]) > Math.abs(M[piv][i])) piv = r;
    }
    if (Math.abs(M[piv][i]) < 1e-15) return { det: 0, logDet: -Infinity, pd: false };
    if (piv !== i) {
      const tmp = M[i];
      M[i] = M[piv];
      M[piv] = tmp;
      det *= -1;
    }
    const diag = M[i][i];
    det *= diag;
    if (diag <= 0) return { det: 0, logDet: -Infinity, pd: false };
    logDet += Math.log(diag);
    for (let r = i + 1; r < n; r++) {
      const f = M[r][i] / diag;
      for (let c = i; c < n; c++) M[r][c] -= f * M[i][c];
    }
  }
  return { det, logDet, pd: det > 0 };
}

export interface OlsResult {
  beta: number[];
  se: number[];
  t: number[];
  p: number[];
  stdBeta: (number | null)[];
  vif: (number | null)[];
  r: number;
  r2: number;
  adjR2: number;
  see: number;
  f: number;
  fP: number;
  dfModel: number;
  dfResid: number;
  ssReg: number;
  ssResid: number;
  ssTotal: number;
  dw: number;
  fitted: number[];
  resid: number[];
  leverage: number[];
  cooksD: number[];
  covBeta: number[][];
}

export function olsFit(y: number[], XNoConst: number[][]): OlsResult {
  const n = y.length;
  const k = XNoConst[0]?.length || 0;
  if (n === 0 || XNoConst.length !== n) {
    throw new StatInputError('EMPTY_DATA', 'Regresyon için geçerli gözlem bulunamadı.', 'No valid observations for regression.');
  }
  if (!y.every(Number.isFinite) || !allFinite(XNoConst)) {
    throw new StatInputError(
      'NON_FINITE_INPUT',
      'Regresyon girdisi sonlu olmayan değerler (NaN/Sonsuz) içeriyor.',
      'Regression input contains non-finite values (NaN/Infinity).',
    );
  }
  if (n <= k + 1) {
    throw new StatInputError(
      'INSUFFICIENT_N',
      `Regresyon için gözlem sayısı (${n}) parametre sayısından (${k + 1}) büyük olmalıdır (n > p + 1).`,
      `Regression requires more observations (${n}) than parameters (${k + 1}) (n > p + 1).`,
    );
  }
  const X = XNoConst.map((row) => [1, ...row]);
  const pCols = k + 1;
  const Xt = transpose(X);
  const XtX = matMul(Xt, X);
  const XtXInv = invMatrix(XtX) || pinvSymmetric(XtX);
  const Xty = Xt.map((row) => row.reduce((s, v, idx) => s + v * y[idx], 0));
  const beta = XtXInv.map((row) => row.reduce((s, v, j) => s + v * Xty[j], 0));

  const fitted = X.map((row) => row.reduce((s, v, j) => s + v * beta[j], 0));
  const resid = y.map((yi, i) => yi - fitted[i]);
  const meanY = mean(y);
  let ssResid = 0;
  let ssTotal = 0;
  for (let i = 0; i < n; i++) {
    ssResid += resid[i] * resid[i];
    ssTotal += (y[i] - meanY) * (y[i] - meanY);
  }
  const ssReg = Math.max(0, ssTotal - ssResid);
  const dfModel = k;
  const dfResid = Math.max(1, n - pCols);
  const mse = ssResid / dfResid;
  const see = Math.sqrt(Math.max(0, mse));
  const r2 = ssTotal > 0 ? Math.max(0, Math.min(1, 1 - ssResid / ssTotal)) : 0;
  const adjR2 = n > pCols ? 1 - ((1 - r2) * (n - 1)) / dfResid : r2;
  const msReg = dfModel > 0 ? ssReg / dfModel : 0;
  const f = mse > 0 && dfModel > 0 ? msReg / mse : 0;
  const fP = dfModel > 0 ? 1 - fCdf(f, dfModel, dfResid) : 1;

  const covBeta = XtXInv.map((row) => row.map((v) => v * mse));
  const se = covBeta.map((row, i) => Math.sqrt(Math.max(1e-18, row[i])));
  const tVals = beta.map((b, i) => (se[i] > 0 ? b / se[i] : 0));
  const pVals = tVals.map((tv) => 2 * (1 - tCdf(Math.abs(tv), dfResid)));

  const sdY = stdDev(y, 1);
  const stdBeta: (number | null)[] = [null];
  const vif: (number | null)[] = [null];
  for (let j = 0; j < k; j++) {
    const xj = XNoConst.map((r) => r[j]);
    const sdXj = stdDev(xj, 1);
    stdBeta.push(sdY > 0 ? beta[j + 1] * (sdXj / sdY) : 0);
    if (k === 1) {
      vif.push(1);
    } else {
      const otherX = XNoConst.map((r) => r.filter((_, idx) => idx !== j));
      const subFit = olsFitBasicR2(xj, otherX);
      vif.push(subFit < 0.99999 ? 1 / (1 - subFit) : 9999);
    }
  }

  let dwNum = 0;
  for (let i = 1; i < n; i++) {
    const d = resid[i] - resid[i - 1];
    dwNum += d * d;
  }
  const dw = ssResid > 0 ? dwNum / ssResid : 2;

  // Leverage h_ii and Cook's D
  const leverage = X.map((row) => {
    const prod = XtXInv.map((invRow) => invRow.reduce((s, v, j) => s + v * row[j], 0));
    return row.reduce((s, v, j) => s + v * prod[j], 0);
  });
  const cooksD = resid.map((ei, i) => {
    const hii = Math.min(0.999, Math.max(0, leverage[i]));
    return mse > 0 ? ((ei * ei) / (pCols * mse)) * (hii / Math.pow(1 - hii, 2)) : 0;
  });

  return {
    beta,
    se,
    t: tVals,
    p: pVals,
    stdBeta,
    vif,
    r: Math.sqrt(r2),
    r2,
    adjR2,
    see,
    f,
    fP,
    dfModel,
    dfResid,
    ssReg,
    ssResid,
    ssTotal,
    dw,
    fitted,
    resid,
    leverage,
    cooksD,
    covBeta,
  };
}

function olsFitBasicR2(y: number[], XNoConst: number[][]): number {
  const n = y.length;
  const X = XNoConst.map((row) => [1, ...row]);
  const Xt = transpose(X);
  const XtX = matMul(Xt, X);
  const XtXInv = invMatrix(XtX) || pinvSymmetric(XtX);
  const Xty = Xt.map((row) => row.reduce((s, v, idx) => s + v * y[idx], 0));
  const beta = XtXInv.map((row) => row.reduce((s, v, j) => s + v * Xty[j], 0));
  const my = mean(y);
  let ssr = 0;
  let sst = 0;
  for (let i = 0; i < n; i++) {
    const yh = X[i].reduce((s, v, j) => s + v * beta[j], 0);
    ssr += (y[i] - yh) ** 2;
    sst += (y[i] - my) ** 2;
  }
  return sst > 0 ? Math.max(0, Math.min(1, 1 - ssr / sst)) : 0;
}

/**
 * Kaiser-normalized Varimax rotation matching SPSS / psych::principal.
 */
export function varimaxRotate(loadings: number[][], gamma = 1, maxIter = 100): number[][] {
  const p = loadings.length;
  const k = loadings[0]?.length || 0;
  if (k <= 1) return loadings.map((r) => [...r]);

  const h = loadings.map((row) => {
    const nrm = Math.sqrt(row.reduce((s, v) => s + v * v, 0));
    return nrm > 0 ? nrm : 1;
  });
  const A = loadings.map((row, i) => row.map((v) => v / h[i]));

  // Pairwise planar rotation (Kaiser 1958) — exact & doesn't require full non-square SVD
  const L = A.map((r) => [...r]);
  for (let iter = 0; iter < maxIter; iter++) {
    let maxAngle = 0;
    for (let c1 = 0; c1 < k; c1++) {
      for (let c2 = c1 + 1; c2 < k; c2++) {
        let A_sum = 0;
        let B_sum = 0;
        let C_sum = 0;
        let D_sum = 0;
        for (let i = 0; i < p; i++) {
          const x = L[i][c1];
          const y = L[i][c2];
          const u = x * x - y * y;
          const v = 2 * x * y;
          A_sum += u;
          B_sum += v;
          C_sum += u * u - v * v;
          D_sum += 2 * u * v;
        }
        const num = D_sum - (2 * gamma * A_sum * B_sum) / p;
        const den = C_sum - (gamma * (A_sum * A_sum - B_sum * B_sum)) / p;
        const phi = 0.25 * Math.atan2(num, den);
        if (Math.abs(phi) > 1e-8) {
          maxAngle = Math.max(maxAngle, Math.abs(phi));
          const cosP = Math.cos(phi);
          const sinP = Math.sin(phi);
          for (let i = 0; i < p; i++) {
            const x = L[i][c1];
            const y = L[i][c2];
            L[i][c1] = x * cosP + y * sinP;
            L[i][c2] = -x * sinP + y * cosP;
          }
        }
      }
    }
    if (maxAngle < 1e-7) break;
  }

  return L.map((row, i) => row.map((v) => v * h[i]));
}

/**
 * Nelder-Mead derivative-free minimizer for ML SEM / Logistic / Survival optimization.
 */
export function nelderMead(
  fn: (x: number[]) => number,
  x0: number[],
  maxIter = 800,
  tol = 1e-7,
): { x: number[]; fx: number } {
  const n = x0.length;
  const simplex: { x: number[]; fx: number }[] = [{ x: [...x0], fx: fn(x0) }];
  for (let i = 0; i < n; i++) {
    const xi = [...x0];
    xi[i] = xi[i] !== 0 ? xi[i] * 1.08 : 0.05;
    simplex.push({ x: xi, fx: fn(xi) });
  }

  for (let iter = 0; iter < maxIter; iter++) {
    simplex.sort((a, b) => a.fx - b.fx);
    const best = simplex[0];
    const worst = simplex[n];
    const secondWorst = simplex[n - 1];
    if (Math.abs(worst.fx - best.fx) < tol) break;

    const centroid = new Array<number>(n).fill(0);
    for (let i = 0; i < n; i++) {
      for (let j = 0; j < n; j++) centroid[j] += simplex[i].x[j] / n;
    }

    const xr = centroid.map((c, j) => c + 1.0 * (c - worst.x[j]));
    const fxr = fn(xr);

    if (fxr < best.fx) {
      const xe = centroid.map((c, j) => c + 2.0 * (xr[j] - c));
      const fxe = fn(xe);
      simplex[n] = fxe < fxr ? { x: xe, fx: fxe } : { x: xr, fx: fxr };
    } else if (fxr < secondWorst.fx) {
      simplex[n] = { x: xr, fx: fxr };
    } else {
      const xc =
        fxr < worst.fx
          ? centroid.map((c, j) => c + 0.5 * (xr[j] - c))
          : centroid.map((c, j) => c + 0.5 * (worst.x[j] - c));
      const fxc = fn(xc);
      if (fxc < Math.min(fxr, worst.fx)) {
        simplex[n] = { x: xc, fx: fxc };
      } else {
        for (let i = 1; i <= n; i++) {
          const xs = simplex[i].x.map((v, j) => best.x[j] + 0.5 * (v - best.x[j]));
          simplex[i] = { x: xs, fx: fn(xs) };
        }
      }
    }
  }
  simplex.sort((a, b) => a.fx - b.fx);
  return simplex[0];
}

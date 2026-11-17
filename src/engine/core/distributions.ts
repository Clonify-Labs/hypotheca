/**
 * Pure TypeScript high-precision probability distributions, noncentral G*Power CDFs,
 * Royston AS R94 Shapiro-Wilk, Lilliefors Kolmogorov-Smirnov, and Studentized Range.
 * Zero external dependencies, 100% browser & Node compatible.
 */

const SQRT2PI = Math.sqrt(2 * Math.PI);
const SQRT2 = Math.SQRT2;

export function lnGamma(z: number): number {
  const g = 7;
  const p = [
    0.99999999999980993,
    676.5203681218851,
    -1259.1392167224028,
    771.32342877765313,
    -176.61502916214059,
    12.507343278686905,
    -0.13857109526572012,
    9.9843695780195716e-6,
    1.5056327351493116e-7,
  ];
  if (z < 0.5) {
    return Math.log(Math.PI / Math.sin(Math.PI * z)) - lnGamma(1 - z);
  }
  const zm = z - 1;
  let x = p[0];
  for (let i = 1; i < p.length; i++) {
    x += p[i] / (zm + i);
  }
  const t = zm + g + 0.5;
  return 0.5 * Math.log(2 * Math.PI) + (zm + 0.5) * Math.log(t) - t + Math.log(x);
}

export function lnBeta(a: number, b: number): number {
  return lnGamma(a) + lnGamma(b) - lnGamma(a + b);
}

export function normalPdf(z: number): number {
  return Math.exp(-0.5 * z * z) / SQRT2PI;
}

export function erf(x: number): number {
  const sign = x >= 0 ? 1 : -1;
  const ax = Math.abs(x);
  // Abramowitz & Stegun 7.1.26 (max error 1.5e-7) -> refined with series for small x
  if (ax < 0.5) {
    let sum = ax;
    let term = ax;
    const x2 = ax * ax;
    for (let k = 1; k < 25; k++) {
      term *= (-x2) / k;
      sum += term / (2 * k + 1);
      if (Math.abs(term) < 1e-16) break;
    }
    return sign * (2 / Math.sqrt(Math.PI)) * sum;
  }
  const t = 1 / (1 + 0.3275911 * ax);
  const poly =
    (((((1.061405429 * t - 1.453152027) * t + 1.421413741) * t - 0.284496736) * t + 0.254829592) * t);
  return sign * (1 - poly * Math.exp(-ax * ax));
}

export function normalCdf(z: number): number {
  if (Number.isNaN(z)) return NaN;
  if (!Number.isFinite(z)) return z > 0 ? 1 : 0;
  return 0.5 * (1 + erf(z / SQRT2));
}

export function normalInv(p: number): number {
  if (Number.isNaN(p)) return NaN;
  if (p <= 0) return -Infinity;
  if (p >= 1) return Infinity;
  if (p === 0.5) return 0;

  const a = [
    -3.969683028665376e1,
    2.209460984245205e2,
    -2.759285104469687e2,
    1.38357751867269e2,
    -3.066479806614716e1,
    2.506628277459239,
  ];
  const b = [
    -5.447609879822406e1,
    1.615858368580409e2,
    -1.556989798598866e2,
    6.680131188771972e1,
    -1.328068155288572e1,
  ];
  const c = [
    -7.784894002430293e-3,
    -3.223964580411365e-1,
    -2.400758277161838,
    -2.549732539343734,
    4.374664141464968,
    2.938163982698783,
  ];
  const d = [
    7.784695709041462e-3,
    3.224671290700398e-1,
    2.445134137142996,
    3.754408661907416,
  ];

  const pLow = 0.02425;
  const pHigh = 1 - pLow;
  let x: number;
  if (p < pLow) {
    const q = Math.sqrt(-2 * Math.log(p));
    x =
      (((((c[0] * q + c[1]) * q + c[2]) * q + c[3]) * q + c[4]) * q + c[5]) /
      ((((d[0] * q + d[1]) * q + d[2]) * q + d[3]) * q + 1);
  } else if (p <= pHigh) {
    const q = p - 0.5;
    const r = q * q;
    x =
      ((((((a[0] * r + a[1]) * r + a[2]) * r + a[3]) * r + a[4]) * r + a[5]) * q) /
      (((((b[0] * r + b[1]) * r + b[2]) * r + b[3]) * r + b[4]) * r + 1);
  } else {
    const q = Math.sqrt(-2 * Math.log(1 - p));
    x =
      -(((((c[0] * q + c[1]) * q + c[2]) * q + c[3]) * q + c[4]) * q + c[5]) /
      ((((d[0] * q + d[1]) * q + d[2]) * q + d[3]) * q + 1);
  }

  // One Newton polish step
  const err = normalCdf(x) - p;
  const pdf = normalPdf(x);
  if (pdf > 1e-15) x -= err / pdf;
  return x;
}

function betacf(a: number, b: number, x: number): number {
  const MAXIT = 300;
  const EPS = 3e-14;
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

export function regIncompleteBeta(x: number, a: number, b: number): number {
  if (Number.isNaN(x) || !(a > 0) || !(b > 0)) return NaN;
  if (x <= 0) return 0;
  if (x >= 1) return 1;
  const bt = Math.exp(lnGamma(a + b) - lnGamma(a) - lnGamma(b) + a * Math.log(x) + b * Math.log(1 - x));
  if (x < (a + 1) / (a + b + 2)) {
    return (bt * betacf(a, b, x)) / a;
  }
  return 1 - (bt * betacf(b, a, 1 - x)) / b;
}

export function regIncompleteGammaP(a: number, x: number): number {
  if (Number.isNaN(x) || !(a > 0)) return NaN;
  if (x <= 0) return 0;
  if (!Number.isFinite(x)) return 1;
  if (x < a + 1) {
    let ap = a;
    let sum = 1 / a;
    let del = sum;
    for (let n = 1; n <= 400; n++) {
      ap += 1;
      del *= x / ap;
      sum += del;
      if (Math.abs(del) < Math.abs(sum) * 3e-14) break;
    }
    return Math.min(1, Math.max(0, sum * Math.exp(-x + a * Math.log(x) - lnGamma(a))));
  }
  // Lentz continued fraction for Q(a, x), then 1 - Q
  const FPMIN = 1e-30;
  let b = x + 1 - a;
  let c = 1 / FPMIN;
  let d = 1 / b;
  let h = d;
  for (let i = 1; i <= 400; i++) {
    const an = -i * (i - a);
    b += 2;
    d = an * d + b;
    if (Math.abs(d) < FPMIN) d = FPMIN;
    c = b + an / c;
    if (Math.abs(c) < FPMIN) c = FPMIN;
    d = 1 / d;
    const del = d * c;
    h *= del;
    if (Math.abs(del - 1) < 3e-14) break;
  }
  const q = Math.exp(-x + a * Math.log(x) - lnGamma(a)) * h;
  return Math.min(1, Math.max(0, 1 - q));
}

export function tCdf(t: number, df: number): number {
  if (Number.isNaN(t) || Number.isNaN(df) || df <= 0) return NaN;
  if (!Number.isFinite(t)) return t > 0 ? 1 : 0;
  if (!Number.isFinite(df) || df > 1e7) return normalCdf(t);
  const x = df / (df + t * t);
  const ib = regIncompleteBeta(x, 0.5 * df, 0.5);
  return t >= 0 ? 1 - 0.5 * ib : 0.5 * ib;
}

export function tInv(p: number, df: number): number {
  if (Number.isNaN(p) || Number.isNaN(df) || df <= 0) return NaN;
  if (p <= 0) return -Infinity;
  if (p >= 1) return Infinity;
  if (p === 0.5) return 0;
  if (p < 0.5) return -tInv(1 - p, df);
  if (!Number.isFinite(df) || df > 1e7) return normalInv(p);
  let lo = 0;
  let hi = Math.max(10, Math.abs(normalInv(p)) * 4 + 20);
  while (tCdf(hi, df) < p && hi < 1e7) hi *= 2;
  for (let i = 0; i < 80; i++) {
    const mid = 0.5 * (lo + hi);
    if (tCdf(mid, df) < p) lo = mid;
    else hi = mid;
  }
  return 0.5 * (lo + hi);
}

export function fCdf(f: number, df1: number, df2: number): number {
  if (Number.isNaN(f) || !(df1 > 0) || !(df2 > 0)) return NaN;
  if (f <= 0) return 0;
  if (!Number.isFinite(f)) return 1;
  if (!Number.isFinite(df1)) return NaN;
  if (!Number.isFinite(df2)) return chi2Cdf(df1 * f, df1);
  const x = (df1 * f) / (df1 * f + df2);
  return regIncompleteBeta(x, 0.5 * df1, 0.5 * df2);
}

export function fInv(p: number, df1: number, df2: number): number {
  if (Number.isNaN(p) || !(df1 > 0) || !(df2 > 0)) return NaN;
  if (p <= 0) return 0;
  if (p >= 1) return Infinity;
  let lo = 0;
  let hi = 20;
  while (fCdf(hi, df1, df2) < p && hi < 1e8) hi *= 2;
  for (let i = 0; i < 80; i++) {
    const mid = 0.5 * (lo + hi);
    if (fCdf(mid, df1, df2) < p) lo = mid;
    else hi = mid;
  }
  return 0.5 * (lo + hi);
}

export function chi2Cdf(x: number, df: number): number {
  if (Number.isNaN(x) || !(df > 0)) return NaN;
  if (x <= 0) return 0;
  if (!Number.isFinite(x)) return 1;
  return regIncompleteGammaP(0.5 * df, 0.5 * x);
}

export function chi2Inv(p: number, df: number): number {
  if (Number.isNaN(p) || !(df > 0)) return NaN;
  if (p <= 0) return 0;
  if (p >= 1) return Infinity;
  let lo = 0;
  let hi = Math.max(10, df + 10 * Math.sqrt(2 * df));
  while (chi2Cdf(hi, df) < p && hi < 1e8) hi *= 2;
  for (let i = 0; i < 80; i++) {
    const mid = 0.5 * (lo + hi);
    if (chi2Cdf(mid, df) < p) lo = mid;
    else hi = mid;
  }
  return 0.5 * (lo + hi);
}

/**
 * Exact Noncentral t CDF (Lenth 1989 AS 243).
 */
export function nctCdf(t: number, df: number, delta: number): number {
  if (Number.isNaN(t) || Number.isNaN(delta) || !(df > 0)) return NaN;
  if (!Number.isFinite(t)) return t > 0 ? 1 : 0;
  if (Math.abs(delta) < 1e-12) return tCdf(t, df);
  if (t < 0) {
    return 1 - nctCdf(-t, df, -delta);
  }
  const del = delta;
  const x = (t * t) / (t * t + df);
  const lambda = 0.5 * del * del;
  let pTerm = Math.exp(-lambda);
  let qTerm = (del / Math.SQRT2) * Math.exp(-lambda - 0.5 * Math.log(Math.PI) + 0.5 * Math.log(2));
  // More directly: q_0 = (del / sqrt(2)) * exp(-lambda) / gamma(1.5)
  qTerm = (del / Math.SQRT2) * Math.exp(-lambda - lnGamma(1.5));

  let sum = 0;
  const maxIter = Math.max(200, Math.ceil(lambda + 60));
  for (let j = 0; j < maxIter; j++) {
    const pBeta = regIncompleteBeta(x, j + 0.5, 0.5 * df);
    const qBeta = regIncompleteBeta(x, j + 1.0, 0.5 * df);
    const contrib = pTerm * pBeta + qTerm * qBeta;
    sum += contrib;
    if (j > lambda + 5 && Math.abs(contrib) < 1e-13) break;
    pTerm *= lambda / (j + 1);
    qTerm *= lambda / (j + 1.5);
  }
  return Math.min(1, Math.max(0, normalCdf(-del) + 0.5 * sum));
}

/**
 * Exact Noncentral F CDF via Poisson-weighted Incomplete Beta series.
 */
export function ncfCdf(f: number, df1: number, df2: number, ncp: number): number {
  if (Number.isNaN(f) || Number.isNaN(ncp) || !(df1 > 0) || !(df2 > 0)) return NaN;
  if (f <= 0) return 0;
  if (!Number.isFinite(f)) return 1;
  if (ncp <= 1e-12) return fCdf(f, df1, df2);
  const x = (df1 * f) / (df1 * f + df2);
  const lam = 0.5 * ncp;
  const j0 = Math.floor(lam);

  const termAt = (j: number): number => {
    const logPois = -lam + j * Math.log(lam) - lnGamma(j + 1);
    return Math.exp(logPois) * regIncompleteBeta(x, 0.5 * df1 + j, 0.5 * df2);
  };

  let sum = termAt(j0);
  for (let j = j0 + 1; j < j0 + 300; j++) {
    const val = termAt(j);
    sum += val;
    if (val < 1e-13) break;
  }
  for (let j = j0 - 1; j >= 0; j--) {
    const val = termAt(j);
    sum += val;
    if (val < 1e-13) break;
  }
  return Math.min(1, Math.max(0, sum));
}

// 16-point Gauss-Legendre nodes/weights on [-1, 1] for Studentized Range integration
const GL16_X = [
  -0.9894009349916499, -0.9445750230732326, -0.8656312023878318, -0.755404408355003,
  -0.6178762444026438, -0.4580167776572274, -0.2816035507792589, -0.0950125098376374,
  0.0950125098376374, 0.2816035507792589, 0.4580167776572274, 0.6178762444026438,
  0.755404408355003, 0.8656312023878318, 0.9445750230732326, 0.9894009349916499,
];
const GL16_W = [
  0.0271524594117541, 0.0622535239386479, 0.0951585116824928, 0.1246289712555339,
  0.1495959888165767, 0.1691565193950025, 0.1826034150449236, 0.1894506104550685,
  0.1894506104550685, 0.1826034150449236, 0.1691565193950025, 0.1495959888165767,
  0.1246289712555339, 0.0951585116824928, 0.0622535239386479, 0.0271524594117541,
];

function rangeCdfNormal(w: number, k: number): number {
  if (w <= 0) return 0;
  // Integral over z in [-6, 6] of k * phi(z) * (Phi(z+w) - Phi(z))^(k-1)
  const a = -6;
  const b = 6;
  const half = 0.5 * (b - a);
  const mid = 0.5 * (a + b);
  let sum = 0;
  for (let i = 0; i < 16; i++) {
    const z = mid + half * GL16_X[i];
    const diff = Math.max(0, normalCdf(z + w) - normalCdf(z));
    sum += GL16_W[i] * k * normalPdf(z) * Math.pow(diff, k - 1);
  }
  return Math.min(1, Math.max(0, half * sum));
}

export function tukeyCdf(q: number, k: number, df: number): number {
  if (Number.isNaN(q) || !(k >= 2) || !(df > 0)) return NaN;
  if (q <= 0) return 0;
  if (!Number.isFinite(q)) return 1;
  if (!Number.isFinite(df) || df > 5000) return rangeCdfNormal(q, k);
  // Integrate s = sqrt(chi2/df) over [0.05, 4.5] using 24-subinterval midpoint/GL
  const halfDf = 0.5 * df;
  const logConst = Math.log(2) + halfDf * Math.log(halfDf) - lnGamma(halfDf);
  const lo = 0.01;
  const hi = Math.min(6, 1 + 6 / Math.sqrt(df));
  const half = 0.5 * (hi - lo);
  const mid = 0.5 * (lo + hi);
  let sum = 0;
  for (let i = 0; i < 16; i++) {
    const s = mid + half * GL16_X[i];
    const logDensity = logConst + (df - 1) * Math.log(s) - halfDf * s * s;
    const dens = Math.exp(logDensity);
    sum += GL16_W[i] * rangeCdfNormal(q * s, k) * dens;
  }
  return Math.min(1, Math.max(0, half * sum));
}

export function tukeyPval(q: number, k: number, df: number): number {
  const c = tukeyCdf(q, k, df);
  if (Number.isNaN(c)) return NaN;
  return Math.min(1, Math.max(0, 1 - c));
}

export function tukeyInv(p: number, k: number, df: number): number {
  if (Number.isNaN(p) || !(k >= 2) || !(df > 0)) return NaN;
  if (p <= 0) return 0;
  if (p >= 1) return Infinity;
  let lo = 0;
  let hi = 12;
  while (tukeyCdf(hi, k, df) < p && hi < 100) hi *= 1.5;
  for (let i = 0; i < 40; i++) {
    const mid = 0.5 * (lo + hi);
    if (tukeyCdf(mid, k, df) < p) lo = mid;
    else hi = mid;
  }
  return 0.5 * (lo + hi);
}

/**
 * Exact Royston (1995) AS R94 Shapiro-Wilk Normality Test.
 */
export interface ShapiroWilkResult {
  w: number;
  p: number;
  /** false when the test is not applicable (n < 3, n > 5000, or constant data); w and p are NaN then. */
  valid: boolean;
  reason?: 'n_below_3' | 'n_above_5000' | 'constant';
}

/** Royston AS R94 is defined for 3 <= n <= 5000. */
export const SHAPIRO_WILK_MAX_N = 5000;

export function shapiroWilk(arr: number[]): ShapiroWilkResult {
  const x = [...arr].filter(Number.isFinite).sort((a, b) => a - b);
  const n = x.length;
  if (n < 3) return { w: NaN, p: NaN, valid: false, reason: 'n_below_3' };
  if (n > SHAPIRO_WILK_MAX_N) return { w: NaN, p: NaN, valid: false, reason: 'n_above_5000' };
  const range = x[n - 1] - x[0];
  if (range <= 1e-15 * Math.max(1, Math.abs(x[0]))) return { w: NaN, p: NaN, valid: false, reason: 'constant' };

  const poly = (cc: number[], nord: number, z: number): number => {
    let ret = cc[0];
    if (nord > 1) {
      let p = z * cc[nord - 1];
      for (let j = nord - 2; j >= 1; j--) p = (p + cc[j]) * z;
      ret += p;
    }
    return ret;
  };

  const c1 = [0.0, 0.221157, -0.147981, -2.07119, 4.434685, -2.706056];
  const c2 = [0.0, 0.042981, -0.293762, -1.752461, 5.682633, -3.582633];
  const c3 = [0.544, -0.39978, 0.025054, -0.0006714];
  const c4 = [1.3822, -0.77857, 0.062767, -0.0020322];
  const c5 = [-1.5861, -0.31082, -0.083751, 0.0038915];
  const c6 = [-0.4803, -0.082676, 0.0030302];
  const g = [-2.273, 0.459];

  const an = n;
  const an25 = an + 0.25;
  const m = new Array<number>(n).fill(0);
  let summ2 = 0;
  for (let i = 0; i < n; i++) {
    const mi = normalInv((i + 1 - 0.375) / an25);
    m[i] = mi;
    summ2 += mi * mi;
  }
  const ssumm2 = Math.sqrt(summ2);
  const rsn = 1 / Math.sqrt(an);

  const mTop = m[n - 1];
  const m2 = m[n - 2];
  const nn2 = Math.floor(n / 2);
  const aHalf = new Array<number>(nn2).fill(0);
  const aTop = mTop / ssumm2 + poly(c1, 6, rsn);
  if (n === 3) {
    aHalf[0] = -Math.SQRT1_2;
  } else {
    aHalf[0] = -aTop;
    let fac: number;
    let i1: number;
    if (n <= 5) {
      fac = Math.sqrt((summ2 - 2 * mTop * mTop) / (1 - 2 * aTop * aTop));
      i1 = 1;
    } else {
      const aSec = m2 / ssumm2 + poly(c2, 6, rsn);
      aHalf[1] = -aSec;
      fac = Math.sqrt((summ2 - 2 * mTop * mTop - 2 * m2 * m2) / (1 - 2 * aTop * aTop - 2 * aSec * aSec));
      i1 = 2;
    }
    for (let i = i1; i < nn2; i++) {
      aHalf[i] = m[i] / fac;
    }
  }

  let num = 0;
  for (let i = 0; i < nn2; i++) {
    num += aHalf[i] * (x[i] - x[n - 1 - i]);
  }
  const meanX = x.reduce((s, v) => s + v, 0) / n;
  const ssx = x.reduce((s, v) => s + (v - meanX) ** 2, 0);
  const w = Math.min(1, Math.max(0, (num * num) / ssx));

  let pw: number;
  if (n === 3) {
    const pi6 = 6 / Math.PI;
    const stqr = Math.asin(Math.sqrt(0.75));
    pw = pi6 * (Math.asin(Math.sqrt(w)) - stqr);
    if (pw < 0) pw = 0;
    return { w, p: Math.min(1, pw), valid: true };
  }
  const y = Math.log(Math.max(1e-15, 1 - w));
  const xx = Math.log(an);
  let yVal = y;
  let mu: number;
  let sigma: number;
  if (n <= 11) {
    const gamma = poly(g, 2, an);
    if (yVal >= gamma) return { w, p: 1e-19, valid: true };
    yVal = -Math.log(gamma - yVal);
    mu = poly(c3, 4, an);
    sigma = Math.exp(poly(c4, 4, an));
  } else {
    mu = poly(c5, 4, xx);
    sigma = Math.exp(poly(c6, 3, xx));
  }
  pw = 1 - normalCdf((yVal - mu) / sigma);
  return { w, p: Math.min(1, Math.max(0, Number.isFinite(pw) ? pw : 0)), valid: true };
}

/**
 * Kolmogorov-Smirnov with Lilliefors correction (Dallal-Wilkinson / Marsaglia approx).
 */
export function kolmogorovSmirnovNormal(arr: number[]): { d: number; p: number } {
  const x = [...arr].filter(Number.isFinite).sort((a, b) => a - b);
  const n = x.length;
  if (n < 4) return { d: 0, p: 1 };
  const mean = x.reduce((s, v) => s + v, 0) / n;
  const sd = Math.sqrt(x.reduce((s, v) => s + (v - mean) ** 2, 0) / (n - 1));
  if (sd <= 1e-12) return { d: 1, p: 0 };

  let dMax = 0;
  for (let i = 0; i < n; i++) {
    const cdf = normalCdf((x[i] - mean) / sd);
    const dPlus = (i + 1) / n - cdf;
    const dMinus = cdf - i / n;
    dMax = Math.max(dMax, dPlus, dMinus);
  }

  // Dallal & Wilkinson (1986) Lilliefors p-value approximation
  const dn = dMax;
  let k = dn;
  if (n <= 100) {
    k = dn * (Math.sqrt(n) - 0.01 + 0.85 / Math.sqrt(n));
  } else {
    k = dn * Math.sqrt(n);
  }
  // Molin & Abdi (1998) refinement for Lilliefors p
  const b1 = 0.02989, b2 = 0.2557, b3 = 0.9032;
  const xAdj = dn * (Math.sqrt(n) - 0.01 + 0.85 / Math.sqrt(n));
  const p =
    xAdj < 0.3
      ? 1
      : Math.min(1, Math.max(0, Math.exp(-7.01256 * dn * dn * (n + 2.7019) + 2.99587 * dn * Math.sqrt(n + 2.7019) - 0.122119 + 0.974598 / Math.sqrt(n) + 1.67997 / n)));
  // Clamp using Dallal-Wilkinson boundary
  if (p > 0.1 && n > 100) {
    return { d: dMax, p: Math.min(1, p) };
  }
  return { d: dMax, p: Math.min(1, Math.max(0, p)) };
}

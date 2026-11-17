import { AnalysisOutput, Dataset, StatTable } from '../../types/interfaces';
import { chi2Cdf, normalCdf } from '../../engine/core/distributions';
import { corrMatrix, detAndLogDet, invMatrix, matMul, pinvSymmetric, transpose } from '../../engine/core/linalg';
import { buildOutput, rNum, sigStars, fmtNum } from '../../engine/classical/helpers';
import { bfgsMinimize, completeNumeric } from './shared';
import { StatInputError, clampP, isConstant } from '../../engine/core/errors';

export interface CfaFactorSpec {
  name: string;
  indicators: string[];
}

interface GroupMoments {
  label: string;
  n: number;
  S: number[][]; // ML covariance (divisor n)
  m: number[];
  logDetS: number;
}

type InvarianceLevel = 'configural' | 'metric' | 'scalar';

interface FitResult {
  level: InvarianceLevel;
  chi2: number;
  df: number;
  p: number;
  cfi: number;
  tli: number;
  rmsea: number;
  srmr: number;
  nParams: number;
  lambdaByGroup: number[][][];
}

function mlMoments(mat: number[][], label: string): GroupMoments {
  const n = mat.length;
  const p = mat[0].length;
  const m = Array.from({ length: p }, (_, j) => mat.reduce((s, r) => s + r[j], 0) / n);
  const S = Array.from({ length: p }, () => new Array<number>(p).fill(0));
  for (const r of mat) {
    for (let i = 0; i < p; i++) {
      for (let j = i; j < p; j++) S[i][j] += ((r[i] - m[i]) * (r[j] - m[j])) / n;
    }
  }
  for (let i = 0; i < p; i++) for (let j = 0; j < i; j++) S[i][j] = S[j][i];
  return { label, n, S, m, logDetS: detAndLogDet(S).logDet };
}

/** ML discrepancy for one group; returns Infinity when Σ is not positive definite. */
function groupDiscrepancy(g: GroupMoments, Sigma: number[][], mu: number[] | null): number {
  const p = Sigma.length;
  const { logDet, pd } = detAndLogDet(Sigma);
  if (!pd) return Infinity;
  const inv = invMatrix(Sigma);
  if (!inv) return Infinity;
  let tr = 0;
  for (let i = 0; i < p; i++) for (let j = 0; j < p; j++) tr += g.S[i][j] * inv[j][i];
  let meanTerm = 0;
  if (mu) {
    const d = g.m.map((v, i) => v - mu[i]);
    for (let i = 0; i < p; i++) for (let j = 0; j < p; j++) meanTerm += d[i] * inv[i][j] * d[j];
  }
  const f = logDet + tr - g.logDetS - p + meanTerm;
  return Number.isFinite(f) ? f : Infinity;
}

function srmrFor(g: GroupMoments, Sigma: number[][]): number {
  const p = Sigma.length;
  let s = 0;
  let c = 0;
  for (let i = 0; i < p; i++) {
    for (let j = 0; j <= i; j++) {
      const denom = Math.sqrt(g.S[i][i] * g.S[j][j]);
      s += ((g.S[i][j] - Sigma[i][j]) / denom) ** 2;
      c++;
    }
  }
  return Math.sqrt(s / c);
}

function fitMultiGroup(
  groups: GroupMoments[],
  loadPairs: { iIdx: number; fIdx: number }[],
  p: number,
  m: number,
  level: InvarianceLevel,
): FitResult {
  const G = groups.length;
  const nLoad = loadPairs.length;
  const nCov = (m * (m - 1)) / 2;
  const sharedLoad = level !== 'configural';
  const withMeans = level === 'scalar';

  // Parameter layout
  const layout: { lam: number[][]; theta: number[][]; corr: number[][]; lvar: number[][]; tau: number[]; kappa: number[][] } = {
    lam: [],
    theta: [],
    corr: [],
    lvar: [],
    tau: [],
    kappa: [],
  };
  let k = 0;
  const x0: number[] = [];
  const pushParam = (v: number) => {
    x0.push(v);
    return k++;
  };
  const pooledVar = Array.from({ length: p }, (_, i) => groups.reduce((s, g) => s + g.S[i][i] * g.n, 0) / groups.reduce((s, g) => s + g.n, 0));
  const pooledMean = Array.from({ length: p }, (_, i) => groups.reduce((s, g) => s + g.m[i] * g.n, 0) / groups.reduce((s, g) => s + g.n, 0));

  for (let g = 0; g < G; g++) {
    if (g === 0 || !sharedLoad) {
      layout.lam.push(loadPairs.map((lp) => pushParam(Math.sqrt(0.6 * pooledVar[lp.iIdx]))));
    } else {
      layout.lam.push(layout.lam[0]);
    }
    layout.theta.push(Array.from({ length: p }, (_, i) => pushParam(Math.log(0.4 * pooledVar[i]))));
    layout.corr.push(Array.from({ length: nCov }, () => pushParam(0.3)));
    layout.lvar.push(Array.from({ length: m }, () => (g > 0 && sharedLoad ? pushParam(0) : -1)));
  }
  if (withMeans) {
    layout.tau = pooledMean.map((v) => pushParam(v));
    for (let g = 0; g < G; g++) layout.kappa.push(Array.from({ length: m }, () => (g > 0 ? pushParam(0) : -1)));
  }

  const implied = (x: number[], g: number): { Sigma: number[][]; mu: number[] | null; Lambda: number[][] } => {
    const Lambda = Array.from({ length: p }, () => new Array<number>(m).fill(0));
    loadPairs.forEach((lp, li) => {
      Lambda[lp.iIdx][lp.fIdx] = x[layout.lam[g][li]];
    });
    const sd = layout.lvar[g].map((idx) => (idx < 0 ? 1 : Math.exp(0.5 * x[idx])));
    const Phi = Array.from({ length: m }, (_, i) => Array.from({ length: m }, (__, j) => (i === j ? sd[i] * sd[i] : 0)));
    let c = 0;
    for (let a = 0; a < m; a++) {
      for (let b = a + 1; b < m; b++) {
        const r = Math.tanh(x[layout.corr[g][c]]);
        Phi[a][b] = Phi[b][a] = r * sd[a] * sd[b];
        c++;
      }
    }
    const Sigma = matMul(matMul(Lambda, Phi), transpose(Lambda));
    for (let i = 0; i < p; i++) Sigma[i][i] += Math.exp(x[layout.theta[g][i]]);
    let mu: number[] | null = null;
    if (withMeans) {
      const kap = layout.kappa[g].map((idx) => (idx < 0 ? 0 : x[idx]));
      mu = layout.tau.map((ti, i) => x[ti] + Lambda[i].reduce((s, l, f) => s + l * kap[f], 0));
    }
    return { Sigma, mu, Lambda };
  };

  const objective = (x: number[]) => {
    let total = 0;
    for (let g = 0; g < G; g++) {
      const { Sigma, mu } = implied(x, g);
      const f = groupDiscrepancy(groups[g], Sigma, mu);
      if (!Number.isFinite(f)) return 1e10;
      total += groups[g].n * f;
    }
    return total;
  };

  const opt = bfgsMinimize(objective, x0, 400);
  const chi2 = Math.max(0, opt.fx);
  const nParams = x0.length;
  const moments = G * ((p * (p + 1)) / 2 + (withMeans ? p : 0));
  // Configural/metric leave the mean structure saturated (free intercepts per group)
  const df = withMeans ? moments - nParams : moments - nParams;
  const N = groups.reduce((s, g) => s + g.n, 0);

  const chi2Base = groups.reduce((s, g) => s + g.n * (g.S.reduce((acc, row, i) => acc + Math.log(row[i]), 0) - g.logDetS), 0);
  const dfBase = (G * p * (p - 1)) / 2;
  const cfi = 1 - Math.max(0, chi2 - df) / Math.max(chi2 - df, chi2Base - dfBase, 1e-9);
  const tli = (chi2Base / dfBase - chi2 / df) / (chi2Base / dfBase - 1);
  const rmsea = Math.sqrt(G) * Math.sqrt(Math.max(0, (chi2 - df) / (df * N)));
  const srmr = groups.reduce((s, g, gi) => s + srmrFor(g, implied(opt.x, gi).Sigma), 0) / G;

  return {
    level,
    chi2,
    df,
    p: df > 0 ? clampP(1 - chi2Cdf(chi2, df)) : NaN,
    cfi: Math.min(1, Math.max(0, cfi)),
    tli: Math.min(1, tli),
    rmsea,
    srmr,
    nParams,
    lambdaByGroup: groups.map((_, gi) => implied(opt.x, gi).Lambda),
  };
}

export function runMeasurementInvariance(
  dataset: Dataset,
  opts: { groupVar: string; factors: CfaFactorSpec[] },
): AnalysisOutput {
  const factors = opts.factors.filter((f) => f.indicators.length >= 2);
  if (!factors.length) {
    throw new StatInputError('TOO_FEW_ITEMS', 'En az bir faktör ve faktör başına en az 2 gösterge gereklidir.', 'At least one factor with at least 2 indicators is required.');
  }
  if (!opts.groupVar) {
    throw new StatInputError('NO_VARIABLES', 'Ölçme değişmezliği için grup değişkeni seçilmelidir.', 'A grouping variable is required for measurement invariance.');
  }
  const indicators = Array.from(new Set(factors.flatMap((f) => f.indicators)));
  const p = indicators.length;
  const m = factors.length;
  const loadPairs = factors.flatMap((f, fIdx) => f.indicators.map((ind) => ({ iIdx: indicators.indexOf(ind), fIdx })));

  const byGroup = new Map<string, number[][]>();
  const { mat, idx } = completeNumeric(dataset.rows, indicators);
  mat.forEach((row, i) => {
    const gv = dataset.rows[idx[i]][opts.groupVar];
    if (gv === null || gv === undefined || gv === '') return;
    const key = String(gv);
    const arr = byGroup.get(key) ?? [];
    arr.push(row);
    byGroup.set(key, arr);
  });
  const smallGroups = Array.from(byGroup.entries()).filter(([, rows]) => rows.length < p + 5).map(([g, rows]) => `${g} (n=${rows.length})`);
  const groups = Array.from(byGroup.entries())
    .filter(([, rows]) => rows.length >= p + 5)
    .sort((a, b) => a[0].localeCompare(b[0], 'tr'))
    .map(([label, rows]) => mlMoments(rows, label));
  if (groups.length < 2) {
    throw new StatInputError(
      byGroup.size < 2 ? 'SINGLE_GROUP' : 'INSUFFICIENT_N',
      `"${opts.groupVar}" için her birinde en az ${p + 5} tam vaka bulunan en az 2 grup gereklidir${smallGroups.length ? `; yetersiz gruplar: ${smallGroups.join(', ')}` : ''}.`,
      `"${opts.groupVar}" needs at least 2 groups with at least ${p + 5} complete cases each${smallGroups.length ? `; insufficient groups: ${smallGroups.join(', ')}` : ''}.`,
    );
  }
  for (const g of Array.from(byGroup.entries()).filter(([, rows]) => rows.length >= p + 5)) {
    const constant = indicators.filter((_, j) => isConstant(g[1].map((r) => r[j])));
    if (constant.length) {
      throw new StatInputError(
        'ZERO_VARIANCE',
        `"${g[0]}" grubunda şu göstergelerin varyansı sıfır: ${constant.join(', ')}; ölçme değişmezliği kestirilemez.`,
        `In group "${g[0]}" the following indicators have zero variance: ${constant.join(', ')}; invariance cannot be estimated.`,
      );
    }
  }

  const fits = (['configural', 'metric', 'scalar'] as InvarianceLevel[]).map((lvl) => fitMultiGroup(groups, loadPairs, p, m, lvl));
  const levelTr: Record<InvarianceLevel, string> = { configural: 'Yapısal (Configural)', metric: 'Metrik (Zayıf)', scalar: 'Skaler (Güçlü)' };

  const comparisons = [1, 2].map((i) => {
    const a = fits[i - 1];
    const b = fits[i];
    const dChi = b.chi2 - a.chi2;
    const dDf = b.df - a.df;
    const pD = dDf > 0 ? clampP(1 - chi2Cdf(Math.max(0, dChi), dDf)) : NaN;
    const dCfi = b.cfi - a.cfi;
    const dRmsea = b.rmsea - a.rmsea;
    const holds = dCfi >= -0.01 && dRmsea <= 0.015;
    return { from: a.level, to: b.level, dChi, dDf, pD, dCfi, dRmsea, holds };
  });

  const highest = comparisons[0].holds ? (comparisons[1].holds ? 'scalar' : 'metric') : 'configural';

  const fitTable: StatTable = {
    id: 'mi_fit',
    title: 'Ölçüm Değişmezliği Model Uyumları',
    columns: [
      { key: 'model', label: 'Model' },
      { key: 'chi2', label: 'χ²', numeric: true },
      { key: 'df', label: 'sd', numeric: true },
      { key: 'p', label: 'p', numeric: true },
      { key: 'cfi', label: 'CFI', numeric: true },
      { key: 'tli', label: 'TLI', numeric: true },
      { key: 'rmsea', label: 'RMSEA', numeric: true },
      { key: 'srmr', label: 'SRMR', numeric: true },
    ],
    rows: fits.map((f) => ({
      model: levelTr[f.level],
      chi2: rNum(f.chi2, 3),
      df: f.df,
      p: rNum(f.p, 4),
      cfi: rNum(f.cfi, 3),
      tli: rNum(f.tli, 3),
      rmsea: rNum(f.rmsea, 3),
      srmr: rNum(f.srmr, 3),
    })),
  };

  const cmpTable: StatTable = {
    id: 'mi_compare',
    title: 'Model Karşılaştırmaları (Chen, 2007 ölçütleri: ΔCFI ≥ -.010, ΔRMSEA ≤ .015)',
    columns: [
      { key: 'comparison', label: 'Karşılaştırma' },
      { key: 'dChi', label: 'Δχ²', numeric: true },
      { key: 'dDf', label: 'Δsd', numeric: true },
      { key: 'pD', label: 'p (Δχ²)', numeric: true },
      { key: 'dCfi', label: 'ΔCFI', numeric: true },
      { key: 'dRmsea', label: 'ΔRMSEA', numeric: true },
      { key: 'decision', label: 'Karar' },
    ],
    rows: comparisons.map((c) => ({
      comparison: `${levelTr[c.to]} vs ${levelTr[c.from]}`,
      dChi: rNum(c.dChi, 3),
      dDf: c.dDf,
      pD: rNum(c.pD, 4),
      dCfi: rNum(c.dCfi, 4),
      dRmsea: rNum(c.dRmsea, 4),
      decision: c.holds ? 'Değişmezlik sağlandı' : 'Değişmezlik reddedildi',
    })),
  };

  const loadTable: StatTable = {
    id: 'mi_loadings',
    title: 'Yapısal Modelde Grup Bazlı Ham Faktör Yükleri',
    columns: [
      { key: 'item', label: 'Gösterge' },
      { key: 'factor', label: 'Faktör' },
      ...groups.map((g, gi) => ({ key: `g${gi}`, label: g.label, numeric: true })),
    ],
    rows: loadPairs.map((lp) => {
      const row: Record<string, string | number | null> = { item: indicators[lp.iIdx], factor: factors[lp.fIdx].name };
      groups.forEach((_, gi) => {
        row[`g${gi}`] = rNum(fits[0].lambdaByGroup[gi][lp.iIdx][lp.fIdx], 3);
      });
      return row;
    }),
  };

  return buildOutput(
    'measurement_invariance',
    `Çok Gruplu DFA Ölçüm Değişmezliği (${opts.groupVar}: ${groups.map((g) => g.label).join(' / ')})`,
    { ...opts },
    {
      groups: groups.map((g) => ({ label: g.label, n: g.n })),
      configural: { chi2: rNum(fits[0].chi2, 3), df: fits[0].df, cfi: rNum(fits[0].cfi, 4), rmsea: rNum(fits[0].rmsea, 4) },
      metric: { chi2: rNum(fits[1].chi2, 3), df: fits[1].df, cfi: rNum(fits[1].cfi, 4), rmsea: rNum(fits[1].rmsea, 4) },
      scalar: { chi2: rNum(fits[2].chi2, 3), df: fits[2].df, cfi: rNum(fits[2].cfi, 4), rmsea: rNum(fits[2].rmsea, 4) },
      deltaCfiMetric: rNum(comparisons[0].dCfi, 4),
      deltaCfiScalar: rNum(comparisons[1].dCfi, 4),
      highestLevel: highest,
    },
    [fitTable, cmpTable, loadTable],
    [],
    `${opts.groupVar} grupları arasında yapılan çok gruplu DFA'da yapısal model CFI = ${fmtNum(fits[0].cfi, 3)}, RMSEA = ${fmtNum(fits[0].rmsea, 3)} uyum göstermiştir. Metrik değişmezlik için ΔCFI = ${fmtNum(comparisons[0].dCfi, 3)}, skaler değişmezlik için ΔCFI = ${fmtNum(comparisons[1].dCfi, 3)} bulunmuş; ulaşılan en yüksek değişmezlik düzeyi: ${levelTr[highest]}.`,
    `Multi-group CFA across ${opts.groupVar}: configural CFI = ${fmtNum(fits[0].cfi, 3)}, RMSEA = ${fmtNum(fits[0].rmsea, 3)}. ΔCFI (metric) = ${fmtNum(comparisons[0].dCfi, 3)}, ΔCFI (scalar) = ${fmtNum(comparisons[1].dCfi, 3)}; highest supported level: ${highest}.`,
  );
}

function numericHessian(fn: (x: number[]) => number, x: number[], h = 1e-4): number[][] {
  const n = x.length;
  const f0 = fn(x);
  const H = Array.from({ length: n }, () => new Array<number>(n).fill(0));
  for (let i = 0; i < n; i++) {
    for (let j = i; j < n; j++) {
      if (i === j) {
        const xp = x.slice();
        const xm = x.slice();
        xp[i] += h;
        xm[i] -= h;
        H[i][i] = (fn(xp) - 2 * f0 + fn(xm)) / (h * h);
      } else {
        const a = x.slice();
        const b = x.slice();
        const c = x.slice();
        const d = x.slice();
        a[i] += h; a[j] += h;
        b[i] += h; b[j] -= h;
        c[i] -= h; c[j] += h;
        d[i] -= h; d[j] -= h;
        H[i][j] = H[j][i] = (fn(a) - fn(b) - fn(c) + fn(d)) / (4 * h * h);
      }
    }
  }
  return H;
}

export function runSecondOrderCfa(
  dataset: Dataset,
  opts: { secondOrderName: string; firstOrderFactors: CfaFactorSpec[] },
): AnalysisOutput {
  const factors = opts.firstOrderFactors.filter((f) => f.indicators.length >= 2);
  const k = factors.length;
  if (k < 3) {
    throw new StatInputError(
      'TOO_FEW_ITEMS',
      'İkinci düzey DFA için en az 2 göstergeli en az 3 birinci düzey faktör gereklidir (tanımlanabilirlik).',
      'Second-order CFA requires at least 3 first-order factors with at least 2 indicators each (identification).',
    );
  }
  const indicators = Array.from(new Set(factors.flatMap((f) => f.indicators)));
  const p = indicators.length;
  const { mat } = completeNumeric(dataset.rows, indicators);
  const N = mat.length;
  if (N < p + 10) {
    throw new StatInputError(
      N === 0 ? 'EMPTY_DATA' : 'INSUFFICIENT_N',
      `İkinci düzey DFA için tam vaka sayısı (${N}) yetersiz; en az ${p + 10} gereklidir.`,
      `Insufficient complete cases (${N}) for second-order CFA; at least ${p + 10} are required.`,
    );
  }
  {
    const constant = indicators.filter((_, j) => isConstant(mat.map((r) => r[j])));
    if (constant.length) {
      throw new StatInputError('ZERO_VARIANCE', `İkinci düzey DFA: şu göstergelerin varyansı sıfır: ${constant.join(', ')}.`, `Second-order CFA: the following indicators have zero variance: ${constant.join(', ')}.`);
    }
  }
  const R = corrMatrix(mat);
  const logDetR = detAndLogDet(R).logDet;
  const loadPairs = factors.flatMap((f, fIdx) => f.indicators.map((ind) => ({ iIdx: indicators.indexOf(ind), fIdx })));
  const nLoad = loadPairs.length;

  // Sign-orient start values for gammas from first-order composite correlations
  const comps = factors.map((f) => mat.map((r) => f.indicators.reduce((s, ind) => s + r[indicators.indexOf(ind)], 0)));
  const compR = corrMatrix(comps[0].map((_, i) => comps.map((c) => c[i])));
  const gammaSign = factors.map((_, j) => (j === 0 ? 1 : Math.sign(compR[0][j]) || 1));

  const x0 = [
    ...new Array<number>(nLoad).fill(0.75),
    ...new Array<number>(p).fill(Math.log(0.4)),
    ...gammaSign.map((s) => Math.atanh(0.7 * s)),
  ];

  const build = (x: number[]) => {
    const Lambda = Array.from({ length: p }, () => new Array<number>(k).fill(0));
    loadPairs.forEach((lp, i) => {
      Lambda[lp.iIdx][lp.fIdx] = x[i];
    });
    const gamma = Array.from({ length: k }, (_, j) => Math.tanh(x[nLoad + p + j]));
    const Phi = Array.from({ length: k }, (_, a) => Array.from({ length: k }, (__, b) => (a === b ? 1 : gamma[a] * gamma[b])));
    const Sigma = matMul(matMul(Lambda, Phi), transpose(Lambda));
    for (let i = 0; i < p; i++) Sigma[i][i] += Math.exp(x[nLoad + i]);
    return { Sigma, Lambda, gamma };
  };

  const fml = (x: number[]) => {
    const { Sigma } = build(x);
    const g: GroupMoments = { label: 'all', n: N, S: R, m: [], logDetS: logDetR };
    const f = groupDiscrepancy(g, Sigma, null);
    return Number.isFinite(f) ? f : 1e6;
  };

  const opt = bfgsMinimize(fml, x0, 500);
  const fMin = Math.max(0, opt.fx);
  const { Sigma, Lambda, gamma } = build(opt.x);
  const chi2 = (N - 1) * fMin;
  const nParams = x0.length;
  const df = (p * (p + 1)) / 2 - nParams;
  const pChi = df > 0 ? clampP(1 - chi2Cdf(chi2, df)) : NaN;
  const chi2Base = (N - 1) * Math.max(0, -logDetR);
  const dfBase = (p * (p - 1)) / 2;
  const cfi = Math.min(1, Math.max(0, 1 - Math.max(0, chi2 - df) / Math.max(chi2 - df, chi2Base - dfBase, 1e-9)));
  const tli = Math.min(1, (chi2Base / dfBase - chi2 / df) / (chi2Base / dfBase - 1));
  const rmsea = Math.sqrt(Math.max(0, (chi2 - df) / (df * (N - 1))));
  const srmr = srmrFor({ label: 'all', n: N, S: R, m: [], logDetS: logDetR }, Sigma);

  // Standard errors from the inverse observed information: Cov = 2 / (N-1) · H(F)^-1
  const H = numericHessian(fml, opt.x);
  const Hinv = invMatrix(H) ?? pinvSymmetric(H);
  const seRaw = opt.x.map((_, i) => Math.sqrt(Math.max(1e-12, (2 / (N - 1)) * Hinv[i][i])));

  const loadRows = loadPairs.map((lp, i) => {
    const est = opt.x[i];
    const se = seRaw[i];
    const z = est / se;
    const pv = clampP(2 * (1 - normalCdf(Math.abs(z))));
    return { path: `${factors[lp.fIdx].name} → ${indicators[lp.iIdx]}`, est: rNum(est, 3), se: rNum(se, 3), z: rNum(z, 2), p: rNum(pv, 4), sig: sigStars(pv) };
  });
  const gammaRows = gamma.map((g, j) => {
    const se = seRaw[nLoad + p + j] * (1 - g * g); // delta method for tanh
    const z = g / se;
    const pv = clampP(2 * (1 - normalCdf(Math.abs(z))));
    return {
      path: `${opts.secondOrderName} → ${factors[j].name}`,
      est: rNum(g, 3),
      se: rNum(se, 3),
      z: rNum(z, 2),
      p: rNum(pv, 4),
      sig: sigStars(pv),
      r2: rNum(g * g, 3),
    };
  });

  return buildOutput(
    'second_order_cfa',
    `İkinci Düzey DFA (${opts.secondOrderName} → ${factors.map((f) => f.name).join(', ')})`,
    { ...opts },
    {
      n: N,
      chi2: rNum(chi2, 3),
      df,
      p: rNum(pChi, 5),
      cfi: rNum(cfi, 4),
      tli: rNum(tli, 4),
      rmsea: rNum(rmsea, 4),
      srmr: rNum(srmr, 4),
      gammas: gamma.map((g) => rNum(g, 4)),
      firstOrderLoadings: Lambda.map((row) => row.map((v) => rNum(v, 4))),
    },
    [
      {
        id: 'so_fit',
        title: 'Model Uyum İndeksleri',
        columns: [
          { key: 'index', label: 'İndeks' },
          { key: 'value', label: 'Değer', numeric: true },
        ],
        rows: [
          { index: `χ² (sd = ${df})`, value: rNum(chi2, 3) },
          { index: 'p', value: rNum(pChi, 4) },
          { index: 'χ²/sd', value: rNum(chi2 / df, 3) },
          { index: 'CFI', value: rNum(cfi, 3) },
          { index: 'TLI', value: rNum(tli, 3) },
          { index: 'RMSEA', value: rNum(rmsea, 3) },
          { index: 'SRMR', value: rNum(srmr, 3) },
        ],
      },
      {
        id: 'so_gamma',
        title: 'İkinci Düzey Faktör Yükleri (γ, standardize)',
        columns: [
          { key: 'path', label: 'Yol' },
          { key: 'est', label: 'γ', numeric: true },
          { key: 'se', label: 'SH', numeric: true },
          { key: 'z', label: 'z', numeric: true },
          { key: 'p', label: 'p', numeric: true },
          { key: 'r2', label: 'R²', numeric: true },
          { key: 'sig', label: 'Düzey' },
        ],
        rows: gammaRows,
      },
      {
        id: 'so_loadings',
        title: 'Birinci Düzey Faktör Yükleri (λ, standardize)',
        columns: [
          { key: 'path', label: 'Yol' },
          { key: 'est', label: 'λ', numeric: true },
          { key: 'se', label: 'SH', numeric: true },
          { key: 'z', label: 'z', numeric: true },
          { key: 'p', label: 'p', numeric: true },
          { key: 'sig', label: 'Düzey' },
        ],
        rows: loadRows,
      },
    ],
    [],
    `İkinci düzey DFA modeli χ²(${df}) = ${fmtNum(chi2, 2)}, CFI = ${fmtNum(cfi, 3)}, TLI = ${fmtNum(tli, 3)}, RMSEA = ${fmtNum(rmsea, 3)}, SRMR = ${fmtNum(srmr, 3)} uyum değerleri vermiştir; ikinci düzey yükler ${gamma.map((g) => rNum(g, 2)).join(', ')} aralığındadır.`,
    `The second-order CFA yielded χ²(${df}) = ${fmtNum(chi2, 2)}, CFI = ${fmtNum(cfi, 3)}, TLI = ${fmtNum(tli, 3)}, RMSEA = ${fmtNum(rmsea, 3)}, SRMR = ${fmtNum(srmr, 3)}; second-order loadings: ${gamma.map((g) => rNum(g, 2)).join(', ')}.`,
  );
}

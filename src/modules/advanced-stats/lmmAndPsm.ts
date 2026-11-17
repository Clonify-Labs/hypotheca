import { AnalysisOutput, Dataset } from '../../types/interfaces';
import { normalCdf, tCdf } from '../../engine/core/distributions';
import { detAndLogDet, invMatrix, mean, pinvSymmetric, stdDev, variance } from '../../engine/core/linalg';
import { buildOutput, rNum, sigStars, fmtNum } from '../../engine/classical/helpers';
import { toNum } from './shared';
import { StatInputError, clampP, isConstant } from '../../engine/core/errors';

interface Cluster {
  key: string;
  X: number[][]; // includes intercept column
  y: number[];
}

/**
 * GLS pieces for the random-intercept model with variance ratio λ = σ²u/σ²e.
 * V_j = I + λ J  ⇒  V_j⁻¹ = I − λ/(1 + n_j λ) J  and  log|V_j| = log(1 + n_j λ).
 */
function glsAtLambda(clusters: Cluster[], lambda: number, pCols: number) {
  const XtVX = Array.from({ length: pCols }, () => new Array<number>(pCols).fill(0));
  const XtVy = new Array<number>(pCols).fill(0);
  let logDetV = 0;
  for (const c of clusters) {
    const nj = c.y.length;
    const shrink = lambda / (1 + nj * lambda);
    logDetV += Math.log(1 + nj * lambda);
    const sumX = new Array<number>(pCols).fill(0);
    let sumY = 0;
    for (let i = 0; i < nj; i++) {
      for (let a = 0; a < pCols; a++) sumX[a] += c.X[i][a];
      sumY += c.y[i];
    }
    for (let a = 0; a < pCols; a++) {
      for (let b = 0; b < pCols; b++) {
        let s = 0;
        for (let i = 0; i < nj; i++) s += c.X[i][a] * c.X[i][b];
        XtVX[a][b] += s - shrink * sumX[a] * sumX[b];
      }
      let sy = 0;
      for (let i = 0; i < nj; i++) sy += c.X[i][a] * c.y[i];
      XtVy[a] += sy - shrink * sumX[a] * sumY;
    }
  }
  const inv = invMatrix(XtVX) ?? pinvSymmetric(XtVX);
  const beta = inv.map((row) => row.reduce((s, v, j) => s + v * XtVy[j], 0));
  let rVr = 0;
  for (const c of clusters) {
    const nj = c.y.length;
    const shrink = lambda / (1 + nj * lambda);
    const r = c.y.map((yv, i) => yv - c.X[i].reduce((s, v, j) => s + v * beta[j], 0));
    const sr = r.reduce((a, b) => a + b, 0);
    rVr += r.reduce((s, v) => s + v * v, 0) - shrink * sr * sr;
  }
  return { beta, inv, rVr, logDetV, logDetXtVX: detAndLogDet(XtVX).logDet };
}

export function runLinearMixedModel(
  dataset: Dataset,
  opts: { outcome: string; fixedPredictors: string[]; clusterVar: string },
): AnalysisOutput {
  const preds = opts.fixedPredictors;
  if (!opts.outcome || !opts.clusterVar) {
    throw new StatInputError('NO_VARIABLES', 'Karma model için bağımlı değişken ve küme değişkeni seçilmelidir.', 'A linear mixed model requires an outcome and a cluster variable.');
  }
  if (new Set([opts.outcome, opts.clusterVar, ...preds]).size !== preds.length + 2) {
    throw new StatInputError('DUPLICATE_VARIABLES', 'Karma modelde aynı değişken birden fazla role atanamaz.', 'The same variable cannot fill more than one role in the mixed model.');
  }
  const map = new Map<string, Cluster>();
  for (const r of dataset.rows) {
    const y = toNum(r[opts.outcome]);
    const xs = preds.map((p) => toNum(r[p]));
    const g = r[opts.clusterVar];
    if (y === null || xs.some((v) => v === null) || g === null || g === undefined || g === '') continue;
    const key = String(g);
    const c = map.get(key) ?? { key, X: [], y: [] };
    c.X.push([1, ...(xs as number[])]);
    c.y.push(y);
    map.set(key, c);
  }
  const clusters = Array.from(map.values());
  const G = clusters.length;
  const N = clusters.reduce((s, c) => s + c.y.length, 0);
  const pCols = preds.length + 1;
  if (G < 2) {
    throw new StatInputError(
      G === 0 ? 'EMPTY_DATA' : 'SINGLE_CLUSTER',
      `Karma model için "${opts.clusterVar}" değişkeninde en az 2 küme gereklidir (bulunan: ${G}).`,
      `A mixed model requires at least 2 clusters in "${opts.clusterVar}" (found: ${G}).`,
    );
  }
  if (N <= pCols + 2) {
    throw new StatInputError(
      'INSUFFICIENT_N',
      `Karma model için tam vaka sayısı (${N}) yetersiz; en az ${pCols + 3} gereklidir.`,
      `Insufficient complete cases (${N}) for the mixed model; at least ${pCols + 3} are required.`,
    );
  }
  if (clusters.every((c) => c.y.length < 2)) {
    throw new StatInputError(
      'CLUSTERS_TOO_SMALL',
      'Tüm kümelerde yalnızca 1 gözlem var; rastgele kesişim varyansı artık varyanstan ayrıştırılamaz.',
      'Every cluster has a single observation; the random-intercept variance is not identifiable from the residual variance.',
    );
  }
  {
    const allY = clusters.flatMap((c) => c.y);
    if (isConstant(allY)) {
      throw new StatInputError('ZERO_VARIANCE', `"${opts.outcome}" değişkeninin varyansı sıfır; karma model kestirilemez.`, `"${opts.outcome}" has zero variance; the mixed model cannot be estimated.`);
    }
    preds.forEach((pName, j) => {
      if (isConstant(clusters.flatMap((c) => c.X.map((row) => row[j + 1])))) {
        throw new StatInputError('ZERO_VARIANCE', `"${pName}" yordayıcısının varyansı sıfır (sabit ile çakışıyor).`, `Predictor "${pName}" has zero variance (collinear with the intercept).`);
      }
    });
  }

  // REML profile log-likelihood in λ (σ²e profiled out)
  const remlLL = (lambda: number) => {
    const g = glsAtLambda(clusters, lambda, pCols);
    const dfR = N - pCols;
    const s2 = g.rVr / dfR;
    return -0.5 * (dfR * Math.log(2 * Math.PI * s2) + g.logDetV + g.logDetXtVX + dfR);
  };

  // Golden-section search over log λ, then compare with the λ = 0 boundary
  let a = -14;
  let b = 6;
  const phi = (Math.sqrt(5) - 1) / 2;
  let c1 = b - phi * (b - a);
  let c2 = a + phi * (b - a);
  let f1 = remlLL(Math.exp(c1));
  let f2 = remlLL(Math.exp(c2));
  for (let i = 0; i < 120; i++) {
    if (f1 > f2) {
      b = c2;
      c2 = c1;
      f2 = f1;
      c1 = b - phi * (b - a);
      f1 = remlLL(Math.exp(c1));
    } else {
      a = c1;
      c1 = c2;
      f1 = f2;
      c2 = a + phi * (b - a);
      f2 = remlLL(Math.exp(c2));
    }
  }
  let lambda = Math.exp((a + b) / 2);
  let ll = remlLL(lambda);
  const ll0 = remlLL(0);
  if (ll0 >= ll) {
    lambda = 0;
    ll = ll0;
  }

  const fit = glsAtLambda(clusters, lambda, pCols);
  const dfR = N - pCols;
  const sigma2e = fit.rVr / dfR;
  const sigma2u = lambda * sigma2e;
  const icc = sigma2u / (sigma2u + sigma2e);
  const covBeta = fit.inv.map((row) => row.map((v) => v * sigma2e));
  const nVar = 2; // σ²u, σ²e
  const aic = -2 * ll + 2 * nVar;
  const bic = -2 * ll + nVar * Math.log(dfR);

  // Likelihood-ratio test of σ²u = 0 (boundary: 50:50 χ²(0)/χ²(1) mixture)
  const lrt = Math.max(0, 2 * (ll - ll0));
  const lrtP = lrt > 0 ? clampP(0.5 * (1 - (2 * normalCdf(Math.sqrt(lrt)) - 1))) : 1;

  const terms = ['Sabit (Intercept)', ...preds];
  const coefRows = terms.map((term, j) => {
    const est = fit.beta[j];
    const se = Math.sqrt(Math.max(0, covBeta[j][j]));
    const t = est / se;
    const p = clampP(2 * (1 - tCdf(Math.abs(t), dfR)));
    return { term, b: rNum(est, 4), se: rNum(se, 4), t: rNum(t, 3), df: dfR, p: rNum(p, 5), sig: sigStars(p) };
  });

  const clusterRows = clusters.map((c) => {
    const nj = c.y.length;
    const shrinkFactor = lambda > 0 ? (nj * lambda) / (1 + nj * lambda) : 0;
    const meanResid = mean(c.y.map((yv, i) => yv - c.X[i].reduce((s, v, j) => s + v * fit.beta[j], 0)));
    return { cluster: c.key, n: nj, blup: rNum(shrinkFactor * meanResid, 4) };
  });

  return buildOutput(
    'linear_mixed_model',
    `Rastgele Kesişimli Doğrusal Karma Model (${opts.outcome} ~ ${preds.join(' + ') || '1'} + (1 | ${opts.clusterVar}))`,
    { ...opts },
    {
      n: N,
      clusters: G,
      sigma2u: rNum(sigma2u, 5),
      sigma2e: rNum(sigma2e, 5),
      icc: rNum(icc, 4),
      remlLogLik: rNum(ll, 3),
      aic: rNum(aic, 3),
      bic: rNum(bic, 3),
      lrtChi2: rNum(lrt, 3),
      lrtP: rNum(lrtP, 4),
      coefficients: coefRows,
    },
    [
      {
        id: 'lmm_fixed',
        title: 'Sabit Etkiler (GLS / REML)',
        columns: [
          { key: 'term', label: 'Terim' },
          { key: 'b', label: 'B', numeric: true },
          { key: 'se', label: 'SH', numeric: true },
          { key: 't', label: 't', numeric: true },
          { key: 'df', label: 'sd', numeric: true },
          { key: 'p', label: 'p', numeric: true },
          { key: 'sig', label: 'Düzey' },
        ],
        rows: coefRows,
      },
      {
        id: 'lmm_random',
        title: 'Rastgele Etkiler ve Model Bilgisi',
        columns: [
          { key: 'metric', label: 'Ölçüt' },
          { key: 'value', label: 'Değer', numeric: true },
        ],
        rows: [
          { metric: `Küme Sayısı (${opts.clusterVar})`, value: G },
          { metric: 'σ²u (Kesişim Varyansı)', value: rNum(sigma2u, 4) },
          { metric: 'σ²e (Artık Varyans)', value: rNum(sigma2e, 4) },
          { metric: 'ICC', value: rNum(icc, 4) },
          { metric: 'REML log-olabilirlik', value: rNum(ll, 3) },
          { metric: 'AIC', value: rNum(aic, 3) },
          { metric: 'BIC', value: rNum(bic, 3) },
          { metric: `LRT σ²u = 0 (χ̄², p = ${fmtNum(lrtP, 4)})`, value: rNum(lrt, 3) },
        ],
      },
      {
        id: 'lmm_blup',
        title: 'Küme Rastgele Kesişim Kestirimleri (BLUP)',
        columns: [
          { key: 'cluster', label: 'Küme' },
          { key: 'n', label: 'n', numeric: true },
          { key: 'blup', label: 'û_j', numeric: true },
        ],
        rows: clusterRows,
      },
    ],
    [],
    `${G} kümeli rastgele kesişimli karma modelde sınıf içi korelasyon ICC = ${fmtNum(icc, 3)} (σ²u = ${fmtNum(sigma2u, 3)}, σ²e = ${fmtNum(sigma2e, 3)}) olarak kestirilmiştir; AIC = ${fmtNum(aic, 1)}, BIC = ${fmtNum(bic, 1)}.`,
    `A random-intercept linear mixed model with ${G} clusters (REML) estimated ICC = ${fmtNum(icc, 3)} (σ²u = ${fmtNum(sigma2u, 3)}, σ²e = ${fmtNum(sigma2e, 3)}); AIC = ${fmtNum(aic, 1)}, BIC = ${fmtNum(bic, 1)}.`,
  );
}

function fitLogitIrls(X: number[][], y: number[]): number[] {
  const p = X[0].length;
  let beta = new Array<number>(p).fill(0);
  for (let iter = 0; iter < 50; iter++) {
    const H = Array.from({ length: p }, () => new Array<number>(p).fill(0));
    const g = new Array<number>(p).fill(0);
    for (let i = 0; i < X.length; i++) {
      const eta = Math.max(-30, Math.min(30, X[i].reduce((s, v, j) => s + v * beta[j], 0)));
      const pr = 1 / (1 + Math.exp(-eta));
      const w = Math.max(1e-9, pr * (1 - pr));
      for (let a = 0; a < p; a++) {
        g[a] += X[i][a] * (y[i] - pr);
        for (let b = 0; b < p; b++) H[a][b] += X[i][a] * w * X[i][b];
      }
    }
    for (let a = 0; a < p; a++) H[a][a] += 1e-8;
    const inv = invMatrix(H) ?? pinvSymmetric(H);
    const step = inv.map((row) => row.reduce((s, v, j) => s + v * g[j], 0));
    beta = beta.map((v, j) => v + step[j]);
    if (Math.max(...step.map(Math.abs)) < 1e-8) break;
  }
  return beta;
}

function smd(t: number[], c: number[]): number {
  const pooled = Math.sqrt((variance(t, 1) + variance(c, 1)) / 2);
  return pooled > 0 ? (mean(t) - mean(c)) / pooled : 0;
}

export function runPropensityScoreMatching(
  dataset: Dataset,
  opts: { treatmentVar: string; outcomeVar: string; covariates: string[]; caliper?: number; treatedLevel?: string },
): AnalysisOutput {
  if (!opts.covariates.length) {
    throw new StatInputError('NO_VARIABLES', 'Eğilim skoru için en az 1 ortak değişken seçilmelidir.', 'Propensity scores require at least 1 covariate.');
  }
  if (opts.caliper !== undefined && !(Number.isFinite(opts.caliper) && opts.caliper > 0)) {
    throw new StatInputError('INVALID_PARAMETER', 'Kaliper pozitif ve sonlu bir sayı olmalıdır.', 'Caliper must be a positive finite number.');
  }
  const levels = Array.from(
    new Set(dataset.rows.map((r) => r[opts.treatmentVar]).filter((v) => v !== null && v !== undefined && v !== '').map(String)),
  ).sort((a, b) => a.localeCompare(b, 'tr'));
  if (levels.length !== 2) {
    throw new StatInputError(
      levels.length < 2 ? 'SINGLE_GROUP' : 'TOO_MANY_GROUPS',
      `Tedavi değişkeni tam olarak 2 düzeye sahip olmalıdır (bulunan: ${levels.length}).`,
      `The treatment variable must have exactly 2 levels (found: ${levels.length}).`,
    );
  }
  if (opts.treatedLevel !== undefined && !levels.includes(String(opts.treatedLevel))) {
    throw new StatInputError(
      'INVALID_PARAMETER',
      `Belirtilen tedavi düzeyi ("${opts.treatedLevel}") verilerde yok; mevcut düzeyler: ${levels.join(', ')}.`,
      `The specified treated level ("${opts.treatedLevel}") is not present; available levels: ${levels.join(', ')}.`,
    );
  }
  const treated = opts.treatedLevel ?? (levels.includes('1') ? '1' : levels[1]);

  const units: { t: 0 | 1; y: number; x: number[] }[] = [];
  for (const r of dataset.rows) {
    const tv = r[opts.treatmentVar];
    const y = toNum(r[opts.outcomeVar]);
    const xs = opts.covariates.map((c) => toNum(r[c]));
    if (tv === null || tv === undefined || tv === '' || y === null || xs.some((v) => v === null)) continue;
    units.push({ t: String(tv) === treated ? 1 : 0, y, x: xs as number[] });
  }
  const nT = units.filter((u) => u.t === 1).length;
  const nC = units.length - nT;
  if (nT === 0 || nC === 0) {
    throw new StatInputError(
      nT === 0 ? 'NO_TREATED_UNITS' : 'NO_CONTROL_UNITS',
      `Tam vakalarda ${nT === 0 ? 'tedavi' : 'kontrol'} grubunda hiç birim kalmadı; eşleştirme yapılamaz.`,
      `No ${nT === 0 ? 'treated' : 'control'} units remain among complete cases; matching is impossible.`,
    );
  }
  if (nT < 5 || nC < 5) {
    throw new StatInputError(
      'INSUFFICIENT_N',
      `Her iki koşulda da en az 5 tam gözlem gereklidir (tedavi: ${nT}, kontrol: ${nC}).`,
      `At least 5 complete observations are required in each condition (treated: ${nT}, control: ${nC}).`,
    );
  }
  opts.covariates.forEach((cov, j) => {
    if (isConstant(units.map((u) => u.x[j]))) {
      throw new StatInputError('ZERO_VARIANCE', `"${cov}" ortak değişkeninin varyansı sıfır; eğilim skoru modelinden çıkarın.`, `Covariate "${cov}" has zero variance; remove it from the propensity model.`);
    }
  });

  const beta = fitLogitIrls(units.map((u) => [1, ...u.x]), units.map((u) => u.t));
  const logitPs = units.map((u) => [1, ...u.x].reduce((s, v, j) => s + v * beta[j], 0));
  const ps = logitPs.map((l) => 1 / (1 + Math.exp(-l)));
  const caliper = (opts.caliper ?? 0.2) * stdDev(logitPs, 1);

  // Greedy 1:1 nearest-neighbour matching without replacement on logit(PS), highest PS first
  const treatedIdx = units.map((u, i) => (u.t === 1 ? i : -1)).filter((i) => i >= 0).sort((a, b) => ps[b] - ps[a]);
  const controlPool = new Set(units.map((u, i) => (u.t === 0 ? i : -1)).filter((i) => i >= 0));
  const pairs: [number, number][] = [];
  for (const ti of treatedIdx) {
    let best = -1;
    let bestD = Infinity;
    for (const ci of controlPool) {
      const d = Math.abs(logitPs[ti] - logitPs[ci]);
      if (d < bestD) {
        bestD = d;
        best = ci;
      }
    }
    if (best >= 0 && bestD <= caliper) {
      pairs.push([ti, best]);
      controlPool.delete(best);
    }
  }
  if (pairs.length < 3) {
    throw new StatInputError(
      'INSUFFICIENT_MATCHES',
      `Kaliper içinde yeterli eşleşme bulunamadı (${pairs.length}); kaliperi genişletin.`,
      `Too few matches within the caliper (${pairs.length}); widen the caliper.`,
    );
  }

  const balanceRows = opts.covariates.map((cov, j) => {
    const tAll = units.filter((u) => u.t === 1).map((u) => u.x[j]);
    const cAll = units.filter((u) => u.t === 0).map((u) => u.x[j]);
    const tM = pairs.map(([ti]) => units[ti].x[j]);
    const cM = pairs.map(([, ci]) => units[ci].x[j]);
    const before = smd(tAll, cAll);
    const after = smd(tM, cM);
    return {
      covariate: cov,
      meanT: rNum(mean(tAll), 3),
      meanC: rNum(mean(cAll), 3),
      smdBefore: rNum(before, 3),
      smdAfter: rNum(after, 3),
      balanced: Math.abs(after) < 0.1 ? 'Evet (|SMD| < .10)' : 'Hayır',
    };
  });
  const psBefore = smd(ps.filter((_, i) => units[i].t === 1), ps.filter((_, i) => units[i].t === 0));
  const psAfter = smd(pairs.map(([ti]) => ps[ti]), pairs.map(([, ci]) => ps[ci]));

  const diffs = pairs.map(([ti, ci]) => units[ti].y - units[ci].y);
  const att = mean(diffs);
  const seAtt = stdDev(diffs, 1) / Math.sqrt(diffs.length);
  const tAtt = att / seAtt;
  const dfAtt = diffs.length - 1;
  const pAtt = clampP(2 * (1 - tCdf(Math.abs(tAtt), dfAtt)));
  const naive = mean(units.filter((u) => u.t === 1).map((u) => u.y)) - mean(units.filter((u) => u.t === 0).map((u) => u.y));

  return buildOutput(
    'propensity_score_matching',
    `Eğilim Skoru Eşleştirme (${opts.treatmentVar} = ${treated} → ${opts.outcomeVar})`,
    { ...opts, treatedLevel: treated },
    {
      nTreated: nT,
      nControl: nC,
      matchedPairs: pairs.length,
      caliper: rNum(caliper, 4),
      att: rNum(att, 4),
      seATT: rNum(seAtt, 4),
      t: rNum(tAtt, 3),
      p: rNum(pAtt, 5),
      naiveDiff: rNum(naive, 4),
      maxAbsSmdAfter: rNum(Math.max(...balanceRows.map((r) => Math.abs(Number(r.smdAfter)))), 4),
      maxAbsSmdBefore: rNum(Math.max(...balanceRows.map((r) => Math.abs(Number(r.smdBefore)))), 4),
    },
    [
      {
        id: 'psm_model',
        title: 'Eğilim Skoru Lojistik Modeli',
        columns: [
          { key: 'term', label: 'Terim' },
          { key: 'b', label: 'B', numeric: true },
        ],
        rows: ['Sabit', ...opts.covariates].map((term, j) => ({ term, b: rNum(beta[j], 4) })),
      },
      {
        id: 'psm_balance',
        title: 'Ortak Değişken Dengesi (Standardize Ortalama Farkı)',
        columns: [
          { key: 'covariate', label: 'Değişken' },
          { key: 'meanT', label: 'Ort. (Tedavi)', numeric: true },
          { key: 'meanC', label: 'Ort. (Kontrol)', numeric: true },
          { key: 'smdBefore', label: 'SMD Önce', numeric: true },
          { key: 'smdAfter', label: 'SMD Sonra', numeric: true },
          { key: 'balanced', label: 'Dengeli?' },
        ],
        rows: [
          ...balanceRows,
          { covariate: 'Eğilim Skoru', meanT: null, meanC: null, smdBefore: rNum(psBefore, 3), smdAfter: rNum(psAfter, 3), balanced: Math.abs(psAfter) < 0.1 ? 'Evet (|SMD| < .10)' : 'Hayır' },
        ],
      },
      {
        id: 'psm_att',
        title: 'Tedavi Edilenlerde Ortalama Tedavi Etkisi (ATT)',
        columns: [
          { key: 'metric', label: 'Ölçüt' },
          { key: 'value', label: 'Değer', numeric: true },
        ],
        rows: [
          { metric: 'Eşleşen Çift Sayısı', value: pairs.length },
          { metric: `Eşleşmeyen Tedavi Birimi (kaliper = ${fmtNum(caliper, 3)})`, value: nT - pairs.length },
          { metric: 'Ham Ortalama Farkı (eşleştirme öncesi)', value: rNum(naive, 3) },
          { metric: 'ATT (eşleşmiş çift farkı)', value: rNum(att, 3) },
          { metric: 'ATT SH', value: rNum(seAtt, 3) },
          { metric: `t (sd = ${dfAtt})`, value: rNum(tAtt, 3) },
          { metric: 'p', value: rNum(pAtt, 5) },
        ],
      },
    ],
    [
      {
        id: 'psm_love',
        title: 'Denge Grafiği (|SMD| Önce / Sonra)',
        type: 'bar',
        option: {
          tooltip: { trigger: 'axis' },
          legend: { data: ['Önce', 'Sonra'] },
          xAxis: { type: 'value', name: '|SMD|' },
          yAxis: { type: 'category', data: opts.covariates },
          series: [
            { name: 'Önce', type: 'bar', data: balanceRows.map((r) => Math.abs(Number(r.smdBefore))) },
            { name: 'Sonra', type: 'bar', data: balanceRows.map((r) => Math.abs(Number(r.smdAfter))) },
          ],
        },
      },
    ],
    `Eğilim skoru (lojistik) ile 1:1 en yakın komşu eşleştirmesi (kaliper = 0.2 SD logit) sonucunda ${pairs.length} çift oluşturulmuş; eşleştirme sonrası en büyük |SMD| = ${rNum(Math.max(...balanceRows.map((r) => Math.abs(Number(r.smdAfter)))), 3)} bulunmuştur. ATT = ${fmtNum(att, 2)}, t(${dfAtt}) = ${fmtNum(tAtt, 2)}, p = ${fmtNum(pAtt, 3)}.`,
    `Logistic propensity scores with 1:1 nearest-neighbour caliper matching produced ${pairs.length} pairs; ATT = ${fmtNum(att, 2)}, t(${dfAtt}) = ${fmtNum(tAtt, 2)}, p = ${fmtNum(pAtt, 3)} (naive difference = ${fmtNum(naive, 2)}).`,
  );
}

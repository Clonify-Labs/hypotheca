import { AnalysisOutput, AssumptionBadge, Dataset } from '../../types/interfaces';
import { StatInputError, assertMinN, assertNonZeroVariance, clampP, isConstant, toFiniteNumber as toNum } from '../core/errors';
import {
  chi2Cdf,
  chi2Inv,
  fCdf,
  fInv,
  ncfCdf,
  nctCdf,
  normalCdf,
  normalInv,
  tCdf,
  tInv,
} from '../core/distributions';
import {
  invMatrix,
  invMatrixStrict,
  matMul,
  mean,
  olsFit,
  pinvSymmetric,
  quantile,
  stdDev,
  transpose,
} from '../core/linalg';
import {
  buildOutput,
  extractNumMatrix,
  pearsonPair,
  rNum,
  sigStars,
  fmtNum,
} from './helpers';

export function runLinearRegression(
  dataset: Dataset,
  outcome: string,
  predictors: string[],
  blocks?: string[][],
): AnalysisOutput {
  const uniquePreds = Array.from(new Set(blocks?.flat() ?? predictors));
  if (!uniquePreds.length) {
    throw new StatInputError('NO_VARIABLES', 'En az 1 yordayıcı değişken seçilmelidir.', 'Select at least 1 predictor.');
  }
  if (!outcome || uniquePreds.includes(outcome)) {
    throw new StatInputError('INVALID_VARIABLES', 'Bağımlı değişken yordayıcılar arasında yer alamaz.', 'The outcome cannot also be a predictor.');
  }
  const cols = [outcome, ...uniquePreds];
  const mat = extractNumMatrix(dataset.rows, cols);
  const n = mat.length;
  if (n <= uniquePreds.length + 2) {
    throw new StatInputError(
      n === 0 ? 'EMPTY_DATA' : 'INSUFFICIENT_N',
      `Regresyon kestirimi için tam vaka sayısı (${n}) yetersiz; en az ${uniquePreds.length + 3} gözlem (n > p + 1 ve hata sd >= 1) gereklidir.`,
      `Insufficient complete cases (${n}) for regression; at least ${uniquePreds.length + 3} are required (n > p + 1 with residual df >= 1).`,
    );
  }
  cols.forEach((c, j) => assertNonZeroVariance(mat.map((r) => r[j]), c));

  const y = mat.map((r) => r[0]);
  const predIndex = new Map(uniquePreds.map((p, i) => [p, i + 1]));
  const stepBlocks = blocks && blocks.length > 0 ? blocks : [uniquePreds];

  const modelRows: Record<string, string | number | null>[] = [];
  let prevR2 = 0;
  let lastFit = olsFit(y, mat.map((r) => uniquePreds.map((p) => r[predIndex.get(p)!])));
  let activeVars: string[] = [];

  for (let bIdx = 0; bIdx < stepBlocks.length; bIdx++) {
    activeVars = Array.from(new Set([...activeVars, ...stepBlocks[bIdx]]));
    const Xb = mat.map((r) => activeVars.map((v) => r[predIndex.get(v)!]));
    const Xd = Xb.map((row) => [1, ...row]);
    invMatrixStrict(matMul(transpose(Xd), Xd), activeVars.join(', '));
    const fit = olsFit(y, Xb);
    lastFit = fit;

    const r2Chg = fit.r2 - prevR2;
    const kAdded = bIdx === 0 ? activeVars.length : stepBlocks[bIdx].length;
    const fChg =
      bIdx === 0
        ? fit.f
        : fit.r2 < 1 && kAdded > 0 && fit.dfResid > 0
          ? (r2Chg / kAdded) / ((1 - fit.r2) / fit.dfResid)
          : 0;
    const pChg = clampP(1 - fCdf(fChg, Math.max(1, kAdded), Math.max(1, fit.dfResid)));
    prevR2 = fit.r2;

    modelRows.push({
      model: `Model ${bIdx + 1}`,
      predictors: activeVars.join(', '),
      r: rNum(fit.r, 6),
      r2: rNum(fit.r2, 6),
      adjR2: rNum(fit.adjR2, 6),
      see: rNum(fit.see, 4),
      r2Change: rNum(r2Chg, 5),
      fChange: rNum(fChg, 4),
      df1: Math.max(1, kAdded),
      df2: fit.dfResid,
      pChange: rNum(pChg, 6),
      dw: rNum(fit.dw, 5),
    });
  }

  const tCrit = tInv(0.975, Math.max(1, lastFit.dfResid));
  const terms = ['Sabit (Intercept)', ...activeVars];
  const coefRows = terms.map((term, idx) => {
    const b = lastFit.beta[idx];
    const se = lastFit.se[idx];
    const sb = lastFit.stdBeta[idx];
    const tVal = lastFit.t[idx];
    const pVal = lastFit.p[idx];
    const vifVal = lastFit.vif[idx];
    const tolVal = vifVal && vifVal > 0 ? 1 / vifVal : null;
    return {
      term,
      b: rNum(b, 4),
      se: rNum(se, 4),
      beta: sb !== null ? rNum(sb, 4) : null,
      t: rNum(tVal, 4),
      p: rNum(pVal, 6),
      sig: sigStars(pVal),
      ciLow: rNum(b - tCrit * se, 4),
      ciHigh: rNum(b + tCrit * se, 4),
      tolerance: tolVal !== null ? rNum(tolVal, 3) : null,
      vif: vifVal !== null ? rNum(vifVal, 3) : null,
    };
  });

  const maxCooks = Math.max(...lastFit.cooksD);
  const maxLev = Math.max(...lastFit.leverage);
  const maxVif = Math.max(1, ...lastFit.vif.filter((v): v is number => v !== null));
  const msReg = lastFit.ssReg / Math.max(1, lastFit.dfModel);
  const msRes = lastFit.ssResid / Math.max(1, lastFit.dfResid);

  const out = buildOutput(
    'linear_regression',
    `Doğrusal Regresyon (${outcome} ~ ${activeVars.join(' + ')})`,
    { outcome, predictors: activeVars, blocks: stepBlocks },
    {
      n,
      r: rNum(lastFit.r, 6),
      r2: rNum(lastFit.r2, 6),
      adjR2: rNum(lastFit.adjR2, 6),
      see: rNum(lastFit.see, 4),
      f: rNum(lastFit.f, 4),
      p: rNum(lastFit.fP, 8),
      dw: rNum(lastFit.dw, 5),
      dfModel: lastFit.dfModel,
      dfResid: lastFit.dfResid,
      maxCooksD: rNum(maxCooks, 4),
      maxVif: rNum(maxVif, 3),
      coefficients: coefRows,
    },
    [
      {
        id: 'reg_summary',
        title: 'Model Özeti (OLS)',
        columns: [
          { key: 'model', label: 'Model' },
          { key: 'r', label: 'R', numeric: true },
          { key: 'r2', label: 'R²', numeric: true },
          { key: 'adjR2', label: 'Düz. R²', numeric: true },
          { key: 'see', label: 'Kestirim SH', numeric: true },
          { key: 'r2Change', label: 'ΔR²', numeric: true },
          { key: 'fChange', label: 'ΔF', numeric: true },
          { key: 'pChange', label: 'p (ΔF)', numeric: true },
          { key: 'dw', label: 'Durbin-Watson', numeric: true },
        ],
        rows: modelRows,
      },
      {
        id: 'reg_anova',
        title: 'Regresyon ANOVA Tablosu',
        columns: [
          { key: 'source', label: 'Kaynak' },
          { key: 'ss', label: 'Kareler Toplamı', numeric: true },
          { key: 'df', label: 'sd', numeric: true },
          { key: 'ms', label: 'Kareler Ort.', numeric: true },
          { key: 'f', label: 'F', numeric: true },
          { key: 'p', label: 'p', numeric: true },
        ],
        rows: [
          { source: 'Regresyon', ss: rNum(lastFit.ssReg, 3), df: lastFit.dfModel, ms: rNum(msReg, 3), f: rNum(lastFit.f, 4), p: rNum(lastFit.fP, 6) },
          { source: 'Artık (Residual)', ss: rNum(lastFit.ssResid, 3), df: lastFit.dfResid, ms: rNum(msRes, 3), f: null, p: null },
          { source: 'Toplam', ss: rNum(lastFit.ssTotal, 3), df: n - 1, ms: null, f: null, p: null },
        ],
      },
      {
        id: 'reg_coefs',
        title: 'Regresyon Katsayıları ve Çoklu Doğrusallık',
        columns: [
          { key: 'term', label: 'Değişken' },
          { key: 'b', label: 'B', numeric: true },
          { key: 'se', label: 'SH', numeric: true },
          { key: 'beta', label: 'Beta (Std.)', numeric: true },
          { key: 't', label: 't', numeric: true },
          { key: 'p', label: 'p', numeric: true },
          { key: 'sig', label: 'Düzey' },
          { key: 'ciLow', label: '%95 GA Alt', numeric: true },
          { key: 'ciHigh', label: '%95 GA Üst', numeric: true },
          { key: 'vif', label: 'VIF', numeric: true },
        ],
        rows: coefRows,
      },
      {
        id: 'reg_diag',
        title: 'Artık & Etkili Gözlem Tanıları',
        columns: [
          { key: 'metric', label: 'Tanı Ölçütü' },
          { key: 'value', label: 'Değer', numeric: true },
          { key: 'threshold', label: 'Referans Eşiği' },
        ],
        rows: [
          { metric: 'Durbin-Watson Otokorelasyon', value: rNum(lastFit.dw, 3), threshold: '1.50 – 2.50 ideal' },
          { metric: "Maksimum Cook's D", value: rNum(maxCooks, 4), threshold: `< ${fmtNum(4 / n, 3)} (ve < 1.0)` },
          { metric: 'Maksimum Leverage (h)', value: rNum(maxLev, 4), threshold: `< ${fmtNum((2 * (activeVars.length + 1)) / n, 3)}` },
          { metric: 'Maksimum VIF', value: rNum(maxVif, 3), threshold: '< 5.0 (Kritik < 10.0)' },
        ],
      },
    ],
    [
      {
        id: 'reg_resid_plot',
        title: 'Artık vs Kestirim Saçılımı (Residuals vs Fitted)',
        type: 'scatter',
        option: {
          tooltip: { trigger: 'item' },
          xAxis: { type: 'value', name: 'Kestirilen Değer (Ŷ)' },
          yAxis: { type: 'value', name: 'Artık (e)' },
          series: [
            {
              name: 'Artıklar',
              type: 'scatter',
              symbolSize: 7,
              data: lastFit.fitted.map((f, i) => [rNum(f, 3), rNum(lastFit.resid[i], 3)]),
            },
          ],
        },
      },
    ],
    `Doğrusal regresyon modeli istatistiksel olarak anlamlıdır, F(${lastFit.dfModel}, ${lastFit.dfResid}) = ${fmtNum(lastFit.f, 2)}, p = ${fmtNum(lastFit.fP, 4)}, R² = ${fmtNum(lastFit.r2, 3)} (Düzeltilmiş R² = ${fmtNum(lastFit.adjR2, 3)}).`,
    `Linear regression yielded F(${lastFit.dfModel}, ${lastFit.dfResid}) = ${fmtNum(lastFit.f, 2)}, p = ${fmtNum(lastFit.fP, 4)}, R² = ${fmtNum(lastFit.r2, 3)} (Adjusted R² = ${fmtNum(lastFit.adjR2, 3)}).`,
  );

  const assump: AssumptionBadge[] = [
    {
      name: 'Otokorelasyon (Durbin-Watson)',
      passed: lastFit.dw >= 1.5 && lastFit.dw <= 2.5,
      statisticLabel: `DW = ${fmtNum(lastFit.dw, 3)}`,
      detail: 'Artıklar arası bağımsızlık [1.5 – 2.5].',
    },
    {
      name: 'Çoklu Doğrusallık (VIF)',
      passed: maxVif < 5,
      statisticLabel: `Max VIF = ${fmtNum(maxVif, 2)}`,
      detail: maxVif < 5 ? 'VIF < 5; çoklu doğrusal bağlantı sorunu yok.' : 'Yüksek VIF tespit edildi.',
    },
  ];
  out.assumptions = assump;
  return out;
}

export function runLogisticRegression(dataset: Dataset, outcome: string, predictors: string[]): AnalysisOutput {
  if (!predictors.length) {
    throw new StatInputError('NO_VARIABLES', 'Lojistik regresyon için en az 1 yordayıcı gereklidir.', 'Logistic regression requires at least 1 predictor.');
  }
  const rawLevels = Array.from(
    new Set(dataset.rows.map((r) => r[outcome]).filter((v) => v !== null && v !== undefined && v !== '')),
  );
  if (rawLevels.length < 2) {
    throw new StatInputError('SINGLE_CATEGORY', 'İkili (binary) hedef değişkende 2 sınıf bulunmalıdır.', 'The binary outcome must have 2 classes.');
  }
  if (rawLevels.length > 2) {
    throw new StatInputError(
      'TOO_MANY_GROUPS',
      `İkili lojistik regresyon için hedef değişken tam olarak 2 sınıf içermelidir ("${outcome}" içinde ${rawLevels.length} sınıf var).`,
      `Binary logistic regression requires exactly 2 outcome classes ("${outcome}" has ${rawLevels.length}).`,
    );
  }
  const posLabel = rawLevels.includes(1) ? 1 : rawLevels.includes('1') ? '1' : rawLevels[1];

  const Xrows: number[][] = [];
  const y: number[] = [];
  for (const row of dataset.rows) {
    const tVal = row[outcome];
    if (tVal === null || tVal === undefined || tVal === '') continue;
    const xVals = predictors.map((p) => toNum(row[p]));
    if (xVals.every((v) => v !== null)) {
      Xrows.push([1, ...(xVals as number[])]);
      y.push(tVal === posLabel ? 1 : 0);
    }
  }
  const n = y.length;
  const pCols = predictors.length + 1;
  assertMinN(n, pCols + 4, 'Lojistik regresyon (tam vaka)', 'Logistic regression (complete cases)');
  {
    const nPosY = y.reduce((a, b) => a + b, 0);
    if (nPosY === 0 || nPosY === n) {
      throw new StatInputError(
        'SINGLE_CATEGORY',
        'Tam vakalarda hedef değişkenin yalnızca tek sınıfı kaldı; lojistik regresyon kestirilemez.',
        'Only one outcome class remains among complete cases; logistic regression cannot be estimated.',
      );
    }
    predictors.forEach((pName, j) => assertNonZeroVariance(Xrows.map((r) => r[j + 1]), pName));
  }

  // IRLS Newton-Raphson
  let beta = new Array<number>(pCols).fill(0);
  const pMean = Math.min(0.99, Math.max(0.01, mean(y)));
  beta[0] = Math.log(pMean / (1 - pMean));
  const llNull = y.reduce((s, yi) => s + yi * Math.log(pMean) + (1 - yi) * Math.log(1 - pMean), 0);

  let infoInv: number[][] = Array.from({ length: pCols }, (_, i) => Array.from({ length: pCols }, (__, j) => (i === j ? 1 : 0)));
  let probs = new Array<number>(n).fill(pMean);

  for (let iter = 0; iter < 30; iter++) {
    const eta = Xrows.map((row) => row.reduce((s, v, j) => s + v * beta[j], 0));
    probs = eta.map((z) => {
      const cz = Math.max(-25, Math.min(25, z));
      return 1 / (1 + Math.exp(-cz));
    });
    const W = probs.map((pr) => Math.max(1e-7, pr * (1 - pr)));
    const grad = new Array<number>(pCols).fill(0);
    const H = Array.from({ length: pCols }, () => new Array<number>(pCols).fill(0));
    for (let i = 0; i < n; i++) {
      const r = Xrows[i];
      const err = y[i] - probs[i];
      const wi = W[i];
      for (let j = 0; j < pCols; j++) {
        grad[j] += r[j] * err;
        for (let l = j; l < pCols; l++) {
          H[j][l] += r[j] * wi * r[l];
        }
      }
    }
    for (let j = 0; j < pCols; j++) {
      H[j][j] += 1e-8;
      for (let l = 0; l < j; l++) H[j][l] = H[l][j];
    }
    const HInv = invMatrix(H) || pinvSymmetric(H);
    infoInv = HInv;
    const step = HInv.map((row) => row.reduce((s, v, l) => s + v * grad[l], 0));
    let maxStep = 0;
    for (let j = 0; j < pCols; j++) {
      beta[j] += step[j];
      maxStep = Math.max(maxStep, Math.abs(step[j]));
    }
    if (maxStep < 1e-6) break;
  }

  const llModel = y.reduce(
    (s, yi, i) => s + yi * Math.log(Math.max(1e-12, probs[i])) + (1 - yi) * Math.log(Math.max(1e-12, 1 - probs[i])),
    0,
  );
  const minus2LL = -2 * llModel;
  const omnibusChi2 = Math.max(0, 2 * (llModel - llNull));
  const dfOmnibus = predictors.length;
  const omnibusP = clampP(1 - chi2Cdf(omnibusChi2, dfOmnibus));
  const coxSnellR2 = 1 - Math.exp((2 * (llNull - llModel)) / n);
  const nagelkerkeR2 = coxSnellR2 / Math.max(1e-9, 1 - Math.exp((2 * llNull) / n));

  // Classification accuracy
  let tp = 0;
  let tn = 0;
  let fp = 0;
  let fn = 0;
  for (let i = 0; i < n; i++) {
    const pred = probs[i] >= 0.5 ? 1 : 0;
    if (pred === 1 && y[i] === 1) tp++;
    else if (pred === 0 && y[i] === 0) tn++;
    else if (pred === 1 && y[i] === 0) fp++;
    else fn++;
  }
  const acc = (tp + tn) / n;

  // Hosmer-Lemeshow (up to 10 quantiles)
  const pairedHL = probs.map((p, i) => ({ p, y: y[i] })).sort((a, b) => a.p - b.p);
  const gCount = Math.min(10, Math.max(4, Math.floor(n / 10)));
  let hlChi2 = 0;
  for (let g = 0; g < gCount; g++) {
    const start = Math.floor((g * n) / gCount);
    const end = Math.floor(((g + 1) * n) / gCount);
    const slice = pairedHL.slice(start, end);
    if (!slice.length) continue;
    const obs1 = slice.reduce((s, d) => s + d.y, 0);
    const exp1 = slice.reduce((s, d) => s + d.p, 0);
    const ng = slice.length;
    const exp0 = ng - exp1;
    const obs0 = ng - obs1;
    if (exp1 > 1e-4) hlChi2 += Math.pow(obs1 - exp1, 2) / exp1;
    if (exp0 > 1e-4) hlChi2 += Math.pow(obs0 - exp0, 2) / exp0;
  }
  const hlDf = Math.max(1, gCount - 2);
  const hlP = clampP(1 - chi2Cdf(hlChi2, hlDf));

  const terms = ['Sabit (Intercept)', ...predictors];
  const coefRows = terms.map((term, j) => {
    const b = beta[j];
    const se = Math.sqrt(Math.max(1e-12, infoInv[j][j]));
    const wald = Math.pow(b / se, 2);
    const pVal = clampP(1 - chi2Cdf(wald, 1));
    const orVal = Math.exp(Math.max(-20, Math.min(20, b)));
    const orLow = Math.exp(Math.max(-20, Math.min(20, b - 1.96 * se)));
    const orHigh = Math.exp(Math.max(-20, Math.min(20, b + 1.96 * se)));
    return {
      term,
      b: rNum(b, 4),
      se: rNum(se, 4),
      wald: rNum(wald, 3),
      df: 1,
      p: rNum(pVal, 5),
      sig: sigStars(pVal),
      or: rNum(orVal, 3),
      orLow: rNum(orLow, 3),
      orHigh: rNum(orHigh, 3),
    };
  });

  return buildOutput(
    'logistic_regression',
    `İkili Lojistik Regresyon (${outcome} ~ ${predictors.join(' + ')})`,
    { outcome, predictors, positiveClass: posLabel },
    {
      n,
      minus2LL: rNum(minus2LL, 3),
      omnibusChi2: rNum(omnibusChi2, 3),
      df: dfOmnibus,
      p: rNum(omnibusP, 6),
      coxSnellR2: rNum(coxSnellR2, 4),
      nagelkerkeR2: rNum(nagelkerkeR2, 4),
      hlChi2: rNum(hlChi2, 3),
      hlP: rNum(hlP, 4),
      accuracyPct: rNum(acc * 100, 2),
    },
    [
      {
        id: 'logit_fit',
        title: 'Model Özeti & Uyum Testleri',
        columns: [
          { key: 'metric', label: 'Ölçüt' },
          { key: 'value', label: 'Değer', numeric: true },
        ],
        rows: [
          { metric: '-2 Log Olabilirlik (-2LL)', value: rNum(minus2LL, 3) },
          { metric: `Omnibus Model χ² (sd=${dfOmnibus})`, value: rNum(omnibusChi2, 3) },
          { metric: 'Omnibus p', value: rNum(omnibusP, 5) },
          { metric: 'Cox & Snell R²', value: rNum(coxSnellR2, 4) },
          { metric: 'Nagelkerke R²', value: rNum(nagelkerkeR2, 4) },
          { metric: `Hosmer-Lemeshow χ² (p=${fmtNum(hlP, 3)})`, value: rNum(hlChi2, 3) },
          { metric: 'Doğru Sınıflandırma Oranı (%)', value: rNum(acc * 100, 2) },
        ],
      },
      {
        id: 'logit_coefs',
        title: 'Değişkenler & Odds Oranları (Exp(B))',
        columns: [
          { key: 'term', label: 'Değişken' },
          { key: 'b', label: 'B', numeric: true },
          { key: 'se', label: 'SH', numeric: true },
          { key: 'wald', label: 'Wald', numeric: true },
          { key: 'p', label: 'p', numeric: true },
          { key: 'sig', label: 'Düzey' },
          { key: 'or', label: 'OR (Exp(B))', numeric: true },
          { key: 'orLow', label: 'OR %95 Alt', numeric: true },
          { key: 'orHigh', label: 'OR %95 Üst', numeric: true },
        ],
        rows: coefRows,
      },
      {
        id: 'logit_cm',
        title: 'Sınıflandırma Tablosu (Eşik = 0.50)',
        columns: [
          { key: 'observed', label: 'Gözlenen Sınıf' },
          { key: 'pred0', label: 'Kestirim = 0', numeric: true },
          { key: 'pred1', label: 'Kestirim = 1', numeric: true },
          { key: 'pct', label: 'Doğruluk %', numeric: true },
        ],
        rows: [
          { observed: 'Sınıf 0', pred0: tn, pred1: fp, pct: rNum((tn / Math.max(1, tn + fp)) * 100, 1) },
          { observed: `Sınıf 1 (${String(posLabel)})`, pred0: fn, pred1: tp, pct: rNum((tp / Math.max(1, tp + fn)) * 100, 1) },
        ],
      },
    ],
    [],
    `İkili lojistik regresyon modeli anlamlıdır (χ²(${dfOmnibus}) = ${fmtNum(omnibusChi2, 2)}, p = ${fmtNum(omnibusP, 4)}, Nagelkerke R² = ${fmtNum(nagelkerkeR2, 3)}) ve gözlemlerin %${fmtNum(acc * 100, 1)}'ini doğru sınıflandırmıştır.`,
    `Binary logistic regression was significant (χ²(${dfOmnibus}) = ${fmtNum(omnibusChi2, 2)}, p = ${fmtNum(omnibusP, 4)}, Nagelkerke R² = ${fmtNum(nagelkerkeR2, 3)}), achieving ${fmtNum(acc * 100, 1)}% classification accuracy.`,
  );
}

export function runRocCurve(dataset: Dataset, scoreVar: string, stateVar: string): AnalysisOutput {
  const levels = Array.from(new Set(dataset.rows.map((r) => r[stateVar]).filter((v) => v !== null && v !== undefined && v !== '')));
  if (levels.length < 2) {
    throw new StatInputError('SINGLE_CATEGORY', 'ROC analizi için durum değişkeninde 2 kategori bulunmalıdır.', 'ROC analysis requires 2 categories in the state variable.');
  }
  if (levels.length > 2) {
    throw new StatInputError(
      'TOO_MANY_GROUPS',
      `ROC analizi için durum değişkeni tam olarak 2 kategori içermelidir ("${stateVar}" içinde ${levels.length} kategori var).`,
      `ROC analysis requires exactly 2 state categories ("${stateVar}" has ${levels.length}).`,
    );
  }
  const posVal = levels.includes(1) ? 1 : levels.includes('1') ? '1' : levels[1];

  const pairs: { score: number; label: 0 | 1 }[] = [];
  for (const row of dataset.rows) {
    const sc = toNum(row[scoreVar]);
    const st = row[stateVar];
    if (sc !== null && st !== null && st !== undefined && st !== '') {
      pairs.push({ score: sc, label: st === posVal ? 1 : 0 });
    }
  }
  const nPos = pairs.filter((d) => d.label === 1).length;
  const nNeg = pairs.length - nPos;
  if (nPos < 2 || nNeg < 2) {
    throw new StatInputError(
      'INSUFFICIENT_N',
      `ROC için pozitif ve negatif sınıfların her birinde en az 2 vaka gereklidir (pozitif: ${nPos}, negatif: ${nNeg}).`,
      `ROC requires at least 2 cases in both positive and negative classes (positive: ${nPos}, negative: ${nNeg}).`,
    );
  }
  assertNonZeroVariance(pairs.map((d) => d.score), scoreVar);

  const sorted = [...pairs].sort((a, b) => b.score - a.score);
  const rocPts: { fpr: number; tpr: number; cutoff: number; youden: number }[] = [{ fpr: 0, tpr: 0, cutoff: Infinity, youden: 0 }];
  let tp = 0;
  let fp = 0;
  let i = 0;
  while (i < sorted.length) {
    const val = sorted[i].score;
    while (i < sorted.length && sorted[i].score === val) {
      if (sorted[i].label === 1) tp++;
      else fp++;
      i++;
    }
    const tpr = tp / nPos;
    const fpr = fp / nNeg;
    rocPts.push({ fpr, tpr, cutoff: val, youden: tpr + (1 - fpr) - 1 });
  }

  let auc = 0;
  for (let j = 1; j < rocPts.length; j++) {
    auc += 0.5 * (rocPts[j].fpr - rocPts[j - 1].fpr) * (rocPts[j].tpr + rocPts[j - 1].tpr);
  }
  const q1 = auc / (2 - auc);
  const q2 = (2 * auc * auc) / (1 + auc);
  const seAuc = Math.sqrt((auc * (1 - auc) + (nPos - 1) * (q1 - auc * auc) + (nNeg - 1) * (q2 - auc * auc)) / (nPos * nNeg));
  const ciLow = Math.max(0, auc - 1.96 * seAuc);
  const ciHigh = Math.min(1, auc + 1.96 * seAuc);
  const zStat = seAuc > 0 ? (auc - 0.5) / seAuc : 0;
  const pVal = seAuc > 0 ? clampP(2 * (1 - normalCdf(Math.abs(zStat)))) : Math.abs(auc - 0.5) > 1e-12 ? 0 : 1;

  const bestPt = rocPts.reduce((best, cur) => (cur.youden > best.youden ? cur : best), rocPts[1]);

  return buildOutput(
    'roc_curve',
    `ROC Eğrisi & Tanı Performansı (${scoreVar} -> ${stateVar})`,
    { scoreVar, stateVar, positiveClass: posVal },
    {
      nPos,
      nNeg,
      auc: rNum(auc, 4),
      se: rNum(seAuc, 4),
      ciLow: rNum(ciLow, 4),
      ciHigh: rNum(ciHigh, 4),
      p: rNum(pVal, 6),
      optimalCutoff: rNum(bestPt.cutoff, 3),
      youdenJ: rNum(bestPt.youden, 3),
      sensitivity: rNum(bestPt.tpr, 3),
      specificity: rNum(1 - bestPt.fpr, 3),
    },
    [
      {
        id: 'roc_summary',
        title: 'Eğri Altındaki Alan (AUC - Hanley & McNeil)',
        columns: [
          { key: 'auc', label: 'AUC', numeric: true },
          { key: 'se', label: 'SH', numeric: true },
          { key: 'ciLow', label: '%95 GA Alt', numeric: true },
          { key: 'ciHigh', label: '%95 GA Üst', numeric: true },
          { key: 'p', label: 'p (H₀: AUC=0.5)', numeric: true },
          { key: 'cutoff', label: 'Optimal Eşik', numeric: true },
          { key: 'youden', label: 'Youden J', numeric: true },
          { key: 'sens', label: 'Duyarlılık', numeric: true },
          { key: 'spec', label: 'Özgüllük', numeric: true },
        ],
        rows: [
          {
            auc: rNum(auc, 4),
            se: rNum(seAuc, 4),
            ciLow: rNum(ciLow, 4),
            ciHigh: rNum(ciHigh, 4),
            p: rNum(pVal, 5),
            cutoff: rNum(bestPt.cutoff, 3),
            youden: rNum(bestPt.youden, 3),
            sens: rNum(bestPt.tpr, 3),
            spec: rNum(1 - bestPt.fpr, 3),
          },
        ],
      },
    ],
    [
      {
        id: 'roc_plot',
        title: `ROC Eğrisi (AUC = ${fmtNum(auc, 3)})`,
        type: 'line',
        option: {
          tooltip: { trigger: 'item' },
          xAxis: { type: 'value', min: 0, max: 1, name: '1 - Özgüllük (FPR)' },
          yAxis: { type: 'value', min: 0, max: 1, name: 'Duyarlılık (TPR)' },
          series: [
            { name: 'ROC', type: 'line', data: rocPts.map((pt) => [rNum(pt.fpr, 3), rNum(pt.tpr, 3)]), showSymbol: false },
            { name: 'Referans', type: 'line', data: [[0, 0], [1, 1]], showSymbol: false, lineStyle: { type: 'dashed' } },
          ],
        },
      },
    ],
    `ROC analizinde eğri altında kalan alan AUC = ${fmtNum(auc, 3)} (%95 GA [${fmtNum(ciLow, 3)}, ${fmtNum(ciHigh, 3)}], p = ${fmtNum(pVal, 4)}) olarak hesaplanmış; optimal kesim noktası ${fmtNum(bestPt.cutoff, 2)} (Youden J = ${fmtNum(bestPt.youden, 3)}) bulunmuştur.`,
    `ROC analysis yielded AUC = ${fmtNum(auc, 3)} (95% CI [${fmtNum(ciLow, 3)}, ${fmtNum(ciHigh, 3)}], p = ${fmtNum(pVal, 4)}) with optimal threshold ${fmtNum(bestPt.cutoff, 2)} (Youden's J = ${fmtNum(bestPt.youden, 3)}).`,
  );
}

export function runBlandAltman(dataset: Dataset, method1: string, method2: string): AnalysisOutput {
  const mat = extractNumMatrix(dataset.rows, [method1, method2]);
  const n = mat.length;
  assertMinN(n, 3, 'Bland-Altman (tam çift)', 'Bland-Altman (complete pairs)');

  const diffs = mat.map((r) => r[0] - r[1]);
  const avgs = mat.map((r) => 0.5 * (r[0] + r[1]));
  const bias = mean(diffs);
  const sd = stdDev(diffs, 1);
  const seBias = sd / Math.sqrt(n);
  const tCrit = tInv(0.975, n - 1);
  const loaUpper = bias + 1.96 * sd;
  const loaLower = bias - 1.96 * sd;
  const seLoa = Math.sqrt(3 / n) * sd;
  const propCorr = pearsonPair(avgs, diffs);
  const propDefined = !isConstant(avgs) && !isConstant(diffs);
  if (!propDefined) propCorr.r = NaN;
  const propP = propDefined ? clampP(2 * (1 - tCdf(Math.abs(propCorr.t), n - 2))) : NaN;

  return buildOutput(
    'bland_altman',
    `Bland-Altman Yöntem Uyum Analizi (${method1} vs ${method2})`,
    { method1, method2 },
    {
      n,
      bias: rNum(bias, 4),
      sd: rNum(sd, 4),
      loaLower: rNum(loaLower, 4),
      loaUpper: rNum(loaUpper, 4),
      propCorrR: rNum(propCorr.r, 4),
      propCorrP: rNum(propP, 4),
    },
    [
      {
        id: 'ba_stats',
        title: 'Bland-Altman Uyum Sınırları (Limits of Agreement)',
        columns: [
          { key: 'metric', label: 'Ölçüt' },
          { key: 'value', label: 'Değer', numeric: true },
          { key: 'ciLow', label: '%95 GA Alt', numeric: true },
          { key: 'ciHigh', label: '%95 GA Üst', numeric: true },
        ],
        rows: [
          { metric: `Ortalama Fark / Bias (${method1} - ${method2})`, value: rNum(bias, 3), ciLow: rNum(bias - tCrit * seBias, 3), ciHigh: rNum(bias + tCrit * seBias, 3) },
          { metric: 'Farkların Std. Sapması', value: rNum(sd, 3), ciLow: null, ciHigh: null },
          { metric: 'Alt Uyum Sınırı (-1.96 SD)', value: rNum(loaLower, 3), ciLow: rNum(loaLower - tCrit * seLoa, 3), ciHigh: rNum(loaLower + tCrit * seLoa, 3) },
          { metric: 'Üst Uyum Sınırı (+1.96 SD)', value: rNum(loaUpper, 3), ciLow: rNum(loaUpper - tCrit * seLoa, 3), ciHigh: rNum(loaUpper + tCrit * seLoa, 3) },
          { metric: `Orantılı Yanlılık (r, p=${fmtNum(propP, 3)})`, value: rNum(propCorr.r, 3), ciLow: null, ciHigh: null },
        ],
      },
    ],
    [
      {
        id: 'ba_scatter',
        title: 'Bland-Altman Saçılım Grafiği',
        type: 'scatter',
        option: {
          tooltip: { trigger: 'item' },
          xAxis: { type: 'value', name: `Ortalama (${method1}, ${method2})` },
          yAxis: { type: 'value', name: `Fark (${method1} - ${method2})` },
          series: [
            {
              name: 'Ölçümler',
              type: 'scatter',
              symbolSize: 7,
              data: avgs.map((a, i) => [rNum(a, 3), rNum(diffs[i], 3)]),
            },
          ],
        },
      },
    ],
    `${method1} ile ${method2} arasındaki ortalama yanlılık (bias) = ${fmtNum(bias, 3)} olup %95 uyum sınırları [${fmtNum(loaLower, 3)}, ${fmtNum(loaUpper, 3)}] arasındadır.`,
    `Bland-Altman analysis showed mean bias = ${fmtNum(bias, 3)} with 95% limits of agreement [${fmtNum(loaLower, 3)}, ${fmtNum(loaUpper, 3)}].`,
  );
}

export function runKaplanMeier(dataset: Dataset, timeVar: string, eventVar: string, groupVar?: string): AnalysisOutput {
  interface SurvObs { t: number; e: 0 | 1; g: string }
  const obs: SurvObs[] = [];
  for (const row of dataset.rows) {
    const tv = toNum(row[timeVar]);
    const ev = row[eventVar];
    if (tv !== null && tv >= 0 && (ev === 0 || ev === 1 || ev === '0' || ev === '1')) {
      const grp = groupVar ? String(row[groupVar] ?? 'Diğer') : 'Tüm Örneklem';
      obs.push({ t: tv, e: Number(ev) === 1 ? 1 : 0, g: grp });
    }
  }
  assertMinN(obs.length, 3, 'Sağkalım analizi (geçerli kayıt: süre >= 0, olay 0/1)', 'Survival analysis (valid records: time >= 0, event 0/1)');

  const groupNames = Array.from(new Set(obs.map((o) => o.g)));
  const summaryRows: Record<string, string | number | null>[] = [];
  const kmSeries: { name: string; type: 'line'; step: 'end'; data: [number, number][] }[] = [];

  for (const gName of groupNames) {
    const sub = obs.filter((o) => o.g === gName).sort((a, b) => a.t - b.t);
    const nTotal = sub.length;
    const nEvents = sub.filter((s) => s.e === 1).length;
    const eventTimes = Array.from(new Set(sub.filter((s) => s.e === 1).map((s) => s.t))).sort((a, b) => a - b);

    let surv = 1;
    let greenwoodSum = 0;
    let medianSurv: number | null = null;
    const curvePts: [number, number][] = [[0, 1]];

    for (const et of eventTimes) {
      const atRisk = sub.filter((s) => s.t >= et).length;
      const events = sub.filter((s) => s.t === et && s.e === 1).length;
      if (atRisk > 0) {
        surv *= 1 - events / atRisk;
        if (atRisk > events) greenwoodSum += events / (atRisk * (atRisk - events));
      }
      if (medianSurv === null && surv <= 0.5) medianSurv = et;
      curvePts.push([rNum(et, 2)!, rNum(surv, 4)!]);
    }
    const maxT = Math.max(...sub.map((s) => s.t));
    curvePts.push([rNum(maxT, 2)!, rNum(surv, 4)!]);
    const finalSe = surv * Math.sqrt(greenwoodSum);
    summaryRows.push({
      group: gName,
      nTotal,
      nEvents,
      censored: nTotal - nEvents,
      finalSurv: rNum(surv, 3),
      se: rNum(finalSe, 3),
      medianTime: medianSurv !== null ? rNum(medianSurv, 2) : null,
    });
    kmSeries.push({ name: gName, type: 'line', step: 'end', data: curvePts });
  }

  // Log-rank test if >= 2 groups
  let logRankChi2 = 0;
  let logRankDf = 0;
  let logRankP = 1;
  if (groupNames.length >= 2) {
    const allEventTimes = Array.from(new Set(obs.filter((o) => o.e === 1).map((o) => o.t))).sort((a, b) => a - b);
    const K = groupNames.length;
    const O = new Array<number>(K).fill(0);
    const E = new Array<number>(K).fill(0);
    const V = Array.from({ length: K }, () => new Array<number>(K).fill(0));

    for (const et of allEventTimes) {
      const nRiskG = groupNames.map((g) => obs.filter((o) => o.g === g && o.t >= et).length);
      const dG = groupNames.map((g) => obs.filter((o) => o.g === g && o.t === et && o.e === 1).length);
      const N = nRiskG.reduce((a, b) => a + b, 0);
      const D = dG.reduce((a, b) => a + b, 0);
      if (N <= 1 || D === 0) continue;
      for (let i = 0; i < K; i++) {
        O[i] += dG[i];
        const ei = (D * nRiskG[i]) / N;
        E[i] += ei;
        for (let j = 0; j < K; j++) {
          const vFactor = (D * (N - D)) / (N * N * (N - 1));
          V[i][j] += vFactor * nRiskG[i] * ((i === j ? N : 0) - nRiskG[j]);
        }
      }
    }
    const diff = O.slice(0, K - 1).map((ov, i) => ov - E[i]);
    const Vsub = V.slice(0, K - 1).map((row) => row.slice(0, K - 1));
    const Vinv = invMatrix(Vsub) || pinvSymmetric(Vsub);
    for (let i = 0; i < K - 1; i++) {
      for (let j = 0; j < K - 1; j++) logRankChi2 += diff[i] * Vinv[i][j] * diff[j];
    }
    logRankChi2 = Math.max(0, logRankChi2);
    logRankDf = K - 1;
    logRankP = clampP(1 - chi2Cdf(logRankChi2, logRankDf));
  }

  return buildOutput(
    'kaplan_meier',
    `Kaplan-Meier Sağkalım Analizi (${timeVar}, ${eventVar})`,
    { timeVar, eventVar, groupVar: groupVar || null },
    {
      n: obs.length,
      groups: groupNames.length,
      logRankChi2: rNum(logRankChi2, 3),
      logRankDf,
      logRankP: rNum(logRankP, 5),
    },
    [
      {
        id: 'km_summary',
        title: 'Grup Sağkalım Özeti (Greenwood SH)',
        columns: [
          { key: 'group', label: 'Grup' },
          { key: 'nTotal', label: 'Toplam N', numeric: true },
          { key: 'nEvents', label: 'Olay (n)', numeric: true },
          { key: 'censored', label: 'Sansürlü', numeric: true },
          { key: 'finalSurv', label: 'Son S(t)', numeric: true },
          { key: 'se', label: 'SH', numeric: true },
          { key: 'medianTime', label: 'Medyan Süre', numeric: true },
        ],
        rows: summaryRows,
      },
      ...(groupNames.length >= 2
        ? [
            {
              id: 'km_logrank',
              title: 'Log-Rank (Mantel-Cox) Grup Karşılaştırması',
              columns: [
                { key: 'test', label: 'Test' },
                { key: 'chi2', label: 'Ki-Kare (χ²)', numeric: true },
                { key: 'df', label: 'sd', numeric: true },
                { key: 'p', label: 'p', numeric: true },
              ],
              rows: [{ test: 'Log-Rank (Mantel-Cox)', chi2: rNum(logRankChi2, 3), df: logRankDf, p: rNum(logRankP, 5) }],
            },
          ]
        : []),
    ],
    [
      {
        id: 'km_curve',
        title: 'Kaplan-Meier Sağkalım Eğrisi',
        type: 'line',
        option: {
          tooltip: { trigger: 'axis' },
          legend: { data: groupNames },
          xAxis: { type: 'value', name: timeVar },
          yAxis: { type: 'value', min: 0, max: 1, name: 'S(t)' },
          series: kmSeries,
        },
      },
    ],
    groupNames.length >= 2
      ? `Kaplan-Meier analizinde gruplar arasında Log-Rank χ²(${logRankDf}) = ${fmtNum(logRankChi2, 2)}, p = ${fmtNum(logRankP, 4)} bulunmuştur.`
      : `Kaplan-Meier sağkalım tahmini N = ${obs.length} vaka üzerinden hesaplanmıştır.`,
    groupNames.length >= 2
      ? `Kaplan-Meier survival curves yielded Log-Rank χ²(${logRankDf}) = ${fmtNum(logRankChi2, 2)}, p = ${fmtNum(logRankP, 4)}.`
      : `Kaplan-Meier survival curve estimated on N = ${obs.length} subjects.`,
  );
}

export function runProcessMacro(
  dataset: Dataset,
  opts: { model: 1 | 4; x: string; y: string; mOrW: string; covariates?: string[]; bootstrapSamples?: number },
): AnalysisOutput {
  const covs = opts.covariates || [];
  const cols = Array.from(new Set([opts.x, opts.mOrW, opts.y, ...covs]));
  const mat = extractNumMatrix(dataset.rows, cols);
  const n = mat.length;
  if (cols.length < 3 + covs.filter((c) => ![opts.x, opts.mOrW, opts.y].includes(c)).length) {
    throw new StatInputError('INVALID_VARIABLES', 'PROCESS için X, M/W ve Y birbirinden farklı değişkenler olmalıdır.', 'PROCESS requires X, M/W and Y to be different variables.');
  }
  assertMinN(n, cols.length + 5, 'PROCESS Macro (tam vaka)', 'PROCESS Macro (complete cases)');
  cols.forEach((c, j) => assertNonZeroVariance(mat.map((r) => r[j]), c));

  const idx = new Map(cols.map((c, i) => [c, i]));
  const xArr = mat.map((r) => r[idx.get(opts.x)!]);
  const mwArr = mat.map((r) => r[idx.get(opts.mOrW)!]);
  const yArr = mat.map((r) => r[idx.get(opts.y)!]);
  const covMat = mat.map((r) => covs.map((c) => r[idx.get(c)!]));

  if (opts.model === 4) {
    // Simple Mediation: X -> M -> Y
    const fitA = olsFit(mwArr, xArr.map((xv, i) => [xv, ...covMat[i]]));
    const fitB = olsFit(yArr, xArr.map((xv, i) => [xv, mwArr[i], ...covMat[i]]));
    const fitC = olsFit(yArr, xArr.map((xv, i) => [xv, ...covMat[i]]));

    const a = fitA.beta[1];
    const seA = fitA.se[1];
    const b = fitB.beta[2];
    const seB = fitB.se[2];
    const cPrime = fitB.beta[1];
    const cTotal = fitC.beta[1];
    const indirect = a * b;
    const sobelSe = Math.sqrt(b * b * seA * seA + a * a * seB * seB);
    const sobelZ = sobelSe > 0 ? indirect / sobelSe : 0;
    const sobelP = clampP(2 * (1 - normalCdf(Math.abs(sobelZ))));

    const B = opts.bootstrapSamples ?? 500;
    let seed = 918273;
    const rand = () => {
      seed = (seed + 0x6d2b79f5) | 0;
      let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
    const bootInd: number[] = [];
    for (let k = 0; k < B; k++) {
      const sampleIdx = Array.from({ length: n }, () => Math.floor(rand() * n));
      const bx = sampleIdx.map((s) => xArr[s]);
      const bm = sampleIdx.map((s) => mwArr[s]);
      const by = sampleIdx.map((s) => yArr[s]);
      const bCov = sampleIdx.map((s) => covMat[s]);
      const bA = olsFit(bm, bx.map((v, i) => [v, ...bCov[i]])).beta[1];
      const bB = olsFit(by, bx.map((v, i) => [v, bm[i], ...bCov[i]])).beta[2];
      bootInd.push(bA * bB);
    }
    bootInd.sort((u, v) => u - v);
    const bootSe = stdDev(bootInd, 1);
    const ciLow = quantile(bootInd, 0.025);
    const ciHigh = quantile(bootInd, 0.975);
    const sigMed = ciLow > 0 || ciHigh < 0;

    return buildOutput(
      'process_model4',
      `PROCESS Model 4 Aracılık Analizi (${opts.x} → ${opts.mOrW} → ${opts.y})`,
      { ...opts, bootstrapSamples: B },
      {
        n,
        a: rNum(a, 4),
        b: rNum(b, 4),
        cTotal: rNum(cTotal, 4),
        cPrime: rNum(cPrime, 4),
        indirectEffect: rNum(indirect, 4),
        bootSE: rNum(bootSe, 4),
        bootCILow: rNum(ciLow, 4),
        bootCIHigh: rNum(ciHigh, 4),
        sobelZ: rNum(sobelZ, 3),
        sobelP: rNum(sobelP, 5),
        significantIndirect: sigMed,
      },
      [
        {
          id: 'proc4_paths',
          title: 'Doğrudan & Toplam Yol Katsayıları',
          columns: [
            { key: 'path', label: 'Yol' },
            { key: 'coef', label: 'B', numeric: true },
            { key: 'se', label: 'SH', numeric: true },
            { key: 't', label: 't', numeric: true },
            { key: 'p', label: 'p', numeric: true },
            { key: 'sig', label: 'Düzey' },
          ],
          rows: [
            { path: `a (${opts.x} → ${opts.mOrW})`, coef: rNum(a, 4), se: rNum(seA, 4), t: rNum(fitA.t[1], 3), p: rNum(fitA.p[1], 5), sig: sigStars(fitA.p[1]) },
            { path: `b (${opts.mOrW} → ${opts.y})`, coef: rNum(b, 4), se: rNum(seB, 4), t: rNum(fitB.t[2], 3), p: rNum(fitB.p[2], 5), sig: sigStars(fitB.p[2]) },
            { path: `c' Doğrudan (${opts.x} → ${opts.y})`, coef: rNum(cPrime, 4), se: rNum(fitB.se[1], 4), t: rNum(fitB.t[1], 3), p: rNum(fitB.p[1], 5), sig: sigStars(fitB.p[1]) },
            { path: `c Toplam (${opts.x} → ${opts.y})`, coef: rNum(cTotal, 4), se: rNum(fitC.se[1], 4), t: rNum(fitC.t[1], 3), p: rNum(fitC.p[1], 5), sig: sigStars(fitC.p[1]) },
          ],
        },
        {
          id: 'proc4_indirect',
          title: `Dolaylı Etki & Bootstrap (${B} Tekrar)`,
          columns: [
            { key: 'effect', label: 'Dolaylı Etki' },
            { key: 'est', label: 'Etki (a×b)', numeric: true },
            { key: 'bootSe', label: 'Boot SH', numeric: true },
            { key: 'ciLow', label: 'BootLLCI', numeric: true },
            { key: 'ciHigh', label: 'BootULCI', numeric: true },
            { key: 'sobelZ', label: 'Sobel Z', numeric: true },
            { key: 'sobelP', label: 'Sobel p', numeric: true },
            { key: 'significant', label: 'Anlamlı?' },
          ],
          rows: [
            {
              effect: `${opts.x} → ${opts.mOrW} → ${opts.y}`,
              est: rNum(indirect, 4),
              bootSe: rNum(bootSe, 4),
              ciLow: rNum(ciLow, 4),
              ciHigh: rNum(ciHigh, 4),
              sobelZ: rNum(sobelZ, 3),
              sobelP: rNum(sobelP, 5),
              significant: sigMed ? 'Evet (0 dışarıda)' : 'Hayır',
            },
          ],
        },
      ],
      [],
      `PROCESS Model 4 (${B} bootstrap) sonucunda ${opts.x}'in ${opts.y} üzerindeki ${opts.mOrW} aracılı dolaylı etkisi B = ${fmtNum(indirect, 3)}, %95 BootGA [${fmtNum(ciLow, 3)}, ${fmtNum(ciHigh, 3)}] ${sigMed ? 'anlamlıdır' : 'anlamlı değildir'}.`,
      `PROCESS Model 4 (${B} bootstrap resamples) showed an indirect effect via ${opts.mOrW} of B = ${fmtNum(indirect, 3)}, 95% BootCI [${fmtNum(ciLow, 3)}, ${fmtNum(ciHigh, 3)}].`,
    );
  }

  // Model 1: Simple Moderation (X * W -> Y) centered
  const meanX = mean(xArr);
  const meanW = mean(mwArr);
  const sdW = stdDev(mwArr, 1);
  const sdX = stdDev(xArr, 1);
  const xc = xArr.map((v) => v - meanX);
  const wc = mwArr.map((v) => v - meanW);
  const intArr = xc.map((v, i) => v * wc[i]);

  const fitBase = olsFit(yArr, xc.map((v, i) => [v, wc[i], ...covMat[i]]));
  const fitFull = olsFit(yArr, xc.map((v, i) => [v, wc[i], intArr[i], ...covMat[i]]));
  const deltaR2 = Math.max(0, fitFull.r2 - fitBase.r2);
  const fInt = fitFull.t[3] * fitFull.t[3];
  const pInt = fitFull.p[3];

  const b1 = fitFull.beta[1];
  const b2 = fitFull.beta[2];
  const b3 = fitFull.beta[3];
  const covB = fitFull.covBeta;
  const levels = [
    { label: 'Düşük (-1 SS)', wVal: -sdW },
    { label: 'Orta (Ortalama)', wVal: 0 },
    { label: 'Yüksek (+1 SS)', wVal: sdW },
  ];
  const slopeRows = levels.map((lv) => {
    const slope = b1 + b3 * lv.wVal;
    const varSlope = Math.max(1e-12, covB[1][1] + lv.wVal * lv.wVal * covB[3][3] + 2 * lv.wVal * covB[1][3]);
    const seSlope = Math.sqrt(varSlope);
    const tSlope = slope / seSlope;
    const pSlope = clampP(2 * (1 - tCdf(Math.abs(tSlope), fitFull.dfResid)));
    const tc = tInv(0.975, fitFull.dfResid);
    return {
      level: `${lv.label} (${fmtNum(meanW + lv.wVal, 2)})`,
      slope: rNum(slope, 4),
      se: rNum(seSlope, 4),
      t: rNum(tSlope, 3),
      p: rNum(pSlope, 5),
      ciLow: rNum(slope - tc * seSlope, 4),
      ciHigh: rNum(slope + tc * seSlope, 4),
      sig: sigStars(pSlope),
    };
  });

  const yMean = fitFull.beta[0];
  const xPts = [-sdX, 0, sdX];
  const modSeries = levels.map((lv) => ({
    name: lv.label,
    type: 'line',
    data: xPts.map((xp) => rNum(yMean + b1 * xp + b2 * lv.wVal + b3 * xp * lv.wVal, 3)),
  }));

  return buildOutput(
    'process_model1',
    `PROCESS Model 1 Düzenleyici Etki (${opts.x} × ${opts.mOrW} → ${opts.y})`,
    opts,
    {
      n,
      r2: rNum(fitFull.r2, 4),
      deltaR2: rNum(deltaR2, 4),
      fInteraction: rNum(fInt, 4),
      pInteraction: rNum(pInt, 5),
      bInteraction: rNum(b3, 4),
    },
    [
      {
        id: 'proc1_coefs',
        title: 'Etkileşim Regresyon Katsayıları (Merkezileştirilmiş)',
        columns: [
          { key: 'term', label: 'Terim' },
          { key: 'b', label: 'B', numeric: true },
          { key: 'se', label: 'SH', numeric: true },
          { key: 't', label: 't', numeric: true },
          { key: 'p', label: 'p', numeric: true },
          { key: 'sig', label: 'Düzey' },
        ],
        rows: [
          { term: 'Sabit', b: rNum(fitFull.beta[0], 4), se: rNum(fitFull.se[0], 4), t: rNum(fitFull.t[0], 3), p: rNum(fitFull.p[0], 5), sig: sigStars(fitFull.p[0]) },
          { term: `${opts.x} (Merkez)`, b: rNum(b1, 4), se: rNum(fitFull.se[1], 4), t: rNum(fitFull.t[1], 3), p: rNum(fitFull.p[1], 5), sig: sigStars(fitFull.p[1]) },
          { term: `${opts.mOrW} (Merkez)`, b: rNum(b2, 4), se: rNum(fitFull.se[2], 4), t: rNum(fitFull.t[2], 3), p: rNum(fitFull.p[2], 5), sig: sigStars(fitFull.p[2]) },
          { term: `Etkileşim (${opts.x} × ${opts.mOrW})`, b: rNum(b3, 4), se: rNum(fitFull.se[3], 4), t: rNum(fitFull.t[3], 3), p: rNum(pInt, 5), sig: sigStars(pInt) },
        ],
      },
      {
        id: 'proc1_slopes',
        title: `Koşullu Etkiler (Simple Slopes - ΔR² = ${fmtNum(deltaR2, 4)}, F = ${fmtNum(fInt, 2)})`,
        columns: [
          { key: 'level', label: `${opts.mOrW} Düzeyi` },
          { key: 'slope', label: 'Koşullu Eğim', numeric: true },
          { key: 'se', label: 'SH', numeric: true },
          { key: 't', label: 't', numeric: true },
          { key: 'p', label: 'p', numeric: true },
          { key: 'ciLow', label: '%95 Alt', numeric: true },
          { key: 'ciHigh', label: '%95 Üst', numeric: true },
          { key: 'sig', label: 'Düzey' },
        ],
        rows: slopeRows,
      },
    ],
    [
      {
        id: 'proc1_plot',
        title: 'Basit Eğimler (Simple Slopes) Etkileşim Grafiği',
        type: 'line',
        option: {
          tooltip: { trigger: 'axis' },
          legend: { data: levels.map((l) => l.label) },
          xAxis: { type: 'category', data: [`${opts.x} (-1 SS)`, `${opts.x} (Ort)`, `${opts.x} (+1 SS)`] },
          yAxis: { type: 'value', name: opts.y },
          series: modSeries,
        },
      },
    ],
    `PROCESS Model 1 moderasyon analizinde ${opts.x} × ${opts.mOrW} etkileşimi ΔR² = ${fmtNum(deltaR2, 3)}, F = ${fmtNum(fInt, 2)}, p = ${fmtNum(pInt, 4)} olarak hesaplanmıştır.`,
    `PROCESS Model 1 moderation yielded an interaction term ΔR² = ${fmtNum(deltaR2, 3)}, F = ${fmtNum(fInt, 2)}, p = ${fmtNum(pInt, 4)}.`,
  );
}

export type PowerTestType =
  | 'indep_t'
  | 'paired_t'
  | 'one_sample_t'
  | 'oneway_anova'
  | 'correlation'
  | 'linear_regression'
  | 'chi_square'
  | 'proportions_2';

export interface PowerRequest {
  testType: PowerTestType;
  mode?: 'apriori' | 'posthoc';
  alpha?: number;
  power?: number;
  effectSize?: number;
  n?: number;
  allocationRatio?: number;
  groups?: number;
  predictors?: number;
  df?: number;
  tails?: 1 | 2;
}

export function runPowerAnalysis(req: PowerRequest): AnalysisOutput {
  const badParam = (fieldTr: string, fieldEn: string, rule: string, ruleEn: string): never => {
    throw new StatInputError('INVALID_PARAMETER', `Güç analizi: ${fieldTr} ${rule}.`, `Power analysis: ${fieldEn} ${ruleEn}.`);
  };
  if (req.alpha !== undefined && !(req.alpha > 0 && req.alpha < 1)) badParam('alfa', 'alpha', '0 ile 1 arasında olmalıdır', 'must be between 0 and 1');
  if (req.power !== undefined && !(req.power > 0 && req.power < 1)) badParam('hedef güç', 'target power', '0 ile 1 arasında olmalıdır', 'must be between 0 and 1');
  if (req.effectSize !== undefined && !(Number.isFinite(req.effectSize) && req.effectSize > 0)) badParam('etki büyüklüğü', 'effect size', 'pozitif ve sonlu olmalıdır', 'must be positive and finite');
  if (req.n !== undefined && !(Number.isFinite(req.n) && req.n > 0)) badParam('örneklem büyüklüğü', 'sample size', 'pozitif ve sonlu olmalıdır', 'must be positive and finite');
  if (req.allocationRatio !== undefined && !(Number.isFinite(req.allocationRatio) && req.allocationRatio > 0)) badParam('dağılım oranı', 'allocation ratio', 'pozitif olmalıdır', 'must be positive');
  const mode = req.mode ?? 'apriori';
  const alpha = req.alpha ?? 0.05;
  const targetPower = req.power ?? 0.8;
  const effectSize = Math.max(0.01, req.effectSize ?? 0.5);
  const tails = req.tails ?? 2;
  const ratio = Math.max(0.1, req.allocationRatio ?? 1);
  const groups = Math.max(2, Math.round(req.groups ?? 3));
  const predictors = Math.max(1, Math.round(req.predictors ?? 3));
  const chiDf = Math.max(1, Math.round(req.df ?? 1));

  const computeAtN = (nTotal: number): { power: number; crit: number; df1: number; df2: number | null; ncp: number } => {
    const N = Math.max(4, Math.round(nTotal));
    if (req.testType === 'indep_t') {
      const n1 = Math.max(2, Math.round(N / (1 + ratio)));
      const n2 = Math.max(2, N - n1);
      const df = n1 + n2 - 2;
      const ncp = effectSize * Math.sqrt((n1 * n2) / (n1 + n2));
      const crit = tInv(tails === 2 ? 1 - alpha / 2 : 1 - alpha, df);
      const pwr =
        tails === 2
          ? 1 - nctCdf(crit, df, ncp) + nctCdf(-crit, df, ncp)
          : 1 - nctCdf(crit, df, ncp);
      return { power: pwr, crit, df1: df, df2: null, ncp };
    }
    if (req.testType === 'paired_t' || req.testType === 'one_sample_t') {
      const df = N - 1;
      const ncp = effectSize * Math.sqrt(N);
      const crit = tInv(tails === 2 ? 1 - alpha / 2 : 1 - alpha, df);
      const pwr =
        tails === 2
          ? 1 - nctCdf(crit, df, ncp) + nctCdf(-crit, df, ncp)
          : 1 - nctCdf(crit, df, ncp);
      return { power: pwr, crit, df1: df, df2: null, ncp };
    }
    if (req.testType === 'oneway_anova') {
      const df1 = groups - 1;
      const df2 = Math.max(2, N - groups);
      const ncp = N * effectSize * effectSize;
      const crit = fInv(1 - alpha, df1, df2);
      const pwr = 1 - ncfCdf(crit, df1, df2, ncp);
      return { power: pwr, crit, df1, df2, ncp };
    }
    if (req.testType === 'linear_regression') {
      const df1 = predictors;
      const df2 = Math.max(2, N - predictors - 1);
      const ncp = N * effectSize; // effectSize is f^2 here
      const crit = fInv(1 - alpha, df1, df2);
      const pwr = 1 - ncfCdf(crit, df1, df2, ncp);
      return { power: pwr, crit, df1, df2, ncp };
    }
    if (req.testType === 'correlation') {
      const r = Math.min(0.99, Math.abs(effectSize));
      const df = Math.max(2, N - 2);
      const ncp = (r * Math.sqrt(df)) / Math.sqrt(1 - r * r);
      const crit = tInv(tails === 2 ? 1 - alpha / 2 : 1 - alpha, df);
      const pwr =
        tails === 2
          ? 1 - nctCdf(crit, df, ncp) + nctCdf(-crit, df, ncp)
          : 1 - nctCdf(crit, df, ncp);
      return { power: pwr, crit, df1: df, df2: null, ncp };
    }
    if (req.testType === 'chi_square') {
      const ncp = N * effectSize * effectSize;
      const crit = chi2Inv(1 - alpha, chiDf);
      // Patnaik 2-moment central chi2 approximation for noncentral chi2
      const cScale = (chiDf + 2 * ncp) / (chiDf + ncp);
      const dfEq = Math.pow(chiDf + ncp, 2) / (chiDf + 2 * ncp);
      const pwr = 1 - chi2Cdf(crit / cScale, dfEq);
      return { power: pwr, crit, df1: chiDf, df2: null, ncp };
    }
    // proportions_2 (effectSize = Cohen's h)
    const n1 = Math.max(2, Math.round(N / (1 + ratio)));
    const n2 = Math.max(2, N - n1);
    const crit = normalInv(tails === 2 ? 1 - alpha / 2 : 1 - alpha);
    const ncp = effectSize * Math.sqrt((n1 * n2) / (n1 + n2));
    const pwr =
      tails === 2
        ? 1 - normalCdf(crit - ncp) + normalCdf(-crit - ncp)
        : 1 - normalCdf(crit - ncp);
    return { power: pwr, crit, df1: n1 + n2, df2: null, ncp };
  };

  let solvedN = req.n ?? 128;
  if (mode === 'apriori') {
    let low = req.testType === 'oneway_anova' ? groups * 2 : req.testType === 'linear_regression' ? predictors + 4 : 4;
    let high = low;
    while (computeAtN(high).power < targetPower && high < 20000) high *= 2;
    while (low < high) {
      const mid = Math.floor((low + high) / 2);
      if (computeAtN(mid).power >= targetPower) high = mid;
      else low = mid + 1;
    }
    // For equal allocation indep_t / proportions_2 ensure even N if ratio=1
    if ((req.testType === 'indep_t' || req.testType === 'proportions_2') && ratio === 1 && low % 2 === 1) {
      low += 1;
    }
    solvedN = low;
  }

  const finalRes = computeAtN(solvedN);
  const n1Out = req.testType === 'indep_t' || req.testType === 'proportions_2' ? Math.round(solvedN / (1 + ratio)) : solvedN;
  const n2Out = req.testType === 'indep_t' || req.testType === 'proportions_2' ? solvedN - n1Out : 0;

  // Power curve across N points
  const curveNs = Array.from({ length: 12 }, (_, idx) => Math.max(6, Math.round((solvedN * (idx + 2)) / 10)));
  const curvePowers = curveNs.map((nn) => rNum(computeAtN(nn).power, 4));

  return buildOutput(
    'power_analysis',
    `G*Power Güç Analizi (${req.testType})`,
    { ...req, mode, solvedN },
    {
      testType: req.testType,
      mode,
      requiredN: solvedN,
      n1: n1Out,
      n2: n2Out,
      df: finalRes.df1,
      df2: finalRes.df2,
      criticalValue: rNum(finalRes.crit, 6),
      ncp: rNum(finalRes.ncp, 6),
      actualPower: rNum(finalRes.power, 6),
    },
    [
      {
        id: 'power_result',
        title: `Güç & Örneklem Çözümü (${mode === 'apriori' ? 'A Priori' : 'Post-Hoc'})`,
        columns: [
          { key: 'param', label: 'Parametre' },
          { key: 'value', label: 'Değer', numeric: true },
        ],
        rows: [
          { param: 'Toplam Örneklem (N)', value: solvedN },
          ...(n2Out > 0
            ? [
                { param: 'Grup 1 (n₁)', value: n1Out },
                { param: 'Grup 2 (n₂)', value: n2Out },
              ]
            : []),
          { param: 'Serbestlik Derecesi (sd₁)', value: finalRes.df1 },
          ...(finalRes.df2 !== null ? [{ param: 'Serbestlik Derecesi (sd₂)', value: finalRes.df2 }] : []),
          { param: 'Kritik Değer', value: rNum(finalRes.crit, 5) },
          { param: 'Merkezi Olmayan Parametre (λ / δ)', value: rNum(finalRes.ncp, 5) },
          { param: 'Gerçekleşen İstatistiksel Güç (1 - β)', value: rNum(finalRes.power, 5) },
        ],
      },
    ],
    [
      {
        id: 'power_curve',
        title: 'Örneklem - Güç (1 - β) Eğrisi',
        type: 'line',
        option: {
          tooltip: { trigger: 'axis' },
          xAxis: { type: 'category', data: curveNs.map(String), name: 'Toplam N' },
          yAxis: { type: 'value', min: 0, max: 1, name: 'Güç (1 - β)' },
          series: [{ name: 'Güç', type: 'line', data: curvePowers, smooth: true }],
        },
      },
    ],
    `${req.testType} tasarımı için α = ${alpha}, etki büyüklüğü = ${effectSize} koşullarında N = ${solvedN} (sd = ${finalRes.df1}, kritik = ${fmtNum(finalRes.crit, 3)}) ile gerçekleşen güç 1 - β = ${fmtNum(finalRes.power, 4)} bulunmuştur.`,
    `Power analysis for ${req.testType} (α = ${alpha}, effect size = ${effectSize}) yielded N = ${solvedN} (df = ${finalRes.df1}, critical = ${fmtNum(finalRes.crit, 3)}, actual power = ${fmtNum(finalRes.power, 4)}).`,
  );
}

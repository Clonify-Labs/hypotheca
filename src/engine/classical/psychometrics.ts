import { AnalysisOutput, AssumptionBadge, Dataset } from '../../types/interfaces';
import { chi2Cdf, fCdf, fInv, normalCdf, tCdf } from '../core/distributions';
import {
  corrMatrix,
  covMatrix,
  detAndLogDet,
  invMatrix,
  jacobiEigen,
  matMul,
  mean,
  nelderMead,
  olsFit,
  pinvSymmetric,
  stdDev,
  transpose,
  variance,
  varimaxRotate,
} from '../core/linalg';
import { StatInputError, assertMinN, clampP, isConstant } from '../core/errors';
import { buildOutput, extractNumMatrix, pearsonPair, rNum, sigStars, fmtNum } from './helpers';

function assertUniqueItems(items: string[], labelTr: string, labelEn: string): void {
  if (new Set(items).size !== items.length) {
    throw new StatInputError('DUPLICATE_VARIABLES', `${labelTr}: aynı madde birden fazla kez seçilmiş.`, `${labelEn}: the same item was selected more than once.`);
  }
}

/** Throws ZERO_VARIANCE naming every constant item column in the listwise matrix. */
function assertNoConstantItems(mat: number[][], items: string[], labelTr: string, labelEn: string): void {
  const constant = items.filter((_, j) => isConstant(mat.map((r) => r[j])));
  if (constant.length) {
    throw new StatInputError(
      'ZERO_VARIANCE',
      `${labelTr}: şu maddelerin varyansı sıfır (tüm yanıtlar aynı), analizden çıkarın: ${constant.join(', ')}.`,
      `${labelEn}: the following items have zero variance (all responses identical); remove them: ${constant.join(', ')}.`,
    );
  }
}

export function runReliability(dataset: Dataset, items: string[]): AnalysisOutput {
  if (items.length < 2) {
    throw new StatInputError('TOO_FEW_ITEMS', 'Güvenirlik analizi için en az 2 madde gereklidir.', 'Reliability analysis requires at least 2 items.');
  }
  assertUniqueItems(items, 'Güvenirlik analizi', 'Reliability analysis');
  const mat = extractNumMatrix(dataset.rows, items);
  const n = mat.length;
  const k = items.length;
  assertMinN(n, 3, 'Güvenirlik analizi (tam vaka)', 'Reliability analysis (complete cases)');
  assertNoConstantItems(mat, items, 'Güvenirlik analizi', 'Reliability analysis');

  const S = covMatrix(mat, 1);
  const R = corrMatrix(mat);
  const itemMeans = Array.from({ length: k }, (_, j) => mean(mat.map((r) => r[j])));
  const itemVars = Array.from({ length: k }, (_, j) => S[j][j]);
  const sumItemVars = itemVars.reduce((a, b) => a + b, 0);

  const totals = mat.map((r) => r.reduce((a, b) => a + b, 0));
  const totalVar = variance(totals, 1);
  const totalMean = mean(totals);
  const alpha = k > 1 && totalVar > 0 ? (k / (k - 1)) * (1 - sumItemVars / totalVar) : 0;

  let offR = 0;
  for (let i = 0; i < k; i++) {
    for (let j = 0; j < k; j++) {
      if (i !== j) offR += R[i][j];
    }
  }
  const avgR = offR / (k * (k - 1));
  const stdAlpha = (k * avgR) / (1 + (k - 1) * avgR);

  // Split-Half (Part 1 vs Part 2)
  const splitIdx = Math.ceil(k / 2);
  const part1 = mat.map((r) => r.slice(0, splitIdx).reduce((a, b) => a + b, 0));
  const part2 = mat.map((r) => r.slice(splitIdx).reduce((a, b) => a + b, 0));
  const rHalf = pearsonPair(part1, part2).r;
  const sbEqual = (2 * rHalf) / (1 + rHalf);
  const guttmanL4 = totalVar > 0 ? 4 * covMatrix(part1.map((v, i) => [v, part2[i]]), 1)[0][1] / totalVar : 0;

  // Item-Total Statistics
  const itemRows: Record<string, string | number | null>[] = [];
  for (let j = 0; j < k; j++) {
    const itemVals = mat.map((r) => r[j]);
    const restTotals = totals.map((t, i) => t - itemVals[i]);
    const restMean = totalMean - itemMeans[j];
    const restVar = variance(restTotals, 1);
    const citc = pearsonPair(itemVals, restTotals).r;
    const otherCols = mat.map((r) => r.filter((_, idx) => idx !== j));
    const smc = k > 2 ? (n > k ? olsFit(itemVals, otherCols).r2 : NaN) : citc * citc;
    const alphaDel = k > 2 && restVar > 0 ? ((k - 1) / (k - 2)) * (1 - (sumItemVars - itemVars[j]) / restVar) : 0;

    itemRows.push({
      item: items[j],
      mean: rNum(itemMeans[j], 3),
      std: rNum(Math.sqrt(itemVars[j]), 3),
      scaleMeanIfDeleted: rNum(restMean, 4),
      scaleVarIfDeleted: rNum(restVar, 4),
      citc: rNum(citc, 4),
      smc: rNum(smc, 4),
      alphaIfDeleted: rNum(alphaDel, 4),
    });
  }

  // Hotelling's T-Squared Test (k - 1 contrast differences)
  const C: number[][] = [];
  for (let r = 0; r < k - 1; r++) {
    const cRow = new Array<number>(k).fill(0);
    cRow[r] = 1;
    cRow[r + 1] = -1;
    C.push(cRow);
  }
  const dMean = C.map((cRow) => cRow.reduce((s, w, j) => s + w * itemMeans[j], 0));
  const Sd = matMul(matMul(C, S), transpose(C));
  const SdInv = invMatrix(Sd) || pinvSymmetric(Sd);
  let t2 = 0;
  for (let i = 0; i < k - 1; i++) {
    for (let j = 0; j < k - 1; j++) t2 += dMean[i] * SdInv[i][j] * dMean[j];
  }
  t2 *= n;
  const hotDf1 = k - 1;
  const hotDf2 = Math.max(1, n - k + 1);
  const hotF = n > k ? ((n - k + 1) / ((n - 1) * (k - 1))) * t2 : 0;
  const hotP = n > k ? clampP(1 - fCdf(hotF, hotDf1, hotDf2)) : NaN;

  // Two-Way Random ANOVA + Tukey Test for Nonadditivity + ICC(2,1) & ICC(2,k)
  const grandMean = mean(itemMeans);
  const subjMeans = mat.map((r) => mean(r));
  let ssTotal = 0;
  for (let i = 0; i < n; i++) {
    for (let j = 0; j < k; j++) ssTotal += Math.pow(mat[i][j] - grandMean, 2);
  }
  const ssSubj = k * subjMeans.reduce((s, rm) => s + Math.pow(rm - grandMean, 2), 0);
  const ssItems = n * itemMeans.reduce((s, cm) => s + Math.pow(cm - grandMean, 2), 0);
  const ssResid = Math.max(0, ssTotal - ssSubj - ssItems);

  let pNum = 0;
  for (let i = 0; i < n; i++) {
    for (let j = 0; j < k; j++) pNum += mat[i][j] * (subjMeans[i] - grandMean) * (itemMeans[j] - grandMean);
  }
  const qDen =
    subjMeans.reduce((s, rm) => s + Math.pow(rm - grandMean, 2), 0) *
    itemMeans.reduce((s, cm) => s + Math.pow(cm - grandMean, 2), 0);
  const ssNonAdd = qDen > 0 ? (pNum * pNum) / qDen : 0;
  const ssBalance = Math.max(1e-12, ssResid - ssNonAdd);
  const dfBalance = (n - 1) * (k - 1) - 1;
  const tukeyF = dfBalance > 0 ? ssNonAdd / (ssBalance / dfBalance) : 0;
  const tukeyP = dfBalance > 0 ? clampP(1 - fCdf(tukeyF, 1, dfBalance)) : NaN;

  const dfSubj = n - 1;
  const dfErr = (n - 1) * (k - 1);
  const bms = ssSubj / dfSubj;
  const ems = ssResid / dfErr;
  const iccF = ems > 0 ? bms / ems : 1;
  const iccSingle = (bms - ems) / (bms + (k - 1) * ems);
  const iccAvg = (bms - ems) / bms;
  const fL = iccF / fInv(0.975, dfSubj, dfErr);
  const fU = iccF * fInv(0.975, dfErr, dfSubj);
  const iccSingleLow = (fL - 1) / (fL + k - 1);
  const iccSingleHigh = (fU - 1) / (fU + k - 1);
  const iccAvgLow = 1 - 1 / fL;
  const iccAvgHigh = 1 - 1 / fU;

  return buildOutput(
    'reliability',
    `Güvenirlik & Madde Analizi (${k} Madde)`,
    { items },
    {
      n,
      k,
      cronbachAlpha: rNum(alpha, 6),
      stdAlpha: rNum(stdAlpha, 6),
      splitHalfSB: rNum(sbEqual, 4),
      guttmanL4: rNum(guttmanL4, 4),
      hotellingT2: rNum(t2, 5),
      hotellingF: rNum(hotF, 4),
      hotellingDf1: hotDf1,
      hotellingDf2: hotDf2,
      hotellingP: rNum(hotP, 4),
      tukeyNonaddSS: rNum(ssNonAdd, 4),
      tukeyF: rNum(tukeyF, 4),
      tukeyP: rNum(tukeyP, 4),
      iccSingle: rNum(iccSingle, 4),
      iccSingleCI: [rNum(iccSingleLow, 3), rNum(iccSingleHigh, 3)],
      iccAvg: rNum(iccAvg, 4),
      iccAvgCI: [rNum(iccAvgLow, 3), rNum(iccAvgHigh, 3)],
      iccF: rNum(iccF, 4),
    },
    [
      {
        id: 'reliability_summary',
        title: 'Güvenirlik İstatistikleri',
        columns: [
          { key: 'metric', label: 'Ölçüt' },
          { key: 'value', label: 'Değer', numeric: true },
        ],
        rows: [
          { metric: "Cronbach's Alpha (α)", value: rNum(alpha, 4) },
          { metric: "Standardize Alpha", value: rNum(stdAlpha, 4) },
          { metric: 'Spearman-Brown İki Yarı', value: rNum(sbEqual, 4) },
          { metric: 'Guttman Split-Half (λ4)', value: rNum(guttmanL4, 4) },
          { metric: 'Madde Sayısı (k)', value: k },
          { metric: 'Geçerli Örneklem (N)', value: n },
        ],
      },
      {
        id: 'item_total',
        title: 'Madde-Toplam İstatistikleri (Item-Total)',
        columns: [
          { key: 'item', label: 'Madde' },
          { key: 'mean', label: 'Ort.', numeric: true },
          { key: 'std', label: 'SS', numeric: true },
          { key: 'scaleMeanIfDeleted', label: 'Silinirse Ölçek Ort.', numeric: true },
          { key: 'scaleVarIfDeleted', label: 'Silinirse Ölçek Var.', numeric: true },
          { key: 'citc', label: 'Düz. Madde-Top. r', numeric: true },
          { key: 'smc', label: 'SMC (R²)', numeric: true },
          { key: 'alphaIfDeleted', label: 'Silinirse α', numeric: true },
        ],
        rows: itemRows,
      },
      {
        id: 'hotelling_tukey',
        title: "Hotelling T² ve Tukey Toplanabilirlik Testi",
        columns: [
          { key: 'test', label: 'Test' },
          { key: 'stat', label: 'İstatistik', numeric: true },
          { key: 'f', label: 'F', numeric: true },
          { key: 'df1', label: 'sd1', numeric: true },
          { key: 'df2', label: 'sd2', numeric: true },
          { key: 'p', label: 'p', numeric: true },
        ],
        rows: [
          { test: "Hotelling's T²", stat: rNum(t2, 3), f: rNum(hotF, 3), df1: hotDf1, df2: hotDf2, p: rNum(hotP, 4) },
          { test: 'Tukey Nonadditivity (F)', stat: rNum(ssNonAdd, 3), f: rNum(tukeyF, 3), df1: 1, df2: dfBalance, p: rNum(tukeyP, 4) },
        ],
      },
      {
        id: 'icc_table',
        title: 'Sınıf İçi Korelasyon Katsayısı (ICC - Tutarlılık)',
        columns: [
          { key: 'measure', label: 'Ölçüm' },
          { key: 'icc', label: 'ICC', numeric: true },
          { key: 'ciLow', label: '%95 GA Alt', numeric: true },
          { key: 'ciHigh', label: '%95 GA Üst', numeric: true },
          { key: 'f', label: 'F', numeric: true },
          { key: 'df1', label: 'sd1', numeric: true },
          { key: 'df2', label: 'sd2', numeric: true },
        ],
        rows: [
          { measure: 'Tekil Ölçümler ICC(C,1)', icc: rNum(iccSingle, 3), ciLow: rNum(iccSingleLow, 3), ciHigh: rNum(iccSingleHigh, 3), f: rNum(iccF, 3), df1: dfSubj, df2: dfErr },
          { measure: 'Ortalama Ölçümler ICC(C,k)', icc: rNum(iccAvg, 3), ciLow: rNum(iccAvgLow, 3), ciHigh: rNum(iccAvgHigh, 3), f: rNum(iccF, 3), df1: dfSubj, df2: dfErr },
        ],
      },
    ],
    [],
    `${k} maddeli ölçeğin Cronbach alfa iç tutarlılık katsayısı α = ${fmtNum(alpha, 3)} (ICC ortalama = ${fmtNum(iccAvg, 3)}, %95 GA [${fmtNum(iccAvgLow, 3)}, ${fmtNum(iccAvgHigh, 3)}]) olarak saptanmıştır.`,
    `Internal consistency across the ${k} items was Cronbach's α = ${fmtNum(alpha, 3)} (average ICC = ${fmtNum(iccAvg, 3)}, 95% CI [${fmtNum(iccAvgLow, 3)}, ${fmtNum(iccAvgHigh, 3)}]).`,
  );
}

export function runEfa(
  dataset: Dataset,
  items: string[],
  opts: { nFactors?: number; rotation?: 'varimax' | 'none'; extraction?: 'pca' | 'paf' } = {},
): AnalysisOutput {
  if (items.length < 3) {
    throw new StatInputError('TOO_FEW_ITEMS', 'Açımlayıcı Faktör Analizi (AFA) için en az 3 madde gereklidir.', 'Exploratory factor analysis requires at least 3 items.');
  }
  assertUniqueItems(items, 'AFA', 'EFA');
  const mat = extractNumMatrix(dataset.rows, items);
  const n = mat.length;
  const p = items.length;
  if (n < p + 2) {
    throw new StatInputError(
      n === 0 ? 'EMPTY_DATA' : 'INSUFFICIENT_N',
      `AFA için tam vaka sayısı (${n}) madde sayısından en az 2 fazla olmalıdır (gereken: ${p + 2}).`,
      `EFA requires at least ${p + 2} complete cases (items + 2); found ${n}.`,
    );
  }
  assertNoConstantItems(mat, items, 'AFA', 'EFA');

  const R = corrMatrix(mat);
  if (!detAndLogDet(R).pd) {
    throw new StatInputError(
      'SINGULAR_MATRIX',
      'Korelasyon matrisi pozitif tanımlı değil (tekil); maddeler arasında tam doğrusal bağımlılık var. Tekrarlayan veya türetilmiş maddeleri çıkarın.',
      'The correlation matrix is not positive definite (singular); some items are perfectly collinear. Remove duplicated or derived items.',
    );
  }
  const RInv = invMatrix(R) || pinvSymmetric(R);
  const { logDet } = detAndLogDet(R);

  // KMO & Bartlett
  let sumR2 = 0;
  let sumP2 = 0;
  const itemMsa: number[] = [];
  for (let i = 0; i < p; i++) {
    let iR2 = 0;
    let iP2 = 0;
    for (let j = 0; j < p; j++) {
      if (i === j) continue;
      const r2 = R[i][j] * R[i][j];
      const part = -RInv[i][j] / Math.sqrt(Math.max(1e-12, RInv[i][i] * RInv[j][j]));
      const p2 = part * part;
      sumR2 += r2;
      sumP2 += p2;
      iR2 += r2;
      iP2 += p2;
    }
    itemMsa.push(iR2 + iP2 > 0 ? iR2 / (iR2 + iP2) : 0);
  }
  const kmo = sumR2 + sumP2 > 0 ? sumR2 / (sumR2 + sumP2) : 0;
  const bartChi2 = Math.max(0, -(n - 1 - (2 * p + 5) / 6) * logDet);
  const bartDf = (p * (p - 1)) / 2;
  const bartP = clampP(1 - chi2Cdf(bartChi2, bartDf));

  const eig = jacobiEigen(R);
  const evals = eig.values;
  const m = opts.nFactors && opts.nFactors >= 1 ? Math.min(opts.nFactors, p) : Math.max(1, evals.filter((v) => v > 1.0).length);

  // Extraction
  let loadings: number[][] = Array.from({ length: p }, () => new Array<number>(m).fill(0));
  if (opts.extraction === 'paf') {
    let comm = Array.from({ length: p }, (_, i) => Math.min(0.99, Math.max(0.1, 1 - 1 / Math.max(1.01, RInv[i][i]))));
    for (let iter = 0; iter < 25; iter++) {
      const reduced = R.map((row, i) => row.map((v, j) => (i === j ? comm[i] : v)));
      const redEig = jacobiEigen(reduced);
      for (let i = 0; i < p; i++) {
        for (let f = 0; f < m; f++) {
          loadings[i][f] = redEig.vectors[i][f] * Math.sqrt(Math.max(0, redEig.values[f]));
        }
      }
      const nextComm = loadings.map((row) => Math.min(0.999, row.reduce((s, v) => s + v * v, 0)));
      const diff = nextComm.reduce((mx, v, i) => Math.max(mx, Math.abs(v - comm[i])), 0);
      comm = nextComm;
      if (diff < 1e-4) break;
    }
  } else {
    for (let i = 0; i < p; i++) {
      for (let f = 0; f < m; f++) {
        loadings[i][f] = eig.vectors[i][f] * Math.sqrt(Math.max(0, evals[f]));
      }
    }
  }

  const doVarimax = (opts.rotation ?? 'varimax') === 'varimax' && m > 1;
  const finalLoadings = doVarimax ? varimaxRotate(loadings, 1, 100) : loadings.map((r) => [...r]);

  // Canonical sign: orient each factor column so max-abs loading is positive
  for (let f = 0; f < m; f++) {
    let sumCol = 0;
    for (let i = 0; i < p; i++) sumCol += finalLoadings[i][f];
    if (sumCol < 0) {
      for (let i = 0; i < p; i++) finalLoadings[i][f] = -finalLoadings[i][f];
    }
  }

  const totalVarExplained = evals.slice(0, m).reduce((a, b) => a + Math.max(0, b), 0) / p;
  let cumPct = 0;
  const eigenRows = evals.map((ev, idx) => {
    const pct = (Math.max(0, ev) / p) * 100;
    cumPct += pct;
    return {
      component: `Faktör ${idx + 1}`,
      eigenvalue: rNum(ev, 5),
      varPct: rNum(pct, 3),
      cumPct: rNum(cumPct, 4),
    };
  });

  const loadingCols = [
    { key: 'item', label: 'Madde' },
    ...Array.from({ length: m }, (_, f) => ({ key: `f${f + 1}`, label: `Faktör ${f + 1}`, numeric: true })),
    { key: 'communality', label: 'Ortak Var. (h²)', numeric: true },
    { key: 'msa', label: 'MSA', numeric: true },
  ];

  const loadingRows = items.map((item, i) => {
    const row: Record<string, string | number | null> = { item };
    let h2 = 0;
    for (let f = 0; f < m; f++) {
      const val = finalLoadings[i][f];
      h2 += val * val;
      row[`f${f + 1}`] = rNum(val, 4);
    }
    row.communality = rNum(h2, 4);
    row.msa = rNum(itemMsa[i], 3);
    return row;
  });

  const out = buildOutput(
    'efa',
    `Açımlayıcı Faktör Analizi (${p} Madde, ${m} Faktör)`,
    { items, nFactors: m, rotation: doVarimax ? 'varimax' : 'none', extraction: opts.extraction ?? 'pca' },
    {
      n,
      p,
      nFactors: m,
      kmo: rNum(kmo, 6),
      bartlettChi2: rNum(bartChi2, 4),
      bartlettDf: bartDf,
      bartlettP: rNum(bartP, 8),
      eigenvaluesTop: evals.slice(0, m).map((e) => rNum(e, 5)),
      cumVariancePct: rNum(totalVarExplained * 100, 4),
      rotatedLoadings: finalLoadings.map((r) => r.map((v) => rNum(v, 4))),
    },
    [
      {
        id: 'kmo_bartlett',
        title: 'KMO ve Bartlett Küresellik Testi',
        columns: [
          { key: 'measure', label: 'Ölçüt' },
          { key: 'value', label: 'Değer', numeric: true },
        ],
        rows: [
          { measure: 'Kaiser-Meyer-Olkin (KMO) Örneklem Yeterliliği', value: rNum(kmo, 5) },
          { measure: 'Bartlett Küresellik Yaklaşık Ki-Kare', value: rNum(bartChi2, 3) },
          { measure: 'Serbestlik Derecesi (sd)', value: bartDf },
          { measure: 'Anlamlılık (p)', value: rNum(bartP, 6) },
        ],
      },
      {
        id: 'eigenvalues',
        title: 'Toplam Açıklanan Varyans & Özdeğerler',
        columns: [
          { key: 'component', label: 'Bileşen' },
          { key: 'eigenvalue', label: 'Özdeğer', numeric: true },
          { key: 'varPct', label: 'Varyans %', numeric: true },
          { key: 'cumPct', label: 'Birikimli %', numeric: true },
        ],
        rows: eigenRows,
      },
      {
        id: 'loadings',
        title: doVarimax ? 'Döndürülmüş Faktör Matrisi (Varimax)' : 'Döndürülmemiş Faktör Matrisi',
        columns: loadingCols,
        rows: loadingRows,
      },
    ],
    [
      {
        id: 'scree_plot',
        title: 'Yamaç Birikinti Grafiği (Scree Plot)',
        type: 'line',
        option: {
          tooltip: { trigger: 'axis' },
          xAxis: { type: 'category', data: evals.map((_, i) => `F${i + 1}`) },
          yAxis: { type: 'value', name: 'Özdeğer' },
          series: [{ name: 'Özdeğer', type: 'line', data: evals.map((v) => rNum(v, 3)), smooth: false }],
        },
      },
    ],
    `KMO örneklem yeterlilik katsayısı ${fmtNum(kmo, 3)} ve Bartlett testi anlamlıdır (χ²(${bartDf}) = ${fmtNum(bartChi2, 2)}, p < .001). Özdeğeri 1'den büyük ${m} faktör toplam varyansın %${fmtNum(totalVarExplained * 100, 2)}'ini açıklamaktadır.`,
    `KMO = ${fmtNum(kmo, 3)} and Bartlett's test was significant (χ²(${bartDf}) = ${fmtNum(bartChi2, 2)}, p < .001), extracting ${m} factors explaining ${fmtNum(totalVarExplained * 100, 2)}% of total variance.`,
  );

  out.assumptions = [
    {
      name: 'KMO Örneklem Yeterliliği',
      passed: kmo >= 0.6,
      statisticLabel: `KMO = ${fmtNum(kmo, 3)}`,
      detail: kmo >= 0.8 ? 'Mükemmel faktörleşebilirlik.' : kmo >= 0.6 ? 'Kabul edilebilir yeterlilik.' : 'KMO < 0.60; madde havuzu gözden geçirilmeli.',
    },
    {
      name: 'Bartlett Küresellik Testi',
      passed: bartP < 0.05,
      statisticLabel: `χ²(${bartDf}) = ${fmtNum(bartChi2, 1)}`,
      pValue: rNum(bartP, 5),
      detail: bartP < 0.05 ? 'Korelasyon matrisi birim matristen anlamlı biçimde farklı.' : 'Korelasyonlar faktörleşmek için zayıf.',
    },
  ];
  return out;
}

export function runRasch(dataset: Dataset, items: string[]): AnalysisOutput {
  if (items.length < 3) {
    throw new StatInputError('TOO_FEW_ITEMS', 'Rasch analizi için en az 3 madde gereklidir.', 'Rasch analysis requires at least 3 items.');
  }
  assertUniqueItems(items, 'Rasch analizi', 'Rasch analysis');
  const rawMat = extractNumMatrix(dataset.rows, items);
  const N = rawMat.length;
  const K = items.length;
  assertMinN(N, 10, 'Rasch kalibrasyonu (tam yanıt)', 'Rasch calibration (complete responses)');
  if (isConstant(rawMat.flat())) {
    throw new StatInputError('ZERO_VARIANCE', 'Rasch analizi: tüm yanıtlar aynı; kalibrasyon yapılamaz.', 'Rasch analysis: all responses are identical; calibration is impossible.');
  }

  const allFlat = rawMat.flat();
  const minCat = Math.round(Math.min(...allFlat));
  const maxCat = Math.round(Math.max(...allFlat));
  const mat = rawMat.map((r) => r.map((v) => Math.max(0, Math.round(v) - minCat)));
  const M = Math.max(1, maxCat - minCat);

  const itemTotals = Array.from({ length: K }, (_, i) => mat.reduce((s, r) => s + r[i], 0));
  const personTotals = mat.map((r) => r.reduce((s, v) => s + v, 0));

  // Initial logit estimates
  const delta = itemTotals.map((t) => {
    const p = Math.min(0.98, Math.max(0.02, t / (N * M)));
    return Math.log((1 - p) / p);
  });
  const meanD0 = mean(delta);
  for (let i = 0; i < K; i++) delta[i] -= meanD0;

  const theta = personTotals.map((t) => {
    const p = Math.min(0.98, Math.max(0.02, t / (K * M)));
    return Math.log(p / (1 - p));
  });

  const tau = M > 1 ? Array.from({ length: M }, (_, k) => -1 + (2 * k) / Math.max(1, M - 1)) : [0];

  const rsmProbs = (th: number, d: number): { probs: number[]; exp: number; varScore: number } => {
    if (M === 1) {
      const p1 = 1 / (1 + Math.exp(-(th - d)));
      return { probs: [1 - p1, p1], exp: p1, varScore: p1 * (1 - p1) };
    }
    const logW = [0];
    let cumTau = 0;
    for (let k = 1; k <= M; k++) {
      cumTau += tau[k - 1] ?? 0;
      logW.push(k * (th - d) - cumTau);
    }
    const maxW = Math.max(...logW);
    const exps = logW.map((lw) => Math.exp(lw - maxW));
    const zSum = exps.reduce((a, b) => a + b, 0);
    const probs = exps.map((e) => e / zSum);
    let exp = 0;
    for (let k = 0; k <= M; k++) exp += k * probs[k];
    let varScore = 0;
    for (let k = 0; k <= M; k++) varScore += (k - exp) * (k - exp) * probs[k];
    return { probs, exp, varScore };
  };

  // JMLE Newton-Raphson iterations
  for (let iter = 0; iter < 30; iter++) {
    for (let n = 0; n < N; n++) {
      if (personTotals[n] === 0 || personTotals[n] === K * M) continue;
      let scoreSum = 0;
      let infoSum = 0;
      for (let i = 0; i < K; i++) {
        const res = rsmProbs(theta[n], delta[i]);
        scoreSum += mat[n][i] - res.exp;
        infoSum += res.varScore;
      }
      if (infoSum > 1e-6) theta[n] += Math.max(-1, Math.min(1, scoreSum / infoSum));
    }

    for (let i = 0; i < K; i++) {
      let scoreSum = 0;
      let infoSum = 0;
      for (let n = 0; n < N; n++) {
        const res = rsmProbs(theta[n], delta[i]);
        scoreSum += -(mat[n][i] - res.exp);
        infoSum += res.varScore;
      }
      if (infoSum > 1e-6) delta[i] += Math.max(-1, Math.min(1, scoreSum / infoSum));
    }
    const md = mean(delta);
    for (let i = 0; i < K; i++) delta[i] -= md;
  }

  // Fit statistics (Infit & Outfit MNSQ / ZSTD)
  const itemRows: Record<string, string | number | null>[] = [];
  const itemSEs: number[] = [];
  for (let i = 0; i < K; i++) {
    let infoSum = 0;
    let infitNum = 0;
    let outfitSum = 0;
    let kurtSum = 0;
    for (let n = 0; n < N; n++) {
      const res = rsmProbs(theta[n], delta[i]);
      const diff = mat[n][i] - res.exp;
      const v = Math.max(1e-6, res.varScore);
      const z2 = (diff * diff) / v;
      infitNum += diff * diff;
      infoSum += v;
      outfitSum += z2;
      let c4 = 0;
      for (let cat = 0; cat <= M; cat++) c4 += Math.pow(cat - res.exp, 4) * res.probs[cat];
      kurtSum += c4 / (v * v) - 1;
    }
    const infitMnsq = infoSum > 0 ? infitNum / infoSum : 1;
    const outfitMnsq = outfitSum / N;
    const se = infoSum > 0 ? 1 / Math.sqrt(infoSum) : 0.5;
    itemSEs.push(se);
    const outfitSd = Math.sqrt(Math.max(1e-6, kurtSum / (N * N) + 2 / N));
    const infitZstd = (Math.cbrt(infitMnsq) - 1) * (3 / Math.max(0.05, outfitSd)) + Math.max(0.05, outfitSd) / 3;
    const outfitZstd = (Math.cbrt(outfitMnsq) - 1) * (3 / Math.max(0.05, outfitSd)) + Math.max(0.05, outfitSd) / 3;

    itemRows.push({
      item: items[i],
      measure: rNum(delta[i], 3),
      se: rNum(se, 3),
      infitMnsq: rNum(infitMnsq, 3),
      infitZstd: rNum(infitZstd, 2),
      outfitMnsq: rNum(outfitMnsq, 3),
      outfitZstd: rNum(outfitZstd, 2),
      flag: infitMnsq < 0.5 || infitMnsq > 1.5 ? 'Uyumsuz (MNSQ)' : 'Uygun',
    });
  }

  const varD = variance(delta, 1);
  const mseItem = mean(itemSEs.map((s) => s * s));
  const itemRel = varD > mseItem ? (varD - mseItem) / varD : 0;
  const itemSep = itemRel < 1 && itemRel > 0 ? Math.sqrt(itemRel / (1 - itemRel)) : 0;

  const varT = variance(theta, 1);
  const personSEs = theta.map((th) => {
    let info = 0;
    for (let i = 0; i < K; i++) info += rsmProbs(th, delta[i]).varScore;
    return info > 0 ? 1 / Math.sqrt(info) : 0.8;
  });
  const msePerson = mean(personSEs.map((s) => s * s));
  const personRel = varT > msePerson ? (varT - msePerson) / varT : 0;
  const personSep = personRel < 1 && personRel > 0 ? Math.sqrt(personRel / (1 - personRel)) : 0;

  return buildOutput(
    'rasch',
    `Rasch Madde Tepki Kuramı (${M === 1 ? 'İkili Model' : 'Derecelendirme Ölçeği'})`,
    { items, model: M === 1 ? 'dichotomous' : 'rating_scale' },
    {
      nPersons: N,
      nItems: K,
      categories: M + 1,
      itemReliability: rNum(itemRel, 3),
      itemSeparation: rNum(itemSep, 2),
      personReliability: rNum(personRel, 3),
      personSeparation: rNum(personSep, 2),
      difficulties: delta.map((d) => rNum(d, 3)),
    },
    [
      {
        id: 'rasch_summary',
        title: 'Rasch Model Özeti (Ayırma & Güvenirlik)',
        columns: [
          { key: 'metric', label: 'İndeks' },
          { key: 'value', label: 'Değer', numeric: true },
        ],
        rows: [
          { metric: 'Madde Güvenirliği (Item Reliability)', value: rNum(itemRel, 3) },
          { metric: 'Madde Ayırma İndeksi (Item Separation)', value: rNum(itemSep, 2) },
          { metric: 'Kişi Güvenirliği (Person Reliability)', value: rNum(personRel, 3) },
          { metric: 'Kişi Ayırma İndeksi (Person Separation)', value: rNum(personSep, 2) },
        ],
      },
      {
        id: 'rasch_items',
        title: 'Madde Güçlükleri & Uyum İstatistikleri (JMLE)',
        columns: [
          { key: 'item', label: 'Madde' },
          { key: 'measure', label: 'Güçlük (Logit)', numeric: true },
          { key: 'se', label: 'SH', numeric: true },
          { key: 'infitMnsq', label: 'Infit MNSQ', numeric: true },
          { key: 'infitZstd', label: 'Infit ZSTD', numeric: true },
          { key: 'outfitMnsq', label: 'Outfit MNSQ', numeric: true },
          { key: 'outfitZstd', label: 'Outfit ZSTD', numeric: true },
          { key: 'flag', label: 'Değerlendirme' },
        ],
        rows: itemRows,
      },
    ],
    [
      {
        id: 'wright_map',
        title: 'Madde Güçlüğü Wright Haritası (Logit)',
        type: 'bar',
        option: {
          tooltip: { trigger: 'axis' },
          xAxis: { type: 'value', name: 'Logit' },
          yAxis: { type: 'category', data: items },
          series: [{ name: 'Madde Güçlüğü (δ)', type: 'bar', data: delta.map((d) => rNum(d, 3)) }],
        },
      },
    ],
    `Rasch analizi sonucunda Kişi Güvenirliği = ${fmtNum(personRel, 2)} (Ayırma = ${fmtNum(personSep, 2)}), Madde Güvenirliği = ${fmtNum(itemRel, 2)} (Ayırma = ${fmtNum(itemSep, 2)}) elde edilmiştir.`,
    `Rasch JMLE calibration yielded Person Reliability = ${fmtNum(personRel, 2)} (Separation = ${fmtNum(personSep, 2)}) and Item Reliability = ${fmtNum(itemRel, 2)} (Separation = ${fmtNum(itemSep, 2)}).`,
  );
}

export interface SemFactorSpec {
  name: string;
  indicators: string[];
}

export interface SemPathSpec {
  from: string;
  to: string;
}

export interface SemModelSpec {
  factors: SemFactorSpec[];
  paths?: SemPathSpec[];
}

export function runCbSem(dataset: Dataset, spec: SemModelSpec): AnalysisOutput {
  const factors = spec.factors.filter((f) => f.indicators.length >= 2);
  if (factors.length < 1) {
    throw new StatInputError('TOO_FEW_ITEMS', 'CB-SEM için en az 1 örtük faktör ve >= 2 gösterge gereklidir.', 'CB-SEM requires at least 1 latent factor with >= 2 indicators.');
  }
  const indicators = Array.from(new Set(factors.flatMap((f) => f.indicators)));
  const p = indicators.length;
  const m = factors.length;
  const indIndex = new Map(indicators.map((name, i) => [name, i]));
  const facIndex = new Map(factors.map((f, i) => [f.name, i]));

  const mat = extractNumMatrix(dataset.rows, indicators);
  const N = mat.length;
  if (N < p + 5) {
    throw new StatInputError(
      N === 0 ? 'EMPTY_DATA' : 'INSUFFICIENT_N',
      `CB-SEM kestirimi için örneklem sayısı yetersiz (tam vaka: ${N}, gereken en az: ${p + 5}).`,
      `Insufficient sample size for CB-SEM estimation (complete cases: ${N}, required at least: ${p + 5}).`,
    );
  }
  assertNoConstantItems(mat, indicators, 'CB-SEM', 'CB-SEM');

  // Fit on standardized sample covariance (correlation matrix S) for numerical stability
  const S = corrMatrix(mat);
  const { logDet: logDetS } = detAndLogDet(S);

  // Parameter vector layout:
  // [loadings (per factor-indicator), error variances (p), factor correlations (m*(m-1)/2) or paths]
  const loadingPairs: { fIdx: number; iIdx: number; label: string }[] = [];
  for (let f = 0; f < m; f++) {
    for (const ind of factors[f].indicators) {
      loadingPairs.push({ fIdx: f, iIdx: indIndex.get(ind)!, label: `${factors[f].name} -> ${ind}` });
    }
  }
  const paths = (spec.paths || []).filter((pt) => facIndex.has(pt.from) && facIndex.has(pt.to) && pt.from !== pt.to);
  const covPairs: { f1: number; f2: number }[] = [];
  for (let a = 0; a < m; a++) {
    for (let b = a + 1; b < m; b++) {
      // Allow covariance if no direct path between them
      const hasDirect = paths.some(
        (pt) => (pt.from === factors[a].name && pt.to === factors[b].name) || (pt.from === factors[b].name && pt.to === factors[a].name),
      );
      if (!hasDirect) covPairs.push({ f1: a, f2: b });
    }
  }

  const nLoad = loadingPairs.length;
  const nErr = p;
  const nPath = paths.length;
  const nCov = covPairs.length;
  const nParams = nLoad + nErr + nPath + nCov;

  // Initial parameter guess
  const theta0: number[] = [];
  for (let i = 0; i < nLoad; i++) theta0.push(0.75);
  for (let i = 0; i < nErr; i++) theta0.push(0.42);
  for (let i = 0; i < nPath; i++) theta0.push(0.35);
  for (let i = 0; i < nCov; i++) theta0.push(0.3);

  const buildSigma = (th: number[]): number[][] | null => {
    const Lambda = Array.from({ length: p }, () => new Array<number>(m).fill(0));
    for (let i = 0; i < nLoad; i++) {
      const lp = loadingPairs[i];
      Lambda[lp.iIdx][lp.fIdx] = th[i];
    }
    const ThetaErr = Array.from({ length: p }, () => new Array<number>(p).fill(0));
    for (let i = 0; i < p; i++) {
      const ev = th[nLoad + i];
      if (ev <= 0.01) return null;
      ThetaErr[i][i] = ev;
    }

    const B = Array.from({ length: m }, () => new Array<number>(m).fill(0));
    for (let i = 0; i < nPath; i++) {
      const fFrom = facIndex.get(paths[i].from)!;
      const fTo = facIndex.get(paths[i].to)!;
      const coef = th[nLoad + nErr + i];
      if (Math.abs(coef) > 0.99) return null;
      B[fTo][fFrom] = coef;
    }

    const Psi: number[][] = Array.from({ length: m }, (_, i) => Array.from({ length: m }, (_, j) => (i === j ? 1 : 0)));
    for (let i = 0; i < nCov; i++) {
      const rVal = Math.tanh(th[nLoad + nErr + nPath + i]);
      Psi[covPairs[i].f1][covPairs[i].f2] = rVal;
      Psi[covPairs[i].f2][covPairs[i].f1] = rVal;
    }
    // Enforce positive endogenous residual variance if incoming paths
    const IminusB = Array.from({ length: m }, (_, i) => Array.from({ length: m }, (_, j) => (i === j ? 1 : 0) - B[i][j]));
    const IminusBInv = invMatrix(IminusB);
    if (!IminusBInv) return null;
    const PhiLatent = matMul(matMul(IminusBInv, Psi), transpose(IminusBInv));
    const Sigma = matMul(matMul(Lambda, PhiLatent), transpose(Lambda));
    for (let i = 0; i < p; i++) Sigma[i][i] += ThetaErr[i][i];
    return Sigma;
  };

  const fmlObjective = (th: number[]): number => {
    const Sigma = buildSigma(th);
    if (!Sigma) return 1e6;
    const { logDet, pd } = detAndLogDet(Sigma);
    if (!pd) return 1e6;
    const SigInv = invMatrix(Sigma);
    if (!SigInv) return 1e6;
    let traceTerm = 0;
    for (let i = 0; i < p; i++) {
      for (let j = 0; j < p; j++) traceTerm += S[i][j] * SigInv[j][i];
    }
    const fml = logDet + traceTerm - logDetS - p;
    return Number.isFinite(fml) && fml >= 0 ? fml : 1e6;
  };

  const opt = nelderMead(fmlObjective, theta0, Math.min(1800, 350 + nParams * 45), 1e-7);
  const fMin = Math.max(0, opt.fx);
  const SigmaHat = buildSigma(opt.x) || S;

  // Finite-difference SEs
  const h = 1e-4;
  const ses = new Array<number>(nParams).fill(0.08);
  for (let i = 0; i < nParams; i++) {
    const xp = [...opt.x];
    const xm = [...opt.x];
    xp[i] += h;
    xm[i] -= h;
    const fp = fmlObjective(xp);
    const fm = fmlObjective(xm);
    const d2 = (fp - 2 * fMin + fm) / (h * h);
    const info = Math.max(1e-3, 0.5 * (N - 1) * d2);
    ses[i] = 1 / Math.sqrt(info);
  }

  const chi2 = (N - 1) * fMin;
  const df = Math.max(1, (p * (p + 1)) / 2 - nParams);
  const pChi2 = clampP(1 - chi2Cdf(chi2, df));

  // Null model (S diagonal = I) -> fmlNull = -logDetS
  const chi2Null = Math.max(chi2 + 1, (N - 1) * Math.max(0, -logDetS));
  const dfNull = Math.max(1, (p * (p - 1)) / 2);
  const cfi = Math.min(1, Math.max(0, 1 - Math.max(0, chi2 - df) / Math.max(1e-6, chi2Null - dfNull)));
  const tliNum = chi2Null / dfNull - chi2 / df;
  const tliDen = chi2Null / dfNull - 1;
  const tli = tliDen > 0 ? Math.min(1, Math.max(0, tliNum / tliDen)) : 1;
  const nfi = Math.min(1, Math.max(0, (chi2Null - chi2) / chi2Null));
  const rmsea = Math.sqrt(Math.max(0, (chi2 - df) / (df * (N - 1))));

  let srSum = 0;
  let srCnt = 0;
  for (let i = 0; i < p; i++) {
    for (let j = 0; j <= i; j++) {
      const denom = Math.sqrt(Math.max(1e-6, S[i][i] * S[j][j]));
      const diff = (S[i][j] - SigmaHat[i][j]) / denom;
      srSum += diff * diff;
      srCnt++;
    }
  }
  const srmr = Math.sqrt(srSum / srCnt);
  const gfi = Math.max(0, Math.min(1, 1 - fMin / (p / 2)));

  const paramRows: Record<string, string | number | null>[] = [];
  for (let i = 0; i < nLoad; i++) {
    const est = opt.x[i];
    const se = ses[i];
    const z = est / se;
    const pv = clampP(2 * (1 - normalCdf(Math.abs(z))));
    paramRows.push({
      type: 'Faktör Yükü (λ)',
      relation: loadingPairs[i].label,
      est: rNum(est, 4),
      se: rNum(se, 4),
      z: rNum(z, 3),
      p: rNum(pv, 5),
      sig: sigStars(pv),
    });
  }
  for (let i = 0; i < nPath; i++) {
    const idx = nLoad + nErr + i;
    const est = opt.x[idx];
    const se = ses[idx];
    const z = est / se;
    const pv = clampP(2 * (1 - normalCdf(Math.abs(z))));
    paramRows.push({
      type: 'Yapısal Yol (β)',
      relation: `${paths[i].from} -> ${paths[i].to}`,
      est: rNum(est, 4),
      se: rNum(se, 4),
      z: rNum(z, 3),
      p: rNum(pv, 5),
      sig: sigStars(pv),
    });
  }
  for (let i = 0; i < nCov; i++) {
    const idx = nLoad + nErr + nPath + i;
    const est = Math.tanh(opt.x[idx]);
    const se = ses[idx] * (1 - est * est);
    const z = se > 0 ? est / se : 0;
    const pv = clampP(2 * (1 - normalCdf(Math.abs(z))));
    paramRows.push({
      type: 'Faktör Kovaryansı (φ)',
      relation: `${factors[covPairs[i].f1].name} <-> ${factors[covPairs[i].f2].name}`,
      est: rNum(est, 4),
      se: rNum(se, 4),
      z: rNum(z, 3),
      p: rNum(pv, 5),
      sig: sigStars(pv),
    });
  }

  return buildOutput(
    'cb_sem',
    'CB-SEM / Doğrulayıcı Faktör Analizi (ML)',
    { factors, paths },
    {
      n: N,
      chi2: rNum(chi2, 3),
      df,
      chi2Df: rNum(chi2 / df, 3),
      p: rNum(pChi2, 5),
      cfi: rNum(cfi, 4),
      tli: rNum(tli, 4),
      nfi: rNum(nfi, 4),
      gfi: rNum(gfi, 4),
      rmsea: rNum(rmsea, 4),
      srmr: rNum(srmr, 4),
      fml: rNum(fMin, 5),
    },
    [
      {
        id: 'cbsem_fit',
        title: 'Model Uyum İndeksleri (Goodness-of-Fit)',
        columns: [
          { key: 'index', label: 'Uyum İndeksi' },
          { key: 'value', label: 'Değer', numeric: true },
          { key: 'threshold', label: 'Kabul Kriteri (Hu & Bentler)' },
          { key: 'status', label: 'Durum' },
        ],
        rows: [
          { index: 'χ² / sd', value: rNum(chi2 / df, 3), threshold: '≤ 3.00 (Mükemmel ≤ 2.0)', status: chi2 / df <= 3 ? 'İyi Uyum' : 'Sınır Üstü' },
          { index: 'CFI', value: rNum(cfi, 3), threshold: '≥ 0.95 (Kabul ≥ 0.90)', status: cfi >= 0.9 ? 'Uygun' : 'Düşük' },
          { index: 'TLI (NNFI)', value: rNum(tli, 3), threshold: '≥ 0.95 (Kabul ≥ 0.90)', status: tli >= 0.9 ? 'Uygun' : 'Düşük' },
          { index: 'NFI', value: rNum(nfi, 3), threshold: '≥ 0.90', status: nfi >= 0.9 ? 'Uygun' : 'Düşük' },
          { index: 'RMSEA', value: rNum(rmsea, 4), threshold: '≤ 0.06 (Kabul ≤ 0.08)', status: rmsea <= 0.08 ? 'Uygun' : 'Yüksek' },
          { index: 'SRMR', value: rNum(srmr, 4), threshold: '≤ 0.08', status: srmr <= 0.08 ? 'Uygun' : 'Yüksek' },
        ],
      },
      {
        id: 'cbsem_params',
        title: 'Standardize Parametre Kestirimleri (ML)',
        columns: [
          { key: 'type', label: 'Tip' },
          { key: 'relation', label: 'İlişki' },
          { key: 'est', label: 'Kestirim (Std.)', numeric: true },
          { key: 'se', label: 'SH', numeric: true },
          { key: 'z', label: 'z', numeric: true },
          { key: 'p', label: 'p', numeric: true },
          { key: 'sig', label: 'Düzey' },
        ],
        rows: paramRows,
      },
    ],
    [],
    `CB-SEM / DFA uyum indeksleri χ²(${df}) = ${fmtNum(chi2, 2)}, χ²/sd = ${fmtNum(chi2 / df, 2)}, CFI = ${fmtNum(cfi, 3)}, TLI = ${fmtNum(tli, 3)}, RMSEA = ${fmtNum(rmsea, 3)}, SRMR = ${fmtNum(srmr, 3)} olarak hesaplanmıştır.`,
    `CB-SEM / CFA yielded χ²(${df}) = ${fmtNum(chi2, 2)}, χ²/df = ${fmtNum(chi2 / df, 2)}, CFI = ${fmtNum(cfi, 3)}, TLI = ${fmtNum(tli, 3)}, RMSEA = ${fmtNum(rmsea, 3)}, SRMR = ${fmtNum(srmr, 3)}.`,
  );
}

function fitPlsCore(mat: number[][], factors: SemFactorSpec[], indIndex: Map<string, number>, paths: SemPathSpec[]) {
  const N = mat.length;
  const m = factors.length;
  const facIndex = new Map(factors.map((f, i) => [f.name, i]));

  // Standardize manifest variables Z (N x p)
  const Z = mat[0].map((_, j) => {
    const col = mat.map((r) => r[j]);
    const mu = mean(col);
    const sd = Math.max(1e-9, stdDev(col, 1));
    return col.map((v) => (v - mu) / sd);
  }); // Z[j][n]

  // Outer weights init equal
  let weights: number[][] = factors.map((f) => new Array<number>(f.indicators.length).fill(1 / Math.sqrt(f.indicators.length)));
  let lvScores: number[][] = Array.from({ length: m }, () => new Array<number>(N).fill(0));

  const standardizeVec = (v: number[]): number[] => {
    const mu = mean(v);
    const sd = Math.max(1e-9, stdDev(v, 1));
    return v.map((x) => (x - mu) / sd);
  };

  for (let iter = 0; iter < 50; iter++) {
    // Stage 1: Outer approximation
    lvScores = factors.map((f, fi) => {
      const raw = new Array<number>(N).fill(0);
      for (let k = 0; k < f.indicators.length; k++) {
        const zCol = Z[indIndex.get(f.indicators[k])!];
        const w = weights[fi][k];
        for (let n = 0; n < N; n++) raw[n] += w * zCol[n];
      }
      return standardizeVec(raw);
    });

    // Stage 2: Inner weights (path weighting / centroid sign)
    const innerProxy = factors.map((_, fi) => {
      const acc = new Array<number>(N).fill(0);
      for (let fj = 0; fj < m; fj++) {
        if (fi === fj) continue;
        const connected = paths.some(
          (p) => (p.from === factors[fi].name && p.to === factors[fj].name) || (p.from === factors[fj].name && p.to === factors[fi].name),
        );
        if (connected) {
          const r = pearsonPair(lvScores[fi], lvScores[fj]).r;
          const e = r >= 0 ? 1 : -1;
          for (let n = 0; n < N; n++) acc[n] += e * lvScores[fj][n];
        }
      }
      const norm = acc.reduce((s, v) => s + v * v, 0);
      return norm > 1e-8 ? standardizeVec(acc) : [...lvScores[fi]];
    });

    // Stage 3: Mode A outer weights (regression of each indicator on inner proxy)
    let maxChange = 0;
    weights = factors.map((f, fi) => {
      return f.indicators.map((ind, k) => {
        const zCol = Z[indIndex.get(ind)!];
        const newW = pearsonPair(zCol, innerProxy[fi]).r;
        maxChange = Math.max(maxChange, Math.abs(newW - weights[fi][k]));
        return newW;
      });
    });
    if (maxChange < 1e-5) break;
  }

  // Final LV scores & canonical positive sign
  lvScores = factors.map((f, fi) => {
    const raw = new Array<number>(N).fill(0);
    for (let k = 0; k < f.indicators.length; k++) {
      const zCol = Z[indIndex.get(f.indicators[k])!];
      for (let n = 0; n < N; n++) raw[n] += weights[fi][k] * zCol[n];
    }
    const avgCorr = mean(f.indicators.map((ind) => pearsonPair(Z[indIndex.get(ind)!], raw).r));
    const signed = avgCorr < 0 ? raw.map((v) => -v) : raw;
    return standardizeVec(signed);
  });

  // Outer loadings, CR, AVE
  const loadingsByFactor = factors.map((f, fi) =>
    f.indicators.map((ind) => pearsonPair(Z[indIndex.get(ind)!], lvScores[fi]).r),
  );

  // Inner paths & R2
  const endogMap = new Map<string, string[]>();
  for (const pt of paths) {
    const arr = endogMap.get(pt.to) || [];
    arr.push(pt.from);
    endogMap.set(pt.to, arr);
  }
  const pathBetas: { from: string; to: string; beta: number; r2: number; f2: number }[] = [];
  const r2Map = new Map<string, number>();

  for (const [toName, fromNames] of endogMap.entries()) {
    const y = lvScores[facIndex.get(toName)!];
    const X = Array.from({ length: N }, (_, n) => fromNames.map((fn) => lvScores[facIndex.get(fn)!][n]));
    const fullOls = olsFit(y, X);
    r2Map.set(toName, fullOls.r2);
    for (let j = 0; j < fromNames.length; j++) {
      let r2Excl = 0;
      if (fromNames.length > 1) {
        const Xsub = X.map((row) => row.filter((_, idx) => idx !== j));
        r2Excl = olsFit(y, Xsub).r2;
      }
      const f2 = 1 - fullOls.r2 > 1e-6 ? Math.max(0, (fullOls.r2 - r2Excl) / (1 - fullOls.r2)) : 0;
      pathBetas.push({
        from: fromNames[j],
        to: toName,
        beta: fullOls.beta[j + 1],
        r2: fullOls.r2,
        f2,
      });
    }
  }

  return { lvScores, loadingsByFactor, pathBetas, r2Map, Z };
}

export function runPlsSem(
  dataset: Dataset,
  spec: { factors: SemFactorSpec[]; paths: SemPathSpec[] },
  bootstrapSamples = 200,
): AnalysisOutput {
  const factors = spec.factors.filter((f) => f.indicators.length >= 2);
  if (factors.length < 2) {
    throw new StatInputError('TOO_FEW_ITEMS', 'PLS-SEM için en az 2 göstergeli en az 2 yapı (faktör) gereklidir.', 'PLS-SEM requires at least 2 constructs with at least 2 indicators each.');
  }
  const indicators = Array.from(new Set(factors.flatMap((f) => f.indicators)));
  const indIndex = new Map(indicators.map((n, i) => [n, i]));
  const mat = extractNumMatrix(dataset.rows, indicators);
  const N = mat.length;
  assertMinN(N, 15, 'PLS-SEM (tam vaka)', 'PLS-SEM (complete cases)');
  assertNoConstantItems(mat, indicators, 'PLS-SEM', 'PLS-SEM');

  const core = fitPlsCore(mat, factors, indIndex, spec.paths);

  // Quality table (Cronbach alpha, rho_c, AVE)
  const qualityRows = factors.map((f, fi) => {
    const lds = core.loadingsByFactor[fi];
    const sumL = lds.reduce((a, b) => a + b, 0);
    const sumL2 = lds.reduce((a, b) => a + b * b, 0);
    const sumErr = lds.reduce((a, b) => a + Math.max(0, 1 - b * b), 0);
    const cr = sumL * sumL / (sumL * sumL + sumErr);
    const ave = sumL2 / f.indicators.length;
    const subMat = mat.map((r) => f.indicators.map((ind) => r[indIndex.get(ind)!]));
    const S = covMatrix(subMat, 1);
    const k = f.indicators.length;
    const sumV = S.reduce((s, row, i) => s + row[i], 0);
    const totV = variance(subMat.map((r) => r.reduce((a, b) => a + b, 0)), 1);
    const alpha = k > 1 && totV > 0 ? (k / (k - 1)) * (1 - sumV / totV) : 0;

    return {
      construct: f.name,
      cronbachAlpha: rNum(alpha, 3),
      compositeRel: rNum(cr, 3),
      ave: rNum(ave, 3),
      r2: core.r2Map.has(f.name) ? rNum(core.r2Map.get(f.name)!, 3) : null,
      sqrtAve: rNum(Math.sqrt(ave), 3),
    };
  });

  // HTMT Discriminant Validity Matrix
  const htmtRows: Record<string, string | number | null>[] = [];
  for (let i = 0; i < factors.length; i++) {
    const row: Record<string, string | number | null> = { construct: factors[i].name };
    for (let j = 0; j < factors.length; j++) {
      if (i === j) {
        row[factors[j].name] = 1;
        continue;
      }
      const monoI: number[] = [];
      const monoJ: number[] = [];
      const hetero: number[] = [];
      for (let a = 0; a < factors[i].indicators.length; a++) {
        for (let b = a + 1; b < factors[i].indicators.length; b++) {
          monoI.push(Math.abs(pearsonPair(core.Z[indIndex.get(factors[i].indicators[a])!], core.Z[indIndex.get(factors[i].indicators[b])!]).r));
        }
      }
      for (let a = 0; a < factors[j].indicators.length; a++) {
        for (let b = a + 1; b < factors[j].indicators.length; b++) {
          monoJ.push(Math.abs(pearsonPair(core.Z[indIndex.get(factors[j].indicators[a])!], core.Z[indIndex.get(factors[j].indicators[b])!]).r));
        }
      }
      for (const iA of factors[i].indicators) {
        for (const iB of factors[j].indicators) {
          hetero.push(Math.abs(pearsonPair(core.Z[indIndex.get(iA)!], core.Z[indIndex.get(iB)!]).r));
        }
      }
      const htmt = mean(hetero) / Math.sqrt(Math.max(1e-6, mean(monoI) * mean(monoJ)));
      row[factors[j].name] = rNum(htmt, 3);
    }
    htmtRows.push(row);
  }

  // Deterministic seeded bootstrap (Mulberry32) for reproducibility
  let seed = 421337;
  const rand = () => {
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };

  const bootStore = core.pathBetas.map(() => [] as number[]);
  for (let b = 0; b < bootstrapSamples; b++) {
    const sampleMat = Array.from({ length: N }, () => mat[Math.floor(rand() * N)]);
    const bCore = fitPlsCore(sampleMat, factors, indIndex, spec.paths);
    bCore.pathBetas.forEach((pb, idx) => {
      bootStore[idx]?.push(pb.beta);
    });
  }

  const pathRows = core.pathBetas.map((pb, idx) => {
    const bArr = bootStore[idx];
    const se = bArr.length > 2 ? stdDev(bArr, 1) : 0.05;
    const t = se > 0 ? pb.beta / se : 0;
    const pVal = clampP(2 * (1 - tCdf(Math.abs(t), N - 2)));
    return {
      path: `${pb.from} -> ${pb.to}`,
      beta: rNum(pb.beta, 4),
      se: rNum(se, 4),
      t: rNum(t, 3),
      p: rNum(pVal, 5),
      f2: rNum(pb.f2, 3),
      sig: sigStars(pVal),
    };
  });

  const outerRows = factors.flatMap((f, fi) =>
    f.indicators.map((ind, k) => ({
      construct: f.name,
      indicator: ind,
      loading: rNum(core.loadingsByFactor[fi][k], 4),
    })),
  );

  return buildOutput(
    'pls_sem',
    `PLS-SEM Yol Modeli (${bootstrapSamples} Bootstrap)`,
    { factors, paths: spec.paths, bootstrapSamples },
    {
      n: N,
      constructs: qualityRows,
      paths: pathRows,
      htmt: htmtRows,
    },
    [
      {
        id: 'pls_quality',
        title: 'Ölçüm Modeli Güvenirlik ve Geçerlik (CR & AVE)',
        columns: [
          { key: 'construct', label: 'Yapı' },
          { key: 'cronbachAlpha', label: "Cronbach's α", numeric: true },
          { key: 'compositeRel', label: 'Bileşik Güv. (CR)', numeric: true },
          { key: 'ave', label: 'AVE', numeric: true },
          { key: 'sqrtAve', label: '√AVE', numeric: true },
          { key: 'r2', label: 'R²', numeric: true },
        ],
        rows: qualityRows,
      },
      {
        id: 'pls_outer',
        title: 'Dışsal Yükler (Outer Loadings)',
        columns: [
          { key: 'construct', label: 'Yapı' },
          { key: 'indicator', label: 'Gösterge' },
          { key: 'loading', label: 'Yük (λ)', numeric: true },
        ],
        rows: outerRows,
      },
      {
        id: 'pls_htmt',
        title: 'Ayırt Edici Geçerlik (HTMT Oranları < 0.85)',
        columns: [{ key: 'construct', label: 'Yapı' }, ...factors.map((f) => ({ key: f.name, label: f.name, numeric: true }))],
        rows: htmtRows,
      },
      {
        id: 'pls_paths',
        title: `Yapısal Yol Katsayıları (${bootstrapSamples} Bootstrap)`,
        columns: [
          { key: 'path', label: 'Yol' },
          { key: 'beta', label: 'β', numeric: true },
          { key: 'se', label: 'Boot. SH', numeric: true },
          { key: 't', label: 't', numeric: true },
          { key: 'p', label: 'p', numeric: true },
          { key: 'f2', label: 'f²', numeric: true },
          { key: 'sig', label: 'Düzey' },
        ],
        rows: pathRows,
      },
    ],
    [],
    `PLS-SEM (Mode A, ${bootstrapSamples} bootstrap) analizi sonucunda tüm yapıların AVE ≥ 0.50 ve CR ≥ 0.70 ölçütleri incelenmiş ve yapısal yol katsayıları hesaplanmıştır.`,
    `PLS-SEM (Mode A, ${bootstrapSamples} bootstrap resamples) evaluated construct CR/AVE, HTMT discriminant validity, and structural path coefficients.`,
  );
}

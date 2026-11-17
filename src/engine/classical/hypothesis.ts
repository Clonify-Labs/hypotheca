import { AnalysisOutput, AssumptionBadge, Dataset } from '../../types/interfaces';
import {
  chi2Cdf,
  fCdf,
  normalCdf,
  shapiroWilk,
  tCdf,
  tInv,
  tukeyPval,
} from '../core/distributions';
import {
  covMatrix,
  jacobiEigen,
  matMul,
  mean,
  quantile,
  rankArray,
  stdDev,
  transpose,
  variance,
} from '../core/linalg';
import { StatInputError, assertMinN, assertNonZeroVariance, clampP, isConstant, toFiniteNumber as toNum } from '../core/errors';
import {
  assertAtLeastTwoGroups,
  assertExactlyTwoGroups,
  buildOutput,
  extractNum,
  extractPaired,
  groupNumericBy,
  leveneTest,
  pearsonPair,
  rNum,
  sigStars,
  twoSamplePooledSD,
  fmtNum,
} from './helpers';

/** Assumption-badge detail for a Shapiro-Wilk result that may be not applicable. */
function swDetail(sw: { valid: boolean; reason?: string; p: number }, n: number): { passed: boolean; detail: string } {
  if (!sw.valid) {
    const why =
      sw.reason === 'n_above_5000'
        ? 'n > 5000 olduğundan Shapiro-Wilk uygulanmadı; büyük örneklemde MLT (CLT) geçerlidir.'
        : sw.reason === 'constant'
          ? 'Değerler sabit olduğundan normallik sınanamadı.'
          : 'n < 3 olduğundan Shapiro-Wilk uygulanamadı.';
    return { passed: n > 5000, detail: why };
  }
  if (sw.p >= 0.05) return { passed: true, detail: 'Normal dağılım varsayımı sağlandı.' };
  return {
    passed: n >= 30,
    detail:
      n >= 30
        ? 'Normal dağılımdan sapma gözlendi (p < .05); n >= 30 olduğundan test MLT (CLT) gereği dayanıklıdır.'
        : 'Normal dağılımdan sapma gözlendi (p < .05); küçük örneklemde parametrik olmayan alternatif önerilir.',
  };
}

function hedgesFactor(df: number): number {
  return df > 1 ? 1 - 3 / (4 * df - 1) : 1;
}

function tieSumOfCubes(arr: number[]): number {
  const sorted = [...arr].sort((a, b) => a - b);
  let tieSum = 0;
  let i = 0;
  while (i < sorted.length) {
    let j = i;
    while (j + 1 < sorted.length && sorted[j + 1] === sorted[i]) j++;
    const t = j - i + 1;
    if (t > 1) tieSum += t * t * t - t;
    i = j + 1;
  }
  return tieSum;
}

export function runOneSampleTTest(dataset: Dataset, variable: string, mu = 0): AnalysisOutput {
  const x = extractNum(dataset.rows, variable);
  const n = x.length;
  assertMinN(n, 2, `Tek örneklem t-testi (${variable})`, `One-sample t-test (${variable})`);
  assertNonZeroVariance(x, variable);
  if (!Number.isFinite(mu)) {
    throw new StatInputError('INVALID_PARAMETER', 'Test değeri sonlu bir sayı olmalıdır.', 'Test value must be a finite number.');
  }

  const m = mean(x);
  const sd = stdDev(x, 1);
  const se = sd / Math.sqrt(n);
  const diff = m - mu;
  const t = se > 0 ? diff / se : 0;
  const df = n - 1;
  const p = clampP(2 * (1 - tCdf(Math.abs(t), df)));
  const tCrit = tInv(0.975, df);
  const ciLow = diff - tCrit * se;
  const ciHigh = diff + tCrit * se;
  const cohenD = sd > 0 ? diff / sd : 0;
  const hedgesG = cohenD * hedgesFactor(df);
  const sw = shapiroWilk(x);
  const swInfo = swDetail(sw, n);

  const assumptions: AssumptionBadge[] = [
    {
      name: 'Normallik (Shapiro-Wilk)',
      passed: sw.valid ? sw.p >= 0.05 : swInfo.passed,
      statisticLabel: sw.valid ? `W = ${fmtNum(sw.w, 4)}` : 'W = -',
      pValue: rNum(sw.p, 4),
      detail: swInfo.detail,
    },
  ];

  const out = buildOutput(
    'one_sample_t',
    `Tek Örneklem T-Testi (${variable})`,
    { variable, testValue: mu },
    {
      n,
      mean: rNum(m, 4),
      std: rNum(sd, 4),
      t: rNum(t, 4),
      df,
      p: rNum(p, 6),
      cohenD: rNum(cohenD, 4),
      hedgesG: rNum(hedgesG, 4),
    },
    [
      {
        id: 'one_sample_desc',
        title: 'Tek Örneklem İstatistikleri',
        columns: [
          { key: 'variable', label: 'Değişken' },
          { key: 'n', label: 'N', numeric: true },
          { key: 'mean', label: 'Ortalama', numeric: true },
          { key: 'std', label: 'Std. Sapma', numeric: true },
          { key: 'se', label: 'Ort. SH', numeric: true },
        ],
        rows: [{ variable, n, mean: rNum(m, 3), std: rNum(sd, 3), se: rNum(se, 3) }],
      },
      {
        id: 'one_sample_test',
        title: `Tek Örneklem T-Testi (Test Değeri = ${mu})`,
        columns: [
          { key: 't', label: 't', numeric: true },
          { key: 'df', label: 'sd', numeric: true },
          { key: 'p', label: 'p', numeric: true },
          { key: 'sig', label: 'Düzey' },
          { key: 'diff', label: 'Ort. Fark', numeric: true },
          { key: 'ciLow', label: '%95 GA Alt', numeric: true },
          { key: 'ciHigh', label: '%95 GA Üst', numeric: true },
          { key: 'cohenD', label: "Cohen's d", numeric: true },
          { key: 'hedgesG', label: "Hedges' g", numeric: true },
        ],
        rows: [
          {
            t: rNum(t, 3),
            df,
            p: rNum(p, 4),
            sig: sigStars(p),
            diff: rNum(diff, 3),
            ciLow: rNum(ciLow, 3),
            ciHigh: rNum(ciHigh, 3),
            cohenD: rNum(cohenD, 3),
            hedgesG: rNum(hedgesG, 3),
          },
        ],
      },
    ],
    [],
    `${variable} ortalaması (M = ${fmtNum(m, 2)}, SS = ${fmtNum(sd, 2)}), test değeri ${mu} ile karşılaştırıldığında t(${df}) = ${fmtNum(t, 2)}, p = ${fmtNum(p, 3)}, Cohen's d = ${fmtNum(cohenD, 2)} elde edilmiştir.`,
    `A one-sample t-test comparing ${variable} (M = ${fmtNum(m, 2)}, SD = ${fmtNum(sd, 2)}) against ${mu} yielded t(${df}) = ${fmtNum(t, 2)}, p = ${fmtNum(p, 3)}, Cohen's d = ${fmtNum(cohenD, 2)}.`,
  );
  out.assumptions = assumptions;
  return out;
}

export function runIndependentTTest(
  dataset: Dataset,
  dependent: string,
  groupVar: string,
  groupNames?: [string, string],
): AnalysisOutput {
  const groups = groupNumericBy(dataset.rows, dependent, groupVar);
  if (!groupNames) assertExactlyTwoGroups(Array.from(groups.keys()), groupVar);
  const keys = (groupNames ? groupNames : Array.from(groups.keys())).filter((g) => (groups.get(g)?.length ?? 0) >= 2);
  if (groupNames && groupNames[0] === groupNames[1]) {
    throw new StatInputError('SINGLE_GROUP', 'Karşılaştırılacak iki grup birbirinden farklı olmalıdır.', 'The two groups to compare must be different.');
  }
  assertAtLeastTwoGroups(keys.length, groupVar, 2);
  const g1Name = keys[0];
  const g2Name = keys[1];
  const x1 = groups.get(g1Name) || [];
  const x2 = groups.get(g2Name) || [];
  const n1 = x1.length;
  const n2 = x2.length;
  if (isConstant([...x1, ...x2])) assertNonZeroVariance([...x1, ...x2], dependent);
  if (isConstant(x1) && isConstant(x2)) {
    throw new StatInputError(
      'ZERO_VARIANCE',
      `"${dependent}" her iki grupta da sabit (grup içi varyans sıfır); t istatistiği tanımsızdır.`,
      `"${dependent}" is constant within both groups (zero within-group variance); the t statistic is undefined.`,
    );
  }

  const m1 = mean(x1);
  const m2 = mean(x2);
  const sd1 = stdDev(x1, 1);
  const sd2 = stdDev(x2, 1);
  const v1 = variance(x1, 1);
  const v2 = variance(x2, 1);
  const se1 = sd1 / Math.sqrt(n1);
  const se2 = sd2 / Math.sqrt(n2);
  const diff = m1 - m2;

  const lev = leveneTest([x1, x2], 'mean');
  const sp = twoSamplePooledSD(x1, x2);
  const sePool = sp * Math.sqrt(1 / n1 + 1 / n2);
  const tStud = sePool > 0 ? diff / sePool : 0;
  const dfStud = n1 + n2 - 2;
  const pStud = clampP(2 * (1 - tCdf(Math.abs(tStud), dfStud)));
  const tCritStud = tInv(0.975, dfStud);

  const seWelch = Math.sqrt(v1 / n1 + v2 / n2);
  const tWelch = seWelch > 0 ? diff / seWelch : 0;
  const dfWelchNum = Math.pow(v1 / n1 + v2 / n2, 2);
  const dfWelchDen = Math.pow(v1 / n1, 2) / (n1 - 1) + Math.pow(v2 / n2, 2) / (n2 - 1);
  const dfWelch = dfWelchDen > 0 ? dfWelchNum / dfWelchDen : dfStud;
  const pWelch = clampP(2 * (1 - tCdf(Math.abs(tWelch), dfWelch)));
  const tCritWelch = tInv(0.975, dfWelch);

  const cohenD = sp > 0 ? diff / sp : 0;
  const hedgesG = cohenD * hedgesFactor(dfStud);
  const glassDelta = sd2 > 0 ? diff / sd2 : NaN;

  const sw1 = shapiroWilk(x1);
  const sw2 = shapiroWilk(x2);
  const equalVar = lev.p >= 0.05;

  const s1 = [...x1].sort((a, b) => a - b);
  const s2 = [...x2].sort((a, b) => a - b);

  const out = buildOutput(
    'independent_t',
    `Bağımsız Örneklem T-Testi (${dependent} ~ ${groupVar})`,
    { dependent, groupVar, groups: [g1Name, g2Name] },
    {
      group1: g1Name,
      group2: g2Name,
      n1,
      n2,
      mean1: rNum(m1, 4),
      mean2: rNum(m2, 4),
      leveneF: rNum(lev.f, 4),
      leveneP: rNum(lev.p, 6),
      studentT: rNum(tStud, 6),
      studentDf: dfStud,
      studentP: rNum(pStud, 6),
      welchT: rNum(tWelch, 6),
      welchDf: rNum(dfWelch, 4),
      welchP: rNum(pWelch, 6),
      cohenD: rNum(cohenD, 6),
      hedgesG: rNum(hedgesG, 6),
      glassDelta: rNum(glassDelta, 6),
    },
    [
      {
        id: 'group_stats',
        title: 'Grup İstatistikleri',
        columns: [
          { key: 'group', label: 'Grup' },
          { key: 'n', label: 'N', numeric: true },
          { key: 'mean', label: 'Ortalama', numeric: true },
          { key: 'std', label: 'Std. Sapma', numeric: true },
          { key: 'se', label: 'Ort. SH', numeric: true },
        ],
        rows: [
          { group: g1Name, n: n1, mean: rNum(m1, 3), std: rNum(sd1, 3), se: rNum(se1, 3) },
          { group: g2Name, n: n2, mean: rNum(m2, 3), std: rNum(sd2, 3), se: rNum(se2, 3) },
        ],
      },
      {
        id: 'indep_test',
        title: 'Bağımsız Örneklemler Testi (Student & Welch)',
        columns: [
          { key: 'method', label: 'Varyans Varsayımı' },
          { key: 'leveneF', label: 'Levene F', numeric: true },
          { key: 'leveneP', label: 'Levene p', numeric: true },
          { key: 't', label: 't', numeric: true },
          { key: 'df', label: 'sd', numeric: true },
          { key: 'p', label: 'p (2-yönlü)', numeric: true },
          { key: 'diff', label: 'Ort. Fark', numeric: true },
          { key: 'seDiff', label: 'Fark SH', numeric: true },
          { key: 'ciLow', label: '%95 GA Alt', numeric: true },
          { key: 'ciHigh', label: '%95 GA Üst', numeric: true },
        ],
        rows: [
          {
            method: 'Eşit Varyans Varsayıldı (Student)',
            leveneF: rNum(lev.f, 3),
            leveneP: rNum(lev.p, 4),
            t: rNum(tStud, 3),
            df: dfStud,
            p: rNum(pStud, 4),
            diff: rNum(diff, 3),
            seDiff: rNum(sePool, 3),
            ciLow: rNum(diff - tCritStud * sePool, 3),
            ciHigh: rNum(diff + tCritStud * sePool, 3),
          },
          {
            method: 'Eşit Varyans Varsayılmadı (Welch)',
            leveneF: null,
            leveneP: null,
            t: rNum(tWelch, 3),
            df: rNum(dfWelch, 2),
            p: rNum(pWelch, 4),
            diff: rNum(diff, 3),
            seDiff: rNum(seWelch, 3),
            ciLow: rNum(diff - tCritWelch * seWelch, 3),
            ciHigh: rNum(diff + tCritWelch * seWelch, 3),
          },
        ],
      },
      {
        id: 'effect_sizes',
        title: 'Etki Büyüklüğü İndeksleri',
        columns: [
          { key: 'index', label: 'İndeks' },
          { key: 'value', label: 'Değer', numeric: true },
        ],
        rows: [
          { index: "Cohen's d (Birleştirilmiş SS)", value: rNum(cohenD, 3) },
          { index: "Hedges' g (Düzeltilmiş)", value: rNum(hedgesG, 3) },
          { index: `Glass's Delta (${g2Name} SS)`, value: rNum(glassDelta, 3) },
        ],
      },
    ],
    [
      {
        id: 'indep_box',
        title: `${dependent} Grup Dağılımı (Kutu Grafiği)`,
        type: 'boxplot',
        option: {
          tooltip: { trigger: 'item' },
          xAxis: { type: 'category', data: [g1Name, g2Name] },
          yAxis: { type: 'value', name: dependent },
          series: [
            {
              name: dependent,
              type: 'boxplot',
              data: [
                [rNum(s1[0], 3), rNum(quantile(s1, 0.25), 3), rNum(quantile(s1, 0.5), 3), rNum(quantile(s1, 0.75), 3), rNum(s1[s1.length - 1], 3)],
                [rNum(s2[0], 3), rNum(quantile(s2, 0.25), 3), rNum(quantile(s2, 0.5), 3), rNum(quantile(s2, 0.75), 3), rNum(s2[s2.length - 1], 3)],
              ],
            },
          ],
        },
      },
    ],
    equalVar
      ? `${g1Name} (M = ${fmtNum(m1, 2)}, SS = ${fmtNum(sd1, 2)}) ile ${g2Name} (M = ${fmtNum(m2, 2)}, SS = ${fmtNum(sd2, 2)}) grupları arasında ${dependent} açısından istatistiksel ${pStud < 0.05 ? 'olarak anlamlı bir fark bulunmuştur' : 'anlamlı bir fark bulunmamıştır'}, t(${dfStud}) = ${fmtNum(tStud, 2)}, p = ${fmtNum(pStud, 3)}, d = ${fmtNum(cohenD, 2)}.`
      : `Levene varyans homojenliği ihlal edildiğinden (p = ${fmtNum(lev.p, 3)}) Welch t-testi raporlanmıştır: t(${fmtNum(dfWelch, 2)}) = ${fmtNum(tWelch, 2)}, p = ${fmtNum(pWelch, 3)}, d = ${fmtNum(cohenD, 2)}.`,
    `An independent-samples ${equalVar ? 'Student' : 'Welch'} t-test comparing ${g1Name} (M = ${fmtNum(m1, 2)}, SD = ${fmtNum(sd1, 2)}) and ${g2Name} (M = ${fmtNum(m2, 2)}, SD = ${fmtNum(sd2, 2)}) on ${dependent} showed t(${fmtNum(equalVar ? dfStud : dfWelch, 2)}) = ${fmtNum(equalVar ? tStud : tWelch, 2)}, p = ${fmtNum(equalVar ? pStud : pWelch, 3)}, d = ${fmtNum(cohenD, 2)}.`,
  );

  const swInfo1 = swDetail(sw1, n1);
  const swInfo2 = swDetail(sw2, n2);
  out.assumptions = [
    {
      name: `Normallik (${g1Name})`,
      passed: sw1.valid ? sw1.p >= 0.05 || n1 >= 30 : swInfo1.passed,
      statisticLabel: sw1.valid ? `W = ${fmtNum(sw1.w, 3)}` : 'W = -',
      pValue: rNum(sw1.p, 4),
      detail: swInfo1.detail,
    },
    {
      name: `Normallik (${g2Name})`,
      passed: sw2.valid ? sw2.p >= 0.05 || n2 >= 30 : swInfo2.passed,
      statisticLabel: sw2.valid ? `W = ${fmtNum(sw2.w, 3)}` : 'W = -',
      pValue: rNum(sw2.p, 4),
      detail: swInfo2.detail,
    },
    {
      name: 'Varyans Homojenliği (Levene)',
      passed: lev.p >= 0.05,
      statisticLabel: `F = ${fmtNum(lev.f, 3)}`,
      pValue: rNum(lev.p, 4),
      detail: lev.p >= 0.05 ? 'Varyanslar homojen.' : 'Heterojen varyans; Welch satırı tercih edilmelidir.',
    },
  ];
  return out;
}

export function runPairedTTest(dataset: Dataset, var1: string, var2: string): AnalysisOutput {
  if (!var1 || !var2 || var1 === var2) {
    throw new StatInputError('INVALID_VARIABLES', 'Eşleştirilmiş t-testi için iki farklı değişken seçilmelidir.', 'Paired t-test requires two different variables.');
  }
  const { x, y } = extractPaired(dataset.rows, var1, var2);
  const n = x.length;
  assertMinN(n, 2, 'Eşleştirilmiş t-testi (geçerli çift)', 'Paired t-test (valid pairs)');

  const diffs = x.map((v, i) => v - y[i]);
  if (isConstant(diffs)) {
    throw new StatInputError(
      'ZERO_VARIANCE',
      `"${var1}" ile "${var2}" arasındaki farkların varyansı sıfır (tüm farklar aynı); t istatistiği tanımsızdır.`,
      `Differences between "${var1}" and "${var2}" have zero variance (all identical); the t statistic is undefined.`,
    );
  }
  const m1 = mean(x);
  const m2 = mean(y);
  const sd1 = stdDev(x, 1);
  const sd2 = stdDev(y, 1);
  const mDiff = mean(diffs);
  const sdDiff = stdDev(diffs, 1);
  const seDiff = sdDiff / Math.sqrt(n);
  const t = seDiff > 0 ? mDiff / seDiff : 0;
  const df = n - 1;
  const p = clampP(2 * (1 - tCdf(Math.abs(t), df)));
  const tCrit = tInv(0.975, df);
  const ciLow = mDiff - tCrit * seDiff;
  const ciHigh = mDiff + tCrit * seDiff;

  const pairCorr = pearsonPair(x, y);
  const corrDefined = n >= 3 && !isConstant(x) && !isConstant(y);
  if (!corrDefined) pairCorr.r = NaN;
  const pCorr = corrDefined && Number.isFinite(pairCorr.t) ? clampP(2 * (1 - tCdf(Math.abs(pairCorr.t), df - 1))) : NaN;
  const cohenDz = sdDiff > 0 ? mDiff / sdDiff : 0;
  const swDiff = shapiroWilk(diffs);

  const out = buildOutput(
    'paired_t',
    `Eşleştirilmiş Örneklemler T-Testi (${var1} - ${var2})`,
    { var1, var2 },
    {
      n,
      meanDiff: rNum(mDiff, 6),
      stdDiff: rNum(sdDiff, 6),
      t: rNum(t, 6),
      df,
      p: rNum(p, 8),
      correlation: rNum(pairCorr.r, 6),
      cohenDz: rNum(cohenDz, 6),
      ciLow: rNum(ciLow, 4),
      ciHigh: rNum(ciHigh, 4),
    },
    [
      {
        id: 'paired_stats',
        title: 'Eşleştirilmiş Örneklem İstatistikleri',
        columns: [
          { key: 'variable', label: 'Ölçüm' },
          { key: 'n', label: 'N', numeric: true },
          { key: 'mean', label: 'Ortalama', numeric: true },
          { key: 'std', label: 'Std. Sapma', numeric: true },
          { key: 'se', label: 'Ort. SH', numeric: true },
        ],
        rows: [
          { variable: var1, n, mean: rNum(m1, 3), std: rNum(sd1, 3), se: rNum(sd1 / Math.sqrt(n), 3) },
          { variable: var2, n, mean: rNum(m2, 3), std: rNum(sd2, 3), se: rNum(sd2 / Math.sqrt(n), 3) },
        ],
      },
      {
        id: 'paired_corr',
        title: 'Eşleştirilmiş Örneklem Korelasyonu',
        columns: [
          { key: 'pair', label: 'Çift' },
          { key: 'n', label: 'N', numeric: true },
          { key: 'r', label: 'Korelasyon (r)', numeric: true },
          { key: 'p', label: 'p', numeric: true },
        ],
        rows: [{ pair: `${var1} & ${var2}`, n, r: rNum(pairCorr.r, 4), p: rNum(pCorr, 4) }],
      },
      {
        id: 'paired_test',
        title: 'Eşleştirilmiş Farklar Testi',
        columns: [
          { key: 'pair', label: 'Fark' },
          { key: 'meanDiff', label: 'Ort. Fark', numeric: true },
          { key: 'stdDiff', label: 'Fark SS', numeric: true },
          { key: 'seDiff', label: 'Fark SH', numeric: true },
          { key: 'ciLow', label: '%95 GA Alt', numeric: true },
          { key: 'ciHigh', label: '%95 GA Üst', numeric: true },
          { key: 't', label: 't', numeric: true },
          { key: 'df', label: 'sd', numeric: true },
          { key: 'p', label: 'p', numeric: true },
          { key: 'cohenDz', label: "Cohen's dz", numeric: true },
        ],
        rows: [
          {
            pair: `${var1} - ${var2}`,
            meanDiff: rNum(mDiff, 3),
            stdDiff: rNum(sdDiff, 3),
            seDiff: rNum(seDiff, 3),
            ciLow: rNum(ciLow, 3),
            ciHigh: rNum(ciHigh, 3),
            t: rNum(t, 3),
            df,
            p: rNum(p, 5),
            cohenDz: rNum(cohenDz, 3),
          },
        ],
      },
    ],
    [],
    `${var1} (M = ${fmtNum(m1, 2)}) ile ${var2} (M = ${fmtNum(m2, 2)}) arasındaki değişim t(${df}) = ${fmtNum(t, 2)}, p = ${fmtNum(p, 4)}, Cohen's dz = ${fmtNum(cohenDz, 2)} olarak bulunmuştur.`,
    `A paired-samples t-test between ${var1} (M = ${fmtNum(m1, 2)}) and ${var2} (M = ${fmtNum(m2, 2)}) yielded t(${df}) = ${fmtNum(t, 2)}, p = ${fmtNum(p, 4)}, Cohen's dz = ${fmtNum(cohenDz, 2)}.`,
  );

  out.assumptions = [
    {
      name: 'Fark Skorları Normalliği (Shapiro-Wilk)',
      passed: swDiff.valid ? swDiff.p >= 0.05 || n >= 30 : swDetail(swDiff, n).passed,
      statisticLabel: swDiff.valid ? `W = ${fmtNum(swDiff.w, 3)}` : 'W = -',
      pValue: rNum(swDiff.p, 4),
      detail: swDiff.valid ? 'Fark puanlarının normalliği sınandı.' : swDetail(swDiff, n).detail,
    },
  ];
  return out;
}

export function runOneWayAnova(
  dataset: Dataset,
  dependent: string,
  factor: string,
  posthocMethod: 'tukey' | 'bonferroni' | 'games_howell' = 'tukey',
): AnalysisOutput {
  const gMap = groupNumericBy(dataset.rows, dependent, factor);
  const groups = Array.from(gMap.entries()).filter(([, arr]) => arr.length >= 2);
  const k = groups.length;
  assertAtLeastTwoGroups(k, factor, 2);

  const allVals = groups.flatMap(([, arr]) => arr);
  const N = allVals.length;
  assertNonZeroVariance(allVals, dependent);
  if (groups.every(([, arr]) => isConstant(arr))) {
    throw new StatInputError(
      'ZERO_VARIANCE',
      `"${dependent}" tüm gruplarda sabit (grup içi varyans sıfır); F istatistiği tanımsızdır.`,
      `"${dependent}" is constant within every group (zero within-group variance); the F statistic is undefined.`,
    );
  }
  const grandMean = mean(allVals);

  let ssB = 0;
  let ssW = 0;
  const gStats = groups.map(([name, arr]) => {
    const nj = arr.length;
    const mj = mean(arr);
    const vj = variance(arr, 1);
    const sdj = Math.sqrt(vj);
    const sej = sdj / Math.sqrt(nj);
    const tc = tInv(0.975, nj - 1);
    ssB += nj * Math.pow(mj - grandMean, 2);
    for (const v of arr) ssW += Math.pow(v - mj, 2);
    return { name, arr, n: nj, mean: mj, var: vj, sd: sdj, se: sej, ciLow: mj - tc * sej, ciHigh: mj + tc * sej };
  });

  const ssT = ssB + ssW;
  const dfB = k - 1;
  const dfW = N - k;
  const msB = ssB / dfB;
  const msW = ssW / dfW;
  const fVal = msW > 0 ? msB / msW : 0;
  const pVal = clampP(1 - fCdf(fVal, dfB, dfW));

  const eta2 = ssT > 0 ? ssB / ssT : 0;
  const epsilon2 = ssT > 0 ? (ssB - dfB * msW) / ssT : 0;
  const omega2 = ssT + msW > 0 ? (ssB - dfB * msW) / (ssT + msW) : 0;

  const lev = leveneTest(groups.map(([, a]) => a), 'mean');

  // Welch ANOVA
  const weights = gStats.map((g) => (g.var > 0 ? g.n / g.var : 0));
  const sumW = weights.reduce((a, b) => a + b, 0);
  const welchMean = sumW > 0 ? gStats.reduce((s, g, i) => s + weights[i] * g.mean, 0) / sumW : grandMean;
  const lam = sumW > 0 ? gStats.reduce((s, g, i) => s + Math.pow(1 - weights[i] / sumW, 2) / (g.n - 1), 0) : 0;
  const welchNum = dfB > 0 ? gStats.reduce((s, g, i) => s + weights[i] * Math.pow(g.mean - welchMean, 2), 0) / dfB : 0;
  const welchDen = 1 + (2 * (k - 2) * lam) / (k * k - 1);
  const welchF = welchDen > 0 ? welchNum / welchDen : fVal;
  const welchDf2 = lam > 0 ? (k * k - 1) / (3 * lam) : dfW;
  const welchP = clampP(1 - fCdf(welchF, dfB, welchDf2));

  // Brown-Forsythe F
  const bfDen = gStats.reduce((s, g) => s + (1 - g.n / N) * g.var, 0);
  const bfF = bfDen > 0 ? ssB / bfDen : fVal;
  const bfDf2Den = gStats.reduce((s, g) => s + Math.pow((1 - g.n / N) * g.var, 2) / (g.n - 1), 0);
  const bfDf2 = bfDf2Den > 0 ? (bfDen * bfDen) / bfDf2Den : dfW;
  const bfP = clampP(1 - fCdf(bfF, dfB, bfDf2));

  // Post-hoc pairwise comparisons
  const numPairs = (k * (k - 1)) / 2;
  const posthocRows: Record<string, string | number | boolean | null>[] = [];
  for (let i = 0; i < k; i++) {
    for (let j = i + 1; j < k; j++) {
      const gi = gStats[i];
      const gj = gStats[j];
      const md = gi.mean - gj.mean;
      let seDiff: number;
      let pPost: number;
      let dfPost: number;

      if (posthocMethod === 'games_howell') {
        const vi = gi.var / gi.n;
        const vj = gj.var / gj.n;
        seDiff = Math.sqrt(vi + vj);
        dfPost = Math.pow(vi + vj, 2) / (Math.pow(vi, 2) / (gi.n - 1) + Math.pow(vj, 2) / (gj.n - 1));
        const q = seDiff > 0 ? Math.abs(md) / (seDiff / Math.SQRT2) : 0;
        pPost = Number.isFinite(dfPost) && dfPost > 0 ? tukeyPval(q, k, dfPost) : NaN;
      } else {
        seDiff = Math.sqrt(msW * (1 / gi.n + 1 / gj.n));
        dfPost = dfW;
        if (posthocMethod === 'bonferroni') {
          const tPair = seDiff > 0 ? Math.abs(md) / seDiff : 0;
          pPost = Math.min(1, 2 * (1 - tCdf(tPair, dfW)) * numPairs);
        } else {
          const q = seDiff > 0 ? Math.abs(md) / (seDiff / Math.SQRT2) : 0;
          pPost = tukeyPval(q, k, dfW);
        }
      }

      posthocRows.push({
        comparison: `${gi.name} vs ${gj.name}`,
        diff: rNum(md, 3),
        se: rNum(seDiff, 3),
        p: rNum(pPost, 4),
        sig: sigStars(pPost),
        significant: pPost < 0.05 ? 'Evet' : 'Hayır',
      });
    }
  }

  const out = buildOutput(
    'oneway_anova',
    `Tek Yönlü ANOVA (${dependent} ~ ${factor})`,
    { dependent, factor, posthocMethod },
    {
      k,
      N,
      ssBetween: rNum(ssB, 6),
      dfBetween: dfB,
      msBetween: rNum(msB, 6),
      ssWithin: rNum(ssW, 6),
      dfWithin: dfW,
      msWithin: rNum(msW, 6),
      f: rNum(fVal, 6),
      p: rNum(pVal, 6),
      welchF: rNum(welchF, 6),
      welchDf2: rNum(welchDf2, 4),
      welchP: rNum(welchP, 6),
      leveneF: rNum(lev.f, 4),
      leveneP: rNum(lev.p, 6),
      eta2: rNum(eta2, 6),
      omega2: rNum(omega2, 6),
    },
    [
      {
        id: 'anova_desc',
        title: 'Grup Tanımlayıcıları',
        columns: [
          { key: 'group', label: 'Grup' },
          { key: 'n', label: 'N', numeric: true },
          { key: 'mean', label: 'Ortalama', numeric: true },
          { key: 'std', label: 'Std. Sapma', numeric: true },
          { key: 'se', label: 'SH', numeric: true },
          { key: 'ciLow', label: '%95 GA Alt', numeric: true },
          { key: 'ciHigh', label: '%95 GA Üst', numeric: true },
        ],
        rows: gStats.map((g) => ({
          group: g.name,
          n: g.n,
          mean: rNum(g.mean, 3),
          std: rNum(g.sd, 3),
          se: rNum(g.se, 3),
          ciLow: rNum(g.ciLow, 3),
          ciHigh: rNum(g.ciHigh, 3),
        })),
      },
      {
        id: 'anova_table',
        title: 'ANOVA Tablosu',
        columns: [
          { key: 'source', label: 'Kaynak' },
          { key: 'ss', label: 'Kareler Toplamı', numeric: true },
          { key: 'df', label: 'sd', numeric: true },
          { key: 'ms', label: 'Kareler Ort.', numeric: true },
          { key: 'f', label: 'F', numeric: true },
          { key: 'p', label: 'p', numeric: true },
          { key: 'eta2', label: 'η²', numeric: true },
          { key: 'omega2', label: 'ω²', numeric: true },
        ],
        rows: [
          { source: 'Gruplar Arası', ss: rNum(ssB, 3), df: dfB, ms: rNum(msB, 3), f: rNum(fVal, 3), p: rNum(pVal, 4), eta2: rNum(eta2, 3), omega2: rNum(omega2, 3) },
          { source: 'Grup İçi (Hata)', ss: rNum(ssW, 3), df: dfW, ms: rNum(msW, 3), f: null, p: null, eta2: null, omega2: null },
          { source: 'Toplam', ss: rNum(ssT, 3), df: N - 1, ms: null, f: null, p: null, eta2: rNum(epsilon2, 3), omega2: null },
        ],
      },
      {
        id: 'robust_tests',
        title: 'Varyans Eşitsizliğine Dayanıklı Testler',
        columns: [
          { key: 'test', label: 'Test' },
          { key: 'stat', label: 'İstatistik (F)', numeric: true },
          { key: 'df1', label: 'sd1', numeric: true },
          { key: 'df2', label: 'sd2', numeric: true },
          { key: 'p', label: 'p', numeric: true },
        ],
        rows: [
          { test: 'Levene Homojenlik', stat: rNum(lev.f, 3), df1: lev.df1, df2: lev.df2, p: rNum(lev.p, 4) },
          { test: 'Welch F', stat: rNum(welchF, 3), df1: dfB, df2: rNum(welchDf2, 2), p: rNum(welchP, 4) },
          { test: 'Brown-Forsythe F', stat: rNum(bfF, 3), df1: dfB, df2: rNum(bfDf2, 2), p: rNum(bfP, 4) },
        ],
      },
      {
        id: 'posthoc',
        title: `Post-Hoc İkili Karşılaştırmalar (${posthocMethod.toUpperCase()})`,
        columns: [
          { key: 'comparison', label: 'Karşılaştırma' },
          { key: 'diff', label: 'Ort. Fark', numeric: true },
          { key: 'se', label: 'SH', numeric: true },
          { key: 'p', label: 'p', numeric: true },
          { key: 'sig', label: 'Düzey' },
          { key: 'significant', label: 'Anlamlı?' },
        ],
        rows: posthocRows,
      },
    ],
    [
      {
        id: 'anova_means_plot',
        title: `${dependent} Grup Ortalamaları`,
        type: 'bar',
        option: {
          tooltip: { trigger: 'axis' },
          xAxis: { type: 'category', data: gStats.map((g) => g.name) },
          yAxis: { type: 'value', name: dependent },
          series: [{ name: 'Ortalama', type: 'bar', data: gStats.map((g) => rNum(g.mean, 3)) }],
        },
      },
    ],
    `Tek yönlü ANOVA sonucunda ${factor} grupları arasında ${dependent} ortalamaları açısından F(${dfB}, ${dfW}) = ${fmtNum(fVal, 2)}, p = ${fmtNum(pVal, 3)}, η² = ${fmtNum(eta2, 3)} bulunmuştur.`,
    `One-way ANOVA revealed F(${dfB}, ${dfW}) = ${fmtNum(fVal, 2)}, p = ${fmtNum(pVal, 3)}, η² = ${fmtNum(eta2, 3)} for ${dependent} across ${factor} groups.`,
  );

  out.assumptions = [
    {
      name: 'Varyans Homojenliği (Levene)',
      passed: lev.p >= 0.05,
      statisticLabel: `F = ${fmtNum(lev.f, 3)}`,
      pValue: rNum(lev.p, 4),
      detail: lev.p >= 0.05 ? 'Homojen varyans varsayımı sağlandı.' : 'Levene p < 0.05; Welch F ve Games-Howell önerilir.',
    },
  ];
  return out;
}

export function runRepeatedAnova(dataset: Dataset, variables: string[]): AnalysisOutput {
  if (variables.length < 2) {
    throw new StatInputError('NO_VARIABLES', 'Tekrarlı ölçümler ANOVA için en az 2 ölçüm zamanı seçilmelidir.', 'Repeated-measures ANOVA requires at least 2 measurement occasions.');
  }
  const k = variables.length;
  const mat: number[][] = [];
  if (new Set(variables).size !== variables.length) {
    throw new StatInputError('DUPLICATE_VARIABLES', 'Aynı ölçüm değişkeni birden fazla kez seçilemez.', 'The same measurement variable cannot be selected more than once.');
  }
  for (const row of dataset.rows) {
    const vals = variables.map((v) => toNum(row[v]));
    if (vals.every((v) => v !== null)) {
      mat.push(vals as number[]);
    }
  }
  const n = mat.length;
  assertMinN(n, 3, 'Tekrarlı ölçümler ANOVA (tam vaka)', 'Repeated-measures ANOVA (complete cases)');
  {
    const flat = mat.flat();
    if (isConstant(flat)) assertNonZeroVariance(flat, variables.join(', '));
    const resid = mat.flatMap((r) => {
      const rm = mean(r);
      return r.map((v) => v - rm);
    });
    if (isConstant(resid)) {
      throw new StatInputError(
        'ZERO_VARIANCE',
        'Ölçümler arasında denek içi değişkenlik yok (tüm ölçümler her denekte aynı); F istatistiği tanımsızdır.',
        'There is no within-subject variability (all measurements equal within each subject); the F statistic is undefined.',
      );
    }
  }

  const colMeans = Array.from({ length: k }, (_, j) => mean(mat.map((r) => r[j])));
  const subjMeans = mat.map((r) => mean(r));
  const grandMean = mean(colMeans);

  let ssTotal = 0;
  for (let i = 0; i < n; i++) {
    for (let j = 0; j < k; j++) ssTotal += Math.pow(mat[i][j] - grandMean, 2);
  }
  const ssSubj = k * subjMeans.reduce((s, sm) => s + Math.pow(sm - grandMean, 2), 0);
  const ssCond = n * colMeans.reduce((s, cm) => s + Math.pow(cm - grandMean, 2), 0);
  const ssErr = Math.max(0, ssTotal - ssSubj - ssCond);

  const dfCond = k - 1;
  const dfErr = (n - 1) * (k - 1);
  const msCond = ssCond / dfCond;
  const msErr = dfErr > 0 ? ssErr / dfErr : 0;
  const fVal = msErr > 0 ? msCond / msErr : 0;
  const pVal = clampP(1 - fCdf(fVal, dfCond, dfErr));
  const etaP2 = ssCond + ssErr > 0 ? ssCond / (ssCond + ssErr) : 0;

  // Mauchly's Sphericity & GG / HF Epsilon via orthonormal Helmert contrasts
  let mauchlyW = 1;
  let mauchlyChi2 = 0;
  let mauchlyDf = 0;
  let mauchlyP = 1;
  let ggEps = 1;
  let hfEps = 1;

  if (k >= 3) {
    const C: number[][] = [];
    for (let r = 0; r < k - 1; r++) {
      const cRow = new Array<number>(k).fill(0);
      const valLeft = 1 / Math.sqrt((r + 1) * (r + 2));
      for (let j = 0; j <= r; j++) cRow[j] = valLeft;
      cRow[r + 1] = -(r + 1) * valLeft;
      C.push(cRow);
    }
    const S = covMatrix(mat, 1);
    const CSCt = matMul(matMul(C, S), transpose(C));
    const eig = jacobiEigen(CSCt);
    const pC = k - 1;
    const lambdas = eig.values.map((v) => Math.max(1e-12, v));
    const sumL = lambdas.reduce((a, b) => a + b, 0);
    const sumL2 = lambdas.reduce((a, b) => a + b * b, 0);
    const prodL = lambdas.reduce((a, b) => a * b, 1);
    const meanL = sumL / pC;

    mauchlyW = prodL / Math.pow(meanL, pC);
    const fd = (2 * pC * pC + pC + 2) / (6 * pC * (n - 1));
    mauchlyDf = (pC * (pC + 1)) / 2 - 1;
    mauchlyChi2 = Math.max(0, -(n - 1) * (1 - fd) * Math.log(Math.max(1e-12, mauchlyW)));
    mauchlyP = mauchlyDf > 0 ? clampP(1 - chi2Cdf(mauchlyChi2, mauchlyDf)) : 1;

    ggEps = sumL2 > 0 ? (sumL * sumL) / (pC * sumL2) : 1;
    ggEps = Math.min(1, Math.max(1 / pC, ggEps));
    const hfDen = pC * (n - 1 - pC * ggEps);
    hfEps = hfDen > 0 ? Math.min(1, Math.max(ggEps, (n * pC * ggEps - 2) / hfDen)) : 1;
  }

  const pGG = clampP(1 - fCdf(fVal, dfCond * ggEps, dfErr * ggEps));
  const pHF = clampP(1 - fCdf(fVal, dfCond * hfEps, dfErr * hfEps));

  // Pairwise Bonferroni comparisons
  const numPairs = (k * (k - 1)) / 2;
  const pairRows: Record<string, string | number | null>[] = [];
  for (let i = 0; i < k; i++) {
    for (let j = i + 1; j < k; j++) {
      const diffs = mat.map((r) => r[i] - r[j]);
      const md = mean(diffs);
      const se = stdDev(diffs, 1) / Math.sqrt(n);
      const tP = se > 0 ? md / se : 0;
      const pAdj = Math.min(1, 2 * (1 - tCdf(Math.abs(tP), n - 1)) * numPairs);
      pairRows.push({
        pair: `${variables[i]} vs ${variables[j]}`,
        diff: rNum(md, 3),
        se: rNum(se, 3),
        t: rNum(tP, 3),
        pBonf: rNum(pAdj, 4),
        sig: sigStars(pAdj),
      });
    }
  }

  const out = buildOutput(
    'repeated_anova',
    `Tekrarlı Ölçümler ANOVA (${variables.join(', ')})`,
    { variables },
    {
      n,
      k,
      f: rNum(fVal, 4),
      p: rNum(pVal, 6),
      etaPartial2: rNum(etaP2, 4),
      mauchlyW: rNum(mauchlyW, 4),
      mauchlyP: rNum(mauchlyP, 4),
      ggEpsilon: rNum(ggEps, 4),
      pGG: rNum(pGG, 6),
      hfEpsilon: rNum(hfEps, 4),
      pHF: rNum(pHF, 6),
    },
    [
      {
        id: 'rm_means',
        title: 'Zaman/Koşul Ortalamaları',
        columns: [
          { key: 'time', label: 'Ölçüm' },
          { key: 'n', label: 'N', numeric: true },
          { key: 'mean', label: 'Ortalama', numeric: true },
          { key: 'std', label: 'Std. Sapma', numeric: true },
        ],
        rows: variables.map((v, j) => {
          const colArr = mat.map((r) => r[j]);
          return { time: v, n, mean: rNum(colMeans[j], 3), std: rNum(stdDev(colArr, 1), 3) };
        }),
      },
      {
        id: 'mauchly',
        title: 'Mauchly Küresellik Testi',
        columns: [
          { key: 'w', label: 'Mauchly W', numeric: true },
          { key: 'chi2', label: 'Ki-Kare', numeric: true },
          { key: 'df', label: 'sd', numeric: true },
          { key: 'p', label: 'p', numeric: true },
          { key: 'gg', label: 'Greenhouse-Geisser ε', numeric: true },
          { key: 'hf', label: 'Huynh-Feldt ε', numeric: true },
        ],
        rows: [
          {
            w: rNum(mauchlyW, 4),
            chi2: rNum(mauchlyChi2, 3),
            df: mauchlyDf,
            p: rNum(mauchlyP, 4),
            gg: rNum(ggEps, 4),
            hf: rNum(hfEps, 4),
          },
        ],
      },
      {
        id: 'rm_anova',
        title: 'Grup İçi Etkiler (Within-Subjects)',
        columns: [
          { key: 'correction', label: 'Düzeltme' },
          { key: 'ss', label: 'KT', numeric: true },
          { key: 'dfCond', label: 'sd1', numeric: true },
          { key: 'dfErr', label: 'sd2', numeric: true },
          { key: 'f', label: 'F', numeric: true },
          { key: 'p', label: 'p', numeric: true },
          { key: 'etaP2', label: 'Kısmi η²', numeric: true },
        ],
        rows: [
          { correction: 'Küresellik Varsayıldı', ss: rNum(ssCond, 3), dfCond, dfErr, f: rNum(fVal, 3), p: rNum(pVal, 5), etaP2: rNum(etaP2, 3) },
          { correction: 'Greenhouse-Geisser', ss: rNum(ssCond, 3), dfCond: rNum(dfCond * ggEps, 2), dfErr: rNum(dfErr * ggEps, 2), f: rNum(fVal, 3), p: rNum(pGG, 5), etaP2: rNum(etaP2, 3) },
          { correction: 'Huynh-Feldt', ss: rNum(ssCond, 3), dfCond: rNum(dfCond * hfEps, 2), dfErr: rNum(dfErr * hfEps, 2), f: rNum(fVal, 3), p: rNum(pHF, 5), etaP2: rNum(etaP2, 3) },
        ],
      },
      {
        id: 'rm_posthoc',
        title: 'İkili Karşılaştırmalar (Bonferroni)',
        columns: [
          { key: 'pair', label: 'Çift' },
          { key: 'diff', label: 'Ort. Fark', numeric: true },
          { key: 'se', label: 'SH', numeric: true },
          { key: 't', label: 't', numeric: true },
          { key: 'pBonf', label: 'p (Bonferroni)', numeric: true },
          { key: 'sig', label: 'Düzey' },
        ],
        rows: pairRows,
      },
    ],
    [
      {
        id: 'rm_line',
        title: 'Tekrarlı Ölçüm Profili',
        type: 'line',
        option: {
          tooltip: { trigger: 'axis' },
          xAxis: { type: 'category', data: variables },
          yAxis: { type: 'value' },
          series: [{ name: 'Ortalama', type: 'line', data: colMeans.map((m) => rNum(m, 3)), smooth: true }],
        },
      },
    ],
    `Tekrarlı ölçümler ANOVA analizinde küresellik ${mauchlyP < 0.05 ? 'ihlal edilmiş (GG ε = ' + rNum(ggEps, 3) + ')' : 'sağlanmış'} olup F = ${fmtNum(fVal, 2)}, p = ${fmtNum(mauchlyP < 0.05 ? pGG : pVal, 4)}, kısmi η² = ${fmtNum(etaP2, 3)} bulunmuştur.`,
    `Repeated-measures ANOVA yielded F = ${fmtNum(fVal, 2)}, p = ${fmtNum(mauchlyP < 0.05 ? pGG : pVal, 4)}, partial η² = ${fmtNum(etaP2, 3)} (Greenhouse-Geisser ε = ${fmtNum(ggEps, 3)}).`,
  );

  out.assumptions = [
    {
      name: 'Küresellik (Mauchly W)',
      passed: k <= 2 || mauchlyP >= 0.05,
      statisticLabel: `W = ${fmtNum(mauchlyW, 3)}`,
      pValue: rNum(mauchlyP, 4),
      detail: mauchlyP < 0.05 ? 'Küresellik varsayımı sağlanmadı; Greenhouse-Geisser satırı raporlanmalıdır.' : 'Küresellik varsayımı sağlandı.',
    },
  ];
  return out;
}

export function runMannWhitneyU(dataset: Dataset, dependent: string, groupVar: string): AnalysisOutput {
  const gMap = groupNumericBy(dataset.rows, dependent, groupVar);
  const keys = Array.from(gMap.keys());
  assertExactlyTwoGroups(keys, groupVar);
  assertAtLeastTwoGroups(keys.length, groupVar, 1);
  const g1 = keys[0];
  const g2 = keys[1];
  const x1 = gMap.get(g1) || [];
  const x2 = gMap.get(g2) || [];
  const n1 = x1.length;
  const n2 = x2.length;
  const N = n1 + n2;
  assertMinN(N, 3, 'Mann-Whitney U testi', 'Mann-Whitney U test');

  const combined = [...x1, ...x2];
  assertNonZeroVariance(combined, dependent);
  const ranks = rankArray(combined);
  const r1Sum = ranks.slice(0, n1).reduce((a, b) => a + b, 0);
  const r2Sum = ranks.slice(n1).reduce((a, b) => a + b, 0);
  const u1 = r1Sum - (n1 * (n1 + 1)) / 2;
  const u2 = n1 * n2 - u1;
  const uStat = Math.min(u1, u2);

  const ties = tieSumOfCubes(combined);
  const muU = (n1 * n2) / 2;
  const varU = N > 1 ? ((n1 * n2) / 12) * (N + 1 - ties / (N * (N - 1))) : 0;
  const sigmaU = Math.sqrt(Math.max(1e-12, varU));
  const zSigned = (u1 - muU) / sigmaU;
  const zMag = Math.abs(uStat - muU) / sigmaU;
  const pVal = clampP(2 * (1 - normalCdf(zMag)));
  const effR = Math.abs(zMag) / Math.sqrt(N);

  const s1 = [...x1].sort((a, b) => a - b);
  const s2 = [...x2].sort((a, b) => a - b);

  return buildOutput(
    'mann_whitney_u',
    `Mann-Whitney U Testi (${dependent} ~ ${groupVar})`,
    { dependent, groupVar, groups: [g1, g2] },
    {
      u: rNum(uStat, 3),
      u1: rNum(u1, 3),
      u2: rNum(u2, 3),
      z: rNum(zSigned, 6),
      zAbs: rNum(zMag, 6),
      p: rNum(pVal, 6),
      r: rNum(effR, 6),
    },
    [
      {
        id: 'mwu_ranks',
        title: 'Sıra Ortalamaları (Ranks)',
        columns: [
          { key: 'group', label: 'Grup' },
          { key: 'n', label: 'N', numeric: true },
          { key: 'median', label: 'Medyan', numeric: true },
          { key: 'meanRank', label: 'Sıra Ort.', numeric: true },
          { key: 'sumRank', label: 'Sıra Toplamı', numeric: true },
        ],
        rows: [
          { group: g1, n: n1, median: rNum(quantile(s1, 0.5), 3), meanRank: rNum(r1Sum / n1, 2), sumRank: rNum(r1Sum, 2) },
          { group: g2, n: n2, median: rNum(quantile(s2, 0.5), 3), meanRank: rNum(r2Sum / n2, 2), sumRank: rNum(r2Sum, 2) },
        ],
      },
      {
        id: 'mwu_test',
        title: 'Mann-Whitney U Test İstatistiği',
        columns: [
          { key: 'u', label: 'Mann-Whitney U', numeric: true },
          { key: 'w', label: 'Wilcoxon W', numeric: true },
          { key: 'z', label: 'Z', numeric: true },
          { key: 'p', label: 'p (Asimptotik)', numeric: true },
          { key: 'r', label: 'Etki Büyüklüğü r', numeric: true },
        ],
        rows: [
          {
            u: rNum(uStat, 2),
            w: rNum(Math.min(r1Sum, r2Sum), 2),
            z: rNum(-zMag, 4),
            p: rNum(pVal, 4),
            r: rNum(effR, 3),
          },
        ],
      },
    ],
    [],
    `Mann-Whitney U testi sonucunda ${g1} (Medyan = ${fmtNum(quantile(s1, 0.5), 2)}) ile ${g2} (Medyan = ${fmtNum(quantile(s2, 0.5), 2)}) arasında U = ${fmtNum(uStat, 1)}, Z = ${fmtNum(-zMag, 2)}, p = ${fmtNum(pVal, 3)}, r = ${fmtNum(effR, 3)} bulunmuştur.`,
    `A Mann-Whitney U test showed U = ${fmtNum(uStat, 1)}, Z = ${fmtNum(-zMag, 2)}, p = ${fmtNum(pVal, 3)}, r = ${fmtNum(effR, 3)} between ${g1} and ${g2}.`,
  );
}

export function runWilcoxon(dataset: Dataset, var1: string, var2: string): AnalysisOutput {
  if (!var1 || !var2 || var1 === var2) {
    throw new StatInputError('INVALID_VARIABLES', 'Wilcoxon testi için iki farklı değişken seçilmelidir.', 'Wilcoxon test requires two different variables.');
  }
  const diffs: number[] = [];
  const xVals: number[] = [];
  const yVals: number[] = [];
  {
    const paired = extractPaired(dataset.rows, var1, var2);
    for (let i = 0; i < paired.x.length; i++) {
      const a = paired.x[i];
      const b = paired.y[i];
      xVals.push(a);
      yVals.push(b);
      if (b !== a) diffs.push(a - b);
    }
  }
  const nEff = diffs.length;
  if (nEff < 2) {
    throw new StatInputError(
      xVals.length === 0 ? 'EMPTY_DATA' : 'INSUFFICIENT_N',
      `Wilcoxon testi için sıfır olmayan en az 2 fark gereklidir (bulunan: ${nEff}).`,
      `Wilcoxon test requires at least 2 non-zero differences (found: ${nEff}).`,
    );
  }

  const absDiffs = diffs.map((d) => Math.abs(d));
  const ranks = rankArray(absDiffs);
  let wPlus = 0;
  let wMinus = 0;
  let nPos = 0;
  let nNeg = 0;
  for (let i = 0; i < nEff; i++) {
    if (diffs[i] > 0) {
      wPlus += ranks[i];
      nPos++;
    } else {
      wMinus += ranks[i];
      nNeg++;
    }
  }

  const wMin = Math.min(wPlus, wMinus);
  const ties = tieSumOfCubes(absDiffs);
  const meanW = (nEff * (nEff + 1)) / 4;
  const varW = (nEff * (nEff + 1) * (2 * nEff + 1)) / 24 - ties / 48;
  const sdW = Math.sqrt(Math.max(1e-12, varW));
  const z = (wMin - meanW) / sdW;
  const pVal = clampP(2 * (1 - normalCdf(Math.abs(z))));
  const effR = Math.abs(z) / Math.sqrt(xVals.length);

  return buildOutput(
    'wilcoxon',
    `Wilcoxon İşaretli Sıralar Testi (${var1} vs ${var2})`,
    { var1, var2 },
    { nPairs: xVals.length, nNonZero: nEff, w: rNum(wMin, 2), z: rNum(z, 4), p: rNum(pVal, 6), r: rNum(effR, 4) },
    [
      {
        id: 'wilcoxon_ranks',
        title: 'İşaretli Sıra Özeti',
        columns: [
          { key: 'type', label: 'Fark Yönü' },
          { key: 'n', label: 'N', numeric: true },
          { key: 'sumRank', label: 'Sıra Toplamı', numeric: true },
          { key: 'meanRank', label: 'Sıra Ort.', numeric: true },
        ],
        rows: [
          { type: `Pozitif (${var1} > ${var2})`, n: nPos, sumRank: rNum(wPlus, 2), meanRank: nPos ? rNum(wPlus / nPos, 2) : 0 },
          { type: `Negatif (${var1} < ${var2})`, n: nNeg, sumRank: rNum(wMinus, 2), meanRank: nNeg ? rNum(wMinus / nNeg, 2) : 0 },
          { type: 'Eşit (Ties)', n: xVals.length - nEff, sumRank: 0, meanRank: 0 },
        ],
      },
      {
        id: 'wilcoxon_test',
        title: 'Wilcoxon Test İstatistiği',
        columns: [
          { key: 'wPlus', label: 'W+', numeric: true },
          { key: 'wMinus', label: 'W-', numeric: true },
          { key: 'z', label: 'Z', numeric: true },
          { key: 'p', label: 'p', numeric: true },
          { key: 'r', label: 'r', numeric: true },
        ],
        rows: [{ wPlus: rNum(wPlus, 2), wMinus: rNum(wMinus, 2), z: rNum(z, 3), p: rNum(pVal, 5), r: rNum(effR, 3) }],
      },
    ],
    [],
    `Wilcoxon işaretli sıralar testine göre ${var1} ile ${var2} ölçümleri arasındaki değişim Z = ${fmtNum(z, 2)}, p = ${fmtNum(pVal, 4)}, r = ${fmtNum(effR, 3)} olarak hesaplanmıştır.`,
    `Wilcoxon signed-rank test yielded Z = ${fmtNum(z, 2)}, p = ${fmtNum(pVal, 4)}, r = ${fmtNum(effR, 3)} between ${var1} and ${var2}.`,
  );
}

export function runKruskalWallis(dataset: Dataset, dependent: string, factor: string): AnalysisOutput {
  const gMap = groupNumericBy(dataset.rows, dependent, factor);
  const groups = Array.from(gMap.entries()).filter(([, a]) => a.length >= 1);
  const k = groups.length;
  assertAtLeastTwoGroups(k, factor, 1);

  const allVals = groups.flatMap(([, a]) => a);
  const N = allVals.length;
  assertMinN(N, k + 1, 'Kruskal-Wallis testi', 'Kruskal-Wallis test');
  assertNonZeroVariance(allVals, dependent);
  const ranks = rankArray(allVals);

  let offset = 0;
  let sumR2OverN = 0;
  const gRows: Record<string, string | number | null>[] = [];
  const gData = groups.map(([name, arr]) => {
    const nj = arr.length;
    const rSlice = ranks.slice(offset, offset + nj);
    offset += nj;
    const sumR = rSlice.reduce((a, b) => a + b, 0);
    sumR2OverN += (sumR * sumR) / nj;
    const sorted = [...arr].sort((a, b) => a - b);
    const med = quantile(sorted, 0.5);
    gRows.push({ group: name, n: nj, median: rNum(med, 3), meanRank: rNum(sumR / nj, 2) });
    return { name, n: nj, meanRank: sumR / nj, median: med };
  });

  const ties = tieSumOfCubes(allVals);
  const cTie = N > 1 ? 1 - ties / (N * N * N - N) : 1;
  const hRaw = (12 / (N * (N + 1))) * sumR2OverN - 3 * (N + 1);
  const H = cTie > 0 ? hRaw / cTie : hRaw;
  const df = k - 1;
  const pVal = clampP(1 - chi2Cdf(H, df));
  const epsilon2 = N > 1 ? H / ((N * N - 1) / (N + 1)) : 0;

  // Dunn's pairwise Bonferroni
  const numPairs = (k * (k - 1)) / 2;
  const dunnVarBase = (N * (N + 1)) / 12 - ties / (12 * (N - 1));
  const dunnRows: Record<string, string | number | null>[] = [];
  for (let i = 0; i < k; i++) {
    for (let j = i + 1; j < k; j++) {
      const se = Math.sqrt(dunnVarBase * (1 / gData[i].n + 1 / gData[j].n));
      const zPair = se > 0 ? (gData[i].meanRank - gData[j].meanRank) / se : 0;
      const pAdj = Math.min(1, 2 * (1 - normalCdf(Math.abs(zPair))) * numPairs);
      dunnRows.push({
        comparison: `${gData[i].name} vs ${gData[j].name}`,
        rankDiff: rNum(gData[i].meanRank - gData[j].meanRank, 2),
        z: rNum(zPair, 3),
        pBonf: rNum(pAdj, 4),
        sig: sigStars(pAdj),
      });
    }
  }

  return buildOutput(
    'kruskal_wallis',
    `Kruskal-Wallis H Testi (${dependent} ~ ${factor})`,
    { dependent, factor },
    { k, N, h: rNum(H, 6), df, p: rNum(pVal, 6), epsilon2: rNum(epsilon2, 6) },
    [
      {
        id: 'kw_ranks',
        title: 'Grup Sıra Ortalamaları',
        columns: [
          { key: 'group', label: 'Grup' },
          { key: 'n', label: 'N', numeric: true },
          { key: 'median', label: 'Medyan', numeric: true },
          { key: 'meanRank', label: 'Sıra Ort.', numeric: true },
        ],
        rows: gRows,
      },
      {
        id: 'kw_test',
        title: 'Kruskal-Wallis Test Özeti',
        columns: [
          { key: 'h', label: 'Kruskal-Wallis H', numeric: true },
          { key: 'df', label: 'sd', numeric: true },
          { key: 'p', label: 'p', numeric: true },
          { key: 'epsilon2', label: 'ε² (Etki)', numeric: true },
        ],
        rows: [{ h: rNum(H, 3), df, p: rNum(pVal, 4), epsilon2: rNum(epsilon2, 3) }],
      },
      {
        id: 'kw_dunn',
        title: 'Dunn Post-Hoc İkili Karşılaştırmalar (Bonferroni)',
        columns: [
          { key: 'comparison', label: 'Karşılaştırma' },
          { key: 'rankDiff', label: 'Sıra Ort. Farkı', numeric: true },
          { key: 'z', label: 'Z', numeric: true },
          { key: 'pBonf', label: 'p (Bonferroni)', numeric: true },
          { key: 'sig', label: 'Düzey' },
        ],
        rows: dunnRows,
      },
    ],
    [],
    `Kruskal-Wallis testi sonucunda ${factor} grupları arasında H(${df}) = ${fmtNum(H, 2)}, p = ${fmtNum(pVal, 3)}, ε² = ${fmtNum(epsilon2, 3)} bulunmuştur.`,
    `A Kruskal-Wallis test across ${factor} groups showed H(${df}) = ${fmtNum(H, 2)}, p = ${fmtNum(pVal, 3)}, ε² = ${fmtNum(epsilon2, 3)}.`,
  );
}

export function runFriedman(dataset: Dataset, variables: string[]): AnalysisOutput {
  if (variables.length < 2 || new Set(variables).size !== variables.length) {
    throw new StatInputError('NO_VARIABLES', 'Friedman testi için en az 2 farklı ölçüm değişkeni seçilmelidir.', 'The Friedman test requires at least 2 different measurement variables.');
  }
  const k = variables.length;
  const mat: number[][] = [];
  for (const row of dataset.rows) {
    const vals = variables.map((v) => toNum(row[v]));
    if (vals.every((v) => v !== null)) mat.push(vals as number[]);
  }
  const n = mat.length;
  assertMinN(n, 3, 'Friedman testi (tam vaka)', 'Friedman test (complete cases)');

  const colRankSums = new Array<number>(k).fill(0);
  let totalTies = 0;
  for (const r of mat) {
    const rr = rankArray(r);
    for (let j = 0; j < k; j++) colRankSums[j] += rr[j];
    totalTies += tieSumOfCubes(r);
  }

  const ssRanks = colRankSums.reduce((s, rj) => s + rj * rj, 0);
  const rawChi2 = (12 / (n * k * (k + 1))) * ssRanks - 3 * n * (k + 1);
  const tieDenom = 1 - totalTies / (n * k * (k * k - 1));
  if (!(tieDenom > 1e-12)) {
    throw new StatInputError(
      'ZERO_VARIANCE',
      'Tüm deneklerde ölçümler eşit (tamamen bağlı sıralar); Friedman istatistiği tanımsızdır.',
      'All measurements are tied within every subject; the Friedman statistic is undefined.',
    );
  }
  const chi2 = rawChi2 / tieDenom;
  const df = k - 1;
  const pVal = clampP(1 - chi2Cdf(chi2, df));
  const kendallW = chi2 / (n * (k - 1));

  return buildOutput(
    'friedman',
    `Friedman İki Yönlü Sıralama Testi (${variables.join(', ')})`,
    { variables },
    { n, k, chi2: rNum(chi2, 4), df, p: rNum(pVal, 6), kendallW: rNum(kendallW, 4) },
    [
      {
        id: 'friedman_ranks',
        title: 'Sıra Ortalamaları',
        columns: [
          { key: 'variable', label: 'Ölçüm' },
          { key: 'meanRank', label: 'Sıra Ort.', numeric: true },
          { key: 'median', label: 'Medyan', numeric: true },
        ],
        rows: variables.map((v, j) => {
          const sorted = mat.map((r) => r[j]).sort((a, b) => a - b);
          return { variable: v, meanRank: rNum(colRankSums[j] / n, 2), median: rNum(quantile(sorted, 0.5), 3) };
        }),
      },
      {
        id: 'friedman_test',
        title: 'Friedman Test Özeti',
        columns: [
          { key: 'n', label: 'N', numeric: true },
          { key: 'chi2', label: 'Ki-Kare (χ²)', numeric: true },
          { key: 'df', label: 'sd', numeric: true },
          { key: 'p', label: 'p', numeric: true },
          { key: 'kendallW', label: "Kendall's W", numeric: true },
        ],
        rows: [{ n, chi2: rNum(chi2, 3), df, p: rNum(pVal, 5), kendallW: rNum(kendallW, 3) }],
      },
    ],
    [],
    `Friedman testi sonucunda ölçümler arasında istatistiksel olarak χ²(${df}) = ${fmtNum(chi2, 2)}, p = ${fmtNum(pVal, 4)}, Kendall's W = ${fmtNum(kendallW, 3)} bulunmuştur.`,
    `Friedman test across repeated measures yielded χ²(${df}) = ${fmtNum(chi2, 2)}, p = ${fmtNum(pVal, 4)}, Kendall's W = ${fmtNum(kendallW, 3)}.`,
  );
}

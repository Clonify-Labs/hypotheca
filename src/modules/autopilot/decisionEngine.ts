import { AnalysisOutput, AssumptionBadge, DataRow, Dataset, StatTable } from '../../types/interfaces';
import { shapiroWilk } from '../../engine/core/distributions';
import { StatInputError } from '../../engine/core/errors';
import { olsFit, spssMoments } from '../../engine/core/linalg';
import {
  extractNum,
  extractNumMatrix,
  groupNumericBy,
  leveneTest,
  fmtNum,
  rNum,
  runCorrelation,
  runFriedman,
  runIndependentTTest,
  runKruskalWallis,
  runLinearRegression,
  runLogisticRegression,
  runMannWhitneyU,
  runOneWayAnova,
  runPairedTTest,
  runRepeatedAnova,
  runWilcoxon,
} from '../../engine/classical';

export type ResearchDesign =
  | 'compare_2_indep'
  | 'compare_k_indep'
  | 'compare_2_paired'
  | 'compare_k_paired'
  | 'relationship'
  | 'prediction';

export interface DecisionNode {
  id: string;
  label: string;
  condition: string;
  result: 'pass' | 'warn' | 'route';
}

export interface RecommendationResult {
  design: ResearchDesign;
  recommendedTest: string;
  alternativeTest: string;
  reasonTr: string;
  reasonEn: string;
  decisionPath: DecisionNode[];
  output: AnalysisOutput;
}

interface NormalityCheck {
  label: string;
  n: number;
  w: number;
  p: number;
  skewness: number | null;
  kurtosis: number | null;
  passed: boolean;
}

function normalizeNumericDataset(dataset: Dataset, cols: string[]): Dataset {
  const colSet = new Set(cols);
  const rows: DataRow[] = dataset.rows.map((row) => {
    let changed = false;
    const next: DataRow = { ...row };
    for (const c of colSet) {
      const raw = row[c];
      if (typeof raw === 'string' && raw.trim() !== '') {
        const parsed = Number(raw.replace(',', '.'));
        if (Number.isFinite(parsed)) {
          next[c] = parsed;
          changed = true;
        }
      }
    }
    return changed ? next : row;
  });
  return { ...dataset, rows };
}

function evaluateGroupNormality(label: string, arr: number[], maxAbsSkew = 2): NormalityCheck {
  const n = arr.length;
  if (n < 3) {
    return { label, n, w: NaN, p: NaN, skewness: null, kurtosis: null, passed: false };
  }
  const sw = shapiroWilk(arr);
  const mom = spssMoments(arr);
  const cltOk = n >= 30 && Math.abs(mom.skewness ?? 0) <= maxAbsSkew;
  const passed = sw.p >= 0.05 || cltOk;
  return {
    label,
    n,
    w: sw.w,
    p: sw.p,
    skewness: mom.skewness,
    kurtosis: mom.kurtosis,
    passed,
  };
}

function evaluateStrictNormality(label: string, arr: number[]): NormalityCheck {
  const n = arr.length;
  if (n < 3) {
    return { label, n, w: NaN, p: NaN, skewness: null, kurtosis: null, passed: false };
  }
  const sw = shapiroWilk(arr);
  const mom = spssMoments(arr);
  const shapeOk = n >= 30 && Math.abs(mom.skewness ?? 0) <= 1.5 && Math.abs(mom.kurtosis ?? 0) <= 1.5;
  return {
    label,
    n,
    w: sw.w,
    p: sw.p,
    skewness: mom.skewness,
    kurtosis: mom.kurtosis,
    passed: sw.p >= 0.05 || shapeOk,
  };
}

function toNormalityBadges(checks: NormalityCheck[]): AssumptionBadge[] {
  return checks.map((c) => ({
    name: `Normallik (${c.label})`,
    passed: c.passed,
    statisticLabel: `W = ${rNum(c.w, 4) ?? '-'}, Skew = ${rNum(c.skewness, 2) ?? '-'}`,
    pValue: rNum(c.p, 4),
    detail: c.passed
      ? Number.isFinite(c.p) && c.p < 0.05
        ? `N=${c.n}; Shapiro-Wilk p < .05 (normallik ihlal edildi), ancak n >= 30 olduğundan MLT (CLT) gereği parametrik test dayanıklıdır.`
        : `N=${c.n}; parametrik normallik / CLT ölçütü karşılandı.`
      : Number.isFinite(c.p)
        ? `N=${c.n}; normal dağılımdan anlamlı sapma (p = ${fmtNum(c.p, 4)}).`
        : `N=${c.n}; Shapiro-Wilk uygulanamadı (n < 3, n > 5000 veya sabit değerler).`,
  }));
}

function markRecommendedRow(
  tables: StatTable[],
  tableId: string,
  labelKey: string,
  matchFn: (row: Record<string, string | number | boolean | null>) => boolean,
  footnote: string,
): StatTable[] {
  return tables.map((tbl) => {
    if (tbl.id !== tableId) return tbl;
    const rows = tbl.rows.map((row) => {
      if (!matchFn(row)) return row;
      const current = String(row[labelKey] ?? '');
      const updated = current.includes('[Önerilen]') ? current : `${current} [Önerilen]`;
      return { ...row, [labelKey]: updated };
    });
    const footnotes = [...(tbl.footnotes ?? []), footnote];
    return { ...tbl, rows, footnotes };
  });
}

function runCompare2Indep(dataset: Dataset, dependent: string, secondary?: string): RecommendationResult {
  if (!secondary) {
    throw new StatInputError('NO_VARIABLES', '2 bağımsız grup karşılaştırması için grup değişkeni seçilmelidir.', 'Select a grouping variable for a 2 independent groups comparison.');
  }
  const gMap = groupNumericBy(dataset.rows, dependent, secondary);
  const keys = Array.from(gMap.keys()).filter((k) => (gMap.get(k)?.length ?? 0) >= 1);
  if (keys.length < 2) {
    throw new StatInputError(
      keys.length === 0 ? 'EMPTY_DATA' : 'SINGLE_GROUP',
      `"${secondary}" değişkeninde geçerli en az 2 grup bulunmalıdır.`,
      `"${secondary}" must contain at least 2 valid groups.`,
    );
  }
  if (keys.length > 2) {
    throw new StatInputError(
      'TOO_MANY_GROUPS',
      `"${secondary}" değişkeninde ${keys.length} grup var; 2 bağımsız grup deseni yerine k bağımsız grup desenini seçin.`,
      `"${secondary}" has ${keys.length} groups; choose the k independent groups design instead.`,
    );
  }
  const g1 = keys[0];
  const g2 = keys[1];
  const x1 = gMap.get(g1) || [];
  const x2 = gMap.get(g2) || [];

  const n1 = evaluateGroupNormality(g1, x1, 2);
  const n2 = evaluateGroupNormality(g2, x2, 2);
  const bothNormal = n1.passed && n2.passed && x1.length >= 2 && x2.length >= 2;
  const lev = x1.length >= 2 && x2.length >= 2 ? leveneTest([x1, x2], 'mean') : { f: 0, df1: 1, df2: 1, p: 0 };
  const equalVar = lev.p >= 0.05;

  const decisionPath: DecisionNode[] = [
    {
      id: 'design',
      label: 'Araştırma Deseni',
      condition: `2 Bağımsız Grup (${g1}: N=${x1.length}, ${g2}: N=${x2.length})`,
      result: 'pass',
    },
    {
      id: 'norm_g1',
      label: `Normallik (${g1})`,
      condition: `SW W=${fmtNum(n1.w, 3)}, p=${fmtNum(n1.p, 4)}, |Skew|=${fmtNum(Math.abs(n1.skewness ?? 0), 2)}`,
      result: n1.passed ? 'pass' : 'warn',
    },
    {
      id: 'norm_g2',
      label: `Normallik (${g2})`,
      condition: `SW W=${fmtNum(n2.w, 3)}, p=${fmtNum(n2.p, 4)}, |Skew|=${fmtNum(Math.abs(n2.skewness ?? 0), 2)}`,
      result: n2.passed ? 'pass' : 'warn',
    },
    {
      id: 'levene',
      label: 'Varyans Homojenliği (Levene)',
      condition: bothNormal
        ? `Levene F=${fmtNum(lev.f, 3)}, p=${fmtNum(lev.p, 4)}`
        : `Normallik sağlanmadığından parametrik olmayan test seçildi (Levene p=${fmtNum(lev.p, 4)})`,
      result: bothNormal && equalVar ? 'pass' : 'warn',
    },
  ];

  if (bothNormal && equalVar) {
    const output = runIndependentTTest(dataset, dependent, secondary, [g1, g2]);
    output.tables = markRecommendedRow(
      output.tables,
      'indep_test',
      'method',
      (r) => String(r.method).includes('Student'),
      'Otopilot Kararı: Normallik ve Levene (p ≥ .05) sağlandığından Student t satırı önerilir.',
    );
    output.summary.recommendedVariant = 'student';
    const recommendedTest = 'Student Bağımsız Örneklem t-Testi';
    decisionPath.push({ id: 'route', label: 'Seçilen Test', condition: recommendedTest, result: 'route' });
    return {
      design: 'compare_2_indep',
      recommendedTest,
      alternativeTest: 'Welch t-Testi / Mann-Whitney U Testi',
      reasonTr: `Her iki grup normallik/CLT ölçütünü (N ≥ 30 & |çarpıklık| ≤ 2 veya SW p ≥ .05) ve Levene varyans homojenliğini (p = ${fmtNum(lev.p, 4)} ≥ .05) karşıladığı için Student bağımsız örneklem t-testi uygulandı.`,
      reasonEn: `Both groups met normality/CLT criteria and Levene's homogeneity of variance (p = ${fmtNum(lev.p, 4)} >= .05), routing to the Student independent-samples t-test.`,
      decisionPath,
      output,
    };
  }

  if (bothNormal && !equalVar) {
    const output = runIndependentTTest(dataset, dependent, secondary, [g1, g2]);
    output.tables = markRecommendedRow(
      output.tables,
      'indep_test',
      'method',
      (r) => String(r.method).includes('Welch'),
      'Otopilot Kararı: Levene p < .05 olduğu için Welch t-testi satırı önerilen sonuç olarak işaretlenmiştir.',
    );
    output.summary.recommendedVariant = 'welch';
    const recommendedTest = 'Welch t-Testi (Eşit Olmayan Varyanslar)';
    decisionPath.push({ id: 'route', label: 'Seçilen Test', condition: recommendedTest, result: 'route' });
    return {
      design: 'compare_2_indep',
      recommendedTest,
      alternativeTest: 'Mann-Whitney U Testi',
      reasonTr: `Gruplar normallik/CLT ölçütünü karşılamasına karşın Levene testi varyansların homojen olmadığını gösterdi (F = ${fmtNum(lev.f, 3)}, p = ${fmtNum(lev.p, 4)} < .05); bu nedenle Welch t-testi satırı öne çıkarıldı.`,
      reasonEn: `Normality/CLT criteria were satisfied, but Levene's test indicated unequal variances (F = ${fmtNum(lev.f, 3)}, p = ${fmtNum(lev.p, 4)} < .05); Welch's t-test is recommended and highlighted.`,
      decisionPath,
      output,
    };
  }

  const output = runMannWhitneyU(dataset, dependent, secondary);
  output.summary.recommendedVariant = 'mann_whitney_u';
  output.assumptions = [
    ...toNormalityBadges([n1, n2]),
    {
      name: 'Varyans Homojenliği (Levene)',
      passed: equalVar,
      statisticLabel: `F = ${fmtNum(lev.f, 3)}`,
      pValue: rNum(lev.p, 4),
      detail: 'Parametrik olmayan Mann-Whitney U testi seçildiği için varyans eşitliği önkoşulu zorunlu değildir.',
    },
  ];
  const recommendedTest = 'Mann-Whitney U Testi';
  decisionPath.push({ id: 'route', label: 'Seçilen Test', condition: recommendedTest, result: 'route' });
  return {
    design: 'compare_2_indep',
    recommendedTest,
    alternativeTest: 'Welch t-Testi',
    reasonTr: `En az bir grupta normallik ve büyük örneklem CLT (N ≥ 30 & |çarpıklık| ≤ 2) ölçütü sağlanamadığından parametrik olmayan Mann-Whitney U testi uygulandı.`,
    reasonEn: `At least one group violated normality and CLT thresholds (N >= 30 & |skew| <= 2), routing to the non-parametric Mann-Whitney U test.`,
    decisionPath,
    output,
  };
}

function runCompareKIndep(dataset: Dataset, dependent: string, secondary?: string): RecommendationResult {
  if (!secondary) {
    throw new StatInputError('NO_VARIABLES', 'k bağımsız grup karşılaştırması için faktör değişkeni seçilmelidir.', 'Select a factor for a k independent groups comparison.');
  }
  const gMap = groupNumericBy(dataset.rows, dependent, secondary);
  const groups = Array.from(gMap.entries()).filter(([, arr]) => arr.length >= 1);
  if (groups.length < 2) {
    throw new StatInputError(
      groups.length === 0 ? 'EMPTY_DATA' : 'SINGLE_GROUP',
      `"${secondary}" faktöründe en az 2 grup bulunmalıdır.`,
      `Factor "${secondary}" must contain at least 2 groups.`,
    );
  }

  const normChecks = groups.map(([name, arr]) => evaluateGroupNormality(name, arr, 2));
  const allEnough = groups.every(([, arr]) => arr.length >= 2);
  const allNormal = allEnough && normChecks.every((c) => c.passed);
  const lev = allEnough ? leveneTest(groups.map(([, a]) => a), 'mean') : { f: 0, df1: groups.length - 1, df2: 1, p: 0 };
  const equalVar = lev.p >= 0.05;

  const decisionPath: DecisionNode[] = [
    {
      id: 'design',
      label: 'Araştırma Deseni',
      condition: `${groups.length} Bağımsız Grup (${groups.map(([g, a]) => `${g}:${a.length}`).join(', ')})`,
      result: 'pass',
    },
    {
      id: 'normality',
      label: 'Grup Normalliği (Shapiro-Wilk / CLT)',
      condition: `${normChecks.filter((c) => c.passed).length}/${normChecks.length} grup normallik/CLT geçti`,
      result: allNormal ? 'pass' : 'warn',
    },
    {
      id: 'levene',
      label: 'Varyans Homojenliği (Levene)',
      condition: `Levene F=${fmtNum(lev.f, 3)}, p=${fmtNum(lev.p, 4)}`,
      result: allNormal && equalVar ? 'pass' : 'warn',
    },
  ];

  if (allNormal && equalVar) {
    const output = runOneWayAnova(dataset, dependent, secondary, 'tukey');
    output.summary.recommendedVariant = 'oneway_anova_tukey';
    output.assumptions = [...toNormalityBadges(normChecks), ...(output.assumptions ?? [])];
    const recommendedTest = 'Tek Yönlü ANOVA + Tukey HSD';
    decisionPath.push({ id: 'route', label: 'Seçilen Test', condition: recommendedTest, result: 'route' });
    return {
      design: 'compare_k_indep',
      recommendedTest,
      alternativeTest: 'Kruskal-Wallis H + Dunn-Bonferroni',
      reasonTr: `Tüm gruplar normallik/CLT ölçütünü ve Levene varyans homojenliğini (p = ${fmtNum(lev.p, 4)} ≥ .05) sağladığı için klasik Tek Yönlü ANOVA ve Tukey HSD post-hoc testi uygulandı.`,
      reasonEn: `All groups satisfied normality/CLT and Levene's homogeneity of variance (p = ${fmtNum(lev.p, 4)} >= .05), routing to One-Way ANOVA with Tukey HSD post-hoc comparisons.`,
      decisionPath,
      output,
    };
  }

  if (allNormal && !equalVar) {
    const output = runOneWayAnova(dataset, dependent, secondary, 'games_howell');
    output.summary.recommendedVariant = 'welch_anova_games_howell';
    output.tables = markRecommendedRow(
      output.tables,
      'robust_tests',
      'test',
      (r) => String(r.test).includes('Welch'),
      'Otopilot Kararı: Levene p < .05 olduğu için Welch F ve Games-Howell post-hoc testleri önerilir.',
    );
    output.assumptions = [...toNormalityBadges(normChecks), ...(output.assumptions ?? [])];
    const recommendedTest = 'Welch ANOVA + Games-Howell Post-Hoc';
    decisionPath.push({ id: 'route', label: 'Seçilen Test', condition: recommendedTest, result: 'route' });
    return {
      design: 'compare_k_indep',
      recommendedTest,
      alternativeTest: 'Kruskal-Wallis H + Dunn-Bonferroni',
      reasonTr: `Grup normalliği sağlanmasına karşın Levene testi varyans eşitsizliği gösterdi (p = ${fmtNum(lev.p, 4)} < .05); bu nedenle Welch ANOVA ve Games-Howell post-hoc prosedürü seçildi.`,
      reasonEn: `Normality held across groups, but Levene's test flagged unequal variances (p = ${fmtNum(lev.p, 4)} < .05); routed to Welch's ANOVA with Games-Howell post-hoc tests.`,
      decisionPath,
      output,
    };
  }

  const output = runKruskalWallis(dataset, dependent, secondary);
  output.summary.recommendedVariant = 'kruskal_wallis';
  output.assumptions = [
    ...toNormalityBadges(normChecks),
    {
      name: 'Varyans Homojenliği (Levene)',
      passed: equalVar,
      statisticLabel: `F = ${fmtNum(lev.f, 3)}`,
      pValue: rNum(lev.p, 4),
      detail: 'Parametrik olmayan Kruskal-Wallis H testi uygulandı.',
    },
  ];
  const recommendedTest = 'Kruskal-Wallis H Testi + Dunn-Bonferroni';
  decisionPath.push({ id: 'route', label: 'Seçilen Test', condition: recommendedTest, result: 'route' });
  return {
    design: 'compare_k_indep',
    recommendedTest,
    alternativeTest: 'Welch ANOVA + Games-Howell',
    reasonTr: `En az bir grupta normallik/CLT koşulu sağlanamadığı için parametrik olmayan Kruskal-Wallis H testi ve Dunn-Bonferroni ikili karşılaştırmaları uygulandı.`,
    reasonEn: `Normality/CLT criteria failed in at least one group, routing to the non-parametric Kruskal-Wallis H test with Dunn-Bonferroni pairwise comparisons.`,
    decisionPath,
    output,
  };
}

function runCompare2Paired(
  dataset: Dataset,
  dependent: string,
  secondary?: string,
  repeatedVars?: string[],
): RecommendationResult {
  const var1 = dependent;
  const var2 = secondary || repeatedVars?.find((v) => v !== var1);
  if (!var1 || !var2 || var1 === var2) {
    throw new StatInputError('INVALID_VARIABLES', '2 eşleştirilmiş ölçüm için iki farklı sayısal değişken seçilmelidir.', 'Select two different numeric variables for 2 paired measurements.');
  }

  const normDs = normalizeNumericDataset(dataset, [var1, var2]);
  const pairs = extractNumMatrix(normDs.rows, [var1, var2]);
  const n = pairs.length;
  if (n < 2) {
    throw new StatInputError(
      n === 0 ? 'EMPTY_DATA' : 'INSUFFICIENT_N',
      `Eşleştirilmiş karşılaştırma için en az 2 geçerli çift gereklidir (bulunan: ${n}).`,
      `A paired comparison requires at least 2 valid pairs (found: ${n}).`,
    );
  }

  const diffs = pairs.map(([a, b]) => a - b);
  const swDiff = shapiroWilk(diffs);
  const momDiff = spssMoments(diffs);
  const nonZeroDiffs = diffs.filter((d) => d !== 0).length;
  const normalDiff = (swDiff.valid && swDiff.p >= 0.05) || n >= 30 || (!swDiff.valid && swDiff.reason === 'n_below_3');
  const usePairedT = normalDiff || nonZeroDiffs < 2;

  const decisionPath: DecisionNode[] = [
    {
      id: 'design',
      label: 'Araştırma Deseni',
      condition: `2 Eşleştirilmiş Ölçüm (${var1} vs ${var2}, N=${n})`,
      result: 'pass',
    },
    {
      id: 'diff_normality',
      label: 'Fark Puanları Normalliği (x - y)',
      condition: `SW W=${fmtNum(swDiff.w, 3)}, p=${fmtNum(swDiff.p, 4)}, Skew=${rNum(momDiff.skewness, 2) ?? '-'}, N=${n}`,
      result: normalDiff ? 'pass' : 'warn',
    },
  ];

  if (usePairedT) {
    const output = runPairedTTest(normDs, var1, var2);
    output.summary.recommendedVariant = 'paired_t';
    const recommendedTest = 'Eşleştirilmiş Örneklem t-Testi';
    decisionPath.push({ id: 'route', label: 'Seçilen Test', condition: recommendedTest, result: 'route' });
    return {
      design: 'compare_2_paired',
      recommendedTest,
      alternativeTest: 'Wilcoxon İşaretli Sıralar Testi',
      reasonTr:
        swDiff.p >= 0.05
          ? `Fark puanları normal dağılım gösterdi (SW W = ${fmtNum(swDiff.w, 3)}, p = ${fmtNum(swDiff.p, 4)} ≥ .05); Eşleştirilmiş Örneklem t-Testi uygulandı.`
          : `Örneklem büyüklüğü N = ${n} ≥ 30 (Merkezi Limit Teoremi) olduğundan Eşleştirilmiş Örneklem t-Testi uygulandı (SW p = ${fmtNum(swDiff.p, 4)}).`,
      reasonEn:
        swDiff.p >= 0.05
          ? `Difference scores satisfied normality (Shapiro-Wilk W = ${fmtNum(swDiff.w, 3)}, p = ${fmtNum(swDiff.p, 4)} >= .05), routing to the Paired-Samples t-Test.`
          : `Sample size N = ${n} >= 30 satisfies the Central Limit Theorem, routing to the Paired-Samples t-Test (SW p = ${fmtNum(swDiff.p, 4)}).`,
      decisionPath,
      output,
    };
  }

  const output = runWilcoxon(normDs, var1, var2);
  output.summary.recommendedVariant = 'wilcoxon';
  output.assumptions = [
    {
      name: 'Fark Skorları Normalliği (Shapiro-Wilk)',
      passed: false,
      statisticLabel: `W = ${fmtNum(swDiff.w, 3)}`,
      pValue: rNum(swDiff.p, 4),
      detail: `N=${n} < 30 ve fark puanları normal dağılmadığından (p < .05) Wilcoxon testi seçildi.`,
    },
  ];
  const recommendedTest = 'Wilcoxon İşaretli Sıralar Testi';
  decisionPath.push({ id: 'route', label: 'Seçilen Test', condition: recommendedTest, result: 'route' });
  return {
    design: 'compare_2_paired',
    recommendedTest,
    alternativeTest: 'Eşleştirilmiş Örneklem t-Testi',
    reasonTr: `Küçük örneklemde (N = ${n} < 30) fark puanları normallikten saptığı için (SW p = ${fmtNum(swDiff.p, 4)} < .05) parametrik olmayan Wilcoxon İşaretli Sıralar Testi uygulandı.`,
    reasonEn: `With N = ${n} < 30 and non-normal difference scores (SW p = ${fmtNum(swDiff.p, 4)} < .05), routed to the non-parametric Wilcoxon Signed-Rank test.`,
    decisionPath,
    output,
  };
}

function runCompareKPaired(
  dataset: Dataset,
  dependent: string,
  secondary?: string,
  predictors?: string[],
  repeatedVars?: string[],
): RecommendationResult {
  const vars =
    repeatedVars && repeatedVars.length >= 2
      ? Array.from(new Set(repeatedVars))
      : Array.from(new Set([dependent, secondary, ...(predictors ?? [])].filter((v): v is string => Boolean(v))));

  if (vars.length < 2) {
    throw new StatInputError('NO_VARIABLES', 'k tekrarlı ölçüm için en az 2 ölçüm değişkeni seçilmelidir.', 'Select at least 2 measurement variables for k repeated measures.');
  }

  const normDs = normalizeNumericDataset(dataset, vars);
  const mat = extractNumMatrix(normDs.rows, vars);
  const n = mat.length;
  if (n < 3) {
    throw new StatInputError(
      n === 0 ? 'EMPTY_DATA' : 'INSUFFICIENT_N',
      `Tekrarlı ölçümler analizi için en az 3 tam gözlem gereklidir (bulunan: ${n}).`,
      `Repeated-measures analysis requires at least 3 complete observations (found: ${n}).`,
    );
  }

  const checks: NormalityCheck[] = vars.map((vName, j) => {
    const col = mat.map((r) => r[j]);
    const sw = shapiroWilk(col);
    const mom = spssMoments(col);
    const severeSkew = Math.abs(mom.skewness ?? 0) > 1.5;
    const smallNonNormal = n < 15 && sw.p < 0.05;
    return {
      label: vName,
      n,
      w: sw.w,
      p: sw.p,
      skewness: mom.skewness,
      kurtosis: mom.kurtosis,
      passed: !severeSkew && !smallNonNormal,
    };
  });

  const severelySkewed = checks.some((c) => Math.abs(c.skewness ?? 0) > 1.5);
  const smallNonNormal = n < 15 && checks.some((c) => c.p < 0.05);

  const decisionPath: DecisionNode[] = [
    {
      id: 'design',
      label: 'Araştırma Deseni',
      condition: `${vars.length} Tekrarlı Ölçüm (${vars.join(' → ')}, N=${n})`,
      result: 'pass',
    },
    {
      id: 'norm_skew',
      label: 'Normallik & Çarpıklık Kontrolü',
      condition: `Max |Skew|=${rNum(Math.max(...checks.map((c) => Math.abs(c.skewness ?? 0))), 2)}, Min SW p=${rNum(Math.min(...checks.map((c) => c.p)), 4)}`,
      result: severelySkewed || smallNonNormal ? 'warn' : 'pass',
    },
  ];

  if (severelySkewed || smallNonNormal) {
    const output = runFriedman(normDs, vars);
    output.summary.recommendedVariant = 'friedman';
    output.assumptions = toNormalityBadges(checks);
    const recommendedTest = 'Friedman İki Yönlü Sıralama Testi';
    decisionPath.push({ id: 'route', label: 'Seçilen Test', condition: recommendedTest, result: 'route' });
    return {
      design: 'compare_k_paired',
      recommendedTest,
      alternativeTest: 'Tekrarlı Ölçümler ANOVA (Greenhouse-Geisser)',
      reasonTr: severelySkewed
        ? `Ölçümlerden en az biri aşırı çarpık (|çarpıklık| > 1.5) olduğu için parametrik olmayan Friedman testi uygulandı.`
        : `Örneklem N = ${n} < 15 ve normal dağılım varsayımı sağlanmadığından (SW p < .05) Friedman testi uygulandı.`,
      reasonEn: severelySkewed
        ? `At least one repeated measure exhibited severe skewness (|skew| > 1.5), routing to the non-parametric Friedman test.`
        : `With N = ${n} < 15 and non-normal repeated measures (SW p < .05), routed to the non-parametric Friedman test.`,
      decisionPath,
      output,
    };
  }

  const output = runRepeatedAnova(normDs, vars);
  const mauchlyW = Number(output.summary.mauchlyW ?? 1);
  const mauchlyP = Number(output.summary.mauchlyP ?? 1);
  const ggEps = Number(output.summary.ggEpsilon ?? 1);
  const sphericityViolated = vars.length >= 3 && (mauchlyP < 0.05 || mauchlyW < 0.05);

  decisionPath.push({
    id: 'mauchly',
    label: 'Küresellik (Mauchly W)',
    condition:
      vars.length >= 3
        ? `Mauchly W=${fmtNum(mauchlyW, 3)}, p=${fmtNum(mauchlyP, 4)}, GG ε=${fmtNum(ggEps, 3)}`
        : '2 koşulda küresellik varsayımı otomatik sağlanır',
    result: sphericityViolated ? 'warn' : 'pass',
  });

  if (sphericityViolated) {
    output.summary.recommendedVariant = 'repeated_anova_gg';
    output.tables = markRecommendedRow(
      output.tables,
      'rm_anova',
      'correction',
      (r) => String(r.correction).includes('Greenhouse-Geisser'),
      `Otopilot Kararı: Küresellik ihlal edildiği için Greenhouse-Geisser (ε = ${fmtNum(ggEps, 3)}) satırı raporlanmalıdır.`,
    );
    const recommendedTest = `Tekrarlı Ölçümler ANOVA (Greenhouse-Geisser ε=${fmtNum(ggEps, 3)})`;
    decisionPath.push({ id: 'route', label: 'Seçilen Test', condition: recommendedTest, result: 'route' });
    return {
      design: 'compare_k_paired',
      recommendedTest,
      alternativeTest: 'Friedman Testi / Huynh-Feldt Düzeltmesi',
      reasonTr: `Mauchly küresellik testi anlamlı sapma gösterdi (W = ${fmtNum(mauchlyW, 3)}, p = ${fmtNum(mauchlyP, 4)} < .05); serbestlik dereceleri Greenhouse-Geisser ε = ${fmtNum(ggEps, 3)} ile düzeltildi.`,
      reasonEn: `Mauchly's test indicated a violation of sphericity (W = ${fmtNum(mauchlyW, 3)}, p = ${fmtNum(mauchlyP, 4)} < .05); Greenhouse-Geisser correction (ε = ${fmtNum(ggEps, 3)}) is applied.`,
      decisionPath,
      output,
    };
  }

  output.summary.recommendedVariant = 'repeated_anova_sphericity';
  output.tables = markRecommendedRow(
    output.tables,
    'rm_anova',
    'correction',
    (r) => String(r.correction).includes('Küresellik Varsayıldı'),
    'Otopilot Kararı: Küresellik varsayımı sağlandığı için düzeltmesiz satır esas alınabilir.',
  );
  const recommendedTest = 'Tekrarlı Ölçümler ANOVA (Küresellik Varsayıldı)';
  decisionPath.push({ id: 'route', label: 'Seçilen Test', condition: recommendedTest, result: 'route' });
  return {
    design: 'compare_k_paired',
    recommendedTest,
    alternativeTest: 'Friedman Testi',
    reasonTr: `Normallik/çarpıklık ölçütleri ve Mauchly küresellik testi (W = ${fmtNum(mauchlyW, 3)}, p = ${fmtNum(mauchlyP, 4)} ≥ .05) sağlandığından Tekrarlı Ölçümler ANOVA uygulandı.`,
    reasonEn: `Normality/skewness and Mauchly's sphericity test (W = ${fmtNum(mauchlyW, 3)}, p = ${fmtNum(mauchlyP, 4)} >= .05) passed, routing to Repeated-Measures ANOVA.`,
    decisionPath,
    output,
  };
}

function runRelationshipDesign(
  dataset: Dataset,
  dependent: string,
  secondary?: string,
  predictors?: string[],
): RecommendationResult {
  const vars = Array.from(new Set([dependent, secondary, ...(predictors ?? [])].filter((v): v is string => Boolean(v))));
  if (vars.length < 2) {
    throw new StatInputError('NO_VARIABLES', 'İlişki analizi için en az 2 sayısal değişken seçilmelidir.', 'Select at least 2 numeric variables for a relationship analysis.');
  }

  const checks = vars.map((v) => evaluateStrictNormality(v, extractNum(dataset.rows, v)));
  const allNormal = checks.every((c) => c.passed);
  const method = allNormal ? 'pearson' : 'spearman';
  const output = runCorrelation(dataset, vars, method);
  output.summary.recommendedVariant = method;
  output.assumptions = toNormalityBadges(checks);

  const decisionPath: DecisionNode[] = [
    {
      id: 'design',
      label: 'Araştırma Deseni',
      condition: `İlişki Analizi (${vars.join(' ↔ ')})`,
      result: 'pass',
    },
    ...checks.map((c, idx) => ({
      id: `norm_${idx}`,
      label: `Normallik (${c.label})`,
      condition: `SW W=${fmtNum(c.w, 3)}, p=${fmtNum(c.p, 4)}, Skew=${rNum(c.skewness, 2) ?? '-'}, Kurt=${rNum(c.kurtosis, 2) ?? '-'}`,
      result: (c.passed ? 'pass' : 'warn') as 'pass' | 'warn',
    })),
    {
      id: 'route',
      label: 'Seçilen Test',
      condition: allNormal ? 'Pearson Korelasyonu' : 'Spearman Rho Korelasyonu',
      result: 'route',
    },
  ];

  if (allNormal) {
    return {
      design: 'relationship',
      recommendedTest: 'Pearson Çarpım Momentler Korelasyonu',
      alternativeTest: 'Spearman Sıra Farkları Korelasyonu',
      reasonTr: `Tüm değişkenler normallik/şekil ölçütlerini (SW p ≥ .05 veya N ≥ 30 & |çarpıklık/basıklık| ≤ 1.5) sağladığı için Pearson korelasyon analizi uygulandı.`,
      reasonEn: `All variables satisfied normality/shape criteria (SW p >= .05 or N >= 30 & |skew/kurtosis| <= 1.5), routing to Pearson correlation.`,
      decisionPath,
      output,
    };
  }

  return {
    design: 'relationship',
    recommendedTest: 'Spearman Sıra Farkları Korelasyonu (Rho)',
    alternativeTest: 'Pearson Korelasyonu',
    reasonTr: `Değişkenlerden en az biri normal dağılımdan ve ±1.5 çarpıklık/basıklık sınırından saptığı için sıra temelli Spearman Rho korelasyonu uygulandı.`,
    reasonEn: `At least one variable departed from normality and the ±1.5 skewness/kurtosis bounds, routing to rank-based Spearman Rho correlation.`,
    decisionPath,
    output,
  };
}

function runPredictionDesign(
  dataset: Dataset,
  dependent: string,
  secondary?: string,
  predictors?: string[],
): RecommendationResult {
  const rawPreds = predictors && predictors.length > 0 ? predictors : secondary ? [secondary] : [];
  const preds = Array.from(new Set(rawPreds)).filter((p) => p !== dependent);
  if (!dependent || preds.length === 0) {
    throw new StatInputError('NO_VARIABLES', 'Yordama modeli için hedef değişken ve en az 1 yordayıcı seçilmelidir.', 'Select a target and at least 1 predictor for a prediction model.');
  }

  const rawTargetVals = dataset.rows
    .map((r) => r[dependent])
    .filter((v) => v !== null && v !== undefined && v !== '');
  const uniqueTargetVals = new Set(rawTargetVals.map((v) => String(v)));
  const isBinary = uniqueTargetVals.size === 2;

  if (isBinary) {
    const normDs = normalizeNumericDataset(dataset, preds);
    const output = runLogisticRegression(normDs, dependent, preds);
    output.summary.recommendedVariant = 'logistic_regression';

    let maxVif = 1;
    if (preds.length >= 2) {
      const predMat = extractNumMatrix(normDs.rows, preds);
      if (predMat.length > preds.length + 2) {
        const dummyY = predMat.map((_, idx) => idx);
        const fit = olsFit(dummyY, predMat);
        maxVif = Math.max(1, ...fit.vif.filter((v): v is number => v !== null));
      }
    }
    const vifWarn = maxVif >= 5;
    const hlP = Number(output.summary.hlP ?? 1);
    const hlWarn = hlP < 0.05;

    output.assumptions = [
      {
        name: 'İkili Hedef Ölçeği',
        passed: true,
        statisticLabel: `2 Sınıf (${Array.from(uniqueTargetVals).join(' / ')})`,
        detail: 'Hedef değişken iki kategorili olduğu için İkili Lojistik Regresyon seçildi.',
      },
      {
        name: 'Çoklu Doğrusallık (Yordayıcı VIF)',
        passed: !vifWarn,
        statisticLabel: `Max VIF = ${fmtNum(maxVif, 2)}`,
        detail: vifWarn ? 'VIF ≥ 5: Yordayıcılar arasında yüksek çoklu doğrusallık uyarısı.' : 'VIF < 5: Çoklu doğrusallık sorunu yok.',
      },
      {
        name: 'Hosmer-Lemeshow Uyum İyiliği',
        passed: !hlWarn,
        statisticLabel: `χ² = ${fmtNum(Number(output.summary.hlChi2 ?? 0), 2)}`,
        pValue: rNum(hlP, 4),
        detail: hlWarn ? 'Model uyumu p < .05; etkileşim veya doğrusal olmayan terimler incelenmelidir.' : 'Model-veri uyumu yeterli (p ≥ .05).',
      },
    ];

    const decisionPath: DecisionNode[] = [
      {
        id: 'target_type',
        label: 'Hedef Değişken Türü',
        condition: `İkili / Binary (2 sınıf: ${Array.from(uniqueTargetVals).join(', ')})`,
        result: 'pass',
      },
      {
        id: 'vif',
        label: 'Çoklu Doğrusallık (VIF)',
        condition: `Max VIF = ${fmtNum(maxVif, 2)} (Eşik < 5.0)`,
        result: vifWarn ? 'warn' : 'pass',
      },
      {
        id: 'hl',
        label: 'Hosmer-Lemeshow Uyumu',
        condition: `p = ${fmtNum(hlP, 4)}`,
        result: hlWarn ? 'warn' : 'pass',
      },
      {
        id: 'route',
        label: 'Seçilen Model',
        condition: 'İkili Lojistik Regresyon',
        result: 'route',
      },
    ];

    return {
      design: 'prediction',
      recommendedTest: 'İkili Lojistik Regresyon',
      alternativeTest: 'ROC Eğrisi / Penalize Lojistik Regresyon',
      reasonTr: `Hedef değişken (${dependent}) iki sınıflı olduğundan İkili Lojistik Regresyon çalıştırıldı${vifWarn ? '; ancak yordayıcılarda VIF ≥ 5 çoklu doğrusallık uyarısı saptandı' : ''}.`,
      reasonEn: `Binary target (${dependent}) detected with 2 classes, routing to Binary Logistic Regression${vifWarn ? '; multicollinearity warning triggered (Max VIF >= 5)' : ''}.`,
      decisionPath,
      output,
    };
  }

  const normDs = normalizeNumericDataset(dataset, [dependent, ...preds]);
  const output = runLinearRegression(normDs, dependent, preds);
  output.summary.recommendedVariant = 'linear_regression';

  const maxVif = Number(output.summary.maxVif ?? 1);
  const dw = Number(output.summary.dw ?? 2);
  const vifWarn = maxVif >= 5;
  const dwWarn = dw < 1.5 || dw > 2.5;

  const warningsTr: string[] = [];
  const warningsEn: string[] = [];
  if (vifWarn) {
    warningsTr.push(`Max VIF = ${fmtNum(maxVif, 2)} ≥ 5 (çoklu doğrusallık uyarısı)`);
    warningsEn.push(`Max VIF = ${fmtNum(maxVif, 2)} >= 5 (multicollinearity warning)`);
  }
  if (dwWarn) {
    warningsTr.push(`Durbin-Watson = ${fmtNum(dw, 3)} ([1.5, 2.5] dışında otokorelasyon uyarısı)`);
    warningsEn.push(`Durbin-Watson = ${fmtNum(dw, 3)} (autocorrelation warning outside [1.5, 2.5])`);
  }

  const decisionPath: DecisionNode[] = [
    {
      id: 'target_type',
      label: 'Hedef Değişken Ölçeği',
      condition: `Sürekli / Ölçek (${uniqueTargetVals.size} benzersiz değer)`,
      result: 'pass',
    },
    {
      id: 'vif',
      label: 'Çoklu Doğrusallık (VIF)',
      condition: vifWarn
        ? `Uyarı: Max VIF = ${fmtNum(maxVif, 2)} ≥ 5.0 (Yüksek çoklu doğrusallık!)`
        : `Max VIF = ${fmtNum(maxVif, 2)} < 5.0`,
      result: vifWarn ? 'warn' : 'pass',
    },
    {
      id: 'dw',
      label: 'Artık Bağımsızlığı (Durbin-Watson)',
      condition: dwWarn
        ? `Uyarı: DW = ${fmtNum(dw, 3)} ([1.5 – 2.5] aralığı dışında otokorelasyon riski!)`
        : `DW = ${fmtNum(dw, 3)} (1.5 – 2.5 aralığında)`,
      result: dwWarn ? 'warn' : 'pass',
    },
    {
      id: 'route',
      label: 'Seçilen Model',
      condition: preds.length > 1 ? 'Çoklu Doğrusal Regresyon (OLS)' : 'Basit Doğrusal Regresyon (OLS)',
      result: 'route',
    },
  ];

  const recommendedTest = preds.length > 1 ? 'Çoklu Doğrusal Regresyon (OLS)' : 'Basit Doğrusal Regresyon (OLS)';

  return {
    design: 'prediction',
    recommendedTest,
    alternativeTest: vifWarn ? 'Ridge Regresyon / Değişken Eleme' : 'Spearman / Robust Regresyon',
    reasonTr:
      warningsTr.length > 0
        ? `Sürekli hedef değişken için ${recommendedTest} çalıştırıldı; tanısal uyarılar: ${warningsTr.join('; ')}.`
        : `Sürekli hedef değişken için ${recommendedTest} çalıştırıldı; VIF (${fmtNum(maxVif, 2)}) ve Durbin-Watson (${fmtNum(dw, 3)}) varsayımları karşılandı.`,
    reasonEn:
      warningsEn.length > 0
        ? `Executed ${recommendedTest} for continuous outcome; diagnostic warnings triggered: ${warningsEn.join('; ')}.`
        : `Executed ${recommendedTest} for continuous outcome; VIF (${fmtNum(maxVif, 2)}) and Durbin-Watson (${fmtNum(dw, 3)}) assumptions passed.`,
    decisionPath,
    output,
  };
}

/**
 * Deterministic methodological autopilot: inspects data structure, normality,
 * variance homogeneity, sphericity, VIF, and Durbin-Watson deterministically,
 * then executes and returns the recommended statistical analysis.
 */
export function recommendAndRun(
  dataset: Dataset,
  opts: {
    design: ResearchDesign;
    dependent: string;
    secondary?: string;
    predictors?: string[];
    repeatedVars?: string[];
  },
): RecommendationResult {
  switch (opts.design) {
    case 'compare_2_indep':
      return runCompare2Indep(dataset, opts.dependent, opts.secondary);
    case 'compare_k_indep':
      return runCompareKIndep(dataset, opts.dependent, opts.secondary);
    case 'compare_2_paired':
      return runCompare2Paired(dataset, opts.dependent, opts.secondary, opts.repeatedVars);
    case 'compare_k_paired':
      return runCompareKPaired(dataset, opts.dependent, opts.secondary, opts.predictors, opts.repeatedVars);
    case 'relationship':
      return runRelationshipDesign(dataset, opts.dependent, opts.secondary, opts.predictors);
    case 'prediction':
      return runPredictionDesign(dataset, opts.dependent, opts.secondary, opts.predictors);
  }
}

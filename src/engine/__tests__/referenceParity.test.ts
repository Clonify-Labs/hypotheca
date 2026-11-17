import fs from 'node:fs';
import { describe, expect, it } from 'vitest';
import { buildSeedDatasets } from '../../data/seedDatasets';
import {
  runBlandAltman,
  runCbSem,
  runCorrelation,
  runDescriptives,
  runEfa,
  runFriedman,
  runIndependentTTest,
  runKaplanMeier,
  runKruskalWallis,
  runLinearRegression,
  runLogisticRegression,
  runMannWhitneyU,
  runNormality,
  runOneWayAnova,
  runPairedTTest,
  runPlsSem,
  runPowerAnalysis,
  runProcessMacro,
  runRasch,
  runReliability,
  runRepeatedAnova,
  runRocCurve,
  runWilcoxon,
} from '../classical';

const benchmark = JSON.parse(
  fs.readFileSync(new URL('./fixtures/reference_benchmark.json', import.meta.url), 'utf8'),
);

const datasets = buildSeedDatasets();
const dsOgrenci = datasets.find((d) => d.id === 'ds-ogrenci-180')!;
const dsKlinik = datasets.find((d) => d.id === 'ds-klinik-150')!;

describe('Classical Statistical Reference Parity', () => {
  it('1. G*Power Independent t (a priori d=0.5, alpha=0.05, power=0.80, two-tailed)', () => {
    const bm = benchmark.tests.gpower_ind_t.result.output_parameters;
    const res = runPowerAnalysis({
      testType: 'indep_t',
      mode: 'apriori',
      effectSize: 0.5,
      alpha: 0.05,
      power: 0.8,
      tails: 2,
    });
    expect(res.summary.requiredN).toBe(bm.total_sample_size); // 128
    expect(res.summary.n1).toBe(bm.sample_size_group1); // 64
    expect(res.summary.df).toBe(bm.df); // 126
    expect(Number(res.summary.criticalValue)).toBeCloseTo(bm.critical_t, 5);
    expect(Number(res.summary.ncp)).toBeCloseTo(bm.noncentrality_param, 5);
    expect(Number(res.summary.actualPower)).toBeCloseTo(bm.actual_power, 5);
  });

  it('2. Normality Tests (Shapiro-Wilk, KS, Skewness & Kurtosis)', () => {
    const bmSw = benchmark.tests.normality_test.result.results[0].result;
    const bmSk = benchmark.tests.normality_test.result.results[2].result;
    const res = runNormality(dsOgrenci, ['OY_Ort', 'YZ_Ort', 'Basari_Son']);
    const normTable = res.tables[0];
    const skTable = res.tables[1];

    expect(Number(normTable.rows[0].sw_stat)).toBeCloseTo(bmSw[0].statistic, 3);
    expect(Number(normTable.rows[0].sw_p)).toBeCloseTo(bmSw[0].p_value, 3);
    expect(Number(skTable.rows[0].skewness)).toBeCloseTo(bmSk[0].skewness, 3);
    expect(Number(skTable.rows[0].kurtosis)).toBeCloseTo(bmSk[0].kurtosis, 3);
    expect(Number(normTable.rows[2].sw_stat)).toBeCloseTo(bmSw[2].statistic, 3);
    expect(Number(normTable.rows[2].sw_p)).toBeCloseTo(bmSw[2].p_value, 3);
  });

  it('3. Descriptives (SPSS ddof=1 moments, SE, quartiles)', () => {
    const bm = benchmark.tests.descriptive_table.result.results[0];
    const res = runDescriptives(dsOgrenci, ['OY_Ort', 'YZ_Ort', 'Basari_Son']);
    const row0 = res.tables[0].rows[0];
    expect(row0.n).toBe(bm.n);
    expect(Number(row0.mean)).toBeCloseTo(bm.mean, 3);
    expect(Number(row0.std)).toBeCloseTo(bm.std, 3);
    expect(Number(row0.std_error)).toBeCloseTo(bm.std_error, 3);
    expect(Number(row0.median)).toBeCloseTo(bm.median, 3);
    expect(Number(row0.variance)).toBeCloseTo(bm.var, 3);
    expect(Number(row0.q1)).toBeCloseTo(bm.q1, 3);
    expect(Number(row0.q3)).toBeCloseTo(bm.q3, 3);
  });

  it('4. Independent Samples t-Test (Levene, Student t, Welch t, Cohen d)', () => {
    const bm = benchmark.tests.independent_t_test.result;
    const bmStud = bm.t_test_results[0];
    const bmWelch = bm.t_test_results[1];
    const bmLev = bm.homogenity_results[0];
    const res = runIndependentTTest(dsOgrenci, 'OY_Ort', 'Cinsiyet', ['Erkek', 'Kadın']);

    expect(Number(res.summary.leveneF)).toBeCloseTo(bmLev.f, 3);
    expect(Number(res.summary.leveneP)).toBeCloseTo(bmLev.sig, 3);
    expect(Number(res.summary.studentT)).toBeCloseTo(bmStud.t, 4);
    expect(res.summary.studentDf).toBe(bmStud.df);
    expect(Number(res.summary.studentP)).toBeCloseTo(bmStud.sig, 4);
    expect(Number(res.summary.welchT)).toBeCloseTo(bmWelch.t, 4);
    expect(Number(res.summary.welchDf)).toBeCloseTo(bmWelch.df, 2);
    expect(Number(res.summary.welchP)).toBeCloseTo(bmWelch.sig, 4);
  });

  it('5. Paired Samples t-Test (Correlation, t, df, 95% CI, Cohen dz)', () => {
    const bm = benchmark.tests.paired_t_test.result;
    const res = runPairedTTest(dsOgrenci, 'Basari_On', 'Basari_Son');

    expect(Number(res.summary.correlation)).toBeCloseTo(bm.correlation_results.correlation, 4);
    expect(Number(res.summary.meanDiff)).toBeCloseTo(bm.t_test_results.mean, 4);
    expect(Number(res.summary.stdDiff)).toBeCloseTo(bm.t_test_results.std, 4);
    expect(Number(res.summary.t)).toBeCloseTo(bm.t_test_results.t, 4);
    expect(res.summary.df).toBe(bm.t_test_results.df);
    expect(Number(res.summary.ciLow)).toBeCloseTo(bm.t_test_results.ci_lower, 3);
    expect(Number(res.summary.ciHigh)).toBeCloseTo(bm.t_test_results.ci_upper, 3);
    expect(Math.abs(Number(res.summary.cohenDz))).toBeCloseTo(bm.effect_size_results[0].point_estimate, 4);
  });

  it('6. One-Way ANOVA (SS, MS, F, p, Welch F, df2)', () => {
    const bm = benchmark.tests.one_way_anova.result;
    const bmBetween = bm.anova_results[0].results[0];
    const bmWithin = bm.anova_results[0].results[1];
    const bmWelch = bm.welch_results[0];

    const res = runOneWayAnova(dsOgrenci, 'YZ_Ort', 'Fakulte', 'tukey');
    expect(Number(res.summary.ssBetween)).toBeCloseTo(bmBetween.sum_of_squares, 4);
    expect(Number(res.summary.msBetween)).toBeCloseTo(bmBetween.mean_square, 4);
    expect(Number(res.summary.f)).toBeCloseTo(bmBetween.f, 4);
    expect(Number(res.summary.p)).toBeCloseTo(bmBetween.sig, 4);
    expect(Number(res.summary.ssWithin)).toBeCloseTo(bmWithin.sum_of_squares, 3);
    expect(Number(res.summary.welchF)).toBeCloseTo(bmWelch.statistic, 4);
    expect(Number(res.summary.welchDf2)).toBeCloseTo(bmWelch.df2, 2);
    expect(Number(res.summary.welchP)).toBeCloseTo(bmWelch.sig, 4);
  });

  it('7. Mann-Whitney U (U, tie-corrected Z, p)', () => {
    const bm = benchmark.tests.mann_whitney_u.result.test_statistics[0];
    const res = runMannWhitneyU(dsOgrenci, 'OY_Ort', 'Cinsiyet');
    expect(Number(res.summary.u)).toBeCloseTo(bm.mann_whitney_u, 1);
    expect(Math.abs(Number(res.summary.z))).toBeCloseTo(Math.abs(bm.z), 3);
    expect(Number(res.summary.p)).toBeCloseTo(bm.sig, 3);
  });

  it('8. Kruskal-Wallis H (tie-corrected H, df, p)', () => {
    const bm = benchmark.tests.kruskal_wallis.result.test_statistics[0];
    const res = runKruskalWallis(dsOgrenci, 'YZ_Ort', 'Fakulte');
    expect(Number(res.summary.h)).toBeCloseTo(bm.kruskal_wallis_h, 4);
    expect(res.summary.df).toBe(bm.df);
    expect(Number(res.summary.p)).toBeCloseTo(bm.sig, 4);
  });

  it('9. Pearson Correlation Matrix', () => {
    const bm = benchmark.tests.correlation.result.correlation_results.pearson;
    const res = runCorrelation(dsOgrenci, ['OY_Ort', 'YZ_Ort', 'Basari_Son'], 'pearson');
    const pairRows = res.tables[1].rows;
    expect(Number(pairRows[0].r)).toBeCloseTo(bm[1].correlation, 4);
    expect(Number(pairRows[1].r)).toBeCloseTo(bm[2].correlation, 4);
  });

  it('10. Reliability + Item-Total CITC + SMC + Hotelling T2 + Tukey Nonadditivity + ICC', () => {
    const bm = benchmark.tests.reliability.result;
    const res = runReliability(dsOgrenci, ['OY1', 'OY2', 'OY3', 'OY4']);

    expect(Number(res.summary.cronbachAlpha)).toBeCloseTo(bm.reliability_statistics.cronbach_alpha, 5);
    expect(Number(res.summary.stdAlpha)).toBeCloseTo(bm.reliability_statistics.cronbach_alpha_standardized, 5);
    expect(Number(res.summary.hotellingT2)).toBeCloseTo(bm.hotellings_t2_test["Hotelling's T-Squared"], 3);
    expect(Number(res.summary.hotellingF)).toBeCloseTo(bm.hotellings_t2_test.F, 3);
    expect(Number(res.summary.hotellingP)).toBeCloseTo(bm.hotellings_t2_test['Sig.'], 3);
    expect(Number(res.summary.tukeyNonaddSS)).toBeCloseTo(bm.anova_with_tukey_test_nonadditivity_results[2].sum_sq, 2);
    expect(Number(res.summary.tukeyF)).toBeCloseTo(bm.anova_with_tukey_test_nonadditivity_results[2].f, 2);
    expect(Number(res.summary.tukeyP)).toBeCloseTo(bm.anova_with_tukey_test_nonadditivity_results[2]['sig'], 2);
    expect(Number(res.summary.iccSingle)).toBeCloseTo(bm.intraclass_corr_coefficient_results[0].Value, 2);
    expect(Number(res.summary.iccAvg)).toBeCloseTo(bm.intraclass_corr_coefficient_results[1].Value, 2);
  });

  it('11. Linear Regression + Durbin-Watson', () => {
    const bmSum = benchmark.tests.linear_regression.result.summary_table;
    const bmCoef = benchmark.tests.linear_regression.result.coefficient_table;
    const res = runLinearRegression(dsOgrenci, 'Basari_Son', ['YZ_Ort']);

    expect(Number(res.summary.r)).toBeCloseTo(bmSum.R, 5);
    expect(Number(res.summary.r2)).toBeCloseTo(bmSum['R Square'], 5);
    expect(Number(res.summary.adjR2)).toBeCloseTo(bmSum['Adjusted R Square'], 5);
    expect(Number(res.summary.see)).toBeCloseTo(bmSum['Std Error'], 3);
    expect(Number(res.summary.f)).toBeCloseTo(bmSum['F Change'], 3);
    expect(Number(res.summary.dw)).toBeCloseTo(bmSum['Durbin-Watson'], 4);
    const coefs = res.summary.coefficients as { b: number; t: number }[];
    expect(coefs[0].b).toBeCloseTo(bmCoef[0].B, 3);
    expect(coefs[1].b).toBeCloseTo(bmCoef[1].B, 3);
    expect(coefs[1].t).toBeCloseTo(bmCoef[1].t, 3);
  });

  it('12. Exploratory Factor Analysis (KMO, Bartlett, Eigenvalues, PCA+Varimax)', () => {
    const bm = benchmark.tests.efa.result;
    const items = ['OY1', 'OY2', 'OY3', 'OY4', 'YZ1', 'YZ2', 'YZ3', 'YZ4', 'TK1', 'TK2', 'TK3', 'TK4'];
    const res = runEfa(dsOgrenci, items, { rotation: 'varimax', extraction: 'pca' });

    expect(Number(res.summary.kmo)).toBeCloseTo(bm.kmo_and_barletts.kmo_model, 4);
    expect(Number(res.summary.bartlettChi2)).toBeCloseTo(bm.kmo_and_barletts['chi-square'], 1);
    expect(res.summary.bartlettDf).toBe(bm.kmo_and_barletts.df);

    const evals = res.summary.eigenvaluesTop as number[];
    expect(evals.length).toBe(3);
    expect(evals[0]).toBeCloseTo(bm.total_variance_explained.initial.total[0], 3);
    expect(evals[1]).toBeCloseTo(bm.total_variance_explained.initial.total[1], 3);
    expect(evals[2]).toBeCloseTo(bm.total_variance_explained.initial.total[2], 3);
    expect(Number(res.summary.cumVariancePct)).toBeCloseTo(bm.total_variance_explained.extraction.cumulative[2], 2);

    // Check rotated loading magnitudes for OY1..OY4 match (0.833, 0.850, 0.785, 0.803) in dominant factor
    const rot = res.summary.rotatedLoadings as number[][];
    const domFactorOy = rot[0].map(Math.abs).indexOf(Math.max(...rot[0].map(Math.abs)));
    expect(Math.abs(rot[0][domFactorOy])).toBeCloseTo(0.833, 2);
    expect(Math.abs(rot[1][domFactorOy])).toBeCloseTo(0.850, 2);
    expect(Math.abs(rot[2][domFactorOy])).toBeCloseTo(0.785, 2);
    expect(Math.abs(rot[3][domFactorOy])).toBeCloseTo(0.803, 2);
  });
});

describe('Extended Pure-TypeScript Psychometrics, Regression, Survival & SEM', () => {
  it('Repeated-Measures ANOVA & Friedman on Basari_On -> Basari_Ara -> Basari_Son', () => {
    const rm = runRepeatedAnova(dsOgrenci, ['Basari_On', 'Basari_Ara', 'Basari_Son']);
    expect(Number(rm.summary.f)).toBeGreaterThan(200);
    expect(Number(rm.summary.p)).toBeLessThan(0.001);

    const fr = runFriedman(dsOgrenci, ['Basari_On', 'Basari_Ara', 'Basari_Son']);
    expect(Number(fr.summary.chi2)).toBeGreaterThan(150);
    expect(Number(fr.summary.kendallW)).toBeGreaterThan(0.5);

    const wil = runWilcoxon(dsOgrenci, 'Basari_On', 'Basari_Son');
    expect(Number(wil.summary.p)).toBeLessThan(0.001);
  });

  it('CB-SEM / CFA, PLS-SEM & Rasch JMLE', () => {
    const sem = runCbSem(dsOgrenci, {
      factors: [
        { name: 'OY', indicators: ['OY1', 'OY2', 'OY3', 'OY4'] },
        { name: 'YZ', indicators: ['YZ1', 'YZ2', 'YZ3', 'YZ4'] },
      ],
      paths: [{ from: 'OY', to: 'YZ' }],
    });
    expect(Number(sem.summary.cfi)).toBeGreaterThan(0.85);
    expect(Number(sem.summary.rmsea)).toBeLessThan(0.15);

    const pls = runPlsSem(
      dsOgrenci,
      {
        factors: [
          { name: 'OY', indicators: ['OY1', 'OY2', 'OY3', 'OY4'] },
          { name: 'YZ', indicators: ['YZ1', 'YZ2', 'YZ3', 'YZ4'] },
          { name: 'TK', indicators: ['TK1', 'TK2', 'TK3', 'TK4'] },
        ],
        paths: [
          { from: 'OY', to: 'YZ' },
          { from: 'YZ', to: 'TK' },
        ],
      },
      100,
    );
    expect(pls.tables.length).toBe(4);
    expect((pls.summary.paths as unknown[]).length).toBe(2);

    const rasch = runRasch(dsOgrenci, ['OY1', 'OY2', 'OY3', 'OY4']);
    expect(Number(rasch.summary.personReliability)).toBeGreaterThan(0.5);
  });

  it('PROCESS Model 4 Mediation & Model 1 Moderation', () => {
    const proc4 = runProcessMacro(dsOgrenci, { model: 4, x: 'OY_Ort', mOrW: 'YZ_Ort', y: 'Basari_Son', bootstrapSamples: 300 });
    expect(proc4.summary.significantIndirect).toBe(true);
    expect(Number(proc4.summary.indirectEffect)).toBeGreaterThan(1);

    const proc1 = runProcessMacro(dsOgrenci, { model: 1, x: 'OY_Ort', mOrW: 'YZ_Ort', y: 'Basari_Son' });
    expect(proc1.tables.length).toBe(2);
  });

  it('Clinical Suite: Logistic Regression, ROC Curve, Bland-Altman, Kaplan-Meier', () => {
    const logit = runLogisticRegression(dsKlinik, 'Tani', ['Biyobelirtec_A', 'Yas', 'VKI']);
    expect(Number(logit.summary.accuracyPct)).toBeGreaterThan(60);

    const roc = runRocCurve(dsKlinik, 'Biyobelirtec_A', 'Tani');
    expect(Number(roc.summary.auc)).toBeGreaterThan(0.7);

    const ba = runBlandAltman(dsKlinik, 'Cihaz1_Olcum', 'Cihaz2_Olcum');
    expect(ba.summary.n).toBe(150);
    expect(Math.abs(Number(ba.summary.bias))).toBeLessThan(15);

    const km = runKaplanMeier(dsKlinik, 'Izlem_Ay', 'Olay_Durumu', 'Grup');
    expect(km.summary.groups).toBe(2);
    expect(Number(km.summary.logRankDf)).toBe(1);
  });
});

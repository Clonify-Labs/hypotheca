import { describe, expect, it } from 'vitest';
import { buildSeedDatasets } from '../../../data/seedDatasets';
import { runMetaAnalysis } from '../metaAnalysis';
import { runProcessModel14, runProcessModel6, runProcessModel7 } from '../advancedProcess';
import { runMeasurementInvariance, runSecondOrderCfa } from '../measurementInvariance';
import { runLinearMixedModel, runPropensityScoreMatching } from '../lmmAndPsm';
import { correlationBf10, jzsBf10, runBayesianAnova, runBayesianCorrelation, runBayesianTTest } from '../bayesianStats';
import { bfgsMinimize, makeRng } from '../shared';

const all = buildSeedDatasets();
const ogr = all.find((d) => d.id === 'ds-ogrenci-180')!;
const kli = all.find((d) => d.id === 'ds-klinik-150')!;
const meta = all.find((d) => d.id === 'ds-meta-10')!;

describe('Meta-analysis', () => {
  it('reproduces inverse-variance FE and DerSimonian-Laird RE by hand', () => {
    const res = runMetaAnalysis(meta, { studyCol: 'Calisma', effectCol: 'Etki_d', seCol: 'SE', yearCol: 'Yil', method: 'RE_DL' });
    const ys = meta.rows.map((r) => Number(r.Etki_d));
    const ses = meta.rows.map((r) => Number(r.SE));
    const w = ses.map((s) => 1 / (s * s));
    const sw = w.reduce((a, b) => a + b, 0);
    const fe = ys.reduce((s, y, i) => s + w[i] * y, 0) / sw;
    const Q = ys.reduce((s, y, i) => s + w[i] * (y - fe) ** 2, 0);
    const C = sw - w.reduce((s, v) => s + v * v, 0) / sw;
    const tau2 = Math.max(0, (Q - 9) / C);
    const wr = ses.map((s) => 1 / (s * s + tau2));
    const re = ys.reduce((s, y, i) => s + wr[i] * y, 0) / wr.reduce((a, b) => a + b, 0);

    expect(res.summary.k).toBe(10);
    expect(Number(res.summary.thetaFE)).toBeCloseTo(fe, 3);
    expect(Number(res.summary.Q)).toBeCloseTo(Q, 3);
    expect(Number(res.summary.tau2)).toBeCloseTo(tau2, 4);
    expect(Number(res.summary.pooled)).toBeCloseTo(re, 3);
    expect(Number(res.summary.I2)).toBeGreaterThanOrEqual(0);
    expect(Number(res.summary.eggerP)).toBeGreaterThan(0);
    expect(Number(res.summary.eggerP)).toBeLessThanOrEqual(1);
    expect(Number(res.summary.failSafeN)).toBeGreaterThan(10);
    expect(res.charts.map((c) => c.type)).toEqual(['forest', 'funnel']);
  });
});

describe('PROCESS models 6 / 7 / 14', () => {
  it('Model 6 serial indirect equals a1·d21·b2 and total = sum of specific effects', () => {
    const res = runProcessModel6(ogr, { x: 'OY_Ort', m1: 'YZ_Ort', m2: 'TK_Ort', y: 'Basari_Son', bootstrapSamples: 300 });
    const s = res.summary as Record<string, number>;
    expect(s.ind3).toBeCloseTo(s.a1 * s.d21 * s.b2, 3);
    expect(s.totalIndirect).toBeCloseTo(s.ind1 + s.ind2 + s.ind3, 3);
    // total effect c = c' + total indirect (OLS identity)
    expect(s.cTotal).toBeCloseTo(s.cPrime + s.totalIndirect, 3);
  });

  it('Model 7 and 14 return an index of moderated mediation with bootstrap CI', () => {
    for (const fn of [runProcessModel7, runProcessModel14]) {
      const res = fn(ogr, { x: 'OY_Ort', m: 'YZ_Ort', w: 'TK_Ort', y: 'Basari_Son', bootstrapSamples: 300 });
      const ci = res.summary.immCI as number[];
      expect(ci[0]).toBeLessThanOrEqual(Number(res.summary.indexOfModeratedMediation) + 1e-9);
      expect(ci[1]).toBeGreaterThanOrEqual(Number(res.summary.indexOfModeratedMediation) - 1e-9);
      expect((res.summary.conditionalIndirect as unknown[]).length).toBe(3);
    }
  });

  it('bootstrap is deterministic (seeded)', () => {
    const a = runProcessModel7(ogr, { x: 'OY_Ort', m: 'YZ_Ort', w: 'TK_Ort', y: 'Basari_Son', bootstrapSamples: 200 });
    const b = runProcessModel7(ogr, { x: 'OY_Ort', m: 'YZ_Ort', w: 'TK_Ort', y: 'Basari_Son', bootstrapSamples: 200 });
    expect(a.summary.immCI).toEqual(b.summary.immCI);
  });
});

describe('Measurement invariance & second-order CFA', () => {
  it('fits nested configural ⊂ metric ⊂ scalar models across Cinsiyet', () => {
    const res = runMeasurementInvariance(ogr, {
      groupVar: 'Cinsiyet',
      factors: [
        { name: 'OY', indicators: ['OY1', 'OY2', 'OY3', 'OY4'] },
        { name: 'YZ', indicators: ['YZ1', 'YZ2', 'YZ3', 'YZ4'] },
      ],
    });
    const s = res.summary as Record<string, { chi2: number; df: number; cfi: number; rmsea: number }>;
    expect(s.configural.df).toBe(38);
    expect(s.metric.df).toBe(44);
    expect(s.scalar.df).toBe(50);
    // Nested constraints can only worsen fit
    expect(s.metric.chi2).toBeGreaterThanOrEqual(s.configural.chi2 - 1e-3);
    expect(s.scalar.chi2).toBeGreaterThanOrEqual(s.metric.chi2 - 1e-3);
    expect(s.configural.cfi).toBeGreaterThan(0.9);
    expect(['configural', 'metric', 'scalar']).toContain(res.summary.highestLevel);
  });

  it('second-order CFA reaches the same fit as the correlated 3-factor model (just-identified top level)', () => {
    const res = runSecondOrderCfa(ogr, {
      secondOrderName: 'Akademik',
      firstOrderFactors: [
        { name: 'OY', indicators: ['OY1', 'OY2', 'OY3', 'OY4'] },
        { name: 'YZ', indicators: ['YZ1', 'YZ2', 'YZ3', 'YZ4'] },
        { name: 'TK', indicators: ['TK1', 'TK2', 'TK3', 'TK4'] },
      ],
    });
    expect(res.summary.df).toBe(51);
    expect(Number(res.summary.cfi)).toBeGreaterThan(0.9);
    const gammas = res.summary.gammas as number[];
    expect(gammas.every((g) => Math.abs(g) > 0.4 && Math.abs(g) < 1)).toBe(true);
  });
});

describe('LMM and PSM', () => {
  it('random-intercept LMM with Fakulte clusters', () => {
    const res = runLinearMixedModel(ogr, { outcome: 'Basari_Son', fixedPredictors: ['YZ_Ort'], clusterVar: 'Fakulte' });
    expect(res.summary.clusters).toBe(4);
    const icc = Number(res.summary.icc);
    expect(icc).toBeGreaterThanOrEqual(0);
    expect(icc).toBeLessThan(1);
    const coefs = res.summary.coefficients as { b: number }[];
    // With negligible clustering the GLS slope approaches the OLS slope (14.684)
    expect(coefs[1].b).toBeGreaterThan(12);
    expect(coefs[1].b).toBeLessThan(17);
  });

  it('LMM recovers a planted ICC on synthetic clustered data', () => {
    const rows: Record<string, number | string>[] = [];
    const rnd = makeRng(2024);
    const gauss = () => Math.sqrt(-2 * Math.log(rnd() + 1e-12)) * Math.cos(2 * Math.PI * rnd());
    for (let g = 0; g < 40; g++) {
      const u = gauss() * Math.sqrt(1); // σ²u = 1
      for (let i = 0; i < 25; i++) {
        const x = gauss();
        rows.push({ cl: `C${g}`, x, y: 2 + 0.5 * x + u + gauss() }); // σ²e = 1 → ICC = .5
      }
    }
    const ds = { ...ogr, id: 'syn', rows, columns: [] };
    const res = runLinearMixedModel(ds, { outcome: 'y', fixedPredictors: ['x'], clusterVar: 'cl' });
    expect(Number(res.summary.icc)).toBeGreaterThan(0.3);
    expect(Number(res.summary.icc)).toBeLessThan(0.7);
    expect((res.summary.coefficients as { b: number }[])[1].b).toBeCloseTo(0.5, 1);
  });

  it('PSM on clinical data keeps covariates balanced within caliper', () => {
    const res = runPropensityScoreMatching(kli, {
      treatmentVar: 'Grup',
      outcomeVar: 'Sistolik_KB',
      covariates: ['Yas', 'VKI'],
    });
    expect(Number(res.summary.matchedPairs)).toBeGreaterThan(20);
    // Groups are already near-balanced before matching here; matched SMDs must stay small
    expect(Number(res.summary.maxAbsSmdAfter)).toBeLessThan(0.2);
    expect(Number.isFinite(Number(res.summary.att))).toBe(true);
  });

  it('PSM removes planted confounding on synthetic data', () => {
    const rnd = makeRng(77);
    const gauss = () => Math.sqrt(-2 * Math.log(rnd() + 1e-12)) * Math.cos(2 * Math.PI * rnd());
    const rows: Record<string, number | string>[] = [];
    for (let i = 0; i < 600; i++) {
      const age = gauss();
      const treat = rnd() < 1 / (1 + Math.exp(-1.2 * age)) ? 1 : 0; // older units more likely treated
      rows.push({ t: treat, age, y: 3 * age + 2 * treat + gauss() }); // true effect = 2
    }
    const ds = { ...kli, id: 'syn-psm', rows, columns: [] };
    const res = runPropensityScoreMatching(ds, { treatmentVar: 't', outcomeVar: 'y', covariates: ['age'] });
    expect(Math.abs(Number(res.summary.naiveDiff) - 2)).toBeGreaterThan(1); // confounded
    expect(Number(res.summary.att)).toBeCloseTo(2, 0);
    expect(Number(res.summary.maxAbsSmdAfter)).toBeLessThan(Number(res.summary.maxAbsSmdBefore));
  });
});

describe('Bayesian (JZS) inference', () => {
  it('JZS t BF behaves correctly: BF01 > 1 at t = 0, monotone in |t|', () => {
    expect(jzsBf10(0, 50, 98, Math.SQRT1_2)).toBeLessThan(1);
    expect(jzsBf10(3, 50, 98, Math.SQRT1_2)).toBeGreaterThan(jzsBf10(2, 50, 98, Math.SQRT1_2));
    // Rouder et al. (2009) Table: one-sample-like t = 2.0, N = 100, r = 1 → BF01 ≈ 1.4 (weak evidence)
    const bf01 = 1 / jzsBf10(2.0, 100, 99, 1);
    expect(bf01).toBeGreaterThan(0.8);
    expect(bf01).toBeLessThan(2.2);
  });

  it('Bayesian t-test on OY_Ort ~ Cinsiyet favours H0 (frequentist p = .33)', () => {
    const res = runBayesianTTest(ogr, 'OY_Ort', 'Cinsiyet');
    expect(Number(res.summary.bf01)).toBeGreaterThan(3);
  });

  it('Bayesian ANOVA on YZ_Ort ~ Fakulte favours H0 (frequentist p = .81)', () => {
    const res = runBayesianAnova(ogr, 'YZ_Ort', 'Fakulte');
    expect(Number(res.summary.bf01)).toBeGreaterThan(3);
  });

  it('Bayesian correlation OY_Ort & Basari_Son gives extreme evidence (BF10 > 10)', () => {
    const res = runBayesianCorrelation(ogr, 'OY_Ort', 'Basari_Son');
    expect(Number(res.summary.bf10)).toBeGreaterThan(10);
    expect(Number(res.summary.r)).toBeCloseTo(0.791329, 4);
    // r = 0 should favour H0
    expect(correlationBf10(0, 100)).toBeLessThan(1);
  });
});

describe('BFGS helper', () => {
  it('minimizes the Rosenbrock function', () => {
    const r = bfgsMinimize((x) => (1 - x[0]) ** 2 + 100 * (x[1] - x[0] ** 2) ** 2, [-1.2, 1], 2000, 1e-8);
    expect(r.x[0]).toBeCloseTo(1, 2);
    expect(r.x[1]).toBeCloseTo(1, 2);
  });
});

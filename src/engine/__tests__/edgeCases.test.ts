import { describe, expect, it } from 'vitest';
import { inferColumns } from '../../data/seedDatasets';
import { DataRow, Dataset } from '../../types/interfaces';
import { StatInputError, clampP } from '../core/errors';
import { chi2Cdf, fCdf, normalInv, tCdf } from '../core/distributions';
import { SingularMatrixError, cholesky, invMatrixStrict } from '../core/linalg';
import {
  runCbSem,
  runChiSquare,
  runCorrelation,
  runDescriptives,
  runEfa,
  runFriedman,
  runIndependentTTest,
  runKruskalWallis,
  runLinearRegression,
  runLogisticRegression,
  runMannWhitneyU,
  runNormality,
  runOneSampleTTest,
  runOneWayAnova,
  runPairedTTest,
  runPartialCorrelation,
  runPowerAnalysis,
  runRasch,
  runReliability,
  runRepeatedAnova,
  runRocCurve,
  runWilcoxon,
} from '../classical';
import { runMetaAnalysis } from '../../modules/advanced-stats/metaAnalysis';
import { runBayesianCorrelation, runBayesianTTest } from '../../modules/advanced-stats/bayesianStats';
import { runLinearMixedModel, runPropensityScoreMatching } from '../../modules/advanced-stats/lmmAndPsm';
import { recommendAndRun } from '../../modules/autopilot/decisionEngine';
import { generateApaManuscriptSection } from '../../modules/publication/deterministicWriter';
import { cleanSurveyDataset } from '../../modules/survey-collab/surveyCleaner';
import { errorMessage } from '../../components/errorMessage';

function makeDataset(rows: DataRow[], name = 'edge_test.csv'): Dataset {
  return {
    id: 'ds-edge-test',
    name,
    columns: inferColumns(rows),
    rows,
    createdAt: '2026-11-17T10:00:00.000Z',
  };
}

function expectStatError(fn: () => unknown, expectedCode?: string): StatInputError {
  try {
    fn();
  } catch (err) {
    expect(err).toBeInstanceOf(StatInputError);
    const se = err as StatInputError;
    if (expectedCode) expect(se.code).toBe(expectedCode);
    expect(se.messageTr.length).toBeGreaterThan(0);
    expect(se.messageEn.length).toBeGreaterThan(0);
    return se;
  }
  throw new Error(`Expected StatInputError${expectedCode ? ` (${expectedCode})` : ''} but function succeeded`);
}

describe('1. StatInputError & localized errorMessage', () => {
  it('carries code and bilingual messages without em dashes', () => {
    const err = new StatInputError('ZERO_VARIANCE', 'Varyans sıfır.', 'Zero variance.');
    expect(err.code).toBe('ZERO_VARIANCE');
    expect(errorMessage(err, 'tr')).toBe('Varyans sıfır.');
    expect(errorMessage(err, 'en')).toBe('Zero variance.');
    expect(errorMessage(err, 'tr')).not.toContain('—');
  });

  it('falls back cleanly for generic Error and unknown values', () => {
    expect(errorMessage(new Error('Plain failure'), 'en')).toBe('Plain failure');
    expect(errorMessage('raw problem', 'tr')).toBe('raw problem');
  });
});

describe('2. Core linalg & distributions guards', () => {
  it('invMatrixStrict throws SINGULAR_MATRIX on collinear/zero rows', () => {
    expect(() =>
      invMatrixStrict([
        [1, 2],
        [2, 4],
      ]),
    ).toThrow(SingularMatrixError);
    expectStatError(
      () =>
        invMatrixStrict([
          [0, 0],
          [0, 0],
        ]),
      'SINGULAR_MATRIX',
    );
  });

  it('invMatrixStrict throws NON_FINITE_MATRIX on NaN/Infinity', () => {
    expectStatError(
      () =>
        invMatrixStrict([
          [1, NaN],
          [0, 1],
        ]),
      'NON_FINITE_MATRIX',
    );
  });

  it('cholesky throws NOT_POSITIVE_DEFINITE on indefinite matrix', () => {
    expectStatError(
      () =>
        cholesky([
          [1, 2],
          [2, 1],
        ]),
      'NOT_POSITIVE_DEFINITE',
    );
  });

  it('clampP bounds probabilities to [0, 1] and preserves NaN', () => {
    expect(clampP(-0.2)).toBe(0);
    expect(clampP(1.4)).toBe(1);
    expect(clampP(-Infinity)).toBe(0);
    expect(clampP(Infinity)).toBe(1);
    expect(Number.isNaN(clampP(NaN))).toBe(true);
  });

  it('distribution CDF and inverse functions handle extreme bounds safely', () => {
    expect(Number.isNaN(tCdf(1, 0))).toBe(true);
    expect(tCdf(Infinity, 10)).toBe(1);
    expect(tCdf(-Infinity, 10)).toBe(0);
    expect(fCdf(Infinity, 2, 10)).toBe(1);
    expect(fCdf(-1, 2, 10)).toBe(0);
    expect(chi2Cdf(Infinity, 3)).toBe(1);
    expect(normalInv(0)).toBe(-Infinity);
    expect(normalInv(1)).toBe(Infinity);
    expect(normalInv(0.5)).toBe(0);
  });
});

describe('3. Descriptive, normality, correlation & chi-square edge cases', () => {
  it('runDescriptives throws NO_VARIABLES when no numeric variables are selected or inferred', () => {
    expectStatError(() => runDescriptives(makeDataset([{ txt: 'abc' }, { txt: 'def' }]), []), 'NO_VARIABLES');
  });

  it('runDescriptives rejects all-missing and non-numeric columns while dropping stray missing cells', () => {
    const ds = makeDataset([
      { x: 10, empty: null, messy: 'abc' },
      { x: null, empty: '', messy: Infinity },
      { x: 20, empty: undefined, messy: NaN } as unknown as DataRow,
    ]);
    expectStatError(() => runDescriptives(ds, ['empty']), 'ALL_MISSING');
    expectStatError(() => runDescriptives(ds, ['messy']), 'ALL_MISSING');
    const ok = runDescriptives(ds, ['x']);
    expect(ok.tables[0].rows[0].n).toBe(2);
    expect(ok.tables[0].rows[0].mean).toBe(15);
  });

  it('runNormality rejects n < 3 and constant columns', () => {
    expectStatError(() => runNormality(makeDataset([{ x: 1 }, { x: 2 }]), ['x']), 'INSUFFICIENT_N');
    expectStatError(() => runNormality(makeDataset(Array.from({ length: 10 }, () => ({ x: 5 }))), ['x']), 'INSUFFICIENT_N');
  });

  it('runNormality handles n > 5000 without throwing or emitting NaN prose', () => {
    const n5001 = makeDataset(Array.from({ length: 5001 }, (_, i) => ({ x: (i % 97) + 0.5 * (i % 7) })));
    const out = runNormality(n5001, ['x']);
    expect(out.tables[0].rows[0].sw_stat).toBeNull();
    expect(out.narrativeTr).not.toMatch(/\bNaN\b|\bnull\b|\bInfinity\b/);
  });

  it('runCorrelation rejects <2 variables, duplicate variables, n < 3 and constant columns', () => {
    const ds = makeDataset([
      { a: 1, b: 2, c: 5 },
      { a: 2, b: 4, c: 5 },
      { a: 3, b: 6, c: 5 },
      { a: 4, b: 7, c: 5 },
    ]);
    expectStatError(() => runCorrelation(ds, ['a']), 'NO_VARIABLES');
    expectStatError(() => runCorrelation(ds, ['a', 'a']), 'NO_VARIABLES');
    expectStatError(() => runCorrelation(makeDataset([{ a: 1, b: 2 }, { a: 2, b: 3 }]), ['a', 'b']), 'INSUFFICIENT_N');
    expectStatError(() => runCorrelation(ds, ['a', 'c']), 'ZERO_VARIANCE');
  });

  it('runPartialCorrelation rejects overlapping or constant control variable', () => {
    const ds = makeDataset([
      { a: 1, b: 2, c: 5 },
      { a: 2, b: 4, c: 5 },
      { a: 3, b: 6, c: 5 },
      { a: 4, b: 7, c: 5 },
      { a: 5, b: 8, c: 5 },
    ]);
    expectStatError(() => runPartialCorrelation(ds, 'a', 'b', ['a']), 'INVALID_VARIABLES');
    expectStatError(() => runPartialCorrelation(ds, 'a', 'b', ['c']), 'ZERO_VARIANCE');
  });

  it('runChiSquare rejects identical variables, empty pairs and single-category dimensions', () => {
    const single = makeDataset([
      { r: 'A', c: 'X' },
      { r: 'A', c: 'Y' },
    ]);
    expectStatError(() => runChiSquare(single, 'r', 'r'), 'INVALID_VARIABLES');
    expectStatError(() => runChiSquare(single, 'r', 'c'), 'SINGLE_CATEGORY');
    expectStatError(() => runChiSquare(makeDataset([{ r: null, c: 'X' }]), 'r', 'c'), 'EMPTY_DATA');
  });

  it('runChiSquare flags sparse 2x2 tables with zero cells and keeps Fisher p in [0, 1]', () => {
    const sparse = makeDataset([
      { r: 'A', c: 'X' },
      { r: 'A', c: 'X' },
      { r: 'A', c: 'X' },
      { r: 'A', c: 'Y' },
      { r: 'B', c: 'Y' },
      { r: 'B', c: 'Y' },
    ]);
    const res = runChiSquare(sparse, 'r', 'c');
    expect(Number(res.summary.p)).toBeGreaterThanOrEqual(0);
    expect(Number(res.summary.p)).toBeLessThanOrEqual(1);
    expect(Number(res.summary.fisherP)).toBeGreaterThanOrEqual(0);
    expect(Number(res.summary.fisherP)).toBeLessThanOrEqual(1);
    expect((res.tables[1].footnotes ?? []).join(' ')).toMatch(/Fisher|0 olan hücre/);
  });
});

describe('4. Parametric & nonparametric hypothesis test edge cases', () => {
  it('runOneSampleTTest rejects n < 2, constant variable and NaN test value', () => {
    expectStatError(() => runOneSampleTTest(makeDataset([{ x: 3 }]), 'x', 0), 'INSUFFICIENT_N');
    expectStatError(() => runOneSampleTTest(makeDataset([{ x: 3 }, { x: 3 }, { x: 3 }]), 'x', 3), 'ZERO_VARIANCE');
    expectStatError(() => runOneSampleTTest(makeDataset([{ x: 1 }, { x: 2 }, { x: 3 }]), 'x', NaN), 'INVALID_PARAMETER');
  });

  it('runIndependentTTest & runMannWhitneyU reject single group and >2 groups', () => {
    const oneGroup = makeDataset([
      { y: 1, g: 'A' },
      { y: 2, g: 'A' },
      { y: 3, g: 'A' },
    ]);
    expectStatError(() => runIndependentTTest(oneGroup, 'y', 'g'), 'SINGLE_GROUP');
    expectStatError(() => runMannWhitneyU(oneGroup, 'y', 'g'), 'SINGLE_GROUP');

    const threeGroups = makeDataset([
      { y: 1, g: 'A' },
      { y: 2, g: 'A' },
      { y: 3, g: 'B' },
      { y: 4, g: 'B' },
      { y: 5, g: 'C' },
      { y: 6, g: 'C' },
    ]);
    expectStatError(() => runIndependentTTest(threeGroups, 'y', 'g'), 'TOO_MANY_GROUPS');
    expectStatError(() => runMannWhitneyU(threeGroups, 'y', 'g'), 'TOO_MANY_GROUPS');
  });

  it('runIndependentTTest rejects group n < 2 and constant within-group values', () => {
    const tinyGroup = makeDataset([
      { y: 1, g: 'A' },
      { y: 3, g: 'B' },
      { y: 4, g: 'B' },
    ]);
    expectStatError(() => runIndependentTTest(tinyGroup, 'y', 'g'), 'SINGLE_GROUP');

    const zeroVarWithin = makeDataset([
      { y: 1, g: 'A' },
      { y: 1, g: 'A' },
      { y: 2, g: 'B' },
      { y: 2, g: 'B' },
    ]);
    expectStatError(() => runIndependentTTest(zeroVarWithin, 'y', 'g'), 'ZERO_VARIANCE');
  });

  it('runPairedTTest & runWilcoxon reject identical vars, <2 pairs and constant differences', () => {
    const ds = makeDataset([
      { t1: 10, t2: 12 },
      { t1: 11, t2: 13 },
      { t1: 12, t2: 14 },
    ]);
    expectStatError(() => runPairedTTest(ds, 't1', 't1'), 'INVALID_VARIABLES');
    expectStatError(() => runPairedTTest(ds, 't1', 't2'), 'ZERO_VARIANCE');
    expectStatError(() => runWilcoxon(ds, 't1', 't1'), 'INVALID_VARIABLES');
    expectStatError(() => runPairedTTest(makeDataset([{ t1: 1, t2: 2 }, { t1: 1, t2: null }]), 't1', 't2'), 'INSUFFICIENT_N');
  });

  it('runOneWayAnova & runKruskalWallis reject <2 groups and zero variance', () => {
    const oneGroup = makeDataset([
      { y: 1, f: 'G1' },
      { y: 2, f: 'G1' },
      { y: 3, f: 'G1' },
    ]);
    expectStatError(() => runOneWayAnova(oneGroup, 'y', 'f'), 'SINGLE_GROUP');
    expectStatError(() => runKruskalWallis(oneGroup, 'y', 'f'), 'SINGLE_GROUP');

    const constAnova = makeDataset([
      { y: 5, f: 'A' },
      { y: 5, f: 'A' },
      { y: 5, f: 'B' },
      { y: 5, f: 'B' },
    ]);
    expectStatError(() => runOneWayAnova(constAnova, 'y', 'f'), 'ZERO_VARIANCE');
  });

  it('runRepeatedAnova & runFriedman reject <2 occasions and duplicates', () => {
    const ds = makeDataset([
      { m1: 2, m2: 3 },
      { m1: 4, m2: 5 },
      { m1: 6, m2: 7 },
    ]);
    expectStatError(() => runRepeatedAnova(ds, ['m1']), 'NO_VARIABLES');
    expectStatError(() => runRepeatedAnova(ds, ['m1', 'm1']), 'DUPLICATE_VARIABLES');
    expectStatError(() => runFriedman(ds, ['m1']), 'NO_VARIABLES');
  });
});

describe('5. Psychometrics, regression & power edge cases', () => {
  it('runReliability rejects <2 items, duplicates and constant items', () => {
    const ds = makeDataset([
      { i1: 1, i2: 2, i3: 3, i4: 5 },
      { i1: 2, i2: 3, i3: 4, i4: 5 },
      { i1: 3, i2: 4, i3: 5, i4: 5 },
      { i1: 4, i2: 5, i3: 2, i4: 5 },
    ]);
    expectStatError(() => runReliability(ds, ['i1']), 'TOO_FEW_ITEMS');
    expectStatError(() => runReliability(ds, ['i1', 'i1']), 'DUPLICATE_VARIABLES');
    expectStatError(() => runReliability(ds, ['i1', 'i4']), 'ZERO_VARIANCE');
  });

  it('runEfa, runRasch & runCbSem reject insufficient items/indicators', () => {
    const ds = makeDataset([
      { i1: 1, i2: 2, i3: 3 },
      { i1: 2, i2: 3, i3: 4 },
      { i1: 3, i2: 4, i3: 5 },
      { i1: 4, i2: 5, i3: 2 },
    ]);
    expectStatError(() => runEfa(ds, ['i1', 'i2']), 'TOO_FEW_ITEMS');
    expectStatError(() => runRasch(ds, ['i1', 'i2']), 'TOO_FEW_ITEMS');
    expectStatError(() => runCbSem(ds, { factors: [{ name: 'F1', indicators: ['i1'] }] }), 'TOO_FEW_ITEMS');
  });

  it('runLinearRegression rejects empty predictors, outcome overlap and n <= p + 1', () => {
    const ds = makeDataset([
      { y: 1, x1: 1, x2: 2, x3: 4 },
      { y: 3, x1: 2, x2: 5, x3: 1 },
      { y: 5, x1: 3, x2: 6, x3: 5 },
      { y: 7, x1: 4, x2: 7, x3: 2 },
    ]);
    expectStatError(() => runLinearRegression(ds, 'y', []), 'NO_VARIABLES');
    expectStatError(() => runLinearRegression(ds, 'y', ['y', 'x1']), 'INVALID_VARIABLES');
    expectStatError(() => runLinearRegression(ds, 'y', ['x1', 'x2', 'x3']), 'INSUFFICIENT_N');
  });

  it('runLinearRegression throws SINGULAR_MATRIX on perfectly collinear predictors', () => {
    const ds = makeDataset([
      { y: 1, x1: 1, x2: 2 },
      { y: 3, x1: 2, x2: 4 },
      { y: 5, x1: 3, x2: 6 },
      { y: 7, x1: 4, x2: 8 },
      { y: 9, x1: 5, x2: 10 },
    ]);
    expectStatError(() => runLinearRegression(ds, 'y', ['x1', 'x2']), 'SINGULAR_MATRIX');
  });

  it('runLogisticRegression & runRocCurve reject single-class and >2-class outcomes', () => {
    const oneClass = makeDataset([
      { grp: 'Yes', s: 1 },
      { grp: 'Yes', s: 2 },
      { grp: 'Yes', s: 3 },
      { grp: 'Yes', s: 4 },
    ]);
    expectStatError(() => runLogisticRegression(oneClass, 'grp', ['s']), 'SINGLE_CATEGORY');
    expectStatError(() => runRocCurve(oneClass, 's', 'grp'), 'SINGLE_CATEGORY');

    const threeClass = makeDataset([
      { grp: 'A', s: 1 },
      { grp: 'B', s: 2 },
      { grp: 'C', s: 3 },
      { grp: 'A', s: 4 },
      { grp: 'B', s: 5 },
      { grp: 'C', s: 6 },
    ]);
    expectStatError(() => runLogisticRegression(threeClass, 'grp', ['s']), 'TOO_MANY_GROUPS');
    expectStatError(() => runRocCurve(threeClass, 's', 'grp'), 'TOO_MANY_GROUPS');
  });

  it('runPowerAnalysis validates alpha, power and effectSize bounds', () => {
    expectStatError(() => runPowerAnalysis({ testType: 'indep_t', alpha: 0, power: 0.8, effectSize: 0.5 }), 'INVALID_PARAMETER');
    expectStatError(() => runPowerAnalysis({ testType: 'indep_t', alpha: 0.05, power: 1, effectSize: 0.5 }), 'INVALID_PARAMETER');
    expectStatError(() => runPowerAnalysis({ testType: 'indep_t', alpha: 0.05, power: 0.8, effectSize: -0.2 }), 'INVALID_PARAMETER');
  });
});

describe('6. Advanced stats, autopilot, publication & survey cleaner edge cases', () => {
  it('runMetaAnalysis rejects k < 3 studies and SE <= 0', () => {
    const oneStudy = makeDataset([{ s: 'S1', d: 0.4, se: 0.1 }]);
    expectStatError(() => runMetaAnalysis(oneStudy, { studyCol: 's', effectCol: 'd', seCol: 'se' }), 'INSUFFICIENT_STUDIES');

    const badSe = makeDataset([
      { s: 'S1', d: 0.4, se: 0 },
      { s: 'S2', d: 0.5, se: -0.1 },
      { s: 'S3', d: 0.6, se: 0.2 },
    ]);
    expectStatError(() => runMetaAnalysis(badSe, { studyCol: 's', effectCol: 'd', seCol: 'se' }), 'INSUFFICIENT_STUDIES');
  });

  it('Bayesian t-test and correlation validate prior scale, N and variance', () => {
    const ds = makeDataset([
      { y: 1, g: 'A', x: 5 },
      { y: 2, g: 'A', x: 5 },
      { y: 3, g: 'B', x: 5 },
      { y: 4, g: 'B', x: 5 },
      { y: 5, g: 'B', x: 5 },
    ]);
    expectStatError(() => runBayesianTTest(ds, 'y', 'g', 0), 'INVALID_PARAMETER');
    expectStatError(() => runBayesianCorrelation(ds, 'y', 'x'), 'ZERO_VARIANCE');
    expectStatError(() => runBayesianCorrelation(makeDataset([{ y: 1, x: 2 }, { y: 2, x: 4 }]), 'y', 'x'), 'INSUFFICIENT_N');
  });

  it('runLinearMixedModel rejects single cluster and duplicate variable roles', () => {
    const singleCluster = makeDataset(
      Array.from({ length: 8 }, (_, i) => ({ y: i + 1, x: i * 2, c: 'OnlyOne' })),
    );
    expectStatError(() => runLinearMixedModel(singleCluster, { outcome: 'y', fixedPredictors: ['x'], clusterVar: 'c' }), 'SINGLE_CLUSTER');
    expectStatError(() => runLinearMixedModel(singleCluster, { outcome: 'y', fixedPredictors: ['y'], clusterVar: 'c' }), 'DUPLICATE_VARIABLES');
  });

  it('runPropensityScoreMatching rejects single treatment level and non-positive caliper', () => {
    const singleTreat = makeDataset(
      Array.from({ length: 8 }, (_, i) => ({ y: i + 1, x: i * 2, tr: 'Treated' })),
    );
    expectStatError(() => runPropensityScoreMatching(singleTreat, { treatmentVar: 'tr', outcomeVar: 'y', covariates: ['x'], caliper: 0 }), 'INVALID_PARAMETER');
    expectStatError(() => runPropensityScoreMatching(singleTreat, { treatmentVar: 'tr', outcomeVar: 'y', covariates: ['x'] }), 'SINGLE_GROUP');
  });

  it('recommendAndRun rejects >2 groups in compare_2_indep and constant outcome', () => {
    const ds = makeDataset([
      { y: 1, g: 'A', c: 5 },
      { y: 2, g: 'A', c: 5 },
      { y: 3, g: 'B', c: 5 },
      { y: 4, g: 'B', c: 5 },
      { y: 5, g: 'C', c: 5 },
      { y: 6, g: 'C', c: 5 },
    ]);
    expectStatError(() => recommendAndRun(ds, { design: 'compare_2_indep', dependent: 'y', secondary: 'g' }), 'TOO_MANY_GROUPS');
    expectStatError(() => recommendAndRun(ds, { design: 'compare_k_indep', dependent: 'c', secondary: 'g' }), 'ZERO_VARIANCE');
  });

  it('generateApaManuscriptSection reports CLT violation honestly and merges project metadata without NaN', () => {
    const ds = makeDataset([
      { x: 1, y: 2 },
      { x: 2, y: 4 },
    ]);
    const analysis = {
      id: 'a-clt',
      analysisType: 'independent_t_test',
      title: 'Bağımsız Örneklem t-Testi',
      createdAt: '2026-11-17T10:00:00.000Z',
      params: { dependent: 'x', groupVar: 'y' },
      summary: { dependent: 'x', t: 2.5, df: 58, p: 0.015, cohenD: 0.65 },
      tables: [],
      charts: [],
      assumptions: [
        {
          name: 'Shapiro-Wilk Normallik',
          passed: true,
          statisticLabel: 'W = 0.91, p = 0.012 (n >= 30 CLT)',
          pValue: 0.012,
          detail: 'n >= 30 olduğu için CLT kapsamında kabul edildi.',
        },
      ],
    };
    const msTr = generateApaManuscriptSection([analysis], ds, 'tr', {
      title: 'Öz-Yeterlik Çalışması',
      researcher: 'A. Yılmaz',
      question: 'Gruplar farklılaşıyor mu?',
      hypotheses: ['H1: İki grup arasında anlamlı fark vardır.'],
    });
    expect(msTr.methodsText).toContain('Merkezi Limit Teoremi');
    expect(msTr.methodsText).not.toContain('tüm temel istatistiksel varsayımlar sağlanmış');
    expect(msTr.fullMarkdown).toContain('# Öz-Yeterlik Çalışması');
    expect(msTr.fullMarkdown).toContain('A. Yılmaz');
    expect(msTr.fullMarkdown).not.toMatch(/\bNaN\b|\bundefined\b|\bInfinity\b/);

    const msEn = generateApaManuscriptSection([analysis], ds, 'en');
    expect(msEn.methodsText).toContain('central limit theorem');
    expect(msEn.fullMarkdown).not.toMatch(/\bNaN\b|\bundefined\b|\bInfinity\b/);
  });

  it('cleanSurveyDataset validates empty datasets and invalid Likert bounds', () => {
    const emptyDs: Dataset = { id: 'empty', name: 'empty.csv', columns: [], rows: [], createdAt: '' };
    expectStatError(() => cleanSurveyDataset(emptyDs), 'EMPTY_DATA');

    const okDs = makeDataset([{ q1: 'Katılıyorum' }, { q1: 'Katılmıyorum' }]);
    expectStatError(() => cleanSurveyDataset(okDs, { likertMin: 5, likertMax: 1 }), 'INVALID_PARAMETER');
    expectStatError(() => cleanSurveyDataset(okDs, { likertMin: 3, likertMax: 3 }), 'INVALID_PARAMETER');
  });
});

// @vitest-environment jsdom
import React from 'react';
import { flushSync } from 'react-dom';
import { createRoot } from 'react-dom/client';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import { buildSeedDatasets } from '../../../data/seedDatasets';
import { AnalysisOutput, DataRow, Dataset } from '../../../types/interfaces';
import { AutopilotPanel } from '../AutopilotPanel';
import { scanDatasetAssumptions } from '../assumptionScanner';
import { recommendAndRun, ResearchDesign } from '../decisionEngine';

const seedDatasets = buildSeedDatasets();
const dsOgrenci = seedDatasets[0];
const dsKlinik = seedDatasets[1];

function makeDataset(name: string, rows: DataRow[]): Dataset {
  const keys = rows.length ? Object.keys(rows[0]) : [];
  return {
    id: `test-${name}`,
    name,
    columns: keys.map((k) => {
      const firstNonNull = rows.find((r) => r[k] !== null && r[k] !== undefined)?.[k];
      const isNum = typeof firstNonNull === 'number';
      const uniq = new Set(rows.map((r) => String(r[k] ?? ''))).size;
      return {
        name: k,
        label: k,
        valueType: isNum ? 'numeric' : 'categorical',
        scale: isNum ? 'scale' : 'nominal',
        decimals: 2,
        uniqueCount: uniq,
        missingCount: rows.filter((r) => r[k] === null || r[k] === undefined || r[k] === '').length,
      };
    }),
    rows,
    createdAt: '2026-11-16T21:00:00.000Z',
  };
}

describe('Module 1: Autopilot Assumption Scanner', () => {
  it('scans ds-ogrenci-180 accurately and detects 5 missing values in Gelir_TL', () => {
    const report = scanDatasetAssumptions(dsOgrenci);

    expect(report.datasetName).toBe(dsOgrenci.name);
    expect(report.totalRows).toBe(180);
    expect(report.missingPattern.totalMissing).toBe(5);
    expect(report.missingPattern.listwiseComplete).toBe(175);
    expect(report.missingPattern.littleMcarNote.length).toBeGreaterThan(10);
    expect(['none', 'listwise', 'median_or_pmm']).toContain(report.recommendedImputation);

    const gelir = report.variables.find((v) => v.variable === 'Gelir_TL');
    expect(gelir).toBeDefined();
    expect(gelir!.n).toBe(175);
    expect(gelir!.missing).toBe(5);
    expect(gelir!.mean).not.toBeNull();
    expect(gelir!.std).not.toBeNull();
    expect(gelir!.shapiroW).toBeGreaterThan(0.8);
    expect(gelir!.shapiroW).toBeLessThanOrEqual(1);
    expect(gelir!.shapiroP).toBeGreaterThanOrEqual(0);
    expect(gelir!.shapiroP).toBeLessThanOrEqual(1);
    expect(gelir!.skewness).not.toBeNull();
    expect(gelir!.kurtosis).not.toBeNull();

    const oy = report.variables.find((v) => v.variable === 'OY_Ort');
    expect(oy).toBeDefined();
    expect(oy!.n).toBe(180);
    expect(oy!.missing).toBe(0);
    expect(oy!.normalityOk).toBe(true);
  });

  it('detects zero missingness, high missingness PMM recommendation, and IQR/Z outliers', () => {
    const cleanRows: DataRow[] = Array.from({ length: 40 }, (_, i) => ({
      X: 50 + ((i * 7) % 15) - 7,
      Y: 100 + ((i * 5) % 11) - 5,
    }));
    const cleanReport = scanDatasetAssumptions(makeDataset('clean', cleanRows));
    expect(cleanReport.missingPattern.totalMissing).toBe(0);
    expect(cleanReport.recommendedImputation).toBe('none');

    const dirtyRows: DataRow[] = Array.from({ length: 40 }, (_, i) => ({
      Score: i === 0 ? 500 : i < 8 ? null : 50 + (i % 6),
    }));
    const dirtyReport = scanDatasetAssumptions(makeDataset('dirty', dirtyRows), ['Score']);
    const scoreScan = dirtyReport.variables[0];
    expect(scoreScan.missing).toBe(7);
    expect(scoreScan.n).toBe(33);
    expect(scoreScan.iqrOutlierCount).toBeGreaterThanOrEqual(1);
    expect(scoreScan.zOutlierCount).toBeGreaterThanOrEqual(1);
    expect(dirtyReport.recommendedImputation).toBe('median_or_pmm');
  });
});

describe('Module 1: Autopilot Decision Engine (All 6 Research Designs)', () => {
  it('runs all 6 research designs on ds-ogrenci-180 with non-empty decisionPath and valid AnalysisOutput', () => {
    const cases: {
      design: ResearchDesign;
      dependent: string;
      secondary?: string;
      predictors?: string[];
      repeatedVars?: string[];
    }[] = [
      { design: 'compare_2_indep', dependent: 'OY_Ort', secondary: 'Cinsiyet' },
      { design: 'compare_k_indep', dependent: 'YZ_Ort', secondary: 'Fakulte' },
      { design: 'compare_2_paired', dependent: 'Basari_On', secondary: 'Basari_Son' },
      {
        design: 'compare_k_paired',
        dependent: 'Basari_On',
        repeatedVars: ['Basari_On', 'Basari_Ara', 'Basari_Son'],
      },
      { design: 'relationship', dependent: 'OY_Ort', secondary: 'Basari_Son' },
      { design: 'prediction', dependent: 'Basari_Son', predictors: ['OY_Ort', 'YZ_Ort', 'TK_Ort'] },
    ];

    for (const c of cases) {
      const res = recommendAndRun(dsOgrenci, c);
      expect(res.design).toBe(c.design);
      expect(res.recommendedTest.length).toBeGreaterThan(3);
      expect(res.alternativeTest.length).toBeGreaterThan(3);
      expect(res.reasonTr.length).toBeGreaterThan(10);
      expect(res.reasonEn.length).toBeGreaterThan(10);
      expect(res.decisionPath.length).toBeGreaterThanOrEqual(2);
      expect(res.decisionPath[res.decisionPath.length - 1].result).toBe('route');
      expect(res.output.id).toBeTruthy();
      expect(res.output.tables.length).toBeGreaterThanOrEqual(1);
      expect(res.output.assumptions?.length).toBeGreaterThanOrEqual(1);
    }
  });

  it('routes compare_2_indep to Welch t (highlighted) when Levene p < 0.05 and to Mann-Whitney U when small non-normal', () => {
    // Unequal variances (N=35 per group, SD ~ 1 vs SD ~ 18 -> Levene p < 0.05)
    const welchRows: DataRow[] = [
      ...Array.from({ length: 35 }, (_, i) => ({
        Grp: 'A',
        Val: 50 + Math.sin(i) * 1.2,
      })),
      ...Array.from({ length: 35 }, (_, i) => ({
        Grp: 'B',
        Val: 60 + ((i % 2 === 0 ? 1 : -1) * (i + 1) * 1.1),
      })),
    ];
    const welchRes = recommendAndRun(makeDataset('welch', welchRows), {
      design: 'compare_2_indep',
      dependent: 'Val',
      secondary: 'Grp',
    });
    expect(welchRes.output.analysisType).toBe('independent_t');
    expect(welchRes.output.summary.recommendedVariant).toBe('welch');
    const indepTable = welchRes.output.tables.find((t) => t.id === 'indep_test')!;
    expect(String(indepTable.rows[1].method)).toContain('[Önerilen]');

    // Small severely skewed groups -> Mann-Whitney U
    const skewRows: DataRow[] = [
      ...[1, 1, 1, 2, 2, 2, 3, 50, 120].map((v) => ({ Grp: 'A', Val: v })),
      ...[2, 2, 2, 3, 3, 3, 4, 80, 200].map((v) => ({ Grp: 'B', Val: v })),
    ];
    const mwuRes = recommendAndRun(makeDataset('mwu', skewRows), {
      design: 'compare_2_indep',
      dependent: 'Val',
      secondary: 'Grp',
    });
    expect(mwuRes.output.analysisType).toBe('mann_whitney_u');
    expect(mwuRes.recommendedTest).toContain('Mann-Whitney');
  });

  it('routes compare_k_indep to Welch ANOVA + Games-Howell on unequal variances and Kruskal-Wallis on non-normal groups', () => {
    const hetRows: DataRow[] = [
      ...Array.from({ length: 35 }, (_, i) => ({ G: 'G1', Y: 20 + Math.sin(i) * 0.5 })),
      ...Array.from({ length: 35 }, (_, i) => ({ G: 'G2', Y: 25 + Math.cos(i) * 1.5 })),
      ...Array.from({ length: 35 }, (_, i) => ({ G: 'G3', Y: 35 + ((i % 2 === 0 ? 1 : -1) * (i + 2) * 1.2) })),
    ];
    const welchAnova = recommendAndRun(makeDataset('het-anova', hetRows), {
      design: 'compare_k_indep',
      dependent: 'Y',
      secondary: 'G',
    });
    expect(welchAnova.output.analysisType).toBe('oneway_anova');
    expect(welchAnova.output.params.posthocMethod).toBe('games_howell');
    expect(welchAnova.output.summary.recommendedVariant).toBe('welch_anova_games_howell');

    const nonNormRows: DataRow[] = [
      ...[1, 1, 1, 2, 2, 3, 90, 220].map((v) => ({ G: 'G1', Y: v })),
      ...[2, 2, 2, 3, 3, 4, 100, 300].map((v) => ({ G: 'G2', Y: v })),
      ...[3, 3, 3, 4, 4, 5, 110, 400].map((v) => ({ G: 'G3', Y: v })),
    ];
    const kwRes = recommendAndRun(makeDataset('kw', nonNormRows), {
      design: 'compare_k_indep',
      dependent: 'Y',
      secondary: 'G',
    });
    expect(kwRes.output.analysisType).toBe('kruskal_wallis');
  });

  it('routes compare_2_paired to Wilcoxon when N < 30 and difference scores violate normality', () => {
    const rows: DataRow[] = [
      { Pre: 10, Post: 11 },
      { Pre: 10, Post: 11 },
      { Pre: 10, Post: 11 },
      { Pre: 10, Post: 11 },
      { Pre: 10, Post: 11 },
      { Pre: 10, Post: 12 },
      { Pre: 10, Post: 12 },
      { Pre: 10, Post: 12 },
      { Pre: 10, Post: 60 },
      { Pre: 10, Post: 140 },
    ];
    const res = recommendAndRun(makeDataset('paired-wilcoxon', rows), {
      design: 'compare_2_paired',
      dependent: 'Pre',
      secondary: 'Post',
    });
    expect(res.output.analysisType).toBe('wilcoxon');
  });

  it('routes compare_k_paired to Repeated ANOVA (GG when Mauchly violated) and Friedman when severely skewed', () => {
    // Mauchly violation: T3 has much larger variance / orthogonal deviation from T1 & T2
    const ggRows: DataRow[] = Array.from({ length: 30 }, (_, i) => {
      const base = 50 + (i % 7) - 3;
      const t1 = base + (i % 3 === 0 ? 0.5 : -0.5);
      const t2 = base + 5 + (i % 2 === 0 ? 0.4 : -0.4);
      const t3 = base + 12 + (i % 2 === 0 ? 18 : -18) + (i % 5);
      return { T1: t1, T2: t2, T3: t3 };
    });
    const ggRes = recommendAndRun(makeDataset('rm-gg', ggRows), {
      design: 'compare_k_paired',
      dependent: 'T1',
      repeatedVars: ['T1', 'T2', 'T3'],
    });
    expect(ggRes.output.analysisType).toBe('repeated_anova');
    expect(Number(ggRes.output.summary.mauchlyP)).toBeLessThan(0.05);
    expect(ggRes.output.summary.recommendedVariant).toBe('repeated_anova_gg');

    // Severely skewed repeated measures -> Friedman
    const skewRmRows: DataRow[] = Array.from({ length: 20 }, (_, i) => ({
      T1: i < 17 ? 1 + (i % 2) : 50 + i * 10,
      T2: i < 17 ? 2 + (i % 2) : 80 + i * 15,
      T3: i < 17 ? 3 + (i % 2) : 120 + i * 20,
    }));
    const friedmanRes = recommendAndRun(makeDataset('rm-friedman', skewRmRows), {
      design: 'compare_k_paired',
      dependent: 'T1',
      repeatedVars: ['T1', 'T2', 'T3'],
    });
    expect(friedmanRes.output.analysisType).toBe('friedman');
  });

  it('routes relationship to Spearman when skewed and prediction to Logistic Regression + VIF/DW warnings', () => {
    // Skewed relationship -> Spearman
    const skewCorrRows: DataRow[] = Array.from({ length: 25 }, (_, i) => ({
      A: i < 21 ? 1 + (i % 3) : 100 + i * 25,
      B: i < 21 ? 2 + (i % 4) : 200 + i * 40,
    }));
    const spRes = recommendAndRun(makeDataset('spearman', skewCorrRows), {
      design: 'relationship',
      dependent: 'A',
      secondary: 'B',
    });
    expect(spRes.output.analysisType).toBe('correlation_test');
    expect(spRes.output.params.method).toBe('spearman');

    // Binary target prediction -> Logistic Regression (ds-klinik-150: Tani)
    const logitRes = recommendAndRun(dsKlinik, {
      design: 'prediction',
      dependent: 'Tani',
      predictors: ['Biyobelirtec_A', 'Yas', 'VKI'],
    });
    expect(logitRes.output.analysisType).toBe('logistic_regression');

    // Multicollinearity (VIF >= 5) + Autocorrelation (DW < 1.5) warning in OLS prediction
    const warnRows: DataRow[] = Array.from({ length: 40 }, (_, i) => {
      const x1 = i + 1;
      const x2 = 2 * x1 + ((i % 3) - 1) * 0.05; // collinear with x1 -> VIF >> 5
      const autoErr = Math.sin(i * 0.2) * 8; // positively autocorrelated -> DW < 1.5
      const y = 3 * x1 + autoErr;
      return { Y: y, X1: x1, X2: x2 };
    });
    const olsWarnRes = recommendAndRun(makeDataset('ols-warn', warnRows), {
      design: 'prediction',
      dependent: 'Y',
      predictors: ['X1', 'X2'],
    });
    expect(olsWarnRes.output.analysisType).toBe('linear_regression');
    const vifNode = olsWarnRes.decisionPath.find((n) => n.id === 'vif');
    const dwNode = olsWarnRes.decisionPath.find((n) => n.id === 'dw');
    expect(vifNode?.result).toBe('warn');
    expect(dwNode?.result).toBe('warn');
  });
});

describe('Module 1: AutopilotPanel React Component', () => {
  it('renders cleanly to HTML in both Turkish and English without raw hex colors or emojis', () => {
    const htmlTr = renderToStaticMarkup(React.createElement(AutopilotPanel, { dataset: dsOgrenci, lang: 'tr' }));
    const htmlEn = renderToStaticMarkup(React.createElement(AutopilotPanel, { dataset: dsOgrenci, lang: 'en' }));

    expect(htmlTr).toContain('Gelir_TL');
    expect(htmlTr).toContain('İki bağımsız grup');
    expect(htmlTr).toContain('Test öner ve çalıştır');
    expect(htmlEn).toContain('Recommend and run');
    expect(htmlEn).toContain('Data summary');
    expect(htmlTr).not.toMatch(/#[0-9a-fA-F]{3,8}\b/);
    expect(htmlTr).not.toContain('font-family');
  });

  it('supports variable subset scanning and interactive autopilot run + apply callback in DOM', () => {
    const subReport = scanDatasetAssumptions(dsOgrenci, ['OY_Ort', 'Gelir_TL']);
    expect(subReport.variables.map((v) => v.variable)).toEqual(['OY_Ort', 'Gelir_TL']);
    expect(subReport.missingPattern.totalMissing).toBe(5);
    expect(subReport.missingPattern.listwiseComplete).toBe(175);

    const container = document.createElement('div');
    document.body.appendChild(container);
    const onApply = vi.fn<(out: AnalysisOutput) => void>();
    const root = createRoot(container);

    try {
      flushSync(() => {
        root.render(React.createElement(AutopilotPanel, { dataset: dsOgrenci, lang: 'tr', onApplyAnalysis: onApply }));
      });

      const buttons = Array.from(container.querySelectorAll<HTMLButtonElement>('button'));
      const runBtn = buttons.find((b) => b.textContent?.includes('Test öner ve çalıştır'));
      expect(runBtn).toBeDefined();

      flushSync(() => {
        runBtn!.click();
      });

      expect(container.textContent).toContain('Önerilen test');
      expect(container.textContent).toContain('Tablolar');

      const applyBtn = Array.from(container.querySelectorAll<HTMLButtonElement>('button')).find((b) =>
        b.textContent?.includes('Geçmişe ekle'),
      );
      expect(applyBtn).toBeDefined();

      flushSync(() => {
        applyBtn!.click();
      });

      expect(onApply).toHaveBeenCalledTimes(1);
      const appliedOut = onApply.mock.calls[0][0];
      expect(appliedOut.tables.length).toBeGreaterThanOrEqual(1);
      expect(container.textContent).toContain('Eklendi');
    } finally {
      flushSync(() => {
        root.unmount();
      });
      container.remove();
    }
  });
});

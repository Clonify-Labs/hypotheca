import { AnalysisOutput, Dataset } from '../../types/interfaces';
import { chi2Cdf, normalCdf, normalInv, tCdf } from '../../engine/core/distributions';
import { olsFit } from '../../engine/core/linalg';
import { buildOutput, rNum, fmtNum } from '../../engine/classical/helpers';
import { toNum } from './shared';
import { StatInputError, clampP, isConstant } from '../../engine/core/errors';

export interface MetaStudy {
  study: string;
  y: number;
  se: number;
  year: number | null;
}

/** Kendall's tau-b between two numeric vectors (used for Begg & Mazumdar). */
function kendallTau(x: number[], y: number[]): { tau: number; z: number; p: number } {
  const n = x.length;
  let conc = 0;
  let disc = 0;
  let tx = 0;
  let ty = 0;
  for (let i = 0; i < n; i++) {
    for (let j = i + 1; j < n; j++) {
      const dx = Math.sign(x[i] - x[j]);
      const dy = Math.sign(y[i] - y[j]);
      if (dx === 0 && dy === 0) continue;
      if (dx === 0) tx++;
      else if (dy === 0) ty++;
      else if (dx === dy) conc++;
      else disc++;
    }
  }
  const n0 = conc + disc;
  const tau = (conc - disc) / Math.sqrt(Math.max(1, (n0 + tx) * (n0 + ty)));
  const varS = (n * (n - 1) * (2 * n + 5)) / 18;
  const z = (conc - disc) / Math.sqrt(varS);
  return { tau, z, p: clampP(2 * (1 - normalCdf(Math.abs(z)))) };
}

export function runMetaAnalysis(
  dataset: Dataset,
  opts: { studyCol: string; effectCol: string; seCol: string; yearCol?: string; method?: 'FE' | 'RE_DL' },
): AnalysisOutput {
  const method = opts.method ?? 'RE_DL';
  const studies: MetaStudy[] = [];
  let droppedNonPositiveSe = 0;
  for (const r of dataset.rows) {
    const y = toNum(r[opts.effectCol]);
    const se = toNum(r[opts.seCol]);
    if (y === null || se === null) continue;
    if (se <= 0) {
      droppedNonPositiveSe++;
      continue;
    }
    studies.push({
      study: String(r[opts.studyCol] ?? `Study ${studies.length + 1}`),
      y,
      se,
      year: opts.yearCol ? toNum(r[opts.yearCol]) : null,
    });
  }
  const k = studies.length;
  if (k < 3) {
    const extraTr = droppedNonPositiveSe ? ` (${droppedNonPositiveSe} çalışma SH <= 0 olduğu için çıkarıldı)` : '';
    const extraEn = droppedNonPositiveSe ? ` (${droppedNonPositiveSe} studies removed because SE <= 0)` : '';
    throw new StatInputError(
      k < 2 ? 'INSUFFICIENT_STUDIES' : 'INSUFFICIENT_N',
      `Meta-analiz için geçerli etki büyüklüğü ve pozitif SH içeren en az 3 çalışma gereklidir; bulunan: ${k}${extraTr}.`,
      `Meta-analysis requires at least 3 studies with a valid effect size and positive SE; found: ${k}${extraEn}.`,
    );
  }

  const w = studies.map((s) => 1 / (s.se * s.se));
  const sumW = w.reduce((a, b) => a + b, 0);
  const thetaFE = studies.reduce((s, st, i) => s + w[i] * st.y, 0) / sumW;
  const seFE = Math.sqrt(1 / sumW);

  const Q = studies.reduce((s, st, i) => s + w[i] * (st.y - thetaFE) ** 2, 0);
  const dfQ = k - 1;
  const pQ = clampP(1 - chi2Cdf(Q, dfQ));
  const I2 = Q > 0 ? Math.max(0, (Q - dfQ) / Q) * 100 : 0;
  const H2 = dfQ > 0 ? Q / dfQ : 1;
  const C = sumW - w.reduce((s, v) => s + v * v, 0) / sumW;
  const tau2 = C > 0 ? Math.max(0, (Q - dfQ) / C) : 0;

  const wRE = studies.map((s) => 1 / (s.se * s.se + tau2));
  const sumWRE = wRE.reduce((a, b) => a + b, 0);
  const thetaRE = studies.reduce((s, st, i) => s + wRE[i] * st.y, 0) / sumWRE;
  const seRE = Math.sqrt(1 / sumWRE);

  const useRE = method === 'RE_DL';
  const pooled = useRE ? thetaRE : thetaFE;
  const sePooled = useRE ? seRE : seFE;
  const weights = useRE ? wRE : w;
  const sumWeights = useRE ? sumWRE : sumW;
  const z = pooled / sePooled;
  const p = clampP(2 * (1 - normalCdf(Math.abs(z))));
  const ciLow = pooled - 1.959964 * sePooled;
  const ciHigh = pooled + 1.959964 * sePooled;
  // 95% prediction interval (Higgins, Thompson & Spiegelhalter 2009) using t(k-2)
  const tCritPi = k > 2 ? (() => {
    let lo = 0;
    let hi = 50;
    for (let i = 0; i < 60; i++) {
      const mid = (lo + hi) / 2;
      if (tCdf(mid, k - 2) < 0.975) lo = mid;
      else hi = mid;
    }
    return (lo + hi) / 2;
  })() : NaN;
  const piSd = Math.sqrt(tau2 + seRE * seRE);
  const piLow = thetaRE - tCritPi * piSd;
  const piHigh = thetaRE + tCritPi * piSd;

  // Egger's regression test: standardized effect (y/se) on precision (1/se)
  // Not estimable when every study has the same SE (precision has zero variance).
  const eggerEstimable = !isConstant(studies.map((s) => 1 / s.se));
  const egger = eggerEstimable
    ? olsFit(
        studies.map((s) => s.y / s.se),
        studies.map((s) => [1 / s.se]),
      )
    : null;
  const eggerIntercept = egger ? egger.beta[0] : NaN;
  const eggerSe = egger ? egger.se[0] : NaN;
  const eggerT = egger ? egger.t[0] : NaN;
  const eggerP = egger ? clampP(egger.p[0]) : NaN;
  const eggerTextTr = egger
    ? `Egger testi ${eggerP < 0.05 ? 'yayın yanlılığına işaret etmektedir' : 'anlamlı yayın yanlılığı göstermemektedir'} (p = ${fmtNum(eggerP, 3)})`
    : 'Egger testi tüm çalışmaların SH değeri aynı olduğundan hesaplanamamıştır';
  const eggerTextEn = egger ? `Egger's test p = ${fmtNum(eggerP, 3)}` : "Egger's test was not estimable because all studies share the same SE";

  // Begg & Mazumdar rank correlation (standardized deviates vs variances)
  const vStar = studies.map((s) => s.se * s.se - 1 / sumW);
  const tStar = studies.map((s, i) => (s.y - thetaFE) / Math.sqrt(Math.max(1e-12, vStar[i])));
  const begg = kendallTau(tStar, studies.map((s) => s.se * s.se));

  // Rosenthal fail-safe N (one-tailed alpha = .05)
  const zs = studies.map((s) => s.y / s.se);
  const sumZ = zs.reduce((a, b) => a + b, 0);
  const zAlpha = normalInv(0.95);
  const failSafeN = Math.max(0, Math.ceil((sumZ * sumZ) / (zAlpha * zAlpha) - k));

  const studyRows = studies.map((s, i) => ({
    study: s.study,
    year: s.year,
    effect: rNum(s.y, 3),
    se: rNum(s.se, 3),
    ciLow: rNum(s.y - 1.959964 * s.se, 3),
    ciHigh: rNum(s.y + 1.959964 * s.se, 3),
    weightPct: rNum((weights[i] / sumWeights) * 100, 2),
  }));

  const labels = [...studies.map((s) => s.study), useRE ? 'RE (DL) Pooled' : 'FE Pooled'];
  const forestData = [
    ...studies.map((s) => [s.y - 1.959964 * s.se, s.y + 1.959964 * s.se]),
    [ciLow, ciHigh],
  ];
  const maxSe = Math.max(...studies.map((s) => s.se)) * 1.1;

  const methodLabel = useRE ? 'DerSimonian-Laird Rastgele Etkiler' : 'Ters Varyans Sabit Etki';

  return buildOutput(
    'meta_analysis',
    `Meta-Analiz (${methodLabel}, k = ${k})`,
    { ...opts, method },
    {
      k,
      method,
      pooled: rNum(pooled, 4),
      se: rNum(sePooled, 4),
      ciLow: rNum(ciLow, 4),
      ciHigh: rNum(ciHigh, 4),
      z: rNum(z, 3),
      p: rNum(p, 6),
      thetaFE: rNum(thetaFE, 4),
      seFE: rNum(seFE, 4),
      thetaRE: rNum(thetaRE, 4),
      seRE: rNum(seRE, 4),
      Q: rNum(Q, 4),
      dfQ,
      pQ: rNum(pQ, 4),
      I2: rNum(I2, 2),
      H2: rNum(H2, 3),
      tau2: rNum(tau2, 5),
      tau: rNum(Math.sqrt(tau2), 4),
      piLow: rNum(piLow, 3),
      piHigh: rNum(piHigh, 3),
      eggerIntercept: rNum(eggerIntercept, 4),
      eggerSE: rNum(eggerSe, 4),
      eggerT: rNum(eggerT, 3),
      eggerP: rNum(eggerP, 4),
      beggTau: rNum(begg.tau, 4),
      beggP: rNum(begg.p, 4),
      failSafeN,
    },
    [
      {
        id: 'meta_studies',
        title: 'Çalışma Düzeyinde Etkiler ve Ağırlıklar',
        columns: [
          { key: 'study', label: 'Çalışma' },
          { key: 'year', label: 'Yıl', numeric: true },
          { key: 'effect', label: 'Etki', numeric: true },
          { key: 'se', label: 'SH', numeric: true },
          { key: 'ciLow', label: '%95 GA Alt', numeric: true },
          { key: 'ciHigh', label: '%95 GA Üst', numeric: true },
          { key: 'weightPct', label: 'Ağırlık %', numeric: true },
        ],
        rows: studyRows,
      },
      {
        id: 'meta_pooled',
        title: 'Birleştirilmiş Etki Büyüklüğü',
        columns: [
          { key: 'model', label: 'Model' },
          { key: 'est', label: 'Kestirim', numeric: true },
          { key: 'se', label: 'SH', numeric: true },
          { key: 'ciLow', label: '%95 GA Alt', numeric: true },
          { key: 'ciHigh', label: '%95 GA Üst', numeric: true },
          { key: 'z', label: 'Z', numeric: true },
          { key: 'p', label: 'p', numeric: true },
        ],
        rows: [
          {
            model: 'Sabit Etki (FE)',
            est: rNum(thetaFE, 3),
            se: rNum(seFE, 3),
            ciLow: rNum(thetaFE - 1.959964 * seFE, 3),
            ciHigh: rNum(thetaFE + 1.959964 * seFE, 3),
            z: rNum(thetaFE / seFE, 3),
            p: rNum(clampP(2 * (1 - normalCdf(Math.abs(thetaFE / seFE)))), 5),
          },
          {
            model: 'Rastgele Etkiler (DL)',
            est: rNum(thetaRE, 3),
            se: rNum(seRE, 3),
            ciLow: rNum(thetaRE - 1.959964 * seRE, 3),
            ciHigh: rNum(thetaRE + 1.959964 * seRE, 3),
            z: rNum(thetaRE / seRE, 3),
            p: rNum(clampP(2 * (1 - normalCdf(Math.abs(thetaRE / seRE)))), 5),
          },
        ],
        footnotes: [
          `%95 Tahmin Aralığı (RE): [${fmtNum(piLow, 3)}, ${fmtNum(piHigh, 3)}].`,
          ...(droppedNonPositiveSe ? [`SH değeri 0 veya negatif olduğu için çıkarılan çalışma sayısı: ${droppedNonPositiveSe}.`] : []),
        ],
      },
      {
        id: 'meta_heterogeneity',
        title: 'Heterojenlik ve Yayın Yanlılığı',
        columns: [
          { key: 'metric', label: 'Ölçüt' },
          { key: 'value', label: 'Değer', numeric: true },
          { key: 'p', label: 'p', numeric: true },
        ],
        rows: [
          { metric: `Cochran Q (sd = ${dfQ})`, value: rNum(Q, 3), p: rNum(pQ, 4) },
          { metric: 'I² (%)', value: rNum(I2, 2), p: null },
          { metric: 'H²', value: rNum(H2, 3), p: null },
          { metric: 'τ² (DerSimonian-Laird)', value: rNum(tau2, 4), p: null },
          { metric: 'Egger Regresyon Sabiti', value: rNum(eggerIntercept, 3), p: rNum(eggerP, 4) },
          { metric: "Begg & Mazumdar Kendall τ", value: rNum(begg.tau, 3), p: rNum(begg.p, 4) },
          { metric: 'Rosenthal Fail-Safe N', value: failSafeN, p: null },
        ],
      },
    ],
    [
      {
        id: 'meta_forest',
        title: 'Orman Grafiği (Forest Plot)',
        type: 'forest',
        option: {
          tooltip: { trigger: 'axis' },
          grid: { left: 150 },
          xAxis: { type: 'value', name: 'Etki (%95 GA)' },
          yAxis: { type: 'category', data: labels, inverse: true },
          series: [
            {
              name: 'Etki',
              type: 'scatter',
              symbol: 'rect',
              data: [
                ...studies.map((s, i) => ({
                  value: [rNum(s.y, 3), labels[i]],
                  symbolSize: Math.max(6, Math.round(Math.sqrt((weights[i] / sumWeights) * 100) * 4)),
                })),
                { value: [rNum(pooled, 3), labels[k]], symbol: 'diamond', symbolSize: 16 },
              ],
            },
            {
              name: 'CI',
              type: 'line',
              data: [],
              markLine: {
                symbol: 'none',
                data: forestData.map((d, i) => [
                  { coord: [rNum(d[0], 3), labels[i]] },
                  { coord: [rNum(d[1], 3), labels[i]] },
                ]),
              },
            },
          ],
        },
      },
      {
        id: 'meta_funnel',
        title: 'Huni Grafiği (Funnel Plot)',
        type: 'funnel',
        option: {
          tooltip: { trigger: 'item' },
          xAxis: { type: 'value', name: 'Etki' },
          yAxis: { type: 'value', name: 'SH', inverse: true, min: 0, max: rNum(maxSe, 3) },
          series: [
            { name: 'Çalışmalar', type: 'scatter', data: studies.map((s) => [rNum(s.y, 3), rNum(s.se, 3)]) },
            {
              name: '%95 Sınır',
              type: 'line',
              showSymbol: false,
              lineStyle: { type: 'dashed' },
              data: [
                [rNum(pooled - 1.96 * maxSe, 3), rNum(maxSe, 3)],
                [rNum(pooled, 3), 0],
                [rNum(pooled + 1.96 * maxSe, 3), rNum(maxSe, 3)],
              ],
            },
          ],
        },
      },
    ],
    `${k} çalışmayı içeren ${methodLabel.toLowerCase()} meta-analizinde birleştirilmiş etki ${fmtNum(pooled, 2)} (%95 GA [${fmtNum(ciLow, 2)}, ${fmtNum(ciHigh, 2)}], Z = ${fmtNum(z, 2)}, p ${p < 0.001 ? '< .001' : '= ' + rNum(p, 3)}) bulunmuştur. Heterojenlik Q(${dfQ}) = ${fmtNum(Q, 2)}, p = ${fmtNum(pQ, 3)}, I² = %${fmtNum(I2, 1)}, τ² = ${fmtNum(tau2, 3)}; ${eggerTextTr}.`,
    `A ${useRE ? 'DerSimonian-Laird random-effects' : 'fixed-effect inverse-variance'} meta-analysis of ${k} studies yielded a pooled effect of ${fmtNum(pooled, 2)} (95% CI [${fmtNum(ciLow, 2)}, ${fmtNum(ciHigh, 2)}], Z = ${fmtNum(z, 2)}, p ${p < 0.001 ? '< .001' : '= ' + rNum(p, 3)}). Heterogeneity: Q(${dfQ}) = ${fmtNum(Q, 2)}, p = ${fmtNum(pQ, 3)}, I² = ${fmtNum(I2, 1)}%, τ² = ${fmtNum(tau2, 3)}; ${eggerTextEn}.`,
  );
}

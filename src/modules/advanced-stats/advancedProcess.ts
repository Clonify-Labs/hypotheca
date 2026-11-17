import { AnalysisOutput, Dataset, StatTable } from '../../types/interfaces';
import { mean, olsFit, stdDev } from '../../engine/core/linalg';
import { buildOutput, rNum, sigStars, fmtNum } from '../../engine/classical/helpers';
import { assertModelInputs, completeNumeric, makeRng, percentile } from './shared';

interface BootSummary {
  est: number;
  se: number;
  lo: number;
  hi: number;
  significant: boolean;
}

function summarizeBoot(est: number, draws: number[]): BootSummary {
  const sorted = draws.filter(Number.isFinite).sort((a, b) => a - b);
  const lo = percentile(sorted, 0.025);
  const hi = percentile(sorted, 0.975);
  return { est, se: sorted.length > 2 ? stdDev(sorted, 1) : NaN, lo, hi, significant: Number.isFinite(lo) && Number.isFinite(hi) && (lo > 0 || hi < 0) };
}

function pathRow(label: string, fit: ReturnType<typeof olsFit>, idx: number) {
  return {
    path: label,
    b: rNum(fit.beta[idx], 4),
    se: rNum(fit.se[idx], 4),
    t: rNum(fit.t[idx], 3),
    p: rNum(fit.p[idx], 5),
    sig: sigStars(fit.p[idx]),
  };
}

const PATH_COLUMNS = [
  { key: 'path', label: 'Yol' },
  { key: 'b', label: 'B', numeric: true },
  { key: 'se', label: 'SH', numeric: true },
  { key: 't', label: 't', numeric: true },
  { key: 'p', label: 'p', numeric: true },
  { key: 'sig', label: 'Düzey' },
];

const EFFECT_COLUMNS = [
  { key: 'effect', label: 'Etki' },
  { key: 'est', label: 'Kestirim', numeric: true },
  { key: 'bootSe', label: 'Boot SH', numeric: true },
  { key: 'llci', label: 'BootLLCI', numeric: true },
  { key: 'ulci', label: 'BootULCI', numeric: true },
  { key: 'significant', label: 'Anlamlı?' },
];

function effectRow(label: string, s: BootSummary) {
  return {
    effect: label,
    est: rNum(s.est, 4),
    bootSe: rNum(s.se, 4),
    llci: rNum(s.lo, 4),
    ulci: rNum(s.hi, 4),
    significant: s.significant ? 'Evet (0 dışarıda)' : 'Hayır',
  };
}

/** Hayes Model 6: serial mediation X -> M1 -> M2 -> Y. */
export function runProcessModel6(
  dataset: Dataset,
  opts: { x: string; m1: string; m2: string; y: string; covariates?: string[]; bootstrapSamples?: number },
): AnalysisOutput {
  const covs = opts.covariates ?? [];
  const cols = [opts.x, opts.m1, opts.m2, opts.y, ...covs];
  const { mat } = completeNumeric(dataset.rows, cols);
  const n = mat.length;
  assertModelInputs(mat, cols, cols.length + 10, 'PROCESS Model 6', 'PROCESS Model 6');
  const B = opts.bootstrapSamples ?? 1000;

  const estimate = (rows: number[][]) => {
    const X = rows.map((r) => r[0]);
    const M1 = rows.map((r) => r[1]);
    const M2 = rows.map((r) => r[2]);
    const Y = rows.map((r) => r[3]);
    const C = rows.map((r) => r.slice(4));
    const f1 = olsFit(M1, X.map((v, i) => [v, ...C[i]]));
    const f2 = olsFit(M2, X.map((v, i) => [v, M1[i], ...C[i]]));
    const f3 = olsFit(Y, X.map((v, i) => [v, M1[i], M2[i], ...C[i]]));
    const fT = olsFit(Y, X.map((v, i) => [v, ...C[i]]));
    const a1 = f1.beta[1];
    const a2 = f2.beta[1];
    const d21 = f2.beta[2];
    const cp = f3.beta[1];
    const b1 = f3.beta[2];
    const b2 = f3.beta[3];
    const ind1 = a1 * b1;
    const ind2 = a2 * b2;
    const ind3 = a1 * d21 * b2;
    return { f1, f2, f3, fT, a1, a2, d21, cp, b1, b2, ind1, ind2, ind3, total: ind1 + ind2 + ind3, c: fT.beta[1] };
  };

  const est = estimate(mat);
  const rng = makeRng(60606);
  const draws = { ind1: [] as number[], ind2: [] as number[], ind3: [] as number[], total: [] as number[] };
  for (let b = 0; b < B; b++) {
    const sample = Array.from({ length: n }, () => mat[Math.floor(rng() * n)]);
    const e = estimate(sample);
    draws.ind1.push(e.ind1);
    draws.ind2.push(e.ind2);
    draws.ind3.push(e.ind3);
    draws.total.push(e.total);
  }
  const s1 = summarizeBoot(est.ind1, draws.ind1);
  const s2 = summarizeBoot(est.ind2, draws.ind2);
  const s3 = summarizeBoot(est.ind3, draws.ind3);
  const sT = summarizeBoot(est.total, draws.total);

  const tables: StatTable[] = [
    {
      id: 'proc6_paths',
      title: 'Model 6 Yol Katsayıları',
      columns: PATH_COLUMNS,
      rows: [
        pathRow(`a1 (${opts.x} → ${opts.m1})`, est.f1, 1),
        pathRow(`a2 (${opts.x} → ${opts.m2})`, est.f2, 1),
        pathRow(`d21 (${opts.m1} → ${opts.m2})`, est.f2, 2),
        pathRow(`b1 (${opts.m1} → ${opts.y})`, est.f3, 2),
        pathRow(`b2 (${opts.m2} → ${opts.y})`, est.f3, 3),
        pathRow(`c' (${opts.x} → ${opts.y}, doğrudan)`, est.f3, 1),
        pathRow(`c (${opts.x} → ${opts.y}, toplam)`, est.fT, 1),
      ],
    },
    {
      id: 'proc6_indirect',
      title: `Dolaylı Etkiler (Yüzdelik Bootstrap, ${B} tekrar)`,
      columns: EFFECT_COLUMNS,
      rows: [
        effectRow(`Ind1: ${opts.x} → ${opts.m1} → ${opts.y}`, s1),
        effectRow(`Ind2: ${opts.x} → ${opts.m2} → ${opts.y}`, s2),
        effectRow(`Ind3: ${opts.x} → ${opts.m1} → ${opts.m2} → ${opts.y}`, s3),
        effectRow('Toplam Dolaylı Etki', sT),
      ],
    },
  ];

  return buildOutput(
    'process_model6',
    `PROCESS Model 6 Seri Aracılık (${opts.x} → ${opts.m1} → ${opts.m2} → ${opts.y})`,
    { ...opts, bootstrapSamples: B },
    {
      n,
      a1: rNum(est.a1, 4),
      a2: rNum(est.a2, 4),
      d21: rNum(est.d21, 4),
      b1: rNum(est.b1, 4),
      b2: rNum(est.b2, 4),
      cPrime: rNum(est.cp, 4),
      cTotal: rNum(est.c, 4),
      ind1: rNum(s1.est, 4),
      ind2: rNum(s2.est, 4),
      ind3: rNum(s3.est, 4),
      ind3CI: [rNum(s3.lo, 4), rNum(s3.hi, 4)],
      ind3Significant: s3.significant,
      totalIndirect: rNum(sT.est, 4),
      totalIndirectCI: [rNum(sT.lo, 4), rNum(sT.hi, 4)],
    },
    tables,
    [],
    `PROCESS Model 6 seri aracılık analizinde ${opts.x} → ${opts.m1} → ${opts.m2} → ${opts.y} seri dolaylı etkisi B = ${fmtNum(s3.est, 3)}, %95 BootGA [${fmtNum(s3.lo, 3)}, ${fmtNum(s3.hi, 3)}] ${s3.significant ? 'anlamlıdır' : 'anlamlı değildir'}; toplam dolaylı etki B = ${fmtNum(sT.est, 3)} [${fmtNum(sT.lo, 3)}, ${fmtNum(sT.hi, 3)}].`,
    `PROCESS Model 6 serial mediation: the serial indirect effect ${opts.x} → ${opts.m1} → ${opts.m2} → ${opts.y} was B = ${fmtNum(s3.est, 3)}, 95% BootCI [${fmtNum(s3.lo, 3)}, ${fmtNum(s3.hi, 3)}]; total indirect B = ${fmtNum(sT.est, 3)} [${fmtNum(sT.lo, 3)}, ${fmtNum(sT.hi, 3)}].`,
  );
}

interface ModMedOpts {
  x: string;
  m: string;
  w: string;
  y: string;
  bootstrapSamples?: number;
}

/** Shared engine for first-stage (Model 7) and second-stage (Model 14) moderated mediation. */
function moderatedMediation(dataset: Dataset, opts: ModMedOpts, stage: 'first' | 'second'): AnalysisOutput {
  const cols = [opts.x, opts.m, opts.w, opts.y];
  const { mat } = completeNumeric(dataset.rows, cols);
  const n = mat.length;
  assertModelInputs(mat, cols, 20, 'Düzenlenmiş aracılık modeli', 'Moderated mediation model');
  const B = opts.bootstrapSamples ?? 1000;

  // Mean-center X, M and W (Hayes recommendation for interpretability)
  const means = [0, 1, 2].map((j) => mean(mat.map((r) => r[j])));
  const centered = mat.map((r) => [r[0] - means[0], r[1] - means[1], r[2] - means[2], r[3]]);
  const sdW = stdDev(centered.map((r) => r[2]), 1);
  const wLevels = [-sdW, 0, sdW];

  const estimate = (rows: number[][]) => {
    const X = rows.map((r) => r[0]);
    const M = rows.map((r) => r[1]);
    const W = rows.map((r) => r[2]);
    const Y = rows.map((r) => r[3]);
    if (stage === 'first') {
      const fm = olsFit(M, X.map((v, i) => [v, W[i], v * W[i]]));
      const fy = olsFit(Y, X.map((v, i) => [v, M[i]]));
      const a1 = fm.beta[1];
      const a3 = fm.beta[3];
      const b = fy.beta[2];
      return { fm, fy, index: a3 * b, cond: wLevels.map((w) => (a1 + a3 * w) * b) };
    }
    const fm = olsFit(M, X.map((v) => [v]));
    const fy = olsFit(Y, X.map((v, i) => [v, M[i], W[i], M[i] * W[i]]));
    const a = fm.beta[1];
    const b1 = fy.beta[2];
    const b3 = fy.beta[4];
    return { fm, fy, index: a * b3, cond: wLevels.map((w) => a * (b1 + b3 * w)) };
  };

  const est = estimate(centered);
  const rng = makeRng(stage === 'first' ? 70707 : 141414);
  const idxDraws: number[] = [];
  const condDraws: number[][] = [[], [], []];
  for (let b = 0; b < B; b++) {
    const sample = Array.from({ length: n }, () => centered[Math.floor(rng() * n)]);
    const e = estimate(sample);
    idxDraws.push(e.index);
    e.cond.forEach((v, i) => condDraws[i].push(v));
  }
  const imm = summarizeBoot(est.index, idxDraws);
  const conds = est.cond.map((v, i) => summarizeBoot(v, condDraws[i]));
  const levelLabels = ['Düşük (-1 SS)', 'Ortalama', 'Yüksek (+1 SS)'];

  const pathRows =
    stage === 'first'
      ? [
          pathRow(`a1 (${opts.x} → ${opts.m})`, est.fm, 1),
          pathRow(`a2 (${opts.w} → ${opts.m})`, est.fm, 2),
          pathRow(`a3 (${opts.x} × ${opts.w} → ${opts.m})`, est.fm, 3),
          pathRow(`b (${opts.m} → ${opts.y})`, est.fy, 2),
          pathRow(`c' (${opts.x} → ${opts.y})`, est.fy, 1),
        ]
      : [
          pathRow(`a (${opts.x} → ${opts.m})`, est.fm, 1),
          pathRow(`b1 (${opts.m} → ${opts.y})`, est.fy, 2),
          pathRow(`b2 (${opts.w} → ${opts.y})`, est.fy, 3),
          pathRow(`b3 (${opts.m} × ${opts.w} → ${opts.y})`, est.fy, 4),
          pathRow(`c' (${opts.x} → ${opts.y})`, est.fy, 1),
        ];

  const model = stage === 'first' ? 7 : 14;
  const intLabel = stage === 'first' ? 'a3 × b' : 'a × b3';

  return buildOutput(
    `process_model${model}`,
    `PROCESS Model ${model} Düzenlenmiş Aracılık (${opts.x} → ${opts.m} → ${opts.y}; W = ${opts.w})`,
    { ...opts, bootstrapSamples: B, stage },
    {
      n,
      model,
      indexOfModeratedMediation: rNum(imm.est, 5),
      immBootSE: rNum(imm.se, 5),
      immCI: [rNum(imm.lo, 5), rNum(imm.hi, 5)],
      immSignificant: imm.significant,
      conditionalIndirect: conds.map((c, i) => ({ level: levelLabels[i], est: rNum(c.est, 4), lo: rNum(c.lo, 4), hi: rNum(c.hi, 4) })),
    },
    [
      { id: `proc${model}_paths`, title: `Model ${model} Yol Katsayıları (merkezileştirilmiş)`, columns: PATH_COLUMNS, rows: pathRows },
      {
        id: `proc${model}_conditional`,
        title: `${opts.w} Düzeylerinde Koşullu Dolaylı Etkiler`,
        columns: EFFECT_COLUMNS,
        rows: conds.map((c, i) => effectRow(`${levelLabels[i]} (${opts.w} = ${fmtNum(means[2] + wLevels[i], 2)})`, c)),
      },
      {
        id: `proc${model}_imm`,
        title: 'Düzenlenmiş Aracılık İndeksi (Hayes, 2015)',
        columns: EFFECT_COLUMNS,
        rows: [effectRow(`İndeks (${intLabel})`, imm)],
      },
    ],
    [
      {
        id: `proc${model}_cond_plot`,
        title: 'Koşullu Dolaylı Etkiler ve %95 BootGA',
        type: 'bar',
        option: {
          tooltip: { trigger: 'axis' },
          xAxis: { type: 'category', data: levelLabels },
          yAxis: { type: 'value', name: 'Dolaylı Etki' },
          series: [{ name: 'Koşullu dolaylı etki', type: 'bar', data: conds.map((c) => rNum(c.est, 4)) }],
        },
      },
    ],
    `PROCESS Model ${model} sonucunda düzenlenmiş aracılık indeksi ${fmtNum(imm.est, 3)}, %95 BootGA [${fmtNum(imm.lo, 3)}, ${fmtNum(imm.hi, 3)}] ${imm.significant ? 'anlamlıdır; dolaylı etki ' + opts.w + ' düzeyine göre değişmektedir' : 'anlamlı değildir'}.`,
    `PROCESS Model ${model}: index of moderated mediation = ${fmtNum(imm.est, 3)}, 95% BootCI [${fmtNum(imm.lo, 3)}, ${fmtNum(imm.hi, 3)}]${imm.significant ? ', indicating the indirect effect depends on ' + opts.w : ''}.`,
  );
}

/** Hayes Model 7: W moderates the X -> M path. */
export function runProcessModel7(dataset: Dataset, opts: ModMedOpts): AnalysisOutput {
  return moderatedMediation(dataset, opts, 'first');
}

/** Hayes Model 14: W moderates the M -> Y path. */
export function runProcessModel14(dataset: Dataset, opts: ModMedOpts): AnalysisOutput {
  return moderatedMediation(dataset, opts, 'second');
}

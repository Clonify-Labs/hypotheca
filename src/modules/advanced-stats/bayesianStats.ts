import { AnalysisOutput, Dataset } from '../../types/interfaces';
import { lnBeta, lnGamma } from '../../engine/core/distributions';
import { mean, variance } from '../../engine/core/linalg';
import { buildOutput, rNum, fmtNum } from '../../engine/classical/helpers';
import { completeNumeric, logSumExp, toNum } from './shared';
import { StatInputError, isConstant } from '../../engine/core/errors';

function assertPriorScale(v: number, nameTr: string, nameEn: string): void {
  if (!(Number.isFinite(v) && v > 0)) {
    throw new StatInputError('INVALID_PARAMETER', `${nameTr} pozitif ve sonlu bir sayı olmalıdır.`, `${nameEn} must be a positive finite number.`);
  }
}

export function evidenceLabel(bf10: number): { tr: string; en: string } {
  if (Number.isNaN(bf10) || bf10 < 0) return { tr: 'Bayes faktörü hesaplanamadı', en: 'Bayes factor could not be computed' };
  if (bf10 === Infinity) return { tr: 'Aşırı güçlü: H1 lehine', en: 'Extreme evidence for H1' };
  if (bf10 === 0) return { tr: 'Aşırı güçlü: H0 lehine', en: 'Extreme evidence for H0' };
  const bf = bf10 >= 1 ? bf10 : 1 / bf10;
  const dir = bf10 >= 1 ? 'H1' : 'H0';
  let en = 'No evidence';
  let tr = 'Kanıt yok';
  if (bf > 100) [en, tr] = ['Extreme', 'Aşırı güçlü'];
  else if (bf > 30) [en, tr] = ['Very strong', 'Çok güçlü'];
  else if (bf > 10) [en, tr] = ['Strong', 'Güçlü'];
  else if (bf > 3) [en, tr] = ['Moderate', 'Orta'];
  else if (bf > 1) [en, tr] = ['Anecdotal', 'Zayıf (anekdot)'];
  return { tr: `${tr}: ${dir} lehine`, en: `${en} evidence for ${dir}` };
}

/**
 * JZS Bayes factor for a t statistic (Rouder et al., 2009), integrating over g with
 * δ | g ~ N(0, g), g ~ InvGamma(1/2, r²/2). Integration is done in u = log g with
 * a dense trapezoid grid in log space for numerical stability.
 */
export function jzsBf10(t: number, nEff: number, df: number, r: number): number {
  if (!Number.isFinite(t) || !(nEff > 0) || !(df > 0) || !(r > 0) || !Number.isFinite(r)) return NaN;
  const logNull = -((df + 1) / 2) * Math.log(1 + (t * t) / df);
  const lo = -18;
  const hi = 18;
  const steps = 3000;
  const h = (hi - lo) / steps;
  const terms: number[] = [];
  for (let i = 0; i <= steps; i++) {
    const u = lo + i * h;
    const g = Math.exp(u);
    const logLik = -0.5 * Math.log(1 + nEff * g) - ((df + 1) / 2) * Math.log(1 + (t * t) / ((1 + nEff * g) * df));
    const logPrior = Math.log(r) - 0.5 * Math.log(2 * Math.PI) - 1.5 * u - (r * r) / (2 * g);
    const w = i === 0 || i === steps ? 0.5 : 1;
    terms.push(Math.log(w * h) + logLik + logPrior + u); // + u is the Jacobian dg = g du
  }
  return Math.exp(logSumExp(terms) - logNull);
}

/** Student-t log density with df degrees of freedom. */
function logTDens(x: number, df: number): number {
  return lnGamma((df + 1) / 2) - lnGamma(df / 2) - 0.5 * Math.log(df * Math.PI) - ((df + 1) / 2) * Math.log(1 + (x * x) / df);
}

/** Approximate posterior of δ on a grid: Cauchy(0, r) prior × t-likelihood of the observed t. */
function deltaPosterior(t: number, nEff: number, df: number, r: number) {
  const center = t / Math.sqrt(nEff);
  const span = 8 / Math.sqrt(nEff) + 1;
  const grid: number[] = [];
  const logw: number[] = [];
  for (let i = 0; i <= 2000; i++) {
    const d = center - span + (2 * span * i) / 2000;
    grid.push(d);
    logw.push(logTDens(t - d * Math.sqrt(nEff), df) - Math.log(Math.PI * r * (1 + (d / r) ** 2)));
  }
  const lse = logSumExp(logw);
  const w = logw.map((v) => Math.exp(v - lse));
  let cum = 0;
  let lo = grid[0];
  let hi = grid[grid.length - 1];
  let med = center;
  let loSet = false;
  let medSet = false;
  for (let i = 0; i < grid.length; i++) {
    cum += w[i];
    if (!loSet && cum >= 0.025) {
      lo = grid[i];
      loSet = true;
    }
    if (!medSet && cum >= 0.5) {
      med = grid[i];
      medSet = true;
    }
    if (cum >= 0.975) {
      hi = grid[i];
      break;
    }
  }
  return { median: med, lo, hi };
}

const ROBUST_SCALES = [0.354, 0.707, 1.0, 1.414];

export function runBayesianTTest(dataset: Dataset, dependent: string, groupVar: string, cauchyScale = Math.SQRT1_2): AnalysisOutput {
  const groups = new Map<string, number[]>();
  for (const r of dataset.rows) {
    const y = toNum(r[dependent]);
    const g = r[groupVar];
    if (y === null || g === null || g === undefined || g === '') continue;
    const arr = groups.get(String(g)) ?? [];
    arr.push(y);
    groups.set(String(g), arr);
  }
  const keys = Array.from(groups.keys()).sort((a, b) => a.localeCompare(b, 'tr'));
  if (keys.length !== 2) {
    throw new StatInputError(
      keys.length < 2 ? 'SINGLE_GROUP' : 'TOO_MANY_GROUPS',
      `Bayesyen bağımsız t-testi için grup değişkeni tam olarak 2 düzeye sahip olmalıdır (bulunan: ${keys.length}).`,
      `The Bayesian independent t-test requires exactly 2 groups (found: ${keys.length}).`,
    );
  }
  assertPriorScale(cauchyScale, 'Cauchy ölçek parametresi', 'Cauchy prior scale');
  const x1 = groups.get(keys[0])!;
  const x2 = groups.get(keys[1])!;
  const n1 = x1.length;
  const n2 = x2.length;
  if (n1 < 2 || n2 < 2) {
    throw new StatInputError(
      'INSUFFICIENT_N',
      `Bayes faktörü için her grupta en az 2 gözlem gereklidir (${keys[0]}: ${n1}, ${keys[1]}: ${n2}).`,
      `The Bayes factor requires at least 2 observations per group (${keys[0]}: ${n1}, ${keys[1]}: ${n2}).`,
    );
  }
  if (isConstant(x1) && isConstant(x2)) {
    throw new StatInputError(
      'ZERO_VARIANCE',
      `"${dependent}" her iki grupta da sabit (grup içi varyans sıfır); Bayes faktörü tanımsızdır.`,
      `"${dependent}" is constant within both groups (zero within-group variance); the Bayes factor is undefined.`,
    );
  }
  const df = n1 + n2 - 2;
  const sp = Math.sqrt(((n1 - 1) * variance(x1, 1) + (n2 - 1) * variance(x2, 1)) / df);
  const t = (mean(x1) - mean(x2)) / (sp * Math.sqrt(1 / n1 + 1 / n2));
  const nEff = (n1 * n2) / (n1 + n2);

  const bf10 = jzsBf10(t, nEff, df, cauchyScale);
  const post = deltaPosterior(t, nEff, df, cauchyScale);
  const label = evidenceLabel(bf10);
  const robustness = ROBUST_SCALES.map((r) => ({ r, bf10: jzsBf10(t, nEff, df, r) }));

  return buildOutput(
    'bayesian_t_test',
    `Bayesyen Bağımsız Örneklem t-Testi (JZS, r = ${fmtNum(cauchyScale, 3)})`,
    { dependent, groupVar, cauchyScale },
    {
      groups: keys,
      n1,
      n2,
      t: rNum(t, 4),
      df,
      bf10: rNum(bf10, 4),
      bf01: rNum(1 / bf10, 4),
      log10Bf10: rNum(Math.log10(bf10), 3),
      deltaMedian: rNum(post.median, 4),
      deltaCI: [rNum(post.lo, 4), rNum(post.hi, 4)],
      evidenceTr: label.tr,
      evidenceEn: label.en,
    },
    [
      {
        id: 'bt_main',
        title: 'Bayes Faktörü ve Etki Büyüklüğü Sonsalı',
        columns: [
          { key: 'metric', label: 'Ölçüt' },
          { key: 'value', label: 'Değer' },
        ],
        rows: [
          { metric: `Gruplar (n)`, value: `${keys[0]} (${n1}) / ${keys[1]} (${n2})` },
          { metric: 't (Student)', value: rNum(t, 3) },
          { metric: 'BF₁₀', value: rNum(bf10, 4) },
          { metric: 'BF₀₁', value: rNum(1 / bf10, 4) },
          { metric: 'δ sonsal medyan', value: rNum(post.median, 3) },
          { metric: 'δ %95 inanılırlık aralığı', value: `[${fmtNum(post.lo, 3)}, ${fmtNum(post.hi, 3)}]` },
          { metric: 'Kanıt (Lee & Wagenmakers)', value: label.tr },
        ],
      },
      {
        id: 'bt_robust',
        title: 'Önsel Duyarlılık (Cauchy ölçeği)',
        columns: [
          { key: 'scale', label: 'r', numeric: true },
          { key: 'bf10', label: 'BF₁₀', numeric: true },
          { key: 'label', label: 'Kanıt' },
        ],
        rows: robustness.map((x) => ({ scale: x.r, bf10: rNum(x.bf10, 4), label: evidenceLabel(x.bf10).tr })),
      },
    ],
    [
      {
        id: 'bt_robust_plot',
        title: 'Bayes Faktörü Duyarlılık Eğrisi',
        type: 'line',
        option: {
          tooltip: { trigger: 'axis' },
          xAxis: { type: 'category', data: ROBUST_SCALES.map(String), name: 'Cauchy r' },
          yAxis: { type: 'log', name: 'BF₁₀' },
          series: [{ name: 'BF₁₀', type: 'line', data: robustness.map((x) => rNum(x.bf10, 4)) }],
        },
      },
    ],
    `JZS Bayes faktörü BF₁₀ = ${fmtNum(bf10, 3)} (${label.tr}); etki büyüklüğü δ sonsal medyanı ${fmtNum(post.median, 2)}, %95 İA [${fmtNum(post.lo, 2)}, ${fmtNum(post.hi, 2)}].`,
    `JZS Bayes factor BF₁₀ = ${fmtNum(bf10, 3)} (${label.en}); posterior median δ = ${fmtNum(post.median, 2)}, 95% CrI [${fmtNum(post.lo, 2)}, ${fmtNum(post.hi, 2)}].`,
  );
}

/**
 * Bayesian one-way ANOVA via the Zellner–Siow mixture-of-g-priors Bayes factor on R²
 * (Liang et al., 2008; Rouder & Morey, 2012), with the (k−1) dummy-coded group effects
 * as predictors and g ~ InvGamma(1/2, N·r²/2).
 */
export function runBayesianAnova(dataset: Dataset, dependent: string, factor: string, rScale = 0.5): AnalysisOutput {
  const groups = new Map<string, number[]>();
  for (const r of dataset.rows) {
    const y = toNum(r[dependent]);
    const g = r[factor];
    if (y === null || g === null || g === undefined || g === '') continue;
    const arr = groups.get(String(g)) ?? [];
    arr.push(y);
    groups.set(String(g), arr);
  }
  const entries = Array.from(groups.entries()).filter(([, a]) => a.length >= 2);
  const k = entries.length;
  if (k < 2) {
    throw new StatInputError(
      groups.size === 0 ? 'EMPTY_DATA' : 'SINGLE_GROUP',
      `Bayesyen ANOVA için her birinde en az 2 gözlem bulunan en az 2 grup gereklidir (bulunan: ${k}).`,
      `Bayesian ANOVA requires at least 2 groups with at least 2 observations each (found: ${k}).`,
    );
  }
  assertPriorScale(rScale, 'Önsel ölçek parametresi (r)', 'Prior scale (r)');
  const all = entries.flatMap(([, a]) => a);
  if (isConstant(all)) {
    throw new StatInputError('ZERO_VARIANCE', `"${dependent}" değişkeninin varyansı sıfır; Bayesyen ANOVA hesaplanamaz.`, `"${dependent}" has zero variance; Bayesian ANOVA cannot be computed.`);
  }
  const N = all.length;
  const gm = mean(all);
  const ssT = all.reduce((s, v) => s + (v - gm) ** 2, 0);
  const ssB = entries.reduce((s, [, a]) => s + a.length * (mean(a) - gm) ** 2, 0);
  const R2 = ssT > 0 ? ssB / ssT : 0;
  const p = k - 1;

  const logBfAt = (r: number) => {
    const lo = -18;
    const hi = 18;
    const steps = 3000;
    const h = (hi - lo) / steps;
    const s = (N * r * r) / 2;
    const terms: number[] = [];
    for (let i = 0; i <= steps; i++) {
      const u = lo + i * h;
      const g = Math.exp(u);
      const logLik = ((N - 1 - p) / 2) * Math.log(1 + g) - ((N - 1) / 2) * Math.log(1 + g * (1 - R2));
      const logPrior = 0.5 * Math.log(s) - lnGamma(0.5) - 1.5 * u - s / g;
      const w = i === 0 || i === steps ? 0.5 : 1;
      terms.push(Math.log(w * h) + logLik + logPrior + u);
    }
    return logSumExp(terms);
  };

  const bf10 = Math.exp(logBfAt(rScale));
  const label = evidenceLabel(bf10);
  const scales = [0.25, 0.5, 0.707, 1.0];
  const robust = scales.map((r) => ({ r, bf10: Math.exp(logBfAt(r)) }));

  return buildOutput(
    'bayesian_anova',
    `Bayesyen Tek Yönlü ANOVA (${dependent} ~ ${factor}, r = ${rScale})`,
    { dependent, factor, rScale },
    {
      k,
      N,
      R2: rNum(R2, 5),
      bf10: rNum(bf10, 5),
      bf01: rNum(1 / bf10, 5),
      evidenceTr: label.tr,
      evidenceEn: label.en,
    },
    [
      {
        id: 'ba_groups',
        title: 'Grup Tanımlayıcıları',
        columns: [
          { key: 'group', label: 'Grup' },
          { key: 'n', label: 'n', numeric: true },
          { key: 'mean', label: 'Ortalama', numeric: true },
          { key: 'sd', label: 'SS', numeric: true },
        ],
        rows: entries.map(([g, a]) => ({ group: g, n: a.length, mean: rNum(mean(a), 3), sd: rNum(Math.sqrt(variance(a, 1)), 3) })),
      },
      {
        id: 'ba_bf',
        title: 'Model Karşılaştırması (H1: grup etkisi vs H0: yalnız sabit)',
        columns: [
          { key: 'scale', label: 'r', numeric: true },
          { key: 'bf10', label: 'BF₁₀', numeric: true },
          { key: 'bf01', label: 'BF₀₁', numeric: true },
          { key: 'label', label: 'Kanıt' },
        ],
        rows: robust.map((x) => ({ scale: x.r, bf10: rNum(x.bf10, 4), bf01: rNum(1 / x.bf10, 4), label: evidenceLabel(x.bf10).tr })),
        footnotes: [`η² (örneklem) = ${fmtNum(R2, 4)}. Önsel: Zellner–Siow g-önseli, g ~ Ters-Gamma(1/2, N·r²/2).`],
      },
    ],
    [],
    `Bayesyen tek yönlü ANOVA'da BF₁₀ = ${fmtNum(bf10, 3)}, BF₀₁ = ${fmtNum(1 / bf10, 3)} (${label.tr}) bulunmuştur.`,
    `Bayesian one-way ANOVA yielded BF₁₀ = ${fmtNum(bf10, 3)}, BF₀₁ = ${fmtNum(1 / bf10, 3)} (${label.en}).`,
  );
}

/**
 * Bayes factor for a Pearson correlation using Jeffreys' (1961) approximate likelihood
 * L(ρ) ∝ (1 − ρ²)^((n−1)/2) (1 − ρr)^(−(n−3/2)) and a stretched Beta(1/κ, 1/κ) prior on ρ
 * (Ly, Verhagen & Wagenmakers, 2016). κ = 1 gives a uniform prior on [−1, 1].
 */
export function correlationBf10(r: number, n: number, kappa = 1): number {
  if (!Number.isFinite(r) || Math.abs(r) > 1 || !(n >= 3) || !(kappa > 0) || !Number.isFinite(kappa)) return NaN;
  const a = 1 / kappa;
  const logPriorConst = -Math.log(2) - lnBeta(a, a);
  const steps = 4000;
  const terms: number[] = [];
  const h = 2 / steps;
  for (let i = 1; i < steps; i++) {
    const rho = -1 + i * h;
    const logLik = ((n - 1) / 2) * Math.log(1 - rho * rho) - (n - 1.5) * Math.log(1 - rho * r);
    const logPrior = logPriorConst + (a - 1) * Math.log((1 + rho) / 2) + (a - 1) * Math.log((1 - rho) / 2);
    terms.push(Math.log(h) + logLik + logPrior);
  }
  return Math.exp(logSumExp(terms)); // L(0) = 1 under this parametrisation
}

export function runBayesianCorrelation(dataset: Dataset, var1: string, var2: string, kappa = 1): AnalysisOutput {
  const { mat } = completeNumeric(dataset.rows, [var1, var2]);
  const n = mat.length;
  if (!var1 || !var2 || var1 === var2) {
    throw new StatInputError('INVALID_VARIABLES', 'Bayesyen korelasyon için iki farklı değişken seçilmelidir.', 'Bayesian correlation requires two different variables.');
  }
  if (n < 5) {
    throw new StatInputError(
      n === 0 ? 'EMPTY_DATA' : 'INSUFFICIENT_N',
      `Bayesyen korelasyon için en az 5 tam gözlem gereklidir (bulunan: ${n}).`,
      `Bayesian correlation requires at least 5 complete observations (found: ${n}).`,
    );
  }
  assertPriorScale(kappa, 'Önsel genişlik parametresi (kappa)', 'Prior width (kappa)');
  const x = mat.map((r) => r[0]);
  const y = mat.map((r) => r[1]);
  for (const [arr, name] of [[x, var1], [y, var2]] as [number[], string][]) {
    if (isConstant(arr)) {
      throw new StatInputError('ZERO_VARIANCE', `"${name}" değişkeninin varyansı sıfır; korelasyon tanımsızdır.`, `"${name}" has zero variance; the correlation is undefined.`);
    }
  }
  const mx = mean(x);
  const my = mean(y);
  let sxy = 0;
  let sxx = 0;
  let syy = 0;
  for (let i = 0; i < n; i++) {
    sxy += (x[i] - mx) * (y[i] - my);
    sxx += (x[i] - mx) ** 2;
    syy += (y[i] - my) ** 2;
  }
  const r = Math.max(-1, Math.min(1, sxy / Math.sqrt(sxx * syy)));
  if (Math.abs(r) > 1 - 1e-10) {
    throw new StatInputError(
      'PERFECT_CORRELATION',
      `"${var1}" ile "${var2}" arasında tam doğrusal ilişki var (|r| = 1); Bayes faktörü sonsuza ıraksar.`,
      `"${var1}" and "${var2}" are perfectly linearly related (|r| = 1); the Bayes factor diverges.`,
    );
  }
  const bf10 = correlationBf10(r, n, kappa);
  const label = evidenceLabel(bf10);

  // Posterior of ρ on the same grid for a 95% credible interval
  const a = 1 / kappa;
  const grid: number[] = [];
  const logw: number[] = [];
  for (let i = 1; i < 4000; i++) {
    const rho = -1 + (i * 2) / 4000;
    grid.push(rho);
    logw.push(((n - 1) / 2) * Math.log(1 - rho * rho) - (n - 1.5) * Math.log(1 - rho * r) + (a - 1) * Math.log((1 - rho * rho) / 4));
  }
  const lse = logSumExp(logw);
  let cum = 0;
  let lo = -1;
  let hi = 1;
  let med = r;
  let loSet = false;
  let medSet = false;
  for (let i = 0; i < grid.length; i++) {
    cum += Math.exp(logw[i] - lse);
    if (!loSet && cum >= 0.025) {
      lo = grid[i];
      loSet = true;
    }
    if (!medSet && cum >= 0.5) {
      med = grid[i];
      medSet = true;
    }
    if (cum >= 0.975) {
      hi = grid[i];
      break;
    }
  }

  const kappas = [0.5, 1, 2];
  return buildOutput(
    'bayesian_correlation',
    `Bayesyen Pearson Korelasyonu (${var1} ↔ ${var2}, κ = ${kappa})`,
    { var1, var2, kappa },
    {
      n,
      r: rNum(r, 5),
      bf10: rNum(bf10, 4),
      bf01: rNum(1 / bf10, 6),
      log10Bf10: rNum(Math.log10(bf10), 3),
      rhoMedian: rNum(med, 4),
      rhoCI: [rNum(lo, 4), rNum(hi, 4)],
      evidenceTr: label.tr,
      evidenceEn: label.en,
    },
    [
      {
        id: 'bc_main',
        title: 'Bayes Faktörü ve ρ Sonsalı',
        columns: [
          { key: 'metric', label: 'Ölçüt' },
          { key: 'value', label: 'Değer' },
        ],
        rows: [
          { metric: 'n', value: n },
          { metric: 'Pearson r', value: rNum(r, 4) },
          { metric: 'BF₁₀', value: bf10 > 1e6 ? bf10.toExponential(3) : rNum(bf10, 4) },
          { metric: 'log₁₀ BF₁₀', value: rNum(Math.log10(bf10), 3) },
          { metric: 'ρ sonsal medyan', value: rNum(med, 3) },
          { metric: 'ρ %95 inanılırlık aralığı', value: `[${fmtNum(lo, 3)}, ${fmtNum(hi, 3)}]` },
          { metric: 'Kanıt', value: label.tr },
        ],
      },
      {
        id: 'bc_robust',
        title: 'Önsel Genişliği Duyarlılığı (κ)',
        columns: [
          { key: 'kappa', label: 'κ', numeric: true },
          { key: 'log10', label: 'log₁₀ BF₁₀', numeric: true },
          { key: 'label', label: 'Kanıt' },
        ],
        rows: kappas.map((kv) => {
          const b = correlationBf10(r, n, kv);
          return { kappa: kv, log10: rNum(Math.log10(b), 3), label: evidenceLabel(b).tr };
        }),
      },
    ],
    [],
    `${var1} ile ${var2} arasındaki korelasyon için r = ${fmtNum(r, 2)}, BF₁₀ = ${bf10 > 1e6 ? bf10.toExponential(2) : rNum(bf10, 2)} (${label.tr}); ρ %95 İA [${fmtNum(lo, 2)}, ${fmtNum(hi, 2)}].`,
    `For ${var1} and ${var2}, r = ${fmtNum(r, 2)}, BF₁₀ = ${bf10 > 1e6 ? bf10.toExponential(2) : rNum(bf10, 2)} (${label.en}); 95% CrI for ρ [${fmtNum(lo, 2)}, ${fmtNum(hi, 2)}].`,
  );
}

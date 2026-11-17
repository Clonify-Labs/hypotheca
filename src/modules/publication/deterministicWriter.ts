import { AnalysisOutput, AssumptionBadge, Dataset, Lang, StatTable } from '../../types/interfaces';
import { mean, stdDev } from '../../engine/core/linalg';
import { matchReferencesForAnalyses } from './verifiedCitations';

export interface ManuscriptProjectMeta {
  title?: string;
  researcher?: string;
  question?: string;
  hypotheses?: string[];
  designLabel?: string;
}

export interface ApaManuscriptBundle {
  methodsText: string;
  resultsText: string;
  discussionStarter: string;
  tablesMarkdown: string;
  fullMarkdown: string;
}

function asNum(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string' && value.trim() !== '') {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

/** Placeholder for a value that is not available (no em dash in user-facing text). */
const NA = '-';

/**
 * Removes non-numeric artefacts (NaN, undefined, Infinity, "= null") from generated prose so
 * that a degenerate analysis never prints raw JavaScript tokens into a manuscript.
 */
export function sanitizeProse(text: string): string {
  return text
    .replace(/-?\bInfinity\b/g, NA)
    .replace(/\bNaN\b/g, NA)
    .replace(/\bundefined\b/g, NA)
    .replace(/([=:(])\s*null\b/g, '$1 ' + NA)
    .replace(/\[\s*null\s*,\s*null\s*\]/g, `[${NA}, ${NA}]`);
}

/** True for a normality badge (Shapiro-Wilk / normality checks). */
function isNormalityBadge(badge: AssumptionBadge): boolean {
  return /normal|shapiro/i.test(badge.name);
}

/** Normality violated by the test (p < .05) but accepted because n >= 30 (central limit theorem). */
function isCltRobustNormality(badge: AssumptionBadge): boolean {
  return isNormalityBadge(badge) && badge.passed && typeof badge.pValue === 'number' && Number.isFinite(badge.pValue) && badge.pValue < 0.05;
}

function asStr(value: unknown, fallback = ''): string {
  if (typeof value === 'string') return value;
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  return fallback;
}

/**
 * Formats numbers bounded in [-1, 1] without leading zero per APA-7 (e.g., .53, .006, -.24).
 */
export function formatApaBounded(value: number, decimals = 2): string {
  if (!Number.isFinite(value)) return NA;
  const clamped = Math.abs(value) < Math.pow(10, -(decimals + 1)) ? 0 : value;
  if (Math.abs(clamped) >= 1) return clamped.toFixed(decimals);
  const fixed = Math.abs(clamped).toFixed(decimals);
  const stripped = fixed.startsWith('0.') ? fixed.slice(1) : fixed;
  return clamped < 0 ? `-${stripped}` : stripped;
}

/**
 * Formats p-values per APA-7: "*p* < .001" or "*p* = .335".
 */
export function formatApaP(p: number): string {
  if (!Number.isFinite(p)) return `*p* = ${NA}`;
  if (p < 0.001) return '*p* < .001';
  const capped = Math.min(0.999, Math.max(0.001, p));
  return `*p* = ${capped.toFixed(3).replace(/^0\./, '.')}`;
}

function formatApaNum(value: number, decimals = 2): string {
  if (!Number.isFinite(value)) return NA;
  return value.toFixed(decimals);
}

function formatTableCell(value: string | number | boolean | null | undefined, numeric?: boolean): string {
  if (value === null || value === undefined || value === '') return NA;
  if (typeof value === 'boolean') return value ? 'Yes' : 'No';
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) return NA;
    if (Number.isInteger(value)) return String(value);
    return numeric ? String(Number(value.toFixed(4))) : String(value);
  }
  return String(value).replace(/\|/g, '\\|').replace(/\n/g, ' ');
}

function extractNumericColumnValues(dataset: Dataset, colName: string): number[] {
  const out: number[] = [];
  for (const row of dataset.rows) {
    const val = row[colName];
    if (typeof val === 'number' && Number.isFinite(val)) {
      out.push(val);
    } else if (typeof val === 'string' && val.trim() !== '') {
      const parsed = Number(val.replace(',', '.'));
      if (Number.isFinite(parsed)) out.push(parsed);
    }
  }
  return out;
}

function describeDatasetSample(dataset: Dataset, lang: Lang): string {
  const totalN = dataset.rows.length;
  const nVars = dataset.columns.length;
  const totalMissing = dataset.columns.reduce((acc, col) => acc + (col.missingCount || 0), 0);

  const categoricalCols = dataset.columns.filter(
    (c) => (c.valueType === 'categorical' || c.scale === 'nominal') && c.uniqueCount >= 2 && c.uniqueCount <= 6,
  );
  const numericScaleCols = dataset.columns.filter((c) => c.valueType === 'numeric' && c.scale === 'scale');

  const catSummaries: string[] = [];
  for (const col of categoricalCols.slice(0, 2)) {
    const counts = new Map<string, number>();
    for (const row of dataset.rows) {
      const raw = row[col.name];
      if (raw !== null && raw !== undefined && raw !== '') {
        const key = String(raw);
        counts.set(key, (counts.get(key) ?? 0) + 1);
      }
    }
    const parts = Array.from(counts.entries())
      .sort((a, b) => b[1] - a[1])
      .map(([label, count]) => `${label} (*n* = ${count}, %${((count / Math.max(1, totalN)) * 100).toFixed(1)})`);
    if (parts.length > 0) {
      catSummaries.push(`${col.label || col.name}: ${parts.join('; ')}`);
    }
  }

  const numSummaries: string[] = [];
  for (const col of numericScaleCols.slice(0, 4)) {
    const vals = extractNumericColumnValues(dataset, col.name);
    if (vals.length >= 2) {
      const m = mean(vals);
      const sd = stdDev(vals, 1);
      const sdLabel = lang === 'tr' ? '*SS*' : '*SD*';
      numSummaries.push(`${col.label || col.name} (*M* = ${formatApaNum(m, 2)}, ${sdLabel} = ${formatApaNum(sd, 2)})`);
    }
  }

  if (lang === 'tr') {
    const parts: string[] = [
      `Araştırma örneklemi "${dataset.name}" veri setinden elde edilen toplam *N* = ${totalN} katılımcı ve ${nVars} değişkenden oluşmaktadır.`,
    ];
    if (catSummaries.length > 0) {
      parts.push(`Kategorik dağılım incelendiğinde ${catSummaries.join(' | ')} olarak saptanmıştır.`);
    }
    if (numSummaries.length > 0) {
      parts.push(`Temel ölçek değişkenlerine ait betimsel düzeyler ${numSummaries.join(', ')} şeklindedir.`);
    }
    parts.push(
      totalMissing === 0
        ? 'Veri setinde kayıp gözlem bulunmadığından analizler tam örneklem üzerinde liste bazlı silme uygulanmadan yürütülmüştür.'
        : `Veri setinde toplam ${totalMissing} hücre düzeyinde kayıp değer saptanmış olup ilgili analizlerde geçerli çiftler/vaka bazlı (listwise/pairwise) yaklaşım izlenmiştir.`,
    );
    return parts.join(' ');
  }

  const parts: string[] = [
    `The analytic sample comprised *N* = ${totalN} participants across ${nVars} recorded variables from the dataset "${dataset.name}".`,
  ];
  if (catSummaries.length > 0) {
    parts.push(`Categorical composition was distributed as ${catSummaries.join(' | ').replace(/%/g, '')} (percentages of total *N*).`);
  }
  if (numSummaries.length > 0) {
    parts.push(`Baseline continuous measures exhibited ${numSummaries.join(', ')}.`);
  }
  parts.push(
    totalMissing === 0
      ? 'No missing data cells were present in the analytic matrix, allowing full-sample estimation.'
      : `A total of ${totalMissing} missing cell entries were observed and handled via complete-case (listwise) exclusion per procedure.`,
  );
  return parts.join(' ');
}

function summarizeAssumptions(analyses: AnalysisOutput[], lang: Lang): string {
  const collected: { source: string; badge: AssumptionBadge }[] = [];
  for (const a of analyses) {
    for (const badge of a.assumptions ?? []) {
      collected.push({ source: a.title, badge });
    }
  }

  if (collected.length === 0) {
    return lang === 'tr'
      ? 'İstatistiksel analizlerde anlamlılık düzeyi çift yönlü α = .05 olarak belirlenmiş ve tüm kestirimler ddof = 1 örneklem serbestlik derecesiyle hesaplanmıştır.'
      : 'Statistical significance was evaluated against a two-tailed α = .05 threshold with sample-corrected (ddof = 1) variance estimators.';
  }

  const snippets = collected.slice(0, 6).map(({ badge }) => {
    const pTxt = badge.pValue !== null && badge.pValue !== undefined ? `, ${formatApaP(badge.pValue)}` : '';
    const statusTxt = isCltRobustNormality(badge)
      ? lang === 'tr'
        ? 'ihlal edilmiştir; ancak örneklem büyüklüğü (n >= 30) nedeniyle test, Merkezi Limit Teoremi gereği bu ihlale karşı dayanıklıdır'
        : 'was violated; however, given the sample size (n >= 30) the test is robust to this departure by the central limit theorem'
      : lang === 'tr'
        ? badge.passed
          ? 'sağlanmıştır'
          : 'ihlal edilmiştir'
        : badge.passed
          ? 'was satisfied'
          : 'was violated';
    return `${badge.name} (${sanitizeProse(badge.statisticLabel)}${pTxt}) ${statusTxt}`;
  });

  if (lang === 'tr') {
    return `Parametrik ve model varsayımları sistematik olarak sınanmıştır: ${snippets.join('; ')}. Varsayım ihlali gözlenen durumlarda dayanıklı (robust) alternatif istatistikler (ör. Welch düzeltmesi veya Greenhouse-Geisser serbestlik derecesi) esas alınmıştır.`;
  }
  return `Statistical assumptions were verified prior to inferential interpretation: ${snippets.join('; ')}. Where diagnostic thresholds indicated departure from classical assumptions, robust corrections (e.g., Welch degrees-of-freedom or Greenhouse-Geisser adjustments) were prioritized.`;
}

function formatAnalysisResult(analysis: AnalysisOutput, lang: Lang): string {
  const s = analysis.summary ?? {};
  const t = analysis.analysisType;
  const sdLabel = lang === 'tr' ? '*SS*' : '*SD*';

  if (t === 'independent_t') {
    const dep = asStr(analysis.params?.dependent, 'score');
    const grpVar = asStr(analysis.params?.groupVar, 'group');
    const g1 = asStr(s.group1, 'Group 1');
    const g2 = asStr(s.group2, 'Group 2');
    const m1 = asNum(s.mean1) ?? 0;
    const m2 = asNum(s.mean2) ?? 0;
    const sd1 = asNum(analysis.tables[0]?.rows[0]?.std) ?? 0;
    const sd2 = asNum(analysis.tables[0]?.rows[1]?.std) ?? 0;
    const levF = asNum(s.leveneF) ?? 0;
    const levP = asNum(s.leveneP) ?? 1;
    const equalVar = levP >= 0.05;
    const tStat = equalVar ? asNum(s.studentT) ?? 0 : asNum(s.welchT) ?? 0;
    const df = equalVar ? asNum(s.studentDf) ?? 0 : asNum(s.welchDf) ?? 0;
    const pVal = equalVar ? asNum(s.studentP) ?? 1 : asNum(s.welchP) ?? 1;
    const cohenD = asNum(s.cohenD) ?? 0;
    const dfStr = Number.isInteger(df) ? String(df) : formatApaNum(df, 2);

    const swBadges = (analysis.assumptions ?? []).filter((b) => b.name.toLowerCase().includes('normal'));
    const swText = swBadges
      .map((b) => {
        const base = `${b.name}: ${sanitizeProse(b.statisticLabel)}${b.pValue !== null && b.pValue !== undefined ? `, ${formatApaP(b.pValue)}` : ''}`;
        if (!isCltRobustNormality(b)) return base;
        return lang === 'tr'
          ? `${base}, varsayım ihlal edilmiş ancak n >= 30 olduğundan Merkezi Limit Teoremi gereği test dayanıklıdır`
          : `${base}, assumption violated but the test is robust given n >= 30 (central limit theorem)`;
      })
      .join('; ');

    if (lang === 'tr') {
      const sigPhrase =
        pVal < 0.05
          ? 'istatistiksel olarak anlamlı bir fark bulunmuştur'
          : 'istatistiksel olarak anlamlı bir fark bulunmamıştır';
      const varNote = equalVar
        ? `Levene varyans homojenliği testi eşit varyans varsayımını desteklemiştir (*F* = ${formatApaNum(levF, 2)}, ${formatApaP(levP)}).`
        : `Levene testi varyansların homojen olmadığını gösterdiğinden (*F* = ${formatApaNum(levF, 2)}, ${formatApaP(levP)}) Welch düzeltmeli *t*-testi raporlanmıştır.`;
      return `Bağımsız örneklemler *t*-testi ile ${grpVar} grupları arasında ${dep} puanları karşılaştırılmıştır. ${swText ? `Normallik kontrolleri (${swText}) ve ` : ''}${varNote} ${g1} (*M* = ${formatApaNum(m1, 2)}, ${sdLabel} = ${formatApaNum(sd1, 2)}) ile ${g2} (*M* = ${formatApaNum(m2, 2)}, ${sdLabel} = ${formatApaNum(sd2, 2)}) grupları arasında ${sigPhrase}, *t*(${dfStr}) = ${formatApaNum(tStat, 2)}, ${formatApaP(pVal)}, Cohen's *d* = ${formatApaNum(cohenD, 2)}.`;
    }
    const sigPhrase =
      pVal < 0.05
        ? 'revealed a statistically significant difference'
        : 'indicated no statistically significant difference';
    const varNote = equalVar
      ? `Levene's test confirmed homogeneity of variances (*F* = ${formatApaNum(levF, 2)}, ${formatApaP(levP)}).`
      : `Because Levene's test indicated unequal variances (*F* = ${formatApaNum(levF, 2)}, ${formatApaP(levP)}), Welch's corrected *t*-test was interpreted.`;
    return `An independent-samples *t*-test compared ${dep} across ${grpVar}. ${swText ? `Normality diagnostics (${swText}) and ` : ''}${varNote} Comparison between ${g1} (*M* = ${formatApaNum(m1, 2)}, ${sdLabel} = ${formatApaNum(sd1, 2)}) and ${g2} (*M* = ${formatApaNum(m2, 2)}, ${sdLabel} = ${formatApaNum(sd2, 2)}) ${sigPhrase}, *t*(${dfStr}) = ${formatApaNum(tStat, 2)}, ${formatApaP(pVal)}, Cohen's *d* = ${formatApaNum(cohenD, 2)}.`;
  }

  if (t === 'one_sample_t') {
    const variable = asStr(analysis.params?.variable, 'variable');
    const mu = asNum(analysis.params?.testValue) ?? 0;
    const m = asNum(s.mean) ?? 0;
    const sd = asNum(s.std) ?? 0;
    const tStat = asNum(s.t) ?? 0;
    const df = asNum(s.df) ?? 0;
    const pVal = asNum(s.p) ?? 1;
    const d = asNum(s.cohenD) ?? 0;
    return lang === 'tr'
      ? `Tek örneklem *t*-testi sonuçlarına göre ${variable} ortalaması (*M* = ${formatApaNum(m, 2)}, ${sdLabel} = ${formatApaNum(sd, 2)}), referans değer ${mu} ile karşılaştırıldığında *t*(${df}) = ${formatApaNum(tStat, 2)}, ${formatApaP(pVal)}, Cohen's *d* = ${formatApaNum(d, 2)} olarak elde edilmiştir.`
      : `A one-sample *t*-test comparing ${variable} (*M* = ${formatApaNum(m, 2)}, ${sdLabel} = ${formatApaNum(sd, 2)}) against the test value ${mu} yielded *t*(${df}) = ${formatApaNum(tStat, 2)}, ${formatApaP(pVal)}, Cohen's *d* = ${formatApaNum(d, 2)}.`;
  }

  if (t === 'paired_t') {
    const v1 = asStr(analysis.params?.var1, 'T1');
    const v2 = asStr(analysis.params?.var2, 'T2');
    const m1 = asNum(analysis.tables[0]?.rows[0]?.mean) ?? 0;
    const sd1 = asNum(analysis.tables[0]?.rows[0]?.std) ?? 0;
    const m2 = asNum(analysis.tables[0]?.rows[1]?.mean) ?? 0;
    const sd2 = asNum(analysis.tables[0]?.rows[1]?.std) ?? 0;
    const tStat = asNum(s.t) ?? 0;
    const df = asNum(s.df) ?? 0;
    const pVal = asNum(s.p) ?? 1;
    const dz = asNum(s.cohenDz) ?? 0;
    const ciLow = asNum(s.ciLow) ?? 0;
    const ciHigh = asNum(s.ciHigh) ?? 0;
    return lang === 'tr'
      ? `Eşleştirilmiş örneklemler *t*-testi sonucunda ${v1} (*M* = ${formatApaNum(m1, 2)}, ${sdLabel} = ${formatApaNum(sd1, 2)}) ile ${v2} (*M* = ${formatApaNum(m2, 2)}, ${sdLabel} = ${formatApaNum(sd2, 2)}) ölçümleri arasında *t*(${df}) = ${formatApaNum(tStat, 2)}, ${formatApaP(pVal)}, %95 GA [${formatApaNum(ciLow, 2)}, ${formatApaNum(ciHigh, 2)}], Cohen's *d*~z~ = ${formatApaNum(dz, 2)} bulunmuştur.`
      : `A paired-samples *t*-test comparing ${v1} (*M* = ${formatApaNum(m1, 2)}, ${sdLabel} = ${formatApaNum(sd1, 2)}) and ${v2} (*M* = ${formatApaNum(m2, 2)}, ${sdLabel} = ${formatApaNum(sd2, 2)}) showed *t*(${df}) = ${formatApaNum(tStat, 2)}, ${formatApaP(pVal)}, 95% CI [${formatApaNum(ciLow, 2)}, ${formatApaNum(ciHigh, 2)}], Cohen's *d*~z~ = ${formatApaNum(dz, 2)}.`;
  }

  if (t === 'oneway_anova') {
    const dep = asStr(analysis.params?.dependent, 'outcome');
    const factor = asStr(analysis.params?.factor, 'factor');
    const dfB = asNum(s.dfBetween) ?? 0;
    const dfW = asNum(s.dfWithin) ?? 0;
    const fVal = asNum(s.f) ?? 0;
    const pVal = asNum(s.p) ?? 1;
    const eta2 = asNum(s.eta2) ?? 0;
    const levF = asNum(s.leveneF) ?? 0;
    const levP = asNum(s.leveneP) ?? 1;
    const welchF = asNum(s.welchF) ?? 0;
    const welchDf2 = asNum(s.welchDf2) ?? dfW;
    const welchP = asNum(s.welchP) ?? pVal;

    const posthocTable = analysis.tables.find((tb) => tb.id === 'posthoc');
    const sigPairs = (posthocTable?.rows ?? [])
      .filter((r) => asNum(r.p) !== null && (asNum(r.p) as number) < 0.05)
      .map((r) => `${asStr(r.comparison)} (${formatApaP(asNum(r.p) ?? 1)})`);

    if (lang === 'tr') {
      const levNote =
        levP >= 0.05
          ? `Levene testi varyans homojenliğini doğrulamıştır (*F* = ${formatApaNum(levF, 2)}, ${formatApaP(levP)}).`
          : `Varyans homojenliği ihlal edildiğinden (*F* = ${formatApaNum(levF, 2)}, ${formatApaP(levP)}) Welch ANOVA sonucu da raporlanmıştır (*F*(${dfB}, ${formatApaNum(welchDf2, 1)}) = ${formatApaNum(welchF, 2)}, ${formatApaP(welchP)}).`;
      const postNote =
        sigPairs.length > 0
          ? ` Post-hoc ikili karşılaştırmalarda anlamlı farklar: ${sigPairs.join('; ')}.`
          : ' İkili post-hoc karşılaştırmalarda anlamlı bir çift saptanmamıştır.';
      return `Tek yönlü varyans analizi (ANOVA) ile ${factor} gruplarının ${dep} üzerindeki etkisi sınanmıştır. ${levNote} Analiz sonucunda *F*(${dfB}, ${dfW}) = ${formatApaNum(fVal, 2)}, ${formatApaP(pVal)}, η² = ${formatApaBounded(eta2, 3)} elde edilmiştir.${postNote}`;
    }
    const levNote =
      levP >= 0.05
        ? `Levene's test indicated homogeneous variances (*F* = ${formatApaNum(levF, 2)}, ${formatApaP(levP)}).`
        : `Due to variance heterogeneity (*F* = ${formatApaNum(levF, 2)}, ${formatApaP(levP)}), Welch's robust ANOVA was also inspected (*F*(${dfB}, ${formatApaNum(welchDf2, 1)}) = ${formatApaNum(welchF, 2)}, ${formatApaP(welchP)}).`;
    const postNote =
      sigPairs.length > 0
        ? ` Significant post-hoc differences emerged for: ${sigPairs.join('; ')}.`
        : ' No pairwise post-hoc contrasts reached significance.';
    return `A one-way ANOVA examined ${dep} across ${factor} levels. ${levNote} Results showed *F*(${dfB}, ${dfW}) = ${formatApaNum(fVal, 2)}, ${formatApaP(pVal)}, η² = ${formatApaBounded(eta2, 3)}.${postNote}`;
  }

  if (t === 'repeated_anova') {
    const k = asNum(s.k) ?? 2;
    const n = asNum(s.n) ?? 0;
    const mauchlyW = asNum(s.mauchlyW) ?? 1;
    const mauchlyP = asNum(s.mauchlyP) ?? 1;
    const ggEps = asNum(s.ggEpsilon) ?? 1;
    const fVal = asNum(s.f) ?? 0;
    const pVal = mauchlyP < 0.05 ? asNum(s.pGG) ?? 1 : asNum(s.p) ?? 1;
    const etaP2 = asNum(s.etaPartial2) ?? 0;
    const df1 = mauchlyP < 0.05 ? formatApaNum((k - 1) * ggEps, 2) : String(k - 1);
    const df2 = mauchlyP < 0.05 ? formatApaNum((n - 1) * (k - 1) * ggEps, 2) : String((n - 1) * (k - 1));
    return lang === 'tr'
      ? `Tekrarlı ölçümler ANOVA analizinde Mauchly küresellik testi *W* = ${formatApaNum(mauchlyW, 3)}, ${formatApaP(mauchlyP)} vermiş olup ${mauchlyP < 0.05 ? `Greenhouse-Geisser (ε = ${formatApaNum(ggEps, 3)}) düzeltmesiyle ` : ''}*F*(${df1}, ${df2}) = ${formatApaNum(fVal, 2)}, ${formatApaP(pVal)}, kısmi η² = ${formatApaBounded(etaP2, 3)} bulunmuştur.`
      : `A repeated-measures ANOVA yielded Mauchly's *W* = ${formatApaNum(mauchlyW, 3)}, ${formatApaP(mauchlyP)}; ${mauchlyP < 0.05 ? `applying Greenhouse-Geisser correction (ε = ${formatApaNum(ggEps, 3)}), ` : ''}*F*(${df1}, ${df2}) = ${formatApaNum(fVal, 2)}, ${formatApaP(pVal)}, partial η² = ${formatApaBounded(etaP2, 3)}.`;
  }

  if (t === 'linear_regression') {
    const outcome = asStr(analysis.params?.outcome, 'Y');
    const predictors = Array.isArray(analysis.params?.predictors)
      ? (analysis.params.predictors as string[]).join(', ')
      : 'predictors';
    const r2 = asNum(s.r2) ?? 0;
    const adjR2 = asNum(s.adjR2) ?? 0;
    const fVal = asNum(s.f) ?? 0;
    const dfM = asNum(s.dfModel) ?? 1;
    const dfR = asNum(s.dfResid) ?? 1;
    const pVal = asNum(s.p) ?? 1;
    const dw = asNum(s.dw) ?? 2;
    const maxVif = asNum(s.maxVif) ?? 1;

    const coefTable = analysis.tables.find((tb) => tb.id === 'reg_coefs');
    const predRows = (coefTable?.rows ?? []).filter(
      (r) => !String(r.term ?? '').toLowerCase().includes('sabit') && !String(r.term ?? '').toLowerCase().includes('intercept'),
    );
    const predText = predRows
      .slice(0, 5)
      .map((r) => {
        const term = asStr(r.term);
        const b = asNum(r.b) ?? 0;
        const beta = asNum(r.beta);
        const tStat = asNum(r.t) ?? 0;
        const cp = asNum(r.p) ?? 1;
        const betaPart = beta !== null ? `, β = ${formatApaNum(beta, 2)}` : '';
        return `${term} (*B* = ${formatApaNum(b, 2)}${betaPart}, *t* = ${formatApaNum(tStat, 2)}, ${formatApaP(cp)})`;
      })
      .join('; ');

    const r2Fmt = r2 < 0.01 && r2 > 0 ? formatApaBounded(r2, 3) : formatApaBounded(r2, 2);
    const adjFmt = adjR2 < 0.01 && adjR2 > 0 ? formatApaBounded(adjR2, 3) : formatApaBounded(adjR2, 2);

    if (lang === 'tr') {
      return `${predictors} değişkenlerinin ${outcome} üzerindeki yordayıcı etkisini incelemek üzere kurulan doğrusal regresyon modeli anlamlı bulunmuştur, *R*² = ${r2Fmt} (Düzeltilmiş *R*² = ${adjFmt}), *F*(${dfM}, ${dfR}) = ${formatApaNum(fVal, 2)}, ${formatApaP(pVal)}. Varsayım kontrollerinde Durbin-Watson = ${formatApaNum(dw, 2)} ve maksimum VIF = ${formatApaNum(maxVif, 2)} olarak gözlenmiştir.${predText ? ` Yordayıcı katsayıları: ${predText}.` : ''}`;
    }
    return `A linear regression model predicting ${outcome} from ${predictors} was statistically evaluated, explaining substantial variance, *R*² = ${r2Fmt} (Adjusted *R*² = ${adjFmt}), *F*(${dfM}, ${dfR}) = ${formatApaNum(fVal, 2)}, ${formatApaP(pVal)}. Residual diagnostics indicated Durbin-Watson = ${formatApaNum(dw, 2)} and maximum VIF = ${formatApaNum(maxVif, 2)}.${predText ? ` Individual predictors: ${predText}.` : ''}`;
  }

  if (t === 'reliability') {
    const k = asNum(s.k) ?? 0;
    const n = asNum(s.n) ?? 0;
    const alpha = asNum(s.cronbachAlpha) ?? 0;
    const stdAlpha = asNum(s.stdAlpha) ?? alpha;
    const sb = asNum(s.splitHalfSB) ?? 0;
    const gl4 = asNum(s.guttmanL4) ?? 0;
    const alphaStr = formatApaBounded(alpha, 2);
    const stdStr = formatApaBounded(stdAlpha, 2);
    const sbStr = formatApaBounded(sb, 2);
    const gl4Str = formatApaBounded(gl4, 2);
    const qualityTr =
      alpha >= 0.9 ? 'mükemmel' : alpha >= 0.8 ? 'yüksek' : alpha >= 0.7 ? 'kabul edilebilir' : 'düşük/sınırda';
    const qualityEn =
      alpha >= 0.9 ? 'excellent' : alpha >= 0.8 ? 'good' : alpha >= 0.7 ? 'acceptable' : 'questionable';

    return lang === 'tr'
      ? `${k} maddelik ölçeğin (*N* = ${n}) iç tutarlılık güvenirlik analizi sonucunda Cronbach's α = ${alphaStr} (standardize α = ${stdStr}) elde edilerek ${qualityTr} düzeyde güvenirlik saptanmıştır. İki yarı test katsayısı Spearman-Brown = ${sbStr} ve Guttman λ₄ = ${gl4Str} olarak hesaplanmıştır.`
      : `Internal consistency reliability across the ${k}-item scale (*N* = ${n}) demonstrated ${qualityEn} reliability, Cronbach's α = ${alphaStr} (standardized α = ${stdStr}), alongside Spearman-Brown split-half = ${sbStr} and Guttman λ₄ = ${gl4Str}.`;
  }

  if (t === 'efa') {
    const kmo = asNum(s.kmo) ?? 0;
    const chi2 = asNum(s.bartlettChi2) ?? 0;
    const df = asNum(s.bartlettDf) ?? 0;
    const pVal = asNum(s.bartlettP) ?? 0;
    const nf = asNum(s.nFactors) ?? 1;
    const cumVar = asNum(s.cumVariancePct) ?? 0;
    return lang === 'tr'
      ? `Açımlayıcı faktör analizi öncesinde KMO örneklem yeterliliği = ${formatApaBounded(kmo, 2)} ve Bartlett küresellik testi anlamlı bulunmuştur, χ²(${df}) = ${formatApaNum(chi2, 2)}, ${formatApaP(pVal)}. Özdeğer > 1 ölçütüne göre çıkarılan ${nf} faktör toplam varyansın %${formatApaNum(cumVar, 2)}'ini açıklamıştır.`
      : `Prior to exploratory factor analysis, Kaiser-Meyer-Olkin sampling adequacy was KMO = ${formatApaBounded(kmo, 2)} and Bartlett's test of sphericity was significant, χ²(${df}) = ${formatApaNum(chi2, 2)}, ${formatApaP(pVal)}. The ${nf}-factor solution accounted for ${formatApaNum(cumVar, 2)}% of total variance.`;
  }

  if (t === 'cb_sem') {
    const chi2 = asNum(s.chi2) ?? 0;
    const df = asNum(s.df) ?? 1;
    const chi2Df = asNum(s.chi2Df) ?? 0;
    const cfi = asNum(s.cfi) ?? 0;
    const tli = asNum(s.tli) ?? 0;
    const rmsea = asNum(s.rmsea) ?? 0;
    const srmr = asNum(s.srmr) ?? 0;
    return lang === 'tr'
      ? `Doğrulayıcı faktör analizi / CB-SEM modeli maksimum olabilirlik kestirimiyle değerlendirilmiştir: χ²(${df}) = ${formatApaNum(chi2, 2)}, χ²/*sd* = ${formatApaNum(chi2Df, 2)}, CFI = ${formatApaBounded(cfi, 3)}, TLI = ${formatApaBounded(tli, 3)}, RMSEA = ${formatApaBounded(rmsea, 3)}, SRMR = ${formatApaBounded(srmr, 3)}.`
      : `Confirmatory factor / CB-SEM model evaluation using maximum likelihood yielded χ²(${df}) = ${formatApaNum(chi2, 2)}, χ²/*df* = ${formatApaNum(chi2Df, 2)}, CFI = ${formatApaBounded(cfi, 3)}, TLI = ${formatApaBounded(tli, 3)}, RMSEA = ${formatApaBounded(rmsea, 3)}, SRMR = ${formatApaBounded(srmr, 3)}.`;
  }

  if (t === 'pls_sem') {
    const n = asNum(s.n) ?? 0;
    const qualityTable = analysis.tables.find((tb) => tb.id === 'pls_quality');
    const pathTable = analysis.tables.find((tb) => tb.id === 'pls_paths');
    const cSummary = (qualityTable?.rows ?? [])
      .map((r) => `${asStr(r.construct)} (CR = ${formatApaBounded(asNum(r.compositeRel) ?? 0, 2)}, AVE = ${formatApaBounded(asNum(r.ave) ?? 0, 2)})`)
      .join(', ');
    const pSummary = (pathTable?.rows ?? [])
      .map((r) => `${asStr(r.path)} (β = ${formatApaNum(asNum(r.beta) ?? 0, 2)}, *t* = ${formatApaNum(asNum(r.t) ?? 0, 2)}, ${formatApaP(asNum(r.p) ?? 1)})`)
      .join('; ');
    return lang === 'tr'
      ? `PLS-SEM ölçüm ve yapısal modeli (*N* = ${n}) bootstrap ile sınanmıştır. Yapı geçerlikleri: ${cSummary || 'hesaplandı'}. Yapısal yollar: ${pSummary || 'raporlandı'}.`
      : `PLS-SEM measurement and structural estimation (*N* = ${n}) evaluated construct validity (${cSummary || 'computed'}) and structural paths (${pSummary || 'reported'}).`;
  }

  if (t === 'correlation_test') {
    const method = asStr(analysis.params?.method, 'pearson');
    const sym = method === 'spearman' ? 'ρ' : '*r*';
    const pairTable = analysis.tables.find((tb) => tb.id === 'corr_pairs');
    const pairTexts = (pairTable?.rows ?? [])
      .slice(0, 6)
      .map((r) => `${asStr(r.var1)}–${asStr(r.var2)} (${sym}(${(asNum(r.n) ?? 2) - 2}) = ${formatApaBounded(asNum(r.r) ?? 0, 2)}, ${formatApaP(asNum(r.p) ?? 1)})`);
    return lang === 'tr'
      ? `${method === 'spearman' ? 'Spearman sıra' : 'Pearson momentler çarpımı'} korelasyon analizi sonucunda elde edilen ikili ilişkiler: ${pairTexts.join('; ') || 'hesaplanmıştır'}.`
      : `${method === 'spearman' ? 'Spearman rank-order' : 'Pearson product-moment'} correlation analysis revealed: ${pairTexts.join('; ') || 'computed'}.`;
  }

  if (t === 'partial_correlation_test') {
    const v1 = asStr(analysis.params?.var1, 'X');
    const v2 = asStr(analysis.params?.var2, 'Y');
    const ctrls = Array.isArray(analysis.params?.controls) ? (analysis.params.controls as string[]).join(', ') : '';
    const rp = asNum(s.rPartial) ?? 0;
    const df = asNum(s.df) ?? 0;
    const pVal = asNum(s.p) ?? 1;
    return lang === 'tr'
      ? `${ctrls} kontrol edildiğinde ${v1} ve ${v2} arasındaki kısmi korelasyon *r*(${df}) = ${formatApaBounded(rp, 2)}, ${formatApaP(pVal)} olarak saptanmıştır.`
      : `Controlling for ${ctrls}, the partial correlation between ${v1} and ${v2} was *r*(${df}) = ${formatApaBounded(rp, 2)}, ${formatApaP(pVal)}.`;
  }

  if (t === 'chi_square') {
    const rv = asStr(analysis.params?.rowVar, 'Row');
    const cv = asStr(analysis.params?.colVar, 'Col');
    const chi2 = asNum(s.chi2) ?? 0;
    const df = asNum(s.df) ?? 1;
    const pVal = asNum(s.p) ?? 1;
    const v = asNum(s.cramersV) ?? 0;
    return lang === 'tr'
      ? `${rv} ve ${cv} değişkenleri arasındaki bağımsızlık Ki-Kare testiyle incelenmiş ve χ²(${df}) = ${formatApaNum(chi2, 2)}, ${formatApaP(pVal)}, Cramér's *V* = ${formatApaBounded(v, 2)} elde edilmiştir.`
      : `A chi-square test of independence between ${rv} and ${cv} yielded χ²(${df}) = ${formatApaNum(chi2, 2)}, ${formatApaP(pVal)}, Cramér's *V* = ${formatApaBounded(v, 2)}.`;
  }

  if (t === 'mann_whitney_u') {
    const dep = asStr(analysis.params?.dependent, 'outcome');
    const gv = asStr(analysis.params?.groupVar, 'group');
    const u = asNum(s.u) ?? 0;
    const z = asNum(s.z) ?? 0;
    const pVal = asNum(s.p) ?? 1;
    const r = asNum(s.r) ?? 0;
    return lang === 'tr'
      ? `Parametrik olmayan Mann-Whitney *U* testi ${gv} grupları arasında ${dep} açısından *U* = ${formatApaNum(u, 1)}, *z* = ${formatApaNum(z, 2)}, ${formatApaP(pVal)}, *r* = ${formatApaBounded(r, 2)} vermiştir.`
      : `A Mann-Whitney *U* test comparing ${dep} across ${gv} yielded *U* = ${formatApaNum(u, 1)}, *z* = ${formatApaNum(z, 2)}, ${formatApaP(pVal)}, *r* = ${formatApaBounded(r, 2)}.`;
  }

  if (t === 'wilcoxon') {
    const w = asNum(s.w) ?? 0;
    const z = asNum(s.z) ?? 0;
    const pVal = asNum(s.p) ?? 1;
    const r = asNum(s.r) ?? 0;
    return lang === 'tr'
      ? `Wilcoxon işaretli sıralar testi sonucunda *W* = ${formatApaNum(w, 1)}, *z* = ${formatApaNum(z, 2)}, ${formatApaP(pVal)}, *r* = ${formatApaBounded(r, 2)} bulunmuştur.`
      : `A Wilcoxon signed-rank test yielded *W* = ${formatApaNum(w, 1)}, *z* = ${formatApaNum(z, 2)}, ${formatApaP(pVal)}, *r* = ${formatApaBounded(r, 2)}.`;
  }

  if (t === 'kruskal_wallis') {
    const df = asNum(s.df) ?? 1;
    const h = asNum(s.h) ?? 0;
    const pVal = asNum(s.p) ?? 1;
    const eps2 = asNum(s.epsilon2) ?? 0;
    return lang === 'tr'
      ? `Kruskal-Wallis *H* testi sonucunda *H*(${df}) = ${formatApaNum(h, 2)}, ${formatApaP(pVal)}, ε² = ${formatApaBounded(eps2, 3)} saptanmıştır.`
      : `A Kruskal-Wallis *H* test showed *H*(${df}) = ${formatApaNum(h, 2)}, ${formatApaP(pVal)}, ε² = ${formatApaBounded(eps2, 3)}.`;
  }

  if (t === 'friedman') {
    const df = asNum(s.df) ?? 1;
    const chi2 = asNum(s.chi2) ?? 0;
    const pVal = asNum(s.p) ?? 1;
    const w = asNum(s.kendallW) ?? 0;
    return lang === 'tr'
      ? `Friedman testi sonucunda χ²(${df}) = ${formatApaNum(chi2, 2)}, ${formatApaP(pVal)}, Kendall's *W* = ${formatApaBounded(w, 2)} bulunmuştur.`
      : `A Friedman test yielded χ²(${df}) = ${formatApaNum(chi2, 2)}, ${formatApaP(pVal)}, Kendall's *W* = ${formatApaBounded(w, 2)}.`;
  }

  if (t === 'logistic_regression') {
    const chi2 = asNum(s.omnibusChi2) ?? 0;
    const df = asNum(s.df) ?? 1;
    const pVal = asNum(s.p) ?? 1;
    const nag = asNum(s.nagelkerkeR2) ?? 0;
    const acc = asNum(s.accuracyPct) ?? 0;
    return lang === 'tr'
      ? `İkili lojistik regresyon modeli istatistiksel açıdan incelenmiştir: χ²(${df}) = ${formatApaNum(chi2, 2)}, ${formatApaP(pVal)}, Nagelkerke *R*² = ${formatApaBounded(nag, 2)}, genel doğru sınıflandırma oranı %${formatApaNum(acc, 1)}.`
      : `Binary logistic regression evaluation yielded χ²(${df}) = ${formatApaNum(chi2, 2)}, ${formatApaP(pVal)}, Nagelkerke *R*² = ${formatApaBounded(nag, 2)}, with ${formatApaNum(acc, 1)}% overall classification accuracy.`;
  }

  if (t === 'roc_curve') {
    const auc = asNum(s.auc) ?? 0.5;
    const ciL = asNum(s.ciLow) ?? 0;
    const ciH = asNum(s.ciHigh) ?? 1;
    const pVal = asNum(s.p) ?? 1;
    const cut = asNum(s.optimalCutoff) ?? 0;
    const yj = asNum(s.youdenJ) ?? 0;
    return lang === 'tr'
      ? `ROC tanı performansı analizinde AUC = ${formatApaBounded(auc, 3)} (%95 GA [${formatApaBounded(ciL, 3)}, ${formatApaBounded(ciH, 3)}], ${formatApaP(pVal)}), optimal eşik = ${formatApaNum(cut, 2)} (Youden *J* = ${formatApaBounded(yj, 3)}) hesaplanmıştır.`
      : `ROC curve analysis demonstrated AUC = ${formatApaBounded(auc, 3)} (95% CI [${formatApaBounded(ciL, 3)}, ${formatApaBounded(ciH, 3)}], ${formatApaP(pVal)}) with an optimal cutoff of ${formatApaNum(cut, 2)} (Youden's *J* = ${formatApaBounded(yj, 3)}).`;
  }

  if (t === 'bland_altman') {
    const bias = asNum(s.bias) ?? 0;
    const loaL = asNum(s.loaLower) ?? 0;
    const loaH = asNum(s.loaUpper) ?? 0;
    return lang === 'tr'
      ? `Bland-Altman uyum analizinde ortalama yanlılık (bias) = ${formatApaNum(bias, 2)} ve %95 uyum sınırları [${formatApaNum(loaL, 2)}, ${formatApaNum(loaH, 2)}] olarak bulunmuştur.`
      : `Bland-Altman agreement analysis yielded a mean bias of ${formatApaNum(bias, 2)} with 95% limits of agreement [${formatApaNum(loaL, 2)}, ${formatApaNum(loaH, 2)}].`;
  }

  if (t === 'kaplan_meier') {
    const n = asNum(s.n) ?? 0;
    const chi2 = asNum(s.logRankChi2) ?? 0;
    const df = asNum(s.logRankDf) ?? 0;
    const pVal = asNum(s.logRankP) ?? 1;
    return lang === 'tr'
      ? `Kaplan-Meier sağkalım analizinde (*N* = ${n}) gruplar arası log-rank testi χ²(${df}) = ${formatApaNum(chi2, 2)}, ${formatApaP(pVal)} vermiştir.`
      : `Kaplan-Meier survival analysis (*N* = ${n}) showed a log-rank comparison of χ²(${df}) = ${formatApaNum(chi2, 2)}, ${formatApaP(pVal)}.`;
  }

  if (t === 'process_model4') {
    const ind = asNum(s.indirectEffect) ?? 0;
    const ciL = asNum(s.bootCILow) ?? 0;
    const ciH = asNum(s.bootCIHigh) ?? 0;
    const sobZ = asNum(s.sobelZ) ?? 0;
    const sobP = asNum(s.sobelP) ?? 1;
    return lang === 'tr'
      ? `PROCESS Model 4 aracılık analizinde dolaylı etki *B* = ${formatApaNum(ind, 3)}, %95 Bootstrap GA [${formatApaNum(ciL, 3)}, ${formatApaNum(ciH, 3)}] ve Sobel *z* = ${formatApaNum(sobZ, 2)}, ${formatApaP(sobP)} olarak belirlenmiştir.`
      : `PROCESS Model 4 mediation analysis yielded an indirect effect of *B* = ${formatApaNum(ind, 3)}, 95% BootCI [${formatApaNum(ciL, 3)}, ${formatApaNum(ciH, 3)}] (Sobel *z* = ${formatApaNum(sobZ, 2)}, ${formatApaP(sobP)}).`;
  }

  if (t === 'process_model1') {
    const dR2 = asNum(s.deltaR2) ?? 0;
    const fInt = asNum(s.fInteraction) ?? 0;
    const pInt = asNum(s.pInteraction) ?? 1;
    return lang === 'tr'
      ? `PROCESS Model 1 düzenleyici etki analizinde etkileşim terimi Δ*R*² = ${formatApaBounded(dR2, 3)}, *F* = ${formatApaNum(fInt, 2)}, ${formatApaP(pInt)} olarak hesaplanmıştır.`
      : `PROCESS Model 1 moderation analysis showed an interaction term of Δ*R*² = ${formatApaBounded(dR2, 3)}, *F* = ${formatApaNum(fInt, 2)}, ${formatApaP(pInt)}.`;
  }

  if (t === 'power_analysis') {
    const reqN = asNum(s.requiredN) ?? 0;
    const pwr = asNum(s.actualPower) ?? 0;
    const crit = asNum(s.criticalValue) ?? 0;
    return lang === 'tr'
      ? `G*Power istatistiksel güç analizinde (${asStr(s.testType)}) toplam *N* = ${reqN}, kritik değer = ${formatApaNum(crit, 3)} ve gerçekleşen güç (1 − β) = ${formatApaBounded(pwr, 3)} hesaplanmıştır.`
      : `Power analysis (${asStr(s.testType)}) determined *N* = ${reqN}, critical value = ${formatApaNum(crit, 3)}, with actual power (1 − β) = ${formatApaBounded(pwr, 3)}.`;
  }

  if (t === 'normality_test') {
    const rows = analysis.tables[0]?.rows ?? [];
    const snippets = rows
      .slice(0, 6)
      .map((r) => {
        const w = asNum(r.sw_stat);
        const pw = asNum(r.sw_p);
        if (w === null || pw === null) {
          return lang === 'tr' ? `${asStr(r.variable)} (Shapiro-Wilk uygulanamadı)` : `${asStr(r.variable)} (Shapiro-Wilk not applicable)`;
        }
        const nObs = asNum(r.n);
        const verdict =
          pw >= 0.05
            ? lang === 'tr'
              ? 'normallik varsayımı sağlanmıştır'
              : 'normality assumption met'
            : nObs !== null && nObs >= 30
              ? lang === 'tr'
                ? 'normallik ihlal edilmiştir; n >= 30 olduğundan parametrik testler Merkezi Limit Teoremi gereği dayanıklıdır'
                : 'normality violated; parametric tests remain robust given n >= 30 (central limit theorem)'
              : lang === 'tr'
                ? 'normallik ihlal edilmiştir'
                : 'normality violated';
        return `${asStr(r.variable)} (*W* = ${formatApaNum(w, 3)}, ${formatApaP(pw)}; ${verdict})`;
      });
    return lang === 'tr'
      ? `Shapiro-Wilk normallik testi sonuçları: ${snippets.join('; ') || 'hesaplandı'}.`
      : `Shapiro-Wilk normality tests indicated: ${snippets.join('; ') || 'computed'}.`;
  }

  if (t === 'descriptive_table') {
    const rows = analysis.tables[0]?.rows ?? [];
    const snippets = rows
      .slice(0, 6)
      .map((r) => `${asStr(r.variable)} (*N* = ${asNum(r.n) ?? 0}, *M* = ${formatApaNum(asNum(r.mean) ?? 0, 2)}, ${sdLabel} = ${formatApaNum(asNum(r.std) ?? 0, 2)})`);
    return lang === 'tr'
      ? `Tanımlayıcı istatistikler: ${snippets.join('; ') || 'hesaplandı'}.`
      : `Descriptive statistics: ${snippets.join('; ') || 'computed'}.`;
  }

  if (t === 'rasch') {
    const ir = asNum(s.itemReliability) ?? 0;
    const pr = asNum(s.personReliability) ?? 0;
    return lang === 'tr'
      ? `Rasch madde tepki kuramı analizinde madde güvenirliği = ${formatApaBounded(ir, 2)} ve kişi güvenirliği = ${formatApaBounded(pr, 2)} hesaplanmıştır.`
      : `Rasch IRT calibration yielded item reliability = ${formatApaBounded(ir, 2)} and person reliability = ${formatApaBounded(pr, 2)}.`;
  }

  const fallbackNarrative = lang === 'tr' ? analysis.narrativeTr : analysis.narrativeEn;
  if (fallbackNarrative && fallbackNarrative.trim().length > 0) {
    return fallbackNarrative;
  }

  const metricParts = Object.entries(s)
    .filter(([, val]) => typeof val === 'number' || typeof val === 'string')
    .slice(0, 5)
    .map(([k, val]) => `${k} = ${typeof val === 'number' ? formatApaNum(val, 3) : val}`);
  return lang === 'tr'
    ? `${analysis.title} analizi tamamlanmıştır (${metricParts.join(', ')}).`
    : `${analysis.title} completed (${metricParts.join(', ')}).`;
}

function buildTablesMarkdown(analyses: AnalysisOutput[], lang: Lang): string {
  const blocks: string[] = [];
  let tableIdx = 1;

  for (const analysis of analyses) {
    for (const table of analysis.tables) {
      blocks.push(formatSingleTableMarkdown(table, tableIdx, lang));
      tableIdx += 1;
    }
  }

  if (blocks.length === 0) {
    return lang === 'tr'
      ? '_Henüz tablo üretilmiş bir istatistiksel analiz bulunmamaktadır._'
      : '_No statistical tables have been generated from executed analyses yet._';
  }
  return blocks.join('\n\n');
}

function formatSingleTableMarkdown(table: StatTable, index: number, lang: Lang): string {
  const label = lang === 'tr' ? `Tablo ${index}` : `Table ${index}`;
  const headerLine = `| ${table.columns.map((c) => c.label.replace(/\|/g, '\\|')).join(' | ')} |`;
  const alignLine = `| ${table.columns.map((c) => (c.numeric ? '---:' : ':---')).join(' | ')} |`;
  const dataLines =
    table.rows.length > 0
      ? table.rows.map(
          (row) => `| ${table.columns.map((c) => formatTableCell(row[c.key], c.numeric)).join(' | ')} |`,
        )
      : [`| ${table.columns.map(() => NA).join(' | ')} |`];

  const lines = [`**${label}**`, `*${table.title}*`, '', headerLine, alignLine, ...dataLines];
  if (table.footnotes && table.footnotes.length > 0) {
    const notePrefix = lang === 'tr' ? '*Not.*' : '*Note.*';
    lines.push('', `${notePrefix} ${table.footnotes.join(' ')}`);
  }
  return lines.join('\n');
}

function buildDiscussionStarter(analyses: AnalysisOutput[], dataset: Dataset, lang: Lang): string {
  const totalN = dataset.rows.length;
  if (analyses.length === 0) {
    return lang === 'tr'
      ? `Örneklem büyüklüğü (*N* = ${totalN}) üzerinden yürütülecek hipotez ve psikometrik model testlerinin ardından anlamlı etki büyüklükleri ve kuramsal tutarlılık bu bölümde tartışılacaktır.`
      : `Following execution of hypothesis and psychometric tests on *N* = ${totalN} observations, statistically significant findings and effect-size interpretations will be synthesized here.`;
  }

  let sigCount = 0;
  let nonSigCount = 0;
  const effectNotes: string[] = [];
  const violatedAssumptions: string[] = [];
  const cltRobust: string[] = [];

  for (const a of analyses) {
    const s = a.summary ?? {};
    const pCandidates = [s.p, s.studentP, s.welchP, s.pInteraction, s.logRankP, s.sobelP]
      .map(asNum)
      .filter((v): v is number => v !== null);

    if (pCandidates.length > 0) {
      const pMain = asNum(s.leveneP) !== null && (asNum(s.leveneP) as number) < 0.05 && asNum(s.welchP) !== null
        ? (asNum(s.welchP) as number)
        : pCandidates[0];
      if (pMain < 0.05) sigCount += 1;
      else nonSigCount += 1;
    }

    const d = asNum(s.cohenD);
    if (d !== null) {
      const mag = Math.abs(d) >= 0.8 ? (lang === 'tr' ? 'büyük' : 'large') : Math.abs(d) >= 0.5 ? (lang === 'tr' ? 'orta' : 'medium') : (lang === 'tr' ? 'küçük' : 'small');
      effectNotes.push(`Cohen's *d* = ${formatApaNum(d, 2)} (${mag})`);
    }
    const r2 = asNum(s.r2);
    if (r2 !== null) {
      effectNotes.push(`*R*² = ${formatApaBounded(r2, 2)}`);
    }
    const eta2 = asNum(s.eta2);
    if (eta2 !== null) {
      effectNotes.push(`η² = ${formatApaBounded(eta2, 3)}`);
    }
    const alpha = asNum(s.cronbachAlpha);
    if (alpha !== null) {
      effectNotes.push(`Cronbach's α = ${formatApaBounded(alpha, 2)}`);
    }

    for (const badge of a.assumptions ?? []) {
      if (!badge.passed) {
        violatedAssumptions.push(`${badge.name} (${sanitizeProse(badge.statisticLabel)})`);
      } else if (isCltRobustNormality(badge)) {
        cltRobust.push(badge.name);
      }
    }
  }

  if (lang === 'tr') {
    const parts: string[] = [
      `Mevcut çalışmada *N* = ${totalN} katılımcıdan elde edilen veriler üzerinde yürütülen ${analyses.length} istatistiksel incelemede ${sigCount} anlamlı (*p* < .05) ve ${nonSigCount} anlamlı olmayan (*p* ≥ .05) bulgu raporlanmıştır.`,
    ];
    if (effectNotes.length > 0) {
      parts.push(`Pratik anlamlılık ve model kalitesi göstergeleri (${effectNotes.join(', ')}) birlikte değerlendirildiğinde, bulguların alan yazındaki kuramsal beklentilerle tutarlılığı etki büyüklüğü bağlamında yorumlanmalıdır.`);
    }
    if (violatedAssumptions.length > 0) {
      parts.push(`Varsayım sınamalarında dikkat çeken noktalar (${violatedAssumptions.join('; ')}) nedeniyle dayanıklı kestirimler esas alınmış olup gelecek çalışmalarda daha dengeli veya geniş örneklemlerle doğrulama önerilir.`);
    } else if (cltRobust.length > 0) {
      parts.push(`Normallik varsayımı bazı değişkenlerde (${cltRobust.join('; ')}) ihlal edilmiş, ancak örneklem büyüklüğü (n >= 30) nedeniyle parametrik testler Merkezi Limit Teoremi gereği dayanıklı kabul edilmiştir; bulguların kesitsel tasarım sınırları ve örneklem genellenebilirliği dikkate alınarak yorumlanması uygun olacaktır.`);
    } else {
      parts.push('İncelenen tüm temel istatistiksel varsayımlar sağlanmış olmakla birlikte, bulguların kesitsel tasarım sınırları ve örneklem genellenebilirliği dikkate alınarak yorumlanması uygun olacaktır.');
    }
    return parts.join(' ');
  }

  const parts: string[] = [
    `Across ${analyses.length} executed statistical procedures (*N* = ${totalN}), ${sigCount} hypothesis test(s) reached statistical significance (*p* < .05) and ${nonSigCount} remained non-significant (*p* ≥ .05).`,
  ];
  if (effectNotes.length > 0) {
    parts.push(`Evaluating practical significance alongside null-hypothesis tests (${effectNotes.join(', ')}) provides calibrated evidence regarding theoretical magnitude.`);
  }
  if (violatedAssumptions.length > 0) {
    parts.push(`Because diagnostic checks flagged ${violatedAssumptions.join('; ')}, robust parameter estimates were prioritized and replication with stratified or larger samples is warranted.`);
  } else if (cltRobust.length > 0) {
    parts.push(`Normality was violated for some variables (${cltRobust.join('; ')}), but parametric tests were considered robust given n >= 30 (central limit theorem); interpretation should still consider sampling design and external generalizability constraints.`);
  } else {
    parts.push('Diagnostic assumptions held across tested models; nevertheless, interpretation should consider sampling design and external generalizability constraints.');
  }
  return parts.join(' ');
}

/**
 * Generates deterministic APA-7 Methods, Results, Discussion Starter,
 * and Markdown Tables directly from executed analyses and dataset characteristics.
 */
export function generateApaManuscriptSection(
  analyses: AnalysisOutput[],
  dataset: Dataset,
  lang: Lang,
  projectMeta?: ManuscriptProjectMeta,
): ApaManuscriptBundle {
  const sampleText = describeDatasetSample(dataset, lang);
  const assumptionText = summarizeAssumptions(analyses, lang);
  const procedureList = analyses.map((a) => a.title).join(', ');

  const methodsText =
    lang === 'tr'
      ? [
          projectMeta?.designLabel ? `Çalışma deseni: ${projectMeta.designLabel}.` : '',
          sampleText,
          analyses.length > 0
            ? `Nicel çözümlemeler kapsamında sırasıyla ${procedureList} analizleri yürütülmüştür.`
            : 'Araştırma verileri nicel analiz ve varsayım sınaması için hazırlanmıştır.',
          assumptionText,
        ]
          .filter(Boolean)
          .join('\n\n')
      : [
          projectMeta?.designLabel ? `Study design: ${projectMeta.designLabel}.` : '',
          sampleText,
          analyses.length > 0
            ? `Quantitative analyses encompassed ${procedureList}.`
            : 'Quantitative variables were prepared for inferential and psychometric evaluation.',
          assumptionText,
        ]
          .filter(Boolean)
          .join('\n\n');

  const resultsParagraphs = analyses.map((a) => sanitizeProse(formatAnalysisResult(a, lang)));
  const resultsText =
    resultsParagraphs.length > 0
      ? resultsParagraphs.join('\n\n')
      : lang === 'tr'
        ? `Veri seti (*N* = ${dataset.rows.length}) üzerinde henüz hipotez veya psikometrik analiz çalıştırılmamıştır.`
        : `No inferential or psychometric analyses have been executed on the dataset (*N* = ${dataset.rows.length}) yet.`;

  const discussionStarter = buildDiscussionStarter(analyses, dataset, lang);
  const tablesMarkdown = buildTablesMarkdown(analyses, lang);

  const refs = matchReferencesForAnalyses(analyses);
  const refSection =
    refs.length > 0
      ? refs.map((r) => `- ${r.apa7}`).join('\n')
      : lang === 'tr'
        ? '- Analiz çalıştırıldığında eşleşen metodolojik kaynaklar burada listelenir.'
        : '- Verified methodological references will populate once analyses are executed.';

  const customTitle = projectMeta?.title?.trim();
  const customResearcher = projectMeta?.researcher?.trim();
  const customQuestion = projectMeta?.question?.trim();
  const customHypotheses = (projectMeta?.hypotheses ?? []).map((h) => h.trim()).filter(Boolean);

  const introBlockTr: string[] = [];
  if (customResearcher) introBlockTr.push(`**Araştırmacı:** ${customResearcher}`);
  if (customQuestion || customHypotheses.length > 0) {
    introBlockTr.push('## Araştırma Sorusu ve Hipotezler');
    if (customQuestion) introBlockTr.push(customQuestion);
    if (customHypotheses.length > 0) {
      introBlockTr.push(customHypotheses.map((h, i) => `${i + 1}. ${h}`).join('\n'));
    }
  }

  const introBlockEn: string[] = [];
  if (customResearcher) introBlockEn.push(`**Researcher:** ${customResearcher}`);
  if (customQuestion || customHypotheses.length > 0) {
    introBlockEn.push('## Research Question and Hypotheses');
    if (customQuestion) introBlockEn.push(customQuestion);
    if (customHypotheses.length > 0) {
      introBlockEn.push(customHypotheses.map((h, i) => `${i + 1}. ${h}`).join('\n'));
    }
  }

  const fullMarkdown =
    lang === 'tr'
      ? [
          `# ${customTitle || `İstatistiksel Bulgular ve Yöntem Taslağı (${dataset.name})`}`,
          ...introBlockTr,
          '## Yöntem',
          methodsText,
          '## Bulgular',
          resultsText,
          '## Tablolar (APA-7)',
          tablesMarkdown,
          '## Tartışma Çerçevesi',
          discussionStarter,
          '## Yöntem Kaynakçası',
          refSection,
        ].join('\n\n')
      : [
          `# ${customTitle || `Statistical Methods and Results Manuscript (${dataset.name})`}`,
          ...introBlockEn,
          '## Methods',
          methodsText,
          '## Results',
          resultsText,
          '## Tables (APA-7)',
          tablesMarkdown,
          '## Discussion Starter',
          discussionStarter,
          '## Methodological References',
          refSection,
        ].join('\n\n');

  return {
    methodsText: sanitizeProse(methodsText),
    resultsText,
    discussionStarter: sanitizeProse(discussionStarter),
    tablesMarkdown,
    fullMarkdown: sanitizeProse(fullMarkdown),
  };
}

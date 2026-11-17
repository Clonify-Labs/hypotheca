import React, { useMemo, useState } from 'react';
import { Calculator, CheckCircle2, AlertCircle, Play, Activity } from 'lucide-react';
import {
  PowerTestType,
  runBlandAltman,
  runChiSquare,
  runCorrelation,
  runDescriptives,
  runEfa,
  runFrequencies,
  runFriedman,
  runIndependentTTest,
  runKaplanMeier,
  runKruskalWallis,
  runLinearRegression,
  runLogisticRegression,
  runMannWhitneyU,
  runNormality,
  runOneSampleTTest,
  runOneWayAnova,
  runOutliers,
  runPairedTTest,
  runPartialCorrelation,
  runPowerAnalysis,
  runProcessMacro,
  runRasch,
  runReliability,
  runRepeatedAnova,
  runRocCurve,
  runWilcoxon,
} from '../engine/classical';
import { AnalysisOutput, Dataset, Lang } from '../types/interfaces';
import { ChartPlate } from './ChartPlate';
import { SpecTable } from './SpecTable';
import { errorMessage } from './errorMessage';

export interface ClassicalLabPageProps {
  dataset: Dataset;
  lang: Lang;
  onAnalysisDone: (output: AnalysisOutput) => void;
}

type ProcedureId =
  | 'descriptives'
  | 'frequencies'
  | 'normality'
  | 'outliers'
  | 'one_sample_t'
  | 'indep_t'
  | 'paired_t'
  | 'oneway_anova'
  | 'repeated_anova'
  | 'mann_whitney_u'
  | 'wilcoxon'
  | 'kruskal_wallis'
  | 'friedman'
  | 'correlation'
  | 'partial_corr'
  | 'chi_square'
  | 'reliability'
  | 'efa'
  | 'rasch'
  | 'linear_reg'
  | 'logistic_reg'
  | 'roc'
  | 'bland_altman'
  | 'kaplan_meier'
  | 'process_4'
  | 'process_1'
  | 'gpower';

interface ProcedureMeta {
  id: ProcedureId;
  group: GroupId;
  labelTr: string;
  labelEn: string;
}

type GroupId = 'explore' | 'compare' | 'nonparam' | 'assoc' | 'scale' | 'regression' | 'process';

const GROUPS: { id: GroupId; tr: string; en: string }[] = [
  { id: 'explore', tr: 'Keşifsel analiz', en: 'Exploratory' },
  { id: 'compare', tr: 'Grup karşılaştırmaları', en: 'Group comparisons' },
  { id: 'nonparam', tr: 'Parametrik olmayan', en: 'Nonparametric' },
  { id: 'assoc', tr: 'İlişki ve çapraz tablo', en: 'Association' },
  { id: 'scale', tr: 'Ölçek ve psikometri', en: 'Scales and psychometrics' },
  { id: 'regression', tr: 'Regresyon ve klinik', en: 'Regression and clinical' },
  { id: 'process', tr: 'Aracılık, düzenleyicilik ve güç', en: 'Mediation, moderation and power' },
];

const PROCEDURES: ProcedureMeta[] = [
  { id: 'descriptives', group: 'explore', labelTr: 'Tanımlayıcı istatistikler', labelEn: 'Descriptives' },
  { id: 'frequencies', group: 'explore', labelTr: 'Frekanslar', labelEn: 'Frequencies' },
  { id: 'normality', group: 'explore', labelTr: 'Normallik testleri', labelEn: 'Normality tests' },
  { id: 'outliers', group: 'explore', labelTr: 'Uç değerler', labelEn: 'Outliers' },
  { id: 'one_sample_t', group: 'compare', labelTr: 'Tek örneklem t testi', labelEn: 'One-sample t test' },
  { id: 'indep_t', group: 'compare', labelTr: 'Bağımsız örneklem t testi', labelEn: 'Independent t test' },
  { id: 'paired_t', group: 'compare', labelTr: 'Eşleştirilmiş t testi', labelEn: 'Paired t test' },
  { id: 'oneway_anova', group: 'compare', labelTr: 'Tek yönlü ANOVA', labelEn: 'One-way ANOVA' },
  { id: 'repeated_anova', group: 'compare', labelTr: 'Tekrarlı ölçümler ANOVA', labelEn: 'Repeated measures ANOVA' },
  { id: 'mann_whitney_u', group: 'nonparam', labelTr: 'Mann-Whitney U', labelEn: 'Mann-Whitney U' },
  { id: 'wilcoxon', group: 'nonparam', labelTr: 'Wilcoxon işaretli sıralar', labelEn: 'Wilcoxon signed-rank' },
  { id: 'kruskal_wallis', group: 'nonparam', labelTr: 'Kruskal-Wallis H', labelEn: 'Kruskal-Wallis H' },
  { id: 'friedman', group: 'nonparam', labelTr: 'Friedman', labelEn: 'Friedman' },
  { id: 'correlation', group: 'assoc', labelTr: 'Korelasyon', labelEn: 'Correlation' },
  { id: 'partial_corr', group: 'assoc', labelTr: 'Kısmi korelasyon', labelEn: 'Partial correlation' },
  { id: 'chi_square', group: 'assoc', labelTr: 'Ki-kare', labelEn: 'Chi-square' },
  { id: 'reliability', group: 'scale', labelTr: 'Güvenirlik', labelEn: 'Reliability' },
  { id: 'efa', group: 'scale', labelTr: 'Açımlayıcı faktör analizi', labelEn: 'Exploratory factor analysis' },
  { id: 'rasch', group: 'scale', labelTr: 'Rasch modeli', labelEn: 'Rasch model' },
  { id: 'linear_reg', group: 'regression', labelTr: 'Doğrusal regresyon', labelEn: 'Linear regression' },
  { id: 'logistic_reg', group: 'regression', labelTr: 'Lojistik regresyon', labelEn: 'Logistic regression' },
  { id: 'roc', group: 'regression', labelTr: 'ROC eğrisi', labelEn: 'ROC curve' },
  { id: 'bland_altman', group: 'regression', labelTr: 'Bland-Altman', labelEn: 'Bland-Altman' },
  { id: 'kaplan_meier', group: 'regression', labelTr: 'Kaplan-Meier', labelEn: 'Kaplan-Meier' },
  { id: 'process_4', group: 'process', labelTr: 'Aracılık (PROCESS model 4)', labelEn: 'Mediation (PROCESS model 4)' },
  { id: 'process_1', group: 'process', labelTr: 'Düzenleyicilik (PROCESS model 1)', labelEn: 'Moderation (PROCESS model 1)' },
  { id: 'gpower', group: 'process', labelTr: 'Güç analizi', labelEn: 'Power analysis' },
];

export const ClassicalLabPage: React.FC<ClassicalLabPageProps> = ({ dataset, lang, onAnalysisDone }) => {
  const numericCols = useMemo(
    () => dataset.columns.filter((c) => c.valueType === 'numeric').map((c) => c.name),
    [dataset],
  );
  const catCols = useMemo(
    () => dataset.columns.filter((c) => c.valueType !== 'numeric' || c.uniqueCount <= 10).map((c) => c.name),
    [dataset],
  );
  const allCols = useMemo(() => dataset.columns.map((c) => c.name), [dataset]);

  const [proc, setProc] = useState<ProcedureId>('indep_t');
  const [selectedMulti, setSelectedMulti] = useState<string[]>(() =>
    numericCols.includes('OY_Ort') ? ['OY_Ort', 'YZ_Ort', 'Basari_Son'] : numericCols.slice(0, 4),
  );
  const [primaryVar, setPrimaryVar] = useState<string>(() => (numericCols.includes('OY_Ort') ? 'OY_Ort' : numericCols[0] || ''));
  const [secondaryVar, setSecondaryVar] = useState<string>(() => (numericCols.includes('Basari_Son') ? 'Basari_Son' : numericCols[1] || numericCols[0] || ''));
  const [groupVar, setGroupVar] = useState<string>(() => (catCols.includes('Cinsiyet') ? 'Cinsiyet' : catCols[0] || allCols[0] || ''));
  const [factorVar, setFactorVar] = useState<string>(() => (catCols.includes('Fakulte') ? 'Fakulte' : catCols[0] || allCols[0] || ''));
  const [mediatorVar, setMediatorVar] = useState<string>(() => (numericCols.includes('YZ_Ort') ? 'YZ_Ort' : numericCols[1] || numericCols[0] || ''));
  const [testMu, setTestMu] = useState<number>(3.0);
  const [corrMethod, setCorrMethod] = useState<'pearson' | 'spearman'>('pearson');
  const [powerTest, setPowerTest] = useState<PowerTestType>('indep_t');
  const [powerEffect, setPowerEffect] = useState<number>(0.5);
  const [powerAlpha, setPowerAlpha] = useState<number>(0.05);
  const [powerTarget, setPowerTarget] = useState<number>(0.8);
  const [powerTails, setPowerTails] = useState<1 | 2>(2);

  const [output, setOutput] = useState<AnalysisOutput | null>(null);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  const needsNumeric = !['frequencies', 'chi_square', 'gpower'].includes(proc);
  const runDisabled = allCols.length === 0 || (needsNumeric && numericCols.length === 0);

  const toggleMulti = (name: string) => {
    setSelectedMulti((prev) => (prev.includes(name) ? prev.filter((x) => x !== name) : [...prev, name]));
  };

  const handleRun = () => {
    setErrorMsg(null);
    try {
      let res: AnalysisOutput;
      const effMulti = selectedMulti.length ? selectedMulti : numericCols.slice(0, 4);
      const effPreds = selectedMulti.filter((c) => c !== primaryVar);

      switch (proc) {
        case 'descriptives':
          res = runDescriptives(dataset, effMulti);
          break;
        case 'frequencies':
          res = runFrequencies(dataset, selectedMulti.length ? selectedMulti : catCols.slice(0, 2));
          break;
        case 'normality':
          res = runNormality(dataset, effMulti);
          break;
        case 'outliers':
          res = runOutliers(dataset, effMulti);
          break;
        case 'one_sample_t':
          res = runOneSampleTTest(dataset, primaryVar, testMu);
          break;
        case 'indep_t':
          res = runIndependentTTest(dataset, primaryVar, groupVar);
          break;
        case 'paired_t':
          res = runPairedTTest(dataset, primaryVar, secondaryVar);
          break;
        case 'oneway_anova':
          res = runOneWayAnova(dataset, primaryVar, factorVar, 'tukey');
          break;
        case 'repeated_anova':
          res = runRepeatedAnova(dataset, effMulti.slice(0, 5));
          break;
        case 'mann_whitney_u':
          res = runMannWhitneyU(dataset, primaryVar, groupVar);
          break;
        case 'wilcoxon':
          res = runWilcoxon(dataset, primaryVar, secondaryVar);
          break;
        case 'kruskal_wallis':
          res = runKruskalWallis(dataset, primaryVar, factorVar);
          break;
        case 'friedman':
          res = runFriedman(dataset, effMulti.slice(0, 5));
          break;
        case 'correlation':
          res = runCorrelation(dataset, effMulti, corrMethod);
          break;
        case 'partial_corr':
          res = runPartialCorrelation(dataset, primaryVar, secondaryVar, [mediatorVar]);
          break;
        case 'chi_square':
          res = runChiSquare(dataset, groupVar, factorVar);
          break;
        case 'reliability':
          res = runReliability(dataset, effMulti);
          break;
        case 'efa':
          res = runEfa(dataset, effMulti, { rotation: 'varimax', extraction: 'pca' });
          break;
        case 'rasch':
          res = runRasch(dataset, effMulti);
          break;
        case 'linear_reg':
          res = runLinearRegression(dataset, primaryVar, effPreds.length ? effPreds : [mediatorVar]);
          break;
        case 'logistic_reg':
          res = runLogisticRegression(dataset, groupVar, effMulti.length ? effMulti : numericCols.slice(0, 3));
          break;
        case 'roc':
          res = runRocCurve(dataset, primaryVar, groupVar);
          break;
        case 'bland_altman':
          res = runBlandAltman(dataset, primaryVar, secondaryVar);
          break;
        case 'kaplan_meier':
          res = runKaplanMeier(dataset, primaryVar, secondaryVar, groupVar);
          break;
        case 'process_4':
          res = runProcessMacro(dataset, { model: 4, x: primaryVar, mOrW: mediatorVar, y: secondaryVar, bootstrapSamples: 400 });
          break;
        case 'process_1':
          res = runProcessMacro(dataset, { model: 1, x: primaryVar, mOrW: mediatorVar, y: secondaryVar });
          break;
        case 'gpower':
          res = runPowerAnalysis({
            testType: powerTest,
            mode: 'apriori',
            effectSize: powerEffect,
            alpha: powerAlpha,
            power: powerTarget,
            tails: powerTails,
          });
          break;
      }
      setOutput(res);
      onAnalysisDone(res);
    } catch (err) {
      setErrorMsg(errorMessage(err, lang));
    }
  };

  return (
    <div className="hp-workbench-cols">
      <div className="hp-plate" style={{ padding: 'var(--space-md)', alignSelf: 'start', display: 'flex', flexDirection: 'column', gap: 'var(--space-md)' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-xs)' }}>
          <Calculator size={18} />
          <h2 style={{ margin: 0, fontSize: 'var(--text-title)', fontWeight: 700 }}>
            {lang === 'tr' ? 'Analiz' : 'Analysis'}
          </h2>
        </div>

        <div>
          <label className="hp-label">{lang === 'tr' ? 'Test' : 'Test'}</label>
          <select className="hp-select" value={proc} onChange={(e) => setProc(e.target.value as ProcedureId)}>
            {GROUPS.map((g) => (
              <optgroup key={g.id} label={lang === 'tr' ? g.tr : g.en}>
                {PROCEDURES.filter((p) => p.group === g.id).map((p) => (
                  <option key={p.id} value={p.id}>
                    {lang === 'tr' ? p.labelTr : p.labelEn}
                  </option>
                ))}
              </optgroup>
            ))}
          </select>
        </div>

        {proc === 'gpower' ? (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-sm)' }}>
            <div>
              <label className="hp-label">{lang === 'tr' ? 'Test türü' : 'Test type'}</label>
              <select className="hp-select" value={powerTest} onChange={(e) => setPowerTest(e.target.value as PowerTestType)}>
                <option value="indep_t">{lang === 'tr' ? 'Bağımsız t testi (d)' : 'Independent t test (d)'}</option>
                <option value="paired_t">{lang === 'tr' ? 'Eşleştirilmiş t testi (dz)' : 'Paired t test (dz)'}</option>
                <option value="one_sample_t">{lang === 'tr' ? 'Tek örneklem t testi (d)' : 'One-sample t test (d)'}</option>
                <option value="oneway_anova">{lang === 'tr' ? 'Tek yönlü ANOVA (f)' : 'One-way ANOVA (f)'}</option>
                <option value="correlation">{lang === 'tr' ? 'Korelasyon (r)' : 'Correlation (r)'}</option>
                <option value="linear_regression">{lang === 'tr' ? 'Doğrusal regresyon (f²)' : 'Linear regression (f²)'}</option>
                <option value="chi_square">{lang === 'tr' ? 'Ki-kare (w)' : 'Chi-square (w)'}</option>
                <option value="proportions_2">{lang === 'tr' ? 'İki oran (h)' : 'Two proportions (h)'}</option>
              </select>
            </div>
            <div>
              <label className="hp-label">{lang === 'tr' ? 'Etki büyüklüğü' : 'Effect size'}</label>
              <input
                className="hp-input"
                type="number"
                step="0.05"
                value={Number.isFinite(powerEffect) ? powerEffect : ''}
                onChange={(e) => {
                  const v = Number(e.target.value);
                  if (Number.isFinite(v)) setPowerEffect(v);
                }}
              />
            </div>
            <div className="hp-grid-2">
              <div>
                <label className="hp-label">Alpha (α)</label>
                <input
                  className="hp-input"
                  type="number"
                  step="0.01"
                  value={Number.isFinite(powerAlpha) ? powerAlpha : ''}
                  onChange={(e) => {
                    const v = Number(e.target.value);
                    if (Number.isFinite(v)) setPowerAlpha(v);
                  }}
                />
              </div>
              <div>
                <label className="hp-label">{lang === 'tr' ? 'Güç (1-β)' : 'Power'}</label>
                <input
                  className="hp-input"
                  type="number"
                  step="0.05"
                  value={Number.isFinite(powerTarget) ? powerTarget : ''}
                  onChange={(e) => {
                    const v = Number(e.target.value);
                    if (Number.isFinite(v)) setPowerTarget(v);
                  }}
                />
              </div>
            </div>
            <div>
              <label className="hp-label">{lang === 'tr' ? 'Yön' : 'Tails'}</label>
              <select className="hp-select" value={powerTails} onChange={(e) => setPowerTails(Number(e.target.value) as 1 | 2)}>
                <option value={2}>{lang === 'tr' ? 'Çift yönlü' : 'Two-tailed'}</option>
                <option value={1}>{lang === 'tr' ? 'Tek yönlü' : 'One-tailed'}</option>
              </select>
            </div>
          </div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-sm)' }}>
            {['one_sample_t', 'indep_t', 'paired_t', 'oneway_anova', 'mann_whitney_u', 'wilcoxon', 'kruskal_wallis', 'partial_corr', 'linear_reg', 'roc', 'bland_altman', 'kaplan_meier', 'process_4', 'process_1'].includes(proc) && (
              <div>
                <label className="hp-label">
                  {proc === 'roc'
                    ? lang === 'tr' ? 'Test skoru' : 'Test score'
                    : proc === 'kaplan_meier'
                      ? lang === 'tr' ? 'Süre' : 'Time'
                      : proc.startsWith('process')
                        ? lang === 'tr' ? 'Bağımsız değişken (X)' : 'Predictor (X)'
                        : lang === 'tr'
                          ? 'Bağımlı değişken'
                          : 'Dependent variable'}
                </label>
                <select className="hp-select" value={primaryVar} onChange={(e) => setPrimaryVar(e.target.value)}>
                  {numericCols.map((c) => (
                    <option key={c} value={c}>
                      {c}
                    </option>
                  ))}
                </select>
              </div>
            )}

            {proc === 'one_sample_t' && (
              <div>
                <label className="hp-label">{lang === 'tr' ? 'Test değeri (μ₀)' : 'Test value (μ₀)'}</label>
                <input
                  className="hp-input"
                  type="number"
                  step="0.1"
                  value={Number.isFinite(testMu) ? testMu : ''}
                  onChange={(e) => {
                    const v = Number(e.target.value);
                    if (Number.isFinite(v)) setTestMu(v);
                  }}
                />
              </div>
            )}

            {['paired_t', 'wilcoxon', 'partial_corr', 'bland_altman', 'kaplan_meier', 'process_4', 'process_1'].includes(proc) && (
              <div>
                <label className="hp-label">
                  {proc === 'kaplan_meier'
                    ? lang === 'tr' ? 'Olay (0/1)' : 'Event (0/1)'
                    : proc.startsWith('process')
                      ? lang === 'tr' ? 'Bağımlı değişken (Y)' : 'Outcome (Y)'
                      : lang === 'tr' ? 'İkinci değişken' : 'Second variable'}
                </label>
                <select className="hp-select" value={secondaryVar} onChange={(e) => setSecondaryVar(e.target.value)}>
                  {numericCols.map((c) => (
                    <option key={c} value={c}>
                      {c}
                    </option>
                  ))}
                </select>
              </div>
            )}

            {['partial_corr', 'process_4', 'process_1'].includes(proc) && (
              <div>
                <label className="hp-label">
                  {proc === 'partial_corr'
                    ? lang === 'tr' ? 'Kontrol değişkeni' : 'Control variable'
                    : proc === 'process_4'
                      ? lang === 'tr' ? 'Aracı değişken (M)' : 'Mediator (M)'
                      : lang === 'tr' ? 'Düzenleyici değişken (W)' : 'Moderator (W)'}
                </label>
                <select className="hp-select" value={mediatorVar} onChange={(e) => setMediatorVar(e.target.value)}>
                  {numericCols.map((c) => (
                    <option key={c} value={c}>
                      {c}
                    </option>
                  ))}
                </select>
              </div>
            )}

            {['indep_t', 'mann_whitney_u', 'chi_square', 'logistic_reg', 'roc', 'kaplan_meier'].includes(proc) && (
              <div>
                <label className="hp-label">{lang === 'tr' ? 'Grup değişkeni' : 'Grouping variable'}</label>
                <select className="hp-select" value={groupVar} onChange={(e) => setGroupVar(e.target.value)}>
                  {(catCols.length ? catCols : allCols).map((c) => (
                    <option key={c} value={c}>
                      {c}
                    </option>
                  ))}
                </select>
              </div>
            )}

            {['oneway_anova', 'kruskal_wallis', 'chi_square'].includes(proc) && (
              <div>
                <label className="hp-label">{lang === 'tr' ? 'Faktör' : 'Factor'}</label>
                <select className="hp-select" value={factorVar} onChange={(e) => setFactorVar(e.target.value)}>
                  {(catCols.length ? catCols : allCols).map((c) => (
                    <option key={c} value={c}>
                      {c}
                    </option>
                  ))}
                </select>
              </div>
            )}

            {proc === 'correlation' && (
              <div>
                <label className="hp-label">{lang === 'tr' ? 'Yöntem' : 'Method'}</label>
                <select className="hp-select" value={corrMethod} onChange={(e) => setCorrMethod(e.target.value as 'pearson' | 'spearman')}>
                  <option value="pearson">Pearson r</option>
                  <option value="spearman">Spearman rho</option>
                </select>
              </div>
            )}

            {['descriptives', 'frequencies', 'normality', 'outliers', 'repeated_anova', 'friedman', 'correlation', 'reliability', 'efa', 'rasch', 'linear_reg', 'logistic_reg'].includes(proc) && (
              <div>
                <label className="hp-label">{lang === 'tr' ? 'Değişkenler' : 'Variables'}</label>
                <div style={{ maxHeight: 190, overflowY: 'auto', border: '1px solid var(--color-rule)', padding: 'var(--space-xs)', display: 'flex', flexDirection: 'column', gap: 'var(--space-3xs)' }}>
                  {(proc === 'frequencies' ? allCols : numericCols).map((c) => (
                    <label key={c} style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-xs)', fontSize: 'var(--text-xs)', cursor: 'pointer' }}>
                      <input type="checkbox" checked={selectedMulti.includes(c)} onChange={() => toggleMulti(c)} />
                      <span className="hp-mono">{c}</span>
                    </label>
                  ))}
                </div>
              </div>
            )}
          </div>
        )}

        {needsNumeric && numericCols.length === 0 && (
          <div className="hp-alert hp-alert-warn" role="status">
            {lang === 'tr'
              ? 'Bu veri setinde sayısal değişken yok. Sözel anket verisi için önce Adım 3 (Veri temizleme) uygulayın ya da Frekanslar / Ki-kare / Güç analizi seçin.'
              : 'No numeric variables in this dataset. For verbal survey data, run Step 3 (Data cleaning) first or select Frequencies / Chi-square / Power analysis.'}
          </div>
        )}

        <button type="button" className="hp-btn hp-btn-primary" onClick={handleRun} disabled={runDisabled}>
          <Play size={16} />
          <span>{lang === 'tr' ? 'Çalıştır' : 'Run'}</span>
        </button>

        {errorMsg && (
          <div className="hp-badge hp-badge-err" style={{ whiteSpace: 'normal' }}>
            <AlertCircle size={14} />
            <span>{errorMsg}</span>
          </div>
        )}
      </div>

      <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-md)' }}>
        {!output ? (
          <div className="hp-plate-flat" style={{ padding: 'var(--space-xl)', textAlign: 'center' }}>
            <Activity size={28} style={{ color: 'var(--color-accent)', marginBottom: 'var(--space-xs)' }} />
            <p style={{ color: 'var(--color-muted)', margin: 0 }}>
              {lang === 'tr' ? 'Bir test seçin, değişkenleri atayın ve çalıştırın.' : 'Pick a test, assign variables and run.'}
            </p>
          </div>
        ) : (
          <>
            <div className="hp-plate" style={{ padding: 'var(--space-md)' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 'var(--space-sm)' }}>
                <h2 style={{ margin: 0, fontSize: 'var(--text-section)' }}>{output.title}</h2>
              </div>

              {output.assumptions && output.assumptions.length > 0 && (
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 'var(--space-xs)', marginTop: 'var(--space-sm)' }}>
                  {output.assumptions.map((a, idx) => (
                    <span key={idx} className={a.passed ? 'hp-badge hp-badge-ok' : 'hp-badge hp-badge-warn'} title={a.detail}>
                      <CheckCircle2 size={13} />
                      <span>
                        {a.name}: {a.statisticLabel}
                      </span>
                    </span>
                  ))}
                </div>
              )}

              {(output.narrativeTr || output.narrativeEn) && (
                <p style={{ marginTop: 'var(--space-sm)', marginBottom: 0, color: 'var(--color-ink-2)', lineHeight: 1.55 }}>
                  {lang === 'tr' ? output.narrativeTr : output.narrativeEn}
                </p>
              )}
            </div>

            {output.tables.map((t) => (
              <SpecTable key={t.id} table={t} lang={lang} />
            ))}

            {output.charts.map((ch) => (
              <ChartPlate key={ch.id} chart={ch} />
            ))}
          </>
        )}
      </div>
    </div>
  );
};

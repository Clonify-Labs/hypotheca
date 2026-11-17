import React, { useEffect, useMemo, useState } from 'react';
import { AlertCircle, FlaskConical, Play } from 'lucide-react';
import { AnalysisOutput, Dataset, Lang } from '../../types/interfaces';
import { SpecTable } from '../../components/SpecTable';
import { ChartPlate } from '../../components/ChartPlate';
import { errorMessage } from '../../components/errorMessage';
import { runMetaAnalysis } from './metaAnalysis';
import { runProcessModel14, runProcessModel6, runProcessModel7 } from './advancedProcess';
import { CfaFactorSpec, runMeasurementInvariance, runSecondOrderCfa } from './measurementInvariance';
import { runLinearMixedModel, runPropensityScoreMatching } from './lmmAndPsm';
import { runBayesianAnova, runBayesianCorrelation, runBayesianTTest } from './bayesianStats';

export interface AdvancedStatsPageProps {
  dataset: Dataset;
  datasets: Dataset[];
  lang: Lang;
  onAnalysisDone?: (output: AnalysisOutput) => void;
}

type TabId = 'meta' | 'process' | 'invariance' | 'lmm' | 'bayes';

const TABS: { id: TabId; tr: string; en: string }[] = [
  { id: 'meta', tr: 'Meta-analiz', en: 'Meta-analysis' },
  { id: 'process', tr: 'PROCESS', en: 'PROCESS' },
  { id: 'invariance', tr: 'Ölçüm değişmezliği', en: 'Measurement invariance' },
  { id: 'lmm', tr: 'Karma model ve eğilim skoru', en: 'Mixed model and PSM' },
  { id: 'bayes', tr: 'Bayesyen', en: 'Bayesian' },
];

function pick(cols: string[], preferred: string, fallbackIdx = 0): string {
  return cols.includes(preferred) ? preferred : cols[fallbackIdx] ?? cols[0] ?? '';
}

/** Groups items such as OY1..OY4 into factors by their alphabetic prefix. */
function guessFactors(numericCols: string[]): CfaFactorSpec[] {
  const groups = new Map<string, string[]>();
  for (const c of numericCols) {
    const m = /^([A-Za-z]+)\d+$/.exec(c);
    if (!m) continue;
    const arr = groups.get(m[1]) ?? [];
    arr.push(c);
    groups.set(m[1], arr);
  }
  return Array.from(groups.entries())
    .filter(([, items]) => items.length >= 3)
    .map(([name, indicators]) => ({ name, indicators }));
}

const Select: React.FC<{ label: string; value: string; options: string[]; onChange: (v: string) => void }> = ({ label, value, options, onChange }) => (
  <div>
    <label className="hp-label">{label}</label>
    <select className="hp-select" value={value} onChange={(e) => onChange(e.target.value)}>
      {options.map((o) => (
        <option key={o} value={o}>
          {o}
        </option>
      ))}
    </select>
  </div>
);

export const AdvancedStatsPage: React.FC<AdvancedStatsPageProps> = ({ dataset, lang, onAnalysisDone }) => {
  const t = (tr: string, en: string) => (lang === 'tr' ? tr : en);
  const numericCols = useMemo(() => dataset.columns.filter((c) => c.valueType === 'numeric').map((c) => c.name), [dataset]);
  const allCols = useMemo(() => dataset.columns.map((c) => c.name), [dataset]);
  const catCols = useMemo(
    () => dataset.columns.filter((c) => c.valueType !== 'numeric' || c.uniqueCount <= 8).map((c) => c.name),
    [dataset],
  );
  const factorGuess = useMemo(() => guessFactors(numericCols), [numericCols]);

  const [tab, setTab] = useState<TabId>(dataset.id === 'ds-meta-10' ? 'meta' : 'process');
  const [output, setOutput] = useState<AnalysisOutput | null>(null);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [running, setRunning] = useState(false);

  // Meta
  const [studyCol, setStudyCol] = useState('');
  const [effectCol, setEffectCol] = useState('');
  const [seCol, setSeCol] = useState('');
  const [metaMethod, setMetaMethod] = useState<'FE' | 'RE_DL'>('RE_DL');
  // PROCESS
  const [procModel, setProcModel] = useState<6 | 7 | 14>(6);
  const [px, setPx] = useState('');
  const [pm1, setPm1] = useState('');
  const [pm2, setPm2] = useState('');
  const [py, setPy] = useState('');
  const [boot, setBoot] = useState(1000);
  // Invariance
  const [invMode, setInvMode] = useState<'mi' | 'second'>('mi');
  const [invGroup, setInvGroup] = useState('');
  const [secondName, setSecondName] = useState('Genel');
  // LMM / PSM
  const [lmMode, setLmMode] = useState<'lmm' | 'psm'>('lmm');
  const [lmOutcome, setLmOutcome] = useState('');
  const [lmPred, setLmPred] = useState('');
  const [lmCluster, setLmCluster] = useState('');
  const [psmCovs, setPsmCovs] = useState<string[]>([]);
  // Bayes
  const [bayesMode, setBayesMode] = useState<'t' | 'anova' | 'corr'>('t');
  const [bv1, setBv1] = useState('');
  const [bv2, setBv2] = useState('');
  const [bGroup, setBGroup] = useState('');
  const [bScale, setBScale] = useState(0.707);

  // Smart defaults whenever the active dataset changes
  useEffect(() => {
    setOutput(null);
    setErrorMsg(null);
    setStudyCol(pick(allCols, 'Calisma'));
    setEffectCol(pick(numericCols, 'Etki_d', 1));
    setSeCol(pick(numericCols, 'SE', 2));
    setPx(pick(numericCols, 'OY_Ort'));
    setPm1(pick(numericCols, 'YZ_Ort', 1));
    setPm2(pick(numericCols, 'TK_Ort', 2));
    setPy(pick(numericCols, 'Basari_Son', 3));
    setInvGroup(pick(catCols, 'Cinsiyet'));
    setLmOutcome(pick(numericCols, dataset.id === 'ds-klinik-150' ? 'Sistolik_KB' : 'Basari_Son'));
    setLmPred(pick(numericCols, dataset.id === 'ds-klinik-150' ? 'Yas' : 'YZ_Ort', 1));
    setLmCluster(pick(catCols, dataset.id === 'ds-klinik-150' ? 'Grup' : 'Fakulte'));
    setPsmCovs(numericCols.filter((c) => ['Yas', 'VKI'].includes(c)).length ? numericCols.filter((c) => ['Yas', 'VKI'].includes(c)) : numericCols.slice(0, 2));
    setBv1(pick(numericCols, 'OY_Ort'));
    setBv2(pick(numericCols, 'Basari_Son', 1));
    setBGroup(pick(catCols, dataset.id === 'ds-klinik-150' ? 'Grup' : 'Cinsiyet'));
    if (dataset.id === 'ds-meta-10') setTab('meta');
  }, [dataset, allCols, numericCols, catCols]);

  const run = () => {
    setErrorMsg(null);
    setRunning(true);
    // Defer so the button state paints before heavy bootstrap / optimisation work
    window.setTimeout(() => {
      try {
        let res: AnalysisOutput;
        if (tab === 'meta') {
          res = runMetaAnalysis(dataset, { studyCol, effectCol, seCol, yearCol: allCols.includes('Yil') ? 'Yil' : undefined, method: metaMethod });
        } else if (tab === 'process') {
          res =
            procModel === 6
              ? runProcessModel6(dataset, { x: px, m1: pm1, m2: pm2, y: py, bootstrapSamples: boot })
              : procModel === 7
                ? runProcessModel7(dataset, { x: px, m: pm1, w: pm2, y: py, bootstrapSamples: boot })
                : runProcessModel14(dataset, { x: px, m: pm1, w: pm2, y: py, bootstrapSamples: boot });
        } else if (tab === 'invariance') {
          if (!factorGuess.length) throw new Error(t('Ölçek maddeleri bulunamadı. Maddeler ortak bir önekle adlandırılmalı (ör. OY1, OY2, OY3).', 'No scale items found. Items need a shared prefix (e.g. OY1, OY2, OY3).'));
          res =
            invMode === 'mi'
              ? runMeasurementInvariance(dataset, { groupVar: invGroup, factors: factorGuess.slice(0, 2) })
              : runSecondOrderCfa(dataset, { secondOrderName: secondName || 'G', firstOrderFactors: factorGuess });
        } else if (tab === 'lmm') {
          res =
            lmMode === 'lmm'
              ? runLinearMixedModel(dataset, { outcome: lmOutcome, fixedPredictors: lmPred ? [lmPred] : [], clusterVar: lmCluster })
              : runPropensityScoreMatching(dataset, { treatmentVar: lmCluster, outcomeVar: lmOutcome, covariates: psmCovs });
        } else {
          res =
            bayesMode === 't'
              ? runBayesianTTest(dataset, bv1, bGroup, bScale)
              : bayesMode === 'anova'
                ? runBayesianAnova(dataset, bv1, bGroup, bScale)
                : runBayesianCorrelation(dataset, bv1, bv2);
        }
        setOutput(res);
        onAnalysisDone?.(res);
      } catch (err) {
        setErrorMsg(errorMessage(err, lang));
      } finally {
        setRunning(false);
      }
    }, 10);
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-md)' }}>
      <div className="hp-plate" style={{ padding: 'var(--space-md)' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-xs)', marginBottom: 'var(--space-sm)' }}>
          <FlaskConical size={18} />
          <h2 style={{ margin: 0, fontSize: 'var(--text-section)' }}>{t('İleri analizler', 'Advanced analyses')}</h2>
        </div>
        <div className="hp-tabs" style={{ marginBottom: 0 }}>
          {TABS.map((tb) => (
            <button
              key={tb.id}
              type="button"
              className={tab === tb.id ? 'hp-tab is-active' : 'hp-tab'}
              onClick={() => {
                setTab(tb.id);
                setOutput(null);
                setErrorMsg(null);
              }}
            >
              {lang === 'tr' ? tb.tr : tb.en}
            </button>
          ))}
        </div>
      </div>

      <div className="hp-workbench-cols">
        <div className="hp-plate" style={{ padding: 'var(--space-md)', alignSelf: 'start', display: 'flex', flexDirection: 'column', gap: 'var(--space-sm)' }}>
          {tab === 'meta' && (
            <>
              <Select label={t('Çalışma', 'Study')} value={studyCol} options={allCols} onChange={setStudyCol} />
              <Select label={t('Etki büyüklüğü', 'Effect size')} value={effectCol} options={numericCols} onChange={setEffectCol} />
              <Select label={t('Standart hata', 'Standard error')} value={seCol} options={numericCols} onChange={setSeCol} />
              <div>
                <label className="hp-label">{t('Model', 'Model')}</label>
                <select className="hp-select" value={metaMethod} onChange={(e) => setMetaMethod(e.target.value as 'FE' | 'RE_DL')}>
                  <option value="RE_DL">{t('Rastgele etkiler (DerSimonian-Laird)', 'Random effects (DerSimonian-Laird)')}</option>
                  <option value="FE">{t('Sabit etki', 'Fixed effect')}</option>
                </select>
              </div>
            </>
          )}

          {tab === 'process' && (
            <>
              <div>
                <label className="hp-label">{t('Model', 'Model')}</label>
                <select className="hp-select" value={procModel} onChange={(e) => setProcModel(Number(e.target.value) as 6 | 7 | 14)}>
                  <option value={6}>{t('Model 6: seri aracılık', 'Model 6: serial mediation')}</option>
                  <option value={7}>{t('Model 7: birinci aşama düzenlenmiş aracılık', 'Model 7: first-stage moderated mediation')}</option>
                  <option value={14}>{t('Model 14: ikinci aşama düzenlenmiş aracılık', 'Model 14: second-stage moderated mediation')}</option>
                </select>
              </div>
              <Select label="X" value={px} options={numericCols} onChange={setPx} />
              <Select label={procModel === 6 ? 'M1' : 'M'} value={pm1} options={numericCols} onChange={setPm1} />
              <Select label={procModel === 6 ? 'M2' : t('W (düzenleyici)', 'W (moderator)')} value={pm2} options={numericCols} onChange={setPm2} />
              <Select label="Y" value={py} options={numericCols} onChange={setPy} />
              <div>
                <label className="hp-label">{t('Bootstrap örneklemi', 'Bootstrap samples')}</label>
                <input
                  className="hp-input"
                  type="number"
                  min={200}
                  max={10000}
                  step={100}
                  value={Number.isFinite(boot) ? boot : ''}
                  onChange={(e) => {
                    const v = Number(e.target.value);
                    if (Number.isFinite(v)) setBoot(Math.min(10000, Math.max(200, v)));
                  }}
                />
              </div>
            </>
          )}

          {tab === 'invariance' && (
            <>
              <div>
                <label className="hp-label">{t('Analiz', 'Analysis')}</label>
                <select className="hp-select" value={invMode} onChange={(e) => setInvMode(e.target.value as 'mi' | 'second')}>
                  <option value="mi">{t('Çok gruplu ölçüm değişmezliği', 'Multi-group measurement invariance')}</option>
                  <option value="second">{t('İkinci düzey DFA', 'Second-order CFA')}</option>
                </select>
              </div>
              {invMode === 'mi' ? (
                <Select label={t('Grup değişkeni', 'Grouping variable')} value={invGroup} options={catCols} onChange={setInvGroup} />
              ) : (
                <div>
                  <label className="hp-label">{t('İkinci düzey faktör adı', 'Second-order factor name')}</label>
                  <input className="hp-input" value={secondName} onChange={(e) => setSecondName(e.target.value)} />
                </div>
              )}
              <div className="hp-plate-flat" style={{ padding: 'var(--space-xs)', fontSize: 'var(--text-xs)' }}>
                <div className="hp-label">{t('Faktörler', 'Factors')}</div>
                {factorGuess.length ? (
                  (invMode === 'mi' ? factorGuess.slice(0, 2) : factorGuess).map((f) => (
                    <div key={f.name} className="hp-mono">
                      {f.name}: {f.indicators.join(', ')}
                    </div>
                  ))
                ) : (
                  <span style={{ color: 'var(--color-muted)' }}>{t('Bulunamadı', 'None found')}</span>
                )}
              </div>
            </>
          )}

          {tab === 'lmm' && (
            <>
              <div>
                <label className="hp-label">{t('Analiz', 'Analysis')}</label>
                <select className="hp-select" value={lmMode} onChange={(e) => setLmMode(e.target.value as 'lmm' | 'psm')}>
                  <option value="lmm">{t('Doğrusal karma model', 'Linear mixed model')}</option>
                  <option value="psm">{t('Eğilim skoru eşleştirme', 'Propensity score matching')}</option>
                </select>
              </div>
              <Select label={t('Bağımlı değişken', 'Outcome')} value={lmOutcome} options={numericCols} onChange={setLmOutcome} />
              <Select
                label={lmMode === 'lmm' ? t('Küme', 'Cluster') : t('Müdahale (iki düzey)', 'Treatment (two levels)')}
                value={lmCluster}
                options={catCols}
                onChange={setLmCluster}
              />
              {lmMode === 'lmm' ? (
                <Select label={t('Yordayıcı', 'Predictor')} value={lmPred} options={numericCols} onChange={setLmPred} />
              ) : (
                <div>
                  <label className="hp-label">{t('Ortak değişkenler', 'Covariates')}</label>
                  <div style={{ maxHeight: 160, overflowY: 'auto', border: '1px solid var(--color-rule)', padding: 'var(--space-xs)' }}>
                    {numericCols.map((c) => (
                      <label key={c} style={{ display: 'flex', gap: 'var(--space-xs)', fontSize: 'var(--text-xs)', alignItems: 'center' }}>
                        <input
                          type="checkbox"
                          checked={psmCovs.includes(c)}
                          onChange={() => setPsmCovs((prev) => (prev.includes(c) ? prev.filter((x) => x !== c) : [...prev, c]))}
                        />
                        <span className="hp-mono">{c}</span>
                      </label>
                    ))}
                  </div>
                </div>
              )}
            </>
          )}

          {tab === 'bayes' && (
            <>
              <div>
                <label className="hp-label">{t('Test', 'Test')}</label>
                <select className="hp-select" value={bayesMode} onChange={(e) => setBayesMode(e.target.value as 't' | 'anova' | 'corr')}>
                  <option value="t">{t('Bağımsız t testi', 'Independent t test')}</option>
                  <option value="anova">{t('Tek yönlü ANOVA', 'One-way ANOVA')}</option>
                  <option value="corr">{t('Korelasyon', 'Correlation')}</option>
                </select>
              </div>
              <Select label={bayesMode === 'corr' ? t('Değişken 1', 'Variable 1') : t('Bağımlı değişken', 'Dependent variable')} value={bv1} options={numericCols} onChange={setBv1} />
              {bayesMode === 'corr' ? (
                <Select label={t('Değişken 2', 'Variable 2')} value={bv2} options={numericCols} onChange={setBv2} />
              ) : (
                <>
                  <Select label={t('Grup', 'Group')} value={bGroup} options={catCols} onChange={setBGroup} />
                  <div>
                    <label className="hp-label">{t('Önsel ölçek (r)', 'Prior scale (r)')}</label>
                    <input
                      className="hp-input"
                      type="number"
                      step={0.05}
                      min={0.1}
                      value={Number.isFinite(bScale) ? bScale : ''}
                      onChange={(e) => {
                        const v = Number(e.target.value);
                        if (Number.isFinite(v) && v > 0) setBScale(v);
                      }}
                    />
                  </div>
                </>
              )}
            </>
          )}

          {numericCols.length < 2 && (
            <div className="hp-alert hp-alert-warn" role="status">
              {t(
                'İleri analizler için en az 2 sayısal değişken gerekir. Sözel Likert verilerini önce Adım 3 (Veri temizleme) ile sayısala çevirin.',
                'At least 2 numeric variables are required for advanced analyses. Convert verbal Likert items in Step 3 (Data cleaning) first.',
              )}
            </div>
          )}

          <button type="button" className="hp-btn hp-btn-primary" onClick={run} disabled={running || numericCols.length < 2}>
            <Play size={16} />
            <span>{running ? t('Hesaplanıyor...', 'Computing...') : t('Çalıştır', 'Run')}</span>
          </button>
          {errorMsg && (
            <div className="hp-badge hp-badge-err" style={{ whiteSpace: 'normal' }}>
              <AlertCircle size={14} />
              <span>{errorMsg}</span>
            </div>
          )}
        </div>

        <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-md)' }}>
          {running && <div className="hp-skeleton" style={{ height: 160 }} />}
          {!running && !output && (
            <div className="hp-plate-flat" style={{ padding: 'var(--space-xl)', textAlign: 'center', color: 'var(--color-muted)' }}>
              {t('Değişkenleri seçip çalıştırın.', 'Choose variables and run.')}
            </div>
          )}
          {!running && output && (
            <>
              <div className="hp-plate" style={{ padding: 'var(--space-md)' }}>
                <h2 style={{ margin: 0, fontSize: 'var(--text-section)' }}>{output.title}</h2>
                <p style={{ marginBottom: 0, color: 'var(--color-ink-2)', lineHeight: 1.55 }}>{lang === 'tr' ? output.narrativeTr : output.narrativeEn}</p>
              </div>
              {output.tables.map((tb) => (
                <SpecTable key={tb.id} table={tb} lang={lang} />
              ))}
              {output.charts.map((ch) => (
                <ChartPlate key={ch.id} chart={ch} />
              ))}
            </>
          )}
        </div>
      </div>
    </div>
  );
};

export default AdvancedStatsPage;

import React, { useEffect, useMemo, useState } from 'react';
import {
  Activity,
  AlertTriangle,
  ArrowRight,
  CheckCircle2,
  Compass,
  Database,
  GitBranch,
  Info,
  Layers,
  Play,
  PlusCircle,
  ShieldCheck,
  SlidersHorizontal,
  Table2,
} from 'lucide-react';
import { AnalysisOutput, ColumnMeta, Dataset, Lang } from '../../types/interfaces';
import { errorMessage } from '../../components/errorMessage';
import { scanDatasetAssumptions } from './assumptionScanner';
import { DecisionNode, RecommendationResult, recommendAndRun, ResearchDesign } from './decisionEngine';

export interface AutopilotPanelProps {
  dataset: Dataset;
  lang: Lang;
  onApplyAnalysis?: (output: AnalysisOutput) => void;
}

interface DesignOption {
  id: ResearchDesign;
  labelTr: string;
  labelEn: string;
}

const DESIGN_OPTIONS: DesignOption[] = [
  { id: 'compare_2_indep', labelTr: 'İki bağımsız grup', labelEn: 'Two independent groups' },
  { id: 'compare_k_indep', labelTr: 'Üç veya daha fazla bağımsız grup', labelEn: 'Three or more independent groups' },
  { id: 'compare_2_paired', labelTr: 'İki eşleştirilmiş ölçüm', labelEn: 'Two paired measures' },
  { id: 'compare_k_paired', labelTr: 'Tekrarlı ölçümler', labelEn: 'Repeated measures' },
  { id: 'relationship', labelTr: 'İlişki', labelEn: 'Relationship' },
  { id: 'prediction', labelTr: 'Yordama', labelEn: 'Prediction' },
];

function fmtNum(val: number | null | undefined, digits = 3): string {
  if (val === null || val === undefined || !Number.isFinite(val)) return '--';
  return val.toFixed(digits);
}

function classifyColumns(dataset: Dataset): {
  numericCols: ColumnMeta[];
  scaleCols: ColumnMeta[];
  twoGroupCols: ColumnMeta[];
  multiGroupCols: ColumnMeta[];
  allGroupCols: ColumnMeta[];
  predictionTargets: ColumnMeta[];
} {
  const numericCols = dataset.columns.filter((c) => c.valueType === 'numeric');
  const scaleCols = numericCols.filter((c) => c.scale === 'scale');
  const orderedNum = scaleCols.length > 0 ? scaleCols : numericCols;

  const allGroupCols = dataset.columns.filter(
    (c) =>
      c.valueType === 'categorical' ||
      c.scale === 'nominal' ||
      (c.uniqueCount >= 2 && c.uniqueCount <= 12 && c.valueType !== 'string'),
  );
  const twoGroupCols = allGroupCols.filter((c) => c.uniqueCount === 2);
  const multiGroupCols = allGroupCols.filter((c) => c.uniqueCount >= 3);
  const binaryCols = dataset.columns.filter((c) => c.uniqueCount === 2);

  const targetMap = new Map<string, ColumnMeta>();
  for (const c of [...orderedNum, ...binaryCols]) {
    if (!targetMap.has(c.name)) targetMap.set(c.name, c);
  }

  return {
    numericCols,
    scaleCols: orderedNum,
    twoGroupCols: twoGroupCols.length > 0 ? twoGroupCols : allGroupCols,
    multiGroupCols: multiGroupCols.length > 0 ? multiGroupCols : allGroupCols,
    allGroupCols,
    predictionTargets: Array.from(targetMap.values()),
  };
}

function defaultSelectionForDesign(
  design: ResearchDesign,
  dataset: Dataset,
): {
  dependent: string;
  secondary: string;
  predictors: string[];
  repeatedVars: string[];
} {
  const { numericCols, scaleCols, twoGroupCols, multiGroupCols, allGroupCols, predictionTargets } =
    classifyColumns(dataset);
  const numNames = numericCols.map((c) => c.name);
  const scaleNames = scaleCols.map((c) => c.name);

  const preferredDep = scaleNames[scaleNames.length - 1] || numNames[0] || '';
  const firstNum = scaleNames[0] || numNames[0] || '';
  const secondNum = scaleNames[1] || numNames[1] || firstNum;

  const repeatedCandidate =
    scaleNames.includes('Basari_On') && scaleNames.includes('Basari_Ara') && scaleNames.includes('Basari_Son')
      ? ['Basari_On', 'Basari_Ara', 'Basari_Son']
      : scaleNames.slice(0, Math.min(3, scaleNames.length));

  switch (design) {
    case 'compare_2_indep':
      return {
        dependent: firstNum,
        secondary: twoGroupCols[0]?.name || allGroupCols[0]?.name || '',
        predictors: [],
        repeatedVars: repeatedCandidate,
      };
    case 'compare_k_indep':
      return {
        dependent: secondNum || firstNum,
        secondary: multiGroupCols[0]?.name || allGroupCols[0]?.name || '',
        predictors: [],
        repeatedVars: repeatedCandidate,
      };
    case 'compare_2_paired':
      return {
        dependent: scaleNames.includes('Basari_On') ? 'Basari_On' : firstNum,
        secondary: scaleNames.includes('Basari_Son') ? 'Basari_Son' : secondNum,
        predictors: [],
        repeatedVars: repeatedCandidate,
      };
    case 'compare_k_paired':
      return {
        dependent: repeatedCandidate[0] || firstNum,
        secondary: repeatedCandidate[1] || secondNum,
        predictors: [],
        repeatedVars: repeatedCandidate,
      };
    case 'relationship':
      return {
        dependent: firstNum,
        secondary: secondNum,
        predictors: [],
        repeatedVars: repeatedCandidate,
      };
    case 'prediction': {
      const target = preferredDep || predictionTargets[0]?.name || '';
      const preds = scaleNames.filter((n) => n !== target).slice(0, 2);
      return {
        dependent: target,
        secondary: preds[0] || '',
        predictors: preds.length > 0 ? preds : numNames.filter((n) => n !== target).slice(0, 1),
        repeatedVars: repeatedCandidate,
      };
    }
  }
}

export function AutopilotPanel({ dataset, lang, onApplyAnalysis }: AutopilotPanelProps): JSX.Element {
  const isTr = lang === 'tr';
  const colGroups = useMemo(() => classifyColumns(dataset), [dataset]);
  const scanReport = useMemo(() => scanDatasetAssumptions(dataset), [dataset]);

  const [design, setDesign] = useState<ResearchDesign>('compare_2_indep');
  const [dependent, setDependent] = useState<string>(() => defaultSelectionForDesign('compare_2_indep', dataset).dependent);
  const [secondary, setSecondary] = useState<string>(() => defaultSelectionForDesign('compare_2_indep', dataset).secondary);
  const [predictors, setPredictors] = useState<string[]>(() => defaultSelectionForDesign('compare_2_indep', dataset).predictors);
  const [repeatedVars, setRepeatedVars] = useState<string[]>(
    () => defaultSelectionForDesign('compare_2_indep', dataset).repeatedVars,
  );
  const [result, setResult] = useState<RecommendationResult | null>(null);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [appliedId, setAppliedId] = useState<string | null>(null);

  useEffect(() => {
    const defaults = defaultSelectionForDesign(design, dataset);
    setDependent(defaults.dependent);
    setSecondary(defaults.secondary);
    setPredictors(defaults.predictors);
    setRepeatedVars(defaults.repeatedVars);
    setResult(null);
    setErrorMsg(null);
    setAppliedId(null);
  }, [dataset.id, design]);

  const handleToggleItem = (list: string[], setList: (next: string[]) => void, item: string) => {
    if (list.includes(item)) {
      setList(list.filter((x) => x !== item));
    } else {
      setList([...list, item]);
    }
  };

  const handleRunAutopilot = () => {
    setErrorMsg(null);
    setAppliedId(null);
    try {
      const rec = recommendAndRun(dataset, {
        design,
        dependent,
        secondary: secondary || undefined,
        predictors,
        repeatedVars,
      });
      setResult(rec);
    } catch (err) {
      setResult(null);
      setErrorMsg(errorMessage(err, lang));
    }
  };

  const handleApply = () => {
    if (!result || !onApplyAnalysis) return;
    onApplyAnalysis(result.output);
    setAppliedId(result.output.id);
  };

  const normalPassedCount = scanReport.variables.filter((v) => v.normalityOk).length;
  const imputationBadgeClass =
    scanReport.recommendedImputation === 'none'
      ? 'hp-badge hp-badge-ok'
      : scanReport.recommendedImputation === 'listwise'
        ? 'hp-badge hp-badge-warn'
        : 'hp-badge hp-badge-err';

  const imputationLabel =
    scanReport.recommendedImputation === 'none'
      ? isTr
        ? 'Kayıp veri yok'
        : 'No missing data'
      : scanReport.recommendedImputation === 'listwise'
        ? isTr
          ? 'Liste bazlı silme uygun'
          : 'Listwise deletion acceptable'
        : isTr
          ? 'Kayıp veri ataması önerilir'
          : 'Imputation recommended';

  const renderNodeIcon = (nodeResult: DecisionNode['result']) => {
    if (nodeResult === 'pass') return <CheckCircle2 size={15} />;
    if (nodeResult === 'warn') return <AlertTriangle size={15} />;
    return <GitBranch size={15} />;
  };

  const renderNodeBadgeClass = (nodeResult: DecisionNode['result']) => {
    if (nodeResult === 'pass') return 'hp-badge hp-badge-ok';
    if (nodeResult === 'warn') return 'hp-badge hp-badge-warn';
    return 'hp-badge hp-badge-info';
  };

  const renderNodeAccentColor = (nodeResult: DecisionNode['result']) => {
    if (nodeResult === 'pass') return 'var(--color-success)';
    if (nodeResult === 'warn') return 'var(--color-warn)';
    return 'var(--color-accent)';
  };

  const numVarOptions = colGroups.numericCols.map((c) => c.name);
  const groupOptions =
    design === 'compare_2_indep'
      ? colGroups.twoGroupCols.map((c) => c.name)
      : colGroups.multiGroupCols.map((c) => c.name);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-lg)' }}>
      <section className="hp-plate" aria-label={isTr ? 'Veri özeti' : 'Data summary'}>
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            flexWrap: 'wrap',
            gap: 'var(--space-sm)',
            marginBottom: 'var(--space-md)',
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-xs)' }}>
            <Database size={18} />
            <h2>{isTr ? 'Veri özeti' : 'Data summary'}</h2>
          </div>
          <span className={imputationBadgeClass}>{imputationLabel}</span>
        </div>

        <div className="hp-grid-4" style={{ marginBottom: 'var(--space-md)' }}>
          <div className="hp-plate-flat">
            <div className="hp-label">N</div>
            <div className="hp-kpi-val">{scanReport.totalRows}</div>
          </div>

          <div className="hp-plate-flat">
            <div className="hp-label">{isTr ? 'Tam vaka' : 'Complete cases'}</div>
            <div className="hp-kpi-val">{scanReport.missingPattern.listwiseComplete}</div>
            <div style={{ fontSize: 'var(--text-xs)', color: 'var(--color-muted)' }}>
              {scanReport.totalRows > 0
                ? `%${((scanReport.missingPattern.listwiseComplete / scanReport.totalRows) * 100).toFixed(1)}`
                : '--'}
            </div>
          </div>

          <div className="hp-plate-flat">
            <div className="hp-label">{isTr ? 'Kayıp hücre' : 'Missing cells'}</div>
            <div className="hp-kpi-val">{scanReport.missingPattern.totalMissing}</div>
          </div>

          <div className="hp-plate-flat">
            <div className="hp-label">{isTr ? 'Normal dağılan' : 'Normally distributed'}</div>
            <div className="hp-kpi-val">
              {normalPassedCount}/{scanReport.variables.length}
            </div>
          </div>
        </div>

        <div
          className="hp-plate-flat"
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 'var(--space-xs)',
            marginBottom: 'var(--space-md)',
            background: 'var(--color-paper)',
          }}
        >
          <Info size={16} />
          <span style={{ fontSize: 'var(--text-sm)' }}>{scanReport.missingPattern.littleMcarNote}</span>
        </div>

        <div className="hp-table-wrap">
          <table className="hp-table">
            <thead>
              <tr>
                <th>{isTr ? 'Değişken' : 'Variable'}</th>
                <th className="num">N</th>
                <th className="num">{isTr ? 'Kayıp' : 'Missing'}</th>
                <th className="num">{isTr ? 'Ort. ± SS' : 'Mean ± SD'}</th>
                <th className="num">W</th>
                <th className="num">p</th>
                <th className="num">{isTr ? 'Çarpıklık / basıklık' : 'Skew / kurtosis'}</th>
                <th className="num">{isTr ? 'Uç değer (IQR / Z)' : 'Outliers (IQR / Z)'}</th>
                <th>{isTr ? 'Normallik' : 'Normality'}</th>
              </tr>
            </thead>
            <tbody>
              {scanReport.variables.map((v) => (
                <tr key={v.variable}>
                  <td className="hp-mono">{v.variable}</td>
                  <td className="num">{v.n}</td>
                  <td className="num">
                    {v.missing > 0 ? <span className="hp-badge hp-badge-warn">{v.missing}</span> : <span>0</span>}
                  </td>
                  <td className="num">
                    {fmtNum(v.mean, 2)} ± {fmtNum(v.std, 2)}
                  </td>
                  <td className="num">{fmtNum(v.shapiroW, 4)}</td>
                  <td className="num">{fmtNum(v.shapiroP, 4)}</td>
                  <td className="num">
                    {fmtNum(v.skewness, 2)} / {fmtNum(v.kurtosis, 2)}
                  </td>
                  <td className="num">
                    {v.iqrOutlierCount} / {v.zOutlierCount}
                  </td>
                  <td>
                    <span className={v.normalityOk ? 'hp-badge hp-badge-ok' : 'hp-badge hp-badge-warn'}>
                      {v.normalityOk ? (isTr ? 'Normal' : 'Normal') : isTr ? 'Normal değil' : 'Non-normal'}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <section className="hp-plate" aria-label={isTr ? 'Test önerisi' : 'Test recommendation'}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-xs)', marginBottom: 'var(--space-md)' }}>
          <Compass size={18} />
          <h2>{isTr ? 'Test önerisi' : 'Test recommendation'}</h2>
        </div>

        <div className="hp-grid-3" style={{ marginBottom: 'var(--space-md)' }}>
          {DESIGN_OPTIONS.map((opt) => {
            const active = design === opt.id;
            return (
              <button
                key={opt.id}
                type="button"
                className={active ? 'hp-btn hp-btn-primary' : 'hp-btn'}
                style={{
                  flexDirection: 'column',
                  alignItems: 'flex-start',
                  justifyContent: 'center',
                  padding: 'var(--space-sm) var(--space-md)',
                  minHeight: '48px',
                  textAlign: 'left',
                }}
                onClick={() => setDesign(opt.id)}
              >
                <span style={{ fontWeight: 700 }}>{isTr ? opt.labelTr : opt.labelEn}</span>
              </button>
            );
          })}
        </div>

        <div className="hp-plate-flat" style={{ background: 'var(--color-paper)', marginBottom: 'var(--space-md)' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-xs)', marginBottom: 'var(--space-sm)' }}>
            <SlidersHorizontal size={15} />
            <span style={{ fontSize: 'var(--text-sm)', fontWeight: 600 }}>
              {isTr ? 'Değişkenler' : 'Variables'}
            </span>
          </div>

          {(design === 'compare_2_indep' || design === 'compare_k_indep') && (
            <div className="hp-grid-2">
              <div>
                <label className="hp-label" htmlFor="autopilot-dep">
                  {isTr ? 'Bağımlı değişken' : 'Dependent variable'}
                </label>
                <select
                  id="autopilot-dep"
                  className="hp-select"
                  value={dependent}
                  onChange={(e) => setDependent(e.target.value)}
                >
                  {numVarOptions.map((v) => (
                    <option key={v} value={v}>
                      {v}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label className="hp-label" htmlFor="autopilot-group">
                  {isTr ? 'Grup değişkeni' : 'Grouping variable'}
                </label>
                <select
                  id="autopilot-group"
                  className="hp-select"
                  value={secondary}
                  onChange={(e) => setSecondary(e.target.value)}
                >
                  {groupOptions.map((g) => (
                    <option key={g} value={g}>
                      {g}
                    </option>
                  ))}
                </select>
              </div>
            </div>
          )}

          {(design === 'compare_2_paired' || design === 'relationship') && (
            <div className="hp-grid-2">
              <div>
                <label className="hp-label" htmlFor="autopilot-var1">
                  {design === 'compare_2_paired'
                    ? isTr
                      ? 'Ön test'
                      : 'Pre-test'
                    : isTr
                      ? 'Değişken X'
                      : 'Variable X'}
                </label>
                <select
                  id="autopilot-var1"
                  className="hp-select"
                  value={dependent}
                  onChange={(e) => setDependent(e.target.value)}
                >
                  {numVarOptions.map((v) => (
                    <option key={v} value={v}>
                      {v}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label className="hp-label" htmlFor="autopilot-var2">
                  {design === 'compare_2_paired'
                    ? isTr
                      ? 'Son test'
                      : 'Post-test'
                    : isTr
                      ? 'Değişken Y'
                      : 'Variable Y'}
                </label>
                <select
                  id="autopilot-var2"
                  className="hp-select"
                  value={secondary}
                  onChange={(e) => setSecondary(e.target.value)}
                >
                  {numVarOptions.map((v) => (
                    <option key={v} value={v}>
                      {v}
                    </option>
                  ))}
                </select>
              </div>
            </div>
          )}

          {design === 'compare_k_paired' && (
            <div>
              <div className="hp-label">
                {isTr ? 'Ölçümler (en az 2)' : 'Measures (at least 2)'}
              </div>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 'var(--space-xs)' }}>
                {numVarOptions.map((v) => {
                  const selected = repeatedVars.includes(v);
                  return (
                    <button
                      key={v}
                      type="button"
                      className={selected ? 'hp-btn hp-btn-sm hp-btn-primary' : 'hp-btn hp-btn-sm'}
                      onClick={() => handleToggleItem(repeatedVars, setRepeatedVars, v)}
                    >
                      {v}
                    </button>
                  );
                })}
              </div>
            </div>
          )}

          {design === 'prediction' && (
            <div className="hp-grid-2">
              <div>
                <label className="hp-label" htmlFor="autopilot-target">
                  {isTr ? 'Bağımlı değişken' : 'Outcome'}
                </label>
                <select
                  id="autopilot-target"
                  className="hp-select"
                  value={dependent}
                  onChange={(e) => {
                    const nextTarget = e.target.value;
                    setDependent(nextTarget);
                    setPredictors((prev) => prev.filter((p) => p !== nextTarget));
                  }}
                >
                  {colGroups.predictionTargets.map((c) => (
                    <option key={c.name} value={c.name}>
                      {c.name} ({c.uniqueCount === 2 ? (isTr ? 'ikili' : 'binary') : isTr ? 'sürekli' : 'continuous'})
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <div className="hp-label">
                  {isTr ? 'Yordayıcılar' : 'Predictors'}
                </div>
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 'var(--space-xs)' }}>
                  {numVarOptions
                    .filter((v) => v !== dependent)
                    .map((v) => {
                      const selected = predictors.includes(v);
                      return (
                        <button
                          key={v}
                          type="button"
                          className={selected ? 'hp-btn hp-btn-sm hp-btn-primary' : 'hp-btn hp-btn-sm'}
                          onClick={() => handleToggleItem(predictors, setPredictors, v)}
                        >
                          {v}
                        </button>
                      );
                    })}
                </div>
              </div>
            </div>
          )}
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-sm)', flexWrap: 'wrap' }}>
          <button type="button" className="hp-btn hp-btn-primary" onClick={handleRunAutopilot}>
            <Play size={16} />
            <span>{isTr ? 'Test öner ve çalıştır' : 'Recommend and run'}</span>
          </button>
        </div>

        {errorMsg && (
          <div
            className="hp-plate-flat"
            style={{
              marginTop: 'var(--space-md)',
              borderColor: 'var(--color-error)',
              background: 'var(--color-error-soft)',
              display: 'flex',
              alignItems: 'center',
              gap: 'var(--space-xs)',
            }}
          >
            <AlertTriangle size={16} />
            <span>{errorMsg}</span>
          </div>
        )}
      </section>

      {result && (
        <section className="hp-plate" aria-label={isTr ? 'Sonuç' : 'Result'}>
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              flexWrap: 'wrap',
              gap: 'var(--space-sm)',
              marginBottom: 'var(--space-md)',
            }}
          >
            <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-xs)' }}>
              <GitBranch size={18} />
              <h2>{isTr ? 'Sonuç' : 'Result'}</h2>
            </div>
            {onApplyAnalysis && (
              <button type="button" className="hp-btn hp-btn-accent" onClick={handleApply}>
                <PlusCircle size={16} />
                <span>
                  {appliedId === result.output.id
                    ? isTr
                      ? 'Eklendi'
                      : 'Added'
                    : isTr
                      ? 'Geçmişe ekle'
                      : 'Add to history'}
                </span>
              </button>
            )}
          </div>

              <div
            style={{
              display: 'flex',
              flexWrap: 'wrap',
              alignItems: 'stretch',
              gap: 'var(--space-xs)',
              marginBottom: 'var(--space-md)',
            }}
          >
            {result.decisionPath.map((node, idx) => (
              <React.Fragment key={node.id}>
                <div
                  className="hp-plate-flat"
                  style={{
                    flex: '1 1 180px',
                    minWidth: '170px',
                    borderLeftWidth: '4px',
                    borderLeftColor: renderNodeAccentColor(node.result),
                    background: node.result === 'route' ? 'var(--color-accent-soft)' : 'var(--color-plate)',
                  }}
                >
                  <div
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'space-between',
                      gap: 'var(--space-xs)',
                      marginBottom: 'var(--space-2xs)',
                    }}
                  >
                    <span style={{ fontSize: 'var(--text-xs)', fontWeight: 700 }}>{node.label}</span>
                    <span className={renderNodeBadgeClass(node.result)}>{renderNodeIcon(node.result)}</span>
                  </div>
                  <div style={{ fontSize: 'var(--text-xs)', color: 'var(--color-ink-2)' }}>{node.condition}</div>
                </div>
                {idx < result.decisionPath.length - 1 && (
                  <div style={{ display: 'flex', alignItems: 'center', color: 'var(--color-muted)' }}>
                    <ArrowRight size={16} />
                  </div>
                )}
              </React.Fragment>
            ))}
          </div>

          <div className="hp-grid-2" style={{ marginBottom: 'var(--space-md)' }}>
            <div className="hp-band-ink">
              <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-xs)', marginBottom: 'var(--space-xs)' }}>
                <Layers size={16} />
                <span style={{ fontSize: 'var(--text-xs)' }}>
                  {isTr ? 'Önerilen test' : 'Recommended test'}
                </span>
              </div>
              <div style={{ fontSize: 'var(--text-lg)', fontWeight: 700, marginBottom: 'var(--space-xs)' }}>
                {result.recommendedTest}
              </div>
              <p style={{ fontSize: 'var(--text-sm)', opacity: 0.92 }}>
                {isTr ? result.reasonTr : result.reasonEn}
              </p>
            </div>

            <div className="hp-plate-flat" style={{ background: 'var(--color-paper)' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-xs)', marginBottom: 'var(--space-xs)' }}>
                <Activity size={16} />
                <span className="hp-label" style={{ marginBottom: 0 }}>
                  {isTr ? 'Alternatif test' : 'Alternative test'}
                </span>
              </div>
              <div style={{ fontSize: 'var(--text-md)', fontWeight: 700, marginBottom: 'var(--space-xs)' }}>
                {result.alternativeTest}
              </div>
              <p style={{ fontSize: 'var(--text-xs)', color: 'var(--color-muted)' }}>
                {isTr ? result.output.narrativeTr : result.output.narrativeEn}
              </p>
            </div>
          </div>

          {result.output.assumptions && result.output.assumptions.length > 0 && (
            <div style={{ marginBottom: 'var(--space-md)' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-xs)', marginBottom: 'var(--space-xs)' }}>
                <ShieldCheck size={15} />
                <span className="hp-label" style={{ marginBottom: 0 }}>
                  {isTr ? 'Varsayımlar' : 'Assumptions'}
                </span>
              </div>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 'var(--space-xs)' }}>
                {result.output.assumptions.map((badge, i) => (
                  <span
                    key={`${badge.name}-${i}`}
                    className={badge.passed ? 'hp-badge hp-badge-ok' : 'hp-badge hp-badge-warn'}
                    title={badge.detail}
                  >
                    {badge.passed ? <CheckCircle2 size={13} /> : <AlertTriangle size={13} />}
                    <span>
                      {badge.name}: {badge.statisticLabel}
                      {badge.pValue !== undefined && badge.pValue !== null ? ` (p=${fmtNum(badge.pValue, 4)})` : ''}
                    </span>
                  </span>
                ))}
              </div>
            </div>
          )}

          <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-md)' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-xs)' }}>
              <Table2 size={16} />
              <h3>{isTr ? 'Tablolar' : 'Tables'}</h3>
            </div>
            {result.output.tables.map((table) => (
              <div key={table.id} className="hp-plate-flat">
                <div style={{ fontWeight: 600, fontSize: 'var(--text-sm)', marginBottom: 'var(--space-xs)' }}>
                  {table.title}
                </div>
                <div className="hp-table-wrap">
                  <table className="hp-table">
                    <thead>
                      <tr>
                        {table.columns.map((col) => (
                          <th key={col.key} className={col.numeric ? 'num' : undefined}>
                            {col.label}
                          </th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {table.rows.map((row, rIdx) => {
                        const isHighlighted = Object.values(row).some(
                          (val) => typeof val === 'string' && val.includes('[Önerilen]'),
                        );
                        return (
                          <tr
                            key={rIdx}
                            style={isHighlighted ? { background: 'var(--color-accent-soft)' } : undefined}
                          >
                            {table.columns.map((col) => {
                              const cellVal = row[col.key];
                              const display =
                                cellVal === null || cellVal === undefined
                                  ? '--'
                                  : typeof cellVal === 'boolean'
                                    ? cellVal
                                      ? isTr ? 'Evet' : 'Yes'
                                      : isTr ? 'Hayır' : 'No'
                                    : String(cellVal);
                              return (
                                <td key={col.key} className={col.numeric ? 'num' : undefined}>
                                  {display}
                                </td>
                              );
                            })}
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
                {table.footnotes && table.footnotes.length > 0 && (
                  <div style={{ marginTop: 'var(--space-xs)', fontSize: 'var(--text-xs)', color: 'var(--color-muted)' }}>
                    {table.footnotes.join(' ')}
                  </div>
                )}
              </div>
            ))}
          </div>
        </section>
      )}
    </div>
  );
}

export default AutopilotPanel;

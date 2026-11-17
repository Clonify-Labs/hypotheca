import React, { useMemo, useState } from 'react';
import {
  Background,
  Controls,
  Edge,
  MarkerType,
  Node,
  ReactFlow,
} from '@xyflow/react';
import { Network, Play, Plus, Trash2 } from 'lucide-react';
import { runCbSem, runPlsSem, SemFactorSpec, SemPathSpec } from '../engine/classical';
import { AnalysisOutput, Dataset, Lang } from '../types/interfaces';
import { SpecTable } from './SpecTable';
import { errorMessage } from './errorMessage';

export interface SemCanvasPageProps {
  dataset: Dataset;
  lang: Lang;
  onAnalysisDone: (output: AnalysisOutput) => void;
}

export const SemCanvasPage: React.FC<SemCanvasPageProps> = ({ dataset, lang, onAnalysisDone }) => {
  const numericCols = useMemo(
    () => dataset.columns.filter((c) => c.valueType === 'numeric').map((c) => c.name),
    [dataset],
  );

  const [mode, setMode] = useState<'cb_sem' | 'pls_sem'>('cb_sem');
  const [factors, setFactors] = useState<SemFactorSpec[]>(() => {
    const hasOy = ['OY1', 'OY2', 'OY3', 'OY4'].every((c) => numericCols.includes(c));
    const hasYz = ['YZ1', 'YZ2', 'YZ3', 'YZ4'].every((c) => numericCols.includes(c));
    const hasTk = ['TK1', 'TK2', 'TK3', 'TK4'].every((c) => numericCols.includes(c));
    if (hasOy && hasYz && hasTk) {
      return [
        { name: 'OzYeterlik', indicators: ['OY1', 'OY2', 'OY3', 'OY4'] },
        { name: 'YATutumu', indicators: ['YZ1', 'YZ2', 'YZ3', 'YZ4'] },
        { name: 'Tukenmislik', indicators: ['TK1', 'TK2', 'TK3', 'TK4'] },
      ];
    }
    return [
      { name: 'Factor1', indicators: numericCols.slice(0, 3) },
      { name: 'Factor2', indicators: numericCols.slice(3, 6) },
    ];
  });

  const [paths, setPaths] = useState<SemPathSpec[]>(() => [
    { from: factors[0]?.name || 'Factor1', to: factors[1]?.name || 'Factor2' },
    ...(factors[2] ? [{ from: factors[1].name, to: factors[2].name }] : []),
  ]);
  const [newPathFrom, setNewPathFrom] = useState(factors[0]?.name || '');
  const [newPathTo, setNewPathTo] = useState(factors[1]?.name || '');
  const [output, setOutput] = useState<AnalysisOutput | null>(null);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  const flowElements = useMemo(() => {
    const nodes: Node[] = [];
    const edges: Edge[] = [];

    factors.forEach((f, fIdx) => {
      const fx = 140 + fIdx * 260;
      const fy = 120;
      nodes.push({
        id: `fac-${f.name}`,
        position: { x: fx, y: fy },
        data: { label: f.name },
        style: {
          border: '1px solid var(--color-accent)',
          background: 'var(--color-accent-soft)',
          color: 'var(--color-ink)',
          fontWeight: 600,
          borderRadius: '999px',
          padding: '10px 18px',
        },
      });
      f.indicators.forEach((ind, iIdx) => {
        const ix = fx - 55 + iIdx * 60;
        const iy = 250 + (iIdx % 2) * 48;
        const indId = `ind-${f.name}-${ind}`;
        nodes.push({
          id: indId,
          position: { x: ix, y: iy },
          data: { label: ind },
          style: {
            border: '1px solid var(--color-rule-strong)',
            background: 'var(--color-plate)',
            color: 'var(--color-ink-2)',
            fontSize: '12px',
            borderRadius: '6px',
            padding: '5px 10px',
          },
        });
        edges.push({
          id: `e-load-${f.name}-${ind}`,
          source: `fac-${f.name}`,
          target: indId,
          markerEnd: { type: MarkerType.ArrowClosed },
          style: { stroke: 'var(--color-muted)' },
        });
      });
    });

    const pathTable = output?.tables.find((t) => t.id === 'cbsem_params' || t.id === 'pls_paths');
    paths.forEach((pt, idx) => {
      let label = pt.from + ' -> ' + pt.to;
      if (pathTable) {
        const match = pathTable.rows.find((r) => String(r.relation || r.path).includes(`${pt.from} -> ${pt.to}`));
        if (match) {
          const coef = match.beta ?? match.est;
          label = `β = ${coef} ${match.sig || ''}`;
        }
      }
      edges.push({
        id: `e-path-${idx}`,
        source: `fac-${pt.from}`,
        target: `fac-${pt.to}`,
        label,
        animated: true,
        markerEnd: { type: MarkerType.ArrowClosed },
        style: { stroke: 'var(--color-accent)', strokeWidth: 2 },
      });
    });

    return { nodes, edges };
  }, [factors, paths, output]);

  const handleRun = () => {
    setErrorMsg(null);
    try {
      const validFactors = factors.filter((f) => f.indicators.length >= 2);
      const res =
        mode === 'cb_sem'
          ? runCbSem(dataset, { factors: validFactors, paths })
          : runPlsSem(dataset, { factors: validFactors, paths }, 200);
      setOutput(res);
      onAnalysisDone(res);
    } catch (err) {
      setErrorMsg(errorMessage(err, lang));
    }
  };

  const hasIndicators = factors.some((f) => f.indicators.length > 0);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-md)' }}>
      {numericCols.length < 4 && (
        <div className="hp-alert hp-alert-warn" role="status">
          {lang === 'tr'
            ? 'SEM analizi için en az 4 sayısal gösterge değişkeni gerekir. Veriniz sözel Likert maddeleri içeriyorsa önce Adım 3 (Veri temizleme) ile sayısala çevirin.'
            : 'SEM requires at least 4 numeric indicator variables. If your dataset has verbal Likert items, convert them first in Step 3 (Data cleaning).'}
        </div>
      )}
      <div className="hp-workbench-cols">
        <div className="hp-plate" style={{ padding: 'var(--space-md)', display: 'flex', flexDirection: 'column', gap: 'var(--space-md)' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-xs)' }}>
            <Network size={18} />
            <h2 style={{ margin: 0, fontSize: 'var(--text-title)', fontWeight: 700 }}>
              {lang === 'tr' ? 'Yapısal eşitlik modeli' : 'Structural equation model'}
            </h2>
          </div>

          <div className="hp-tabs" style={{ marginBottom: 0 }}>
            <button type="button" className={mode === 'cb_sem' ? 'hp-tab is-active' : 'hp-tab'} onClick={() => setMode('cb_sem')}>
              CB-SEM
            </button>
            <button type="button" className={mode === 'pls_sem' ? 'hp-tab is-active' : 'hp-tab'} onClick={() => setMode('pls_sem')}>
              PLS-SEM
            </button>
          </div>

          {factors.map((f, fIdx) => (
            <div key={f.name} className="hp-plate-flat" style={{ padding: 'var(--space-xs)' }}>
              <div style={{ fontWeight: 700, fontSize: 'var(--text-sm)', marginBottom: 'var(--space-2xs)' }}>
                {f.name} ({f.indicators.length})
              </div>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 'var(--space-2xs)' }}>
                {numericCols.slice(0, 12).map((col) => {
                  const active = f.indicators.includes(col);
                  return (
                    <button
                      key={col}
                      type="button"
                      className={active ? 'hp-btn hp-btn-sm hp-btn-accent' : 'hp-btn hp-btn-sm'}
                      onClick={() => {
                        setFactors((prev) =>
                          prev.map((pf, idx) =>
                            idx === fIdx
                              ? {
                                  ...pf,
                                  indicators: active ? pf.indicators.filter((x) => x !== col) : [...pf.indicators, col],
                                }
                              : pf,
                          ),
                        );
                      }}
                    >
                      {col}
                    </button>
                  );
                })}
              </div>
            </div>
          ))}

          <div className="hp-plate-flat" style={{ padding: 'var(--space-xs)' }}>
            <div className="hp-label">{lang === 'tr' ? 'Yollar' : 'Paths'}</div>
            <div style={{ display: 'flex', gap: 'var(--space-2xs)', marginBottom: 'var(--space-xs)' }}>
              <select className="hp-select" value={newPathFrom} onChange={(e) => setNewPathFrom(e.target.value)}>
                {factors.map((f) => (
                  <option key={f.name} value={f.name}>
                    {f.name}
                  </option>
                ))}
              </select>
              <select className="hp-select" value={newPathTo} onChange={(e) => setNewPathTo(e.target.value)}>
                {factors.map((f) => (
                  <option key={f.name} value={f.name}>
                    {f.name}
                  </option>
                ))}
              </select>
              <button
                type="button"
                className="hp-btn hp-btn-sm"
                onClick={() => {
                  if (newPathFrom && newPathTo && newPathFrom !== newPathTo) {
                    setPaths((p) => (p.some((x) => x.from === newPathFrom && x.to === newPathTo) ? p : [...p, { from: newPathFrom, to: newPathTo }]));
                  }
                }}
              >
                <Plus size={14} />
              </button>
            </div>
            {paths.map((pt, i) => (
              <div key={i} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', fontSize: 'var(--text-xs)', padding: '2px 0' }}>
                <span className="hp-mono">
                  {pt.from} {'->'} {pt.to}
                </span>
                <button type="button" className="hp-btn hp-btn-sm" onClick={() => setPaths((p) => p.filter((_, idx) => idx !== i))}>
                  <Trash2 size={12} />
                </button>
              </div>
            ))}
          </div>

          <button type="button" className="hp-btn hp-btn-primary" onClick={handleRun} disabled={!hasIndicators || numericCols.length < 4}>
            <Play size={16} />
            <span>{lang === 'tr' ? 'Modeli kestir' : 'Estimate model'}</span>
          </button>

          {errorMsg && (
            <div className="hp-badge hp-badge-err" style={{ whiteSpace: 'normal' }}>
              {errorMsg}
            </div>
          )}
        </div>

        <div className="hp-plate" style={{ padding: 'var(--space-md)', minHeight: 420 }}>
          <h3 style={{ margin: '0 0 var(--space-xs) 0', fontSize: 'var(--text-title)' }}>
            {lang === 'tr' ? 'Yol diyagramı' : 'Path diagram'}
          </h3>
          <div style={{ width: '100%', height: 370, border: '1px solid var(--color-rule)' }}>
            <ReactFlow nodes={flowElements.nodes} edges={flowElements.edges} fitView>
              <Background />
              <Controls />
            </ReactFlow>
          </div>
        </div>
      </div>

      {output && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-md)' }}>
          {output.tables.map((t) => (
            <SpecTable key={t.id} table={t} lang={lang} />
          ))}
        </div>
      )}
    </div>
  );
};

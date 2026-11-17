import React, { useState } from 'react';
import { Plus, X } from 'lucide-react';
import { Lang } from '../types/interfaces';
import { DESIGN_LABELS, Project, StudyDesign } from './projectStore';

export interface ProjectSetupPageProps {
  project: Project;
  lang: Lang;
  onChange: (patch: Partial<Project>) => void;
}

const MAX_HYPOTHESES = 20;

export const ProjectSetupPage: React.FC<ProjectSetupPageProps> = ({ project, lang, onChange }) => {
  const tr = lang === 'tr';
  const [draft, setDraft] = useState('');

  const addHypothesis = () => {
    const h = draft.replace(/\s+/g, ' ').trim();
    if (!h || project.hypotheses.length >= MAX_HYPOTHESES) return;
    if (project.hypotheses.some((x) => x.toLocaleLowerCase('tr') === h.toLocaleLowerCase('tr'))) {
      setDraft('');
      return;
    }
    onChange({ hypotheses: [...project.hypotheses, h] });
    setDraft('');
  };

  const titleEmpty = project.title.trim().length === 0;

  return (
    <div className="hp-plate" style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-md)' }}>
      <div className="hp-field">
        <label className="hp-label" htmlFor="ps-title">{tr ? 'Çalışma başlığı' : 'Study title'}</label>
        <input id="ps-title" className="hp-input" value={project.title} maxLength={200} onChange={(e) => onChange({ title: e.target.value })} />
        {titleEmpty && <div className="hp-hint" style={{ color: 'var(--color-error)' }}>{tr ? 'Başlık boş bırakılamaz.' : 'Title cannot be empty.'}</div>}
      </div>
      <div className="hp-grid-2">
        <div className="hp-field">
          <label className="hp-label" htmlFor="ps-researcher">{tr ? 'Araştırmacı' : 'Researcher'}</label>
          <input id="ps-researcher" className="hp-input" value={project.researcher} maxLength={120} onChange={(e) => onChange({ researcher: e.target.value })} />
        </div>
        <div className="hp-field">
          <label className="hp-label" htmlFor="ps-design">{tr ? 'Desen' : 'Design'}</label>
          <select id="ps-design" className="hp-select" value={project.design} onChange={(e) => onChange({ design: e.target.value as StudyDesign })}>
            {(Object.keys(DESIGN_LABELS) as StudyDesign[]).map((d) => (
              <option key={d} value={d}>{DESIGN_LABELS[d][lang]}</option>
            ))}
          </select>
        </div>
      </div>
      <div className="hp-field">
        <label className="hp-label" htmlFor="ps-question">{tr ? 'Araştırma sorusu' : 'Research question'}</label>
        <textarea
          id="ps-question"
          className="hp-textarea"
          value={project.question}
          maxLength={2000}
          onChange={(e) => onChange({ question: e.target.value })}
          placeholder={tr ? 'Örn. Akademik öz-yeterlik, tükenmişliği yordamakta mıdır?' : 'e.g. Does academic self-efficacy predict burnout?'}
        />
      </div>
      <div className="hp-field">
        <label className="hp-label" htmlFor="ps-hyp">{tr ? 'Hipotezler' : 'Hypotheses'}</label>
        {project.hypotheses.length > 0 && (
          <ol style={{ margin: '0 0 var(--space-xs)', paddingLeft: 'var(--space-lg)', display: 'flex', flexDirection: 'column', gap: 'var(--space-2xs)' }}>
            {project.hypotheses.map((h, i) => (
              <li key={`${i}-${h}`} style={{ fontSize: 'var(--text-sm)' }}>
                <span style={{ display: 'inline-flex', gap: 'var(--space-xs)', alignItems: 'center' }}>
                  <span style={{ overflowWrap: 'anywhere' }}>{h}</span>
                  <button
                    type="button"
                    className="hp-btn hp-btn-sm hp-btn-ghost"
                    aria-label={tr ? 'Hipotezi kaldır' : 'Remove hypothesis'}
                    onClick={() => onChange({ hypotheses: project.hypotheses.filter((_, j) => j !== i) })}
                  >
                    <X size={12} />
                  </button>
                </span>
              </li>
            ))}
          </ol>
        )}
        <div style={{ display: 'flex', gap: 'var(--space-xs)' }}>
          <input
            id="ps-hyp"
            className="hp-input"
            value={draft}
            maxLength={500}
            disabled={project.hypotheses.length >= MAX_HYPOTHESES}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault();
                addHypothesis();
              }
            }}
            placeholder={tr ? `H${project.hypotheses.length + 1}: ...` : `H${project.hypotheses.length + 1}: ...`}
          />
          <button type="button" className="hp-btn" onClick={addHypothesis} disabled={!draft.trim() || project.hypotheses.length >= MAX_HYPOTHESES}>
            <Plus size={14} />
            {tr ? 'Ekle' : 'Add'}
          </button>
        </div>
      </div>
    </div>
  );
};

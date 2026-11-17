import React, { useState } from 'react';
import { FolderOpen, Plus, Trash2 } from 'lucide-react';
import { Lang } from '../types/interfaces';
import { DESIGN_LABELS, Project, StudyDesign, STEPS, progressRatio, stepStatus } from './projectStore';

export interface ProjectsHomeProps {
  projects: Project[];
  lang: Lang;
  onCreate: (input: { title: string; researcher: string; design: StudyDesign }) => void;
  onCreateSample?: () => void;
  onOpen: (id: string) => void;
  onDelete: (id: string) => void;
  storageOk: boolean;
}

export const ProjectsHome: React.FC<ProjectsHomeProps> = ({ projects, lang, onCreate, onCreateSample, onOpen, onDelete, storageOk }) => {
  const tr = lang === 'tr';
  const [showForm, setShowForm] = useState(projects.length === 0);
  const [title, setTitle] = useState('');
  const [researcher, setResearcher] = useState('');
  const [design, setDesign] = useState<StudyDesign>('cross_sectional');
  const [confirmId, setConfirmId] = useState<string | null>(null);

  const trimmed = title.trim();
  const duplicate = projects.some((p) => p.title.trim().toLocaleLowerCase('tr') === trimmed.toLocaleLowerCase('tr'));
  const canCreate = trimmed.length >= 3 && trimmed.length <= 200 && !duplicate;

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!canCreate) return;
    onCreate({ title: trimmed, researcher: researcher.trim(), design });
    setTitle('');
    setResearcher('');
  };

  const sorted = [...projects].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));

  return (
    <div className="hp-home">
      <div className="hp-home-head" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-end', gap: 'var(--space-md)', flexWrap: 'wrap' }}>
        <div>
          <h1>{tr ? 'Projelerim' : 'My projects'}</h1>
          <p>{tr ? 'Her proje, veriden rapora kadar adım adım ilerler.' : 'Each project moves step by step from data to report.'}</p>
        </div>
        {!showForm && (
          <div style={{ display: 'flex', gap: 'var(--space-xs)', flexWrap: 'wrap' }}>
            {onCreateSample && (
              <button type="button" className="hp-btn" onClick={onCreateSample}>
                {tr ? 'Örnek çalışmayla dene' : 'Try sample study'}
              </button>
            )}
            <button type="button" className="hp-btn hp-btn-primary" onClick={() => setShowForm(true)}>
              <Plus size={16} />
              {tr ? 'Yeni proje' : 'New project'}
            </button>
          </div>
        )}
      </div>

      {!storageOk && (
        <div className="hp-alert hp-alert-warn" role="status">
          {tr
            ? 'Tarayıcı kayda izin vermiyor (gizli pencere veya dolu depolama). Sayfayı kapatınca projeler silinir.'
            : 'The browser does not allow saving (private window or full storage). Projects are lost when the page closes.'}
        </div>
      )}

      {showForm && (
        <form className="hp-plate" onSubmit={submit} style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-md)' }}>
          <h2 style={{ fontSize: 'var(--text-xl)' }}>{tr ? 'Yeni proje' : 'New project'}</h2>
          <div className="hp-field">
            <label className="hp-label" htmlFor="np-title">{tr ? 'Çalışma başlığı' : 'Study title'}</label>
            <input
              id="np-title"
              className="hp-input"
              value={title}
              maxLength={200}
              onChange={(e) => setTitle(e.target.value)}
              placeholder={tr ? 'Örn. Üniversite öğrencilerinde akademik öz-yeterlik ve tükenmişlik' : 'e.g. Academic self-efficacy and burnout in undergraduates'}
              autoFocus
            />
            {duplicate && trimmed && <div className="hp-hint" style={{ color: 'var(--color-error)' }}>{tr ? 'Bu adla bir proje zaten var.' : 'A project with this name already exists.'}</div>}
            {!duplicate && trimmed.length > 0 && trimmed.length < 3 && <div className="hp-hint">{tr ? 'En az 3 karakter.' : 'At least 3 characters.'}</div>}
          </div>
          <div className="hp-grid-2">
            <div className="hp-field">
              <label className="hp-label" htmlFor="np-researcher">{tr ? 'Araştırmacı' : 'Researcher'}</label>
              <input id="np-researcher" className="hp-input" value={researcher} maxLength={120} onChange={(e) => setResearcher(e.target.value)} />
            </div>
            <div className="hp-field">
              <label className="hp-label" htmlFor="np-design">{tr ? 'Desen' : 'Design'}</label>
              <select id="np-design" className="hp-select" value={design} onChange={(e) => setDesign(e.target.value as StudyDesign)}>
                {(Object.keys(DESIGN_LABELS) as StudyDesign[]).map((d) => (
                  <option key={d} value={d}>{DESIGN_LABELS[d][lang]}</option>
                ))}
              </select>
            </div>
          </div>
          <div style={{ display: 'flex', gap: 'var(--space-xs)', justifyContent: 'space-between', flexWrap: 'wrap', alignItems: 'center' }}>
            <div>
              {onCreateSample && (
                <button type="button" className="hp-btn" onClick={onCreateSample}>
                  {tr ? 'Örnek çalışmayla dene' : 'Try sample study'}
                </button>
              )}
            </div>
            <div style={{ display: 'flex', gap: 'var(--space-xs)' }}>
              {projects.length > 0 && (
                <button type="button" className="hp-btn hp-btn-ghost" onClick={() => setShowForm(false)}>{tr ? 'Vazgeç' : 'Cancel'}</button>
              )}
              <button type="submit" className="hp-btn hp-btn-primary" disabled={!canCreate}>{tr ? 'Projeyi başlat' : 'Start project'}</button>
            </div>
          </div>
        </form>
      )}

      {sorted.length > 0 && (
        <div className="hp-project-list">
          {sorted.map((p) => {
            const st = stepStatus(p);
            const doneCount = STEPS.filter((s) => st[s.id]).length;
            const pct = Math.round(progressRatio(p) * 100);
            return (
              <div key={p.id} className="hp-project-card" role="button" tabIndex={0} onClick={() => onOpen(p.id)} onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onOpen(p.id); } }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', gap: 'var(--space-xs)', alignItems: 'flex-start' }}>
                  <h3 style={{ overflowWrap: 'anywhere' }}>{p.title}</h3>
                  {confirmId === p.id ? (
                    <span style={{ display: 'flex', gap: 'var(--space-2xs)' }} onClick={(e) => e.stopPropagation()}>
                      <button type="button" className="hp-btn hp-btn-sm" onClick={() => setConfirmId(null)}>{tr ? 'İptal' : 'Cancel'}</button>
                      <button type="button" className="hp-btn hp-btn-sm" style={{ color: 'var(--color-error)' }} onClick={() => { onDelete(p.id); setConfirmId(null); }}>{tr ? 'Sil' : 'Delete'}</button>
                    </span>
                  ) : (
                    <button type="button" className="hp-btn hp-btn-sm hp-btn-ghost" aria-label={tr ? 'Projeyi sil' : 'Delete project'} onClick={(e) => { e.stopPropagation(); setConfirmId(p.id); }}>
                      <Trash2 size={14} />
                    </button>
                  )}
                </div>
                <div className="hp-project-meta">
                  {DESIGN_LABELS[p.design][lang]}
                  {p.researcher ? ` · ${p.researcher}` : ''}
                </div>
                <div className="hp-progress" aria-label={`${pct}%`}><span style={{ width: `${pct}%` }} /></div>
                <div className="hp-project-meta" style={{ display: 'flex', justifyContent: 'space-between' }}>
                  <span>{tr ? `${doneCount}/${STEPS.length} adım` : `${doneCount}/${STEPS.length} steps`}</span>
                  <span style={{ display: 'inline-flex', alignItems: 'center', gap: 'var(--space-2xs)' }}>
                    <FolderOpen size={12} />
                    {new Date(p.updatedAt).toLocaleDateString(tr ? 'tr-TR' : 'en-GB')}
                  </span>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
};

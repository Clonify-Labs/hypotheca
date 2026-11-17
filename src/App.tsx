import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { ArrowLeft, ArrowRight, Check, FlaskConical, LucideIcon, Moon, Network, ShieldCheck, Sun } from 'lucide-react';
import { buildSeedDatasets } from './data/seedDatasets';
import { AnalysisOutput, Dataset, Lang } from './types/interfaces';
import { DataBenchPage } from './components/DataBenchPage';
import { ClassicalLabPage } from './components/ClassicalLabPage';
import { SemCanvasPage } from './components/SemCanvasPage';
import { AutopilotPanel } from './modules/autopilot/AutopilotPanel';
import { AdvancedStatsPage } from './modules/advanced-stats/AdvancedStatsPage';
import { SurveyAndCollabPage } from './modules/survey-collab/SurveyAndCollabPage';
import { PublicationStudioPage } from './modules/publication/PublicationStudioPage';
import { ReproducibilityView } from './modules/reproducibility/ReproducibilityView';
import { PrivacyAuditPage } from './modules/privacy-runtime/PrivacyAuditPage';
import {
  DESIGN_LABELS,
  Project,
  STEPS,
  StepId,
  loadProjects,
  loadUserDatasets,
  newProject,
  nextOpenStep,
  saveProjects,
  saveUserDatasets,
  stepStatus,
} from './project/projectStore';
import { ProjectsHome } from './project/ProjectsHome';
import { ProjectSetupPage } from './project/ProjectSetupPage';
import { McpDashboardPage } from './modules/mcp-dashboard/McpDashboardPage';

type ToolId = 'sem' | 'advanced' | 'privacy';
type ViewId = StepId | ToolId;

const TOOLS: { id: ToolId; tr: string; en: string; icon: LucideIcon }[] = [
  { id: 'sem', tr: 'SEM / yol analizi', en: 'SEM / path analysis', icon: Network },
  { id: 'advanced', tr: 'İleri analizler', en: 'Advanced analyses', icon: FlaskConical },
  { id: 'privacy', tr: 'Veri gizliliği', en: 'Data privacy', icon: ShieldCheck },
];

const MAX_STORED_ANALYSES = 200;
const NEEDS_DATA: ViewId[] = ['survey', 'autopilot', 'classical', 'publication', 'repro', 'sem', 'advanced', 'privacy'];

function readPref<T extends string>(key: string, allowed: readonly T[], fallback: T): T {
  try {
    const v = window.localStorage.getItem(key) as T | null;
    return v && allowed.includes(v) ? v : fallback;
  } catch {
    return fallback;
  }
}

function writePref(key: string, value: string) {
  try {
    window.localStorage.setItem(key, value);
  } catch {
    /* storage unavailable: preference is kept for this session only */
  }
}

export default function App(): JSX.Element {
  const seeds = useMemo(() => buildSeedDatasets(), []);
  const [userDatasets, setUserDatasets] = useState<Dataset[]>(() => loadUserDatasets());
  const [projects, setProjects] = useState<Project[]>(() => loadProjects());
  const [activeProjectId, setActiveProjectId] = useState<string | null>(null);
  const [showMcpDashboard, setShowMcpDashboard] = useState<boolean>(
    () => typeof window !== 'undefined' && window.location.pathname.startsWith('/dashboard'),
  );
  const [view, setView] = useState<ViewId>('project');
  const [storageOk, setStorageOk] = useState(true);
  const [lang, setLang] = useState<Lang>(() => readPref<Lang>('hypotheca.lang', ['tr', 'en'], 'tr'));
  const [theme, setTheme] = useState<'day' | 'night'>(() =>
    readPref<'day' | 'night'>(
      'hypotheca.theme',
      ['day', 'night'],
      typeof window !== 'undefined' && window.matchMedia?.('(prefers-color-scheme: dark)').matches ? 'night' : 'day',
    ),
  );
  const tr = lang === 'tr';

  useEffect(() => {
    if (theme === 'night') document.documentElement.dataset.theme = 'night';
    else delete document.documentElement.dataset.theme;
    writePref('hypotheca.theme', theme);
  }, [theme]);

  useEffect(() => {
    document.documentElement.lang = lang;
    writePref('hypotheca.lang', lang);
  }, [lang]);

  useEffect(() => {
    setStorageOk(saveProjects(projects));
  }, [projects]);

  useEffect(() => {
    if (!saveUserDatasets(userDatasets)) setStorageOk(false);
  }, [userDatasets]);

  const visibleSeeds = useMemo(() => seeds.filter((s) => !userDatasets.some((u) => u.id === s.id)), [seeds, userDatasets]);
  const datasets = useMemo(() => [...visibleSeeds, ...userDatasets], [visibleSeeds, userDatasets]);
  const project = projects.find((p) => p.id === activeProjectId) ?? null;
  const dataset = useMemo(
    () => (project?.datasetId ? datasets.find((d) => d.id === project.datasetId) ?? null : null),
    [datasets, project?.datasetId],
  );
  const history = project?.analyses ?? [];

  const patchProject = useCallback(
    (patch: Partial<Project>) => {
      if (!activeProjectId) return;
      setProjects((prev) =>
        prev.map((p) => (p.id === activeProjectId ? { ...p, ...patch, updatedAt: new Date().toISOString() } : p)),
      );
    },
    [activeProjectId],
  );

  const pushHistory = useCallback(
    (out: AnalysisOutput, markStep?: StepId) => {
      if (!activeProjectId) return;
      setProjects((prev) =>
        prev.map((p) => {
          if (p.id !== activeProjectId) return p;
          const completed = markStep && !p.completed.includes(markStep) ? [...p.completed, markStep] : p.completed;
          if (p.analyses.some((h) => h.id === out.id)) {
            return completed === p.completed ? p : { ...p, completed, updatedAt: new Date().toISOString() };
          }
          let safe: AnalysisOutput;
          try {
            safe = JSON.parse(JSON.stringify(out));
          } catch {
            return p;
          }
          return {
            ...p,
            analyses: [...p.analyses, safe].slice(-MAX_STORED_ANALYSES),
            completed,
            updatedAt: new Date().toISOString(),
          };
        }),
      );
    },
    [activeProjectId],
  );

  const removeAnalysis = useCallback(
    (id: string) => {
      if (!activeProjectId) return;
      setProjects((prev) =>
        prev.map((p) =>
          p.id === activeProjectId
            ? { ...p, analyses: p.analyses.filter((h) => h.id !== id), updatedAt: new Date().toISOString() }
            : p,
        ),
      );
    },
    [activeProjectId],
  );

  const selectDataset = useCallback(
    (ds: Dataset) => {
      if (project?.datasetId === ds.id) return;
      patchProject({ datasetId: ds.id });
    },
    [patchProject, project?.datasetId],
  );

  const addDataset = useCallback(
    (ds: Dataset, markStep?: StepId) => {
      setUserDatasets((prev) => [...prev.filter((d) => d.id !== ds.id), ds]);
      if (!activeProjectId) return;
      setProjects((prev) =>
        prev.map((p) => {
          if (p.id !== activeProjectId) return p;
          const completed = markStep && !p.completed.includes(markStep) ? [...p.completed, markStep] : p.completed;
          return { ...p, datasetId: ds.id, completed, updatedAt: new Date().toISOString() };
        }),
      );
    },
    [activeProjectId],
  );

  const deleteDataset = useCallback(
    (id: string) => {
      setUserDatasets((prev) => prev.filter((d) => d.id !== id));
      setProjects((prev) => prev.map((p) => (p.datasetId === id ? { ...p, datasetId: null } : p)));
    },
    [],
  );

  const createProject = (input: { title: string; researcher: string; design: Project['design'] }) => {
    const p = newProject(input);
    setProjects((prev) => [...prev, p]);
    setActiveProjectId(p.id);
    setView('project');
  };

  const createSampleProject = () => {
    const p = newProject({
      title: tr
        ? 'Üniversite Öğrencilerinde Akademik Öz-Yeterlik ve Tükenmişlik'
        : 'Academic Self-Efficacy and Burnout in University Students',
      question: tr
        ? 'Akademik öz-yeterlik ve tutum puanları dönem sonu başarısını yordamakta mıdır?'
        : 'Do academic self-efficacy and attitude scores predict final achievement?',
      hypotheses: tr
        ? [
            'H1: Öz-yeterlik puanı cinsiyete göre farklılaşmaktadır.',
            'H2: Öz-yeterlik ve tutum puanları dönem sonu başarısını pozitif yönde yordamaktadır.',
          ]
        : [
            'H1: Self-efficacy differs across gender.',
            'H2: Self-efficacy and attitude positively predict final achievement.',
          ],
      design: 'cross_sectional',
      datasetId: 'ds-ogrenci-180',
    });
    setProjects((prev) => [...prev, p]);
    setActiveProjectId(p.id);
    setView(nextOpenStep(p));
  };

  const openProject = (id: string) => {
    const p = projects.find((x) => x.id === id);
    if (!p) return;
    setActiveProjectId(id);
    setView(nextOpenStep(p));
  };

  const deleteProject = (id: string) => {
    setProjects((prev) => prev.filter((p) => p.id !== id));
    if (activeProjectId === id) setActiveProjectId(null);
  };

  const navigateDashboard = useCallback((open: boolean) => {
    setShowMcpDashboard(open);
    if (typeof window !== 'undefined' && window.history?.pushState) {
      const targetPath = open ? '/dashboard' : '/';
      if (window.location.pathname !== targetPath) {
        window.history.pushState(null, '', targetPath);
      }
    }
  }, []);

  const header = (title: React.ReactNode) => (
    <header className="hp-header">
      <div className="hp-header-group">{title}</div>
      <div className="hp-header-group">
        <button
          type="button"
          className="hp-btn hp-btn-sm hp-btn-ghost"
          onClick={() => navigateDashboard(!showMcpDashboard)}
        >
          {showMcpDashboard ? (tr ? 'Çalışma Alanı' : 'Workbench') : tr ? 'MCP Paneli' : 'MCP Dashboard'}
        </button>
        <button type="button" className="hp-btn hp-btn-sm hp-btn-ghost" onClick={() => setLang((l) => (l === 'tr' ? 'en' : 'tr'))} aria-label="Language">
          {tr ? 'EN' : 'TR'}
        </button>
        <button
          type="button"
          className="hp-btn hp-btn-sm hp-btn-ghost"
          onClick={() => setTheme((t) => (t === 'day' ? 'night' : 'day'))}
          aria-label={theme === 'day' ? 'Night theme' : 'Day theme'}
        >
          {theme === 'day' ? <Moon size={14} /> : <Sun size={14} />}
        </button>
      </div>
    </header>
  );

  if (showMcpDashboard) {
    return (
      <div className="hp-shell is-home">
        {header(
          <span className="hp-brand-btn">
            <img src="/brand-mark.svg" alt="" width={26} height={26} />
            <span className="hp-brand-name">Hypotheca</span>
          </span>,
        )}
        <main className="hp-main">
          <McpDashboardPage
            dataset={dataset ?? datasets[0] ?? null}
            datasets={datasets}
            lang={lang}
            onEnterWorkbench={() => navigateDashboard(false)}
          />
        </main>
      </div>
    );
  }

  if (!project) {
    return (
      <div className="hp-shell is-home">
        {header(
          <span className="hp-brand-btn">
            <img src="/brand-mark.svg" alt="" width={26} height={26} />
            <span className="hp-brand-name">Hypotheca</span>
          </span>,
        )}
        <main className="hp-main">
          <ProjectsHome projects={projects} lang={lang} onCreate={createProject} onCreateSample={createSampleProject} onOpen={openProject} onDelete={deleteProject} storageOk={storageOk} />
        </main>
      </div>
    );
  }

  const status = stepStatus(project);
  const stepIdx = STEPS.findIndex((s) => s.id === view);
  const step = stepIdx >= 0 ? STEPS[stepIdx] : null;
  const tool = TOOLS.find((t) => t.id === view) ?? null;
  const manualStep = step && ['survey', 'autopilot', 'publication', 'repro'].includes(step.id);

  let page: React.ReactNode;
  if (NEEDS_DATA.includes(view) && !dataset) {
    page = (
      <div className="hp-plate" style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-sm)', alignItems: 'flex-start' }}>
        <p>{tr ? 'Bu adım için önce bir veri seti seçin.' : 'Choose a dataset first for this step.'}</p>
        <button type="button" className="hp-btn hp-btn-primary" onClick={() => setView('data')}>
          {tr ? 'Veri adımına git' : 'Go to data step'}
        </button>
      </div>
    );
  } else {
    switch (view) {
      case 'project':
        page = <ProjectSetupPage project={project} lang={lang} onChange={patchProject} />;
        break;
      case 'data':
        page = (
          <DataBenchPage
            dataset={dataset}
            seedDatasets={visibleSeeds}
            userDatasets={userDatasets}
            onSelectDataset={selectDataset}
            onAddDataset={addDataset}
            onDeleteDataset={deleteDataset}
            lang={lang}
          />
        );
        break;
      case 'autopilot':
        page = <AutopilotPanel key={dataset!.id} dataset={dataset!} lang={lang} onApplyAnalysis={(out) => pushHistory(out, 'autopilot')} />;
        break;
      case 'classical':
        page = <ClassicalLabPage key={dataset!.id} dataset={dataset!} lang={lang} onAnalysisDone={pushHistory} />;
        break;
      case 'sem':
        page = <SemCanvasPage key={dataset!.id} dataset={dataset!} lang={lang} onAnalysisDone={pushHistory} />;
        break;
      case 'advanced':
        page = <AdvancedStatsPage dataset={dataset!} datasets={datasets} lang={lang} onAnalysisDone={pushHistory} />;
        break;
      case 'survey':
        page = <SurveyAndCollabPage dataset={dataset!} datasets={datasets} history={history} onUpdateDataset={(ds) => addDataset(ds, 'survey')} lang={lang} />;
        break;
      case 'publication':
        page = (
          <PublicationStudioPage
            key={project.id}
            dataset={dataset!}
            history={history}
            lang={lang}
            projectMeta={{
              title: project.title,
              researcher: project.researcher,
              question: project.question,
              hypotheses: project.hypotheses,
              designLabel: DESIGN_LABELS[project.design][lang],
            }}
            onRemoveAnalysis={removeAnalysis}
          />
        );
        break;
      case 'repro': {
        const noteLines = [
          project.title,
          project.question ? `${tr ? 'Araştırma sorusu' : 'Research question'}: ${project.question}` : '',
          ...project.hypotheses,
        ].filter(Boolean);
        page = <ReproducibilityView key={project.id} dataset={dataset!} history={history} lang={lang} defaultNotes={noteLines.join('\n')} />;
        break;
      }
      case 'privacy':
        page = <PrivacyAuditPage dataset={dataset!} datasets={datasets} onSelectDataset={selectDataset} onImportDataset={addDataset} lang={lang} />;
        break;
    }
  }

  const prev = stepIdx > 0 ? STEPS[stepIdx - 1] : null;
  const next = stepIdx >= 0 && stepIdx < STEPS.length - 1 ? STEPS[stepIdx + 1] : null;

  return (
    <div className="hp-shell">
      <aside className="hp-sidebar">
        <div className="hp-sidebar-brand">
          <button type="button" className="hp-brand-btn" onClick={() => setActiveProjectId(null)} title={tr ? 'Projelere dön' : 'Back to projects'}>
            <img src="/brand-mark.svg" alt="" width={26} height={26} />
            <span className="hp-brand-name">Hypotheca</span>
          </button>
        </div>
        <nav className="hp-nav" aria-label={tr ? 'Proje adımları' : 'Project steps'}>
          <div className="hp-nav-section">
            <div className="hp-nav-group-title">{tr ? 'Adımlar' : 'Steps'}</div>
            {STEPS.map((s, i) => {
              const cls = ['hp-nav-btn', view === s.id ? 'is-active' : '', status[s.id] ? 'is-done' : ''].filter(Boolean).join(' ');
              return (
                <button key={s.id} type="button" className={cls} aria-current={view === s.id ? 'page' : undefined} onClick={() => setView(s.id)}>
                  <span className="hp-step-num">{status[s.id] ? <Check size={12} /> : i + 1}</span>
                  <span>{tr ? s.tr : s.en}</span>
                  {s.optional && <span className="hp-step-optional">{tr ? 'isteğe bağlı' : 'optional'}</span>}
                </button>
              );
            })}
          </div>
          <div className="hp-nav-section">
            <div className="hp-nav-group-title">{tr ? 'Ek araçlar' : 'More tools'}</div>
            {TOOLS.map((t) => {
              const Icon = t.icon;
              return (
                <button
                  key={t.id}
                  type="button"
                  className={view === t.id ? 'hp-nav-btn is-active' : 'hp-nav-btn'}
                  aria-current={view === t.id ? 'page' : undefined}
                  onClick={() => setView(t.id)}
                >
                  <Icon size={16} />
                  <span>{tr ? t.tr : t.en}</span>
                </button>
              );
            })}
          </div>
        </nav>
        <div className="hp-sidebar-foot">{tr ? 'Veriler yalnızca bu tarayıcıda tutulur.' : 'Data stays in this browser.'}</div>
      </aside>

      {header(
        <>
          <button type="button" className="hp-btn hp-btn-sm hp-btn-ghost" onClick={() => setActiveProjectId(null)}>
            <ArrowLeft size={14} />
            {tr ? 'Projeler' : 'Projects'}
          </button>
          <span className="hp-crumb" title={project.title}>{project.title || (tr ? 'Adsız proje' : 'Untitled project')}</span>
          {dataset && <span className="hp-badge">{dataset.name} · N={dataset.rows.length}</span>}
          {history.length > 0 && (
            <span className="hp-badge hp-badge-info">
              {history.length} {tr ? 'analiz' : 'analyses'}
            </span>
          )}
        </>,
      )}

      <main className="hp-main">
        <div className="hp-main-inner">
          {!storageOk && (
            <div className="hp-alert hp-alert-warn" role="status">
              {tr ? 'Son değişiklikler kaydedilemedi: tarayıcı depolaması dolu veya kapalı.' : 'Recent changes could not be saved: browser storage is full or disabled.'}
            </div>
          )}
          <div className="hp-step-head">
            {step && <span className="hp-step-kicker">{tr ? `Adım ${stepIdx + 1} / ${STEPS.length}` : `Step ${stepIdx + 1} of ${STEPS.length}`}</span>}
            <h2 className="hp-header-title" style={{ fontSize: 'var(--text-2xl)' }}>{step ? (tr ? step.tr : step.en) : tool ? (tr ? tool.tr : tool.en) : ''}</h2>
            {step && <p>{tr ? step.descTr : step.descEn}</p>}
          </div>

          {page}

          {step && (
            <div className="hp-step-foot">
              <div>
                {prev && (
                  <button type="button" className="hp-btn" onClick={() => setView(prev.id)}>
                    <ArrowLeft size={14} />
                    {tr ? prev.tr : prev.en}
                  </button>
                )}
              </div>
              <div style={{ display: 'flex', gap: 'var(--space-xs)', flexWrap: 'wrap' }}>
                {manualStep && (
                  <button
                    type="button"
                    className="hp-btn"
                    disabled={NEEDS_DATA.includes(view) && !dataset}
                    onClick={() =>
                      patchProject({
                        completed: status[step.id] ? project.completed.filter((c) => c !== step.id) : [...project.completed, step.id],
                      })
                    }
                  >
                    {status[step.id] ? (tr ? 'Tamamlandı işaretini kaldır' : 'Mark as not done') : tr ? 'Bu adımı tamamladım' : 'Mark step as done'}
                  </button>
                )}
                {next && (
                  <button type="button" className="hp-btn hp-btn-primary" onClick={() => setView(next.id)}>
                    {tr ? `Sonraki: ${next.tr}` : `Next: ${next.en}`}
                    <ArrowRight size={14} />
                  </button>
                )}
              </div>
            </div>
          )}
        </div>
      </main>
    </div>
  );
}

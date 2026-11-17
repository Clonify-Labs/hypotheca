import { AnalysisOutput, Dataset } from '../types/interfaces';

export type StepId = 'project' | 'data' | 'survey' | 'autopilot' | 'classical' | 'publication' | 'repro';

export type StudyDesign = 'cross_sectional' | 'experimental' | 'quasi' | 'longitudinal' | 'scale_dev' | 'meta' | 'other';

export interface Project {
  id: string;
  title: string;
  researcher: string;
  question: string;
  hypotheses: string[];
  design: StudyDesign;
  datasetId: string | null;
  completed: StepId[];
  analyses: AnalysisOutput[];
  createdAt: string;
  updatedAt: string;
}

export interface StepDef {
  id: StepId;
  tr: string;
  en: string;
  descTr: string;
  descEn: string;
  optional?: boolean;
}

export const STEPS: StepDef[] = [
  { id: 'project', tr: 'Çalışma bilgileri', en: 'Study details', descTr: 'Başlığı, araştırma sorusunu ve hipotezleri yazın.', descEn: 'Write the title, research question and hypotheses.' },
  { id: 'data', tr: 'Veri', en: 'Data', descTr: 'Veri setini yükleyin veya seçin, değişkenleri kontrol edin.', descEn: 'Upload or choose a dataset and check the variables.' },
  { id: 'survey', tr: 'Veri temizleme', en: 'Data cleaning', descTr: 'Sözel Likert yanıtlarını kodlayın, ters maddeleri ve dikkatsiz yanıtları ele alın.', descEn: 'Code verbal Likert answers, handle reversed items and careless responses.', optional: true },
  { id: 'autopilot', tr: 'Analiz planı', en: 'Analysis plan', descTr: 'Varsayımları tarayın ve uygun testi belirleyin.', descEn: 'Scan assumptions and pick the right test.' },
  { id: 'classical', tr: 'Analiz', en: 'Analysis', descTr: 'Analizleri çalıştırın. Sonuçlar projeye kaydedilir.', descEn: 'Run the analyses. Results are saved to the project.' },
  { id: 'publication', tr: 'Raporlama', en: 'Reporting', descTr: 'APA 7 bulgular metnini ve tabloları oluşturun.', descEn: 'Build the APA 7 results text and tables.' },
  { id: 'repro', tr: 'Paylaşım', en: 'Sharing', descTr: 'Analizleri yeniden üretmek için R/Python betiklerini ve OSF paketini indirin.', descEn: 'Download R/Python scripts and the OSF bundle to reproduce the analyses.', optional: true },
];

export const DESIGN_LABELS: Record<StudyDesign, { tr: string; en: string }> = {
  cross_sectional: { tr: 'Kesitsel / ilişkisel', en: 'Cross-sectional / correlational' },
  experimental: { tr: 'Deneysel', en: 'Experimental' },
  quasi: { tr: 'Yarı deneysel', en: 'Quasi-experimental' },
  longitudinal: { tr: 'Boylamsal / tekrarlı ölçüm', en: 'Longitudinal / repeated measures' },
  scale_dev: { tr: 'Ölçek geliştirme / uyarlama', en: 'Scale development / adaptation' },
  meta: { tr: 'Meta-analiz', en: 'Meta-analysis' },
  other: { tr: 'Diğer', en: 'Other' },
};

const PROJECTS_KEY = 'hypotheca.projects.v1';
const DATASETS_KEY = 'hypotheca.datasets.v1';

function storage(): Storage | null {
  try {
    return typeof window !== 'undefined' && window.localStorage ? window.localStorage : null;
  } catch {
    return null;
  }
}

function isProject(x: unknown): x is Project {
  const p = x as Project;
  return !!p && typeof p.id === 'string' && typeof p.title === 'string' && Array.isArray(p.completed) && Array.isArray(p.analyses);
}

export function loadProjects(): Project[] {
  const s = storage();
  if (!s) return [];
  try {
    const raw = JSON.parse(s.getItem(PROJECTS_KEY) || '[]');
    if (!Array.isArray(raw)) return [];
    return raw.filter(isProject).map((p) => ({
      ...p,
      hypotheses: Array.isArray(p.hypotheses) ? p.hypotheses.filter((h) => typeof h === 'string') : [],
      researcher: p.researcher ?? '',
      question: p.question ?? '',
      design: p.design && p.design in DESIGN_LABELS ? p.design : 'other',
      datasetId: p.datasetId ?? null,
    }));
  } catch {
    return [];
  }
}

/** Returns false when the browser refused to store (quota or private mode). */
export function saveProjects(projects: Project[]): boolean {
  const s = storage();
  if (!s) return false;
  try {
    s.setItem(PROJECTS_KEY, JSON.stringify(projects));
    return true;
  } catch {
    return false;
  }
}

export function loadUserDatasets(): Dataset[] {
  const s = storage();
  if (!s) return [];
  try {
    const raw = JSON.parse(s.getItem(DATASETS_KEY) || '[]');
    return Array.isArray(raw)
      ? raw.filter((d) => d && typeof d.id === 'string' && Array.isArray(d.rows) && Array.isArray(d.columns))
      : [];
  } catch {
    return [];
  }
}

export function saveUserDatasets(datasets: Dataset[]): boolean {
  const s = storage();
  if (!s) return false;
  try {
    s.setItem(DATASETS_KEY, JSON.stringify(datasets));
    return true;
  } catch {
    return false;
  }
}

export function newProject(partial: Partial<Project> & { title: string }): Project {
  const now = new Date().toISOString();
  const rand = Math.random().toString(36).slice(2, 8);
  return {
    id: `prj-${Date.now().toString(36)}-${rand}`,
    researcher: '',
    question: '',
    hypotheses: [],
    design: 'cross_sectional',
    datasetId: null,
    completed: [],
    analyses: [],
    createdAt: now,
    updatedAt: now,
    ...partial,
    title: partial.title.trim(),
  };
}

/** Steps that are satisfied by project state, plus any the user marked as done. */
export function stepStatus(p: Project): Record<StepId, boolean> {
  const done = new Set(p.completed);
  return {
    project: p.title.trim().length > 0 && p.question.trim().length > 0,
    data: !!p.datasetId,
    survey: done.has('survey'),
    autopilot: done.has('autopilot'),
    classical: p.analyses.length > 0,
    publication: done.has('publication'),
    repro: done.has('repro'),
  };
}

export function progressRatio(p: Project): number {
  const st = stepStatus(p);
  const required = STEPS.filter((s) => !s.optional);
  return required.filter((s) => st[s.id]).length / required.length;
}

export function nextOpenStep(p: Project): StepId {
  const st = stepStatus(p);
  return (STEPS.find((s) => !s.optional && !st[s.id]) ?? STEPS[STEPS.length - 1]).id;
}

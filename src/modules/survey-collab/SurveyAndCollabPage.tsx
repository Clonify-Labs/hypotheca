import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  AlertTriangle,
  ArrowLeftRight,
  Check,
  CheckCircle2,
  Copy,
  Download,
  FileCheck2,
  Layers,
  MessageSquare,
  Plus,
  RefreshCw,
  ShieldCheck,
  Trash2,
  Upload,
  XCircle,
} from 'lucide-react';
import { AnalysisOutput, Dataset, Lang } from '../../types/interfaces';
import {
  autoDetectLikertColumns,
  cleanSurveyDataset,
  CompositeSpec,
  SurveyCleanReport,
} from './surveyCleaner';
import { errorMessage } from '../../components/errorMessage';
import {
  createAnnotation,
  exportProjectSnapshot,
  HypothecaProjectSnapshot,
  parseAndValidateSnapshot,
  ReviewAnnotation,
} from './advisorCollab';

export interface SurveyAndCollabPageProps {
  dataset: Dataset;
  datasets: Dataset[];
  history: AnalysisOutput[];
  onUpdateDataset?: (ds: Dataset) => void;
  lang: Lang;
}

interface EditableComposite {
  id: string;
  name: string;
  items: string[];
}

const LABELS = {
  tr: {
    pageTitle: 'Anket temizleme ve danışman paylaşımı',
    tabCleaner: 'Anket temizleme',
    tabCollab: 'Danışman paylaşımı',
    sourceDataset: 'Veri seti',
    quickLoadRaw: 'Örnek ham anketi aç',
    scaleRange: 'Likert aralığı',
    minLabel: 'En küçük',
    maxLabel: 'En büyük',
    verbalColsTitle: 'Sayıya çevrilecek sözel sütunlar',
    reverseColsTitle: 'Ters kodlanacak maddeler',
    autoDetectedBadge: 'Algılandı',
    suspectReverseBadge: 'Ters olabilir',
    compositesTitle: 'Ölçek ortalamaları',
    addComposite: 'Ekle',
    compositeNamePlaceholder: 'Ör. OzYeterlik_Ort',
    qualityFiltersTitle: 'Veri kalitesi',
    dropStraightLiners: 'Hep aynı yanıtı verenleri çıkar',
    dropDuplicates: 'Tekrarlanan satırları çıkar',
    applyWorkspace: 'Temiz veriyi uygula',
    appliedMsg: 'Veri seti güncellendi.',
    kpiConverted: 'Çevrilen hücre',
    kpiReversed: 'Ters kodlanan',
    kpiStraight: 'Hep aynı yanıt',
    kpiDuplicates: 'Tekrar',
    flaggedIdsLabel: 'İşaretlenen satırlar',
    previewTitle: 'Önizleme',
    statusCol: 'Durum',
    statusOk: 'Temiz',
    statusStraight: 'Hep aynı',
    statusDuplicate: 'Tekrar',
    noData: 'Veri yok.',
    projectMetaTitle: 'Proje',
    projectName: 'Proje adı',
    ownerName: 'Araştırmacı',
    addAnnotationTitle: 'Not ekle',
    targetAnalysis: 'Analiz',
    generalStudyTarget: 'Genel',
    authorName: 'Ad',
    authorRole: 'Rol',
    roleAdvisor: 'Danışman',
    roleCoAuthor: 'Eş yazar',
    roleReviewer: 'Hakem',
    statusLabel: 'Durum',
    statusApproved: 'Onaylandı',
    statusRevision: 'Düzeltme gerekli',
    statusComment: 'Yorum',
    commentPlaceholder: 'Notunuzu yazın',
    addAnnotationBtn: 'Notu ekle',
    annotationsTitle: 'Notlar',
    noAnnotations: 'Henüz not yok.',
    exportTitle: 'Paketi dışa aktar',
    exportBtn: 'İndir',
    refreshBtn: 'Güncelle',
    copyJsonBtn: 'Kopyala',
    copiedBtn: 'Kopyalandı',
    checksumLabel: 'Doğrulama kodu',
    importTitle: 'Paketi içe aktar',
    uploadFileLabel: 'Dosya seç',
    pasteJsonLabel: 'veya içeriği yapıştırın',
    validateImportBtn: 'Doğrula',
    verifiedBadge: 'Doğrulandı',
    tamperErrorTitle: 'Paket doğrulanamadı',
    importedMetaTitle: 'Paket özeti',
    loadImportedDataset: 'Veriyi aç',
    mergeAnnotations: 'Notları ekle',
    rowsWord: 'satır',
    analysesWord: 'analiz',
    notesWord: 'not',
  },
  en: {
    pageTitle: 'Survey cleaning and advisor sharing',
    tabCleaner: 'Survey cleaning',
    tabCollab: 'Advisor sharing',
    sourceDataset: 'Dataset',
    quickLoadRaw: 'Open sample raw survey',
    scaleRange: 'Likert range',
    minLabel: 'Minimum',
    maxLabel: 'Maximum',
    verbalColsTitle: 'Text columns to convert',
    reverseColsTitle: 'Reverse-coded items',
    autoDetectedBadge: 'Detected',
    suspectReverseBadge: 'Possibly reversed',
    compositesTitle: 'Scale means',
    addComposite: 'Add',
    compositeNamePlaceholder: 'e.g. SelfEfficacy_Mean',
    qualityFiltersTitle: 'Data quality',
    dropStraightLiners: 'Drop straight-liners',
    dropDuplicates: 'Drop duplicate rows',
    applyWorkspace: 'Apply cleaned data',
    appliedMsg: 'Dataset updated.',
    kpiConverted: 'Converted cells',
    kpiReversed: 'Reversed',
    kpiStraight: 'Straight-liners',
    kpiDuplicates: 'Duplicates',
    flaggedIdsLabel: 'Flagged rows',
    previewTitle: 'Preview',
    statusCol: 'Status',
    statusOk: 'Clean',
    statusStraight: 'Straight-liner',
    statusDuplicate: 'Duplicate',
    noData: 'No data.',
    projectMetaTitle: 'Project',
    projectName: 'Project name',
    ownerName: 'Researcher',
    addAnnotationTitle: 'Add note',
    targetAnalysis: 'Analysis',
    generalStudyTarget: 'General',
    authorName: 'Name',
    authorRole: 'Role',
    roleAdvisor: 'Advisor',
    roleCoAuthor: 'Co-author',
    roleReviewer: 'Reviewer',
    statusLabel: 'Status',
    statusApproved: 'Approved',
    statusRevision: 'Revision needed',
    statusComment: 'Comment',
    commentPlaceholder: 'Write your note',
    addAnnotationBtn: 'Add note',
    annotationsTitle: 'Notes',
    noAnnotations: 'No notes yet.',
    exportTitle: 'Export package',
    exportBtn: 'Download',
    refreshBtn: 'Refresh',
    copyJsonBtn: 'Copy',
    copiedBtn: 'Copied',
    checksumLabel: 'Checksum',
    importTitle: 'Import package',
    uploadFileLabel: 'Choose file',
    pasteJsonLabel: 'or paste its contents',
    validateImportBtn: 'Verify',
    verifiedBadge: 'Verified',
    tamperErrorTitle: 'Package could not be verified',
    importedMetaTitle: 'Package summary',
    loadImportedDataset: 'Open data',
    mergeAnnotations: 'Add notes',
    rowsWord: 'rows',
    analysesWord: 'analyses',
    notesWord: 'notes',
  },
} as const;

function pickInitialDatasetId(activeDataset: Dataset, allDatasets: Dataset[]): string {
  if (autoDetectLikertColumns(activeDataset).verbalColumns.length > 0) {
    return activeDataset.id;
  }
  const rawLikert = allDatasets.find((d) => d.id === 'ds-raw-likert');
  return rawLikert ? rawLikert.id : activeDataset.id;
}

function initCleanerConfig(ds: Dataset, lang: Lang): {
  verbalCols: string[];
  reverseCols: string[];
  composites: EditableComposite[];
} {
  const detected = autoDetectLikertColumns(ds);
  const candidateItems =
    detected.verbalColumns.length > 0
      ? detected.verbalColumns
      : ds.columns.filter((c) => c.valueType === 'numeric').map((c) => c.name);

  const composites: EditableComposite[] =
    candidateItems.length >= 2
      ? [
          {
            id: 'comp-1',
            name: lang === 'tr' ? 'Olcek_Ort' : 'Scale_Mean',
            items: [...candidateItems],
          },
        ]
      : [];

  return {
    verbalCols: detected.verbalColumns,
    reverseCols: detected.suspectReverseColumns,
    composites,
  };
}

export const SurveyAndCollabPage: React.FC<SurveyAndCollabPageProps> = ({
  dataset,
  datasets,
  history,
  onUpdateDataset,
  lang,
}) => {
  const t = LABELS[lang];
  const [activeTab, setActiveTab] = useState<'cleaner' | 'collab'>('cleaner');

  // --- Dataset pool including active dataset ---
  const availableDatasets = useMemo(() => {
    const map = new Map<string, Dataset>();
    map.set(dataset.id, dataset);
    for (const d of datasets) {
      if (!map.has(d.id)) map.set(d.id, d);
    }
    return Array.from(map.values());
  }, [dataset, datasets]);

  const rawLikertDataset = useMemo(
    () => availableDatasets.find((d) => d.id === 'ds-raw-likert'),
    [availableDatasets],
  );

  const [selectedDatasetId, setSelectedDatasetId] = useState<string>(() =>
    pickInitialDatasetId(dataset, availableDatasets),
  );
  const prevPropDatasetIdRef = useRef<string>(dataset.id);

  const sourceDataset = useMemo(
    () => availableDatasets.find((d) => d.id === selectedDatasetId) ?? dataset,
    [availableDatasets, selectedDatasetId, dataset],
  );

  // --- Tab 1: Cleaner State ---
  const initialConfig = useMemo(() => initCleanerConfig(sourceDataset, lang), [sourceDataset, lang]);
  const [mapVerbalCols, setMapVerbalCols] = useState<string[]>(() => initialConfig.verbalCols);
  const [reverseCols, setReverseCols] = useState<string[]>(() => initialConfig.reverseCols);
  const [composites, setComposites] = useState<EditableComposite[]>(() => initialConfig.composites);
  const [likertMin, setLikertMin] = useState<number>(1);
  const [likertMax, setLikertMax] = useState<number>(5);
  const [removeStraightLiners, setRemoveStraightLiners] = useState<boolean>(false);
  const [removeDuplicates, setRemoveDuplicates] = useState<boolean>(false);
  const [appliedNotice, setAppliedNotice] = useState<string | null>(null);

  useEffect(() => {
    if (prevPropDatasetIdRef.current !== dataset.id) {
      prevPropDatasetIdRef.current = dataset.id;
      setSelectedDatasetId(dataset.id);
    }
  }, [dataset.id]);

  const applyDatasetDefaults = (ds: Dataset) => {
    const cfg = initCleanerConfig(ds, lang);
    setMapVerbalCols(cfg.verbalCols);
    setReverseCols(cfg.reverseCols);
    setComposites(cfg.composites);
    setAppliedNotice(null);
  };

  const handleSelectSourceDataset = (id: string) => {
    setSelectedDatasetId(id);
    const found = availableDatasets.find((d) => d.id === id);
    if (found) applyDatasetDefaults(found);
  };

  const detectionInfo = useMemo(() => autoDetectLikertColumns(sourceDataset), [sourceDataset]);

  const { cleanReport, cleanError } = useMemo((): { cleanReport: SurveyCleanReport; cleanError: unknown } => {
    const activeComposites: CompositeSpec[] = composites
      .filter((c) => c.name.trim() && c.items.length > 0)
      .map((c) => ({ name: c.name.trim(), items: c.items }));

    try {
      return {
        cleanReport: cleanSurveyDataset(sourceDataset, {
          mapVerbalCols,
          reverseCols,
          likertMin,
          likertMax,
          composites: activeComposites,
          removeStraightLiners,
          removeDuplicates,
        }),
        cleanError: null,
      };
    } catch (err) {
      return {
        cleanReport: {
          cleanedDataset: sourceDataset,
          mappedColumns: [],
          reversedColumns: [],
          compositesCreated: [],
          straightLinerIndices: [],
          duplicateRowIndices: [],
          summaryTextTr: '',
          summaryTextEn: '',
        },
        cleanError: err,
      };
    }
  }, [
    sourceDataset,
    mapVerbalCols,
    reverseCols,
    likertMin,
    likertMax,
    composites,
    removeStraightLiners,
    removeDuplicates,
  ]);

  const toggleColumnInList = (
    col: string,
    setter: React.Dispatch<React.SetStateAction<string[]>>,
  ) => {
    setAppliedNotice(null);
    setter((prev) => (prev.includes(col) ? prev.filter((c) => c !== col) : [...prev, col]));
  };

  const handleAddComposite = () => {
    const nextIdx = composites.length + 1;
    const defaultName = lang === 'tr' ? `Olcek_${nextIdx}` : `Scale_${nextIdx}`;
    setComposites((prev) => [
      ...prev,
      {
        id: `comp-${Date.now()}-${nextIdx}`,
        name: defaultName,
        items: mapVerbalCols.length > 0 ? [...mapVerbalCols] : [],
      },
    ]);
  };

  const handleUpdateCompositeName = (id: string, name: string) => {
    setComposites((prev) => prev.map((c) => (c.id === id ? { ...c, name } : c)));
  };

  const handleToggleCompositeItem = (id: string, item: string) => {
    setComposites((prev) =>
      prev.map((c) =>
        c.id !== id
          ? c
          : {
              ...c,
              items: c.items.includes(item)
                ? c.items.filter((i) => i !== item)
                : [...c.items, item],
            },
      ),
    );
  };

  const handleRemoveComposite = (id: string) => {
    setComposites((prev) => prev.filter((c) => c.id !== id));
  };

  const totalConvertedCells = useMemo(
    () => cleanReport.mappedColumns.reduce((acc, m) => acc + m.convertedCount, 0),
    [cleanReport],
  );

  const straightLinerLabels = useMemo(() => {
    const idCol = sourceDataset.columns.find((c) => {
      const lower = c.name.toLowerCase();
      return lower.includes('id') || lower.includes('yanit') || lower.includes('katilimci');
    })?.name;
    return cleanReport.straightLinerIndices.map((idx) => {
      const val = idCol ? sourceDataset.rows[idx]?.[idCol] : null;
      return val !== null && val !== undefined && val !== '' ? `${String(val)} (#${idx + 1})` : `#${idx + 1}`;
    });
  }, [cleanReport.straightLinerIndices, sourceDataset]);

  const previewRows = useMemo(() => {
    const straightSet = new Set(cleanReport.straightLinerIndices);
    const dupSet = new Set(cleanReport.duplicateRowIndices);
    const excluded = new Set<number>();
    if (removeStraightLiners) cleanReport.straightLinerIndices.forEach((i) => excluded.add(i));
    if (removeDuplicates) cleanReport.duplicateRowIndices.forEach((i) => excluded.add(i));

    const keptOriginalIndices: number[] = [];
    for (let i = 0; i < sourceDataset.rows.length; i++) {
      if (!excluded.has(i)) keptOriginalIndices.push(i);
    }

    return cleanReport.cleanedDataset.rows.slice(0, 15).map((row, idx) => {
      const origIdx = keptOriginalIndices[idx] ?? idx;
      return {
        row,
        origIdx,
        isStraight: straightSet.has(origIdx),
        isDuplicate: dupSet.has(origIdx),
      };
    });
  }, [cleanReport, sourceDataset.rows.length, removeStraightLiners, removeDuplicates]);

  // --- Tab 2: Advisor & Collab State ---
  const [projectName, setProjectName] = useState<string>(
    () => dataset.name.replace(/\.(csv|xlsx?)$/i, '') || 'Hypotheca Study',
  );
  const [ownerName, setOwnerName] = useState<string>('');
  const [annotations, setAnnotations] = useState<ReviewAnnotation[]>([]);

  const [targetAnalysisId, setTargetAnalysisId] = useState<string>(
    () => history[0]?.id ?? 'study-general',
  );
  const [reviewerName, setReviewerName] = useState<string>('');
  const [reviewerRole, setReviewerRole] = useState<ReviewAnnotation['authorRole']>('Advisor');
  const [reviewStatus, setReviewStatus] = useState<ReviewAnnotation['status']>('approved');
  const [reviewComment, setReviewComment] = useState<string>('');

  const [exportedSnapshot, setExportedSnapshot] = useState<HypothecaProjectSnapshot>(() =>
    exportProjectSnapshot({
      projectName: dataset.name.replace(/\.(csv|xlsx?)$/i, '') || 'Hypotheca Study',
      ownerName: '',
      dataset,
      history,
      annotations: [],
    }),
  );
  const [copiedJson, setCopiedJson] = useState<boolean>(false);

  const [importJsonText, setImportJsonText] = useState<string>('');
  const [importedSnapshot, setImportedSnapshot] = useState<HypothecaProjectSnapshot | null>(null);
  const [importError, setImportError] = useState<string | null>(null);
  const [collabNotice, setCollabNotice] = useState<string | null>(null);

  useEffect(() => {
    if (history.length > 0 && targetAnalysisId === 'study-general') {
      setTargetAnalysisId(history[0].id);
    }
  }, [history, targetAnalysisId]);

  const buildFreshSnapshot = (): HypothecaProjectSnapshot => {
    const snap = exportProjectSnapshot({
      projectName,
      ownerName,
      dataset,
      history,
      annotations,
    });
    setExportedSnapshot(snap);
    return snap;
  };

  const handleAddAnnotation = (e: React.FormEvent) => {
    e.preventDefault();
    if (!reviewComment.trim()) return;
    const ann = createAnnotation(
      targetAnalysisId,
      reviewerName,
      reviewerRole,
      reviewStatus,
      reviewComment,
    );
    const nextAnnotations = [ann, ...annotations];
    setAnnotations(nextAnnotations);
    setReviewComment('');
    setExportedSnapshot(
      exportProjectSnapshot({
        projectName,
        ownerName,
        dataset,
        history,
        annotations: nextAnnotations,
      }),
    );
  };

  const handleDeleteAnnotation = (id: string) => {
    const nextAnnotations = annotations.filter((a) => a.id !== id);
    setAnnotations(nextAnnotations);
    setExportedSnapshot(
      exportProjectSnapshot({
        projectName,
        ownerName,
        dataset,
        history,
        annotations: nextAnnotations,
      }),
    );
  };

  const handleDownloadSnapshot = () => {
    const snap = buildFreshSnapshot();
    const json = JSON.stringify(snap, null, 2);
    const blob = new Blob([json], { type: 'application/json;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const safeSlug =
      snap.projectName
        .toLowerCase()
        .replace(/[^a-z0-9_-]+/g, '-')
        .replace(/^-+|-+$/g, '') || 'study';
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = `${safeSlug}.hypotheca.json`;
    document.body.appendChild(anchor);
    anchor.click();
    document.body.removeChild(anchor);
    URL.revokeObjectURL(url);
  };

  const handleCopyJson = async () => {
    const snap = buildFreshSnapshot();
    const json = JSON.stringify(snap, null, 2);
    if (typeof navigator !== 'undefined' && navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(json);
      setCopiedJson(true);
      setTimeout(() => setCopiedJson(false), 1800);
    }
  };

  const runImportValidation = (rawText: string) => {
    setImportError(null);
    setImportedSnapshot(null);
    setCollabNotice(null);
    try {
      const validated = parseAndValidateSnapshot(rawText);
      setImportedSnapshot(validated);
    } catch (err) {
      setImportError(errorMessage(err, lang));
    }
  };

  const handleFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      const content = typeof reader.result === 'string' ? reader.result : '';
      setImportJsonText(content);
      runImportValidation(content);
    };
    reader.readAsText(file);
  };

  const getAnalysisLabel = (id: string, pool: AnalysisOutput[]): string => {
    if (id === 'study-general') return t.generalStudyTarget;
    const found = pool.find((item) => item.id === id);
    return found ? found.title : id;
  };

  const roleLabel = (role: ReviewAnnotation['authorRole']): string =>
    role === 'Advisor' ? t.roleAdvisor : role === 'CoAuthor' ? t.roleCoAuthor : role === 'Reviewer' ? t.roleReviewer : String(role);

  const renderStatusBadge = (status: ReviewAnnotation['status']) => {
    if (status === 'approved') {
      return (
        <span className="hp-badge hp-badge-ok">
          <CheckCircle2 size={12} />
          {t.statusApproved}
        </span>
      );
    }
    if (status === 'revision_needed') {
      return (
        <span className="hp-badge hp-badge-warn">
          <AlertTriangle size={12} />
          {t.statusRevision}
        </span>
      );
    }
    return (
      <span className="hp-badge hp-badge-info">
        <MessageSquare size={12} />
        {t.statusComment}
      </span>
    );
  };

  const allColumns = sourceDataset.columns.map((c) => c.name);
  const allLikertCandidates = useMemo(() => {
    const set = new Set<string>([
      ...mapVerbalCols,
      ...reverseCols,
      ...sourceDataset.columns.filter((c) => c.valueType === 'numeric').map((c) => c.name),
    ]);
    return allColumns.filter((c) => set.has(c));
  }, [allColumns, mapVerbalCols, reverseCols, sourceDataset.columns]);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-md)' }}>
      <div className="hp-plate">
        <div
          style={{
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'flex-start',
            flexWrap: 'wrap',
            gap: 'var(--space-sm)',
          }}
        >
          <h2>{t.pageTitle}</h2>
        </div>

        <div className="hp-tabs" style={{ marginTop: 'var(--space-md)' }}>
          <button
            type="button"
            className={`hp-tab ${activeTab === 'cleaner' ? 'is-active' : ''}`}
            onClick={() => setActiveTab('cleaner')}
          >
            {t.tabCleaner}
          </button>
          <button
            type="button"
            className={`hp-tab ${activeTab === 'collab' ? 'is-active' : ''}`}
            onClick={() => setActiveTab('collab')}
          >
            {t.tabCollab}
          </button>
        </div>
      </div>

      {activeTab === 'cleaner' && (
        <div className="hp-workbench-cols">
          <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-md)' }}>
            <div className="hp-plate" style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-sm)' }}>
              <div>
                <label className="hp-label" htmlFor="sc-source-select">
                  {t.sourceDataset}
                </label>
                <select
                  id="sc-source-select"
                  className="hp-select"
                  value={sourceDataset.id}
                  onChange={(e) => handleSelectSourceDataset(e.target.value)}
                >
                  {availableDatasets.map((d) => (
                    <option key={d.id} value={d.id}>
                      {d.name} (N={d.rows.length})
                    </option>
                  ))}
                </select>
              </div>

              {rawLikertDataset && sourceDataset.id !== rawLikertDataset.id && (
                <button
                  type="button"
                  className="hp-btn hp-btn-sm"
                  onClick={() => handleSelectSourceDataset(rawLikertDataset.id)}
                >
                  {t.quickLoadRaw}
                </button>
              )}

              <div>
                <span className="hp-label">{t.scaleRange}</span>
                <div className="hp-grid-2">
                  <div>
                    <label className="hp-label" htmlFor="sc-min-input">
                      {t.minLabel}
                    </label>
                    <input
                      id="sc-min-input"
                      type="number"
                      className="hp-input"
                      value={likertMin}
                      onChange={(e) => setLikertMin(Number(e.target.value) || 1)}
                    />
                  </div>
                  <div>
                    <label className="hp-label" htmlFor="sc-max-input">
                      {t.maxLabel}
                    </label>
                    <input
                      id="sc-max-input"
                      type="number"
                      className="hp-input"
                      value={likertMax}
                      onChange={(e) => setLikertMax(Number(e.target.value) || 5)}
                    />
                  </div>
                </div>
              </div>
            </div>

            <div className="hp-plate" style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-xs)' }}>
              <span className="hp-label">{t.verbalColsTitle}</span>
              {allColumns.map((col) => {
                const isAuto = detectionInfo.verbalColumns.includes(col);
                const checked = mapVerbalCols.includes(col);
                return (
                  <label
                    key={col}
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'space-between',
                      gap: 'var(--space-xs)',
                      fontSize: 'var(--text-sm)',
                      cursor: 'pointer',
                    }}
                  >
                    <span style={{ display: 'inline-flex', alignItems: 'center', gap: '6px' }}>
                      <input
                        type="checkbox"
                        checked={checked}
                        onChange={() => toggleColumnInList(col, setMapVerbalCols)}
                      />
                      <span>{col}</span>
                    </span>
                    {isAuto && <span className="hp-badge hp-badge-info">{t.autoDetectedBadge}</span>}
                  </label>
                );
              })}
            </div>

            <div className="hp-plate" style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-xs)' }}>
              <span className="hp-label" style={{ display: 'inline-flex', alignItems: 'center', gap: '6px' }}>
                <ArrowLeftRight size={13} />
                {t.reverseColsTitle}
              </span>
              {allLikertCandidates.map((col) => {
                const isSuspect = detectionInfo.suspectReverseColumns.includes(col);
                const checked = reverseCols.includes(col);
                return (
                  <label
                    key={col}
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'space-between',
                      gap: 'var(--space-xs)',
                      fontSize: 'var(--text-sm)',
                      cursor: 'pointer',
                    }}
                  >
                    <span style={{ display: 'inline-flex', alignItems: 'center', gap: '6px' }}>
                      <input
                        type="checkbox"
                        checked={checked}
                        onChange={() => toggleColumnInList(col, setReverseCols)}
                      />
                      <span>{col}</span>
                    </span>
                    {isSuspect && <span className="hp-badge hp-badge-warn">{t.suspectReverseBadge}</span>}
                  </label>
                );
              })}
            </div>

            <div className="hp-plate" style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-sm)' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <span className="hp-label" style={{ marginBottom: 0, display: 'inline-flex', alignItems: 'center', gap: '6px' }}>
                  <Layers size={13} />
                  {t.compositesTitle}
                </span>
                <button type="button" className="hp-btn hp-btn-sm" onClick={handleAddComposite}>
                  <Plus size={12} />
                  {t.addComposite}
                </button>
              </div>

              {composites.map((comp) => (
                <div
                  key={comp.id}
                  className="hp-plate-flat"
                  style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-xs)', padding: 'var(--space-sm)' }}
                >
                  <div style={{ display: 'flex', gap: 'var(--space-xs)', alignItems: 'center' }}>
                    <input
                      type="text"
                      className="hp-input"
                      value={comp.name}
                      placeholder={t.compositeNamePlaceholder}
                      onChange={(e) => handleUpdateCompositeName(comp.id, e.target.value)}
                    />
                    <button
                      type="button"
                      className="hp-btn hp-btn-sm"
                      onClick={() => handleRemoveComposite(comp.id)}
                      aria-label={lang === 'tr' ? 'Kaldır' : 'Remove'}
                    >
                      <Trash2 size={12} />
                    </button>
                  </div>
                  <div style={{ display: 'flex', flexWrap: 'wrap', gap: 'var(--space-xs)' }}>
                    {allLikertCandidates.map((item) => (
                      <label
                        key={item}
                        style={{
                          display: 'inline-flex',
                          alignItems: 'center',
                          gap: '4px',
                          fontSize: 'var(--text-xs)',
                          cursor: 'pointer',
                        }}
                      >
                        <input
                          type="checkbox"
                          checked={comp.items.includes(item)}
                          onChange={() => handleToggleCompositeItem(comp.id, item)}
                        />
                        <span>{item}</span>
                      </label>
                    ))}
                  </div>
                </div>
              ))}
            </div>

            <div className="hp-plate" style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-sm)' }}>
              <span className="hp-label">{t.qualityFiltersTitle}</span>
              <label style={{ display: 'flex', alignItems: 'center', gap: '8px', fontSize: 'var(--text-sm)', cursor: 'pointer' }}>
                <input
                  type="checkbox"
                  checked={removeStraightLiners}
                  onChange={(e) => setRemoveStraightLiners(e.target.checked)}
                />
                <span>{t.dropStraightLiners}</span>
              </label>
              <label style={{ display: 'flex', alignItems: 'center', gap: '8px', fontSize: 'var(--text-sm)', cursor: 'pointer' }}>
                <input
                  type="checkbox"
                  checked={removeDuplicates}
                  onChange={(e) => setRemoveDuplicates(e.target.checked)}
                />
                <span>{t.dropDuplicates}</span>
              </label>

              <button
                type="button"
                className="hp-btn hp-btn-primary"
                disabled={!onUpdateDataset || Boolean(cleanError) || cleanReport.cleanedDataset.rows.length === 0}
                onClick={() => {
                  if (onUpdateDataset) {
                    onUpdateDataset(cleanReport.cleanedDataset);
                    setAppliedNotice(t.appliedMsg);
                  }
                }}
              >
                <FileCheck2 size={15} />
                {t.applyWorkspace}
              </button>

              {appliedNotice && (
                <div className="hp-badge hp-badge-ok" style={{ justifyContent: 'center', padding: '6px 10px' }}>
                  <CheckCircle2 size={14} />
                  {appliedNotice}
                </div>
              )}
            </div>
          </div>

          <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-md)' }}>
            <div className="hp-grid-4">
              <div className="hp-plate-flat">
                <span className="hp-label">{t.kpiConverted}</span>
                <div className="hp-kpi-val">{totalConvertedCells}</div>
              </div>
              <div className="hp-plate-flat">
                <span className="hp-label">{t.kpiReversed}</span>
                <div className="hp-kpi-val">{cleanReport.reversedColumns.length}</div>
              </div>
              <div className="hp-plate-flat">
                <span className="hp-label">{t.kpiStraight}</span>
                <div className="hp-kpi-val">{cleanReport.straightLinerIndices.length}</div>
              </div>
              <div className="hp-plate-flat">
                <span className="hp-label">{t.kpiDuplicates}</span>
                <div className="hp-kpi-val">{cleanReport.duplicateRowIndices.length}</div>
              </div>
            </div>

            <div className="hp-plate" style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-sm)' }}>
              {cleanError ? (
                <div className="hp-badge hp-badge-err" style={{ whiteSpace: 'normal' }}>
                  <AlertTriangle size={14} />
                  <span>{errorMessage(cleanError, lang)}</span>
                </div>
              ) : (
                <p style={{ fontSize: 'var(--text-sm)' }}>
                  {lang === 'tr' ? cleanReport.summaryTextTr : cleanReport.summaryTextEn}
                </p>
              )}

              {straightLinerLabels.length > 0 && (
                <div
                  className="hp-plate-flat"
                  style={{
                    background: 'var(--color-warn-soft)',
                    borderColor: 'var(--color-warn)',
                    display: 'flex',
                    alignItems: 'center',
                    gap: 'var(--space-xs)',
                    flexWrap: 'wrap',
                    padding: 'var(--space-sm)',
                  }}
                >
                  <AlertTriangle size={15} />
                  <strong style={{ fontSize: 'var(--text-xs)' }}>{t.flaggedIdsLabel}:</strong>
                  <span className="hp-mono" style={{ fontSize: 'var(--text-xs)' }}>
                    {straightLinerLabels.join(', ')}
                  </span>
                </div>
              )}
            </div>

            <div className="hp-plate" style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-sm)' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 'var(--space-xs)' }}>
                <h3>{t.previewTitle}</h3>
                <span className="hp-badge">
                  {previewRows.length} / {cleanReport.cleanedDataset.rows.length}
                </span>
              </div>

              {previewRows.length === 0 ? (
                <p style={{ color: 'var(--color-muted)' }}>{t.noData}</p>
              ) : (
                <div className="hp-table-wrap">
                  <table className="hp-table">
                    <thead>
                      <tr>
                        <th>{t.statusCol}</th>
                        {cleanReport.cleanedDataset.columns.map((col) => (
                          <th key={col.name} className={col.valueType === 'numeric' ? 'num' : undefined}>
                            {col.name}
                          </th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {previewRows.map((entry, idx) => (
                        <tr key={idx}>
                          <td>
                            {entry.isStraight ? (
                              <span className="hp-badge hp-badge-warn">{t.statusStraight}</span>
                            ) : entry.isDuplicate ? (
                              <span className="hp-badge hp-badge-err">{t.statusDuplicate}</span>
                            ) : (
                              <span className="hp-badge hp-badge-ok">{t.statusOk}</span>
                            )}
                          </td>
                          {cleanReport.cleanedDataset.columns.map((col) => {
                            const val = entry.row[col.name];
                            const isNumericCol = col.valueType === 'numeric';
                            return (
                              <td key={col.name} className={isNumericCol ? 'num' : undefined}>
                                {val === null || val === undefined ? '' : String(val)}
                              </td>
                            );
                          })}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {activeTab === 'collab' && (
        <div className="hp-grid-2" style={{ alignItems: 'start' }}>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-md)' }}>
            <div className="hp-plate" style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-sm)' }}>
              <h3>{t.projectMetaTitle}</h3>
              <div className="hp-grid-2">
                <div>
                  <label className="hp-label" htmlFor="sc-project-name">
                    {t.projectName}
                  </label>
                  <input
                    id="sc-project-name"
                    type="text"
                    className="hp-input"
                    value={projectName}
                    onChange={(e) => setProjectName(e.target.value)}
                  />
                </div>
                <div>
                  <label className="hp-label" htmlFor="sc-owner-name">
                    {t.ownerName}
                  </label>
                  <input
                    id="sc-owner-name"
                    type="text"
                    className="hp-input"
                    value={ownerName}
                    onChange={(e) => setOwnerName(e.target.value)}
                  />
                </div>
              </div>
            </div>

            <form
              className="hp-plate"
              onSubmit={handleAddAnnotation}
              style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-sm)' }}
            >
              <h3>{t.addAnnotationTitle}</h3>
              <div>
                <label className="hp-label" htmlFor="sc-target-analysis">
                  {t.targetAnalysis}
                </label>
                <select
                  id="sc-target-analysis"
                  className="hp-select"
                  value={targetAnalysisId}
                  onChange={(e) => setTargetAnalysisId(e.target.value)}
                >
                  {history.map((item) => (
                    <option key={item.id} value={item.id}>
                      {item.title}
                    </option>
                  ))}
                  <option value="study-general">{t.generalStudyTarget}</option>
                </select>
              </div>

              <div className="hp-grid-3">
                <div>
                  <label className="hp-label" htmlFor="sc-reviewer-name">
                    {t.authorName}
                  </label>
                  <input
                    id="sc-reviewer-name"
                    type="text"
                    className="hp-input"
                    value={reviewerName}
                    onChange={(e) => setReviewerName(e.target.value)}
                  />
                </div>
                <div>
                  <label className="hp-label" htmlFor="sc-reviewer-role">
                    {t.authorRole}
                  </label>
                  <select
                    id="sc-reviewer-role"
                    className="hp-select"
                    value={reviewerRole}
                    onChange={(e) => setReviewerRole(e.target.value as ReviewAnnotation['authorRole'])}
                  >
                    <option value="Advisor">{t.roleAdvisor}</option>
                    <option value="CoAuthor">{t.roleCoAuthor}</option>
                    <option value="Reviewer">{t.roleReviewer}</option>
                  </select>
                </div>
                <div>
                  <label className="hp-label" htmlFor="sc-review-status">
                    {t.statusLabel}
                  </label>
                  <select
                    id="sc-review-status"
                    className="hp-select"
                    value={reviewStatus}
                    onChange={(e) => setReviewStatus(e.target.value as ReviewAnnotation['status'])}
                  >
                    <option value="approved">{t.statusApproved}</option>
                    <option value="revision_needed">{t.statusRevision}</option>
                    <option value="comment">{t.statusComment}</option>
                  </select>
                </div>
              </div>

              <div>
                <label className="hp-label" htmlFor="sc-review-comment">
                  {t.statusComment}
                </label>
                <textarea
                  id="sc-review-comment"
                  className="hp-textarea"
                  placeholder={t.commentPlaceholder}
                  value={reviewComment}
                  onChange={(e) => setReviewComment(e.target.value)}
                />
              </div>

              <div>
                <button
                  type="submit"
                  className="hp-btn hp-btn-accent"
                  disabled={!reviewComment.trim()}
                >
                  <Plus size={14} />
                  {t.addAnnotationBtn}
                </button>
              </div>
            </form>

            <div className="hp-plate" style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-sm)' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <h3>{t.annotationsTitle}</h3>
                <span className="hp-badge">{annotations.length}</span>
              </div>

              {annotations.length === 0 ? (
                <p style={{ fontSize: 'var(--text-sm)', color: 'var(--color-muted)' }}>{t.noAnnotations}</p>
              ) : (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-xs)' }}>
                  {annotations.map((ann) => (
                    <div
                      key={ann.id}
                      className="hp-plate-flat"
                      style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-2xs)' }}
                    >
                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 'var(--space-xs)', flexWrap: 'wrap' }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-xs)', flexWrap: 'wrap' }}>
                          {renderStatusBadge(ann.status)}
                          <strong style={{ fontSize: 'var(--text-sm)' }}>{ann.authorName}</strong>
                          <span className="hp-badge">{roleLabel(ann.authorRole)}</span>
                        </div>
                        <button
                          type="button"
                          className="hp-btn hp-btn-sm"
                          onClick={() => handleDeleteAnnotation(ann.id)}
                          aria-label={lang === 'tr' ? 'Sil' : 'Delete'}
                        >
                          <Trash2 size={12} />
                        </button>
                      </div>
                      <div style={{ fontSize: 'var(--text-xs)', color: 'var(--color-muted)' }}>
                        {getAnalysisLabel(ann.targetAnalysisId, history)}
                      </div>
                      <p style={{ fontSize: 'var(--text-sm)' }}>{ann.comment}</p>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>

          <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-md)' }}>
            <div className="hp-plate" style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-sm)' }}>
              <h3>{t.exportTitle}</h3>

              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 'var(--space-xs)' }}>
                <button type="button" className="hp-btn hp-btn-primary" onClick={handleDownloadSnapshot}>
                  <Download size={14} />
                  {t.exportBtn}
                </button>
                <button type="button" className="hp-btn" onClick={buildFreshSnapshot}>
                  <RefreshCw size={14} />
                  {t.refreshBtn}
                </button>
                <button type="button" className="hp-btn" onClick={handleCopyJson}>
                  {copiedJson ? <Check size={14} /> : <Copy size={14} />}
                  {copiedJson ? t.copiedBtn : t.copyJsonBtn}
                </button>
              </div>

              <div className="hp-plate-flat" style={{ padding: 'var(--space-sm)' }}>
                <span className="hp-label">{t.checksumLabel}</span>
                <div className="hp-mono" style={{ fontSize: 'var(--text-xs)', wordBreak: 'break-all' }}>
                  {exportedSnapshot.checksum}
                </div>
              </div>

              <div style={{ fontSize: 'var(--text-xs)', color: 'var(--color-muted)' }}>
                {exportedSnapshot.dataset.name}: {exportedSnapshot.dataset.rows.length} {t.rowsWord},{' '}
                {exportedSnapshot.history.length} {t.analysesWord}, {exportedSnapshot.annotations.length} {t.notesWord}
              </div>
            </div>

            <div className="hp-plate" style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-sm)' }}>
              <h3>{t.importTitle}</h3>

              <div>
                <label className="hp-label" htmlFor="sc-import-file">
                  <span style={{ display: 'inline-flex', alignItems: 'center', gap: '6px' }}>
                    <Upload size={13} />
                    {t.uploadFileLabel}
                  </span>
                </label>
                <input
                  id="sc-import-file"
                  type="file"
                  accept=".json,.hypotheca.json"
                  className="hp-input"
                  onChange={handleFileUpload}
                />
              </div>

              <div>
                <label className="hp-label" htmlFor="sc-import-textarea">
                  {t.pasteJsonLabel}
                </label>
                <textarea
                  id="sc-import-textarea"
                  className="hp-textarea"
                  value={importJsonText}
                  onChange={(e) => setImportJsonText(e.target.value)}
                  placeholder="{ ... }"
                />
              </div>

              <div>
                <button
                  type="button"
                  className="hp-btn hp-btn-accent"
                  disabled={!importJsonText.trim()}
                  onClick={() => runImportValidation(importJsonText)}
                >
                  <ShieldCheck size={14} />
                  {t.validateImportBtn}
                </button>
              </div>

              {importError && (
                <div
                  className="hp-plate-flat"
                  style={{
                    background: 'var(--color-error-soft)',
                    borderColor: 'var(--color-error)',
                    color: 'var(--color-error)',
                    display: 'flex',
                    flexDirection: 'column',
                    gap: 'var(--space-2xs)',
                  }}
                >
                  <strong style={{ display: 'inline-flex', alignItems: 'center', gap: '6px', fontSize: 'var(--text-sm)' }}>
                    <XCircle size={15} />
                    {t.tamperErrorTitle}
                  </strong>
                  <span style={{ fontSize: 'var(--text-xs)' }}>{importError}</span>
                </div>
              )}

              {importedSnapshot && (
                <div className="hp-plate-flat" style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-sm)' }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 'var(--space-xs)' }}>
                    <strong>{t.importedMetaTitle}</strong>
                    <span className="hp-badge hp-badge-ok">
                      <ShieldCheck size={13} />
                      {t.verifiedBadge}
                    </span>
                  </div>

                  <div style={{ fontSize: 'var(--text-sm)' }}>
                    <div>
                      <strong>{importedSnapshot.projectName}</strong> ({importedSnapshot.ownerName})
                    </div>
                    <div style={{ color: 'var(--color-muted)', fontSize: 'var(--text-xs)' }}>
                      {importedSnapshot.dataset.name}: {importedSnapshot.dataset.rows.length} {t.rowsWord},{' '}
                      {importedSnapshot.history.length} {t.analysesWord}, {importedSnapshot.annotations.length}{' '}
                      {t.notesWord}
                    </div>
                  </div>

                  <div style={{ display: 'flex', flexWrap: 'wrap', gap: 'var(--space-xs)' }}>
                    {onUpdateDataset && (
                      <button
                        type="button"
                        className="hp-btn hp-btn-sm hp-btn-primary"
                        onClick={() => {
                          onUpdateDataset(importedSnapshot.dataset);
                          setCollabNotice(t.appliedMsg);
                        }}
                      >
                        {t.loadImportedDataset}
                      </button>
                    )}
                    {importedSnapshot.annotations.length > 0 && (
                      <button
                        type="button"
                        className="hp-btn hp-btn-sm"
                        onClick={() => {
                          const existingIds = new Set(annotations.map((a) => a.id));
                          const merged = [
                            ...annotations,
                            ...importedSnapshot.annotations.filter((a) => !existingIds.has(a.id)),
                          ];
                          setAnnotations(merged);
                        }}
                      >
                        {t.mergeAnnotations}
                      </button>
                    )}
                  </div>

                  {collabNotice && (
                    <span className="hp-badge hp-badge-ok">
                      <CheckCircle2 size={12} />
                      {collabNotice}
                    </span>
                  )}

                  {importedSnapshot.annotations.length > 0 && (
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-xs)' }}>
                      {importedSnapshot.annotations.map((ann) => (
                        <div key={ann.id} className="hp-plate-flat" style={{ padding: 'var(--space-xs)' }}>
                          <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-xs)', flexWrap: 'wrap' }}>
                            {renderStatusBadge(ann.status)}
                            <strong style={{ fontSize: 'var(--text-xs)' }}>{ann.authorName}</strong>
                            <span className="hp-badge">{roleLabel(ann.authorRole)}</span>
                          </div>
                          <div style={{ fontSize: 'var(--text-xs)', color: 'var(--color-muted)', marginTop: '2px' }}>
                            {getAnalysisLabel(ann.targetAnalysisId, importedSnapshot.history)}
                          </div>
                          <p style={{ fontSize: 'var(--text-sm)', marginTop: '4px' }}>{ann.comment}</p>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

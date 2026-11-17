import React, { useEffect, useMemo, useState } from 'react';
import {
  AlertCircle,
  Archive,
  Check,
  Copy,
  Download,
  FileCode2,
  PackageCheck,
  Terminal,
} from 'lucide-react';
import { AnalysisOutput, Dataset, Lang } from '../../types/interfaces';
import {
  ScriptFormat,
  generateCombinedScript,
  generateReproducibleScript,
} from './scriptGenerator';
import { computeDatasetSha256, createOsfBundle } from './osfBundle';
import { errorMessage } from '../../components/errorMessage';

export interface ReproducibilityViewProps {
  dataset: Dataset;
  history: AnalysisOutput[];
  lang: Lang;
  defaultNotes?: string;
}

const FORMAT_OPTIONS: { id: ScriptFormat; label: string; ext: string; mime: string }[] = [
  { id: 'r', label: 'R', ext: 'R', mime: 'text/x-r;charset=utf-8' },
  { id: 'python', label: 'Python', ext: 'py', mime: 'text/x-python;charset=utf-8' },
  { id: 'spss_syntax', label: 'SPSS', ext: 'sps', mime: 'text/plain;charset=utf-8' },
];

const ALL_COMBINED_KEY = '__ALL__';

function triggerBrowserDownload(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = filename;
  document.body.appendChild(anchor);
  anchor.click();
  document.body.removeChild(anchor);
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function sanitizeBaseFilename(name: string): string {
  const stem = (name || 'hypotheca_study').replace(/\.csv$/i, '');
  return stem.replace(/[^A-Za-z0-9._-]+/g, '_').replace(/^_+|_+$/g, '') || 'hypotheca_study';
}

export const ReproducibilityView: React.FC<ReproducibilityViewProps> = ({
  dataset,
  history,
  lang,
  defaultNotes,
}) => {
  const isTr = lang === 'tr';
  const [format, setFormat] = useState<ScriptFormat>('r');
  const [selectedAnalysisId, setSelectedAnalysisId] = useState<string>(ALL_COMBINED_KEY);
  const [preregNotes, setPreregNotes] = useState<string>(() => defaultNotes ?? '');
  const [sha256, setSha256] = useState<string>('');
  const [copiedScript, setCopiedScript] = useState<boolean>(false);
  const [copiedHash, setCopiedHash] = useState<boolean>(false);
  const [bundling, setBundling] = useState<boolean>(false);
  const [bundleFeedback, setBundleFeedback] = useState<{
    filename: string;
    bytes: number;
    fileCount: number;
  } | null>(null);
  const [bundleError, setBundleError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    setSha256('');
    computeDatasetSha256(dataset)
      .then((digest) => {
        if (active) setSha256(digest);
      })
      .catch(() => {
        if (active) setSha256('');
      });
    return () => {
      active = false;
    };
  }, [dataset]);

  useEffect(() => {
    if (
      selectedAnalysisId !== ALL_COMBINED_KEY &&
      !history.some((item) => item.id === selectedAnalysisId)
    ) {
      setSelectedAnalysisId(ALL_COMBINED_KEY);
    }
  }, [history, selectedAnalysisId]);

  const activeFormatMeta = useMemo(
    () => FORMAT_OPTIONS.find((opt) => opt.id === format) ?? FORMAT_OPTIONS[0],
    [format],
  );

  const scriptResult = useMemo((): { script: string; error: string | null } => {
    try {
      const target =
        selectedAnalysisId === ALL_COMBINED_KEY ? undefined : history.find((item) => item.id === selectedAnalysisId);
      const script = target
        ? generateReproducibleScript(target, dataset.name, format)
        : generateCombinedScript(history, dataset.name, format);
      return { script, error: null };
    } catch (err) {
      return { script: '', error: errorMessage(err, lang) };
    }
  }, [dataset.name, format, history, selectedAnalysisId, lang]);
  const generatedScript = scriptResult.script;

  const datasetStem = useMemo(() => sanitizeBaseFilename(dataset.name), [dataset.name]);

  const handleCopyScript = async () => {
    try {
      if (typeof navigator !== 'undefined' && navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(generatedScript);
      }
      setCopiedScript(true);
      setTimeout(() => setCopiedScript(false), 1800);
    } catch {
      setCopiedScript(false);
    }
  };

  const handleCopyHash = async () => {
    if (!sha256) return;
    try {
      if (typeof navigator !== 'undefined' && navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(sha256);
      }
      setCopiedHash(true);
      setTimeout(() => setCopiedHash(false), 1800);
    } catch {
      setCopiedHash(false);
    }
  };

  const handleDownloadScript = () => {
    const suffix =
      selectedAnalysisId === ALL_COMBINED_KEY ? 'combined' : selectedAnalysisId.slice(0, 12);
    const filename = `${datasetStem}_${suffix}.${activeFormatMeta.ext}`;
    const blob = new Blob([generatedScript], { type: activeFormatMeta.mime });
    triggerBrowserDownload(blob, filename);
  };

  const handleDownloadOsfBundle = async () => {
    setBundling(true);
    setBundleError(null);
    try {
      const { zipBytes, fileList } = await createOsfBundle(dataset, history, preregNotes);
      const filename = `${datasetStem}_osf.zip`;
      const blob = new Blob([zipBytes.slice().buffer], { type: 'application/zip' });
      triggerBrowserDownload(blob, filename);
      setBundleFeedback({
        filename,
        bytes: zipBytes.byteLength,
        fileCount: fileList.length,
      });
    } catch (err) {
      setBundleError(errorMessage(err, lang));
    } finally {
      setBundling(false);
    }
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-lg)' }}>
      <div className="hp-plate">
        <div
          style={{
            display: 'flex',
            flexWrap: 'wrap',
            alignItems: 'center',
            justifyContent: 'space-between',
            gap: 'var(--space-md)',
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-xs)' }}>
            <FileCode2 size={20} aria-hidden="true" />
            <h2>{isTr ? 'Tekrarlanabilirlik' : 'Reproducibility'}</h2>
          </div>

          <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 'var(--space-xs)' }}>
            <span className="hp-badge" title={sha256}>
              <span>{isTr ? 'Veri özeti' : 'Data hash'}:</span>
              <span className="hp-mono">
                {sha256 ? `${sha256.slice(0, 12)}...${sha256.slice(-8)}` : '...'}
              </span>
            </span>
            <button
              type="button"
              className="hp-btn hp-btn-sm"
              onClick={handleCopyHash}
              disabled={!sha256}
            >
              {copiedHash ? <Check size={13} aria-hidden="true" /> : <Copy size={13} aria-hidden="true" />}
              <span>{copiedHash ? (isTr ? 'Kopyalandı' : 'Copied') : isTr ? 'Kopyala' : 'Copy'}</span>
            </button>
          </div>
        </div>
      </div>

      <div className="hp-workbench-cols">
        <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-md)' }}>
          <div className="hp-plate" style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-md)' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-xs)' }}>
              <Terminal size={16} aria-hidden="true" />
              <h3>{isTr ? 'Betik' : 'Script'}</h3>
            </div>

            <div>
              <label className="hp-label" htmlFor="hp-repro-analysis-select">
                {isTr ? 'Analiz' : 'Analysis'}
              </label>
              <select
                id="hp-repro-analysis-select"
                className="hp-select"
                value={selectedAnalysisId}
                onChange={(e) => setSelectedAnalysisId(e.target.value)}
              >
                <option value={ALL_COMBINED_KEY}>
                  {isTr
                    ? `Tüm analizler (${history.length})`
                    : `All analyses (${history.length})`}
                </option>
                {history.map((item, idx) => (
                  <option key={item.id} value={item.id}>
                    {idx + 1}. {item.title}
                  </option>
                ))}
              </select>
            </div>

            {history.length === 0 && (
              <div className="hp-badge hp-badge-warn" style={{ padding: 'var(--space-xs) var(--space-sm)' }}>
                <AlertCircle size={14} aria-hidden="true" />
                <span>
                  {isTr
                    ? 'Henüz analiz yok. Yalnızca veri okuma kodu gösteriliyor.'
                    : 'No analyses yet. Only the data import code is shown.'}
                </span>
              </div>
            )}

            <div>
              <label className="hp-label" htmlFor="hp-prereg-notes">
                {isTr ? 'Ön kayıt notları' : 'Preregistration notes'}
              </label>
              <textarea
                id="hp-prereg-notes"
                className="hp-textarea"
                value={preregNotes}
                onChange={(e) => setPreregNotes(e.target.value)}
                placeholder={
                  isTr
                    ? 'Hipotezler, dışlama ölçütleri, ön kayıt numarası'
                    : 'Hypotheses, exclusion criteria, preregistration ID'
                }
              />
            </div>

            <button
              type="button"
              className="hp-btn hp-btn-accent"
              onClick={handleDownloadOsfBundle}
              disabled={bundling}
            >
              <Archive size={16} aria-hidden="true" />
              <span>
                {bundling
                  ? isTr
                    ? 'Hazırlanıyor...'
                    : 'Preparing...'
                  : isTr
                    ? 'OSF paketini indir (.zip)'
                    : 'Download OSF package (.zip)'}
              </span>
            </button>

            {bundleFeedback && (
              <div className="hp-badge hp-badge-ok" style={{ padding: 'var(--space-xs) var(--space-sm)' }}>
                <PackageCheck size={14} aria-hidden="true" />
                <span>
                  {bundleFeedback.filename}, {bundleFeedback.fileCount} {isTr ? 'dosya' : 'files'}
                </span>
              </div>
            )}

            {bundleError && (
              <div className="hp-badge hp-badge-err" style={{ padding: 'var(--space-xs) var(--space-sm)' }}>
                <AlertCircle size={14} aria-hidden="true" />
                <span>{bundleError}</span>
              </div>
            )}
          </div>

        </div>

        <div className="hp-plate" style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-md)' }}>
          <div
            style={{
              display: 'flex',
              flexWrap: 'wrap',
              alignItems: 'center',
              justifyContent: 'space-between',
              gap: 'var(--space-sm)',
            }}
          >
            <div className="hp-tabs" role="tablist" aria-label={isTr ? 'Betik dili' : 'Script language'}>
              {FORMAT_OPTIONS.map((opt) => (
                <button
                  key={opt.id}
                  type="button"
                  role="tab"
                  aria-selected={format === opt.id}
                  className={`hp-tab ${format === opt.id ? 'is-active' : ''}`}
                  onClick={() => setFormat(opt.id)}
                >
                  {opt.label}
                </button>
              ))}
            </div>

            <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-xs)' }}>
              <button type="button" className="hp-btn hp-btn-sm" onClick={handleCopyScript}>
                {copiedScript ? <Check size={14} aria-hidden="true" /> : <Copy size={14} aria-hidden="true" />}
                <span>{copiedScript ? (isTr ? 'Kopyalandı' : 'Copied') : isTr ? 'Kopyala' : 'Copy'}</span>
              </button>
              <button
                type="button"
                className="hp-btn hp-btn-primary hp-btn-sm"
                onClick={handleDownloadScript}
              >
                <Download size={14} aria-hidden="true" />
                <span>.{activeFormatMeta.ext} {isTr ? 'İndir' : 'Download'}</span>
              </button>
            </div>
          </div>

          {scriptResult.error ? (
            <div className="hp-badge hp-badge-err" style={{ whiteSpace: 'normal' }}>
              <AlertCircle size={14} aria-hidden="true" />
              <span>{scriptResult.error}</span>
            </div>
          ) : (
            <pre className="hp-code-block" aria-label={activeFormatMeta.label}>
              {generatedScript}
            </pre>
          )}
        </div>
      </div>
    </div>
  );
};

export default ReproducibilityView;

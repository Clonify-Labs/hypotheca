import React, { useMemo, useState } from 'react';
import { BookOpen, Copy, Download, FileText, Search, Sigma, X } from 'lucide-react';
import { AnalysisOutput, Dataset, Lang } from '../../types/interfaces';
import { generateApaManuscriptSection, ManuscriptProjectMeta } from './deterministicWriter';
import {
  lookupCrossrefByDoiOrQuery,
  matchReferencesForAnalyses,
  searchLocalReferences,
  VerifiedReference,
} from './verifiedCitations';
import { exportApaDocxBytes, exportLatexTables, exportQuartoDocument, exportWorkbookXlsxBytes } from './exporters';
import { errorMessage } from '../../components/errorMessage';

export interface PublicationStudioPageProps {
  dataset: Dataset;
  history: AnalysisOutput[];
  lang: Lang;
  projectMeta?: ManuscriptProjectMeta;
  onRemoveAnalysis?: (id: string) => void;
}

type TabId = 'draft' | 'refs' | 'latex' | 'office';

function downloadBytes(data: Uint8Array | string, filename: string, mime: string) {
  const part: BlobPart = typeof data === 'string' ? data : (data.slice().buffer as ArrayBuffer);
  const blob = new Blob([part], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

export const PublicationStudioPage: React.FC<PublicationStudioPageProps> = ({
  dataset,
  history,
  lang,
  projectMeta,
  onRemoveAnalysis,
}) => {
  const [tab, setTab] = useState<TabId>('draft');
  const [query, setQuery] = useState('');
  const [searchResults, setSearchResults] = useState<VerifiedReference[] | null>(null);
  const [searching, setSearching] = useState(false);
  const [latexMode, setLatexMode] = useState<'tex' | 'qmd'>('tex');
  const [busy, setBusy] = useState<string | null>(null);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  const t = (tr: string, en: string) => (lang === 'tr' ? tr : en);

  const draft = useMemo(() => {
    try {
      return { manuscript: history.length ? generateApaManuscriptSection(history, dataset, lang, projectMeta) : null, error: null as string | null };
    } catch (err) {
      return { manuscript: null, error: errorMessage(err, lang) };
    }
  }, [history, dataset, lang, projectMeta]);
  const manuscript = draft.manuscript;
  const matchedRefs = useMemo(() => {
    try {
      return matchReferencesForAnalyses(history);
    } catch {
      return [];
    }
  }, [history]);
  const latex = useMemo(() => {
    try {
      return {
        source: latexMode === 'tex' ? exportLatexTables(history) : exportQuartoDocument(history, dataset, lang),
        error: null as string | null,
      };
    } catch (err) {
      return { source: '', error: errorMessage(err, lang) };
    }
  }, [history, dataset, lang, latexMode]);
  const latexSource = latex.source;

  const runSearch = async (online: boolean) => {
    setSearching(true);
    setErrorMsg(null);
    try {
      const local = searchLocalReferences(query);
      if (!online) {
        setSearchResults(local);
      } else {
        const remote = await lookupCrossrefByDoiOrQuery(query);
        setSearchResults([...local, ...remote]);
      }
    } catch (err) {
      setErrorMsg(errorMessage(err, lang));
    } finally {
      setSearching(false);
    }
  };

  const handleDocx = async () => {
    setBusy('docx');
    setErrorMsg(null);
    try {
      const bytes = await exportApaDocxBytes(history, dataset, lang);
      downloadBytes(bytes, 'hypotheca_apa7_report.docx', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document');
    } catch (err) {
      setErrorMsg(errorMessage(err, lang));
    } finally {
      setBusy(null);
    }
  };

  const handleXlsx = () => {
    setBusy('xlsx');
    setErrorMsg(null);
    try {
      const bytes = exportWorkbookXlsxBytes(history, dataset);
      downloadBytes(bytes, 'hypotheca_tables.xlsx', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    } catch (err) {
      setErrorMsg(errorMessage(err, lang));
    } finally {
      setBusy(null);
    }
  };

  const copy = (txt: string) => {
    void navigator.clipboard?.writeText(txt).catch(() => undefined);
  };

  const refList = (refs: VerifiedReference[]) => (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-xs)' }}>
      {refs.map((r) => (
        <div key={`${r.verifiedSource}-${r.key}`} className="hp-plate-flat" style={{ padding: 'var(--space-sm)' }}>
          <div style={{ fontSize: 'var(--text-sm)', lineHeight: 1.5 }}>{r.apa7}</div>
          <div style={{ display: 'flex', gap: 'var(--space-xs)', marginTop: 'var(--space-2xs)', flexWrap: 'wrap', alignItems: 'center' }}>
            <span className="hp-badge hp-badge-ok">{r.verifiedSource === 'local_curated' ? t('Yerel kaynak', 'Local') : 'CrossRef'}</span>
            <span className="hp-mono" style={{ fontSize: 'var(--text-xs)' }}>{r.doi}</span>
            <button type="button" className="hp-btn hp-btn-sm" onClick={() => copy(r.bibtex.replace(/\\n/g, '\n'))}>
              <Copy size={12} />
              <span>BibTeX</span>
            </button>
          </div>
        </div>
      ))}
    </div>
  );

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-md)' }}>
      <div className="hp-plate" style={{ padding: 'var(--space-md)' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-xs)', marginBottom: 'var(--space-sm)' }}>
          <FileText size={18} />
          <h2 style={{ margin: 0, fontSize: 'var(--text-section)' }}>{t('Yayın', 'Publication')}</h2>
        </div>
        <div className="hp-tabs">
          <button type="button" className={tab === 'draft' ? 'hp-tab is-active' : 'hp-tab'} onClick={() => setTab('draft')}>
            {t('APA taslağı', 'APA draft')}
          </button>
          <button type="button" className={tab === 'refs' ? 'hp-tab is-active' : 'hp-tab'} onClick={() => setTab('refs')}>
            {t('Kaynakça', 'References')}
          </button>
          <button type="button" className={tab === 'latex' ? 'hp-tab is-active' : 'hp-tab'} onClick={() => setTab('latex')}>
            LaTeX / Quarto
          </button>
          <button type="button" className={tab === 'office' ? 'hp-tab is-active' : 'hp-tab'} onClick={() => setTab('office')}>
            Word ve Excel
          </button>
        </div>
        {history.length > 0 && (
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 'var(--space-2xs)', marginTop: 'var(--space-sm)' }}>
            {history.map((a) => (
              <span key={a.id} className="hp-badge">
                <span>{a.title}</span>
                {onRemoveAnalysis && (
                  <button
                    type="button"
                    aria-label={t(`${a.title} analizini çıkar`, `Remove ${a.title}`)}
                    onClick={() => onRemoveAnalysis(a.id)}
                    style={{
                      background: 'none',
                      border: 0,
                      padding: 0,
                      display: 'inline-flex',
                      alignItems: 'center',
                      cursor: 'pointer',
                      color: 'inherit',
                    }}
                  >
                    <X size={12} />
                  </button>
                )}
              </span>
            ))}
          </div>
        )}
        {(errorMsg || (tab === 'draft' && draft.error) || (tab === 'latex' && latex.error)) && (
          <div className="hp-badge hp-badge-err" style={{ whiteSpace: 'normal', marginTop: 'var(--space-xs)' }}>
            {errorMsg || (tab === 'draft' ? draft.error : latex.error)}
          </div>
        )}
      </div>

      {!history.length && tab !== 'refs' ? (
        <div className="hp-plate-flat" style={{ padding: 'var(--space-xl)', textAlign: 'center' }}>
          <Sigma size={26} style={{ color: 'var(--color-accent)' }} />
          <div style={{ fontWeight: 700, marginTop: 'var(--space-xs)' }}>{t('Henüz analiz yok', 'No analyses yet')}</div>
          <p style={{ color: 'var(--color-muted)', margin: 'var(--space-xs) auto 0' }}>
            {t('Taslak, çalıştırdığınız analizlerden oluşturulur.', 'The draft is built from the analyses you run.')}
          </p>
        </div>
      ) : (
        <>
          {tab === 'draft' && manuscript && (
            <div className="hp-grid-2">
              <div className="hp-plate" style={{ padding: 'var(--space-md)' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  <h3 style={{ margin: 0, fontSize: 'var(--text-title)' }}>{t('Yöntem', 'Method')}</h3>
                  <button type="button" className="hp-btn hp-btn-sm" onClick={() => copy(manuscript.methodsText)}>
                    <Copy size={12} />
                  </button>
                </div>
                <p style={{ whiteSpace: 'pre-wrap', lineHeight: 1.6, fontSize: 'var(--text-sm)' }}>{manuscript.methodsText}</p>
              </div>
              <div className="hp-plate" style={{ padding: 'var(--space-md)' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  <h3 style={{ margin: 0, fontSize: 'var(--text-title)' }}>{t('Bulgular', 'Results')}</h3>
                  <button type="button" className="hp-btn hp-btn-sm" onClick={() => copy(manuscript.resultsText)}>
                    <Copy size={12} />
                  </button>
                </div>
                <p style={{ whiteSpace: 'pre-wrap', lineHeight: 1.6, fontSize: 'var(--text-sm)' }}>{manuscript.resultsText}</p>
              </div>
              <div className="hp-plate" style={{ padding: 'var(--space-md)', gridColumn: '1 / -1' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 'var(--space-xs)' }}>
                  <h3 style={{ margin: 0, fontSize: 'var(--text-title)' }}>{t('Tam metin (Markdown)', 'Full text (Markdown)')}</h3>
                  <button type="button" className="hp-btn hp-btn-sm" onClick={() => downloadBytes(manuscript.fullMarkdown, 'hypotheca_manuscript.md', 'text/markdown')}>
                    <Download size={12} />
                    <span>.md</span>
                  </button>
                </div>
                <pre className="hp-code-block" style={{ maxHeight: 360, overflow: 'auto' }}>{manuscript.fullMarkdown}</pre>
              </div>
            </div>
          )}

          {tab === 'refs' && (
            <div className="hp-grid-2">
              <div className="hp-plate" style={{ padding: 'var(--space-md)' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-xs)', marginBottom: 'var(--space-sm)' }}>
                  <BookOpen size={16} />
                  <h3 style={{ margin: 0, fontSize: 'var(--text-title)' }}>{t('Analizlerinize uygun kaynaklar', 'References for your analyses')}</h3>
                </div>
                {matchedRefs.length ? refList(matchedRefs) : <div style={{ color: 'var(--color-muted)' }}>{t('Eşleşen kaynak yok.', 'No matched references.')}</div>}
              </div>
              <div className="hp-plate" style={{ padding: 'var(--space-md)' }}>
                <label className="hp-label">{t('Kaynak veya DOI ara', 'Search reference or DOI')}</label>
                <div style={{ display: 'flex', gap: 'var(--space-xs)', marginBottom: 'var(--space-sm)' }}>
                  <input className="hp-input" value={query} onChange={(e) => setQuery(e.target.value)} placeholder={t('Yazar, başlık veya DOI', 'Author, title or DOI')} />
                  <button type="button" className="hp-btn" disabled={!query || searching} onClick={() => void runSearch(false)}>
                    <Search size={14} />
                  </button>
                  <button type="button" className="hp-btn hp-btn-accent" disabled={!query || searching} onClick={() => void runSearch(true)}>
                    CrossRef
                  </button>
                </div>
                {searching && <div className="hp-skeleton" style={{ height: 64 }} />}
                {searchResults && !searching && (searchResults.length ? refList(searchResults) : <div style={{ color: 'var(--color-muted)' }}>{t('Sonuç yok.', 'No results.')}</div>)}
              </div>
            </div>
          )}

          {tab === 'latex' && (
            <div className="hp-plate" style={{ padding: 'var(--space-md)' }}>
              <div style={{ display: 'flex', gap: 'var(--space-xs)', marginBottom: 'var(--space-sm)', flexWrap: 'wrap' }}>
                <button type="button" className={latexMode === 'tex' ? 'hp-btn hp-btn-sm hp-btn-accent' : 'hp-btn hp-btn-sm'} onClick={() => setLatexMode('tex')}>
                  LaTeX (.tex)
                </button>
                <button type="button" className={latexMode === 'qmd' ? 'hp-btn hp-btn-sm hp-btn-accent' : 'hp-btn hp-btn-sm'} onClick={() => setLatexMode('qmd')}>
                  Quarto (.qmd)
                </button>
                <button type="button" className="hp-btn hp-btn-sm" onClick={() => copy(latexSource)}>
                  <Copy size={12} />
                </button>
                <button
                  type="button"
                  className="hp-btn hp-btn-sm hp-btn-primary"
                  onClick={() => downloadBytes(latexSource, latexMode === 'tex' ? 'hypotheca_tables.tex' : 'hypotheca_manuscript.qmd', 'text/plain')}
                >
                  <Download size={12} />
                  <span>{latexMode === 'tex' ? '.tex' : '.qmd'}</span>
                </button>
              </div>
              <pre className="hp-code-block" style={{ maxHeight: 520, overflow: 'auto' }}>{latexSource}</pre>
            </div>
          )}

          {tab === 'office' && (
            <div className="hp-grid-2">
              <div className="hp-plate" style={{ padding: 'var(--space-md)' }}>
                <h3 style={{ marginTop: 0, fontSize: 'var(--text-title)' }}>Word (.docx)</h3>
                <button type="button" className="hp-btn hp-btn-primary" disabled={busy !== null} onClick={() => void handleDocx()}>
                  <Download size={14} />
                  <span>{busy === 'docx' ? t('Hazırlanıyor...', 'Preparing...') : t('Word indir', 'Download Word')}</span>
                </button>
              </div>
              <div className="hp-plate" style={{ padding: 'var(--space-md)' }}>
                <h3 style={{ marginTop: 0, fontSize: 'var(--text-title)' }}>Excel (.xlsx)</h3>
                <button type="button" className="hp-btn hp-btn-primary" disabled={busy !== null} onClick={handleXlsx}>
                  <Download size={14} />
                  <span>{t('Excel indir', 'Download Excel')}</span>
                </button>
              </div>
            </div>
          )}
        </>
      )}
    </div>
  );
};

export default PublicationStudioPage;

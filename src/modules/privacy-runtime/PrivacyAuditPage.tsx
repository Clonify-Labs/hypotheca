import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  AlertTriangle,
  Check,
  Copy,
  Cpu,
  Database,
  Download,
  FileKey,
  FolderOpen,
  Play,
  Server,
  ShieldCheck,
  Trash2,
  Unlock,
} from 'lucide-react';
import { AnalysisOutput, Dataset, Lang } from '../../types/interfaces';
import { errorMessage } from '../../components/errorMessage';
import {
  EncryptedExportEnvelope,
  decryptDatasetEnvelope,
  deleteVaultDataset,
  encryptDatasetEnvelope,
  listVaultDatasets,
  saveDatasetToVault,
} from './localVault';
import {
  ONPREM_COMPOSE_YML,
  ONPREM_DOCKERFILE,
  ONPREM_NGINX_CONF,
} from './onprem/onpremConfigs';
import {
  WorkerDispatchResult,
  executeInPrivacyWorker,
  getRuntimePrivacyAudit,
} from './statsWorkerClient';

export interface PrivacyAuditPageProps {
  dataset: Dataset;
  datasets: Dataset[];
  onSelectDataset?: (ds: Dataset) => void;
  onImportDataset?: (ds: Dataset) => void;
  lang: Lang;
}

type BenchmarkOp = 'normality' | 'efa' | 'descriptives';
type OnpremTab = 'dockerfile' | 'nginx' | 'compose';

const COPY_TR = {
  title: 'Gizlilik ve yerel depo',
  kpiEgress: 'Ağ çıkışı',
  kpiWorker: 'Arka plan hesaplama',
  kpiCrypto: 'Şifreleme',
  valNone: 'Yok',
  valOn: 'Açık',
  valOff: 'Kapalı',
  valAvailable: 'Kullanılabilir',
  valUnavailable: 'Kullanılamaz',
  matrixTitle: 'Gizlilik kontrolleri',
  colControl: 'Kontrol',
  colStatus: 'Durum',
  statusActive: 'Etkin',
  statusVerified: 'Doğrulandı',
  benchTitle: 'Hız testi',
  benchWorkload: 'Analiz',
  benchRun: 'Testi çalıştır',
  benchRunning: 'Hesaplanıyor...',
  benchLatency: 'Süre',
  benchMode: 'Çalışma şekli',
  benchModeWorker: 'Arka planda',
  benchModeFallback: 'Doğrudan',
  benchResultTitle: 'Sonuç',
  vaultTitle: 'Yerel depo',
  vaultSaveBtn: 'Aktif veri setini kaydet',
  vaultEmpty: 'Kayıtlı veri seti yok.',
  vaultColName: 'Veri seti',
  vaultColRows: 'Satır',
  vaultColCols: 'Sütun',
  vaultColActions: 'İşlemler',
  vaultLoad: 'Aç',
  vaultDelete: 'Sil',
  cryptoTitle: 'Şifreli dışa ve içe aktarma',
  exportPassLabel: 'Parola',
  exportPassPlaceholder: 'Parola girin',
  exportBtn: 'Şifrele ve indir',
  importFileLabel: 'Şifreli dosya (.hpvault.json)',
  importPassLabel: 'Parola',
  importPassPlaceholder: 'Parola girin',
  importBtn: 'Çöz ve içe aktar',
  onpremTitle: 'Kurum içi kurulum',
  copyBtn: 'Kopyala',
  copiedBtn: 'Kopyalandı',
};

const COPY_EN = {
  title: 'Privacy and local storage',
  kpiEgress: 'Network egress',
  kpiWorker: 'Background computation',
  kpiCrypto: 'Encryption',
  valNone: 'None',
  valOn: 'On',
  valOff: 'Off',
  valAvailable: 'Available',
  valUnavailable: 'Unavailable',
  matrixTitle: 'Privacy checks',
  colControl: 'Check',
  colStatus: 'Status',
  statusActive: 'Active',
  statusVerified: 'Verified',
  benchTitle: 'Speed test',
  benchWorkload: 'Analysis',
  benchRun: 'Run test',
  benchRunning: 'Computing...',
  benchLatency: 'Time',
  benchMode: 'Mode',
  benchModeWorker: 'Background',
  benchModeFallback: 'Direct',
  benchResultTitle: 'Result',
  vaultTitle: 'Local storage',
  vaultSaveBtn: 'Save active dataset',
  vaultEmpty: 'No saved datasets.',
  vaultColName: 'Dataset',
  vaultColRows: 'Rows',
  vaultColCols: 'Cols',
  vaultColActions: 'Actions',
  vaultLoad: 'Open',
  vaultDelete: 'Delete',
  cryptoTitle: 'Encrypted export and import',
  exportPassLabel: 'Password',
  exportPassPlaceholder: 'Enter password',
  exportBtn: 'Encrypt and download',
  importFileLabel: 'Encrypted file (.hpvault.json)',
  importPassLabel: 'Password',
  importPassPlaceholder: 'Enter password',
  importBtn: 'Decrypt and import',
  onpremTitle: 'On-premise deployment',
  copyBtn: 'Copy',
  copiedBtn: 'Copied',
};

function downloadJsonFile(filename: string, data: unknown): void {
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = filename;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  URL.revokeObjectURL(url);
}

export function PrivacyAuditPage({
  dataset,
  onSelectDataset,
  onImportDataset,
  lang,
}: PrivacyAuditPageProps): React.ReactElement {
  const t = lang === 'tr' ? COPY_TR : COPY_EN;
  const audit = useMemo(() => getRuntimePrivacyAudit(), []);

  // Benchmark state
  const [benchOp, setBenchOp] = useState<BenchmarkOp>('normality');
  const [benchBusy, setBenchBusy] = useState(false);
  const [benchResult, setBenchResult] = useState<WorkerDispatchResult | null>(null);
  const [benchError, setBenchError] = useState<string | null>(null);

  // Local Vault state
  const [vaultDatasets, setVaultDatasets] = useState<Dataset[]>([]);
  const [vaultNotice, setVaultNotice] = useState<{ ok: boolean; text: string } | null>(null);
  const [vaultBusy, setVaultBusy] = useState(false);

  // Encrypted Export/Import state
  const [exportPass, setExportPass] = useState('');
  const [exportMeta, setExportMeta] = useState<{
    filename: string;
    bytes: number;
    createdAt: string;
  } | null>(null);
  const [importPass, setImportPass] = useState('');
  const [importRawJson, setImportRawJson] = useState<string | null>(null);
  const [importFileName, setImportFileName] = useState<string>('');
  const [cryptoStatus, setCryptoStatus] = useState<{ ok: boolean; text: string } | null>(null);
  const [cryptoBusy, setCryptoBusy] = useState(false);

  // On-Premise Config preview state
  const [onpremTab, setOnpremTab] = useState<OnpremTab>('dockerfile');
  const [copiedTab, setCopiedTab] = useState<OnpremTab | null>(null);

  const numericCols = useMemo(
    () => dataset.columns.filter((c) => c.valueType === 'numeric').map((c) => c.name),
    [dataset.columns],
  );

  const refreshVault = useCallback(async () => {
    try {
      const items = await listVaultDatasets();
      setVaultDatasets(items);
    } catch (err) {
      setVaultNotice({
        ok: false,
        text: errorMessage(err, lang),
      });
    }
  }, []);

  useEffect(() => {
    void refreshVault();
  }, [refreshVault]);

  const handleRunBenchmark = async () => {
    setBenchBusy(true);
    setBenchError(null);
    try {
      if (numericCols.length === 0) {
        throw new Error(
          lang === 'tr'
            ? 'En az bir sayısal sütun gerekli.'
            : 'At least one numeric column is required.',
        );
      }
      let opToRun: string = benchOp;
      let vars = numericCols.slice(0, 6);
      if (benchOp === 'efa' && numericCols.length < 3) {
        opToRun = 'normality';
        vars = numericCols;
      }
      const payload: Record<string, unknown> =
        opToRun === 'efa'
          ? { dataset, items: vars, rotation: 'varimax', extraction: 'pca' }
          : { dataset, variables: vars };

      const res = await executeInPrivacyWorker(opToRun, payload);
      setBenchResult(res);
    } catch (err) {
      setBenchError(errorMessage(err, lang));
    } finally {
      setBenchBusy(false);
    }
  };

  const handleSaveToVault = async () => {
    setVaultBusy(true);
    setVaultNotice(null);
    try {
      await saveDatasetToVault(dataset);
      await refreshVault();
      setVaultNotice({
        ok: true,
        text:
          lang === 'tr'
            ? `"${dataset.name}" kaydedildi.`
            : `"${dataset.name}" saved.`,
      });
    } catch (err) {
      setVaultNotice({
        ok: false,
        text: errorMessage(err, lang),
      });
    } finally {
      setVaultBusy(false);
    }
  };

  const handleDeleteFromVault = async (id: string, name: string) => {
    setVaultBusy(true);
    setVaultNotice(null);
    try {
      await deleteVaultDataset(id);
      await refreshVault();
      setVaultNotice({
        ok: true,
        text:
          lang === 'tr'
            ? `"${name}" silindi.`
            : `"${name}" deleted.`,
      });
    } catch (err) {
      setVaultNotice({
        ok: false,
        text: errorMessage(err, lang),
      });
    } finally {
      setVaultBusy(false);
    }
  };

  const handleLoadFromVault = (ds: Dataset) => {
    if (onSelectDataset) {
      onSelectDataset(ds);
    } else if (onImportDataset) {
      onImportDataset(ds);
    }
    setVaultNotice({
      ok: true,
      text:
        lang === 'tr'
          ? `"${ds.name}" açıldı.`
          : `"${ds.name}" opened.`,
    });
  };

  const handleEncryptExport = async () => {
    setCryptoBusy(true);
    setCryptoStatus(null);
    try {
      const envelope = await encryptDatasetEnvelope(dataset, exportPass);
      const safeStem = dataset.name.replace(/\.[^.]+$/, '').replace(/[^a-zA-Z0-9_-]+/g, '_') || 'dataset';
      const filename = `${safeStem}.hpvault.json`;
      const serialized = JSON.stringify(envelope, null, 2);
      if (typeof document !== 'undefined' && typeof URL.createObjectURL === 'function') {
        downloadJsonFile(filename, envelope);
      }
      setExportMeta({
        filename,
        bytes: serialized.length,
        createdAt: envelope.createdAt,
      });
      setCryptoStatus({
        ok: true,
        text:
          lang === 'tr'
            ? `${filename} indirildi.`
            : `${filename} downloaded.`,
      });
    } catch (err) {
      setCryptoStatus({
        ok: false,
        text: errorMessage(err, lang),
      });
    } finally {
      setCryptoBusy(false);
    }
  };

  const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) {
      setImportRawJson(null);
      setImportFileName('');
      return;
    }
    setImportFileName(file.name);
    const content = await file.text();
    setImportRawJson(content);
    setCryptoStatus(null);
  };

  const handleDecryptImport = async () => {
    setCryptoBusy(true);
    setCryptoStatus(null);
    try {
      if (!importRawJson) {
        throw new Error(
          lang === 'tr'
            ? 'Önce bir dosya seçin.'
            : 'Select a file first.',
        );
      }
      const parsed = JSON.parse(importRawJson) as EncryptedExportEnvelope;
      const decrypted = await decryptDatasetEnvelope(parsed, importPass);
      if (onImportDataset) {
        onImportDataset(decrypted);
      } else if (onSelectDataset) {
        onSelectDataset(decrypted);
      }
      setCryptoStatus({
        ok: true,
        text:
          lang === 'tr'
            ? `"${decrypted.name}" içe aktarıldı.`
            : `"${decrypted.name}" imported.`,
      });
      setImportPass('');
    } catch (err) {
      setCryptoStatus({
        ok: false,
        text: errorMessage(err, lang),
      });
    } finally {
      setCryptoBusy(false);
    }
  };

  const activeConfigText =
    onpremTab === 'dockerfile'
      ? ONPREM_DOCKERFILE
      : onpremTab === 'nginx'
        ? ONPREM_NGINX_CONF
        : ONPREM_COMPOSE_YML;

  const handleCopyConfig = async () => {
    if (typeof navigator !== 'undefined' && navigator.clipboard) {
      await navigator.clipboard.writeText(activeConfigText);
      setCopiedTab(onpremTab);
      setTimeout(() => setCopiedTab(null), 2000);
    }
  };

  const renderBenchSummary = (output: AnalysisOutput): string => {
    const narrative = lang === 'tr' ? output.narrativeTr : output.narrativeEn;
    if (narrative) return narrative;
    return `${output.title} (${output.tables.length} tables)`;
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-lg)' }}>
      <section className="hp-plate">
        <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-xs)' }}>
          <ShieldCheck size={20} />
          <h2>{t.title}</h2>
        </div>

        <div className="hp-grid-3" style={{ marginTop: 'var(--space-md)' }}>
          <div className="hp-plate-flat">
            <div className="hp-label">{t.kpiEgress}</div>
            <div className="hp-kpi-val">{audit.zeroNetworkEgress ? t.valNone : '?'}</div>
          </div>

          <div className="hp-plate-flat">
            <div className="hp-label">{t.kpiWorker}</div>
            <div className="hp-kpi-val">{audit.webWorkerAvailable ? t.valOn : t.valOff}</div>
          </div>

          <div className="hp-plate-flat">
            <div className="hp-label">{t.kpiCrypto}</div>
            <div className="hp-kpi-val">
              {audit.webCryptoAvailable ? t.valAvailable : t.valUnavailable}
            </div>
          </div>
        </div>
      </section>

      <section className="hp-plate">
        <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-xs)', marginBottom: 'var(--space-sm)' }}>
          <ShieldCheck size={18} />
          <h3>{t.matrixTitle}</h3>
        </div>
        <div className="hp-table-wrap">
          <table className="hp-table">
            <thead>
              <tr>
                <th>{t.colControl}</th>
                <th>{t.colStatus}</th>
              </tr>
            </thead>
            <tbody>
              {audit.complianceChecklist.map((item) => (
                <tr key={item.id}>
                  <td>{lang === 'tr' ? item.labelTr : item.labelEn}</td>
                  <td>
                    <span className={`hp-badge ${item.status === 'active' ? 'hp-badge-ok' : 'hp-badge-info'}`}>
                      <Check size={12} />
                      {item.status === 'active' ? t.statusActive : t.statusVerified}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <section className="hp-plate">
        <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-xs)', marginBottom: 'var(--space-md)' }}>
          <Cpu size={18} />
          <h3>{t.benchTitle}</h3>
        </div>

        <div
          style={{
            display: 'flex',
            flexWrap: 'wrap',
            alignItems: 'flex-end',
            gap: 'var(--space-md)',
          }}
        >
          <div style={{ minWidth: '240px', flex: '1 1 240px' }}>
            <label className="hp-label" htmlFor="hp-worker-bench-op">
              {t.benchWorkload}
            </label>
            <select
              id="hp-worker-bench-op"
              className="hp-select"
              value={benchOp}
              onChange={(e) => setBenchOp(e.target.value as BenchmarkOp)}
            >
              <option value="normality">
                {lang === 'tr' ? 'Normallik testi' : 'Normality test'}
              </option>
              <option value="efa">
                {lang === 'tr' ? 'Açımlayıcı faktör analizi' : 'Exploratory factor analysis'}
              </option>
              <option value="descriptives">
                {lang === 'tr' ? 'Tanımlayıcı istatistikler' : 'Descriptives'}
              </option>
            </select>
          </div>

          <button
            type="button"
            className="hp-btn hp-btn-primary"
            onClick={() => void handleRunBenchmark()}
            disabled={benchBusy}
          >
            <Play size={15} />
            {benchBusy ? t.benchRunning : t.benchRun}
          </button>
        </div>

        {benchError && (
          <div style={{ marginTop: 'var(--space-sm)' }}>
            <span className="hp-badge hp-badge-err">
              <AlertTriangle size={13} />
              {benchError}
            </span>
          </div>
        )}

        {benchResult && (
          <div className="hp-plate-flat" style={{ marginTop: 'var(--space-md)' }}>
            <div className="hp-grid-3">
              <div>
                <div className="hp-label">{t.benchLatency}</div>
                <div className="hp-kpi-val hp-mono">{benchResult.elapsedMs.toFixed(2)} ms</div>
              </div>
              <div>
                <div className="hp-label">{t.benchMode}</div>
                <div style={{ marginTop: 'var(--space-2xs)' }}>
                  <span
                    className={`hp-badge ${
                      benchResult.runtimeMode === 'web_worker' ? 'hp-badge-ok' : 'hp-badge-info'
                    }`}
                  >
                    {benchResult.runtimeMode === 'web_worker'
                      ? t.benchModeWorker
                      : t.benchModeFallback}
                  </span>
                </div>
              </div>
              <div>
                <div className="hp-label">{t.benchResultTitle}</div>
                <div className="hp-mono" style={{ fontSize: 'var(--text-sm)' }}>
                  {benchResult.output.title}
                </div>
              </div>
            </div>
            <p
              style={{
                marginTop: 'var(--space-sm)',
                fontSize: 'var(--text-sm)',
                color: 'var(--color-ink-2)',
              }}
            >
              {renderBenchSummary(benchResult.output)}
            </p>
          </div>
        )}
      </section>

      <div className="hp-grid-2">
        <section className="hp-plate">
          <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-xs)', marginBottom: 'var(--space-sm)' }}>
            <Database size={18} />
            <h3>{t.vaultTitle}</h3>
          </div>

          <div
            style={{
              display: 'flex',
              flexWrap: 'wrap',
              justifyContent: 'flex-end',
              alignItems: 'center',
              gap: 'var(--space-sm)',
              marginBottom: 'var(--space-md)',
            }}
          >
            <button
              type="button"
              className="hp-btn hp-btn-primary hp-btn-sm"
              onClick={() => void handleSaveToVault()}
              disabled={vaultBusy}
            >
              <Database size={14} />
              {t.vaultSaveBtn}
            </button>
          </div>

          {vaultNotice && (
            <div style={{ marginBottom: 'var(--space-sm)' }}>
              <span className={`hp-badge ${vaultNotice.ok ? 'hp-badge-ok' : 'hp-badge-err'}`}>
                {vaultNotice.ok ? <Check size={13} /> : <AlertTriangle size={13} />}
                {vaultNotice.text}
              </span>
            </div>
          )}

          {vaultDatasets.length === 0 ? (
            <div className="hp-plate-flat" style={{ color: 'var(--color-muted)', fontSize: 'var(--text-sm)' }}>
              {t.vaultEmpty}
            </div>
          ) : (
            <div className="hp-table-wrap">
              <table className="hp-table">
                <thead>
                  <tr>
                    <th>{t.vaultColName}</th>
                    <th className="num">{t.vaultColRows}</th>
                    <th className="num">{t.vaultColCols}</th>
                    <th>{t.vaultColActions}</th>
                  </tr>
                </thead>
                <tbody>
                  {vaultDatasets.map((ds) => (
                    <tr key={ds.id}>
                      <td>{ds.name}</td>
                      <td className="num">{ds.rows.length}</td>
                      <td className="num">{ds.columns.length}</td>
                      <td>
                        <div style={{ display: 'flex', gap: 'var(--space-2xs)' }}>
                          <button
                            type="button"
                            className="hp-btn hp-btn-sm"
                            onClick={() => handleLoadFromVault(ds)}
                          >
                            <FolderOpen size={13} />
                            {t.vaultLoad}
                          </button>
                          <button
                            type="button"
                            className="hp-btn hp-btn-sm"
                            onClick={() => void handleDeleteFromVault(ds.id, ds.name)}
                            disabled={vaultBusy}
                          >
                            <Trash2 size={13} />
                            {t.vaultDelete}
                          </button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>

        <section className="hp-plate">
          <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-xs)', marginBottom: 'var(--space-md)' }}>
            <FileKey size={18} />
            <h3>{t.cryptoTitle}</h3>
          </div>

          {/* Export Box */}
          <div className="hp-plate-flat" style={{ marginBottom: 'var(--space-md)' }}>
            <label className="hp-label" htmlFor="hp-export-passphrase">
              {t.exportPassLabel}
            </label>
            <div style={{ display: 'flex', gap: 'var(--space-xs)', flexWrap: 'wrap' }}>
              <div style={{ flex: '1 1 200px' }}>
                <input
                  id="hp-export-passphrase"
                  type="password"
                  className="hp-input"
                  value={exportPass}
                  onChange={(e) => setExportPass(e.target.value)}
                  placeholder={t.exportPassPlaceholder}
                />
              </div>
              <button
                type="button"
                className="hp-btn hp-btn-accent hp-btn-sm"
                onClick={() => void handleEncryptExport()}
                disabled={cryptoBusy || !exportPass}
              >
                <Download size={14} />
                {t.exportBtn}
              </button>
            </div>
            {exportMeta && (
              <div
                className="hp-mono"
                style={{
                  marginTop: 'var(--space-xs)',
                  fontSize: 'var(--text-xs)',
                  color: 'var(--color-muted)',
                }}
              >
                {exportMeta.filename}, {(exportMeta.bytes / 1024).toFixed(1)} KB
              </div>
            )}
          </div>

          {/* Import Box */}
          <div className="hp-plate-flat">
            <div style={{ marginBottom: 'var(--space-sm)' }}>
              <label className="hp-label" htmlFor="hp-import-vault-file">
                {t.importFileLabel}
              </label>
              <input
                id="hp-import-vault-file"
                type="file"
                accept=".hpvault.json,.json,application/json"
                className="hp-input"
                onChange={(e) => void handleFileChange(e)}
              />
              {importFileName && (
                <div
                  className="hp-mono"
                  style={{
                    marginTop: 'var(--space-2xs)',
                    fontSize: 'var(--text-xs)',
                    color: 'var(--color-ink-2)',
                  }}
                >
                  {importFileName}
                </div>
              )}
            </div>

            <label className="hp-label" htmlFor="hp-import-passphrase">
              {t.importPassLabel}
            </label>
            <div style={{ display: 'flex', gap: 'var(--space-xs)', flexWrap: 'wrap' }}>
              <div style={{ flex: '1 1 200px' }}>
                <input
                  id="hp-import-passphrase"
                  type="password"
                  className="hp-input"
                  value={importPass}
                  onChange={(e) => setImportPass(e.target.value)}
                  placeholder={t.importPassPlaceholder}
                />
              </div>
              <button
                type="button"
                className="hp-btn hp-btn-primary hp-btn-sm"
                onClick={() => void handleDecryptImport()}
                disabled={cryptoBusy || !importRawJson || !importPass}
              >
                <Unlock size={14} />
                {t.importBtn}
              </button>
            </div>
          </div>

          {cryptoStatus && (
            <div style={{ marginTop: 'var(--space-sm)' }}>
              <span className={`hp-badge ${cryptoStatus.ok ? 'hp-badge-ok' : 'hp-badge-err'}`}>
                {cryptoStatus.ok ? <Check size={13} /> : <AlertTriangle size={13} />}
                {cryptoStatus.text}
              </span>
            </div>
          )}
        </section>
      </div>

      <section className="hp-plate">
        <div
          style={{
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
            flexWrap: 'wrap',
            gap: 'var(--space-sm)',
            marginBottom: 'var(--space-md)',
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-xs)' }}>
            <Server size={18} />
            <h3>{t.onpremTitle}</h3>
          </div>
          <button type="button" className="hp-btn hp-btn-sm" onClick={() => void handleCopyConfig()}>
            {copiedTab === onpremTab ? <Check size={14} /> : <Copy size={14} />}
            {copiedTab === onpremTab ? t.copiedBtn : t.copyBtn}
          </button>
        </div>

        <div className="hp-tabs">
          <button
            type="button"
            className={`hp-tab ${onpremTab === 'dockerfile' ? 'is-active' : ''}`}
            onClick={() => setOnpremTab('dockerfile')}
          >
            Dockerfile
          </button>
          <button
            type="button"
            className={`hp-tab ${onpremTab === 'nginx' ? 'is-active' : ''}`}
            onClick={() => setOnpremTab('nginx')}
          >
            nginx.conf
          </button>
          <button
            type="button"
            className={`hp-tab ${onpremTab === 'compose' ? 'is-active' : ''}`}
            onClick={() => setOnpremTab('compose')}
          >
            docker-compose.yml
          </button>
        </div>

        <pre className="hp-code-block">{activeConfigText}</pre>
      </section>
    </div>
  );
}

export default PrivacyAuditPage;

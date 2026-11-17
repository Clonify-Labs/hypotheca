import React, { useMemo, useRef, useState } from 'react';
import * as XLSX from 'xlsx';
import { AlertTriangle, FileSpreadsheet, Trash2, Upload } from 'lucide-react';
import { DataRow, Dataset, Lang } from '../types/interfaces';
import { ImportError, MAX_IMPORT_BYTES, inferAndCoerce, normalizeSheetRows, parseDelimitedText } from '../data/importers';

export interface DataBenchPageProps {
  dataset: Dataset | null;
  seedDatasets: Dataset[];
  userDatasets: Dataset[];
  onSelectDataset: (ds: Dataset) => void;
  onAddDataset: (ds: Dataset) => void;
  onDeleteDataset: (id: string) => void;
  lang: Lang;
}

const PAGE_SIZE = 15;
const TYPE_LABEL: Record<string, { tr: string; en: string }> = {
  numeric: { tr: 'Sayısal', en: 'Numeric' },
  categorical: { tr: 'Kategorik', en: 'Categorical' },
  string: { tr: 'Metin', en: 'Text' },
  boolean: { tr: 'İkili', en: 'Binary' },
};
const SCALE_LABEL: Record<string, { tr: string; en: string }> = {
  scale: { tr: 'Sürekli', en: 'Scale' },
  ordinal: { tr: 'Sıralı', en: 'Ordinal' },
  nominal: { tr: 'Sınıflama', en: 'Nominal' },
};

export const DataBenchPage: React.FC<DataBenchPageProps> = ({
  dataset,
  seedDatasets,
  userDatasets,
  onSelectDataset,
  onAddDataset,
  onDeleteDataset,
  lang,
}) => {
  const tr = lang === 'tr';
  const [page, setPage] = useState(0);
  const [busy, setBusy] = useState(false);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const [warnings, setWarnings] = useState<string[]>([]);
  const fileRef = useRef<HTMLInputElement>(null);

  const rows = dataset?.rows ?? [];
  const columns = dataset?.columns ?? [];
  const totalPages = Math.max(1, Math.ceil(rows.length / PAGE_SIZE));
  const safePage = Math.min(page, totalPages - 1);
  const visibleRows = useMemo(() => rows.slice(safePage * PAGE_SIZE, (safePage + 1) * PAGE_SIZE), [rows, safePage]);

  const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    setUploadError(null);
    setWarnings([]);
    const name = file.name.toLowerCase();
    if (!/\.(csv|tsv|txt|xlsx|xls|ods)$/.test(name)) {
      setUploadError(tr ? 'Desteklenen biçimler: CSV, TSV, TXT, XLSX, XLS, ODS.' : 'Supported formats: CSV, TSV, TXT, XLSX, XLS, ODS.');
      return;
    }
    if (file.size === 0) {
      setUploadError(tr ? 'Dosya boş.' : 'The file is empty.');
      return;
    }
    if (file.size > MAX_IMPORT_BYTES) {
      setUploadError(tr ? 'Dosya 50 MB sınırını aşıyor.' : 'The file exceeds the 50 MB limit.');
      return;
    }
    setBusy(true);
    try {
      let parsed: { rows: DataRow[]; warnings: string[] };
      if (/\.(xlsx|xls|ods)$/.test(name)) {
        const wb = XLSX.read(await file.arrayBuffer(), { type: 'array', cellDates: true });
        const sheetName = wb.SheetNames.find((n) => {
          const ref = wb.Sheets[n]?.['!ref'];
          return !!ref;
        });
        if (!sheetName) throw new ImportError('no_sheet', 'Çalışma kitabında dolu sayfa yok.', 'The workbook has no non-empty sheet.');
        const matrix = XLSX.utils.sheet_to_json<unknown[]>(wb.Sheets[sheetName], { header: 1, defval: null, raw: true });
        parsed = normalizeSheetRows(matrix);
        if (wb.SheetNames.length > 1) parsed.warnings.unshift(tr ? `Yalnızca "${sheetName}" sayfası alındı.` : `Only sheet "${sheetName}" was imported.`);
      } else {
        parsed = parseDelimitedText(await file.text());
      }
      const { columns: cols, rows: clean, warnings: w } = inferAndCoerce(parsed.rows);
      if (!clean.length || !cols.length) throw new ImportError('no_rows', 'Dosyada geçerli satır bulunamadı.', 'No valid rows found in the file.');
      const baseName = file.name.replace(/\.[^.]+$/, '') || file.name;
      const taken = new Set([...seedDatasets, ...userDatasets].map((d) => d.name));
      let dsName = file.name;
      for (let i = 2; taken.has(dsName); i++) dsName = `${baseName} (${i})${file.name.slice(baseName.length)}`;
      onAddDataset({
        id: `ds-upload-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`,
        name: dsName,
        columns: cols,
        rows: clean,
        createdAt: new Date().toISOString(),
      });
      setWarnings([...parsed.warnings, ...w].slice(0, 12));
      setPage(0);
    } catch (err) {
      const ie = err as Partial<ImportError>;
      setUploadError(ie.messageTr ? (tr ? ie.messageTr : ie.messageEn ?? ie.messageTr) : tr ? 'Dosya okunamadı. Biçimi ve kodlamayı (UTF-8) kontrol edin.' : 'Could not read the file. Check the format and encoding (UTF-8).');
    } finally {
      setBusy(false);
    }
  };

  const renderList = (list: Dataset[], deletable: boolean) => (
    <div className="hp-grid-2">
      {list.map((ds) => {
        const active = ds.id === dataset?.id;
        return (
          <div
            key={ds.id}
            className="hp-plate-flat"
            style={{
              padding: 'var(--space-sm) var(--space-md)',
              borderColor: active ? 'var(--color-accent)' : 'var(--color-rule)',
              background: active ? 'var(--color-accent-soft)' : 'var(--color-plate)',
              display: 'flex',
              justifyContent: 'space-between',
              alignItems: 'center',
              gap: 'var(--space-sm)',
            }}
          >
            <div style={{ minWidth: 0 }}>
              <div style={{ fontWeight: 600, display: 'flex', alignItems: 'center', gap: 'var(--space-xs)', overflowWrap: 'anywhere' }}>
                <FileSpreadsheet size={15} style={{ flex: 'none' }} />
                <span>{ds.name}</span>
              </div>
              <div style={{ fontSize: 'var(--text-xs)', color: 'var(--color-muted)', marginTop: 'var(--space-3xs)' }}>
                {ds.description ? `${ds.description} ` : ''}
                {tr ? `${ds.rows.length} gözlem, ${ds.columns.length} değişken` : `${ds.rows.length} rows, ${ds.columns.length} variables`}
              </div>
            </div>
            <div style={{ display: 'flex', gap: 'var(--space-2xs)', flex: 'none' }}>
              {deletable && !active && (
                <button type="button" className="hp-btn hp-btn-sm hp-btn-ghost" aria-label={tr ? 'Veri setini sil' : 'Delete dataset'} onClick={() => onDeleteDataset(ds.id)}>
                  <Trash2 size={14} />
                </button>
              )}
              <button
                type="button"
                className={active ? 'hp-btn hp-btn-sm hp-btn-accent' : 'hp-btn hp-btn-sm'}
                disabled={active}
                onClick={() => {
                  onSelectDataset(ds);
                  setPage(0);
                }}
              >
                {active ? (tr ? 'Seçili' : 'Selected') : tr ? 'Seç' : 'Select'}
              </button>
            </div>
          </div>
        );
      })}
    </div>
  );

  const unusable = columns.filter((c) => c.uniqueCount <= 1);
  const totalMissing = columns.reduce((s, c) => s + c.missingCount, 0);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-lg)' }}>
      <div className="hp-plate" style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-md)' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 'var(--space-md)', flexWrap: 'wrap' }}>
          <h3 style={{ fontSize: 'var(--text-lg)' }}>{tr ? 'Kendi verim' : 'My data'}</h3>
          <button type="button" className="hp-btn hp-btn-primary" disabled={busy} onClick={() => fileRef.current?.click()}>
            <Upload size={16} />
            {busy ? (tr ? 'Okunuyor...' : 'Reading...') : tr ? 'Dosya yükle' : 'Upload file'}
          </button>
          <input ref={fileRef} type="file" accept=".csv,.tsv,.txt,.xlsx,.xls,.ods" onChange={handleFileUpload} style={{ display: 'none' }} />
        </div>
        {uploadError && (
          <div className="hp-alert" role="alert">
            <AlertTriangle size={16} style={{ flex: 'none' }} />
            <span>{uploadError}</span>
          </div>
        )}
        {warnings.length > 0 && (
          <div className="hp-alert hp-alert-warn" role="status">
            <AlertTriangle size={16} style={{ flex: 'none' }} />
            <ul style={{ margin: 0, paddingLeft: 'var(--space-md)' }}>
              {warnings.map((w, i) => (
                <li key={i}>{w}</li>
              ))}
            </ul>
          </div>
        )}
        {userDatasets.length > 0 ? (
          renderList(userDatasets, true)
        ) : (
          <p style={{ color: 'var(--color-muted)', fontSize: 'var(--text-sm)' }}>
            {tr ? 'CSV, TSV veya Excel dosyası yükleyin. İlk satır değişken adları olmalı.' : 'Upload a CSV, TSV or Excel file. The first row must contain variable names.'}
          </p>
        )}
        <h3 style={{ fontSize: 'var(--text-md)', marginTop: 'var(--space-xs)' }}>{tr ? 'Örnek veri setleri' : 'Sample datasets'}</h3>
        {renderList(seedDatasets, false)}
      </div>

      {dataset && (
        <>
          <div className="hp-plate">
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', gap: 'var(--space-sm)', flexWrap: 'wrap', marginBottom: 'var(--space-sm)' }}>
              <h3 style={{ fontSize: 'var(--text-lg)' }}>{tr ? 'Değişkenler' : 'Variables'}</h3>
              <span style={{ fontSize: 'var(--text-sm)', color: 'var(--color-muted)' }}>
                {tr ? `N = ${rows.length}, ${columns.length} değişken, ${totalMissing} eksik hücre` : `N = ${rows.length}, ${columns.length} variables, ${totalMissing} missing cells`}
              </span>
            </div>
            {unusable.length > 0 && (
              <div className="hp-alert hp-alert-warn" style={{ marginBottom: 'var(--space-sm)' }}>
                {tr
                  ? `Sabit veya boş değişkenler analizlerde kullanılamaz: ${unusable.map((c) => c.name).join(', ')}`
                  : `Constant or empty variables cannot be analysed: ${unusable.map((c) => c.name).join(', ')}`}
              </div>
            )}
            {rows.length < 10 && (
              <div className="hp-alert hp-alert-warn" style={{ marginBottom: 'var(--space-sm)' }}>
                {tr ? 'Gözlem sayısı çok düşük; çoğu test anlamlı sonuç vermez.' : 'Very few observations; most tests will not be meaningful.'}
              </div>
            )}
            <div className="hp-table-wrap">
              <table className="hp-table">
                <thead>
                  <tr>
                    <th>{tr ? 'Değişken' : 'Variable'}</th>
                    <th>{tr ? 'Tür' : 'Type'}</th>
                    <th>{tr ? 'Ölçek' : 'Scale'}</th>
                    <th className="num">{tr ? 'Farklı değer' : 'Distinct'}</th>
                    <th className="num">{tr ? 'Eksik' : 'Missing'}</th>
                  </tr>
                </thead>
                <tbody>
                  {columns.map((c) => (
                    <tr key={c.name}>
                      <td className="hp-mono">{c.name}</td>
                      <td>{TYPE_LABEL[c.valueType]?.[lang] ?? c.valueType}</td>
                      <td>{SCALE_LABEL[c.scale]?.[lang] ?? c.scale}</td>
                      <td className="num">{c.uniqueCount}</td>
                      <td className="num">
                        {c.missingCount}
                        {rows.length > 0 && c.missingCount > 0 ? ` (${((100 * c.missingCount) / rows.length).toFixed(0)}%)` : ''}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          <div className="hp-plate">
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 'var(--space-sm)', flexWrap: 'wrap', gap: 'var(--space-sm)' }}>
              <h3 style={{ fontSize: 'var(--text-lg)' }}>{tr ? 'Veri görünümü' : 'Data view'}</h3>
              {rows.length > PAGE_SIZE && (
                <div style={{ display: 'flex', gap: 'var(--space-xs)', alignItems: 'center' }}>
                  <button type="button" className="hp-btn hp-btn-sm" disabled={safePage === 0} onClick={() => setPage(Math.max(0, safePage - 1))}>
                    {tr ? 'Önceki' : 'Prev'}
                  </button>
                  <span className="hp-mono" style={{ fontSize: 'var(--text-xs)' }}>
                    {safePage + 1} / {totalPages}
                  </span>
                  <button type="button" className="hp-btn hp-btn-sm" disabled={safePage >= totalPages - 1} onClick={() => setPage(Math.min(totalPages - 1, safePage + 1))}>
                    {tr ? 'Sonraki' : 'Next'}
                  </button>
                </div>
              )}
            </div>
            {rows.length === 0 ? (
              <p style={{ color: 'var(--color-muted)' }}>{tr ? 'Bu veri setinde satır yok.' : 'This dataset has no rows.'}</p>
            ) : (
              <div className="hp-table-wrap">
                <table className="hp-table">
                  <thead>
                    <tr>
                      <th className="num">#</th>
                      {columns.map((c) => (
                        <th key={c.name} className={c.valueType === 'numeric' ? 'num' : undefined}>
                          {c.name}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {visibleRows.map((row, rIdx) => (
                      <tr key={rIdx}>
                        <td className="num">{safePage * PAGE_SIZE + rIdx + 1}</td>
                        {columns.map((c) => {
                          const val = row[c.name];
                          const missing = val === null || val === undefined || val === '';
                          const cls = [c.valueType === 'numeric' ? 'num' : '', missing ? 'is-missing' : ''].filter(Boolean).join(' ') || undefined;
                          return (
                            <td key={c.name} className={cls}>
                              {missing ? '.' : String(val)}
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
        </>
      )}
    </div>
  );
};

import React, { useState } from 'react';
import { Check, Copy, Download } from 'lucide-react';
import { Lang, StatTable } from '../types/interfaces';

export interface SpecTableProps {
  table: StatTable;
  lang?: Lang;
}

export const SpecTable: React.FC<SpecTableProps> = ({ table, lang = 'tr' }) => {
  const [copied, setCopied] = useState(false);

  const toTsv = (): string => {
    const header = table.columns.map((c) => c.label).join('\t');
    const lines = table.rows.map((r) =>
      table.columns.map((c) => (r[c.key] === null || r[c.key] === undefined ? '' : String(r[c.key]))).join('\t'),
    );
    return [header, ...lines].join('\n');
  };

  const toCsv = (): string => {
    const esc = (v: unknown) => {
      const s = v === null || v === undefined ? '' : String(v);
      return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
    };
    const header = table.columns.map((c) => esc(c.label)).join(',');
    const lines = table.rows.map((r) => table.columns.map((c) => esc(r[c.key])).join(','));
    return [header, ...lines].join('\n');
  };

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(toTsv());
      setCopied(true);
      setTimeout(() => setCopied(false), 1600);
    } catch {
      setCopied(false);
    }
  };

  const handleDownloadCsv = () => {
    const blob = new Blob([toCsv()], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${table.id || 'hypotheca_table'}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  if (!table.rows.length) {
    return (
      <div className="hp-plate-flat" style={{ padding: 'var(--space-md)' }}>
        <div style={{ fontWeight: 700, marginBottom: 'var(--space-2xs)' }}>{table.title}</div>
        <div style={{ color: 'var(--color-muted)', fontSize: 'var(--text-sm)' }}>
          {lang === 'tr' ? 'Veri yok.' : 'No data.'}
        </div>
      </div>
    );
  }

  return (
    <div className="hp-plate" style={{ padding: 'var(--space-md)' }}>
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          gap: 'var(--space-sm)',
          marginBottom: 'var(--space-sm)',
          flexWrap: 'wrap',
        }}
      >
        <h3 style={{ margin: 0, fontSize: 'var(--text-title)', fontWeight: 700 }}>{table.title}</h3>
        <div style={{ display: 'flex', gap: 'var(--space-xs)' }}>
          <button type="button" className="hp-btn hp-btn-sm" onClick={handleCopy}>
            {copied ? <Check size={14} /> : <Copy size={14} />}
            <span>{copied ? (lang === 'tr' ? 'Kopyalandı' : 'Copied') : lang === 'tr' ? 'Kopyala' : 'Copy'}</span>
          </button>
          <button type="button" className="hp-btn hp-btn-sm" onClick={handleDownloadCsv}>
            <Download size={14} />
            <span>CSV</span>
          </button>
        </div>
      </div>

      <div className="hp-table-wrap">
        <table className="hp-table">
          <thead>
            <tr>
              {table.columns.map((col) => (
                <th key={col.key} className={col.numeric ? 'num' : undefined}>
                  {col.label}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {table.rows.map((row, idx) => (
              <tr key={idx}>
                {table.columns.map((col) => {
                  const val = row[col.key];
                  return (
                    <td key={col.key} className={col.numeric ? 'num' : undefined}>
                      {val === null || val === undefined ? '' : String(val)}
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {table.footnotes && table.footnotes.length > 0 && (
        <div style={{ marginTop: 'var(--space-xs)', fontSize: 'var(--text-xs)', color: 'var(--color-muted)' }}>
          {table.footnotes.map((fn, i) => (
            <div key={i}>{fn}</div>
          ))}
        </div>
      )}
    </div>
  );
};

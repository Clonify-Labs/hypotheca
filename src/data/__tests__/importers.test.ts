import { describe, expect, it } from 'vitest';
import { ImportError, inferAndCoerce, normalizeHeaders, normalizeSheetRows, parseDelimitedText, parseNumber } from '../importers';
import { newProject, nextOpenStep, progressRatio, stepStatus } from '../../project/projectStore';

describe('parseNumber', () => {
  it('handles decimal comma, thousands separators and junk', () => {
    expect(parseNumber('3,5')).toBe(3.5);
    expect(parseNumber('1.234,56')).toBe(1234.56);
    expect(parseNumber('1,234.56')).toBe(1234.56);
    expect(parseNumber('1.234.567')).toBe(1234567);
    expect(parseNumber('-2.5e3')).toBe(-2500);
    expect(parseNumber('12 abc')).toBeNull();
    expect(parseNumber('')).toBeNull();
    expect(parseNumber('Erkek')).toBeNull();
  });
});

describe('parseDelimitedText', () => {
  it('handles BOM, semicolons, quoted delimiters, escaped quotes and newlines in quotes', () => {
    const csv = '\ufeffAd;Not;Yorum\r\n"Kaya, A.";3,5;"çok ""iyi""\nders"\r\nDemir;4;\r\n';
    const { rows } = parseDelimitedText(csv);
    expect(rows).toHaveLength(2);
    expect(rows[0]).toEqual({ Ad: 'Kaya, A.', Not: 3.5, Yorum: 'çok "iyi"\nders' });
    expect(rows[1].Yorum).toBeNull();
  });

  it('detects tabs and treats NA tokens as missing', () => {
    const { rows } = parseDelimitedText('a\tb\n1\tNA\n2\t#N/A\n3\t-\n');
    expect(rows.map((r) => r.b)).toEqual([null, null, null]);
  });

  it('renames empty and duplicate headers', () => {
    expect(normalizeHeaders(['Yas', '', 'yas', 'Yas'])).toEqual(['Yas', 'Degisken_2', 'yas_2', 'Yas_3']);
  });

  it('warns on ragged rows and pads them', () => {
    const { rows, warnings } = parseDelimitedText('a,b,c\n1,2\n4,5,6\n');
    expect(rows[0].c).toBeNull();
    expect(warnings.length).toBe(1);
  });

  it('rejects empty files and header-only files', () => {
    expect(() => parseDelimitedText('')).toThrow(ImportError);
    expect(() => parseDelimitedText('   \n  ')).toThrow(ImportError);
    expect(() => parseDelimitedText('a,b\n')).toThrow(ImportError);
  });
});

describe('normalizeSheetRows', () => {
  it('converts dates and booleans, skips blank rows', () => {
    const { rows } = normalizeSheetRows([
      ['Tarih', 'Onay', 'Puan'],
      [null, null, null],
      [new Date('2024-03-01T00:00:00Z'), true, '4,5'],
      [new Date('invalid'), false, 3],
    ]);
    expect(rows).toEqual([
      { Tarih: '2024-03-01', Onay: 1, Puan: 4.5 },
      { Tarih: null, Onay: 0, Puan: 3 },
    ]);
  });
});

describe('inferAndCoerce', () => {
  it('uses the union of keys and coerces stray text in numeric columns to missing', () => {
    const data = [
      ...Array.from({ length: 19 }, (_, i) => ({ x: i, g: i % 2 ? 'A' : 'B' })),
      { x: 'yok', g: 'A', extra: 1 },
    ];
    const { columns, rows, warnings } = inferAndCoerce(data as never);
    const x = columns.find((c) => c.name === 'x')!;
    expect(x.valueType).toBe('numeric');
    expect(x.missingCount).toBe(1);
    expect(rows[19].x).toBeNull();
    expect(columns.map((c) => c.name)).toContain('extra');
    expect(rows[0].extra).toBeNull();
    expect(warnings.some((w) => w.includes('"x"'))).toBe(true);
  });

  it('flags constant and empty columns', () => {
    const { warnings } = inferAndCoerce([
      { k: 1, e: null },
      { k: 1, e: null },
    ]);
    expect(warnings.some((w) => w.includes('"k"'))).toBe(true);
    expect(warnings.some((w) => w.includes('"e"'))).toBe(true);
  });

  it('returns empty metadata for no rows', () => {
    expect(inferAndCoerce([]).columns).toEqual([]);
  });
});

describe('project workflow state', () => {
  it('tracks step completion and next open step', () => {
    const p = newProject({ title: '  Deneme  ' });
    expect(p.title).toBe('Deneme');
    expect(nextOpenStep(p)).toBe('project');
    const withQ = { ...p, question: 'Soru?' };
    expect(nextOpenStep(withQ)).toBe('data');
    const withData = { ...withQ, datasetId: 'ds-1' };
    expect(stepStatus(withData).data).toBe(true);
    expect(nextOpenStep(withData)).toBe('autopilot');
    expect(progressRatio(withData)).toBeCloseTo(2 / 5);
  });
});

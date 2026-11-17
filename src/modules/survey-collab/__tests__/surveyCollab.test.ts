import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { buildSeedDatasets } from '../../../data/seedDatasets';
import { runDescriptives } from '../../../engine/classical';
import { Dataset } from '../../../types/interfaces';
import {
  createAnnotation,
  exportProjectSnapshot,
  parseAndValidateSnapshot,
  sha256Hex,
} from '../advisorCollab';
import {
  autoDetectLikertColumns,
  cleanSurveyDataset,
} from '../surveyCleaner';
import { SurveyAndCollabPage } from '../SurveyAndCollabPage';

const seedDatasets = buildSeedDatasets();
const dsRawLikert = seedDatasets.find((d) => d.id === 'ds-raw-likert')!;

describe('Module 6: Survey Cleaner & Advisor Collaboration', () => {
  it('1. autoDetectLikertColumns detects verbal Likert items and M4_Kaygi_Ters on ds-raw-likert', () => {
    expect(dsRawLikert).toBeDefined();
    const detected = autoDetectLikertColumns(dsRawLikert);

    expect(detected.verbalColumns).toEqual([
      'M1_OzYeterlik',
      'M2_OzYeterlik',
      'M3_OzYeterlik',
      'M4_Kaygi_Ters',
    ]);
    expect(detected.suspectReverseColumns).toEqual(['M4_Kaygi_Ters']);
    expect(detected.verbalColumns).not.toContain('Yanit_ID');
    expect(detected.verbalColumns).not.toContain('Bolum');
  });

  it('2. cleanSurveyDataset converts verbal Likert, reverse-codes M4_Kaygi_Ters, detects straight-liners, and scores composite', () => {
    const report = cleanSurveyDataset(dsRawLikert, {
      mapVerbalCols: ['M1_OzYeterlik', 'M2_OzYeterlik', 'M3_OzYeterlik', 'M4_Kaygi_Ters'],
      reverseCols: ['M4_Kaygi_Ters'],
      likertMin: 1,
      likertMax: 5,
      composites: [
        {
          name: 'OzYeterlik_Toplam_Ort',
          items: ['M1_OzYeterlik', 'M2_OzYeterlik', 'M3_OzYeterlik', 'M4_Kaygi_Ters'],
        },
      ],
      removeStraightLiners: false,
      removeDuplicates: false,
    });

    expect(report.mappedColumns).toEqual([
      { column: 'M1_OzYeterlik', convertedCount: 24 },
      { column: 'M2_OzYeterlik', convertedCount: 24 },
      { column: 'M3_OzYeterlik', convertedCount: 24 },
      { column: 'M4_Kaygi_Ters', convertedCount: 24 },
    ]);
    expect(report.reversedColumns).toEqual(['M4_Kaygi_Ters']);
    expect(report.compositesCreated).toEqual(['OzYeterlik_Toplam_Ort']);
    expect(report.straightLinerIndices).toEqual([4, 19]);
    expect(report.duplicateRowIndices).toEqual([]);

    // Verify FRM_02 (idx=1): raw M1=5, M2=4, M3=4, M4_Kaygi_Ters=2 -> reversed M4 = 6 - 2 = 4 -> mean = 4.25
    const row2 = report.cleanedDataset.rows[1];
    expect(row2.M1_OzYeterlik).toBe(5);
    expect(row2.M2_OzYeterlik).toBe(4);
    expect(row2.M3_OzYeterlik).toBe(4);
    expect(row2.M4_Kaygi_Ters).toBe(4);
    expect(row2.OzYeterlik_Toplam_Ort).toBe(4.25);

    // Verify FRM_03 (idx=2): raw M1=5, M2=5, M3=5, M4_Kaygi_Ters=1 (NOT a straight-liner!) -> reversed M4 = 5
    const row3 = report.cleanedDataset.rows[2];
    expect(row3.M4_Kaygi_Ters).toBe(5);
    expect(row3.OzYeterlik_Toplam_Ort).toBe(5);

    // Numeric metadata updated for downstream classical tests
    const numericCols = report.cleanedDataset.columns
      .filter((c) => c.valueType === 'numeric')
      .map((c) => c.name);
    expect(numericCols).toContain('M1_OzYeterlik');
    expect(numericCols).toContain('M4_Kaygi_Ters');
    expect(numericCols).toContain('OzYeterlik_Toplam_Ort');

    // Dropping straight-liners removes FRM_05 and FRM_20
    const droppedReport = cleanSurveyDataset(dsRawLikert, {
      reverseCols: ['M4_Kaygi_Ters'],
      removeStraightLiners: true,
    });
    expect(droppedReport.cleanedDataset.rows).toHaveLength(22);
    expect(
      droppedReport.cleanedDataset.rows.some((r) => r.Yanit_ID === 'FRM_05' || r.Yanit_ID === 'FRM_20'),
    ).toBe(false);
  });

  it('3. handles Turkish diacritics, English Likert, frequency scales, leading ints, duplicates, and missing-safe composites', () => {
    const messyDataset: Dataset = {
      id: 'ds-messy-test',
      name: 'Messy_Bilingual_Survey.csv',
      createdAt: '2026-11-16T22:00:00.000Z',
      columns: [
        { name: 'ID', label: 'ID', valueType: 'string', scale: 'nominal', decimals: 0, uniqueCount: 5, missingCount: 0 },
        { name: 'Q1', label: 'Q1', valueType: 'categorical', scale: 'nominal', decimals: 0, uniqueCount: 5, missingCount: 0 },
        { name: 'Q2', label: 'Q2', valueType: 'categorical', scale: 'nominal', decimals: 0, uniqueCount: 5, missingCount: 0 },
        { name: 'Q3_Freq', label: 'Q3_Freq', valueType: 'categorical', scale: 'nominal', decimals: 0, uniqueCount: 5, missingCount: 0 },
        { name: 'Q4_Rev', label: 'Q4_Rev', valueType: 'categorical', scale: 'nominal', decimals: 0, uniqueCount: 5, missingCount: 0 },
      ],
      rows: [
        // Case / diacritic / whitespace variations + leading integers
        {
          ID: 'P1',
          Q1: 'kesinlikle katilmiyorum',
          Q2: '1 - Kesinlikle Katılmıyorum',
          Q3_Freq: '  Sık   Sık ',
          Q4_Rev: '5 (Çok Yüksek)',
        },
        // English agreement & frequency
        {
          ID: 'P2',
          Q1: 'Strongly Agree',
          Q2: 'Neither',
          Q3_Freq: 'Always',
          Q4_Rev: 'Strongly Disagree',
        },
        // Straight-liner on value 5 across all 4 items including Q4_Rev (must still catch BEFORE reverse-coding!)
        {
          ID: 'P3',
          Q1: 'KESİNLİKLE KATILIYORUM',
          Q2: '5 (Çok Yüksek)',
          Q3_Freq: 'Her Zaman',
          Q4_Rev: 'Strongly Agree',
        },
        // Exact duplicate of P2
        {
          ID: 'P2',
          Q1: 'Strongly Agree',
          Q2: 'Neither',
          Q3_Freq: 'Always',
          Q4_Rev: 'Strongly Disagree',
        },
        // Partial missing: 2 of 4 answered (>= half -> compute mean), vs 1 of 4 (< half -> null)
        {
          ID: 'P4',
          Q1: 'Agree',
          Q2: 'Disagree',
          Q3_Freq: '',
          Q4_Rev: null,
        },
        {
          ID: 'P5',
          Q1: 'Never',
          Q2: null,
          Q3_Freq: '',
          Q4_Rev: null,
        },
      ],
    };

    const detected = autoDetectLikertColumns(messyDataset);
    expect(detected.verbalColumns).toEqual(['Q1', 'Q2', 'Q3_Freq', 'Q4_Rev']);
    expect(detected.suspectReverseColumns).toContain('Q4_Rev');

    const report = cleanSurveyDataset(messyDataset, {
      reverseCols: ['Q4_Rev'],
      composites: [{ name: 'Total_Mean', items: ['Q1', 'Q2', 'Q3_Freq', 'Q4_Rev'] }],
      removeStraightLiners: true,
      removeDuplicates: true,
    });

    // P3 (idx=2) caught as straight-liner despite reverse-coding on Q4_Rev
    expect(report.straightLinerIndices).toEqual([2]);
    // Second P2 (idx=3) caught as exact duplicate
    expect(report.duplicateRowIndices).toEqual([3]);
    // 6 - 2 removed = 4 rows left
    expect(report.cleanedDataset.rows.map((r) => r.ID)).toEqual(['P1', 'P2', 'P4', 'P5']);

    // Check P1: Q1=1, Q2=1, Q3_Freq=4, Q4_Rev=6-5=1 -> mean = 7/4 = 1.75
    const p1 = report.cleanedDataset.rows[0];
    expect(p1.Q1).toBe(1);
    expect(p1.Q2).toBe(1);
    expect(p1.Q3_Freq).toBe(4);
    expect(p1.Q4_Rev).toBe(1);
    expect(p1.Total_Mean).toBe(1.75);

    // Check P2: Q1=5, Q2=3, Q3_Freq=5, Q4_Rev=6-1=5 -> mean = 4.5
    const p2 = report.cleanedDataset.rows[1];
    expect(p2.Total_Mean).toBe(4.5);

    // Check P4 (2/4 answered -> >= half -> mean(4, 2) = 3)
    expect(report.cleanedDataset.rows[2].Total_Mean).toBe(3);

    // Check P5 (1/4 answered -> < half -> null)
    expect(report.cleanedDataset.rows[3].Total_Mean).toBeNull();
  });

  it('4. exportProjectSnapshot and parseAndValidateSnapshot verify round-trip and detect tampering', () => {
    expect(sha256Hex('abc')).toBe(
      'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad',
    );

    const cleaned = cleanSurveyDataset(dsRawLikert, {
      reverseCols: ['M4_Kaygi_Ters'],
      composites: [
        {
          name: 'Olcek_Ort',
          items: ['M1_OzYeterlik', 'M2_OzYeterlik', 'M3_OzYeterlik', 'M4_Kaygi_Ters'],
        },
      ],
      removeStraightLiners: true,
    }).cleanedDataset;

    const descOutput = runDescriptives(cleaned, ['M1_OzYeterlik', 'Olcek_Ort']);
    const ann1 = createAnnotation(
      descOutput.id,
      'Muammer Tiryaki',
      'Advisor',
      'approved',
      'Likert ters kodlama ve straight-liner temizliği doğrulandı.',
    );
    const ann2 = createAnnotation(
      descOutput.id,
      'Dr. Aylin Kaya',
      'Reviewer',
      'revision_needed',
      'Yöntem bölümünde Cronbach alfa da raporlanmalı.',
    );

    const snapshot = exportProjectSnapshot({
      projectName: 'Akademik Oz-Yeterlik Pilotu',
      ownerName: 'Muammer Tiryaki',
      dataset: cleaned,
      history: [descOutput],
      annotations: [ann1, ann2],
    });

    expect(snapshot.format).toBe('hypotheca-study-v1');
    expect(snapshot.checksum).toMatch(/^[0-9a-f]{64}$/);

    const serialized = JSON.stringify(snapshot, null, 2);
    const parsed = parseAndValidateSnapshot(serialized);
    expect(parsed.projectName).toBe('Akademik Oz-Yeterlik Pilotu');
    expect(parsed.ownerName).toBe('Muammer Tiryaki');
    expect(parsed.dataset.rows).toHaveLength(22);
    expect(parsed.history).toHaveLength(1);
    expect(parsed.annotations).toHaveLength(2);
    expect(parsed.checksum).toBe(snapshot.checksum);

    // Tamper with a single value in the dataset
    const tamperedData = JSON.parse(serialized);
    tamperedData.dataset.rows[0].M1_OzYeterlik = 999;
    expect(() => parseAndValidateSnapshot(JSON.stringify(tamperedData))).toThrow(/Checksum verification failed/i);

    // Tamper with annotation text
    const tamperedAnn = JSON.parse(serialized);
    tamperedAnn.annotations[0].comment = 'Tampered comment';
    expect(() => parseAndValidateSnapshot(JSON.stringify(tamperedAnn))).toThrow(/Checksum verification failed/i);

    // Tamper with checksum itself
    const tamperedChecksum = JSON.parse(serialized);
    tamperedChecksum.checksum = '0'.repeat(64);
    expect(() => parseAndValidateSnapshot(JSON.stringify(tamperedChecksum))).toThrow(/Checksum verification failed/i);

    // Wrong format tag
    const wrongFormat = JSON.parse(serialized);
    wrongFormat.format = 'legacy-v0';
    expect(() => parseAndValidateSnapshot(JSON.stringify(wrongFormat))).toThrow(/Unsupported snapshot format/i);

    // Invalid JSON
    expect(() => parseAndValidateSnapshot('{bad json')).toThrow(/Invalid JSON/i);
  });

  it('5. SurveyAndCollabPage renders deterministically in TR and EN without errors', () => {
    const htmlTr = renderToStaticMarkup(
      React.createElement(SurveyAndCollabPage, {
        dataset: dsRawLikert,
        datasets: seedDatasets,
        history: [],
        lang: 'tr',
      }),
    );
    expect(htmlTr).toContain('Anket temizleme');
    expect(htmlTr).toContain('M4_Kaygi_Ters');
    expect(htmlTr).toContain('FRM_05');

    const htmlEn = renderToStaticMarkup(
      React.createElement(SurveyAndCollabPage, {
        dataset: dsRawLikert,
        datasets: seedDatasets,
        history: [],
        lang: 'en',
      }),
    );
    expect(htmlEn).toContain('Survey cleaning');
    expect(htmlEn).toContain('Possibly reversed');
  });
});

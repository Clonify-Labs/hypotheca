import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { buildSeedDatasets } from '../../../data/seedDatasets';
import {
  runBlandAltman,
  runCbSem,
  runChiSquare,
  runCorrelation,
  runDescriptives,
  runEfa,
  runFrequencies,
  runFriedman,
  runIndependentTTest,
  runKaplanMeier,
  runKruskalWallis,
  runLinearRegression,
  runLogisticRegression,
  runMannWhitneyU,
  runNormality,
  runOneSampleTTest,
  runOneWayAnova,
  runOutliers,
  runPairedTTest,
  runPartialCorrelation,
  runPlsSem,
  runPowerAnalysis,
  runProcessMacro,
  runRasch,
  runReliability,
  runRepeatedAnova,
  runRocCurve,
  runWilcoxon,
} from '../../../engine/classical';
import { AnalysisOutput } from '../../../types/interfaces';
import { ReproducibilityView } from '../ReproducibilityView';
import {
  buildZipArchive,
  computeDatasetSha256,
  crc32,
  createOsfBundle,
  datasetToCsv,
  sha256Fallback,
} from '../osfBundle';
import {
  generateCombinedScript,
  generateReproducibleScript,
} from '../scriptGenerator';

function parseZipFileEntries(zipBytes: Uint8Array): Map<string, Uint8Array> {
  const view = new DataView(zipBytes.buffer, zipBytes.byteOffset, zipBytes.byteLength);
  const decoder = new TextDecoder();
  const entries = new Map<string, Uint8Array>();

  let pos = 0;
  while (pos + 4 <= zipBytes.length) {
    const sig = view.getUint32(pos, true);
    if (sig !== 0x04034b50) break;
    const compMethod = view.getUint16(pos + 8, true);
    expect(compMethod).toBe(0);
    const storedCrc = view.getUint32(pos + 14, true);
    const compSize = view.getUint32(pos + 18, true);
    const uncompSize = view.getUint32(pos + 22, true);
    const nameLen = view.getUint16(pos + 26, true);
    const extraLen = view.getUint16(pos + 28, true);
    expect(compSize).toBe(uncompSize);

    const nameStart = pos + 30;
    const dataStart = nameStart + nameLen + extraLen;
    const dataEnd = dataStart + compSize;

    const name = decoder.decode(zipBytes.subarray(nameStart, nameStart + nameLen));
    const payload = zipBytes.subarray(dataStart, dataEnd);
    expect(crc32(payload)).toBe(storedCrc);

    entries.set(name, payload);
    pos = dataEnd;
  }

  // Verify Central Directory and End of Central Directory (PK\x05\x06)
  const cdStart = pos;
  let cdCount = 0;
  while (pos + 4 <= zipBytes.length && view.getUint32(pos, true) === 0x02014b50) {
    const nameLen = view.getUint16(pos + 28, true);
    const extraLen = view.getUint16(pos + 30, true);
    const commentLen = view.getUint16(pos + 32, true);
    pos += 46 + nameLen + extraLen + commentLen;
    cdCount++;
  }
  expect(cdCount).toBe(entries.size);
  expect(view.getUint32(pos, true)).toBe(0x06054b50);
  expect(view.getUint16(pos + 8, true)).toBe(entries.size);
  expect(view.getUint32(pos + 16, true)).toBe(cdStart);

  return entries;
}

describe('Module 2: Reproducibility Engine & OSF Bundle', () => {
  const datasets = buildSeedDatasets();
  const studentDs = datasets[0]; // Ogrenci_Olcek_Verisi_N180.csv
  const clinicDs = datasets[1]; // Klinik_Sagkalim_Verisi_N150.csv

  it('generates valid R, Python, and SPSS scripts for Independent T-Test with exact column names', () => {
    const indepT = runIndependentTTest(studentDs, 'OY_Ort', 'Cinsiyet');

    const rCode = generateReproducibleScript(indepT, studentDs.name, 'r');
    expect(rCode).toContain('# Hypotheca Reproducible R Script');
    expect(rCode).toContain('library(tidyverse)');
    expect(rCode).toContain('library(car)');
    expect(rCode).toContain('library(effectsize)');
    expect(rCode).toContain('library(psych)');
    expect(rCode).toContain('library(lavaan)');
    expect(rCode).toContain('library(pwr)');
    expect(rCode).toContain('library(survival)');
    expect(rCode).toContain(`readr::read_csv("${studentDs.name}")`);
    expect(rCode).toContain('OY_Ort');
    expect(rCode).toContain('Cinsiyet');
    expect(rCode).toContain('t.test(OY_Ort ~ Cinsiyet');

    const pyCode = generateReproducibleScript(indepT, studentDs.name, 'python');
    expect(pyCode).toContain('# Hypotheca Reproducible Python Script');
    expect(pyCode).toContain('pandas');
    expect(pyCode).toContain('scipy.stats');
    expect(pyCode).toContain('pingouin');
    expect(pyCode).toContain('statsmodels');
    expect(pyCode).toContain('factor_analyzer');
    expect(pyCode).toContain('lifelines');
    expect(pyCode).toContain(`pd.read_csv("${studentDs.name}")`);
    expect(pyCode).toContain('OY_Ort');
    expect(pyCode).toContain('Cinsiyet');
    expect(pyCode).toContain('pg.ttest');

    const spsCode = generateReproducibleScript(indepT, studentDs.name, 'spss_syntax');
    expect(spsCode).toContain('* Hypotheca SPSS Syntax.');
    expect(spsCode).toContain('T-TEST GROUPS=Cinsiyet');
    expect(spsCode).toContain('/VARIABLES=OY_Ort');
  });

  it('supports all 26+ classical & psychometric analysis types plus generic fallback across R, Python, and SPSS', () => {
    const outputs: AnalysisOutput[] = [
      runDescriptives(studentDs, ['OY_Ort', 'YZ_Ort']),
      runFrequencies(studentDs, ['Cinsiyet', 'Fakulte']),
      runNormality(studentDs, ['OY_Ort', 'TK_Ort']),
      runOutliers(studentDs, ['OY_Ort']),
      runOneSampleTTest(studentDs, 'OY_Ort', 3.5),
      runIndependentTTest(studentDs, 'OY_Ort', 'Cinsiyet'),
      runPairedTTest(studentDs, 'Basari_On', 'Basari_Son'),
      runOneWayAnova(studentDs, 'OY_Ort', 'Fakulte', 'tukey'),
      runRepeatedAnova(studentDs, ['Basari_On', 'Basari_Ara', 'Basari_Son']),
      runMannWhitneyU(studentDs, 'OY_Ort', 'Cinsiyet'),
      runWilcoxon(studentDs, 'Basari_On', 'Basari_Son'),
      runKruskalWallis(studentDs, 'OY_Ort', 'Fakulte'),
      runFriedman(studentDs, ['Basari_On', 'Basari_Ara', 'Basari_Son']),
      runCorrelation(studentDs, ['OY_Ort', 'YZ_Ort', 'TK_Ort'], 'pearson'),
      runPartialCorrelation(studentDs, 'OY_Ort', 'Basari_Son', ['Yas']),
      runChiSquare(studentDs, 'Cinsiyet', 'Burs_Durumu'),
      runReliability(studentDs, ['OY1', 'OY2', 'OY3', 'OY4']),
      runEfa(studentDs, ['OY1', 'OY2', 'OY3', 'OY4', 'YZ1', 'YZ2', 'YZ3', 'YZ4'], {
        nFactors: 2,
        rotation: 'varimax',
        extraction: 'pca',
      }),
      runRasch(studentDs, ['OY1', 'OY2', 'OY3', 'OY4']),
      runCbSem(studentDs, {
        factors: [
          { name: 'OY', indicators: ['OY1', 'OY2', 'OY3'] },
          { name: 'YZ', indicators: ['YZ1', 'YZ2', 'YZ3'] },
        ],
        paths: [{ from: 'OY', to: 'YZ' }],
      }),
      runPlsSem(
        studentDs,
        {
          factors: [
            { name: 'OY', indicators: ['OY1', 'OY2', 'OY3'] },
            { name: 'YZ', indicators: ['YZ1', 'YZ2', 'YZ3'] },
          ],
          paths: [{ from: 'OY', to: 'YZ' }],
        },
        40,
      ),
      runLinearRegression(studentDs, 'Basari_Son', ['OY_Ort', 'YZ_Ort'], [['OY_Ort'], ['YZ_Ort']]),
      runLogisticRegression(clinicDs, 'Olay_Durumu', ['Yas', 'Biyobelirtec_A']),
      runRocCurve(clinicDs, 'Biyobelirtec_A', 'Olay_Durumu'),
      runBlandAltman(clinicDs, 'Cihaz1_Olcum', 'Cihaz2_Olcum'),
      runKaplanMeier(clinicDs, 'Izlem_Ay', 'Olay_Durumu', 'Grup'),
      runProcessMacro(studentDs, {
        model: 4,
        x: 'OY_Ort',
        mOrW: 'YZ_Ort',
        y: 'Basari_Son',
        bootstrapSamples: 80,
      }),
      runProcessMacro(studentDs, {
        model: 1,
        x: 'OY_Ort',
        mOrW: 'TK_Ort',
        y: 'Basari_Son',
      }),
      runPowerAnalysis({ testType: 'indep_t', effectSize: 0.5, power: 0.8, alpha: 0.05 }),
      runPowerAnalysis({ testType: 'linear_regression', predictors: 3, effectSize: 0.15, power: 0.8 }),
      runPowerAnalysis({ testType: 'proportions_2', effectSize: 0.4, power: 0.8 }),
      {
        id: 'custom-fallback-1',
        analysisType: 'custom_unknown_analysis',
        title: 'Custom Unknown Analysis',
        createdAt: '2026-11-16T22:00:00.000Z',
        params: { target: 'OY_Ort' },
        summary: {},
        tables: [],
        charts: [],
      },
    ];

    for (const analysis of outputs) {
      for (const format of ['r', 'python', 'spss_syntax'] as const) {
        const script = generateReproducibleScript(analysis, studentDs.name, format);
        expect(script.length).toBeGreaterThan(80);
        expect(script).toContain(analysis.analysisType);
      }
    }

    const combinedR = generateCombinedScript(outputs.slice(0, 8), studentDs.name, 'r');
    expect(combinedR).toContain('[1]');
    expect(combinedR).toContain('[8]');
    expect(combinedR).toContain('OY_Ort');
    expect(combinedR).toContain('Basari_Son');

    const emptyCombinedPy = generateCombinedScript([], studentDs.name, 'python');
    expect(emptyCombinedPy).toContain('No analyses recorded yet');
  });

  it('computes accurate IEEE 802.3 CRC-32 and FIPS 180-4 SHA-256 digests', async () => {
    const crcBytes = new TextEncoder().encode('123456789');
    expect(crc32(crcBytes)).toBe(0xcbf43926);

    expect(sha256Fallback(new Uint8Array(0))).toBe(
      'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855',
    );

    const dsSha = await computeDatasetSha256(studentDs);
    expect(dsSha).toMatch(/^[0-9a-f]{64}$/);
    const csvBytes = new TextEncoder().encode(datasetToCsv(studentDs));
    expect(dsSha).toBe(sha256Fallback(csvBytes));
  });

  it('creates a valid PKZIP OSF bundle with PK\\x03\\x04 header, non-empty SHA-256, and all 7 expected archive files', async () => {
    const history: AnalysisOutput[] = [
      runDescriptives(studentDs, ['OY_Ort', 'YZ_Ort']),
      runIndependentTTest(studentDs, 'OY_Ort', 'Cinsiyet'),
      runOneWayAnova(studentDs, 'OY_Ort', 'Fakulte', 'tukey'),
      runLinearRegression(studentDs, 'Basari_Son', ['OY_Ort', 'YZ_Ort']),
    ];

    const prereg = 'H1: OY_Ort predicts Basari_Son (OSF Prereg #2026-HP-02).';
    const { manifest, zipBytes, fileList } = await createOsfBundle(studentDs, history, prereg);

    // Check ZIP magic header PK\x03\x04
    expect(zipBytes[0]).toBe(0x50);
    expect(zipBytes[1]).toBe(0x4b);
    expect(zipBytes[2]).toBe(0x03);
    expect(zipBytes[3]).toBe(0x04);

    // Check manifest SHA-256 and metadata
    expect(manifest.dataset.sha256).toMatch(/^[0-9a-f]{64}$/);
    expect(manifest.dataset.name).toBe('Ogrenci_Olcek_Verisi_N180.csv');
    expect(manifest.dataset.rows).toBe(180);
    expect(manifest.dataset.columns).toBe(studentDs.columns.length);
    expect(manifest.analyses).toHaveLength(4);

    // Check all 7 expected file paths
    const expectedFiles = [
      'README.md',
      'manifest.json',
      'data/Ogrenci_Olcek_Verisi_N180.csv',
      'scripts/analysis_reproducible.R',
      'scripts/analysis_reproducible.py',
      'scripts/analysis_spss.sps',
      'results/summary_tables.json',
    ];
    expect(fileList).toEqual(expectedFiles);

    // Parse binary PKZIP entries and validate CRC-32 + contents
    const extracted = parseZipFileEntries(zipBytes);
    expect(Array.from(extracted.keys())).toEqual(expectedFiles);

    const decoder = new TextDecoder();
    const readmeText = decoder.decode(extracted.get('README.md'));
    expect(readmeText).toContain(manifest.dataset.sha256);
    expect(readmeText).toContain(prereg);

    const manifestJson = JSON.parse(decoder.decode(extracted.get('manifest.json')));
    expect(manifestJson.dataset.sha256).toBe(manifest.dataset.sha256);

    const rScript = decoder.decode(extracted.get('scripts/analysis_reproducible.R'));
    expect(rScript).toContain('OY_Ort');
    expect(rScript).toContain('Cinsiyet');
    expect(rScript).toContain('data/Ogrenci_Olcek_Verisi_N180.csv');

    const pyScript = decoder.decode(extracted.get('scripts/analysis_reproducible.py'));
    expect(pyScript).toContain('OY_Ort');
    expect(pyScript).toContain('Cinsiyet');

    const spssScript = decoder.decode(extracted.get('scripts/analysis_spss.sps'));
    expect(spssScript).toContain('OY_Ort');
    expect(spssScript).toContain('Cinsiyet');

    const csvText = decoder.decode(extracted.get('data/Ogrenci_Olcek_Verisi_N180.csv'));
    expect(csvText.split('\n')).toHaveLength(181);

    const summaryTables = JSON.parse(decoder.decode(extracted.get('results/summary_tables.json')));
    expect(summaryTables.analyses).toHaveLength(4);

    // Also test minimal buildZipArchive directly
    const miniZip = buildZipArchive([{ path: 'hello.txt', content: 'hypotheca' }]);
    const miniEntries = parseZipFileEntries(miniZip);
    expect(decoder.decode(miniEntries.get('hello.txt'))).toBe('hypotheca');
  });

  it('renders ReproducibilityView cleanly in Turkish and English with Terrazzo specimen classes', () => {
    const history: AnalysisOutput[] = [
      runIndependentTTest(studentDs, 'OY_Ort', 'Cinsiyet'),
    ];

    const htmlTr = renderToStaticMarkup(
      React.createElement(ReproducibilityView, { dataset: studentDs, history, lang: 'tr' }),
    );
    expect(htmlTr).toContain('OSF paketini indir (.zip)');
    expect(htmlTr).toContain('>R<');
    expect(htmlTr).toContain('>Python<');
    expect(htmlTr).toContain('>SPSS<');
    expect(htmlTr).toContain('hp-code-block');
    expect(htmlTr).toContain('OY_Ort');
    expect(htmlTr).toContain('Cinsiyet');

    const htmlEnEmpty = renderToStaticMarkup(
      React.createElement(ReproducibilityView, { dataset: studentDs, history: [], lang: 'en' }),
    );
    expect(htmlEnEmpty).toContain('Download OSF package (.zip)');
    expect(htmlEnEmpty).toContain('No analyses yet');
  });
});

import { ColumnMeta, DataRow, Dataset } from '../types/interfaces';
import rawSeed from './seedData.json';

export function inferColumns(rows: DataRow[]): ColumnMeta[] {
  if (!rows.length) return [];
  const keys = Object.keys(rows[0]);
  return keys.map((name) => {
    const vals = rows.map((r) => r[name]).filter((v) => v !== null && v !== undefined && v !== '');
    const missingCount = rows.length - vals.length;
    const unique = new Set(vals.map((v) => String(v)));
    const numVals = vals.map((v) => Number(String(v).replace(',', '.'))).filter((v) => Number.isFinite(v));
    const isNum = vals.length > 0 && numVals.length / vals.length >= 0.9;
    const isInt = isNum && numVals.every((v) => Math.abs(v % 1) < 1e-9);

    let valueType: ColumnMeta['valueType'] = 'string';
    let scale: ColumnMeta['scale'] = 'nominal';
    if (isNum) {
      valueType = 'numeric';
      scale = isInt && unique.size === 2 ? 'nominal' : 'scale';
    } else if (unique.size <= 25) {
      valueType = 'categorical';
      scale = 'nominal';
    }

    return {
      name,
      label: name,
      valueType,
      scale,
      decimals: isInt ? 0 : 2,
      uniqueCount: unique.size,
      missingCount,
    };
  });
}

const seedMap = rawSeed as Record<string, DataRow[]>;

const META_STUDIES: DataRow[] = [
  { Calisma: 'Yılmaz & Kaya (2021)', N: 120, Etki_d: 0.48, SE: 0.19, Yil: 2021 },
  { Calisma: 'Demir (2022)', N: 85, Etki_d: 0.62, SE: 0.22, Yil: 2022 },
  { Calisma: 'Smith & Lee (2022)', N: 210, Etki_d: 0.35, SE: 0.14, Yil: 2022 },
  { Calisma: 'Arslan vd. (2023)', N: 96, Etki_d: 0.71, SE: 0.21, Yil: 2023 },
  { Calisma: 'Müller (2023)', N: 164, Etki_d: 0.29, SE: 0.16, Yil: 2023 },
  { Calisma: 'Çelik & Öz (2024)', N: 140, Etki_d: 0.54, SE: 0.17, Yil: 2024 },
  { Calisma: 'Garcia (2024)', N: 78, Etki_d: 0.82, SE: 0.24, Yil: 2024 },
  { Calisma: 'Korkmaz (2025)', N: 190, Etki_d: 0.41, SE: 0.15, Yil: 2025 },
  { Calisma: 'Tanaka (2025)', N: 112, Etki_d: 0.44, SE: 0.19, Yil: 2025 },
  { Calisma: 'Aydın & Tiryaki (2026)', N: 155, Etki_d: 0.52, SE: 0.16, Yil: 2026 },
];

const RAW_LIKERT_SURVEY: DataRow[] = Array.from({ length: 24 }, (_, idx) => {
  const straight = idx === 4 || idx === 19;
  const labels = [
    'Kesinlikle Katılmıyorum',
    'Katılmıyorum',
    'Kararsızım',
    'Katılıyorum',
    'Kesinlikle Katılıyorum',
  ];
  const base = straight ? 2 : (idx % 3) + 2;
  const invBase = 4 - base;
  return {
    Yanit_ID: `FRM_${String(idx + 1).padStart(2, '0')}`,
    Bolum: idx % 2 === 0 ? 'Mühendislik' : 'Eğitim',
    M1_OzYeterlik: straight ? labels[2] : labels[Math.min(4, base + (idx % 2))],
    M2_OzYeterlik: straight ? labels[2] : labels[Math.min(4, base)],
    M3_OzYeterlik: straight ? labels[2] : labels[Math.min(4, base + ((idx + 1) % 2))],
    M4_Kaygi_Ters: straight ? labels[2] : labels[Math.max(0, invBase)],
  };
});

export function buildSeedDatasets(): Dataset[] {
  const rows1 = seedMap['Ogrenci_Olcek_Verisi_N180.csv'] || [];
  const rows2 = seedMap['Klinik_Sagkalim_Verisi_N150.csv'] || [];

  const cols1 = inferColumns(rows1).map((c) =>
    ['OY_Ort', 'YZ_Ort', 'TK_Ort', 'Basari_On', 'Basari_Ara', 'Basari_Son', 'Gelir_TL', 'Yas'].includes(c.name)
      ? { ...c, valueType: 'numeric' as const, scale: 'scale' as const }
      : c,
  );

  return [
    {
      id: 'ds-ogrenci-180',
      name: 'Ogrenci_Olcek_Verisi_N180.csv',
      description: 'Akademik öz-yeterlik, yapay zeka tutumu, tükenmişlik ve dönem içi başarı (N=180).',
      columns: cols1,
      rows: rows1,
      createdAt: '2026-11-16T21:00:00.000Z',
    },
    {
      id: 'ds-klinik-150',
      name: 'Klinik_Sagkalim_Verisi_N150.csv',
      description: 'Klinik tedavi grupları, biyobelirteç ROC, cihaz uyumu ve sağkalım izlemi (N=150).',
      columns: inferColumns(rows2),
      rows: rows2,
      createdAt: '2026-11-16T21:05:00.000Z',
    },
    {
      id: 'ds-meta-10',
      name: 'MetaAnaliz_Calisma_Listesi.csv',
      description: 'Etki büyüklüğü (d) ve standart hata (SE) içeren 10 çalışma meta-analiz seti.',
      columns: inferColumns(META_STUDIES),
      rows: META_STUDIES,
      createdAt: '2026-11-16T21:10:00.000Z',
    },
    {
      id: 'ds-raw-likert',
      name: 'Ham_GoogleForms_Likert_Anket.csv',
      description: 'Sözel Likert yanıtları, ters madde ve straightlining içeren ham anket verisi.',
      columns: inferColumns(RAW_LIKERT_SURVEY),
      rows: RAW_LIKERT_SURVEY,
      createdAt: '2026-11-16T21:15:00.000Z',
    },
  ];
}

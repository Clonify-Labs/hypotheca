import fs from 'node:fs/promises';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { fileURLToPath } from 'node:url';
import * as XLSX from 'xlsx';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const DATA_DIR = path.resolve(__dirname, '..', 'data');

function getXlsxApi(): typeof XLSX {
  const mod = XLSX as unknown as typeof XLSX & { default?: typeof XLSX };
  return typeof mod.utils?.json_to_sheet === 'function' ? mod : mod.default!;
}

interface DemoSurveyRow {
  Katilimci_ID: string;
  TC_Kimlik: string;
  Eposta: string;
  Grup: 'Deney' | 'Kontrol';
  Bolum: 'Bilgisayar' | 'Eğitim' | 'Psikoloji';
  OzYeterlik_Puan: number;
  Tukenmislik_Puan: number;
  Akademik_Basari: number;
  Calisma_Saati: number;
}

function generateSurveyRows(count = 60): DemoSurveyRow[] {
  const departments: DemoSurveyRow['Bolum'][] = ['Bilgisayar', 'Eğitim', 'Psikoloji'];
  const rows: DemoSurveyRow[] = [];

  for (let i = 0; i < count; i++) {
    const isExp = i % 2 === 0;
    const dept = departments[i % departments.length];
    const wave = (i % 7) - 3;
    const selfEff = Number((isExp ? 4.05 + wave * 0.14 : 3.25 + wave * 0.13).toFixed(2));
    const burnout = Number((isExp ? 2.18 - wave * 0.11 : 3.12 - wave * 0.10).toFixed(2));
    const gpa = Number((isExp ? 3.34 + wave * 0.08 : 2.86 + wave * 0.09).toFixed(2));
    const studyHours = Number((isExp ? 16.5 + wave * 1.1 : 12.2 + wave * 0.9).toFixed(1));

    const tcknSuffix = String(1000000000 + i * 7919).slice(0, 10);
    rows.push({
      Katilimci_ID: `BAP_${String(i + 1).padStart(3, '0')}`,
      TC_Kimlik: `1${tcknSuffix}`,
      Eposta: `katilimci${i + 1}@universite.edu.tr`,
      Grup: isExp ? 'Deney' : 'Kontrol',
      Bolum: dept,
      OzYeterlik_Puan: selfEff,
      Tukenmislik_Puan: burnout,
      Akademik_Basari: gpa,
      Calisma_Saati: studyHours,
    });
  }
  return rows;
}

function toCsv(rows: DemoSurveyRow[]): string {
  const headers = Object.keys(rows[0]) as (keyof DemoSurveyRow)[];
  const lines = [
    headers.join(','),
    ...rows.map((r) => headers.map((h) => String(r[h])).join(',')),
  ];
  return `${lines.join('\n')}\n`;
}

function encodeWinAnsiTr(str: string): string {
  const out: number[] = [];
  for (const ch of str) {
    if (ch === 'İ') out.push(0o201);
    else if (ch === 'ı') out.push(0o202);
    else if (ch === 'Ş') out.push(0o203);
    else if (ch === 'ş') out.push(0o204);
    else if (ch === 'Ğ') out.push(0o205);
    else if (ch === 'ğ') out.push(0o206);
    else {
      const code = ch.charCodeAt(0);
      if (code === 40 || code === 41 || code === 92) {
        out.push(92, code);
      } else if (code <= 255) {
        out.push(code);
      } else {
        out.push(63);
      }
    }
  }
  return Buffer.from(out).toString('latin1');
}

function buildAcademicTurkishPdf(pages: string[][]): Buffer {
  const objects: string[] = [];
  const addObj = (body: string): number => {
    objects.push(body);
    return objects.length;
  };

  const toUnicodeStream = [
    '/CIDInit /ProcSet findresource begin',
    '12 dict begin',
    'begincmap',
    '/CIDSystemInfo << /Registry (Adobe) /Ordering (UCS) /Supplement 0 >> def',
    '/CMapName /Adobe-Identity-UCS def',
    '/CMapType 2 def',
    '1 begincodespacerange',
    '<00> <FF>',
    'endcodespacerange',
    '6 beginbfchar',
    '<81> <0130>',
    '<82> <0131>',
    '<83> <015E>',
    '<84> <015F>',
    '<85> <011E>',
    '<86> <011F>',
    'endbfchar',
    'endcmap',
    'CMapName currentdict /CMap defineresource pop',
    'end',
    'end',
  ].join('\n');

  addObj('<< /Type /Catalog /Pages 2 0 R >>');
  addObj(''); // Pages placeholder
  addObj('<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding 4 0 R /ToUnicode 5 0 R >>');
  addObj(
    '<< /Type /Encoding /BaseEncoding /WinAnsiEncoding /Differences [129 /Idotaccent /dotlessi /Scedilla /scedilla /Gbreve /gbreve] >>',
  );
  addObj(
    `<< /Length ${Buffer.byteLength(toUnicodeStream, 'latin1')} >>\nstream\n${toUnicodeStream}\nendstream`,
  );

  const pageRefs: string[] = [];
  for (const lines of pages) {
    let content = 'BT\n/F1 11 Tf\n50 760 Td\n16 TL\n';
    for (const line of lines) {
      content += `(${encodeWinAnsiTr(line)}) Tj T*\n`;
    }
    content += 'ET';
    const contentId = addObj(
      `<< /Length ${Buffer.byteLength(content, 'latin1')} >>\nstream\n${content}\nendstream`,
    );
    const pageId = addObj(
      `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Resources << /Font << /F1 3 0 R >> >> /Contents ${contentId} 0 R >>`,
    );
    pageRefs.push(`${pageId} 0 R`);
  }

  objects[1] = `<< /Type /Pages /Kids [${pageRefs.join(' ')}] /Count ${pageRefs.length} >>`;

  let pdf = '%PDF-1.4\n';
  const offsets = [0];
  for (let i = 0; i < objects.length; i++) {
    offsets.push(Buffer.byteLength(pdf, 'latin1'));
    pdf += `${i + 1} 0 obj\n${objects[i]}\nendobj\n`;
  }
  const xrefPos = Buffer.byteLength(pdf, 'latin1');
  pdf += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  for (let i = 1; i <= objects.length; i++) {
    pdf += `${String(offsets[i]).padStart(10, '0')} 00000 n \n`;
  }
  pdf += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xrefPos}\n%%EOF\n`;
  return Buffer.from(pdf, 'latin1');
}

async function seed(): Promise<void> {
  await fs.mkdir(path.join(DATA_DIR, 'literatur'), { recursive: true });
  const rows = generateSurveyRows(60);

  // 1. CSV Dataset
  const csvPath = path.join(DATA_DIR, 'bap_ogrenci_anket_2026.csv');
  await fs.writeFile(csvPath, toCsv(rows), 'utf8');

  // 2. Excel (.xlsx) Dataset
  const xlsxApi = getXlsxApi();
  const wb = xlsxApi.utils.book_new();
  const ws = xlsxApi.utils.json_to_sheet(rows);
  xlsxApi.utils.book_append_sheet(wb, ws, 'Anket_Verisi');
  const xlsxBuf = xlsxApi.write(wb, { type: 'buffer', bookType: 'xlsx' }) as Buffer;
  await fs.writeFile(path.join(DATA_DIR, 'bap_anket_ozeti_2026.xlsx'), xlsxBuf);

  // 3. SQLite Read-Only Demo Database
  const sqlitePath = path.join(DATA_DIR, 'bap_arastirma.sqlite');
  await fs.rm(sqlitePath, { force: true });
  const db = new DatabaseSync(sqlitePath);
  try {
    db.exec(`
      CREATE TABLE anket_sonuclari (
        Katilimci_ID TEXT PRIMARY KEY,
        TC_Kimlik TEXT,
        Eposta TEXT,
        Grup TEXT NOT NULL,
        Bolum TEXT NOT NULL,
        OzYeterlik_Puan REAL NOT NULL,
        Tukenmislik_Puan REAL NOT NULL,
        Akademik_Basari REAL NOT NULL,
        Calisma_Saati REAL NOT NULL
      );
      CREATE TABLE olcek_alt_boyutlari (
        Boyut_Kodu TEXT PRIMARY KEY,
        Boyut_Adi TEXT NOT NULL,
        Madde_Sayisi INTEGER NOT NULL,
        Cronbach_Alpha REAL NOT NULL
      );
    `);

    const insertSurvey = db.prepare(`
      INSERT INTO anket_sonuclari (
        Katilimci_ID, TC_Kimlik, Eposta, Grup, Bolum,
        OzYeterlik_Puan, Tukenmislik_Puan, Akademik_Basari, Calisma_Saati
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);
    for (const r of rows) {
      insertSurvey.run(
        r.Katilimci_ID,
        r.TC_Kimlik,
        r.Eposta,
        r.Grup,
        r.Bolum,
        r.OzYeterlik_Puan,
        r.Tukenmislik_Puan,
        r.Akademik_Basari,
        r.Calisma_Saati,
      );
    }

    const insertScale = db.prepare(`
      INSERT INTO olcek_alt_boyutlari (Boyut_Kodu, Boyut_Adi, Madde_Sayisi, Cronbach_Alpha)
      VALUES (?, ?, ?, ?)
    `);
    insertScale.run('OY-01', 'Akademik Öz-Yeterlik', 8, 0.89);
    insertScale.run('TK-02', 'Duygusal Tükenmişlik', 6, 0.86);
    insertScale.run('YZ-03', 'Dijital Öğrenme Tutumu', 5, 0.84);
  } finally {
    db.close();
  }

  // 4. 3-Page Academic Turkish Literature PDF
  const pdfBuf = buildAcademicTurkishPdf([
    [
      'BAP-2026-ZEYNEP-01 Literatür Sentezi ve Kuramsal Çerçeve',
      '1. Giriş ve Akademik Öz-Yeterlik Kavramı',
      'Yükseköğretimde akademik öz-yeterlik inancı, öğrencilerin zorlu ders yükleri karşısındaki',
      'sebat düzeyini ve akademik başarı performansını doğrudan belirlemektedir. Son yıllarda yapılan',
      'ampirik çalışmalar, düşük öz-yeterlik algısının akademik tükenmişlik riskini artırdığını',
      'ortaya koymaktadır (Yılmaz & Kaya, 2024). Bu çalışma N = 180 lisans öğrencisi üzerinde yürütülmüştür.',
    ],
    [
      '2. Yöntem ve Ölçek Güvenilirlik Bulguları',
      'Katılımcılara Akademik Öz-Yeterlik Ölçeği ve Maslach Tükenmişlik Envanteri uygulanmıştır.',
      'Güvenirlik analizinde öz-yeterlik alt boyutu için Cronbach alpha = 0.89 ve tükenmişlik',
      'alt boyutu için alpha = 0.86 elde edilmiştir. Korelasyon analizi öz-yeterlik ile tükenmişlik',
      'arasında güçlü ve negatif bir ilişki olduğunu göstermiştir (r = -0.54, p < .001).',
    ],
    [
      '3. Hiyerarşik Regresyon ve BAP Sonuç Tartışması',
      'Hiyerarşik çoklu regresyon modeli akademik başarının anlamlı yordayıcılarını incelemiştir.',
      'Regresyon bulgularına göre öz-yeterlik ve haftalık çalışma saati toplam varyansın %38 kısmını',
      'açıklamaktadır (R² = 0.38, F(2, 177) = 54.21, p < .001). Tükenmişlik düzeyi azaldıkça',
      'dönem sonu akademik başarı puanları istatistiksel olarak anlamlı biçimde yükselmektedir.',
    ],
  ]);
  await fs.writeFile(
    path.join(DATA_DIR, 'literatur', 'bap_dijital_tukenmislik_2026.pdf'),
    pdfBuf,
  );

  console.error(`[hypotheca-seed] Demo BAP verileri oluşturuldu: ${DATA_DIR}`);
}

seed().catch((err) => {
  console.error(err);
  process.exit(1);
});

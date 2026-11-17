import { AnalysisOutput, Dataset } from '../../types/interfaces';
import { generateCombinedScript } from './scriptGenerator';

export interface OsfManifest {
  schema: string;
  generator: string;
  createdAt: string;
  dataset: {
    name: string;
    sha256: string;
    rows: number;
    columns: number;
  };
  analyses: {
    id: string;
    type: string;
    title: string;
    params: Record<string, unknown>;
  }[];
  environment: {
    runtime: string;
    note: string;
  };
}

const CRC32_TABLE: Uint32Array = (() => {
  const table = new Uint32Array(256);
  for (let i = 0; i < 256; i++) {
    let c = i;
    for (let k = 0; k < 8; k++) {
      c = (c & 1) !== 0 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    }
    table[i] = c >>> 0;
  }
  return table;
})();

export function crc32(bytes: Uint8Array): number {
  let crc = 0xffffffff;
  for (let i = 0; i < bytes.length; i++) {
    crc = CRC32_TABLE[(crc ^ bytes[i]) & 0xff] ^ (crc >>> 8);
  }
  return (crc ^ 0xffffffff) >>> 0;
}

const SHA256_K = new Uint32Array([
  0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5,
  0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174,
  0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
  0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967,
  0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85,
  0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
  0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3,
  0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2,
]);

function rotr(value: number, bits: number): number {
  return (value >>> bits) | (value << (32 - bits));
}

/** Deterministic pure-TS FIPS 180-4 SHA-256 fallback when Web Crypto is absent. */
export function sha256Fallback(data: Uint8Array): string {
  const bitLen = data.length * 8;
  const paddedLen = Math.ceil((data.length + 9) / 64) * 64;
  const padded = new Uint8Array(paddedLen);
  padded.set(data);
  padded[data.length] = 0x80;
  const view = new DataView(padded.buffer);
  view.setUint32(paddedLen - 8, Math.floor(bitLen / 0x100000000), false);
  view.setUint32(paddedLen - 4, bitLen >>> 0, false);

  const H = new Uint32Array([
    0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a,
    0x510e527f, 0x9b05688c, 0x1f83d9ab, 0x5be0cd19,
  ]);
  const w = new Uint32Array(64);

  for (let offset = 0; offset < paddedLen; offset += 64) {
    for (let i = 0; i < 16; i++) {
      w[i] = view.getUint32(offset + i * 4, false);
    }
    for (let i = 16; i < 64; i++) {
      const s0 = rotr(w[i - 15], 7) ^ rotr(w[i - 15], 18) ^ (w[i - 15] >>> 3);
      const s1 = rotr(w[i - 2], 17) ^ rotr(w[i - 2], 19) ^ (w[i - 2] >>> 10);
      w[i] = (w[i - 16] + s0 + w[i - 7] + s1) >>> 0;
    }

    let [a, b, c, d, e, f, g, h] = H;
    for (let i = 0; i < 64; i++) {
      const S1 = rotr(e, 6) ^ rotr(e, 11) ^ rotr(e, 25);
      const ch = (e & f) ^ (~e & g);
      const temp1 = (h + S1 + ch + SHA256_K[i] + w[i]) >>> 0;
      const S0 = rotr(a, 2) ^ rotr(a, 13) ^ rotr(a, 22);
      const maj = (a & b) ^ (a & c) ^ (b & c);
      const temp2 = (S0 + maj) >>> 0;

      h = g;
      g = f;
      f = e;
      e = (d + temp1) >>> 0;
      d = c;
      c = b;
      b = a;
      a = (temp1 + temp2) >>> 0;
    }

    H[0] = (H[0] + a) >>> 0;
    H[1] = (H[1] + b) >>> 0;
    H[2] = (H[2] + c) >>> 0;
    H[3] = (H[3] + d) >>> 0;
    H[4] = (H[4] + e) >>> 0;
    H[5] = (H[5] + f) >>> 0;
    H[6] = (H[6] + g) >>> 0;
    H[7] = (H[7] + h) >>> 0;
  }

  return Array.from(H, (x) => x.toString(16).padStart(8, '0')).join('');
}

export function buildZipArchive(files: { path: string; content: string | Uint8Array }[]): Uint8Array {
  const encoder = new TextEncoder();
  const dosTime = 0x0000;
  const dosDate = ((2026 - 1980) << 9) | (11 << 5) | 16; // 2026-11-16

  interface PreparedEntry {
    nameBytes: Uint8Array;
    dataBytes: Uint8Array;
    crc: number;
    localOffset: number;
  }

  const entries: PreparedEntry[] = [];
  let localTotal = 0;
  let cdTotal = 0;

  for (const file of files) {
    const cleanPath = file.path.replace(/\\/g, '/').replace(/^\/+/, '');
    const nameBytes = encoder.encode(cleanPath);
    const dataBytes =
      typeof file.content === 'string' ? encoder.encode(file.content) : file.content;
    const crc = crc32(dataBytes);
    entries.push({ nameBytes, dataBytes, crc, localOffset: localTotal });
    localTotal += 30 + nameBytes.length + dataBytes.length;
    cdTotal += 46 + nameBytes.length;
  }

  const totalSize = localTotal + cdTotal + 22;
  const buffer = new Uint8Array(totalSize);
  const view = new DataView(buffer.buffer);

  let pos = 0;
  for (const entry of entries) {
    view.setUint32(pos, 0x04034b50, true); // Local file header signature
    view.setUint16(pos + 4, 20, true); // Version needed
    view.setUint16(pos + 6, 0x0800, true); // UTF-8 filename flag
    view.setUint16(pos + 8, 0, true); // Compression method: 0 (STORE)
    view.setUint16(pos + 10, dosTime, true);
    view.setUint16(pos + 12, dosDate, true);
    view.setUint32(pos + 14, entry.crc, true);
    view.setUint32(pos + 18, entry.dataBytes.length, true);
    view.setUint32(pos + 22, entry.dataBytes.length, true);
    view.setUint16(pos + 26, entry.nameBytes.length, true);
    view.setUint16(pos + 28, 0, true); // Extra field length
    pos += 30;
    buffer.set(entry.nameBytes, pos);
    pos += entry.nameBytes.length;
    buffer.set(entry.dataBytes, pos);
    pos += entry.dataBytes.length;
  }

  const cdStart = pos;
  for (const entry of entries) {
    view.setUint32(pos, 0x02014b50, true); // Central directory header signature
    view.setUint16(pos + 4, 0x0314, true); // Version made by (Unix, 2.0)
    view.setUint16(pos + 6, 20, true); // Version needed
    view.setUint16(pos + 8, 0x0800, true); // UTF-8 flag
    view.setUint16(pos + 10, 0, true); // STORE
    view.setUint16(pos + 12, dosTime, true);
    view.setUint16(pos + 14, dosDate, true);
    view.setUint32(pos + 16, entry.crc, true);
    view.setUint32(pos + 20, entry.dataBytes.length, true);
    view.setUint32(pos + 24, entry.dataBytes.length, true);
    view.setUint16(pos + 28, entry.nameBytes.length, true);
    view.setUint16(pos + 30, 0, true); // Extra len
    view.setUint16(pos + 32, 0, true); // Comment len
    view.setUint16(pos + 34, 0, true); // Disk start
    view.setUint16(pos + 36, 0, true); // Internal attrs
    view.setUint32(pos + 38, 0, true); // External attrs
    view.setUint32(pos + 42, entry.localOffset, true);
    pos += 46;
    buffer.set(entry.nameBytes, pos);
    pos += entry.nameBytes.length;
  }

  view.setUint32(pos, 0x06054b50, true); // End of central directory signature
  view.setUint16(pos + 4, 0, true);
  view.setUint16(pos + 6, 0, true);
  view.setUint16(pos + 8, entries.length, true);
  view.setUint16(pos + 10, entries.length, true);
  view.setUint32(pos + 12, cdTotal, true);
  view.setUint32(pos + 16, cdStart, true);
  view.setUint16(pos + 20, 0, true);

  return buffer;
}

function escapeCsvCell(value: unknown): string {
  if (value === null || value === undefined) return '';
  const str = String(value);
  if (/[",\n\r]/.test(str)) {
    return `"${str.replace(/"/g, '""')}"`;
  }
  return str;
}

export function datasetToCsv(dataset: Dataset): string {
  const colNames =
    dataset.columns.length > 0
      ? dataset.columns.map((c) => c.name)
      : dataset.rows.length > 0
        ? Object.keys(dataset.rows[0])
        : [];
  if (colNames.length === 0) return '';

  const lines: string[] = [colNames.map(escapeCsvCell).join(',')];
  for (const row of dataset.rows) {
    lines.push(colNames.map((col) => escapeCsvCell(row[col])).join(','));
  }
  return lines.join('\n');
}

export async function computeDatasetSha256(dataset: Dataset): Promise<string> {
  const csv = datasetToCsv(dataset);
  const bytes = new TextEncoder().encode(csv);

  if (typeof globalThis.crypto !== 'undefined' && globalThis.crypto.subtle) {
    try {
      const digest = await globalThis.crypto.subtle.digest('SHA-256', bytes);
      return Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, '0')).join('');
    } catch {
      return sha256Fallback(bytes);
    }
  }

  return sha256Fallback(bytes);
}

function sanitizeDatasetStem(name: string): string {
  const stem = (name || 'dataset').replace(/\.csv$/i, '');
  const clean = stem.replace(/[^A-Za-z0-9._-]+/g, '_').replace(/^_+|_+$/g, '');
  return clean || 'dataset';
}

function buildReadmeMarkdown(
  manifest: OsfManifest,
  dataPath: string,
  preregNotes?: string,
): string {
  const analysesList =
    manifest.analyses.length > 0
      ? manifest.analyses
          .map((a, idx) => `${idx + 1}. **${a.title}** (\`${a.type}\`, ID: \`${a.id}\`)`)
          .join('\n')
      : '_No analyses executed yet._';

  const notesBlock =
    preregNotes && preregNotes.trim().length > 0
      ? preregNotes.trim()
      : '_No preregistration notes supplied._';

  return [
    `# Hypotheca Open-Science Reproducibility Archive`,
    '',
    `Generated by **${manifest.generator}** on \`${manifest.createdAt}\`.`,
    '',
    '## Dataset Integrity Fingerprint',
    '',
    `- **Dataset Name:** \`${manifest.dataset.name}\``,
    `- **Archive CSV Path:** \`${dataPath}\``,
    `- **Dimensions:** ${manifest.dataset.rows} rows × ${manifest.dataset.columns} columns`,
    `- **SHA-256 Checksum:** \`${manifest.dataset.sha256}\``,
    '',
    '## Preregistration & Research Notes',
    '',
    notesBlock,
    '',
    '## Executed Analyses',
    '',
    analysesList,
    '',
    '## Reproduction Instructions',
    '',
    'Extract this ZIP archive and execute any of the included scripts from the bundle root directory:',
    '',
    '- **R:** `Rscript scripts/analysis_reproducible.R`',
    '- **Python:** `python3 scripts/analysis_reproducible.py`',
    '- **SPSS:** Open `scripts/analysis_spss.sps` after loading the CSV in `data/`.',
    '- **Tables & Summaries:** Inspect `results/summary_tables.json` and `manifest.json`.',
    '',
  ].join('\n');
}

export async function createOsfBundle(
  dataset: Dataset,
  history: AnalysisOutput[],
  preregNotes?: string,
): Promise<{ manifest: OsfManifest; zipBytes: Uint8Array; fileList: string[] }> {
  const createdAt = new Date().toISOString();
  const sha256 = await computeDatasetSha256(dataset);
  const safeDatasetName = sanitizeDatasetStem(dataset.name);
  const dataPath = `data/${safeDatasetName}.csv`;

  const manifest: OsfManifest = {
    schema: 'https://hypotheca.org/schemas/osf-bundle/v1',
    generator: 'Hypotheca v1.0',
    createdAt,
    dataset: {
      name: dataset.name,
      sha256,
      rows: dataset.rows.length,
      columns: dataset.columns.length,
    },
    analyses: history.map((item) => ({
      id: item.id,
      type: item.analysisType,
      title: item.title,
      params: item.params,
    })),
    environment: {
      runtime: typeof navigator !== 'undefined' ? navigator.userAgent : 'TypeScript / Browser-Native Engine',
      note: 'Browser-based statistical analysis archive.',
    },
  };

  const csvContent = datasetToCsv(dataset);
  const rScript = generateCombinedScript(history, dataPath, 'r');
  const pyScript = generateCombinedScript(history, dataPath, 'python');
  const spssScript = generateCombinedScript(history, dataPath, 'spss_syntax');
  const readmeContent = buildReadmeMarkdown(manifest, dataPath, preregNotes);

  const summaryPayload = {
    schema: manifest.schema,
    generatedAt: createdAt,
    datasetSha256: sha256,
    preregistrationNotes: preregNotes?.trim() || '',
    analyses: history.map((a) => ({
      id: a.id,
      analysisType: a.analysisType,
      title: a.title,
      createdAt: a.createdAt,
      params: a.params,
      summary: a.summary,
      assumptions: a.assumptions ?? [],
      tables: a.tables,
      narrativeTr: a.narrativeTr ?? '',
      narrativeEn: a.narrativeEn ?? '',
    })),
  };

  const files: { path: string; content: string }[] = [
    { path: 'README.md', content: readmeContent },
    { path: 'manifest.json', content: JSON.stringify(manifest, null, 2) },
    { path: dataPath, content: csvContent },
    { path: 'scripts/analysis_reproducible.R', content: rScript },
    { path: 'scripts/analysis_reproducible.py', content: pyScript },
    { path: 'scripts/analysis_spss.sps', content: spssScript },
    { path: 'results/summary_tables.json', content: JSON.stringify(summaryPayload, null, 2) },
  ];

  const zipBytes = buildZipArchive(files);
  const fileList = files.map((f) => f.path);

  return { manifest, zipBytes, fileList };
}

import { AnalysisOutput, Dataset } from '../../types/interfaces';

export interface ReviewAnnotation {
  id: string;
  targetAnalysisId: string;
  authorName: string;
  authorRole: 'Advisor' | 'CoAuthor' | 'Reviewer';
  status: 'approved' | 'revision_needed' | 'comment';
  comment: string;
  createdAt: string;
}

export interface HypothecaProjectSnapshot {
  format: 'hypotheca-study-v1';
  exportedAt: string;
  projectName: string;
  ownerName: string;
  dataset: Dataset;
  history: AnalysisOutput[];
  annotations: ReviewAnnotation[];
  checksum: string;
}

const VALID_ROLES = new Set<ReviewAnnotation['authorRole']>(['Advisor', 'CoAuthor', 'Reviewer']);
const VALID_STATUSES = new Set<ReviewAnnotation['status']>(['approved', 'revision_needed', 'comment']);

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

function encodeUtf8(text: string): Uint8Array {
  if (typeof TextEncoder !== 'undefined') {
    return new TextEncoder().encode(text);
  }
  const encoded = unescape(encodeURIComponent(text));
  const out = new Uint8Array(encoded.length);
  for (let i = 0; i < encoded.length; i++) {
    out[i] = encoded.charCodeAt(i);
  }
  return out;
}

/**
 * Deterministic pure TypeScript SHA-256 digest returning 64 lowercase hex characters.
 */
export function sha256Hex(text: string): string {
  const bytes = encodeUtf8(text);
  const bitLen = bytes.length * 8;
  const paddedLen = Math.ceil((bytes.length + 9) / 64) * 64;
  const padded = new Uint8Array(paddedLen);
  padded.set(bytes);
  padded[bytes.length] = 0x80;

  const view = new DataView(padded.buffer);
  const highBits = Math.floor(bitLen / 0x100000000);
  const lowBits = bitLen >>> 0;
  view.setUint32(paddedLen - 8, highBits, false);
  view.setUint32(paddedLen - 4, lowBits, false);

  let h0 = 0x6a09e667;
  let h1 = 0xbb67ae85;
  let h2 = 0x3c6ef372;
  let h3 = 0xa54ff53a;
  let h4 = 0x510e527f;
  let h5 = 0x9b05688c;
  let h6 = 0x1f83d9ab;
  let h7 = 0x5be0cd19;

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

    let a = h0;
    let b = h1;
    let c = h2;
    let d = h3;
    let e = h4;
    let f = h5;
    let g = h6;
    let h = h7;

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

    h0 = (h0 + a) >>> 0;
    h1 = (h1 + b) >>> 0;
    h2 = (h2 + c) >>> 0;
    h3 = (h3 + d) >>> 0;
    h4 = (h4 + e) >>> 0;
    h5 = (h5 + f) >>> 0;
    h6 = (h6 + g) >>> 0;
    h7 = (h7 + h) >>> 0;
  }

  return [h0, h1, h2, h3, h4, h5, h6, h7]
    .map((val) => val.toString(16).padStart(8, '0'))
    .join('');
}

function canonicalStringify(value: unknown): string {
  if (value === null || value === undefined) {
    return 'null';
  }
  if (typeof value === 'boolean' || typeof value === 'string') {
    return JSON.stringify(value);
  }
  if (typeof value === 'number') {
    return Number.isFinite(value) ? JSON.stringify(value) : 'null';
  }
  if (typeof value === 'object') {
    const withToJson = value as { toJSON?: () => unknown };
    if (typeof withToJson.toJSON === 'function') {
      return canonicalStringify(withToJson.toJSON());
    }
    if (Array.isArray(value)) {
      const items = value.map((item) =>
        item === undefined || typeof item === 'function' || typeof item === 'symbol'
          ? 'null'
          : canonicalStringify(item),
      );
      return `[${items.join(',')}]`;
    }
    const obj = value as Record<string, unknown>;
    const keys = Object.keys(obj).sort();
    const parts: string[] = [];
    for (const k of keys) {
      const v = obj[k];
      if (v === undefined || typeof v === 'function' || typeof v === 'symbol') continue;
      parts.push(`${JSON.stringify(k)}:${canonicalStringify(v)}`);
    }
    return `{${parts.join(',')}}`;
  }
  return 'null';
}

function computeSnapshotChecksum(payload: Omit<HypothecaProjectSnapshot, 'checksum'>): string {
  return sha256Hex(canonicalStringify(payload));
}

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

/**
 * Create a structured review/advisor annotation pinned to an analysis output.
 */
export function createAnnotation(
  targetAnalysisId: string,
  authorName: string,
  authorRole: ReviewAnnotation['authorRole'],
  status: ReviewAnnotation['status'],
  comment: string,
): ReviewAnnotation {
  const cleanAuthor = authorName.trim() || 'Anonymous';
  const cleanTarget = targetAnalysisId.trim() || 'study-general';
  return {
    id: `ann-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
    targetAnalysisId: cleanTarget,
    authorName: cleanAuthor,
    authorRole,
    status,
    comment: comment.trim(),
    createdAt: new Date().toISOString(),
  };
}

/**
 * Build a self-contained `.hypotheca.json` study archive snapshot with a deterministic
 * SHA-256 integrity checksum over dataset, history, annotations, and study metadata.
 */
export function exportProjectSnapshot(opts: {
  projectName: string;
  ownerName: string;
  dataset: Dataset;
  history: AnalysisOutput[];
  annotations: ReviewAnnotation[];
}): HypothecaProjectSnapshot {
  const payload: Omit<HypothecaProjectSnapshot, 'checksum'> = {
    format: 'hypotheca-study-v1',
    exportedAt: new Date().toISOString(),
    projectName: opts.projectName.trim() || opts.dataset.name || 'Hypotheca Study',
    ownerName: opts.ownerName.trim() || 'Researcher',
    dataset: JSON.parse(JSON.stringify(opts.dataset)) as Dataset,
    history: JSON.parse(JSON.stringify(opts.history)) as AnalysisOutput[],
    annotations: JSON.parse(JSON.stringify(opts.annotations)) as ReviewAnnotation[],
  };
  const checksum = computeSnapshotChecksum(payload);
  return {
    ...payload,
    checksum,
  };
}

function validateDatasetIntegrity(ds: unknown): asserts ds is Dataset {
  if (!isPlainObject(ds)) {
    throw new Error('Snapshot dataset is missing or invalid.');
  }
  if (typeof ds.id !== 'string' || !ds.id.trim()) {
    throw new Error('Snapshot dataset.id must be a non-empty string.');
  }
  if (typeof ds.name !== 'string') {
    throw new Error('Snapshot dataset.name must be a string.');
  }
  if (typeof ds.createdAt !== 'string') {
    throw new Error('Snapshot dataset.createdAt must be a string.');
  }
  if (!Array.isArray(ds.columns)) {
    throw new Error('Snapshot dataset.columns must be an array.');
  }
  for (let i = 0; i < ds.columns.length; i++) {
    const col = ds.columns[i];
    if (
      !isPlainObject(col) ||
      typeof col.name !== 'string' ||
      typeof col.valueType !== 'string' ||
      typeof col.scale !== 'string'
    ) {
      throw new Error(`Invalid column metadata at dataset.columns[${i}].`);
    }
  }
  if (!Array.isArray(ds.rows)) {
    throw new Error('Snapshot dataset.rows must be an array.');
  }
  for (let i = 0; i < ds.rows.length; i++) {
    if (!isPlainObject(ds.rows[i])) {
      throw new Error(`Invalid data row object at dataset.rows[${i}].`);
    }
  }
}

/**
 * Parse and strictly validate an imported `.hypotheca.json` study snapshot,
 * verifying format tag, dataset structure, history/annotation schemas, and SHA-256 checksum.
 */
export function parseAndValidateSnapshot(jsonText: string): HypothecaProjectSnapshot {
  let parsed: unknown;
  try {
    parsed = JSON.parse(jsonText);
  } catch {
    throw new Error('Invalid JSON syntax in .hypotheca.json study snapshot.');
  }

  if (!isPlainObject(parsed)) {
    throw new Error('Snapshot root must be a JSON object.');
  }
  if (parsed.format !== 'hypotheca-study-v1') {
    throw new Error(`Unsupported snapshot format: "${String(parsed.format ?? 'unknown')}". Expected "hypotheca-study-v1".`);
  }
  if (typeof parsed.exportedAt !== 'string' || !parsed.exportedAt) {
    throw new Error('Snapshot missing exportedAt timestamp.');
  }
  if (typeof parsed.projectName !== 'string' || !parsed.projectName.trim()) {
    throw new Error('Snapshot missing projectName.');
  }
  if (typeof parsed.ownerName !== 'string' || !parsed.ownerName.trim()) {
    throw new Error('Snapshot missing ownerName.');
  }
  if (typeof parsed.checksum !== 'string' || !/^[0-9a-f]{64}$/i.test(parsed.checksum)) {
    throw new Error('Snapshot missing or malformed SHA-256 checksum.');
  }

  validateDatasetIntegrity(parsed.dataset);

  if (!Array.isArray(parsed.history)) {
    throw new Error('Snapshot history must be an array.');
  }
  for (let i = 0; i < parsed.history.length; i++) {
    const item = parsed.history[i];
    if (
      !isPlainObject(item) ||
      typeof item.id !== 'string' ||
      typeof item.analysisType !== 'string' ||
      typeof item.title !== 'string'
    ) {
      throw new Error(`Invalid analysis output at history[${i}].`);
    }
  }

  if (!Array.isArray(parsed.annotations)) {
    throw new Error('Snapshot annotations must be an array.');
  }
  for (let i = 0; i < parsed.annotations.length; i++) {
    const ann = parsed.annotations[i];
    if (
      !isPlainObject(ann) ||
      typeof ann.id !== 'string' ||
      typeof ann.targetAnalysisId !== 'string' ||
      typeof ann.authorName !== 'string' ||
      !VALID_ROLES.has(ann.authorRole as ReviewAnnotation['authorRole']) ||
      !VALID_STATUSES.has(ann.status as ReviewAnnotation['status']) ||
      typeof ann.comment !== 'string' ||
      typeof ann.createdAt !== 'string'
    ) {
      throw new Error(`Invalid review annotation at annotations[${i}].`);
    }
  }

  const payload: Omit<HypothecaProjectSnapshot, 'checksum'> = {
    format: 'hypotheca-study-v1',
    exportedAt: parsed.exportedAt,
    projectName: parsed.projectName,
    ownerName: parsed.ownerName,
    dataset: parsed.dataset as unknown as Dataset,
    history: parsed.history as unknown as AnalysisOutput[],
    annotations: parsed.annotations as unknown as ReviewAnnotation[],
  };

  const expectedChecksum = computeSnapshotChecksum(payload);
  if (expectedChecksum !== parsed.checksum.toLowerCase()) {
    throw new Error(
      `Checksum verification failed: expected ${expectedChecksum.slice(0, 12)}..., got ${parsed.checksum.slice(0, 12)}... (snapshot may be modified or corrupted).`,
    );
  }

  return {
    ...payload,
    checksum: parsed.checksum.toLowerCase(),
  };
}

/**
 * Typed input/validation errors for the statistical engine.
 * `message` always carries the Turkish text so existing UI error surfaces stay Turkish.
 */

export class StatInputError extends Error {
  code: string;
  messageTr: string;
  messageEn: string;

  constructor(code: string, messageTr: string, messageEn: string) {
    super(messageTr);
    this.name = 'StatInputError';
    this.code = code;
    this.messageTr = messageTr;
    this.messageEn = messageEn;
    Object.setPrototypeOf(this, StatInputError.prototype);
  }
}

export function isStatInputError(e: unknown): e is StatInputError {
  return e instanceof StatInputError;
}

/* ------------------------------------------------------------------ */
/* Shared guards                                                       */
/* ------------------------------------------------------------------ */

/** Throws INSUFFICIENT_N when n < min. */
export function assertMinN(n: number, min: number, labelTr: string, labelEn: string = labelTr): void {
  if (!Number.isFinite(n) || n < min) {
    if (!n) {
      throw new StatInputError(
        'EMPTY_DATA',
        `${labelTr}: geçerli (eksiksiz sayısal) gözlem bulunamadı. En az ${min} gözlem gereklidir.`,
        `${labelEn}: no valid (complete numeric) observations found. At least ${min} are required.`,
      );
    }
    throw new StatInputError(
      'INSUFFICIENT_N',
      `${labelTr}: geçerli gözlem sayısı (${n}) yetersiz. En az ${min} gözlem gereklidir.`,
      `${labelEn}: number of valid observations (${n}) is insufficient. At least ${min} are required.`,
    );
  }
}

/** Sample variance helper that never returns NaN. */
function sampleVar(arr: number[]): number {
  const n = arr.length;
  if (n < 2) return 0;
  let m = 0;
  for (const v of arr) m += v;
  m /= n;
  let ss = 0;
  for (const v of arr) ss += (v - m) * (v - m);
  return ss / (n - 1);
}

/** Relative tolerance check for a constant column (robust to large offsets). */
export function isConstant(arr: number[]): boolean {
  if (arr.length < 2) return true;
  const v = sampleVar(arr);
  let scale = 0;
  for (const x of arr) scale = Math.max(scale, Math.abs(x));
  return !(v > 1e-24 * Math.max(1, scale * scale));
}

/** Throws ZERO_VARIANCE when the array has (numerically) no spread. */
export function assertNonZeroVariance(arr: number[], labelTr: string, labelEn: string = labelTr): void {
  if (isConstant(arr)) {
    throw new StatInputError(
      'ZERO_VARIANCE',
      `"${labelTr}" değişkeninin varyansı sıfır (tüm değerler aynı); bu analiz hesaplanamaz.`,
      `"${labelEn}" has zero variance (all values identical); this analysis cannot be computed.`,
    );
  }
}

/** Clamp a p-value into [0, 1]. NaN stays NaN (undefined, rendered as missing), +/-Infinity map to 1 / 0. */
export function clampP(p: number): number {
  if (Number.isNaN(p)) return NaN;
  return Math.min(1, Math.max(0, p));
}

/** Return v when finite, otherwise the fallback. */
export function finiteOr(v: number, fallback: number): number {
  return Number.isFinite(v) ? v : fallback;
}

/** Parse a raw cell into a finite number or null (shared, consistent missing handling). */
export function toFiniteNumber(raw: unknown): number | null {
  if (raw === null || raw === undefined || raw === '') return null;
  if (typeof raw === 'number') return Number.isFinite(raw) ? raw : null;
  if (typeof raw === 'boolean') return null;
  const s = String(raw).trim();
  if (s === '') return null;
  const v = Number(s.replace(',', '.'));
  return Number.isFinite(v) ? v : null;
}

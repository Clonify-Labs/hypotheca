import fs from 'node:fs/promises';
import path from 'node:path';

export const MAX_DATA_FILE_BYTES = 50 * 1024 * 1024;

export class SandboxSecurityError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SandboxSecurityError';
  }
}

const PII_COLUMN_NAME_REGEX =
  /^(tc_?kimlik|tckn|kimlik_?no|ad_?soyad|isim|soyisim|ad|soyad|eposta|e_?mail|mail|telefon|cep_?tel|gsm|ogrenci_?no|hasta_?adi|adres)$/i;

const TCKN_VALUE_REGEX = /^\s*[1-9]\d{10}\s*$/;
const EMAIL_VALUE_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const PHONE_VALUE_REGEX = /^(?:\+?90|0)?\s*\(?5\d{2}\)?[\s.-]*\d{3}[\s.-]*\d{2}[\s.-]*\d{2}$/;

const TEXT_EMAIL_REGEX = /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g;
const TEXT_TCKN_REGEX = /\b[1-9]\d{10}\b/g;
const TEXT_PHONE_REGEX = /(?:\+?90|0)\s*\(?5\d{2}\)?[\s.-]*\d{3}[\s.-]*\d{2}[\s.-]*\d{2}/g;

export async function resolveSafeFilePath(
  dataDir: string,
  relativeFilePath: string,
  allowedExtensions: readonly string[],
): Promise<string> {
  if (!relativeFilePath || typeof relativeFilePath !== 'string') {
    throw new SandboxSecurityError('Dosya yolu boş olamaz.');
  }
  if (relativeFilePath.includes('\0')) {
    throw new SandboxSecurityError('Dosya yolunda geçersiz karakter tespit edildi.');
  }
  if (path.isAbsolute(relativeFilePath)) {
    throw new SandboxSecurityError(
      'Güvenlik politikası: Yalnızca HYPOTHECA_DATA_DIR içine göreli dosya yollarına izin verilir.',
    );
  }

  let dataDirReal: string;
  try {
    dataDirReal = await fs.realpath(path.resolve(dataDir));
  } catch {
    throw new SandboxSecurityError(`Veri dizini bulunamadı: ${dataDir}`);
  }

  const candidatePath = path.resolve(dataDirReal, relativeFilePath);
  if (candidatePath !== dataDirReal && !candidatePath.startsWith(`${dataDirReal}${path.sep}`)) {
    throw new SandboxSecurityError(
      `Erişim engellendi (path traversal koruması): "${relativeFilePath}" izin verilen veri dizini dışında.`,
    );
  }

  let targetReal: string;
  try {
    targetReal = await fs.realpath(candidatePath);
  } catch {
    throw new SandboxSecurityError(`Dosya bulunamadı veya erişilemiyor: ${relativeFilePath}`);
  }

  if (targetReal !== dataDirReal && !targetReal.startsWith(`${dataDirReal}${path.sep}`)) {
    throw new SandboxSecurityError(
      `Erişim engellendi (path traversal koruması): "${relativeFilePath}" izin verilen veri dizini dışında.`,
    );
  }

  const ext = path.extname(targetReal).toLowerCase();
  if (!allowedExtensions.includes(ext)) {
    throw new SandboxSecurityError(
      `Desteklenmeyen dosya uzantısı "${ext}". İzin verilenler: ${allowedExtensions.join(', ')}`,
    );
  }

  const stats = await fs.stat(targetReal);
  if (!stats.isFile()) {
    throw new SandboxSecurityError(`Belirtilen yol bir dosya değil: ${relativeFilePath}`);
  }
  if (stats.size > MAX_DATA_FILE_BYTES) {
    throw new SandboxSecurityError(
      `Dosya boyutu güvenlik sınırını aşıyor (${Math.round(stats.size / (1024 * 1024))} MB > 50 MB).`,
    );
  }

  return targetReal;
}

export function isPiiColumn(columnName: string, sampleValues: unknown[]): boolean {
  const normalized = columnName.trim().toLocaleLowerCase('tr');
  if (PII_COLUMN_NAME_REGEX.test(normalized)) {
    return true;
  }

  const nonEmptyStrings = sampleValues
    .filter((v) => v !== null && v !== undefined && String(v).trim() !== '')
    .slice(0, 50)
    .map((v) => String(v).trim());

  if (nonEmptyStrings.length < 3) {
    return false;
  }

  let piiHits = 0;
  for (const val of nonEmptyStrings) {
    if (
      TCKN_VALUE_REGEX.test(val) ||
      EMAIL_VALUE_REGEX.test(val) ||
      PHONE_VALUE_REGEX.test(val)
    ) {
      piiHits++;
    }
  }

  return piiHits / nonEmptyStrings.length >= 0.3;
}

export function redactPiiInText(text: string): string {
  return text
    .replace(TEXT_EMAIL_REGEX, '[E-POSTA GİZLENDİ]')
    .replace(TEXT_PHONE_REGEX, '[TELEFON GİZLENDİ]')
    .replace(TEXT_TCKN_REGEX, '[TCKN GİZLENDİ]');
}

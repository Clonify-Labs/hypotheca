import fs from 'node:fs/promises';
import { extractText, getDocumentProxy } from 'unpdf';
import { redactPiiInText, resolveSafeFilePath } from '../security/sandbox.js';

export const PDF_EXTENSIONS = ['.pdf'] as const;

export interface ReadLiteraturePdfInput {
  filePath: string;
  keywords: string[];
  maxExcerpts?: number;
  contextSentences?: number;
}

export interface PdfExcerpt {
  page: number;
  score: number;
  matchedKeywords: string[];
  statisticalCues: string[];
  excerpt: string;
}

function foldTurkish(text: string): string {
  return text
    .replace(/İ/g, 'i')
    .replace(/I/g, 'i')
    .replace(/ı/g, 'i')
    .toLocaleLowerCase('tr')
    .replace(/ş/g, 's')
    .replace(/ğ/g, 'g')
    .replace(/ü/g, 'u')
    .replace(/ö/g, 'o')
    .replace(/ç/g, 'c')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '');
}

function countOccurrences(haystack: string, needle: string): number {
  if (!needle) return 0;
  let count = 0;
  let pos = 0;
  while ((pos = haystack.indexOf(needle, pos)) !== -1) {
    count++;
    pos += needle.length;
  }
  return count;
}

function extractStatisticalCues(text: string): string[] {
  const cues = new Set<string>();
  const patterns = [
    /\bN\s*=\s*\d+/gi,
    /\bp\s*[<≤=]\s*0?\.\d+/gi,
    /\br\s*=\s*-?0?\.\d+/gi,
    /(?:α|alpha|Cronbach)\s*=?\s*0?\.\d+/gi,
    /\bR²\s*=\s*0?\.\d+/gi,
    /\b[tF]\s*\([^)]+\)\s*=\s*-?\d+(?:\.\d+)?/gi,
  ];
  for (const re of patterns) {
    const matches = text.match(re);
    if (matches) {
      for (const m of matches.slice(0, 4)) {
        cues.add(m.replace(/\s+/g, ' ').trim());
      }
    }
  }
  return Array.from(cues);
}

function splitPageSegments(pageText: string, contextSentences: number): string[] {
  const normalized = pageText.replace(/\r/g, '').trim();
  if (!normalized) return [];

  const paragraphs = normalized
    .split(/\n{2,}/)
    .map((p) => p.replace(/\s+/g, ' ').trim())
    .filter((p) => p.length >= 25);

  if (paragraphs.length >= 2) {
    return paragraphs;
  }

  const sentences = normalized
    .replace(/\s+/g, ' ')
    .split(/(?<=[.!?])\s+/)
    .map((s) => s.trim())
    .filter(Boolean);

  if (!sentences.length) return [normalized];

  const windowSize = Math.max(1, Math.min(5, contextSentences));
  const segments: string[] = [];
  for (let i = 0; i < sentences.length; i += Math.max(1, windowSize - 1)) {
    const chunk = sentences.slice(i, i + windowSize).join(' ').trim();
    if (chunk) segments.push(chunk);
    if (i + windowSize >= sentences.length) break;
  }
  return segments;
}

export async function readLiteraturePdf(
  dataDir: string,
  input: ReadLiteraturePdfInput,
): Promise<{
  filePath: string;
  totalPages: number;
  keywords: string[];
  keywordHitSummary: Record<string, number>;
  excerpts: PdfExcerpt[];
  synthesisOverview: string;
}> {
  const cleanKeywords = input.keywords.map((k) => k.trim()).filter(Boolean);
  if (!cleanKeywords.length) {
    throw new Error('En az bir anahtar kelime (keywords) belirtilmelidir.');
  }

  const maxExcerpts = Math.max(1, Math.min(20, input.maxExcerpts ?? 8));
  const contextSentences = Math.max(1, Math.min(5, input.contextSentences ?? 2));
  const safePath = await resolveSafeFilePath(dataDir, input.filePath, PDF_EXTENSIONS);

  const fileBytes = new Uint8Array(await fs.readFile(safePath));
  const pdf = await getDocumentProxy(fileBytes);
  const { totalPages, text: pages } = await extractText(pdf, { mergePages: false });

  const keywordHitSummary: Record<string, number> = {};
  for (const kw of cleanKeywords) {
    keywordHitSummary[kw] = 0;
  }

  const candidates: PdfExcerpt[] = [];

  pages.forEach((rawPageText, index) => {
    const pageNumber = index + 1;
    const segments = splitPageSegments(rawPageText ?? '', contextSentences);

    for (const seg of segments) {
      const lowerTr = seg.toLocaleLowerCase('tr');
      const folded = foldTurkish(seg);
      const matchedKeywords: string[] = [];
      let totalHits = 0;

      for (const kw of cleanKeywords) {
        const kwTr = kw.toLocaleLowerCase('tr');
        const kwFolded = foldTurkish(kw);
        const exactCount = countOccurrences(lowerTr, kwTr);
        const foldedCount = kwFolded === kwTr ? exactCount : Math.max(exactCount, countOccurrences(folded, kwFolded));

        if (foldedCount > 0) {
          matchedKeywords.push(kw);
          totalHits += foldedCount;
          keywordHitSummary[kw] += foldedCount;
        }
      }

      if (matchedKeywords.length > 0) {
        const score = matchedKeywords.length * 10 + totalHits;
        const safeExcerpt = redactPiiInText(seg).slice(0, 1200);
        candidates.push({
          page: pageNumber,
          score,
          matchedKeywords,
          statisticalCues: extractStatisticalCues(safeExcerpt),
          excerpt: safeExcerpt,
        });
      }
    }
  });

  candidates.sort((a, b) => b.score - a.score || a.page - b.page);
  const excerpts = candidates.slice(0, maxExcerpts);

  const matchedCount = Object.values(keywordHitSummary).filter((v) => v > 0).length;
  const synthesisOverview =
    excerpts.length > 0
      ? `"${input.filePath}" (${totalPages} sayfa) içinde ${matchedCount}/${cleanKeywords.length} anahtar kelime eşleşmesiyle en yüksek ilgili ${excerpts.length} pasaj [Sayfa ${excerpts.map((e) => e.page).join(', ')}] çıkarıldı.`
      : `"${input.filePath}" (${totalPages} sayfa) içinde belirtilen anahtar kelimelerle doğrudan eşleşen pasaj bulunamadı.`;

  return {
    filePath: input.filePath,
    totalPages,
    keywords: cleanKeywords,
    keywordHitSummary,
    excerpts,
    synthesisOverview,
  };
}

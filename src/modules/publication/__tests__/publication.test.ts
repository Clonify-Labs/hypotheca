import { describe, expect, it } from 'vitest';
import { buildSeedDatasets } from '../../../data/seedDatasets';
import { runIndependentTTest, runLinearRegression, runReliability } from '../../../engine/classical';
import { generateApaManuscriptSection } from '../deterministicWriter';
import { matchReferencesForAnalyses, searchLocalReferences, VERIFIED_CITATIONS } from '../verifiedCitations';
import { exportApaDocxBytes, exportLatexTables, exportQuartoDocument, exportWorkbookXlsxBytes } from '../exporters';

const ds = buildSeedDatasets()[0];
const analyses = [
  runIndependentTTest(ds, 'OY_Ort', 'Cinsiyet', ['Erkek', 'Kadın']),
  runLinearRegression(ds, 'Basari_Son', ['YZ_Ort']),
  runReliability(ds, ['OY1', 'OY2', 'OY3', 'OY4']),
];

describe('Publication Studio (deterministic, zero-LLM)', () => {
  it('generates APA-7 manuscript text with real numbers and no placeholders', () => {
    for (const lang of ['tr', 'en'] as const) {
      const ms = generateApaManuscriptSection(analyses, ds, lang);
      expect(ms.resultsText.length).toBeGreaterThan(100);
      expect(ms.fullMarkdown).toContain('180');
      expect(ms.fullMarkdown).toMatch(/\.93/);
      expect(ms.fullMarkdown).not.toMatch(/lorem ipsum|TODO|\{\{|undefined|\bNaN\b/);
    }
  });

  it('matches verified DOIs for executed analyses', () => {
    expect(VERIFIED_CITATIONS.length).toBeGreaterThanOrEqual(25);
    const refs = matchReferencesForAnalyses(analyses);
    const dois = refs.map((r) => r.doi);
    expect(dois).toContain('10.1007/BF02310555');
    expect(searchLocalReferences('cronbach').length).toBeGreaterThan(0);
  });

  it('exports real DOCX and XLSX binaries (PKZIP)', async () => {
    const docx = await exportApaDocxBytes(analyses, ds, 'en');
    expect(docx.length).toBeGreaterThan(2000);
    expect([docx[0], docx[1]]).toEqual([0x50, 0x4b]);
    const xlsx = exportWorkbookXlsxBytes(analyses, ds);
    expect(xlsx.length).toBeGreaterThan(2000);
    expect([xlsx[0], xlsx[1]]).toEqual([0x50, 0x4b]);
  });

  it('exports booktabs LaTeX and Quarto documents', () => {
    const tex = exportLatexTables(analyses);
    expect(tex).toContain('\\toprule');
    expect(tex).toContain('\\bottomrule');
    expect(tex).toContain('\\begin{table}');
    const qmd = exportQuartoDocument(analyses, ds, 'tr');
    expect(qmd.startsWith('---\ntitle:')).toBe(true);
    expect(qmd).toContain('```{r}');
    expect(qmd).toContain('t.test(OY_Ort ~ Cinsiyet');
  });
});

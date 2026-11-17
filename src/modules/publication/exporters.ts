import {
  AlignmentType,
  BorderStyle,
  Document,
  HeadingLevel,
  Packer,
  Paragraph,
  Table,
  TableCell,
  TableRow,
  TextRun,
  WidthType,
} from 'docx';
import * as XLSX from 'xlsx';
import { AnalysisOutput, Dataset, Lang, StatTable } from '../../types/interfaces';
import { generateApaManuscriptSection } from './deterministicWriter';
import { matchReferencesForAnalyses } from './verifiedCitations';

const STAT_LETTERS = new Set(['t', 'F', 'p', 'r', 'M', 'SD', 'SS', 'N', 'n', 'd', 'g', 'U', 'H', 'Z', 'W', 'B', 'SE', 'R²', 'R2']);

function cellText(v: unknown): string {
  if (v === null || v === undefined) return '';
  return String(v);
}

function noBorder() {
  return { style: BorderStyle.NONE, size: 0, color: 'auto' };
}

function ruleBorder() {
  return { style: BorderStyle.SINGLE, size: 8, color: 'auto' };
}

/** Splits text on markdown-style *italic* markers into docx TextRuns. */
function richRuns(text: string): TextRun[] {
  const parts = text.split(/(\*[^*]+\*)/g).filter((s) => s.length > 0);
  return parts.map((part) =>
    part.startsWith('*') && part.endsWith('*') && part.length > 2
      ? new TextRun({ text: part.slice(1, -1), italics: true, font: 'Times New Roman', size: 24 })
      : new TextRun({ text: part, font: 'Times New Roman', size: 24 }),
  );
}

function apaDocxTable(table: StatTable, index: number): (Paragraph | Table)[] {
  const n = table.rows.length;
  const header = new TableRow({
    tableHeader: true,
    children: table.columns.map(
      (c) =>
        new TableCell({
          borders: { top: ruleBorder(), bottom: ruleBorder(), left: noBorder(), right: noBorder() },
          children: [
            new Paragraph({
              alignment: c.numeric ? AlignmentType.CENTER : AlignmentType.LEFT,
              children: [
                new TextRun({
                  text: c.label,
                  italics: STAT_LETTERS.has(c.label),
                  font: 'Times New Roman',
                  size: 20,
                }),
              ],
            }),
          ],
        }),
    ),
  });
  const body = table.rows.map(
    (row, rIdx) =>
      new TableRow({
        children: table.columns.map(
          (c) =>
            new TableCell({
              borders: {
                top: noBorder(),
                bottom: rIdx === n - 1 ? ruleBorder() : noBorder(),
                left: noBorder(),
                right: noBorder(),
              },
              children: [
                new Paragraph({
                  alignment: c.numeric ? AlignmentType.CENTER : AlignmentType.LEFT,
                  children: [new TextRun({ text: cellText(row[c.key]), font: 'Times New Roman', size: 20 })],
                }),
              ],
            }),
        ),
      }),
  );

  const out: (Paragraph | Table)[] = [
    new Paragraph({ children: [new TextRun({ text: `Table ${index}`, bold: true, font: 'Times New Roman', size: 24 })] }),
    new Paragraph({ children: [new TextRun({ text: table.title, italics: true, font: 'Times New Roman', size: 24 })] }),
    new Table({
      width: { size: 100, type: WidthType.PERCENTAGE },
      borders: {
        top: noBorder(),
        bottom: noBorder(),
        left: noBorder(),
        right: noBorder(),
        insideHorizontal: noBorder(),
        insideVertical: noBorder(),
      },
      rows: [header, ...body],
    }),
  ];
  if (table.footnotes?.length) {
    out.push(
      new Paragraph({
        children: [
          new TextRun({ text: 'Note. ', italics: true, font: 'Times New Roman', size: 20 }),
          new TextRun({ text: table.footnotes.join(' '), font: 'Times New Roman', size: 20 }),
        ],
      }),
    );
  }
  out.push(new Paragraph({ children: [] }));
  return out;
}

export async function exportApaDocxBytes(
  analyses: AnalysisOutput[],
  dataset: Dataset,
  lang: Lang,
  title?: string,
): Promise<Uint8Array> {
  const ms = generateApaManuscriptSection(analyses, dataset, lang);
  const refs = matchReferencesForAnalyses(analyses);
  const docTitle = title || (lang === 'tr' ? 'Hypotheca Bulgular Raporu' : 'Hypotheca Results Report');

  const paragraphsFrom = (txt: string) =>
    txt
      .split(/\n{2,}/)
      .map((p) => p.trim())
      .filter(Boolean)
      .map((p) => new Paragraph({ spacing: { line: 480 }, indent: { firstLine: 720 }, children: richRuns(p.replace(/\n/g, ' ')) }));

  const children: (Paragraph | Table)[] = [
    new Paragraph({ heading: HeadingLevel.TITLE, alignment: AlignmentType.CENTER, children: [new TextRun({ text: docTitle, bold: true, font: 'Times New Roman', size: 28 })] }),
    new Paragraph({ heading: HeadingLevel.HEADING_1, children: [new TextRun({ text: lang === 'tr' ? 'Yöntem' : 'Method', bold: true, font: 'Times New Roman', size: 24 })] }),
    ...paragraphsFrom(ms.methodsText),
    new Paragraph({ heading: HeadingLevel.HEADING_1, children: [new TextRun({ text: lang === 'tr' ? 'Bulgular' : 'Results', bold: true, font: 'Times New Roman', size: 24 })] }),
    ...paragraphsFrom(ms.resultsText),
    new Paragraph({ heading: HeadingLevel.HEADING_1, children: [new TextRun({ text: lang === 'tr' ? 'Tablolar' : 'Tables', bold: true, font: 'Times New Roman', size: 24 })] }),
  ];

  let tIdx = 1;
  for (const a of analyses) {
    for (const t of a.tables) {
      children.push(...apaDocxTable(t, tIdx));
      tIdx++;
    }
  }

  children.push(
    new Paragraph({ heading: HeadingLevel.HEADING_1, children: [new TextRun({ text: lang === 'tr' ? 'Kaynakça' : 'References', bold: true, font: 'Times New Roman', size: 24 })] }),
    ...refs.map(
      (r) =>
        new Paragraph({
          indent: { left: 720, hanging: 720 },
          spacing: { line: 480 },
          children: [new TextRun({ text: r.apa7, font: 'Times New Roman', size: 24 })],
        }),
    ),
  );

  const doc = new Document({
    creator: 'Hypotheca',
    title: docTitle,
    sections: [{ children }],
  });
  const buf = await Packer.toArrayBuffer(doc);
  return new Uint8Array(buf);
}

function safeSheetName(name: string, used: Set<string>): string {
  let base = name.replace(/[\\/?*[\]:]/g, ' ').trim().slice(0, 28) || 'Sheet';
  let candidate = base;
  let i = 2;
  while (used.has(candidate)) {
    candidate = `${base.slice(0, 25)}_${i}`;
    i++;
  }
  used.add(candidate);
  return candidate;
}

export function exportWorkbookXlsxBytes(analyses: AnalysisOutput[], dataset: Dataset): Uint8Array {
  const wb = XLSX.utils.book_new();
  const used = new Set<string>();

  const summaryRows = analyses.map((a, i) => ({
    No: i + 1,
    Analysis: a.title,
    Type: a.analysisType,
    CreatedAt: a.createdAt,
    Tables: a.tables.length,
    Narrative: a.narrativeEn || a.narrativeTr || '',
  }));
  XLSX.utils.book_append_sheet(
    wb,
    XLSX.utils.json_to_sheet(summaryRows.length ? summaryRows : [{ Info: 'No analyses' }]),
    safeSheetName('Summary', used),
  );

  analyses.forEach((a, aIdx) => {
    a.tables.forEach((t) => {
      const rows = t.rows.map((r) => {
        const o: Record<string, string | number | boolean | null> = {};
        t.columns.forEach((c) => {
          o[c.label] = r[c.key] ?? null;
        });
        return o;
      });
      XLSX.utils.book_append_sheet(
        wb,
        XLSX.utils.json_to_sheet(rows.length ? rows : [{ Info: 'Empty' }]),
        safeSheetName(`${aIdx + 1}_${t.title}`, used),
      );
    });
  });

  const sample = dataset.rows.slice(0, 500);
  XLSX.utils.book_append_sheet(
    wb,
    XLSX.utils.json_to_sheet(sample.length ? sample : [{ Info: 'Empty dataset' }]),
    safeSheetName('Data', used),
  );

  const out = XLSX.write(wb, { type: 'array', bookType: 'xlsx' }) as ArrayBuffer;
  return new Uint8Array(out);
}

function latexEscape(s: string): string {
  return s
    .replace(/\\/g, '\\textbackslash{}')
    .replace(/([&%$#_{}])/g, '\\$1')
    .replace(/~/g, '\\textasciitilde{}')
    .replace(/\^/g, '\\textasciicircum{}')
    .replace(/²/g, '$^2$')
    .replace(/η/g, '$\\eta$')
    .replace(/ω/g, '$\\omega$')
    .replace(/α/g, '$\\alpha$')
    .replace(/χ/g, '$\\chi$')
    .replace(/ε/g, '$\\varepsilon$')
    .replace(/β/g, '$\\beta$')
    .replace(/λ/g, '$\\lambda$')
    .replace(/Δ/g, '$\\Delta$')
    .replace(/→/g, '$\\rightarrow$')
    .replace(/↔/g, '$\\leftrightarrow$')
    .replace(/×/g, '$\\times$');
}

export function exportLatexTables(analyses: AnalysisOutput[], title?: string): string {
  const blocks: string[] = [
    `% ${title || 'Hypotheca APA-7 Tables'}`,
    '% Requires: \\usepackage{booktabs}',
    '',
  ];
  let idx = 1;
  for (const a of analyses) {
    for (const t of a.tables) {
      const align = t.columns.map((c) => (c.numeric ? 'r' : 'l')).join('');
      const header = t.columns.map((c) => latexEscape(c.label)).join(' & ');
      const body = t.rows.map((r) => t.columns.map((c) => latexEscape(cellText(r[c.key]))).join(' & ') + ' \\\\');
      blocks.push(
        '\\begin{table}[htbp]',
        '  \\centering',
        `  \\caption{${latexEscape(t.title)}}`,
        `  \\label{tab:hp${idx}}`,
        `  \\begin{tabular}{${align}}`,
        '    \\toprule',
        `    ${header} \\\\`,
        '    \\midrule',
        ...body.map((b) => `    ${b}`),
        '    \\bottomrule',
        '  \\end{tabular}',
        ...(t.footnotes?.length ? [`  \\par\\smallskip\\footnotesize\\textit{Note.} ${latexEscape(t.footnotes.join(' '))}`] : []),
        '\\end{table}',
        '',
      );
      idx++;
    }
  }
  return blocks.join('\n');
}

function quartoRCall(a: AnalysisOutput): string {
  const p = a.params as Record<string, unknown>;
  const s = (k: string) => String(p[k] ?? '');
  const arr = (k: string) => (Array.isArray(p[k]) ? (p[k] as unknown[]).map(String) : []);
  switch (a.analysisType) {
    case 'independent_t':
      return `t.test(${s('dependent')} ~ ${s('groupVar')}, data = df, var.equal = TRUE)\nt.test(${s('dependent')} ~ ${s('groupVar')}, data = df)`;
    case 'paired_t':
      return `t.test(df$${s('var1')}, df$${s('var2')}, paired = TRUE)`;
    case 'oneway_anova':
      return `summary(aov(${s('dependent')} ~ factor(${s('factor')}), data = df))\noneway.test(${s('dependent')} ~ factor(${s('factor')}), data = df)`;
    case 'linear_regression':
      return `summary(lm(${s('outcome')} ~ ${arr('predictors').join(' + ') || '1'}, data = df))`;
    case 'reliability':
      return `psych::alpha(df[, c(${arr('items').map((x) => `"${x}"`).join(', ')})])`;
    case 'correlation_test':
      return `cor(df[, c(${arr('variables').map((x) => `"${x}"`).join(', ')})], use = "pairwise.complete.obs", method = "${s('method') || 'pearson'}")`;
    case 'mann_whitney_u':
      return `wilcox.test(${s('dependent')} ~ ${s('groupVar')}, data = df)`;
    case 'kruskal_wallis':
      return `kruskal.test(${s('dependent')} ~ factor(${s('factor')}), data = df)`;
    default:
      return `# ${a.analysisType}: see scripts/analysis_reproducible.R for the full call`;
  }
}

export function exportQuartoDocument(analyses: AnalysisOutput[], dataset: Dataset, lang: Lang): string {
  const ms = generateApaManuscriptSection(analyses, dataset, lang);
  const refs = matchReferencesForAnalyses(analyses);
  const title = lang === 'tr' ? 'Hypotheca Bulgular Raporu' : 'Hypotheca Results Report';
  const chunks = analyses
    .map((a) => ['', `### ${a.title}`, '', '```{r}', quartoRCall(a), '```'].join('\n'))
    .join('\n');

  return [
    '---',
    `title: "${title}"`,
    `date: "${new Date().toISOString().slice(0, 10)}"`,
    'format:',
    '  docx: default',
    '  html: default',
    'bibliography: references.bib',
    'csl: apa.csl',
    '---',
    '',
    '```{r}',
    '#| label: setup',
    '#| include: false',
    'library(tidyverse)',
    'library(psych)',
    `df <- readr::read_csv("${dataset.name}")`,
    '```',
    '',
    `## ${lang === 'tr' ? 'Yöntem' : 'Method'}`,
    '',
    ms.methodsText,
    '',
    `## ${lang === 'tr' ? 'Bulgular' : 'Results'}`,
    '',
    ms.resultsText,
    '',
    `## ${lang === 'tr' ? 'Analiz Kodları' : 'Analysis Code'}`,
    chunks,
    '',
    `## ${lang === 'tr' ? 'Tablolar' : 'Tables'}`,
    '',
    ms.tablesMarkdown,
    '',
    `## ${lang === 'tr' ? 'Kaynakça' : 'References'}`,
    '',
    '<!-- references.bib',
    ...refs.map((r) => r.bibtex.replace(/\\n/g, '\n')),
    '-->',
    '',
    ...refs.map((r) => `- ${r.apa7}`),
    '',
  ].join('\n');
}

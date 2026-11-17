import path from 'node:path';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { describe, expect, it } from 'vitest';
import { createHypothecaMcpServer } from '../src/server.js';

const DEMO_DATA_DIR = path.resolve(process.cwd(), 'mcp-server/data');
const DIST_ENTRYPOINT = path.resolve(process.cwd(), 'mcp-server/dist/index.js');

describe('Hypotheca BAP MCP Server', () => {
  async function connectInMemory() {
    const server = createHypothecaMcpServer({
      dataDir: DEMO_DATA_DIR,
      projectName: 'BAP-2026-ZEYNEP-01',
    });
    const client = new Client({ name: 'hypotheca-test-client', version: '1.0.0' });
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    await Promise.all([server.connect(serverTransport), client.connect(clientTransport)]);
    return {
      client,
      close: async () => {
        await client.close();
        await server.close();
      },
    };
  }

  it('registers analyze_bap_data, read_literature_pdf and bap_project_schema without exposing PII', async () => {
    const { client, close } = await connectInMemory();
    try {
      const tools = await client.listTools();
      const toolNames = tools.tools.map((t) => t.name);
      expect(toolNames).toContain('analyze_bap_data');
      expect(toolNames).toContain('read_literature_pdf');

      const resources = await client.listResources();
      expect(resources.resources.some((r) => r.uri === 'bap://project/schema')).toBe(true);

      const schemaRes = await client.readResource({ uri: 'bap://project/schema' });
      const schemaText = (schemaRes.contents[0] as { text: string }).text;
      const schemaJson = JSON.parse(schemaText) as {
        project: string;
        datasets: Array<{
          file: string;
          observations: number;
          variables: Array<{ name: string; piiProtected: boolean; numericRange?: { min: number; max: number } }>;
        }>;
        literaturePdfs: Array<{ file: string }>;
      };

      expect(schemaJson.project).toBe('BAP-2026-ZEYNEP-01');
      expect(schemaJson.datasets.some((d) => d.file === 'bap_ogrenci_anket_2026.csv')).toBe(true);
      expect(schemaJson.datasets.some((d) => d.file === 'bap_arastirma.sqlite')).toBe(true);
      expect(schemaJson.literaturePdfs.some((p) => p.file === 'literatur/bap_dijital_tukenmislik_2026.pdf')).toBe(true);

      const csvEntry = schemaJson.datasets.find((d) => d.file === 'bap_ogrenci_anket_2026.csv')!;
      expect(csvEntry.observations).toBe(60);
      expect(csvEntry.variables.find((v) => v.name === 'TC_Kimlik')?.piiProtected).toBe(true);
      expect(csvEntry.variables.find((v) => v.name === 'Eposta')?.piiProtected).toBe(true);
      expect(schemaText).not.toContain('@universite.edu.tr');
    } finally {
      await close();
    }
  });

  it('analyzes CSV, Excel (.xlsx) and read-only SQLite with Welch t-test and suppresses PII columns', async () => {
    const { client, close } = await connectInMemory();
    try {
      // 1. CSV + groupBy
      const csvCall = await client.callTool({
        name: 'analyze_bap_data',
        arguments: {
          source: 'bap_ogrenci_anket_2026.csv',
          groupBy: 'Grup',
          includeCorrelations: true,
        },
      });
      expect(csvCall.isError).not.toBe(true);
      const csvText = (csvCall.content[0] as { type: 'text'; text: string }).text;
      const csvStats = JSON.parse(csvText) as {
        observations: number;
        suppressedPiiColumns: string[];
        numericDescriptives: Array<{ variable: string; n: number; mean: number }>;
        groupComparisons: Array<{ dependentVariable: string; testType: string; pValue: number }>;
        correlations: Array<{ varA: string; varB: string; r: number }>;
      };

      expect(csvStats.observations).toBe(60);
      expect(csvStats.suppressedPiiColumns).toEqual(expect.arrayContaining(['TC_Kimlik', 'Eposta']));
      expect(csvStats.numericDescriptives.some((d) => d.variable === 'OzYeterlik_Puan' && d.n === 60)).toBe(true);
      const selfEffCmp = csvStats.groupComparisons.find((g) => g.dependentVariable === 'OzYeterlik_Puan');
      expect(selfEffCmp?.testType).toBe('welch_t');
      expect(selfEffCmp?.pValue).toBeLessThan(0.001);
      expect(csvStats.correlations.length).toBeGreaterThan(0);

      // 2. Excel (.xlsx)
      const xlsxCall = await client.callTool({
        name: 'analyze_bap_data',
        arguments: {
          source: 'bap_anket_ozeti_2026.xlsx',
          tableOrSheet: 'Anket_Verisi',
          variables: ['OzYeterlik_Puan', 'Tukenmislik_Puan'],
        },
      });
      expect(xlsxCall.isError).not.toBe(true);
      const xlsxStats = JSON.parse((xlsxCall.content[0] as { text: string }).text) as {
        format: string;
        observations: number;
      };
      expect(xlsxStats.format).toBe('xlsx');
      expect(xlsxStats.observations).toBe(60);

      // 3. SQLite (read-only) with 3-group ANOVA by Bolum
      const sqliteCall = await client.callTool({
        name: 'analyze_bap_data',
        arguments: {
          source: 'bap_arastirma.sqlite',
          tableOrSheet: 'anket_sonuclari',
          groupBy: 'Bolum',
        },
      });
      expect(sqliteCall.isError).not.toBe(true);
      const sqliteStats = JSON.parse((sqliteCall.content[0] as { text: string }).text) as {
        format: string;
        groupComparisons: Array<{ testType: string; df1: number; df2: number }>;
      };
      expect(sqliteStats.format).toBe('sqlite');
      expect(sqliteStats.groupComparisons[0].testType).toBe('one_way_anova');
      expect(sqliteStats.groupComparisons[0].df1).toBe(2);
    } finally {
      await close();
    }
  });

  it('extracts ranked Turkish page-cited literature synthesis via read_literature_pdf', async () => {
    const { client, close } = await connectInMemory();
    try {
      const pdfCall = await client.callTool({
        name: 'read_literature_pdf',
        arguments: {
          filePath: 'literatur/bap_dijital_tukenmislik_2026.pdf',
          keywords: ['öz-yeterlik', 'tükenmişlik', 'regresyon'],
          maxExcerpts: 5,
        },
      });
      expect(pdfCall.isError).not.toBe(true);
      const pdfJson = JSON.parse((pdfCall.content[0] as { text: string }).text) as {
        totalPages: number;
        keywordHitSummary: Record<string, number>;
        excerpts: Array<{ page: number; matchedKeywords: string[]; statisticalCues: string[]; excerpt: string }>;
      };

      expect(pdfJson.totalPages).toBe(3);
      expect(pdfJson.keywordHitSummary['öz-yeterlik']).toBeGreaterThan(0);
      expect(pdfJson.keywordHitSummary['tükenmişlik']).toBeGreaterThan(0);
      expect(pdfJson.keywordHitSummary['regresyon']).toBeGreaterThan(0);
      expect(pdfJson.excerpts.length).toBeGreaterThan(0);
      const allCues = pdfJson.excerpts.flatMap((e) => e.statisticalCues).join(' | ');
      expect(allCues).toMatch(/N\s*=\s*180|r\s*=\s*-0\.54|R²\s*=\s*0\.38/);
    } finally {
      await close();
    }
  });

  it('blocks path traversal attempts in both tools', async () => {
    const { client, close } = await connectInMemory();
    try {
      const dataTraversal = await client.callTool({
        name: 'analyze_bap_data',
        arguments: { source: '../../package.json' },
      });
      expect(dataTraversal.isError).toBe(true);
      expect((dataTraversal.content[0] as { text: string }).text).toContain('Erişim engellendi');

      const pdfTraversal = await client.callTool({
        name: 'read_literature_pdf',
        arguments: { filePath: '../../../etc/passwd', keywords: ['root'] },
      });
      expect(pdfTraversal.isError).toBe(true);
      expect((pdfTraversal.content[0] as { text: string }).text).toContain('Erişim engellendi');
    } finally {
      await close();
    }
  });

  it('works end-to-end over real StdioClientTransport (Claude Desktop protocol wire check)', async () => {
    const transport = new StdioClientTransport({
      command: 'node',
      args: [DIST_ENTRYPOINT],
      env: {
        ...process.env,
        HYPOTHECA_DATA_DIR: DEMO_DATA_DIR,
        HYPOTHECA_PROJECT_NAME: 'BAP-2026-ZEYNEP-01',
      },
      stderr: 'pipe',
    });
    const client = new Client({ name: 'hypotheca-stdio-e2e', version: '1.0.0' });
    await client.connect(transport);
    try {
      const tools = await client.listTools();
      expect(tools.tools.map((t) => t.name)).toEqual(
        expect.arrayContaining(['analyze_bap_data', 'read_literature_pdf']),
      );
      const res = await client.readResource({ uri: 'bap://project/schema' });
      expect((res.contents[0] as { text: string }).text).toContain('BAP-2026-ZEYNEP-01');
    } finally {
      await client.close();
    }
  }, 15_000);
});

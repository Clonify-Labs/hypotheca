import { McpServer, ResourceTemplate } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { buildBapProjectSchema } from './resources/bapProjectSchema.js';
import { analyzeBapData } from './tools/analyzeBapData.js';
import { readLiteraturePdf } from './tools/readLiteraturePdf.js';

export interface HypothecaMcpOptions {
  dataDir: string;
  projectName?: string;
}

export function createHypothecaMcpServer(options: HypothecaMcpOptions): McpServer {
  const dataDir = options.dataDir;
  const projectName = options.projectName ?? 'Hypotheca BAP Araştırma Projesi';

  const server = new McpServer({
    name: 'hypotheca-bap-mcp',
    version: '1.0.0',
  });

  server.registerTool(
    'analyze_bap_data',
    {
      title: 'BAP Anket ve Araştırma Verisi Analiz Aracı',
      description:
        'HYPOTHECA_DATA_DIR içindeki CSV, TSV, Excel (.xlsx) veya salt-okunur SQLite veritabanından anket/araştırma verilerini okur; ham katılımcı satırlarını ve KVKK hassas sütunlarını gizleyerek SPSS uyumlu tanımlayıcı istatistikler, grup karşılaştırmaları (Welch t / Tek Yönlü ANOVA) ve Pearson korelasyonlarını hesaplar.',
      inputSchema: z.object({
        source: z
          .string()
          .min(1)
          .describe('Veri dosyasının HYPOTHECA_DATA_DIR içine göreli yolu (örn. bap_ogrenci_anket_2026.csv veya bap_arastirma.sqlite).'),
        tableOrSheet: z
          .string()
          .optional()
          .describe('SQLite veritabanı tablo adı veya Excel çalışma sayfası adı (opsiyonel).'),
        variables: z
          .array(z.string())
          .optional()
          .describe('Analize dahil edilecek değişken isimleri listesi (boş bırakılırsa PII olmayan tüm sütunlar incelenir).'),
        groupBy: z
          .string()
          .optional()
          .describe('Grup karşılaştırması (Welch t-testi veya Tek Yönlü ANOVA) için kategorik gruplama değişkeni (opsiyonel).'),
        includeCorrelations: z
          .boolean()
          .optional()
          .default(true)
          .describe('Sayısal değişkenler arası Pearson korelasyon matrisi hesaplansın mı?'),
      }),
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
      },
    },
    async (args) => {
      try {
        const result = await analyzeBapData(dataDir, args);
        return {
          content: [
            {
              type: 'text',
              text: JSON.stringify(result, null, 2),
            },
          ],
        };
      } catch (err) {
        return {
          isError: true,
          content: [
            {
              type: 'text',
              text: `analyze_bap_data hatası: ${err instanceof Error ? err.message : String(err)}`,
            },
          ],
        };
      }
    },
  );

  server.registerTool(
    'read_literature_pdf',
    {
      title: 'BAP Literatür PDF Okuma ve Sentez Aracı',
      description:
        'HYPOTHECA_DATA_DIR içindeki yerel bir akademik PDF dosyasını okur, belirtilen anahtar kelimelere (Türkçe karakter duyarsız eşleşme destekli) göre en ilgili sayfa numaralı pasajları, istatistiksel göstergeleri ve KVKK arındırılmış sentez özetini döndürür.',
      inputSchema: z.object({
        filePath: z
          .string()
          .min(1)
          .describe('PDF dosyasının HYPOTHECA_DATA_DIR içine göreli yolu (örn. literatur/bap_dijital_tukenmislik_2026.pdf).'),
        keywords: z
          .array(z.string().min(1))
          .min(1)
          .describe('PDF içinde aranacak anahtar kelimeler veya kavramlar listesi.'),
        maxExcerpts: z
          .number()
          .int()
          .min(1)
          .max(20)
          .optional()
          .default(8)
          .describe('Döndürülecek maksimum pasaj sayısı (varsayılan: 8).'),
        contextSentences: z
          .number()
          .int()
          .min(1)
          .max(5)
          .optional()
          .default(2)
          .describe('Paragraf bulunamadığında birleştirilecek cümle penceresi boyutu.'),
      }),
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
      },
    },
    async (args) => {
      try {
        const result = await readLiteraturePdf(dataDir, args);
        return {
          content: [
            {
              type: 'text',
              text: JSON.stringify(result, null, 2),
            },
          ],
        };
      } catch (err) {
        return {
          isError: true,
          content: [
            {
              type: 'text',
              text: `read_literature_pdf hatası: ${err instanceof Error ? err.message : String(err)}`,
            },
          ],
        };
      }
    },
  );

  server.registerResource(
    'bap_project_schema',
    'bap://project/schema',
    {
      title: 'BAP Proje Veri Yapısı ve Değişken Sözlüğü',
      description:
        'Projedeki tüm yerel veri setlerinin (CSV, Excel, SQLite) değişken isimlerini, veri tiplerini, ölçüm düzeylerini, eksik veri oranlarını ve mevcut literatür PDF dosyalarını ham veri sızdırmadan dinamik olarak sunar.',
      mimeType: 'application/json',
    },
    async (uri) => {
      const schema = await buildBapProjectSchema(dataDir, projectName);
      return {
        contents: [
          {
            uri: uri.href,
            mimeType: 'application/json',
            text: JSON.stringify(schema, null, 2),
          },
        ],
      };
    },
  );

  server.registerResource(
    'bap_dataset_schema',
    new ResourceTemplate('bap://project/schema/{dataset}', { list: undefined }),
    {
      title: 'Tekil Veri Seti Değişken Şeması',
      description: 'Belirli bir veri seti dosyası için dinamik değişken sözlüğü döndürür.',
      mimeType: 'application/json',
    },
    async (uri, variables) => {
      const datasetParam =
        typeof variables.dataset === 'string'
          ? decodeURIComponent(variables.dataset)
          : Array.isArray(variables.dataset)
            ? decodeURIComponent(variables.dataset[0] ?? '')
            : undefined;
      const schema = await buildBapProjectSchema(dataDir, projectName, datasetParam);
      return {
        contents: [
          {
            uri: uri.href,
            mimeType: 'application/json',
            text: JSON.stringify(schema, null, 2),
          },
        ],
      };
    },
  );

  return server;
}

import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { createHypothecaMcpServer } from './server.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

async function main(): Promise<void> {
  const defaultDataDir = path.resolve(__dirname, '..', 'data');
  const dataDir = path.resolve(process.env.HYPOTHECA_DATA_DIR || defaultDataDir);
  const projectName = process.env.HYPOTHECA_PROJECT_NAME || 'BAP-2026-ZEYNEP-01';

  const server = createHypothecaMcpServer({ dataDir, projectName });
  const transport = new StdioServerTransport();

  const shutdown = async () => {
    console.error('[hypotheca-mcp] Sunucu kapatılıyor...');
    await server.close();
    process.exit(0);
  };

  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);

  await server.connect(transport);
  console.error(`[hypotheca-mcp] Stdio MCP sunucusu hazır (HYPOTHECA_DATA_DIR=${dataDir})`);
}

main().catch((err) => {
  console.error('[hypotheca-mcp] Kritik başlatma hatası:', err);
  process.exit(1);
});

import fs from 'node:fs/promises';
import path from 'node:path';
import {
  ColumnSummaryMeta,
  SUPPORTED_DATA_EXTENSIONS,
  loadDataset,
} from '../data/loader.js';

interface DatasetSchemaEntry {
  file: string;
  format: string;
  activeTableOrSheet: string;
  availableTablesOrSheets: string[];
  observations: number;
  variables: ColumnSummaryMeta[];
  warnings: string[];
}

interface PdfAssetEntry {
  file: string;
  sizeBytes: number;
}

export interface BapProjectSchemaPayload {
  project: string;
  privacyPolicy: string;
  dataDirectoryConfigured: boolean;
  datasets: DatasetSchemaEntry[];
  literaturePdfs: PdfAssetEntry[];
  generatedAt: string;
}

async function scanFilesRecursive(
  rootDir: string,
  currentDir: string,
  depth = 0,
): Promise<string[]> {
  if (depth > 3) return [];
  const entries = await fs.readdir(currentDir, { withFileTypes: true }).catch(() => []);
  const files: string[] = [];

  for (const entry of entries) {
    if (entry.name.startsWith('.')) continue;
    const fullPath = path.join(currentDir, entry.name);
    if (entry.isDirectory()) {
      const sub = await scanFilesRecursive(rootDir, fullPath, depth + 1);
      files.push(...sub);
    } else if (entry.isFile()) {
      files.push(path.relative(rootDir, fullPath).split(path.sep).join('/'));
    }
  }
  return files.sort();
}

export async function buildBapProjectSchema(
  dataDir: string,
  projectName: string,
  filterDataset?: string,
): Promise<BapProjectSchemaPayload> {
  const allFiles = await scanFilesRecursive(dataDir, dataDir);
  const dataExtSet = new Set<string>(SUPPORTED_DATA_EXTENSIONS);

  const datasets: DatasetSchemaEntry[] = [];
  const literaturePdfs: PdfAssetEntry[] = [];

  for (const relPath of allFiles) {
    const ext = path.extname(relPath).toLowerCase();
    if (ext === '.pdf') {
      const st = await fs.stat(path.join(dataDir, relPath));
      literaturePdfs.push({ file: relPath, sizeBytes: st.size });
      continue;
    }

    if (!dataExtSet.has(ext)) continue;
    if (filterDataset && relPath !== filterDataset && path.basename(relPath) !== filterDataset) {
      continue;
    }

    try {
      const loaded = await loadDataset(dataDir, relPath);
      datasets.push({
        file: loaded.source,
        format: loaded.format,
        activeTableOrSheet: loaded.tableOrSheet,
        availableTablesOrSheets: loaded.availableTablesOrSheets,
        observations: loaded.rowCount,
        variables: loaded.columns,
        warnings: loaded.warnings,
      });
    } catch (err) {
      datasets.push({
        file: relPath,
        format: ext.slice(1),
        activeTableOrSheet: 'unreadable',
        availableTablesOrSheets: [],
        observations: 0,
        variables: [],
        warnings: [err instanceof Error ? err.message : 'Veri dosyası okunamadı.'],
      });
    }
  }

  return {
    project: projectName,
    privacyPolicy:
      'KVKK ve BAP etik kurulu uyumlu şema: Ham satırlar ve kimlik sütunları (piiProtected: true) dışarı aktarılmaz.',
    dataDirectoryConfigured: allFiles.length > 0,
    datasets,
    literaturePdfs,
    generatedAt: new Date().toISOString(),
  };
}

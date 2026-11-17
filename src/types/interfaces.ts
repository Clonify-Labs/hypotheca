export type Lang = 'tr' | 'en';

export type ValueType = 'numeric' | 'categorical' | 'string' | 'boolean';
export type ScaleLevel = 'scale' | 'ordinal' | 'nominal';

export interface ColumnMeta {
  name: string;
  label: string;
  valueType: ValueType;
  scale: ScaleLevel;
  decimals: number;
  uniqueCount: number;
  missingCount: number;
}

export type DataRow = Record<string, string | number | boolean | null>;

export interface Dataset {
  id: string;
  name: string;
  description?: string;
  columns: ColumnMeta[];
  rows: DataRow[];
  createdAt: string;
}

export interface TableColumn {
  key: string;
  label: string;
  numeric?: boolean;
}

export interface StatTable {
  id: string;
  title: string;
  columns: TableColumn[];
  rows: Record<string, string | number | boolean | null>[];
  footnotes?: string[];
}

export interface StatChart {
  id: string;
  title: string;
  type: 'bar' | 'line' | 'scatter' | 'heatmap' | 'boxplot' | 'forest' | 'funnel' | 'graph';
  option: Record<string, unknown>;
}

export interface AssumptionBadge {
  name: string;
  passed: boolean;
  statisticLabel: string;
  pValue?: number | null;
  detail: string;
}

export interface AnalysisOutput {
  id: string;
  analysisType: string;
  title: string;
  createdAt: string;
  params: Record<string, unknown>;
  summary: Record<string, unknown>;
  tables: StatTable[];
  charts: StatChart[];
  assumptions?: AssumptionBadge[];
  narrativeTr?: string;
  narrativeEn?: string;
}

export interface StudyProject {
  id: string;
  title: string;
  author: string;
  email: string;
  datasets: Dataset[];
  analyses: AnalysisOutput[];
}

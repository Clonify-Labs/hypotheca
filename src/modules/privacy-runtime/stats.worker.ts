import {
  PowerRequest,
  SemFactorSpec,
  SemModelSpec,
  SemPathSpec,
  runBlandAltman,
  runCbSem,
  runChiSquare,
  runCorrelation,
  runDescriptives,
  runEfa,
  runFriedman,
  runIndependentTTest,
  runKaplanMeier,
  runKruskalWallis,
  runLinearRegression,
  runLogisticRegression,
  runMannWhitneyU,
  runNormality,
  runOneWayAnova,
  runPairedTTest,
  runPartialCorrelation,
  runPlsSem,
  runPowerAnalysis,
  runProcessMacro,
  runRasch,
  runReliability,
  runRepeatedAnova,
  runRocCurve,
  runWilcoxon,
} from '../../engine/classical';
import { AnalysisOutput, Dataset } from '../../types/interfaces';

export interface StatsWorkerRequest {
  id: string;
  op: string;
  payload: Record<string, unknown>;
}

export type StatsWorkerResponse =
  | { id: string; ok: true; result: AnalysisOutput; elapsedMs: number }
  | { id: string; ok: false; error: string };

function asDataset(payload: Record<string, unknown>): Dataset {
  const ds = payload.dataset as Dataset | undefined;
  if (!ds || !Array.isArray(ds.rows) || !Array.isArray(ds.columns)) {
    throw new Error('Geçerli bir veri seti (dataset) sağlanmalıdır.');
  }
  return ds;
}

function asStringArray(val: unknown): string[] {
  return Array.isArray(val) ? val.map((v) => String(v)) : [];
}

function asString(val: unknown, fallback = ''): string {
  return typeof val === 'string' ? val : fallback;
}

type OpHandler = (payload: Record<string, unknown>) => AnalysisOutput;

const OP_HANDLERS: Record<string, OpHandler> = {
  descriptives: (p) =>
    runDescriptives(asDataset(p), asStringArray(p.variables ?? p.vars)),
  normality: (p) =>
    runNormality(asDataset(p), asStringArray(p.variables ?? p.vars)),
  independent_t: (p) =>
    runIndependentTTest(
      asDataset(p),
      asString(p.dependent ?? p.outcome ?? p.variable),
      asString(p.groupVar ?? p.factor ?? p.group),
      Array.isArray(p.groupNames) && p.groupNames.length >= 2
        ? [String(p.groupNames[0]), String(p.groupNames[1])]
        : undefined,
    ),
  paired_t: (p) =>
    runPairedTTest(
      asDataset(p),
      asString(p.var1 ?? p.preVar),
      asString(p.var2 ?? p.postVar),
    ),
  oneway_anova: (p) =>
    runOneWayAnova(
      asDataset(p),
      asString(p.dependent ?? p.outcome ?? p.variable),
      asString(p.factor ?? p.groupVar ?? p.group),
      (p.posthocMethod as 'tukey' | 'bonferroni' | 'games_howell' | undefined) ?? 'tukey',
    ),
  repeated_anova: (p) =>
    runRepeatedAnova(asDataset(p), asStringArray(p.variables ?? p.vars)),
  mann_whitney_u: (p) =>
    runMannWhitneyU(
      asDataset(p),
      asString(p.dependent ?? p.outcome ?? p.variable),
      asString(p.groupVar ?? p.factor ?? p.group),
    ),
  wilcoxon: (p) =>
    runWilcoxon(
      asDataset(p),
      asString(p.var1 ?? p.preVar),
      asString(p.var2 ?? p.postVar),
    ),
  kruskal_wallis: (p) =>
    runKruskalWallis(
      asDataset(p),
      asString(p.dependent ?? p.outcome ?? p.variable),
      asString(p.factor ?? p.groupVar ?? p.group),
    ),
  friedman: (p) =>
    runFriedman(asDataset(p), asStringArray(p.variables ?? p.vars)),
  correlation: (p) =>
    runCorrelation(
      asDataset(p),
      asStringArray(p.variables ?? p.vars),
      (p.method as 'pearson' | 'spearman' | undefined) ?? 'pearson',
    ),
  partial_correlation: (p) =>
    runPartialCorrelation(
      asDataset(p),
      asString(p.var1),
      asString(p.var2),
      asStringArray(p.controls),
    ),
  chi_square: (p) =>
    runChiSquare(
      asDataset(p),
      asString(p.rowVar ?? p.var1),
      asString(p.colVar ?? p.var2),
    ),
  reliability: (p) =>
    runReliability(asDataset(p), asStringArray(p.items ?? p.variables)),
  efa: (p) => {
    const opts = (p.opts as { nFactors?: number; rotation?: 'varimax' | 'none'; extraction?: 'pca' | 'paf' } | undefined) ?? {
      nFactors: typeof p.nFactors === 'number' ? p.nFactors : undefined,
      rotation: p.rotation as 'varimax' | 'none' | undefined,
      extraction: p.extraction as 'pca' | 'paf' | undefined,
    };
    return runEfa(asDataset(p), asStringArray(p.items ?? p.variables), opts);
  },
  rasch: (p) =>
    runRasch(asDataset(p), asStringArray(p.items ?? p.variables)),
  cb_sem: (p) => {
    const spec = (p.spec as SemModelSpec | undefined) ?? {
      factors: (p.factors as SemFactorSpec[] | undefined) ?? [],
      paths: (p.paths as SemPathSpec[] | undefined) ?? [],
    };
    return runCbSem(asDataset(p), spec);
  },
  pls_sem: (p) => {
    const spec = (p.spec as { factors: SemFactorSpec[]; paths: SemPathSpec[] } | undefined) ?? {
      factors: (p.factors as SemFactorSpec[] | undefined) ?? [],
      paths: (p.paths as SemPathSpec[] | undefined) ?? [],
    };
    const bootstrapSamples = typeof p.bootstrapSamples === 'number' ? p.bootstrapSamples : 200;
    return runPlsSem(asDataset(p), spec, bootstrapSamples);
  },
  linear_regression: (p) =>
    runLinearRegression(
      asDataset(p),
      asString(p.outcome ?? p.dependent),
      asStringArray(p.predictors),
      Array.isArray(p.blocks) ? (p.blocks as string[][]) : undefined,
    ),
  logistic_regression: (p) =>
    runLogisticRegression(
      asDataset(p),
      asString(p.outcome ?? p.dependent),
      asStringArray(p.predictors),
    ),
  roc_curve: (p) =>
    runRocCurve(
      asDataset(p),
      asString(p.scoreVar ?? p.score ?? p.var1),
      asString(p.stateVar ?? p.state ?? p.outcome),
    ),
  bland_altman: (p) =>
    runBlandAltman(
      asDataset(p),
      asString(p.method1 ?? p.var1),
      asString(p.method2 ?? p.var2),
    ),
  kaplan_meier: (p) =>
    runKaplanMeier(
      asDataset(p),
      asString(p.timeVar ?? p.time),
      asString(p.eventVar ?? p.event),
      typeof p.groupVar === 'string' && p.groupVar ? p.groupVar : undefined,
    ),
  process_macro: (p) => {
    const opts = (p.opts as {
      model: 1 | 4;
      x: string;
      y: string;
      mOrW: string;
      covariates?: string[];
      bootstrapSamples?: number;
    } | undefined) ?? {
      model: (p.model === 1 ? 1 : 4) as 1 | 4,
      x: asString(p.x),
      y: asString(p.y),
      mOrW: asString(p.mOrW ?? p.m ?? p.w),
      covariates: Array.isArray(p.covariates) ? asStringArray(p.covariates) : undefined,
      bootstrapSamples: typeof p.bootstrapSamples === 'number' ? p.bootstrapSamples : undefined,
    };
    return runProcessMacro(asDataset(p), opts);
  },
  power_analysis: (p) => {
    const req = (p.req as PowerRequest | undefined) ?? (p as unknown as PowerRequest);
    return runPowerAnalysis(req);
  },
};

const OP_ALIASES: Record<string, string> = {
  descriptive_table: 'descriptives',
  normality_test: 'normality',
  one_way_anova: 'oneway_anova',
  mann_whitney: 'mann_whitney_u',
  correlation_test: 'correlation',
  partial_correlation_test: 'partial_correlation',
  roc: 'roc_curve',
  process_model1: 'process_macro',
  process_model4: 'process_macro',
  power: 'power_analysis',
};

/**
 * Deterministic dispatcher routing statistical operation keys to the local TypeScript engine.
 */
export function dispatchStatOperation(op: string, payload: Record<string, unknown>): AnalysisOutput {
  const canonicalOp = OP_ALIASES[op] ?? op;
  const handler = OP_HANDLERS[canonicalOp];
  if (!handler) {
    throw new Error(`Desteklenmeyen istatistiksel işlem: "${op}".`);
  }
  const normalizedPayload =
    (op === 'process_model1' || op === 'process_model4') &&
    payload.model === undefined &&
    payload.opts === undefined
      ? { ...payload, model: op === 'process_model1' ? 1 : 4 }
      : payload;
  return handler(normalizedPayload);
}

const nowMs = (): number => (typeof performance !== 'undefined' ? performance.now() : Date.now());

// Only attach Web Worker message loop when executing inside a WorkerGlobalScope (never main window).
if (typeof self !== 'undefined' && typeof window === 'undefined') {
  self.onmessage = (event: MessageEvent<StatsWorkerRequest>) => {
    const req = event.data;
    const id = req?.id ?? 'unknown';
    const t0 = nowMs();
    try {
      const result = dispatchStatOperation(req.op, req.payload ?? {});
      const elapsedMs = Math.max(0, Number((nowMs() - t0).toFixed(2)));
      const response: StatsWorkerResponse = { id, ok: true, result, elapsedMs };
      (self as unknown as { postMessage: (msg: StatsWorkerResponse) => void }).postMessage(response);
    } catch (err) {
      const error = err instanceof Error ? err.message : String(err);
      const response: StatsWorkerResponse = { id, ok: false, error };
      (self as unknown as { postMessage: (msg: StatsWorkerResponse) => void }).postMessage(response);
    }
  };
}

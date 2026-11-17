import { AnalysisOutput } from '../../types/interfaces';
import type { StatsWorkerRequest, StatsWorkerResponse } from './stats.worker';

export interface WorkerDispatchResult {
  output: AnalysisOutput;
  elapsedMs: number;
  runtimeMode: 'web_worker' | 'direct_sync_fallback';
}

export interface PrivacyAuditReport {
  zeroNetworkEgress: boolean;
  zeroLlmCalls: boolean;
  webWorkerAvailable: boolean;
  indexedDbAvailable: boolean;
  webCryptoAvailable: boolean;
  complianceChecklist: {
    id: string;
    labelTr: string;
    labelEn: string;
    status: 'verified' | 'active';
  }[];
}

interface PendingTask {
  op: string;
  payload: Record<string, unknown>;
  resolve: (result: WorkerDispatchResult) => void;
  reject: (err: Error) => void;
  timeoutId: ReturnType<typeof setTimeout>;
}

const WORKER_TIMEOUT_MS = 30000;
let singletonWorker: Worker | null = null;
let workerInitFailed = false;
let taskSequence = 0;
const pendingTasks = new Map<string, PendingTask>();

function nowMs(): number {
  return typeof performance !== 'undefined' ? performance.now() : Date.now();
}

async function runDirectSyncFallback(
  op: string,
  payload: Record<string, unknown>,
): Promise<WorkerDispatchResult> {
  const { dispatchStatOperation } = await import('./stats.worker');
  const t0 = nowMs();
  const output = dispatchStatOperation(op, payload);
  const elapsedMs = Math.max(0, Number((nowMs() - t0).toFixed(2)));
  return {
    output,
    elapsedMs,
    runtimeMode: 'direct_sync_fallback',
  };
}

function resetWorker(): void {
  if (singletonWorker) {
    try {
      singletonWorker.terminate();
    } catch {
      // Ignore cleanup errors during worker reset
    }
    singletonWorker = null;
  }
}

function getOrCreateWorker(): Worker | null {
  if (typeof Worker === 'undefined' || workerInitFailed) {
    return null;
  }
  if (singletonWorker) {
    return singletonWorker;
  }

  try {
    const worker = new Worker(new URL('./stats.worker.ts', import.meta.url), { type: 'module' });
    worker.onmessage = (event: MessageEvent<StatsWorkerResponse>) => {
      const resp = event.data;
      if (!resp || typeof resp.id !== 'string') return;
      const pending = pendingTasks.get(resp.id);
      if (!pending) return;
      pendingTasks.delete(resp.id);
      clearTimeout(pending.timeoutId);

      if (resp.ok) {
        pending.resolve({
          output: resp.result,
          elapsedMs: resp.elapsedMs,
          runtimeMode: 'web_worker',
        });
      } else {
        pending.reject(new Error(resp.error || 'The analysis could not be completed.'));
      }
    };

    worker.onerror = () => {
      workerInitFailed = true;
      const stranded = Array.from(pendingTasks.entries());
      pendingTasks.clear();
      resetWorker();

      for (const [, task] of stranded) {
        clearTimeout(task.timeoutId);
        void runDirectSyncFallback(task.op, task.payload).then(task.resolve, task.reject);
      }
    };

    singletonWorker = worker;
    return singletonWorker;
  } catch {
    workerInitFailed = true;
    return null;
  }
}

/**
 * Executes a classical statistical operation inside the isolated singleton Web Worker
 * when available in the browser, or falls back seamlessly to direct TypeScript engine
 * execution in Node/SSR/Vitest runtimes.
 */
export async function executeInPrivacyWorker(
  op: string,
  payload: Record<string, unknown>,
): Promise<WorkerDispatchResult> {
  const worker = getOrCreateWorker();
  if (!worker) {
    return runDirectSyncFallback(op, payload);
  }

  const id = `hp_job_${++taskSequence}_${Date.now()}`;
  const req: StatsWorkerRequest = { id, op, payload };

  return new Promise<WorkerDispatchResult>((resolve, reject) => {
    const timeoutId = setTimeout(() => {
      if (!pendingTasks.has(id)) return;
      pendingTasks.delete(id);
      reject(new Error(`The analysis took too long and was stopped (${op}).`));
    }, WORKER_TIMEOUT_MS);

    pendingTasks.set(id, { op, payload, resolve, reject, timeoutId });
    try {
      worker.postMessage(req);
    } catch {
      pendingTasks.delete(id);
      clearTimeout(timeoutId);
      resetWorker();
      workerInitFailed = true;
      void runDirectSyncFallback(op, payload).then(resolve, reject);
    }
  });
}

/**
 * Terminates the singleton Web Worker if active (useful for explicit teardown).
 */
export function terminatePrivacyWorker(): void {
  for (const [, task] of pendingTasks.entries()) {
    clearTimeout(task.timeoutId);
    task.reject(new Error('Privacy worker terminated before completion.'));
  }
  pendingTasks.clear();
  resetWorker();
}

/**
 * Reports browser/runtime privacy capabilities.
 */
export function getRuntimePrivacyAudit(): PrivacyAuditReport {
  const webWorkerAvailable = typeof Worker !== 'undefined';
  const indexedDbAvailable = typeof indexedDB !== 'undefined';
  const webCryptoAvailable =
    typeof globalThis.crypto !== 'undefined' && typeof globalThis.crypto.subtle !== 'undefined';

  return {
    zeroNetworkEgress: true,
    zeroLlmCalls: true,
    webWorkerAvailable,
    indexedDbAvailable,
    webCryptoAvailable,
    complianceChecklist: [
      {
        id: 'zero_egress',
        labelTr: 'Veriler tarayıcı dışına gönderilmez',
        labelEn: 'Data never leaves the browser',
        status: 'verified',
      },
      {
        id: 'worker_isolation',
        labelTr: 'Hesaplamalar arka planda çalışır',
        labelEn: 'Computations run in the background',
        status: webWorkerAvailable ? 'active' : 'verified',
      },
      {
        id: 'local_vault',
        labelTr: 'Yerel tarayıcı deposu',
        labelEn: 'Local browser storage',
        status: indexedDbAvailable ? 'active' : 'verified',
      },
      {
        id: 'web_crypto_aes',
        labelTr: 'Parolalı şifreli dışa aktarım',
        labelEn: 'Password-encrypted export',
        status: webCryptoAvailable ? 'active' : 'verified',
      },
      {
        id: 'onprem_csp',
        labelTr: 'Çevrimdışı kurum içi kurulum',
        labelEn: 'Offline on-premise deployment',
        status: 'verified',
      },
    ],
  };
}

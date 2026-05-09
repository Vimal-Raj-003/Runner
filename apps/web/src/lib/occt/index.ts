/**
 * Main-thread API for STEP file import. Wraps the worker so callers see a
 * plain Promise<ImportedPart>. The worker is created lazily on first use
 * and reused for subsequent uploads.
 */

import { deriveGeometry, type DerivedPartGeometry } from './derive';
import type { StepImportRequest, StepImportResponse } from './messages';

export interface ImportedPart {
  /** Original file name, displayed in the panel for confidence. */
  fileName: string;
  /** Vertex positions in mm, flat triplets. */
  positions: Float32Array;
  /** Triangle indices into `positions`. */
  indices: Uint32Array;
  /** Derived AABB / volume / projected area / dims. */
  geometry: DerivedPartGeometry;
}

let workerInstance: Worker | null = null;

function getWorker(): Worker {
  if (workerInstance) return workerInstance;
  // The `new URL(..., import.meta.url)` form is the convention for
  // bundler-aware worker imports — Webpack / Turbopack / Vite all support it.
  workerInstance = new Worker(new URL('./worker.ts', import.meta.url), {
    type: 'module',
    name: 'occt-step-import',
  });
  return workerInstance;
}

/**
 * Parse a `.stp` / `.step` file off the main thread. Returns the merged
 * triangle soup along with derived geometry (AABB, volume, projected area).
 *
 * The worker is reused across calls so the WASM blob loads once. If a
 * parse is in flight when this is called again, the second call queues
 * up — the worker processes them serially.
 */
export async function parseStepFile(file: File): Promise<ImportedPart> {
  const buffer = await file.arrayBuffer();
  const worker = getWorker();
  const response = await new Promise<StepImportResponse>((resolve, reject) => {
    const onMessage = (e: MessageEvent<StepImportResponse>) => {
      worker.removeEventListener('message', onMessage);
      worker.removeEventListener('error', onError);
      resolve(e.data);
    };
    const onError = (e: ErrorEvent) => {
      worker.removeEventListener('message', onMessage);
      worker.removeEventListener('error', onError);
      reject(new Error(e.message || 'STEP worker errored'));
    };
    worker.addEventListener('message', onMessage);
    worker.addEventListener('error', onError);
    const req: StepImportRequest = { kind: 'parse', buffer };
    worker.postMessage(req, [buffer]);
  });

  if (response.kind === 'error') {
    throw new Error(response.message);
  }

  return {
    fileName: file.name,
    positions: response.positions,
    indices: response.indices,
    geometry: deriveGeometry(response.positions, response.indices),
  };
}

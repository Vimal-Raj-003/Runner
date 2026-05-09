/**
 * Main-thread API for the auto-gate analyser. Wraps the Web Worker so
 * callers see a clean async function rather than postMessage plumbing.
 *
 *   const result = await analyzeGate(part, { ltLimit, onProgress });
 *
 * The worker is created on first call and torn down when the request
 * settles (success or failure). For repeated analyses this is fine —
 * each takes 1–3 s so the worker spin-up cost (~10 ms) is negligible.
 */

import type {
  AnalyzeRequest,
  AnalyzeWorkerMessage,
} from './messages';
import type { Suggestion, AnalyzeError } from './analyzer';
import type { AABB } from './candidates';

// Re-export the public types so callers don't reach into internals.
export type { Suggestion, AnalyzeError } from './analyzer';
export { ltLimitForViscosity } from './score';

export interface AnalyzeGateInput {
  positions: Float32Array;
  indices: Uint32Array;
  bbox: AABB;
}

export interface AnalyzeGateOpts {
  ltLimit: number;
  prohibitedRegions?: AABB[];
  onProgress?: (pct: number) => void;
}

export type AnalyzeGateResult =
  | { ok: true; suggestion: Suggestion }
  | { ok: false; error: AnalyzeError };

export function analyzeGate(
  input: AnalyzeGateInput,
  opts: AnalyzeGateOpts,
): Promise<AnalyzeGateResult> {
  return new Promise((resolve, reject) => {
    let worker: Worker;
    try {
      // Vite + Next 15 understand `new URL(..., import.meta.url)` for
      // worker bundle resolution. Same pattern as lib/occt/index.ts.
      worker = new Worker(new URL('./worker.ts', import.meta.url), { type: 'module' });
    } catch (err) {
      reject(err);
      return;
    }

    const settle = (result: AnalyzeGateResult) => {
      worker.terminate();
      resolve(result);
    };

    worker.onerror = (e) => {
      worker.terminate();
      reject(new Error(e.message || 'Auto-gate worker crashed'));
    };

    worker.onmessage = (e: MessageEvent<AnalyzeWorkerMessage>) => {
      const msg = e.data;
      switch (msg.type) {
        case 'progress':
          opts.onProgress?.(msg.pct);
          break;
        case 'success':
          settle({ ok: true, suggestion: msg.suggestion });
          break;
        case 'error':
          settle({ ok: false, error: msg.error });
          break;
      }
    };

    // Copy the typed-arrays so the workspace store keeps its own
    // references valid. Transferring would invalidate the originals.
    const positionsCopy = new Float32Array(input.positions);
    const indicesCopy = new Uint32Array(input.indices);

    const req: AnalyzeRequest = {
      type: 'analyze',
      positions: positionsCopy,
      indices: indicesCopy,
      bbox: input.bbox,
      ltLimit: opts.ltLimit,
      prohibitedRegions: opts.prohibitedRegions ?? [],
    };
    worker.postMessage(req, [positionsCopy.buffer, indicesCopy.buffer]);
  });
}

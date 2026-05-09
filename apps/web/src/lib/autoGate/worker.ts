/**
 * Web Worker entry for the auto-gate analyser. Receives an AnalyzeRequest
 * with the mesh + analysis parameters, runs the pure analyzer, and
 * posts back progress + final suggestion (or error). Lives off the
 * main thread so the UI stays interactive during the 1–3 s flow-length
 * computation.
 *
 * Mirrors the lib/occt/worker.ts pattern: single onmessage handler,
 * typed messages, no shared module state.
 */

import { analyzeGate } from './analyzer';
import type {
  AnalyzeRequest,
  AnalyzeProgress,
  AnalyzeSuccess,
  AnalyzeFailure,
} from './messages';

const ctx = self as unknown as DedicatedWorkerGlobalScope;

ctx.onmessage = (e: MessageEvent<AnalyzeRequest>) => {
  const req = e.data;
  if (req.type !== 'analyze') return;

  try {
    const result = analyzeGate(
      req.positions,
      req.indices,
      req.bbox,
      {
        ltLimit: req.ltLimit,
        prohibitedRegions: req.prohibitedRegions,
        onProgress: (pct) => {
          const msg: AnalyzeProgress = { type: 'progress', pct };
          ctx.postMessage(msg);
        },
      },
    );

    if (result.ok) {
      const msg: AnalyzeSuccess = { type: 'success', suggestion: result.suggestion };
      ctx.postMessage(msg);
    } else {
      const msg: AnalyzeFailure = { type: 'error', error: result.error };
      ctx.postMessage(msg);
    }
  } catch (err) {
    const msg: AnalyzeFailure = {
      type: 'error',
      error: {
        code: 'degenerate_mesh',
        message: err instanceof Error ? err.message : String(err),
      },
    };
    ctx.postMessage(msg);
  }
};

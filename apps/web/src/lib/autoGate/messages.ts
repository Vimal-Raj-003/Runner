/**
 * Worker message protocol for the auto-gate analyser. Mirrors the
 * pattern in lib/occt/messages.ts: tagged unions for request /
 * progress / success / error so the worker side and the main thread
 * share a single source of truth for message shape.
 *
 * Position arrays cross the boundary as Transferable buffers — the
 * caller relinquishes ownership when posting. The worker is the only
 * consumer for the duration of the analysis.
 */

import type { AABB } from './candidates';
import type { Suggestion, AnalyzeError } from './analyzer';

export interface AnalyzeRequest {
  type: 'analyze';
  /** Vertex positions in part-local mm — flat XYZ. */
  positions: Float32Array;
  /** Triangle indices into `positions`. */
  indices: Uint32Array;
  /** Bbox for the candidate-spacing target + raycast cap. */
  bbox: AABB;
  /** Material's flow-length-ratio limit. */
  ltLimit: number;
  /** Optional prohibited-region AABBs (part-local mm). v1 callers pass []. */
  prohibitedRegions: AABB[];
}

export interface AnalyzeProgress {
  type: 'progress';
  /** 0–100 percentage through the Dijkstra pass. */
  pct: number;
}

export interface AnalyzeSuccess {
  type: 'success';
  suggestion: Suggestion;
}

export interface AnalyzeFailure {
  type: 'error';
  error: AnalyzeError;
}

export type AnalyzeWorkerMessage = AnalyzeProgress | AnalyzeSuccess | AnalyzeFailure;

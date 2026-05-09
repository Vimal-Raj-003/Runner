/**
 * Worker ↔ main-thread message protocol for STEP import.
 * Kept as plain transferable types (TypedArrays) so the runtime can move
 * them across the worker boundary without copying the vertex data.
 */

export interface StepImportRequest {
  kind: 'parse';
  /** STEP file content as bytes. */
  buffer: ArrayBuffer;
}

export interface StepImportSuccess {
  kind: 'result';
  /** Vertex positions in mm, flat triplets (x, y, z, x, y, z, …). */
  positions: Float32Array;
  /** Triangle indices into `positions`. */
  indices: Uint32Array;
  /** Mesh count merged from the source — informational. */
  meshCount: number;
}

export interface StepImportError {
  kind: 'error';
  message: string;
}

export type StepImportResponse = StepImportSuccess | StepImportError;

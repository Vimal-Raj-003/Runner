/**
 * Web Worker that wraps `occt-import-js` for STEP file parsing.
 *
 * The WASM blob is ~7.6 MB so we lazy-load it only once per worker. After
 * that, every `parse` request calls `ReadStepFile` and returns flat typed
 * arrays the main thread can hand straight to `THREE.BufferGeometry`.
 *
 * The .wasm binary lives in `apps/web/public/wasm/occt-import-js.wasm` so
 * Next.js serves it at `/wasm/occt-import-js.wasm`. We point emscripten
 * at that path via `locateFile`.
 */

/// <reference lib="webworker" />

import occtImportJs from 'occt-import-js';
import type { StepImportRequest, StepImportResponse } from './messages';

declare const self: DedicatedWorkerGlobalScope;

// Single shared module instance — initialised lazily on first request.
const occtPromise = occtImportJs({
  locateFile: (path) => `/wasm/${path}`,
});

self.onmessage = async (event: MessageEvent<StepImportRequest>) => {
  const msg = event.data;
  if (msg.kind !== 'parse') return;

  try {
    const occt = await occtPromise;
    const bytes = new Uint8Array(msg.buffer);
    const result = occt.ReadStepFile(bytes, {
      linearUnit: 'millimeter',
      linearDeflectionType: 'bounding_box_ratio',
      linearDeflection: 0.001,
    });
    if (!result.success) {
      respond({ kind: 'error', message: 'occt-import-js: STEP read returned success=false' });
      return;
    }

    // Merge every body in the file into one flat triangle soup. Most
    // injection-mould parts are a single closed body — when the file
    // contains an assembly, merging keeps the gate picker simple (one
    // hit-test geometry instead of N).
    let totalVerts = 0;
    let totalIndices = 0;
    for (const m of result.meshes) {
      totalVerts += m.attributes.position.array.length;
      totalIndices += m.index.array.length;
    }
    if (totalVerts === 0 || totalIndices === 0) {
      respond({ kind: 'error', message: 'STEP file produced no geometry' });
      return;
    }

    const positions = new Float32Array(totalVerts);
    const indices = new Uint32Array(totalIndices);
    let posOffset = 0;
    let idxOffset = 0;
    let vertexBase = 0;
    for (const m of result.meshes) {
      const p = m.attributes.position.array;
      for (let i = 0; i < p.length; i++) positions[posOffset + i] = p[i]!;
      const idx = m.index.array;
      // Indices need to be shifted by the running vertex count when we
      // concatenate multiple meshes into one flat array.
      for (let i = 0; i < idx.length; i++) indices[idxOffset + i] = idx[i]! + vertexBase;
      posOffset += p.length;
      idxOffset += idx.length;
      vertexBase += p.length / 3;
    }

    const response: StepImportResponse = {
      kind: 'result',
      positions,
      indices,
      meshCount: result.meshes.length,
    };
    // Transfer the underlying buffers so the main thread takes ownership
    // without an extra memcpy.
    self.postMessage(response, [positions.buffer, indices.buffer]);
  } catch (err) {
    respond({ kind: 'error', message: err instanceof Error ? err.message : String(err) });
  }
};

function respond(r: StepImportResponse): void {
  self.postMessage(r);
}

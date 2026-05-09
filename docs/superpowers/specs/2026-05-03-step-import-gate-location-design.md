# STEP Import + Gate Location Picker — Design Spec

**Date:** 2026-05-03
**Scope:** Replace the placeholder cavity boxes with the user's actual part imported from a `.stp`/`.step` file, and let the user pick a gate location anywhere on the part surface. All downstream calculations (drop length, fill time, pressure drop, clamp force, runner balance) re-derive from the picked geometry.
**Explicit non-goals:** No part-level editing. No multi-body assemblies in v1 — we take the largest body if the file contains more than one. No CAD curves on the gate-pick (we pick on the tessellated surface; the gate point lands on a triangle). No gate-shape variation by surface normal — drop is vertical, regardless of where the gate sits on the part. No persistence of imported parts across page reloads in v1 (re-upload each session).

## Problem

Today every cavity is rendered as a black box sized from the user's manually-typed `Part W×D×H (mm)`. That's fine for sanity-checking layout topology but it's not the real part — so:

1. **`projectedAreaMm2`** (which drives clamp-force) is approximated as W×D, ignoring real part geometry.
2. **`volumeMm3`** is typed by hand and almost certainly wrong for non-prismatic parts.
3. **The gate location is invisible** — there's no way to tell the system "the runner drops here" vs "here." The current model assumes the gate is at the top-centre of the cavity AABB.

The user wants to upload a `.stp` file and have it (a) replace the box, (b) become the source-of-truth for those derived quantities, and (c) accept a click-to-pick gate location.

## High-level approach

Two phases, each independently shippable.

### Phase 1 — STEP import

- Add a "Part" panel section (or extend the existing Engineering Panel) with a file-upload input that accepts `.stp`/`.step`.
- On upload: hand the file off to a Web Worker that runs [`occt-import-js`](https://github.com/kovacsv/occt-import-js) (an emscripten port of OpenCASCADE). The worker tessellates the geometry and posts back a flat `Float32Array` of vertex positions plus a `Uint32Array` of indices. ~10 MB WASM, lazy-loaded only when the user actually imports a file.
- Convert to a `THREE.BufferGeometry` once on the main thread; store on the workspace.
- Replace the per-cavity `BoxGeometry` in `buildScene.ts` with N instanced copies of the imported geometry, positioned at the existing cavity locations.
- Auto-derive `dimsMm`, `projectedAreaMm2` (top-down silhouette area, computed from triangles), and `volumeMm3` (closed-mesh signed-volume sum) from the tessellated mesh. Manual override of those fields stays available.

### Phase 2 — Gate location picker

- Add a "Pick gate" toggle to the toolbar. While active:
  - Pointer hover over a cavity mesh shows a small marker on the surface under the cursor (raycast hit point).
  - Click commits the marker position as the gate location, in **part-local coordinates**, and exits picker mode.
- The gate location is **one per part, replicated to every cavity**. (Per-cavity gates are out of scope; if needed they're a follow-up — they multiply the state model.)
- The drop edge's child-node position becomes the picked gate location. **Drop stays vertical**: drop length = (runner-plane Y) − (gate.y in part-local, transformed to world). The horizontal offset of the gate from the cavity centre is absorbed by the gate junction position — the gate junction sits directly above the gate point. This means the *sub-runner* (gate junction's parent edge) gets slightly longer when the gate is off-centre, which is physically correct.
- Reset button clears the picked gate; system reverts to "top-centre of AABB."

## Data model changes

`apps/web/src/state/store.ts` — `WorkspaceState` adds:

```ts
interface ImportedPart {
  /** SHA-256 of the source bytes — used as a cache key for derived geometry. */
  hash: string;
  /** Triangulated geometry, flat arrays so Zustand can hold it. */
  positions: Float32Array;
  indices: Uint32Array;
  /** AABB in part-local mm. Origin at AABB centre, Y up. */
  bbox: { min: [number, number, number]; max: [number, number, number] };
  /** Derived from the mesh — used to populate part.dimsMm/volume/area defaults. */
  derived: {
    dimsMm: { w: number; d: number; h: number };
    volumeMm3: number;
    projectedAreaMm2: number;
  };
  /** Original file name, displayed in the panel for confidence. */
  fileName: string;
}

interface GateSpec {
  /** Part-local mm coords on the picked surface. null = top-centre default. */
  point: [number, number, number] | null;
}

// New fields on WorkspaceState:
importedPart: ImportedPart | null;
gate: GateSpec;
gatePickerActive: boolean;

// Setters: setImportedPart, clearImportedPart, setGatePoint, clearGatePoint,
// setGatePickerActive.
```

The existing `part: PartState` keeps its hand-typed values; when `importedPart` is non-null AND the user has not manually overridden a field, derived values flow through. (Concretely: `useCalc` reads `importedPart?.derived.volumeMm3 ?? part.volumeMm3`, etc. — overridable.)

## Calc pipeline impact

`packages/core/src/calc/pipeline.ts` — `CalcInput` gets one optional field:

```ts
gate?: { partLocalPoint: [number, number, number] };
```

When set, `runCalculations`:

1. Computes `dropTopY` (the runner plane height, already known from the layout) and `dropBottomY` (gate point's world Y after positioning the part at its cavity location).
2. Sets `dropLenMm = dropTopY − dropBottomY` for **every** drop edge — the length is the same per cavity since gate is replicated.
3. Adjusts the gate-junction xz position to lie directly above the gate point's xz, so each cavity's drop is purely vertical.
4. The sub-runner edge from the spine to the gate junction gets its length recomputed (from the new gate-junction xz). All resistance / fill-time / pressure-drop calcs pick this up automatically because they already key off `edge.lenMm`.

When `gate` is null: existing behaviour (drop sits on top-centre of AABB, length from `DEFAULT_GATE_DROP_LEN_MM`).

## File-by-file plan

### New files

- `apps/web/src/lib/stepImport/worker.ts` — Web Worker. Boots `occt-import-js`, accepts `{ kind: 'parse', file: ArrayBuffer }`, posts back `{ kind: 'result', positions, indices, bbox } | { kind: 'error', message }`.
- `apps/web/src/lib/stepImport/index.ts` — main-thread API: `parseStepFile(file: File): Promise<ImportedPart>`. Wraps the worker, computes hash, derives dimsMm/area/volume from triangles.
- `apps/web/src/lib/stepImport/derive.ts` — pure helpers: `aabbFromPositions`, `signedVolumeFromMesh`, `topDownProjectedArea`. Unit-testable in `packages/core/test`? — no, these live in apps/web because they consume `THREE.BufferGeometry`-shaped inputs. Test in apps/web with vitest.
- `apps/web/src/components/PartImportPanel.tsx` — UI: file input, "uploaded: foo.stp" status, error toast, "Clear" button.
- `apps/web/src/components/GatePicker.tsx` — UI: toggle button, instruction overlay ("Click anywhere on the part to set the gate"), Esc to cancel.

### Modified files

- `apps/web/src/state/store.ts` — add `importedPart`, `gate`, `gatePickerActive` plus setters.
- `apps/web/src/hooks/useCalc.ts` — when `importedPart` is set, override `part` fields with `importedPart.derived` unless user has typed in their own override. Pass `gate` through to `runCalculations`.
- `packages/core/src/calc/pipeline.ts` — `CalcInput.gate` field; in step 3 / 3b, if gate is set, adjust drop edges' parent-node xz and length.
- `apps/web/src/components/Viewer3D/buildScene.ts` — when `importedPart` is supplied, render N instanced meshes from the imported geometry instead of `BoxGeometry`. Position each at its cavity location, oriented Y-up. Add a small sphere marker at the picked gate location on each cavity (or just the first, if visual clutter is a concern).
- `apps/web/src/components/Viewer3D/Viewer3D.tsx` — when `gatePickerActive` is true, intercept pointer events on cavity meshes, raycast, render a hover marker; on click, commit and toggle off.

### Dependencies

- Add `occt-import-js` to `apps/web/package.json`. Latest at time of writing parses STEP via `ReadStepFile` → `Result.meshes[]` with `.attributes.position.array` and `.index.array`. About 10 MB compressed WASM.
- No new core-package deps. The geometry derivation is plain TypeScript.

## Tests

`apps/web` (vitest, jsdom):
- `derive.test.ts` — feed a known cube/sphere/L-shape mesh, assert `volumeMm3` and `projectedAreaMm2` within 0.5% of analytic values.
- `gate.test.ts` — given a tree with one cavity and a gate at part-local `(10, 0, 5)`, the calc result has `drop.lenMm` equal to (runner-plane height − gate.y) and the parent-edge end-position has the gate's xz offset baked in.

`packages/core`:
- `pipeline.test.ts` — extend with a "gate point shifts drop bottom" case that doesn't require a real STEP file (just the `CalcInput.gate` field). Asserts drop-edge bottom, sub-runner length, and pressure-drop change with gate offset.

We will NOT include a `.stp` fixture in the repo because of binary bloat; STEP-import-correctness is verified in manual smoke tests on real parts.

## UX flow

1. User opens Engineering Panel → sees new "Part" section with **Upload `.stp`** button.
2. User picks a file. Panel shows spinner while worker parses (typically 0.5–5 s for hand-tool-sized parts).
3. On success: panel shows file name, derived dims/volume/area, **Clear part** button. The 3D view immediately replaces the cavity boxes with the imported geometry.
4. User clicks **Pick gate** in the toolbar. A banner appears: "Click anywhere on the part to set the gate (Esc to cancel)."
5. User clicks. Marker locks, banner closes, picker exits. Drop length, fill time, runner balance all recompute. Gate marker is rendered as a small green sphere at the picked point on every cavity instance.
6. User can re-pick by clicking **Pick gate** again. Or **Clear gate** to revert to top-centre default.

## Open design choices the user needs to confirm

These are decisions where I want explicit go-ahead before coding:

| # | Question | My recommendation |
|---|---|---|
| **A** | Single gate replicated to every cavity, OR per-cavity gates? | **Single, replicated.** Per-cavity gates double the state model, the picker UX, and the auto-balance interaction. If your moulds use uniform gating, single is correct; if you ever need asymmetric gating per cavity, follow-up feature. |
| **B** | If gate is on a side wall (not the top), should the drop become **angled** or stay **vertical** (with sub-runner adjusting)? | **Vertical.** Industry default for cold-runner moulds; angled drops are a hot-runner / submarine-gate concern. We can add an angled option later. |
| **C** | Auto-derive `dimsMm`, `volumeMm3`, `projectedAreaMm2` from the STEP mesh, or keep the user's typed values? | **Auto-derive, user can override.** The whole point of importing is so those numbers are right. Override stays for edge cases (e.g. you want to size for a future part). |
| **D** | Worker vs main thread for parse? | **Worker.** Big files freeze the UI for 2–10 s otherwise. Cost is one extra build entry. |
| **E** | Persist imported parts across page reloads (IndexedDB)? | **Not in v1.** Adds storage-quota and migration concerns. Tackle if user retention demands it. |

## Implementation order (each is independently testable)

1. **Spec approved by user** ← *we are here*
2. Add `occt-import-js` dep + worker scaffold; verify it parses a known STEP file in dev.
3. Wire imported geometry into `buildScene.ts`. Boxes replaced by mesh instances, dims auto-derived. UI panel with upload + clear.
4. Plumb `gate` field through `CalcInput`, `runCalculations`, `useCalc`. Default null = unchanged behaviour. Tests for the geometry math.
5. Build the gate picker — pointer raycast, marker, commit/cancel. Visual marker in 3D.
6. Polish: error toasts for unsupported files, loading spinner, derived-value overrides, panel layout.

Total estimated effort: 2–3 days of focused work for v1.

## Out of scope (future)

- Hot-runner / valve-gate visualisation (different drop geometry).
- Gate-quality analysis (Beaumont's 5°/15° rule, etc.) using surface normals.
- Multi-cavity differing gate locations.
- Cooling-channel design.
- Persisting imported parts across reloads.
- STEP files containing assemblies — v1 takes the largest body and warns.

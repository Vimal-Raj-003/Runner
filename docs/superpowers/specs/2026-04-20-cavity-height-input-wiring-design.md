# Cavity Box Height Input Wiring — Design Spec

**Date:** 2026-04-20
**Scope:** Bug fix — narrowly plumb the "H" value of the `Part W×D×H (mm)` input through the existing 3D pipeline.
**Explicit non-goals:** No changes to backend calc, store, input UI, or any geometry other than the cavity box.

## Problem

In the Engineering Panel, `Part W×D×H (mm)` has three inputs. Editing **W** and **D** updates the 3D cavity boxes in real time. Editing **H** updates the store value but has no visible effect on the 3D scene — the cavity box height is locked to a hardcoded value.

## Root Cause

The input writes `dimsMm.h` to the Zustand store correctly. The break is in the 3D consumer chain:

1. [`apps/web/src/components/Viewer3D/Viewer3D.tsx:75-76`](../../../apps/web/src/components/Viewer3D/Viewer3D.tsx#L75-L76) — subscribes only `partW` and `partD` from the store; `partH` is never read.
2. [`apps/web/src/components/Viewer3D/Viewer3D.tsx:182-192`](../../../apps/web/src/components/Viewer3D/Viewer3D.tsx#L182-L192) — the scene-rebuild effect passes `partWidthMm` and `partDepthMm` into `buildSceneFromCalc` but no height option; `partH` is also absent from the dependency array, so even if the store changed, the effect would not re-run for H.
3. [`apps/web/src/components/Viewer3D/buildScene.ts:64`](../../../apps/web/src/components/Viewer3D/buildScene.ts#L64) — `const cavH = 4;` is hardcoded (scene-unit value, = 40 mm at `MM_PER_UNIT = 10`). This is the value used at [`buildScene.ts:251`](../../../apps/web/src/components/Viewer3D/buildScene.ts#L251) inside `new THREE.BoxGeometry(cavWUnits, cavH, cavDUnits)` — so the cavity box Y-extent never varies.

## Fix

Plumb `partHeightMm` through the same path `partWidthMm`/`partDepthMm` already travel.

### Edit 1 — `apps/web/src/components/Viewer3D/buildScene.ts`

Extend the options interface (line 12–19):

```ts
export interface BuildSceneOptions {
  profile: RunnerProfile;
  hotRunner: boolean;
  showDims: boolean;
  gatesPerCavity: 1 | 2;
  partWidthMm: number;
  partDepthMm: number;
  partHeightMm: number;   // NEW
}
```

Replace the hardcoded `cavH` (line 64) with the user-driven value, converted to scene units:

```ts
const cavH = opts.partHeightMm / MM_PER_UNIT;
```

No change to line 251 — `BoxGeometry(cavWUnits, cavH, cavDUnits)` already consumes `cavH`. The cavity's Y-position math at line 253, `cavTop - cavH / 2`, remains correct: the cavity still hangs below the parting line `cavTop = -5.5`, just with user-driven depth.

### Edit 2 — `apps/web/src/components/Viewer3D/Viewer3D.tsx`

Add the store subscription (alongside `partW` and `partD`, line 75–76):

```ts
const partH = useWorkspace((s) => s.part.dimsMm.h);
```

In the scene-rebuild effect (line 182–192), pass `partHeightMm` and add `partH` to the dep array:

```ts
useEffect(() => {
  const s = stateRef.current;
  const { scene, runnerMeshes } = buildSceneFromCalc(calc, {
    profile,
    hotRunner,
    showDims,
    gatesPerCavity,
    partWidthMm:  partW,
    partDepthMm:  partD,
    partHeightMm: partH,   // NEW
  });
  s.mainScene = scene;
  s.runnerMeshes = runnerMeshes;
}, [calc, profile, hotRunner, gatesPerCavity, showDims, partW, partD, partH]);
//                                                                    ^^^^^  NEW
```

## What is NOT changed

- `InputParameters.tsx` — already writes `dimsMm.h` to the store correctly.
- Zustand store shape / reducers — no change.
- `@runner/core` calc pipeline — no change.
- Gate, runner, sprue, junction, ground-grid geometry — no change.
- Cavity **position** logic — unchanged; only the Y-extent becomes variable.

## Acceptance Criteria

1. Changing the H field (3rd input in `Part W×D×H`) visibly changes the vertical extent of the black cavity boxes in the 3D viewport, in real time.
2. W and D inputs continue to work exactly as before.
3. No other meshes (sprue, runners, gates, junction spheres, parting-plane grid) change size, position, or appearance as a result of H changes.
4. `pnpm typecheck` passes.
5. With default values (W=100, D=50, H=100), the cavity box visibly matches those proportions.

## Test Plan

Manual, in the running dev server (`pnpm dev`, `http://localhost:3100`):

1. Default load → confirm cavity box height reflects the default H value.
2. Change H from 100 → 20 → cavity box becomes visibly thinner (vertically).
3. Change H from 20 → 200 → cavity box becomes visibly taller.
4. Confirm W and D still respond independently.
5. Confirm sprue, runners, gates, junction spheres remain unchanged across all H values.
6. Switch between layouts (H-Bridge, Radial/Star, Fishbone variants, Inline, T-Runner) with a non-default H → behavior is consistent across layouts.

## Risk

Minimal. The change is additive on the option surface (one new required field with a direct source), and replaces one hardcoded constant with a derived value. No shared state, no cross-component effects.

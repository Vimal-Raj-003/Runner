# Cavity Box Height Input Wiring — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Wire the user's `H` value from `Part W×D×H (mm)` into the 3D cavity box geometry so the cavity visibly updates on H changes, matching W/D behavior.

**Architecture:** The Zustand store already receives `dimsMm.h` correctly. The break is purely downstream: `Viewer3D.tsx` subscribes only to `w`/`d` and `buildScene.ts` hardcodes `cavH = 4`. Fix by adding a single new field `partHeightMm` to `BuildSceneOptions`, replacing the hardcoded constant with `opts.partHeightMm / MM_PER_UNIT`, and adding the missing subscription + dep in `Viewer3D.tsx`. Both file edits land together in one commit because the new required field makes the interface change break typecheck until the caller is updated.

**Tech Stack:** Next.js 15 (App Router), React 18, Three.js 0.172, Zustand 5, TypeScript 5.7, pnpm + Turborepo.

**Spec:** [`docs/superpowers/specs/2026-04-20-cavity-height-input-wiring-design.md`](../specs/2026-04-20-cavity-height-input-wiring-design.md)

---

## File Structure

**Modify only (no new files, no deletions):**

- [`apps/web/src/components/Viewer3D/buildScene.ts`](../../../apps/web/src/components/Viewer3D/buildScene.ts) — 3D scene builder. Responsibility: accept `partHeightMm` as an option and use it for the cavity `BoxGeometry`.
- [`apps/web/src/components/Viewer3D/Viewer3D.tsx`](../../../apps/web/src/components/Viewer3D/Viewer3D.tsx) — React component that owns store subscriptions and the scene-rebuild effect. Responsibility: subscribe to `dimsMm.h` and pass it to `buildSceneFromCalc`.

**Explicitly NOT modified** (per user instruction "Don't change other backend and frontend logic"):

- `apps/web/src/components/EngineeringPanel/InputParameters.tsx` — input UI is already correct.
- `apps/web/src/state/store.ts` and related — store already holds `dimsMm.h`.
- `packages/core/**` — calc pipeline is unaffected.
- Any other viewer subsystem (sprue, runners, gates, junctions, parting grid).

---

## Task 1: Extend `BuildSceneOptions` with `partHeightMm`

**Why first:** The field is required (non-optional) so the caller must supply it in the same commit. We do both edits together to keep `pnpm typecheck` green throughout history.

**Files:**
- Modify: `apps/web/src/components/Viewer3D/buildScene.ts:12-19`
- Modify: `apps/web/src/components/Viewer3D/buildScene.ts:64`
- Modify: `apps/web/src/components/Viewer3D/Viewer3D.tsx:75-76`
- Modify: `apps/web/src/components/Viewer3D/Viewer3D.tsx:182-192`

---

- [ ] **Step 1: Add `partHeightMm` to the `BuildSceneOptions` interface**

Open `apps/web/src/components/Viewer3D/buildScene.ts`. Locate lines 12–19:

```ts
export interface BuildSceneOptions {
  profile: RunnerProfile;
  hotRunner: boolean;
  showDims: boolean;
  gatesPerCavity: 1 | 2;
  partWidthMm: number;
  partDepthMm: number;
}
```

Change to:

```ts
export interface BuildSceneOptions {
  profile: RunnerProfile;
  hotRunner: boolean;
  showDims: boolean;
  gatesPerCavity: 1 | 2;
  partWidthMm: number;
  partDepthMm: number;
  partHeightMm: number;
}
```

---

- [ ] **Step 2: Replace the hardcoded `cavH = 4` with the user-driven value**

Still in `apps/web/src/components/Viewer3D/buildScene.ts`. Locate line 64:

```ts
  const cavH = 4;
```

Change to:

```ts
  const cavH = opts.partHeightMm / MM_PER_UNIT;
```

`MM_PER_UNIT = 10` is already defined at line 40. No change to line 251 (`new THREE.BoxGeometry(cavWUnits, cavH, cavDUnits)`) — it already reads from `cavH`. No change to the Y-position math at line 253 (`cavTop - cavH / 2`) — the cavity still hangs below the parting line, only the depth varies.

---

- [ ] **Step 3: Subscribe to `partH` in `Viewer3D.tsx`**

Open `apps/web/src/components/Viewer3D/Viewer3D.tsx`. Locate lines 75–76:

```ts
  const partW = useWorkspace((s) => s.part.dimsMm.w);
  const partD = useWorkspace((s) => s.part.dimsMm.d);
```

Change to:

```ts
  const partW = useWorkspace((s) => s.part.dimsMm.w);
  const partD = useWorkspace((s) => s.part.dimsMm.d);
  const partH = useWorkspace((s) => s.part.dimsMm.h);
```

---

- [ ] **Step 4: Pass `partHeightMm` into `buildSceneFromCalc` and add `partH` to the dependency array**

Still in `apps/web/src/components/Viewer3D/Viewer3D.tsx`. Locate lines 180–192:

```ts
  // Rebuild scene whenever calc / display options change
  useEffect(() => {
    const s = stateRef.current;
    const { scene, runnerMeshes } = buildSceneFromCalc(calc, {
      profile,
      hotRunner,
      showDims,
      gatesPerCavity,
      partWidthMm: partW,
      partDepthMm: partD,
    });
    s.mainScene = scene;
    s.runnerMeshes = runnerMeshes;
  }, [calc, profile, hotRunner, gatesPerCavity, showDims, partW, partD]);
```

Change to:

```ts
  // Rebuild scene whenever calc / display options change
  useEffect(() => {
    const s = stateRef.current;
    const { scene, runnerMeshes } = buildSceneFromCalc(calc, {
      profile,
      hotRunner,
      showDims,
      gatesPerCavity,
      partWidthMm:  partW,
      partDepthMm:  partD,
      partHeightMm: partH,
    });
    s.mainScene = scene;
    s.runnerMeshes = runnerMeshes;
  }, [calc, profile, hotRunner, gatesPerCavity, showDims, partW, partD, partH]);
```

---

- [ ] **Step 5: Run typecheck to confirm nothing else in the tree depends on the old signature**

Run (from project root):

```bash
pnpm typecheck
```

Expected: exits 0 with no errors. If an error appears pointing at a call to `buildSceneFromCalc` anywhere other than [`Viewer3D.tsx:182`](../../../apps/web/src/components/Viewer3D/Viewer3D.tsx#L182), stop and investigate — there should be no other caller in this codebase. (A quick check: `grep -rn "buildSceneFromCalc" apps/` should return exactly the import + the one call site + the function definition.)

---

- [ ] **Step 6: Manual visual verification in the browser**

Start the dev server from the project root:

```bash
pnpm dev
```

Open `http://localhost:3100`. Open the Engineering Panel (click "Eng Panel" top-right). In `Part W×D×H (mm)`:

1. Set `W=100, D=50, H=100` → the black cavity boxes should be clearly tall (≈ 10 scene units Y-extent) — noticeably taller than before the fix.
2. Change `H` from `100` → `20` → cavity boxes become visibly thinner vertically. Sprue, runners, gates, junction spheres, parting grid do NOT change.
3. Change `H` from `20` → `200` → cavity boxes become visibly taller. Other meshes still unchanged.
4. Change `W` and `D` independently — both still respond as before (regression check).
5. Switch layouts (H-Bridge → Radial/Star → Fishbone Sym → Inline → T-Runner) with `H=200` — H value is honored across every layout.

If any step fails, stop and debug before committing.

---

- [ ] **Step 7: Commit**

```bash
git add apps/web/src/components/Viewer3D/buildScene.ts apps/web/src/components/Viewer3D/Viewer3D.tsx
git commit -m "$(cat <<'EOF'
fix(viewer3d): wire Part-H input into cavity box geometry

The H value of Part W×D×H (mm) was written to the store but never
consumed by the 3D pipeline: Viewer3D subscribed only to w/d, and
buildScene hardcoded cavH = 4 (40 mm). Add partHeightMm to
BuildSceneOptions, derive cavH from it, and subscribe to dimsMm.h in
Viewer3D. W/D behavior unchanged.

Spec: docs/superpowers/specs/2026-04-20-cavity-height-input-wiring-design.md
EOF
)"
```

Expected: one commit created, working tree clean (`git status` returns nothing staged or modified).

---

## Self-Review Result

**Spec coverage:**
- "Extend `BuildSceneOptions`" → Step 1 ✓
- "Replace hardcoded `cavH`" → Step 2 ✓
- "Add `partH` subscription" → Step 3 ✓
- "Pass `partHeightMm` + update deps" → Step 4 ✓
- Acceptance criterion 4 (`pnpm typecheck` passes) → Step 5 ✓
- Spec's manual test plan (items 1–6) → Step 6 ✓
- Commit discipline → Step 7 ✓
- Non-goals preserved: no other files modified (file list explicitly restricts scope) ✓

**Placeholder scan:** No TBD / TODO / "add appropriate …" / "similar to Task N". Every code step has complete code.

**Type consistency:** `partHeightMm: number` used identically in interface (Step 1) and call site (Step 4). `partH` (store subscription) / `dimsMm.h` (store path) / `partHeightMm` (option name) are the three distinct names consistently applied in their three layers. `cavH` retained as the local scene-unit variable name — matches the existing idiom (`cavWUnits`, `cavDUnits`) uses `Units` suffix but `cavH` is what the existing code had at the use site, so keeping it preserves the minimal-diff intent.

No issues to fix.

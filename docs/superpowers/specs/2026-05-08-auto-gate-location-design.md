# Auto Gate-Location Suggestion — Design Spec

**Date:** 2026-05-08
**Scope:** Add an "Auto-suggest gate" button to the gate-picker modal that analyses the imported part's mesh and writes the optimal gate location to the workspace's `gatePoint` state. Silent auto-pick — no comparison UI, no heatmap render in v1. Manual click-to-pick stays available as override.
**Explicit non-goals:** No multi-gate-per-part output (the codebase only supports a single gate point per part replicated to every cavity). No K-means clustering. No heatmap UI overlay. No prohibited-region picker UI (the parameter is wired into the algorithm for future use; v1 always passes an empty array). No new field on the material schema — L/t limits are derived from the existing `viscosity` class.

## Problem

The gate-picker modal lets the user click anywhere on the part to set the gate point. That's good for users who know where they want the gate, but offers no guidance for non-experts. Standard injection-moulding practice has a well-defined set of physical criteria — gate into the thickest section, minimise flow length to extremities, keep `L/t < material limit`, etc. Encoding those rules into a one-click button gives the user a sensible default and a starting point for refinement.

## High-level approach

A pure analysis function (`analyzer.ts`) runs in a Web Worker (`worker.ts`). The function takes the mesh + material + options, and returns a single best gate point in part-local mm. The button in the modal sidebar invokes the worker via the main-thread API (`index.ts`), shows a "Analysing…" spinner during the (1–3 s) computation, and writes the result with `setGatePoint`. The existing render path picks up the gate change automatically.

## Module layout

```
apps/web/src/lib/autoGate/
├── messages.ts       # AnalyzeRequest / AnalyzeResponse / AnalyzeProgress types
├── worker.ts         # Web Worker entry — owns BVH + Dijkstra + scoring
├── analyzer.ts       # Pure analyzeGate(positions, indices, opts) function
├── adjacency.ts      # Build vertex-adjacency graph from triangle indices
├── dijkstra.ts       # Single-source shortest path on vertex graph
├── candidates.ts     # Poisson-disk sampling on the surface
├── thickness.ts      # Per-candidate inward-raycast thickness (one BVH call per candidate)
├── score.ts          # Suitability scoring formula + weights
├── index.ts          # Main-thread API: analyzeGate(part, material, opts) → Promise<Suggestion>
└── __tests__/        # Unit tests for adjacency, dijkstra, candidates, score
```

Each file has one responsibility. Helpers are pure functions taking primitive args, easy to unit test without spinning up a worker.

## Boundary with existing code

- *Reads* `importedPart.positions`, `importedPart.indices`, `importedPart.geometry.bbox` from the workspace store. No change to `lib/occt/`.
- *Reads* the active material's `viscosity` class (low / medium / high) to derive the L/t limit. No change to `MaterialEntry`.
- *Writes* `setGatePoint([x, y, z])` once on success. Same store action manual click-pick uses, so all downstream calc / rendering updates happen automatically.
- *Adds* one button to `GatePickerModal.tsx` sidebar inside the existing "Quick gate placement" section. Local component state (`isAnalyzing: boolean`, `error: string | null`) — no new workspace state.

Worker bundle imports `three` and `three-mesh-bvh` (both already deps); ~250 KB minified.

## Algorithm

`analyzer.ts` runs the following pipeline:

**1. Build adjacency graph** (`adjacency.ts`). For each triangle (a, b, c), record edges (a-b, b-c, c-a) with weight = euclidean distance between the two vertex positions. Output: `Map<vertexId, Array<{ neighbor, weight }>>`. Single pass over indices; O(numTriangles).

**2. Sample candidate vertices** (`candidates.ts`). Poisson-disk-style greedy sampling on the vertex set:
- Spacing target: `bbox_diag × 0.05` (≈ 5 % of part diagonal — yields ~80–150 candidates for typical parts).
- Iterate vertices in shuffled order; accept a vertex if it's farther than spacing from every already-accepted candidate.
- Filter step: drop candidates inside any `prohibitedRegions` AABB. v1 passes empty array.

**3. Per-candidate thickness** (`thickness.ts`). For each candidate vertex, get its outward normal (averaged from incident triangles, already done by `geo.computeVertexNormals()`). Cast a ray inward through the BVH; first hit distance = local wall thickness. ~100 raycasts at O(log N) each.

**4. Per-candidate flow analysis** (`dijkstra.ts`). For each candidate, single-source Dijkstra on the adjacency graph (edge weight = euclidean length). Returns `Float32Array` of distances to every vertex. Per candidate: extract `L_max`, `L_stddev`, `L/t = L_max / thickness_local`. Cost: O((V + E) log V) per candidate; ~1–2 s total in the worker for 5 k vertices × 100 candidates.

**5. Score each candidate** (`score.ts`).

```
thickness_norm  = (thickness − t_min) / (t_max − t_min)         ∈ [0, 1]
L_max_norm      = (L_max     − Lm_min) / (Lm_max − Lm_min)
L_stddev_norm   = (L_stddev  − Ls_min) / (Ls_max − Ls_min)
lt_excess       = max(0, L/t − lt_limit) / lt_limit             ∈ [0, ∞)

score = 0.50 · thickness_norm
      + 0.30 · (1 − L_max_norm)
      + 0.20 · (1 − L_stddev_norm)
      − 1.00 · lt_excess
```

Weights match the spec ranking — thickness dominates ("thick-to-thin principle"), centrality next, then balance. The L/t penalty is uncapped on the negative side: any candidate that exceeds the material's L/t limit gets crushed even if it scores well on the positive criteria.

`lt_limit` from material viscosity class: `low → 280`, `medium → 220`, `high → 170`.

**6. Select best.** Sort by score; pick top-1. Return:

```ts
interface Suggestion {
  position: [number, number, number];   // part-local mm, AABB-centred frame
  normal:   [number, number, number];
  score: number;
  maxLtRatio: number;
  candidatesEvaluated: number;
}
```

## Worker message protocol

`messages.ts`:

```ts
export interface AnalyzeRequest {
  type: 'analyze';
  positions: Float32Array;       // transferable
  indices: Uint32Array;          // transferable
  bbox: { min: [number, number, number]; max: [number, number, number] };
  ltLimit: number;               // derived from material viscosity by main thread
  prohibitedRegions: AABB[];     // empty in v1
}

export interface AnalyzeProgress { type: 'progress'; pct: number; }
export interface AnalyzeSuccess  { type: 'success'; suggestion: Suggestion; }
export interface AnalyzeError    { type: 'error'; code: string; message: string; }
```

Worker posts `progress` events at a coarse cadence (every 10 candidates evaluated) so the button text can show "Analysing… 47 %" — keeps the user oriented during the longer waits without a visible freeze.

## UI integration

In `GatePickerModal.tsx` sidebar, inside the existing "Quick gate placement" section, add one button before the face-centre row:

```jsx
<button onClick={onAutoSuggest} disabled={isAnalyzing} title="Analyse part geometry and pick the optimal gate">
  {isAnalyzing ? `Analysing… ${progressPct}%` : 'Auto-suggest gate'}
</button>
{error && <div className="...text-warn">{error}</div>}
```

`onAutoSuggest`:

```ts
const onAutoSuggest = async () => {
  if (!importedPart) return;
  setIsAnalyzing(true);
  setError(null);
  try {
    const result = await analyzeGate(
      { positions: importedPart.positions, indices: importedPart.indices, bbox: importedPart.geometry.bbox },
      { ltLimit: ltLimitForMaterial(material) },
      { onProgress: setProgressPct },
    );
    setGatePoint(result.position);
    if (result.maxLtRatio > LT_LIMIT) {
      setError(`L/t = ${result.maxLtRatio.toFixed(0)} exceeds ${LT_LIMIT} for ${material.family}. Single gate may short-shot.`);
    }
  } catch (e) {
    setError(e.message);
  } finally {
    setIsAnalyzing(false);
  }
};
```

Modal stays open after auto-pick — user sees the gate marker land on the surface and can rotate / verify before closing.

## Error handling

- **No imported part** → button is disabled (greyed out).
- **Empty candidate set** (prohibited regions excluded everything, or mesh too small) → worker returns `error: 'no_candidates'`. Sidebar shows "No suitable gate location found."
- **All candidates exceed L/t limit** → still pick best; warn "Single gate may short-shot — consider multi-gate."
- **Disconnected mesh** → Dijkstra ignores unreachable vertices in `L_max`; flag if > 10 % unreachable.
- **Degenerate mesh** (< 100 vertices or < 50 triangles) → fall back to AABB-top-centre with a warning.
- **Worker crash** (rare — OOM on huge meshes) → main-thread API rejects with `error.message`; button shows the error.

## Testing strategy

Per-helper unit tests in `apps/web/src/lib/autoGate/__tests__/`:

- `adjacency.test.ts` — known small mesh (cube of 8 vertices, 12 triangles); verify edge count and weights.
- `dijkstra.test.ts` — same cube; verify shortest-path distances against hand-computed values.
- `candidates.test.ts` — synthetic point cloud; verify Poisson-disk constraints (no two accepted points closer than spacing).
- `score.test.ts` — table-driven: given `(thickness, L_max, L_stddev, ltRatio)`, verify score matches the formula. Verify the L/t penalty correctly crushes candidates over the limit.

Integration test harness on a real part (`packages/core/test/autoGate.test.ts` or similar) is a follow-up — manually verify on the user's TVH-IM002 part during dev.

## Future work

- **Heatmap render**: same algorithm output (per-candidate scores), painted onto the cavity mesh by interpolating across vertices.
- **Top-N picker UI**: list the top 3–5 candidates with rationale; let the user click one.
- **Prohibited-region picker**: paint-style selection in the modal; results write a list of AABBs to the analyzer.
- **K-means multi-gate**: when the codebase grows multi-gate-per-part support, add the K-means distribution step.
- **Heat-method geodesic**: drop-in replacement for Dijkstra if geodesic accuracy becomes an issue on parts with hollow cores.

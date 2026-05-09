# Demoulding Direction — Phase 1 (Manual + Draft Heatmap)

**Date:** 2026-05-08
**Scope:** Let the user pick the part's demoulding (mould-pull) direction by clicking a face on the imported part. From that direction, compute per-vertex draft angles and render a green / yellow / red heatmap on the cavity mesh. Surface the total undercut surface percentage in the sidebar.
**Explicit non-goals (Phase 2/3):** No automatic VMap-based suggestion. No parting-line generation. No side-action / runner-collision detection. The Phase 1 output is just a visual + a number; downstream features can act on the same `demouldingDir` field once it exists.

## Problem

Demoulding direction is the geometric reference everyone in injection moulding takes for granted but the tool currently has no concept of. Without it, the user can't see whether the part has undercuts (negative draft) — and undercuts decide whether the runner layout needs side-actions / lifters, which decides whether the runner can land where the auto-gate or manual-pick says it can.

The first useful slice is the simplest possible one: let the user point at a face that should be on the moving-half side, draw the rest of the part coloured by draft, surface the undercut percentage. That's enough to decide whether the layout is safe before committing the gate.

## Data model

`apps/web/src/state/store.ts` adds two fields to `WorkspaceState`:

```ts
/** Unit vector in part-local frame; +Y is toward the moving half. Null = unset. */
demouldingDir: [number, number, number] | null;

/** True while the user is clicking-to-pick the demoulding face. */
demouldingPickActive: boolean;
```

Plus setters `setDemouldingDir` and `setDemouldingPickActive`. Stored in part-local frame so it follows part rotation the same way `gatePoint` does.

## Module: `lib/draft/`

```
apps/web/src/lib/draft/
├── compute.ts     # draftAnglesFromMesh(positions, normals, dir) -> Float32Array
├── classify.ts    # categoryFromAngle(α) -> 'positive' | 'marginal' | 'undercut'
├── colors.ts      # vertexColorsForDraft(angles) -> Float32Array (length = positions)
└── stats.ts       # undercutAreaPct(positions, indices, angles)
```

- `compute.ts` — for each vertex normal `n`, draft `α = 90° − arccos(n · d)`. Output array is parallel to the position buffer (one angle per vertex, in degrees).
- `classify.ts` — thresholds: `α ≥ 2° → positive`, `0 ≤ α < 2° → marginal`, `α < 0 → undercut`. Thresholds documented at top of file.
- `colors.ts` — green `#22c55e`, yellow `#eab308`, red `#ef4444` per category. Returns an `r,g,b,r,g,b,…` Float32Array sized for a Three.js color attribute.
- `stats.ts` — sums triangle area per category; returns `{ undercutMm2, totalMm2, undercutPct }`. Triangle category = the average of its three vertices' angles.

Each module is a pure function so unit tests don't need any DOM or WebGL.

## UI (gate-picker modal sidebar)

A new `<section>` titled "Demoulding direction", placed above "Gate type":

```
Demoulding direction
[ Pick demoulding direction ]   (button)
Picked at part-local (0.0, 1.0, 0.0)         ← only when set
Undercut area: 4.2 % of part surface         ← stat line
[ Clear ]                                    ← only when set
```

Click "Pick demoulding direction" → button highlights, cursor changes to crosshair. Next click on the part raycasts the picker's existing `partMesh` and reads the hit triangle's face normal (averaged from `BufferGeometry.normal` for the three vertices of the hit face). Vector is normalised and stored. Mode auto-exits.

`Clear` resets `demouldingDir` to `null` → heatmap removed.

## Visual feedback

When `demouldingDir` is set:

1. **Picker modal preview** — switch the part mesh's material from `PART_MAT` (slate phong) to a dedicated `DRAFT_MAT` (white phong with `vertexColors: true`) and apply the per-vertex colour buffer. When `demouldingDir` is null, switch back.
2. **Multi-cavity scene** — same switch on every cavity instance. All cavities share the same demoulding direction (one direction per part, as with `gatePoint`), so the colour buffer is computed once and reused across instances.

Vertex colours are stored as a new attribute on the BufferGeometry: `geo.setAttribute('color', new BufferAttribute(colors, 3))`. The DRAFT_MAT has `color = white` so the vertex colour shows through directly (no multiply tinting).

## Error handling

- No imported part → "Pick demoulding direction" button disabled.
- Click hits nothing (e.g. user clicks empty space) → no change, mode stays active until they hit a face.
- Vector very close to a previous one (no change) → no-op.
- Degenerate face (zero-area triangle, normal NaN) → silently skip and ignore.

## Testing

`apps/web/src/lib/draft/__tests__/`:
- `compute.test.ts` — unit cube; demoulding direction = +Y; verify top face triangles have α ≈ 90°, side faces α ≈ 0°, bottom face α ≈ −90°.
- `classify.test.ts` — table-driven thresholds.
- `stats.test.ts` — synthetic mesh with known undercut area; verify the percentage matches.

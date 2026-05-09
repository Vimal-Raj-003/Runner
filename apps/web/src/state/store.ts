'use client';

import { create } from 'zustand';
import type { LayoutId, RunnerProfile } from '@runner/core';
import { findMaterial, MATERIAL_SEED } from '@runner/core';
import type { ImportedPart } from '@/lib/occt';

/**
 * Five heat-map modes from the balancing-analyser spec:
 *   fill     — cavity + edge colour reflects per-cavity fill-time deviation
 *   flow     — edge colour reflects volumetric flow Q (mm³/s)
 *   pressure — edge colour reflects per-edge pressure drop ΔP (MPa)
 *   dia      — edge colour reflects current Ø vs recommended Ø
 *   balance  — every cavity green when σ < 2 %, red otherwise
 *   off      — default lighting, no heat-map
 */
export type HeatmapMode = 'off' | 'fill' | 'flow' | 'pressure' | 'dia' | 'balance';

/**
 * Multi-objective balancer mode. Picks the λ in `loss = σ_fill + λ·σ_vol`:
 *   fill   — λ = 0   (legacy: minimise fill σ only, drops absorb the asymmetry)
 *   both   — λ = 1   (default: balance fill AND runner volume across cavities)
 *   volume — λ = 3   (aggressively flatten runner volume; fill σ may rise to ~1-2 %)
 */
export type BalanceMode = 'fill' | 'both' | 'volume';

/**
 * Gate-type flavour. Determines the geometry rendered at the runner-to-
 * part junction:
 *   direct    — tapered sprue gate, one big orifice (single-cav moulds)
 *   edge      — rectangular gate at the part edge (most common)
 *   pin       — small circular pin gate (3-plate / hot-runner)
 *   submarine — angled tunnel gate that auto-degates on ejection
 *   fan       — widening rectangular gate for thin parts / low stress
 */
export type GateType = 'direct' | 'edge' | 'pin' | 'submarine' | 'fan';

export const BALANCE_MODE_LAMBDA: Record<BalanceMode, number> = {
  fill: 0,
  both: 1,
  volume: 3,
};

export interface PendingBalance {
  diaByLevel: Record<string, number>;
  lenByLevel: Record<string, number>;
  /** Per-edge Ø overrides — populated when solver used edge-mode tuning. */
  diaByEdge: Record<number, number>;
  /** True when the solver fell back to per-edge tuning (asymmetric layouts). */
  usedEdgeTuning: boolean;
  fillTimesS: Record<number, number>;
  meanFillTimeS: number;
  finalSigma: number;
  iterations: number;
  converged: boolean;
  hitFloorClamp: boolean;
}

export interface MeltOverrides {
  /** Pa·s — overrides apparentViscosity if > 0. */
  viscosityPaS: number;
  /** MPa — informational, used for press-util overlay. */
  pressureMPa: number;
  /** °C — overrides material's mean melt temp if > 0. */
  meltTempC: number;
  /** cm³ — overrides part.volumeMm3 if > 0 (uniform across all cavities). */
  cavityVolumeCm3: number;
}

export interface PartState {
  weightG: number;
  volumeMm3: number;
  wallThicknessMm: number;
  projectedAreaMm2: number;
  dimsMm: { w: number; d: number; h: number };
}

export interface MachineState {
  nozzleDiaMm: number;
  injectionPressureBar: number;
  clampForceTonne: number;
  sprueLengthMm: number;
}

export interface ViewState {
  showDims: boolean;
  engPanelOpen: boolean;
  modifyMode: boolean;
  runnerDimsPanelOpen: boolean;
}

export interface WorkspaceState {
  cavities: number;
  gatesPerCavity: 1 | 2;
  layoutId: LayoutId;
  profile: RunnerProfile;
  hotRunner: boolean;
  materialId: string;
  part: PartState;
  machine: MachineState;
  view: ViewState;
  diaOverrides: Record<string, number>;
  lenOverrides: Record<string, number>;
  /** Per-edge diameter overrides keyed by edge.id. Take precedence over diaOverrides. */
  diaEdgeOverrides: Record<number, number>;
  /** Per-edge length overrides keyed by edge.id. Take precedence over lenOverrides. */
  lenEdgeOverrides: Record<number, number>;
  highlightedLevelKey: string | null;
  focusedLevelKey: string | null;
  /** Levels the auto-balance optimiser must NOT touch (their Ø + L are pinned). */
  lockedLevels: string[];
  /** Which physical quantity drives the cavity / edge heat-map colours. */
  heatmapMode: HeatmapMode;
  /** Pending suggestions from the analyser, awaiting Apply / Reset. */
  pendingBalance: PendingBalance | null;
  /** Editable melt-property overrides for the balancing analyser. */
  meltOverrides: MeltOverrides;
  /** Solver objective: minimise fill only / both / runner volume. */
  balanceMode: BalanceMode;
  /** User-tunable width of the Runner Dimensions side panel (px). */
  runnerPanelWidthPx: number;
  /**
   * Edge ids that the panel asked the 3D viewer to spotlight (typically a
   * section's edges on hover). Empty = no per-edge spotlight.
   */
  highlightedEdgeIds: number[];
  /**
   * User-uploaded part geometry parsed from a STEP file. When non-null,
   * the 3D viewer renders this mesh per cavity instead of the placeholder
   * box, and `useCalc` lets the derived dims/volume/area flow into the
   * calc input where the user hasn't manually overridden them.
   */
  importedPart: ImportedPart | null;
  /**
   * User-picked gate location, in part-local mm (origin at AABB centre on
   * X/Z, AABB top on Y so y ≤ 0). Replicated to every cavity. Null = use
   * the default top-centre-of-AABB gate target.
   */
  gatePoint: [number, number, number] | null;
  /** True while the user is in pick-gate mode (click on part to set). */
  gatePickerActive: boolean;
  /**
   * Demoulding (mould-pull) direction in part-local frame, unit vector.
   * Null = unset. Drives the draft-angle heatmap on the cavity mesh and,
   * later, parting-line generation + side-action collision detection.
   */
  demouldingDir: [number, number, number] | null;
  /** True while the user is clicking-to-pick the demoulding face. */
  demouldingPickActive: boolean;
  /**
   * Whether to render a vertical gate drop between the runner plane and
   * the cavity. When false the gate point lands directly on the runner
   * plane and the part is positioned so its gate sits there — useful when
   * the part is laid horizontally and the runner enters from the side.
   * Drop length collapses to 0 mm; pressure-drop / fill calcs include no
   * vertical drop contribution.
   */
  useGateDrop: boolean;
  /**
   * Per-axis rotation applied to every cavity instance, around the gate
   * point (so the gate stays anchored to the runner network even as the
   * part swings). Stored in degrees (0/90/180/270 in v1; finer resolution
   * is allowed but the UI exposes 90° buttons). 0/0/0 = original STEP
   * orientation.
   */
  partRotation: { x: number; y: number; z: number };
  /**
   * When true, parts on the negative-X side of the sprue get an extra
   * 180° Y rotation (around the gate point) so their "gate side" faces
   * inward toward the runner. Most layouts (H-Bridge, Cross Main, etc.)
   * benefit from this — without it, parts on the left side of a layout
   * end up oriented opposite to those on the right and look wrong.
   */
  autoMirrorParts: boolean;
  /**
   * Minimum mm of clearance enforced between adjacent cavity centres.
   * If the layout's natural spacing is less than `max(partW, partD) +
   * partOverlapMarginMm`, the pipeline scales every node position up
   * uniformly so parts don't physically overlap each other or the
   * runner network. 0 = no auto-scaling.
   */
  partOverlapMarginMm: number;
  /**
   * Per-cavity rotation overrides (in degrees), keyed by cavity.id.
   * Applied on TOP of the auto-mirror rotation so the user can manually
   * flip individual cavities when the auto-mirror result doesn't match
   * their layout intent. Visual-only — pivot is the gate so the runner
   * network doesn't move.
   */
  cavityRotationOverrides: Record<number, { x: number; y: number }>;
  /** Gate-type flavour shown at the runner-to-part junction. */
  gateType: GateType;

  setCavities: (n: number) => void;
  setGatesPerCavity: (g: 1 | 2) => void;
  setLayoutId: (id: LayoutId) => void;
  setProfile: (p: RunnerProfile) => void;
  setHotRunner: (b: boolean) => void;
  setMaterialId: (id: string) => void;
  setPart: (p: Partial<PartState>) => void;
  setMachine: (m: Partial<MachineState>) => void;
  setView: (v: Partial<ViewState>) => void;
  setDiaOverride: (levelKey: string, mm: number) => void;
  setLenOverride: (levelKey: string, mm: number) => void;
  setHighlightedLevelKey: (key: string | null) => void;
  setFocusedLevelKey: (key: string | null) => void;
  toggleLockedLevel: (key: string) => void;
  setHeatmapMode: (mode: HeatmapMode) => void;
  setPendingBalance: (p: PendingBalance | null) => void;
  setMeltOverrides: (m: Partial<MeltOverrides>) => void;
  setDiaEdgeOverrides: (m: Record<number, number>) => void;
  setLenEdgeOverrides: (m: Record<number, number>) => void;
  setDiaEdgeOverride: (edgeId: number, mm: number) => void;
  setLenEdgeOverride: (edgeId: number, mm: number) => void;
  clearEdgeOverrides: () => void;
  setRunnerPanelWidth: (px: number) => void;
  setHighlightedEdgeIds: (ids: number[]) => void;
  setBalanceMode: (m: BalanceMode) => void;
  setImportedPart: (p: ImportedPart | null) => void;
  setGatePoint: (p: [number, number, number] | null) => void;
  setGatePickerActive: (b: boolean) => void;
  setDemouldingDir: (d: [number, number, number] | null) => void;
  setDemouldingPickActive: (b: boolean) => void;
  setUseGateDrop: (b: boolean) => void;
  setPartRotation: (r: { x: number; y: number; z: number }) => void;
  rotatePart: (axis: 'x' | 'y' | 'z', deltaDeg: number) => void;
  setAutoMirrorParts: (b: boolean) => void;
  setPartOverlapMarginMm: (mm: number) => void;
  flipCavityRotation: (cavityId: number, axis: 'x' | 'y') => void;
  resetCavityRotation: (cavityId: number) => void;
  clearCavityRotations: () => void;
  setGateType: (g: GateType) => void;
  clearOverrides: () => void;
  clearLenOverrides: () => void;
  reset: () => void;
}

const DEFAULT_MATERIAL = MATERIAL_SEED.find((m) => m.id === 'pp-homo')!;

const initial: Omit<
  WorkspaceState,
  | 'setCavities' | 'setGatesPerCavity' | 'setLayoutId' | 'setProfile'
  | 'setHotRunner' | 'setMaterialId' | 'setPart' | 'setMachine' | 'setView'
  | 'setDiaOverride' | 'setLenOverride'
  | 'setHighlightedLevelKey' | 'setFocusedLevelKey'
  | 'toggleLockedLevel' | 'setHeatmapMode'
  | 'setPendingBalance' | 'setMeltOverrides'
  | 'setDiaEdgeOverrides' | 'setLenEdgeOverrides'
  | 'setDiaEdgeOverride' | 'setLenEdgeOverride'
  | 'clearEdgeOverrides' | 'setRunnerPanelWidth' | 'setHighlightedEdgeIds'
  | 'setBalanceMode' | 'setImportedPart'
  | 'setGatePoint' | 'setGatePickerActive'
  | 'setDemouldingDir' | 'setDemouldingPickActive'
  | 'setUseGateDrop' | 'setPartRotation' | 'rotatePart'
  | 'setAutoMirrorParts' | 'setPartOverlapMarginMm'
  | 'flipCavityRotation' | 'resetCavityRotation' | 'clearCavityRotations'
  | 'setGateType'
  | 'clearOverrides' | 'clearLenOverrides' | 'reset'
> = {
  cavities: 8,
  gatesPerCavity: 1,
  layoutId: 'h_bridge',
  profile: 'round',
  hotRunner: false,
  materialId: DEFAULT_MATERIAL.id,
  part: {
    weightG: 50,
    volumeMm3: 55000,
    wallThicknessMm: 2,
    projectedAreaMm2: 2500,
    dimsMm: { w: 50, d: 50, h: 50 },
  },
  machine: {
    nozzleDiaMm: 4,
    injectionPressureBar: 1500,
    clampForceTonne: 200,
    sprueLengthMm: 80,
  },
  view: {
    showDims: false,
    engPanelOpen: true,
    modifyMode: false,
    runnerDimsPanelOpen: false,
  },
  diaOverrides: {},
  lenOverrides: {},
  diaEdgeOverrides: {},
  lenEdgeOverrides: {},
  highlightedLevelKey: null,
  focusedLevelKey: null,
  lockedLevels: [],
  heatmapMode: 'off',
  pendingBalance: null,
  meltOverrides: {
    viscosityPaS: 0,
    pressureMPa: 80,
    meltTempC: 0,
    cavityVolumeCm3: 0,
  },
  runnerPanelWidthPx: 380,
  highlightedEdgeIds: [],
  balanceMode: 'both',
  importedPart: null,
  gatePoint: null,
  gatePickerActive: false,
  demouldingDir: null,
  demouldingPickActive: false,
  useGateDrop: true,
  partRotation: { x: 0, y: 0, z: 0 },
  autoMirrorParts: true,
  partOverlapMarginMm: 20,
  cavityRotationOverrides: {},
  gateType: 'edge',
};

/** Bounds the panel can be resized between. */
export const RUNNER_PANEL_MIN_PX = 320;
export const RUNNER_PANEL_MAX_PX = 720;

export const useWorkspace = create<WorkspaceState>((set) => ({
  ...initial,
  setCavities: (n) => set({ cavities: n }),
  setGatesPerCavity: (g) => set({ gatesPerCavity: g }),
  setLayoutId: (id) => set({ layoutId: id }),
  setProfile: (p) => set({ profile: p }),
  setHotRunner: (b) => set({ hotRunner: b }),
  setMaterialId: (id) => set({ materialId: id }),
  setPart: (p) => set((s) => ({ part: { ...s.part, ...p } })),
  setMachine: (m) => set((s) => ({ machine: { ...s.machine, ...m } })),
  setView: (v) => set((s) => ({ view: { ...s.view, ...v } })),
  setDiaOverride: (levelKey, mm) =>
    set((s) => ({ diaOverrides: { ...s.diaOverrides, [levelKey]: mm } })),
  setLenOverride: (levelKey, mm) =>
    set((s) => ({ lenOverrides: { ...s.lenOverrides, [levelKey]: mm } })),
  setHighlightedLevelKey: (key) => set({ highlightedLevelKey: key }),
  setFocusedLevelKey: (key) => set({ focusedLevelKey: key }),
  toggleLockedLevel: (key) =>
    set((s) => ({
      lockedLevels: s.lockedLevels.includes(key)
        ? s.lockedLevels.filter((k) => k !== key)
        : [...s.lockedLevels, key],
    })),
  setHeatmapMode: (mode) => set({ heatmapMode: mode }),
  setPendingBalance: (p) => set({ pendingBalance: p }),
  setMeltOverrides: (m) => set((s) => ({ meltOverrides: { ...s.meltOverrides, ...m } })),
  setDiaEdgeOverrides: (m) => set({ diaEdgeOverrides: m }),
  setLenEdgeOverrides: (m) => set({ lenEdgeOverrides: m }),
  setDiaEdgeOverride: (edgeId, mm) =>
    set((s) => ({ diaEdgeOverrides: { ...s.diaEdgeOverrides, [edgeId]: mm } })),
  setLenEdgeOverride: (edgeId, mm) =>
    set((s) => ({ lenEdgeOverrides: { ...s.lenEdgeOverrides, [edgeId]: mm } })),
  clearEdgeOverrides: () => set({ diaEdgeOverrides: {}, lenEdgeOverrides: {} }),
  setRunnerPanelWidth: (px) =>
    set({
      runnerPanelWidthPx: Math.max(
        RUNNER_PANEL_MIN_PX,
        Math.min(RUNNER_PANEL_MAX_PX, Math.round(px)),
      ),
    }),
  setHighlightedEdgeIds: (ids) => set({ highlightedEdgeIds: ids }),
  setBalanceMode: (m) => set({ balanceMode: m }),
  setGatePoint: (p) => set({ gatePoint: p }),
  setGatePickerActive: (b) => set({ gatePickerActive: b }),
  setDemouldingDir: (d) => set({ demouldingDir: d }),
  setDemouldingPickActive: (b) => set({ demouldingPickActive: b }),
  setUseGateDrop: (b) => set({ useGateDrop: b }),
  setPartRotation: (r) => set({ partRotation: r }),
  rotatePart: (axis, deltaDeg) => set((s) => {
    // Keep angles in [0, 360) so the UI stays sane after many clicks.
    const next = { ...s.partRotation };
    next[axis] = ((next[axis] + deltaDeg) % 360 + 360) % 360;
    return { partRotation: next };
  }),
  setAutoMirrorParts: (b) => set({ autoMirrorParts: b }),
  setPartOverlapMarginMm: (mm) => set({ partOverlapMarginMm: Math.max(0, mm) }),
  flipCavityRotation: (cavityId, axis) => set((s) => {
    const current = s.cavityRotationOverrides[cavityId] ?? { x: 0, y: 0 };
    const next = { ...current, [axis]: (current[axis] + 180) % 360 };
    return {
      cavityRotationOverrides: {
        ...s.cavityRotationOverrides,
        [cavityId]: next,
      },
    };
  }),
  resetCavityRotation: (cavityId) => set((s) => {
    const next = { ...s.cavityRotationOverrides };
    delete next[cavityId];
    return { cavityRotationOverrides: next };
  }),
  clearCavityRotations: () => set({ cavityRotationOverrides: {} }),
  setGateType: (g) => set({ gateType: g }),
  setImportedPart: (p) => set((s) => {
    // Clearing the part also clears any picked gate (the part-local
    // coordinates are no longer meaningful without the part).
    if (!p) return {
      importedPart: null,
      gatePoint: null,
      gatePickerActive: false,
      demouldingDir: null,
      demouldingPickActive: false,
    };
    // Push the derived geometry into the visible Part inputs so the user
    // sees the imported dims/volume/area/wall in the Engineering Panel.
    // Weight uses *solid* density (the part is solid when ejected; melt
    // density is for the in-runner mass-flow calc). Wall thickness uses
    // the median of the BVH inward-raycast samples — robust to fillet/
    // edge outliers and gives the value engineers think of as "the"
    // thickness.
    const material = findMaterial(s.materialId) ?? DEFAULT_MATERIAL;
    const weightG = Math.round(p.geometry.volumeMm3 * material.rhoSolid * 1e-6 * 10) / 10;
    const wallMm = Math.round(p.geometry.wallThicknessMm.median * 100) / 100;
    return {
      importedPart: p,
      part: {
        ...s.part,
        dimsMm: { ...p.geometry.dimsMm },
        volumeMm3: Math.round(p.geometry.volumeMm3),
        projectedAreaMm2: Math.round(p.geometry.projectedAreaMm2),
        weightG,
        wallThicknessMm: wallMm > 0 ? wallMm : s.part.wallThicknessMm,
      },
    };
  }),
  clearOverrides: () => set({
    diaOverrides: {}, lenOverrides: {},
    diaEdgeOverrides: {}, lenEdgeOverrides: {},
  }),
  clearLenOverrides: () => set({ lenOverrides: {} }),
  reset: () => set({ ...initial }),
}));

export function selectMaterial(state: WorkspaceState) {
  return findMaterial(state.materialId) ?? DEFAULT_MATERIAL;
}

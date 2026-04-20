'use client';

import { create } from 'zustand';
import type { LayoutId, RunnerProfile } from '@runner/core';
import { findMaterial, MATERIAL_SEED } from '@runner/core';

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
  clearOverrides: () => void;
  reset: () => void;
}

const DEFAULT_MATERIAL = MATERIAL_SEED.find((m) => m.id === 'pp-homo')!;

const initial: Omit<
  WorkspaceState,
  | 'setCavities' | 'setGatesPerCavity' | 'setLayoutId' | 'setProfile'
  | 'setHotRunner' | 'setMaterialId' | 'setPart' | 'setMachine' | 'setView'
  | 'setDiaOverride' | 'setLenOverride' | 'clearOverrides' | 'reset'
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
};

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
  clearOverrides: () => set({ diaOverrides: {}, lenOverrides: {} }),
  reset: () => set({ ...initial }),
}));

export function selectMaterial(state: WorkspaceState) {
  return findMaterial(state.materialId) ?? DEFAULT_MATERIAL;
}

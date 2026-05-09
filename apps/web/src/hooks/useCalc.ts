'use client';

import { useMemo } from 'react';
import { runCalculations, findMaterial, MATERIAL_SEED, type CalcResult } from '@runner/core';
import { useWorkspace, BALANCE_MODE_LAMBDA } from '@/state/store';

export function useCalc(): CalcResult {
  const part = useWorkspace((s) => s.part);
  const cavities = useWorkspace((s) => s.cavities);
  const gatesPerCavity = useWorkspace((s) => s.gatesPerCavity);
  const layoutId = useWorkspace((s) => s.layoutId);
  const profile = useWorkspace((s) => s.profile);
  const hotRunner = useWorkspace((s) => s.hotRunner);
  const materialId = useWorkspace((s) => s.materialId);
  const machine = useWorkspace((s) => s.machine);
  const diaOverrides = useWorkspace((s) => s.diaOverrides);
  const lenOverrides = useWorkspace((s) => s.lenOverrides);
  const diaEdgeOverrides = useWorkspace((s) => s.diaEdgeOverrides);
  const lenEdgeOverrides = useWorkspace((s) => s.lenEdgeOverrides);
  const balanceMode = useWorkspace((s) => s.balanceMode);
  const gatePoint = useWorkspace((s) => s.gatePoint);
  const useGateDrop = useWorkspace((s) => s.useGateDrop);
  const partOverlapMarginMm = useWorkspace((s) => s.partOverlapMarginMm);
  const autoMirrorParts = useWorkspace((s) => s.autoMirrorParts);

  const material = findMaterial(materialId) ?? MATERIAL_SEED[0]!;
  const balanceVolumeWeight = BALANCE_MODE_LAMBDA[balanceMode];

  return useMemo(() => {
    return runCalculations({
      part,
      cavities,
      gatesPerCavity,
      layoutId,
      profile,
      hotRunner,
      material,
      machine,
      overrides: {
        diaByLevel: diaOverrides,
        lenByLevel: lenOverrides,
        diaByEdge: diaEdgeOverrides,
        lenByEdge: lenEdgeOverrides,
      },
      balanceVolumeWeight,
      gate: gatePoint ? { partLocalPoint: gatePoint } : undefined,
      useGateDrop,
      partOverlapMarginMm,
      autoMirrorGate: autoMirrorParts && !!gatePoint,
    });
  }, [
    part,
    cavities,
    gatesPerCavity,
    layoutId,
    profile,
    hotRunner,
    material,
    machine,
    diaOverrides,
    lenOverrides,
    diaEdgeOverrides,
    lenEdgeOverrides,
    balanceVolumeWeight,
    gatePoint,
    useGateDrop,
    partOverlapMarginMm,
    autoMirrorParts,
  ]);
}

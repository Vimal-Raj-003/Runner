'use client';

import { useMemo } from 'react';
import { runCalculations, findMaterial, MATERIAL_SEED, type CalcResult } from '@runner/core';
import { useWorkspace } from '@/state/store';

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

  const material = findMaterial(materialId) ?? MATERIAL_SEED[0]!;

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
      overrides: { diaByLevel: diaOverrides, lenByLevel: lenOverrides },
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
  ]);
}

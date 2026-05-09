'use client';

import { PRESETS } from '../Viewer3D/presets';
import type { Viewer3DHandle } from '../Viewer3D/Viewer3D';
import { ChipButton } from '../ui/Button';
import { useWorkspace } from '@/state/store';
import type { HeatmapMode } from '@/state/store';

interface Props {
  viewerHandle: Viewer3DHandle | null;
}

const HEATMAP_MODES: {
  id: Exclude<HeatmapMode, 'off'>;
  label: string;
  title: string;
}[] = [
  { id: 'fill',     label: 'Fill',  title: 'Heat-map cavities by per-cavity fill-time deviation.' },
  { id: 'flow',     label: 'Flow',  title: 'Colour edges by volumetric flow Q (mm³/s) — spot bottlenecks.' },
  { id: 'pressure', label: 'ΔP',    title: 'Colour edges by Hagen-Poiseuille pressure drop per segment.' },
  { id: 'dia',      label: 'Ø',     title: 'Colour edges by current Ø vs Pye-recommended Ø — undersized = red.' },
  { id: 'balance',  label: '⚖',     title: 'Status colour: green if σ < 2 %, red otherwise.' },
];

export function ViewBar({ viewerHandle }: Props) {
  const heatmapMode = useWorkspace((s) => s.heatmapMode);
  const setHeatmapMode = useWorkspace((s) => s.setHeatmapMode);
  return (
    <div className="flex flex-wrap items-center gap-1.5 px-3 py-1.5">
      <span className="text-[11px] font-semibold uppercase tracking-wide text-muted">
        View
      </span>
      <div className="flex flex-wrap items-center gap-1.5" role="group" aria-label="Camera preset">
        {Object.keys(PRESETS).map((name) => (
          <ChipButton
            key={name}
            compact
            aria-label={`Set camera to ${name}`}
            onClick={() => viewerHandle?.setView(name as keyof typeof PRESETS)}
          >
            {name}
          </ChipButton>
        ))}
        <ChipButton
          compact
          aria-label="Set spin centre — click a point in the scene to pivot rotations around it"
          title="Set spin centre — click a point in the scene to pivot rotations around it"
          onClick={() => viewerHandle?.setSpinPickActive(true)}
        >
          Spin ⊕
        </ChipButton>
      </div>
      <span className="ml-1 text-[10px] font-semibold uppercase tracking-wide text-muted">
        Heat
      </span>
      <div className="flex flex-wrap items-center gap-1" role="group" aria-label="Heat-map mode">
        {HEATMAP_MODES.map((m) => (
          <ChipButton
            key={m.id}
            compact
            tone={heatmapMode === m.id ? 'active' : 'neutral'}
            aria-pressed={heatmapMode === m.id}
            title={m.title}
            onClick={() => setHeatmapMode(heatmapMode === m.id ? 'off' : m.id)}
          >
            {m.label}
          </ChipButton>
        ))}
      </div>
    </div>
  );
}

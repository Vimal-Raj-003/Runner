'use client';

import { PRESETS } from '../Viewer3D/presets';
import type { Viewer3DHandle } from '../Viewer3D/Viewer3D';
import { ChipButton } from '../ui/Button';

interface Props {
  viewerHandle: Viewer3DHandle | null;
}

export function ViewBar({ viewerHandle }: Props) {
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
      </div>
    </div>
  );
}

'use client';

import { useWorkspace } from '@/state/store';
import type { Viewer3DHandle } from '../Viewer3D/Viewer3D';
import { ChipButton } from '../ui/Button';

interface Props {
  viewerHandle: Viewer3DHandle | null;
}

export function ActionBar({ viewerHandle }: Props) {
  const cavities            = useWorkspace((s) => s.cavities);
  const setCavities         = useWorkspace((s) => s.setCavities);
  const view                = useWorkspace((s) => s.view);
  const setView             = useWorkspace((s) => s.setView);
  const reset               = useWorkspace((s) => s.reset);
  const clearOverrides      = useWorkspace((s) => s.clearOverrides);

  return (
    <div className="flex flex-wrap items-center gap-1.5 px-3 py-1.5">
      <ChipButton
        compact
        aria-label="Increase cavity count"
        onClick={() => setCavities(Math.min(32, cavities + 1))}
      >
        +
      </ChipButton>
      <ChipButton
        compact
        aria-label="Decrease cavity count"
        onClick={() => setCavities(Math.max(2, cavities - 1))}
      >
        −
      </ChipButton>
      <ChipButton compact aria-label="Fit view to model" onClick={() => viewerHandle?.fit()}>
        Fit
      </ChipButton>
      <ChipButton
        compact
        tone={view.showDims ? 'active' : 'neutral'}
        aria-pressed={view.showDims}
        onClick={() => setView({ showDims: !view.showDims })}
      >
        Dims
      </ChipButton>
      <ChipButton
        compact
        tone="warn"
        onClick={() => {
          clearOverrides();
          reset();
          viewerHandle?.reset();
        }}
      >
        Reset
      </ChipButton>
      <ChipButton
        compact
        tone={view.runnerDimsPanelOpen ? 'active' : 'neutral'}
        aria-pressed={view.runnerDimsPanelOpen}
        onClick={() => setView({ runnerDimsPanelOpen: !view.runnerDimsPanelOpen })}
      >
        Runner Dims
      </ChipButton>
    </div>
  );
}

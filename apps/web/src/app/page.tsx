'use client';

import { useEffect, useRef, useState } from 'react';
import { SkipLink } from '@/components/SkipLink';
import { TopBar } from '@/components/bars/TopBar';
import { LayoutBar } from '@/components/bars/LayoutBar';
import { ViewBar } from '@/components/bars/ViewBar';
import { ActionBar } from '@/components/bars/ActionBar';
import { Viewer3D, type Viewer3DHandle } from '@/components/Viewer3D/Viewer3D';
import { EngineeringPanel } from '@/components/EngineeringPanel/EngineeringPanel';
import { RunnerDimensionsPanel } from '@/components/RunnerDimensionsPanel/RunnerDimensionsPanel';
import { GatePickerModal } from '@/components/GatePicker/GatePickerModal';
import { useWorkspace } from '@/state/store';
import { useCalc } from '@/hooks/useCalc';

export default function WorkspacePage() {
  const [viewerHandle, setViewerHandle] = useState<Viewer3DHandle | null>(null);
  const engPanelOpen         = useWorkspace((s) => s.view.engPanelOpen);
  const runnerDimsPanelOpen  = useWorkspace((s) => s.view.runnerDimsPanelOpen);

  // Auto-clear overrides on structural change. The calc engine then
  // produces a balanced default for the new layout / cavity count / part.
  const layoutId        = useWorkspace((s) => s.layoutId);
  const cavities        = useWorkspace((s) => s.cavities);
  const gatesPerCavity  = useWorkspace((s) => s.gatesPerCavity);
  const partWidthMm     = useWorkspace((s) => s.part.dimsMm.w);
  const partDepthMm     = useWorkspace((s) => s.part.dimsMm.d);
  const partHeightMm    = useWorkspace((s) => s.part.dimsMm.h);
  const partVolumeMm3   = useWorkspace((s) => s.part.volumeMm3);
  const clearOverrides  = useWorkspace((s) => s.clearOverrides);

  const firstRunRef = useRef(true);
  useEffect(() => {
    // Skip the first render — overrides are already empty on initial mount,
    // and we don't want the auto-clear to reset any persisted user state
    // unnecessarily. Subsequent changes to any structural input wipe.
    if (firstRunRef.current) {
      firstRunRef.current = false;
      return;
    }
    clearOverrides();
  }, [
    layoutId, cavities, gatesPerCavity,
    partWidthMm, partDepthMm, partHeightMm, partVolumeMm3,
    clearOverrides,
  ]);

  const calc = useCalc();

  return (
    <div className="flex h-screen flex-col bg-bg text-fg">
      <SkipLink />
      <TopBar />
      <LayoutBar />
      <div className="flex flex-wrap items-center divide-x divide-border border-b border-border bg-surface">
        <ActionBar viewerHandle={viewerHandle} />
        <ViewBar  viewerHandle={viewerHandle} />
      </div>
      <div className="flex flex-1 overflow-hidden">
        <main
          id="viewer-3d"
          // min-w-0 lets the 3D viewer compress instead of pushing the
          // side panels off-screen when the runner panel is widened.
          className="relative min-w-0 flex-1 bg-[#E2E5EA]"
          aria-label="Mould layout 3D viewer"
          tabIndex={-1}
        >
          <Viewer3D calc={calc} onHandleReady={setViewerHandle} />
        </main>
        {runnerDimsPanelOpen && <RunnerDimensionsPanel calc={calc} engPanelOpen={engPanelOpen} />}
        {engPanelOpen        && <EngineeringPanel      calc={calc} />}
      </div>
      {/* Single-part gate-pick overlay. Renders only while
          gatePickerActive && importedPart is set. */}
      <GatePickerModal />
    </div>
  );
}

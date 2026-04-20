'use client';

import { useState } from 'react';
import { SkipLink } from '@/components/SkipLink';
import { TopBar } from '@/components/bars/TopBar';
import { LayoutBar } from '@/components/bars/LayoutBar';
import { ViewBar } from '@/components/bars/ViewBar';
import { ActionBar } from '@/components/bars/ActionBar';
import { Viewer3D, type Viewer3DHandle } from '@/components/Viewer3D/Viewer3D';
import { EngineeringPanel } from '@/components/EngineeringPanel/EngineeringPanel';
import { RunnerDimensionsPanel } from '@/components/RunnerDimensionsPanel/RunnerDimensionsPanel';
import { useWorkspace } from '@/state/store';
import { useCalc } from '@/hooks/useCalc';

export default function WorkspacePage() {
  const [viewerHandle, setViewerHandle] = useState<Viewer3DHandle | null>(null);
  const engPanelOpen         = useWorkspace((s) => s.view.engPanelOpen);
  const runnerDimsPanelOpen  = useWorkspace((s) => s.view.runnerDimsPanelOpen);
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
          className="relative flex-1 bg-[#E2E5EA]"
          aria-label="Mould layout 3D viewer"
          tabIndex={-1}
        >
          <Viewer3D calc={calc} onHandleReady={setViewerHandle} />
        </main>
        {runnerDimsPanelOpen && <RunnerDimensionsPanel calc={calc} />}
        {engPanelOpen        && <EngineeringPanel      calc={calc} />}
      </div>
    </div>
  );
}

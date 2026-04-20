'use client';

import { useWorkspace } from '@/state/store';
import { validLayouts } from '@runner/core';
import { ChipButton } from '../ui/Button';

const CAVITY_OPTIONS = [2, 3, 4, 5, 6, 8, 10, 12, 16, 20, 24, 32];

function Sep() {
  return <div className="mx-1 h-5 w-px bg-border" aria-hidden="true" />;
}

export function TopBar() {
  const cavities          = useWorkspace((s) => s.cavities);
  const gatesPerCavity    = useWorkspace((s) => s.gatesPerCavity);
  const hotRunner         = useWorkspace((s) => s.hotRunner);
  const engPanelOpen      = useWorkspace((s) => s.view.engPanelOpen);
  const setCavities       = useWorkspace((s) => s.setCavities);
  const setGatesPerCavity = useWorkspace((s) => s.setGatesPerCavity);
  const setHotRunner      = useWorkspace((s) => s.setHotRunner);
  const setView           = useWorkspace((s) => s.setView);
  const layoutId          = useWorkspace((s) => s.layoutId);
  const setLayoutId       = useWorkspace((s) => s.setLayoutId);

  const onSetCavities = (n: number) => {
    setCavities(n);
    const valids = validLayouts(n);
    if (!valids.find((l) => l.id === layoutId) && valids[0]) {
      setLayoutId(valids[0].id);
    }
  };

  return (
    <header className="flex flex-wrap items-center gap-1.5 border-b border-border bg-surface px-4 py-2">
      <h1 className="font-heading text-sm font-semibold tracking-tight text-fg">
        Runner System
      </h1>
      <Sep />
      <div
        className="flex items-center gap-1"
        role="group"
        aria-label="Cavity count"
      >
        {CAVITY_OPTIONS.map((n) => (
          <ChipButton
            key={n}
            compact
            tone={cavities === n ? 'active' : 'neutral'}
            aria-pressed={cavities === n}
            aria-label={`${n} cavities`}
            onClick={() => onSetCavities(n)}
            className="num min-w-[28px]"
          >
            {n}
          </ChipButton>
        ))}
      </div>
      <Sep />
      <span className="text-[11px] uppercase tracking-wide text-muted">Gates</span>
      <div className="flex items-center gap-1" role="group" aria-label="Gates per cavity">
        {([1, 2] as const).map((g) => (
          <ChipButton
            key={g}
            compact
            tone={gatesPerCavity === g ? 'active' : 'neutral'}
            aria-pressed={gatesPerCavity === g}
            onClick={() => setGatesPerCavity(g)}
            className="num min-w-[28px]"
          >
            {g}
          </ChipButton>
        ))}
      </div>
      <Sep />
      <ChipButton
        tone={hotRunner ? 'warn' : 'neutral'}
        aria-pressed={hotRunner}
        onClick={() => setHotRunner(!hotRunner)}
      >
        {hotRunner ? 'Hot Runner' : 'Cold Runner'}
      </ChipButton>
      <div className="ml-auto flex items-center gap-1.5">
        <ChipButton tone="active" aria-pressed disabled>
          3D
        </ChipButton>
        <ChipButton
          tone={engPanelOpen ? 'active' : 'neutral'}
          aria-pressed={engPanelOpen}
          onClick={() => setView({ engPanelOpen: !engPanelOpen })}
        >
          Eng Panel
        </ChipButton>
      </div>
    </header>
  );
}

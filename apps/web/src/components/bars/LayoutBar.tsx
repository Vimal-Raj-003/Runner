'use client';

import { useWorkspace } from '@/state/store';
import { LAYOUTS, validLayouts } from '@runner/core';
import { ChipButton } from '../ui/Button';

export function LayoutBar() {
  const cavities    = useWorkspace((s) => s.cavities);
  const layoutId    = useWorkspace((s) => s.layoutId);
  const setLayoutId = useWorkspace((s) => s.setLayoutId);
  const valids      = new Set(validLayouts(cavities).map((v) => v.id));

  return (
    <div className="flex flex-wrap items-center gap-1.5 border-b border-border bg-surface px-4 py-2">
      <span className="text-[11px] font-semibold uppercase tracking-wide text-accent">
        Layout
      </span>
      <div
        className="flex flex-wrap items-center gap-1.5"
        role="radiogroup"
        aria-label="Runner layout"
      >
        {Object.values(LAYOUTS).map((layout) => {
          const isValid = valids.has(layout.id);
          const active = layoutId === layout.id;
          return (
            <ChipButton
              key={layout.id}
              role="radio"
              aria-checked={active}
              title={isValid ? layout.description : `Not valid for ${cavities} cavities`}
              tone={active ? 'accent' : 'neutral'}
              disabled={!isValid}
              onClick={() => isValid && setLayoutId(layout.id)}
            >
              {layout.label}
            </ChipButton>
          );
        })}
      </div>
    </div>
  );
}

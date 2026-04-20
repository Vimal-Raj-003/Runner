'use client';

import { GATE_TYPES } from '@runner/core';
import { Chip } from './Row';

export function GateTypesReference() {
  return (
    <ul className="space-y-1.5">
      {GATE_TYPES.map((g) => (
        <li key={g.id} className="rounded-md border border-border/60 bg-bg/60 px-2.5 py-2">
          <div className="flex items-center justify-between gap-2">
            <span
              className={`font-heading text-[11px] font-semibold ${
                g.trim === 'Auto' ? 'text-orange-400' : 'text-blue-400'
              }`}
            >
              {g.label}
            </span>
            <Chip tone={g.trim === 'Auto' ? 'warn' : 'info'}>{g.trim}</Chip>
          </div>
          <p className="mt-1 text-[10.5px] leading-relaxed text-muted">{g.description}</p>
        </li>
      ))}
    </ul>
  );
}

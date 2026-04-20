'use client';

import { useId } from 'react';
import type { CalcResult } from '@runner/core';
import { useWorkspace } from '@/state/store';
import { PanelHeader } from '../ui/PanelHeader';
import { Collapsible } from '../ui/Collapsible';

/**
 * Runner Dimensions editor. Lists every runner level + sprue and lets the
 * user override Ø and from-centre length per level. Colour swatches match
 * the level colouring used in the 3D viewer so the two surfaces cross-read.
 *
 * Each section is collapsible; the whole panel can be closed via the
 * header × button (which clears the runnerDimsPanelOpen flag).
 */

const LEGEND_ROWS: { swatch: string; term: string; desc: string }[] = [
  { swatch: 'bg-red-500',    term: 'Sprue',     desc: 'Tapered, nozzle to runner plane' },
  { swatch: 'bg-pink-500',   term: 'Main',      desc: 'First from sprue (thickest)' },
  { swatch: 'bg-cyan-500',   term: 'Sub',       desc: 'Branches off main' },
  { swatch: 'bg-green-500',  term: 'Branch',    desc: 'To cavities (thinnest)' },
  { swatch: 'bg-amber-500',  term: 'Gate Drop', desc: 'Vertical to cavity' },
];

const depthPalette = [
  'bg-pink-500',
  'bg-cyan-500',
  'bg-green-500',
  'bg-amber-500',
  'bg-violet-500',
] as const;

export function RunnerDimensionsPanel({ calc }: { calc: CalcResult }) {
  const diaOverrides   = useWorkspace((s) => s.diaOverrides);
  const lenOverrides   = useWorkspace((s) => s.lenOverrides);
  const setDiaOverride = useWorkspace((s) => s.setDiaOverride);
  const setLenOverride = useWorkspace((s) => s.setLenOverride);
  const setView        = useWorkspace((s) => s.setView);

  const rows = calc.runner.levels.map((lvl) => ({
    key: lvl.levelKey,
    name: lvl.levelName,
    dia: diaOverrides[lvl.levelKey] ?? lvl.diaMm,
    len: lenOverrides[lvl.levelKey] ?? Math.round(lvl.lengthMm / Math.max(1, lvl.count)),
    count: lvl.count,
    swatch: colorForLevel(lvl.levelKey),
  }));

  return (
    <aside
      aria-labelledby="rd-panel-title"
      className="flex h-full w-[320px] shrink-0 flex-col overflow-y-auto border-l border-border bg-surface px-4 py-3 text-fg shadow-panel"
    >
      <PanelHeader
        id="rd-panel-title"
        title="Runner Dimensions"
        subtitle="Click a cell to override. Enter to apply."
        onClose={() => setView({ runnerDimsPanelOpen: false })}
      />

      <Collapsible title="Legend" defaultOpen={false}>
        <dl className="space-y-1 rounded-md border border-border/60 bg-bg/60 p-2.5 text-[11px]">
          {LEGEND_ROWS.map((l) => (
            <div key={l.term} className="flex items-start gap-2">
              <span className={`mt-1 inline-block h-2.5 w-2.5 shrink-0 rounded-sm ${l.swatch}`} aria-hidden />
              <div className="flex-1">
                <dt className="inline font-semibold text-fg">{l.term}</dt>
                <dd className="ml-1 inline text-muted">— {l.desc}</dd>
              </div>
            </div>
          ))}
        </dl>
      </Collapsible>

      <Collapsible title="Levels" count={rows.length + 2} defaultOpen>
        <div className="rounded-md border border-border/60">
          <div className="grid grid-cols-[1fr_60px_60px_28px] items-center gap-x-2 border-b border-border/60 bg-bg/60 px-2 py-1.5 text-[10px] font-semibold uppercase tracking-wider text-muted">
            <span>Level</span>
            <span className="text-right">Ø mm</span>
            <span className="text-right">L mm</span>
            <span className="text-right">#</span>
          </div>

          {rows.map((row) => (
            <LevelRow
              key={row.key}
              row={row}
              onDia={(v) => setDiaOverride(row.key, v)}
              onLen={(v) => setLenOverride(row.key, v)}
            />
          ))}

          <StaticRow
            swatch="bg-amber-500"
            name="Gate Drop"
            dia={calc.gate.depthMm.toFixed(1)}
            len="55"
            count={calc.tree.cavities.length * calc.input.gatesPerCavity}
          />
          <StaticRow
            swatch="bg-red-500"
            name="Sprue (Major Ø)"
            dia={calc.sprue.exitDiaMm.toFixed(1)}
            len={String(calc.input.machine.sprueLengthMm ?? 80)}
            count={1}
          />
        </div>
      </Collapsible>
    </aside>
  );
}

function LevelRow({
  row, onDia, onLen,
}: {
  row: { key: string; name: string; dia: number; len: number; count: number; swatch: string };
  onDia: (v: number) => void;
  onLen: (v: number) => void;
}) {
  const idDia = useId();
  const idLen = useId();
  const cellClass =
    'num w-full rounded-md border border-border bg-bg px-1.5 py-1 text-right text-[11px] text-fg ' +
    'transition-colors focus-visible:border-blue-500';
  return (
    <div className="grid grid-cols-[1fr_60px_60px_28px] items-center gap-x-2 border-b border-border/60 px-2 py-1.5 last:border-0 hover:bg-bg/40">
      <div className="flex items-center gap-2 text-[11px]">
        <span className={`inline-block h-3 w-1 rounded-sm ${row.swatch}`} aria-hidden />
        <span className="truncate">{row.name}</span>
      </div>
      <label htmlFor={idDia} className="sr-only">{`${row.name} diameter mm`}</label>
      <input
        id={idDia}
        type="number"
        className={cellClass}
        value={row.dia}
        min={0}
        step={0.5}
        onChange={(e) => onDia(parseFloat(e.target.value) || 0)}
      />
      <label htmlFor={idLen} className="sr-only">{`${row.name} length mm`}</label>
      <input
        id={idLen}
        type="number"
        className={cellClass}
        value={row.len}
        min={0}
        step={1}
        onChange={(e) => onLen(parseFloat(e.target.value) || 0)}
      />
      <span className="num text-right text-[11px] text-muted">{row.count}</span>
    </div>
  );
}

function StaticRow({
  swatch, name, dia, len, count,
}: {
  swatch: string; name: string; dia: string; len: string; count: number;
}) {
  return (
    <div className="grid grid-cols-[1fr_60px_60px_28px] items-center gap-x-2 border-b border-border/60 px-2 py-1.5 last:border-0 text-[11px]">
      <div className="flex items-center gap-2">
        <span className={`inline-block h-3 w-1 rounded-sm ${swatch}`} aria-hidden />
        <span className="truncate">{name}</span>
      </div>
      <span className="num text-right text-muted">{dia}</span>
      <span className="num text-right text-muted">{len}</span>
      <span className="num text-right text-muted">{count}</span>
    </div>
  );
}

function colorForLevel(levelKey: string): string {
  const n = parseInt(levelKey.replace(/[^0-9]/g, ''), 10) || 0;
  return depthPalette[n % depthPalette.length]!;
}

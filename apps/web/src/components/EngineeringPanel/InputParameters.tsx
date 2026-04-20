'use client';

import { useId } from 'react';
import { useWorkspace } from '@/state/store';
import { MATERIAL_SEED, RUNNER_PROFILES, type RunnerProfile } from '@runner/core';

/**
 * Input parameters panel — every numeric field is properly labelled via
 * `htmlFor` so screen readers announce the field name, and every input
 * uses the design-token palette rather than hard-coded hex values.
 */

export function InputParameters() {
  const part        = useWorkspace((s) => s.part);
  const machine     = useWorkspace((s) => s.machine);
  const materialId  = useWorkspace((s) => s.materialId);
  const profile     = useWorkspace((s) => s.profile);
  const setPart     = useWorkspace((s) => s.setPart);
  const setMachine  = useWorkspace((s) => s.setMachine);
  const setMaterialId = useWorkspace((s) => s.setMaterialId);
  const setProfile  = useWorkspace((s) => s.setProfile);

  return (
    <div>
      <Num label="Part Weight"         unit="g"   value={part.weightG}          onChange={(v) => setPart({ weightG: v })} />
      <Num label="Part Volume"         unit="mm³" value={part.volumeMm3}        onChange={(v) => setPart({ volumeMm3: v })} />
      <Num label="Wall Thickness"      unit="mm"  value={part.wallThicknessMm}  onChange={(v) => setPart({ wallThicknessMm: v })} />
      <Num label="Projected Area"      unit="mm²" value={part.projectedAreaMm2} onChange={(v) => setPart({ projectedAreaMm2: v })} />

      <DimsRow
        w={part.dimsMm.w}
        d={part.dimsMm.d}
        h={part.dimsMm.h}
        onChange={(dims) => setPart({ dimsMm: dims })}
      />

      <Num label="Nozzle Dia"        unit="mm"  value={machine.nozzleDiaMm}         onChange={(v) => setMachine({ nozzleDiaMm: v })} />
      <Num label="Inj. Pressure"     unit="bar" value={machine.injectionPressureBar} onChange={(v) => setMachine({ injectionPressureBar: v })} />
      <Num label="Clamp Force"       unit="t"   value={machine.clampForceTonne}      onChange={(v) => setMachine({ clampForceTonne: v })} />

      <Select
        label="Material"
        value={materialId}
        onChange={(v) => setMaterialId(v)}
        options={MATERIAL_SEED.map((m) => ({ value: m.id, label: `${m.family} · ${m.grade}` }))}
      />
      <Select
        label="Runner Profile"
        value={profile}
        onChange={(v) => setProfile(v as RunnerProfile)}
        options={Object.values(RUNNER_PROFILES).map((p) => ({ value: p.id, label: p.label }))}
      />
    </div>
  );
}

/* ── field primitives ─────────────────────────────────────────── */

const inputBase =
  'num w-20 rounded-md border border-border bg-bg px-2 py-1 text-right text-xs ' +
  'text-fg transition-colors placeholder:text-muted focus-visible:border-accent';

const selectBase =
  'rounded-md border border-border bg-bg px-2 py-1 text-xs text-fg ' +
  'transition-colors focus-visible:border-accent';

function Num({
  label, unit, value, onChange,
}: { label: string; unit: string; value: number; onChange: (v: number) => void }) {
  const id = useId();
  return (
    <div className="flex items-center justify-between py-1 text-xs">
      <label htmlFor={id} className="text-muted">
        {label} <span className="text-muted/60">({unit})</span>
      </label>
      <input
        id={id}
        type="number"
        inputMode="decimal"
        className={inputBase}
        value={value}
        onChange={(e) => onChange(parseFloat(e.target.value) || 0)}
      />
    </div>
  );
}

function DimsRow({
  w, d, h, onChange,
}: {
  w: number; d: number; h: number;
  onChange: (dims: { w: number; d: number; h: number }) => void;
}) {
  const idW = useId();
  const idD = useId();
  const idH = useId();
  const cell = 'num w-12 rounded-md border border-border bg-bg px-1 py-1 text-right text-xs text-fg transition-colors focus-visible:border-accent';
  return (
    <div className="flex items-center justify-between gap-2 py-1 text-xs">
      <span className="text-muted" id="dims-label">
        Part W×D×H <span className="text-muted/60">(mm)</span>
      </span>
      <div className="flex items-center gap-1" role="group" aria-labelledby="dims-label">
        <label htmlFor={idW} className="sr-only">Width mm</label>
        <input id={idW} type="number" className={cell} value={w}
               onChange={(e) => onChange({ w: +e.target.value || 0, d, h })} />
        <label htmlFor={idD} className="sr-only">Depth mm</label>
        <input id={idD} type="number" className={cell} value={d}
               onChange={(e) => onChange({ w, d: +e.target.value || 0, h })} />
        <label htmlFor={idH} className="sr-only">Height mm</label>
        <input id={idH} type="number" className={cell} value={h}
               onChange={(e) => onChange({ w, d, h: +e.target.value || 0 })} />
      </div>
    </div>
  );
}

function Select<T extends string>({
  label, value, onChange, options,
}: {
  label: string;
  value: T;
  onChange: (v: T) => void;
  options: readonly { value: T; label: string }[];
}) {
  const id = useId();
  return (
    <div className="flex items-center justify-between gap-2 py-1 text-xs">
      <label htmlFor={id} className="text-muted">{label}</label>
      <select
        id={id}
        value={value}
        onChange={(e) => onChange(e.target.value as T)}
        className={selectBase}
      >
        {options.map((o) => (
          <option key={o.value} value={o.value}>{o.label}</option>
        ))}
      </select>
    </div>
  );
}

'use client';

import type { CalcResult } from '@runner/core';
import { RUNNER_PROFILES } from '@runner/core';
import { useWorkspace } from '@/state/store';
import { InputParameters } from './InputParameters';
import { PartImportPanel } from './PartImportPanel';
import { Row, Chip } from './Row';
import { GateTypesReference } from './GateTypesReference';
import { PanelHeader } from '../ui/PanelHeader';
import { Collapsible } from '../ui/Collapsible';

/**
 * Engineering panel — scrollable, aria-labelled region that surfaces every
 * calculated number, safety check, and citation. Every section is
 * independently collapsible so users can hide the parts they don't need.
 */

export function EngineeringPanel({ calc }: { calc: CalcResult }) {
  const r = calc.runner;
  const g = calc.gate;
  const s = calc.sprue;
  const m = calc.mechanical;
  const t = calc.thermal;
  const profile = RUNNER_PROFILES[calc.input.profile];
  const setView = useWorkspace((st) => st.setView);

  return (
    <aside
      aria-labelledby="eng-panel-title"
      className="flex h-full w-[360px] shrink-0 flex-col overflow-y-auto border-l border-border bg-surface px-4 py-3 text-fg shadow-panel"
    >
      <PanelHeader
        id="eng-panel-title"
        title="Engineering Panel"
        subtitle={`Calc v${calc.calcVersion} · ${calc.citations.length} citations · ${calc.warnings.length} warnings`}
        onClose={() => setView({ engPanelOpen: false })}
      />

      <Collapsible title="Input Parameters" defaultOpen>
        <InputParameters />
      </Collapsible>

      <Collapsible title="Part Import" defaultOpen={false}>
        <PartImportPanel />
      </Collapsible>

      <Collapsible title="Runner Sizing" hint="D = ⁴√(W) × ⁴√(L) / 3.7" defaultOpen>
        <Row label="Max runner path"    value={`${r.maxPathLengthMm.toFixed(0)} mm`} />
        <Row label="Calculated Ø"       value={`${r.baseDiaMm.toFixed(2)} mm`} />
        <Row label="Recommended Ø"      value={`${r.recommendedDiaMm.toFixed(1)} mm`} emphasis />
        <Row label="Profile"            value={profile.label} />
        <Row label="Efficiency ratio"   value={profile.efficiencyRatio} />
        <Row label="Runner volume"      value={`${r.totalVolumeMm3.toFixed(0)} mm³`} />
        <Row label="Worst-path ΔP"      value={`${r.pressureDrop.worstPathMPa.toFixed(2)} MPa`} />
      </Collapsible>

      <Collapsible title="Gate Sizing" hint="h = n·t,  W = n·√A / 30" defaultOpen>
        <Row label="Material constant (n)" value={calc.input.material.gateConstantN} />
        <Row label="Gate depth (h)"        value={`${g.depthMm.toFixed(2)} mm`} emphasis />
        <Row label="Gate width (W)"        value={`${g.widthMm.toFixed(2)} mm`} emphasis />
        <Row label="Gate land (L)"         value={`${g.landMm.min}–${g.landMm.max} mm`} />
        <Row label="Gates per cavity"      value={calc.input.gatesPerCavity} />
        <Row label="Gate shear rate"       value={`${g.shear.shearRateS.toFixed(0)} s⁻¹`} />
        <Row label="Gate shear stress"     value={`${g.shear.shearStressMPa.toFixed(3)} MPa`} />
      </Collapsible>

      <Collapsible title="Sprue Bush">
        <Row label="Nozzle Ø"                  value={`${calc.input.machine.nozzleDiaMm.toFixed(1)} mm`} />
        <Row label="Orifice Ø (nozzle + 0.75)" value={`${s.orificeMm.toFixed(2)} mm`} />
        <Row label="Exit Ø"                    value={`${s.exitDiaMm.toFixed(2)} mm`} />
        <Row label="Taper"                     value={`${s.taperDeg}° incl.`} />
        <Row label="Sprue volume"              value={`${s.volumeMm3.toFixed(0)} mm³`} />
      </Collapsible>

      <Collapsible title="Mechanical">
        <Row label="Required clamp"        value={`${m.clamp.clampForceTonne.toFixed(1)} t`} />
        <Row label="Clamp utilisation"     value={<UtilChip pct={m.clampUtilisationPct} />} />
        <Row label="Machine P utilisation" value={<UtilChip pct={m.machinePressureUtilisationPct} />} />
      </Collapsible>

      <Collapsible title="Thermal">
        <Row label="Fill time"       value={`${t.fill.fillTimeS.toFixed(2)} s`} />
        <Row label="Freeze time"     value={`${t.freeze.freezeTimeS.toFixed(2)} s`} />
        <Row label="ΔT along runner" value={`${t.meltDrop.deltaTC.toFixed(1)} °C`} />
        <Row label="Frozen layer"    value={`${t.frozenLayerMm.toFixed(3)} mm`} />
      </Collapsible>

      <Collapsible title="Balance">
        <Row label="Imbalance ratio" value={`${(calc.balance.imbalanceRatio * 100).toFixed(1)} %`} />
        <Row
          label="Status"
          value={
            calc.balance.isBalanced
              ? <Chip tone="success">BALANCED</Chip>
              : <Chip tone="warn">UNBALANCED</Chip>
          }
        />
      </Collapsible>

      <Collapsible title="Yield">
        <Row label="Shot weight"     value={`${calc.yield.shotWeightG.toFixed(1)} g`} />
        <Row label="Part fraction"   value={`${calc.yield.partFractionPct.toFixed(1)} %`} />
        <Row label="Runner fraction" value={`${calc.yield.runnerFractionPct.toFixed(1)} %`} />
      </Collapsible>

      <Collapsible title="Layout">
        <Row label="Layout ID"       value={calc.input.layoutId} />
        <Row label="Cavities"        value={calc.tree.cavities.length} />
        <Row label="Runner segments" value={calc.tree.edges.length} />
        <Row label="System type"     value={calc.input.hotRunner ? 'Hot Runner' : 'Cold Runner'} />
      </Collapsible>

      {calc.warnings.length > 0 && (
        <Collapsible
          title="Warnings"
          defaultOpen
          count={calc.warnings.length}
        >
          <ul className="space-y-1.5" aria-live="polite" aria-atomic="false">
            {calc.warnings.map((w, i) => (
              <li
                key={i}
                className={`rounded-md border px-2.5 py-2 text-[11px] ${
                  w.severity === 'error'
                    ? 'border-red-500/40 bg-red-500/10'
                    : 'border-orange-500/40 bg-orange-500/10'
                }`}
              >
                <Chip tone={w.severity === 'error' ? 'error' : 'warn'}>
                  {w.severity.toUpperCase()}
                </Chip>
                <p className="mt-1 text-fg">{w.message}</p>
              </li>
            ))}
          </ul>
        </Collapsible>
      )}

      <Collapsible title="Citations" count={calc.citations.length} defaultOpen={false}>
        <ul className="space-y-1.5">
          {calc.citations.map((c) => (
            <li key={c.id} className="rounded-md border border-border/60 bg-bg/60 px-2.5 py-2 text-[10.5px]">
              <p className="num text-blue-400">{c.formula}</p>
              <p className="mt-0.5 text-muted">
                {c.source}{c.page ? `, ${c.page}` : ''}
              </p>
            </li>
          ))}
        </ul>
      </Collapsible>

      <Collapsible title="Gate Types Reference" count="13" defaultOpen={false}>
        <GateTypesReference />
      </Collapsible>
    </aside>
  );
}

function UtilChip({ pct }: { pct: number }) {
  const tone = pct > 100 ? 'error' : pct > 80 ? 'warn' : 'success';
  return <Chip tone={tone}>{pct.toFixed(1)} %</Chip>;
}

'use client';

import { useEffect, useId, useMemo, useRef, useState } from 'react';
import {
  runCalculations,
  findMaterial,
  MATERIAL_SEED,
  detectCavityOverlaps,
  optimizeForFillBalance,
  computeFillBalance,
  computeEdgeClasses,
  apparentViscosity,
  getLayout,
  type CalcResult,
  type EdgeClass,
  type LayoutId,
  type RunnerProfile,
  type FillBalanceResult,
} from '@runner/core';

const CAVITY_MIN_GAP_MM = 10;
import { useWorkspace, BALANCE_MODE_LAMBDA, type BalanceMode } from '@/state/store';
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

export function RunnerDimensionsPanel({
  calc, engPanelOpen = false,
}: {
  calc: CalcResult;
  engPanelOpen?: boolean;
}) {
  const diaOverrides   = useWorkspace((s) => s.diaOverrides);
  const lenOverrides   = useWorkspace((s) => s.lenOverrides);
  const setDiaOverride = useWorkspace((s) => s.setDiaOverride);
  const setLenOverride = useWorkspace((s) => s.setLenOverride);
  const clearLenOverrides = useWorkspace((s) => s.clearLenOverrides);
  const setView        = useWorkspace((s) => s.setView);
  const highlightedLevelKey    = useWorkspace((s) => s.highlightedLevelKey);
  const setHighlightedLevelKey = useWorkspace((s) => s.setHighlightedLevelKey);
  const setFocusedLevelKey     = useWorkspace((s) => s.setFocusedLevelKey);
  const lockedLevels    = useWorkspace((s) => s.lockedLevels);
  const toggleLockedLevel = useWorkspace((s) => s.toggleLockedLevel);
  const pendingBalance    = useWorkspace((s) => s.pendingBalance);
  const setPendingBalance = useWorkspace((s) => s.setPendingBalance);
  const meltOverrides     = useWorkspace((s) => s.meltOverrides);
  const setMeltOverrides  = useWorkspace((s) => s.setMeltOverrides);
  const diaEdgeOverrides  = useWorkspace((s) => s.diaEdgeOverrides);
  const lenEdgeOverrides  = useWorkspace((s) => s.lenEdgeOverrides);
  const setDiaEdgeOverrides = useWorkspace((s) => s.setDiaEdgeOverrides);
  const setDiaEdgeOverride  = useWorkspace((s) => s.setDiaEdgeOverride);
  const setLenEdgeOverride  = useWorkspace((s) => s.setLenEdgeOverride);
  const clearEdgeOverrides  = useWorkspace((s) => s.clearEdgeOverrides);
  const panelWidth          = useWorkspace((s) => s.runnerPanelWidthPx);
  const setPanelWidth       = useWorkspace((s) => s.setRunnerPanelWidth);
  const setHighlightedEdgeIds = useWorkspace((s) => s.setHighlightedEdgeIds);
  const balanceMode         = useWorkspace((s) => s.balanceMode);
  const setBalanceMode      = useWorkspace((s) => s.setBalanceMode);

  // Drag-resize from the panel's left edge. We capture the pointer on
  // the handle, watch document-level pointermove events for the drag
  // delta, and commit width updates straight to the store (so they
  // survive across calc rebuilds and other re-renders).
  const dragStartRef = useRef<{ clientX: number; startWidth: number } | null>(null);
  const onResizeStart = (e: React.PointerEvent<HTMLDivElement>) => {
    e.preventDefault();
    dragStartRef.current = { clientX: e.clientX, startWidth: panelWidth };
    const move = (ev: PointerEvent) => {
      const start = dragStartRef.current;
      if (!start) return;
      // Panel is anchored on the right of the viewport; dragging the
      // handle left should grow the panel.
      const dx = start.clientX - ev.clientX;
      setPanelWidth(start.startWidth + dx);
    };
    const stop = () => {
      dragStartRef.current = null;
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', stop);
      document.body.style.cursor = '';
      document.body.style.userSelect = '';
    };
    document.body.style.cursor = 'col-resize';
    document.body.style.userSelect = 'none';
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', stop);
  };
  const onResizeKey = (e: React.KeyboardEvent<HTMLDivElement>) => {
    // Keyboard accessibility: arrow keys nudge the width 16 px at a time.
    if (e.key === 'ArrowLeft')  { e.preventDefault(); setPanelWidth(panelWidth + 16); }
    if (e.key === 'ArrowRight') { e.preventDefault(); setPanelWidth(panelWidth - 16); }
    if (e.key === 'Home')       { e.preventDefault(); setPanelWidth(380); }
  };

  // Edge-class grouping (path-length-from-sprue buckets) drives the
  // multi-row rendering for asymmetric layouts where a single level Ø
  // can't represent the variation in sub-runner diameters.
  const edgeClasses = useMemo(() => computeEdgeClasses(calc.tree), [calc.tree]);
  const [expandedLevels, setExpandedLevels] = useState<Set<string>>(new Set());
  const toggleExpanded = (key: string) => {
    setExpandedLevels((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  };

  // Auto-fit needs a fresh calc input each time it iterates, so it pulls
  // every workspace field that runCalculations consumes.
  const part            = useWorkspace((s) => s.part);
  const cavities        = useWorkspace((s) => s.cavities);
  const gatesPerCavity  = useWorkspace((s) => s.gatesPerCavity);
  const layoutId        = useWorkspace((s) => s.layoutId);
  const profile         = useWorkspace((s) => s.profile);
  const hotRunner       = useWorkspace((s) => s.hotRunner);
  const materialId      = useWorkspace((s) => s.materialId);
  const machine         = useWorkspace((s) => s.machine);

  const toggleHighlight = (key: string) =>
    setHighlightedLevelKey(highlightedLevelKey === key ? null : key);

  // When the user changes the Solver Target (Fill / Both / Volume), the
  // λ in `useCalc` updates immediately, but the pipeline's auto-balance
  // step (3b) only runs when no overrides exist. To make the toggle feel
  // responsive, clear any per-edge tuning from the previous Balance run
  // so the fresh λ takes effect on the next pipeline pass. User-typed
  // level overrides (Main, Sprue, etc.) and locks are preserved.
  const prevBalanceMode = useRef(balanceMode);
  useEffect(() => {
    if (prevBalanceMode.current === balanceMode) return;
    prevBalanceMode.current = balanceMode;
    if (
      Object.keys(diaEdgeOverrides).length > 0 ||
      Object.keys(lenEdgeOverrides).length > 0
    ) {
      clearEdgeOverrides();
    }
  }, [balanceMode, diaEdgeOverrides, lenEdgeOverrides, clearEdgeOverrides]);

  // The banner triggers whenever any pair of cavities is closer than the
  // CAVITY_MIN_GAP_MM threshold — that's stricter than calc.overlaps (which
  // only fires on true geometric overlap), but matches what auto-fit enforces.
  const tightPairs = useMemo(() => {
    const padW = part.dimsMm.w + CAVITY_MIN_GAP_MM * 2;
    const padD = part.dimsMm.d + CAVITY_MIN_GAP_MM * 2;
    return detectCavityOverlaps(calc.tree.cavities, padW, padD);
  }, [calc.tree.cavities, part.dimsMm.w, part.dimsMm.d]);
  const hardOverlapCount = calc.overlaps.length;

  // Diameter-taper consistency: when the user overrides any level's Ø, the
  // OTHER depth-based levels (overridden or not) should still scale by
  // 0.85^depth around the same implied base. We anchor on the most recently
  // edited level (`lastDiaKey`), so even after the user has accepted a
  // previous suggestion, editing again re-prompts for the rest.
  const [lastDiaKey, setLastDiaKey] = useState<string | null>(null);
  const diaTaper = useMemo(
    () => computeDiaTaperSuggestion(diaOverrides, calc.runner.levels, lastDiaKey),
    [diaOverrides, calc.runner.levels, lastDiaKey],
  );
  // Baseline calc: same workspace state but with NO length overrides. Lets
  // us read each level's "natural" layout-determined length, which is the
  // default we want to recommend so the user can always revert toward it.
  const baselineCalc = useMemo(() => {
    return runCalculations({
      part, cavities, gatesPerCavity, layoutId, profile, hotRunner,
      material: findMaterial(materialId) ?? MATERIAL_SEED[0]!,
      machine,
      overrides: { diaByLevel: diaOverrides, lenByLevel: {} },
    });
  }, [
    part, cavities, gatesPerCavity, layoutId, profile,
    hotRunner, materialId, machine, diaOverrides,
  ]);

  // Anchor for length recommendations — the level whose L the user most
  // recently changed. Other levels' recommendations scale proportionally
  // to preserve the relative geometry, so editing one runner ripples
  // through to suggested values on the rest.
  const [lastLenKey, setLastLenKey] = useState<string | null>(null);

  // Recommended L per level. Two contributing rules:
  //   1. Proportional ripple — if the user has overridden the anchor row's
  //      length, scale every other depth level's baseline default by the
  //      same factor (override / baselineDefault). Editing Main = 100 with
  //      a baseline default of 80 gives a 1.25× scale, so Sub default 40
  //      becomes a 50 mm recommendation.
  //   2. Min-gap floor — if cavities are within CAVITY_MIN_GAP_MM of each
  //      other, the auto-fit search produces minimum lengths to clear the
  //      gap. The recommendation is the max of the two.
  const recommendedLen = useMemo(() => {
    const out: Record<string, number> = {};
    const baseline: Record<string, number> = {};
    for (const lvl of baselineCalc.runner.levels) {
      const def = Math.round(lvl.lengthMm / Math.max(1, lvl.count));
      if (def > 0) baseline[lvl.levelKey] = def;
    }

    // Proportional scale relative to the anchor (or 1 if no anchor).
    let scale = 1;
    if (lastLenKey && /^L\d+$/.test(lastLenKey)) {
      const anchorOverride = lenOverrides[lastLenKey];
      const anchorBaseline = baseline[lastLenKey];
      if (anchorOverride && anchorOverride > 0 && anchorBaseline && anchorBaseline > 0) {
        scale = anchorOverride / anchorBaseline;
      }
    }

    for (const [key, def] of Object.entries(baseline)) {
      if (key === lastLenKey) {
        // Anchor row: recommend the baseline so the user can revert.
        out[key] = def;
      } else {
        out[key] = Math.round(def * scale);
      }
    }

    if (tightPairs.length > 0) {
      const fix = computeAutoFitOverrides({
        part, cavities, gatesPerCavity, layoutId, profile, hotRunner,
        materialId, machine, diaOverrides, lenOverrides,
      });
      if (fix) {
        for (const [k, v] of Object.entries(fix)) {
          out[k] = Math.max(out[k] ?? 0, v);
        }
      }
    }
    return out;
  }, [
    baselineCalc, tightPairs.length, part, cavities, gatesPerCavity,
    layoutId, profile, hotRunner, materialId, machine,
    diaOverrides, lenOverrides, lastLenKey,
  ]);

  const recommendedDia = diaTaper.suggestions;

  // Detailed balance: in addition to L/D variance (Beaumont 2007), compute
  // per-path pressure-drop and per-path volume variance from existing calc
  // outputs. The flow side of the system is balanced when ALL three σ are
  // small — high σ on any one indicates that some cavities will fill and
  // pack differently than others.
  const detailedBalance = useMemo(
    () => computeDetailedBalance(calc),
    [calc],
  );
  const balanceTone =
    detailedBalance.maxRatio <= 0.10 ? 'ok' :
    detailedBalance.maxRatio <= 0.20 ? 'warn' :
    'bad';

  const autoFitFailed = tightPairs.length > 0 && Object.keys(recommendedLen).length === 0;

  const onFix = () => {
    for (const [k, v] of Object.entries(recommendedDia)) setDiaOverride(k, v);
    for (const [k, v] of Object.entries(recommendedLen)) setLenOverride(k, v);
  };

  // Live fill-time analysis for the current calc — drives the Fill σ chip,
  // the per-cavity table, and the heatmap colouring.
  const fillTimeAnalysis = useMemo(
    () => analyseFillTimes(calc),
    [calc],
  );

  // Auto-balance — searches for diameters (and, if needed, lengths) that
  // minimise the per-cavity fill-time σ. Locked levels are held fixed.
  const [balanceBusy, setBalanceBusy] = useState(false);
  const [balanceMsg, setBalanceMsg] = useState<string | null>(null);
  const onAutoBalance = () => {
    setBalanceBusy(true);
    setBalanceMsg(null);
    try {
      const material = findMaterial(materialId) ?? MATERIAL_SEED[0]!;
      // Apply melt-property overrides if the user has set any.
      const tempC = meltOverrides.meltTempC > 0
        ? meltOverrides.meltTempC
        : (material.tMeltMin + material.tMeltMax) / 2;
      const tempK = tempC + 273.15;
      const eta = meltOverrides.viscosityPaS > 0
        ? meltOverrides.viscosityPaS
        : apparentViscosity(material, 1000, tempK);
      const cavityVolMm3 = meltOverrides.cavityVolumeCm3 > 0
        ? meltOverrides.cavityVolumeCm3 * 1000
        : part.volumeMm3;
      const totalQ = computeTotalQ(calc);
      const result = optimizeForFillBalance({
        tree: calc.tree,
        viscosityPaS: eta,
        totalFlowMm3PerS: totalQ,
        powerLawN: material.powerLaw?.n,
        cavityVolumeMm3: cavityVolMm3,
        initialDiaByLevel: diaOverrides,
        initialLenByLevel: lenOverrides,
        lockedLevels: new Set(lockedLevels),
        volumeWeight: BALANCE_MODE_LAMBDA[balanceMode],
        rebuildWithLenOverrides: (lenByLevel) =>
          runCalculations({
            part, cavities, gatesPerCavity, layoutId, profile, hotRunner,
            material, machine,
            overrides: { diaByLevel: diaOverrides, lenByLevel },
          }).tree,
      });

      // Stage as a pending diff — user reviews then clicks Apply.
      const fillTimesObj: Record<number, number> = {};
      for (const [id, t] of result.fillTimes.perCavityFillTimeS) fillTimesObj[id] = t;
      setPendingBalance({
        diaByLevel: result.diaByLevel,
        lenByLevel: result.lenByLevel,
        diaByEdge: result.diaByEdge,
        usedEdgeTuning: result.usedEdgeTuning,
        fillTimesS: fillTimesObj,
        meanFillTimeS: result.fillTimes.meanFillTimeS,
        finalSigma: result.finalSigma,
        iterations: result.iterations,
        converged: result.converged,
        hitFloorClamp: result.hitFloorClamp,
      });

      const sigmaPct = (result.finalSigma * 100).toFixed(2);
      if (result.reason === 'all-locked') {
        setBalanceMsg('Every depth level is locked — unlock at least one to balance.');
      } else if (result.converged) {
        setBalanceMsg(
          `Solver converged to ${sigmaPct}% Fill σ in ${result.iterations} iterations. Review the diff and click Apply.`,
        );
      } else {
        setBalanceMsg(
          `Best achievable: ${sigmaPct}% (target 2%). Review the diff or relax geometry.`,
        );
      }
    } catch (err) {
      console.error('auto-balance failed', err);
      setBalanceMsg('Balance solver crashed — see console.');
    } finally {
      setBalanceBusy(false);
    }
  };

  const onApplyPending = () => {
    if (!pendingBalance) return;
    // Match depth-based runner levels (L0, L1, …) plus drops (L_drop) so
    // solver-suggested drop Ø changes don't get silently dropped here.
    const tunableLevelRe = /^(L\d+|L_drop)$/;
    for (const [k, v] of Object.entries(pendingBalance.diaByLevel)) {
      if (!tunableLevelRe.test(k)) continue;
      if (lockedLevels.includes(k)) continue;
      if (diaOverrides[k] !== v) setDiaOverride(k, v);
    }
    for (const [k, v] of Object.entries(pendingBalance.lenByLevel)) {
      if (!tunableLevelRe.test(k)) continue;
      if (lockedLevels.includes(k)) continue;
      setLenOverride(k, v);
    }
    // Per-edge tuning takes precedence over level overrides — write the
    // entire map at once so the calc engine picks it up next render.
    if (pendingBalance.usedEdgeTuning) {
      const edgeMap: Record<number, number> = {};
      for (const [eid, v] of Object.entries(pendingBalance.diaByEdge)) {
        edgeMap[Number(eid)] = v;
      }
      setDiaEdgeOverrides(edgeMap);
    } else {
      // Level mode replaces any prior edge tuning so users don't get
      // confused by stale per-edge values lingering after a clean balance.
      clearEdgeOverrides();
    }
    setPendingBalance(null);
    setBalanceMsg(
      pendingBalance.usedEdgeTuning
        ? 'Edge-tuned dimensions applied — different sub-runners now carry different Ø.'
        : 'Recommended dimensions applied.',
    );
  };

  const onResetPending = () => {
    setPendingBalance(null);
    setBalanceMsg(null);
  };

  const rows = calc.runner.levels.map((lvl) => {
    const perEdge = lenOverrides[lvl.levelKey] ?? Math.round(lvl.lengthMm / Math.max(1, lvl.count));
    return {
      key: lvl.levelKey,
      name: lvl.levelName,
      dia: diaOverrides[lvl.levelKey] ?? lvl.diaMm,
      len: perEdge,
      count: lvl.count,
      totalLen: perEdge * lvl.count,
      swatch: colorForLevel(lvl.levelKey),
    };
  });

  // Whether any row would actually change if Fix were clicked. Used to
  // disable the Fix button when the panel is already at the targets.
  const hasFixSuggestions =
    Object.keys(recommendedDia).length > 0 ||
    rows.some((r) => {
      const rec = recommendedLen[r.key];
      return rec !== undefined && Math.abs(rec - r.len) >= 1;
    });

  return (
    <aside
      aria-labelledby="rd-panel-title"
      style={{
        width: `${panelWidth}px`,
        // Hard cap relative to viewport so growing the panel never pushes the
        // engineering panel off-screen. Reserves 320 px for the 3D viewer
        // plus the eng panel's own 360 px when it's open.
        maxWidth: `calc(100vw - 320px${engPanelOpen ? ' - 360px' : ''})`,
      }}
      className="relative flex h-full shrink-0 flex-col overflow-y-auto border-l border-border bg-surface px-4 py-3 text-fg shadow-panel"
    >
      {/* Drag handle on the left edge — wide enough hit-area + a thin
          visible bar that brightens on hover and during drag. */}
      <div
        role="separator"
        aria-orientation="vertical"
        aria-label="Resize Runner Dimensions panel"
        aria-valuenow={panelWidth}
        aria-valuemin={320}
        aria-valuemax={720}
        tabIndex={0}
        onPointerDown={onResizeStart}
        onKeyDown={onResizeKey}
        className="group absolute left-0 top-0 z-10 h-full w-1.5 -translate-x-1/2 cursor-col-resize select-none focus-visible:outline-none"
      >
        <div className="ml-[2px] h-full w-[2px] bg-border transition-colors group-hover:bg-info group-active:bg-accent group-focus-visible:bg-accent" />
      </div>
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
        <BalanceToolbar
          balance={detailedBalance}
          fillSigma={fillTimeAnalysis.imbalanceRatio}
          tone={balanceTone}
          hasLenOverrides={Object.keys(lenOverrides).length > 0}
          onResetLen={clearLenOverrides}
          onAutoBalance={onAutoBalance}
          balanceBusy={balanceBusy}
          balanceMsg={balanceMsg}
          tightCount={tightPairs.length}
          hardOverlapCount={hardOverlapCount}
          taperOff={Object.keys(recommendedDia).length > 0}
          fixDisabled={!hasFixSuggestions}
          fixUnsolvable={autoFitFailed}
          onFix={onFix}
          edgeTuned={Object.keys(diaEdgeOverrides).length > 0}
          onClearEdgeTuning={clearEdgeOverrides}
          balanceMode={balanceMode}
          onBalanceModeChange={setBalanceMode}
        />

        {pendingBalance && (
          <PendingBalanceDiff
            pending={pendingBalance}
            rows={rows}
            lockedLevels={lockedLevels}
            onApply={onApplyPending}
            onReset={onResetPending}
          />
        )}

        <div className="mt-2 rounded-md border border-border/60">
          <div className={`${ROW_GRID} items-center border-b border-border/60 bg-bg/60 px-2 py-1.5 text-[10px] font-semibold uppercase tracking-wider text-muted`}>
            <span>Level</span>
            <span className="text-right">Ø mm</span>
            <span className="text-right">L mm</span>
            <span className="text-right" title="Total runner length per level (per-edge L × count)">Σ mm</span>
            <span className="sr-only">Highlight</span>
          </div>

          {rows.map((row) => {
            const classes = edgeClasses.get(row.key) ?? [];
            const multiClass = classes.length > 1;
            const expanded = expandedLevels.has(row.key);
            return (
              <LevelRowGroup
                key={row.key}
                row={row}
                classes={classes}
                multiClass={multiClass}
                expanded={expanded}
                onToggleExpanded={() => toggleExpanded(row.key)}
                tree={calc.tree}
                diaEdgeOverrides={diaEdgeOverrides}
                lenEdgeOverrides={lenEdgeOverrides}
                onDiaLevel={(v) => { setDiaOverride(row.key, v); setLastDiaKey(row.key); }}
                onLenLevel={(v) => { setLenOverride(row.key, v); setLastLenKey(row.key); }}
                onDiaEdge={(eid, v) => setDiaEdgeOverride(eid, v)}
                onLenEdge={(eid, v) => setLenEdgeOverride(eid, v)}
                recommendedDia={recommendedDia[row.key]}
                recommendedLen={recommendedLen[row.key]}
                highlighted={highlightedLevelKey === row.key}
                onToggleHighlight={() => toggleHighlight(row.key)}
                onFocusLevel={() => setFocusedLevelKey(row.key)}
                onBlurLevel={() => setFocusedLevelKey(null)}
                locked={lockedLevels.includes(row.key)}
                onToggleLock={() => toggleLockedLevel(row.key)}
                onHoverSection={(ids) => setHighlightedEdgeIds([...ids])}
                onHoverLeaveSection={() => setHighlightedEdgeIds([])}
              />
            );
          })}

          {/* Gate Drop is now a real "L_drop" level with per-cavity drop edges
              in the runner tree, so it's rendered by the LevelRowGroup loop
              above (with class sub-rows for asymmetric layouts). */}
          <ExtraRow
            swatch="bg-red-500"
            name="Sprue"
            levelKey="sprue"
            defaultDia={Number(calc.sprue.exitDiaMm.toFixed(1))}
            defaultLen={calc.input.machine.sprueLengthMm ?? 80}
            count={1}
            diaOverride={diaOverrides['sprue']}
            lenOverride={lenOverrides['sprue']}
            onDia={(v) => setDiaOverride('sprue', v)}
            onLen={(v) => setLenOverride('sprue', v)}
            highlighted={highlightedLevelKey === 'sprue'}
            onToggleHighlight={() => toggleHighlight('sprue')}
            onFocusLevel={() => setFocusedLevelKey('sprue')}
            onBlurLevel={() => setFocusedLevelKey(null)}
          />
        </div>
      </Collapsible>

      <Collapsible
        title="Process summary"
        defaultOpen
      >
        <ProcessSummary calc={calc} fill={fillTimeAnalysis} />
      </Collapsible>

      <Collapsible
        title="Per-cavity fill"
        count={fillTimeAnalysis.perCavityFillTimeS.size}
        defaultOpen={false}
      >
        <PerCavityFillTable
          analysis={fillTimeAnalysis}
          balanceKind={getLayout(layoutId).balance}
        />
      </Collapsible>

      <Collapsible title="Melt properties" defaultOpen={false}>
        <MeltPropertiesEditor
          values={meltOverrides}
          onChange={setMeltOverrides}
          fallbackTempC={(() => {
            const m = findMaterial(materialId) ?? MATERIAL_SEED[0]!;
            return Math.round((m.tMeltMin + m.tMeltMax) / 2);
          })()}
          fallbackVolumeCm3={Math.round(part.volumeMm3 / 1000 * 10) / 10}
        />
      </Collapsible>
    </aside>
  );
}

function MeltPropertiesEditor({
  values, onChange, fallbackTempC, fallbackVolumeCm3,
}: {
  values: { viscosityPaS: number; pressureMPa: number; meltTempC: number; cavityVolumeCm3: number };
  onChange: (m: Partial<{ viscosityPaS: number; pressureMPa: number; meltTempC: number; cavityVolumeCm3: number }>) => void;
  fallbackTempC: number;
  fallbackVolumeCm3: number;
}) {
  // The user enters absolute values; 0 means "use the calc engine's
  // material-derived default" so the field stays empty as a placeholder.
  const fields: { key: keyof typeof values; label: string; unit: string; placeholder: string; step: number }[] = [
    { key: 'viscosityPaS',     label: 'η',  unit: 'Pa·s', placeholder: 'auto (apparent η @ 1000 1/s)', step: 10 },
    { key: 'meltTempC',        label: 'T',  unit: '°C',   placeholder: `${fallbackTempC}`, step: 5 },
    { key: 'pressureMPa',      label: 'P',  unit: 'MPa',  placeholder: '80', step: 5 },
    { key: 'cavityVolumeCm3',  label: 'V',  unit: 'cm³',  placeholder: `${fallbackVolumeCm3}`, step: 0.5 },
  ];
  return (
    <div className="space-y-1.5 rounded-md border border-border/60 bg-bg/40 p-2">
      <p className="text-[10px] text-muted">
        Override the material-derived defaults that drive the fill-time and
        balance calculations. Leave blank to use the auto value.
      </p>
      {fields.map((f) => (
        <div key={f.key} className="grid grid-cols-[28px_1fr_38px] items-center gap-2 text-[11px]">
          <span className="num text-muted">{f.label}</span>
          <input
            type="number"
            value={values[f.key] || ''}
            placeholder={f.placeholder}
            min={0}
            step={f.step}
            onChange={(e) => onChange({ [f.key]: parseFloat(e.target.value) || 0 })}
            className="num w-full rounded-md border border-border bg-bg px-1.5 py-1 text-right text-[11px] text-fg focus-visible:border-blue-500"
          />
          <span className="text-[10px] text-muted">{f.unit}</span>
        </div>
      ))}
    </div>
  );
}

function ProcessSummary({
  calc, fill,
}: {
  calc: CalcResult;
  fill: FillBalanceResult;
}) {
  const totalFillS = calc.thermal.fill.fillTimeS;
  const worstDpMPa = calc.runner.pressureDrop.worstPathMPa;
  const gateShear = calc.gate.shear.shearRateS;
  const clampUtil = calc.mechanical.clampUtilisationPct;
  const machinePressUtil = calc.mechanical.machinePressureUtilisationPct;
  const meanFillMs = fill.meanFillTimeS * 1000;
  return (
    <dl className="grid grid-cols-2 gap-1.5 rounded-md border border-border/60 bg-bg/40 p-2 text-[11px]">
      <Stat label="Fill time"      value={`${totalFillS.toFixed(2)} s`} />
      <Stat label="Mean per-cav"  value={`${meanFillMs.toFixed(1)} ms`} />
      <Stat label="Worst ΔP"       value={`${worstDpMPa.toFixed(1)} MPa`} tone={machinePressUtil > 100 ? 'bad' : machinePressUtil > 80 ? 'warn' : 'ok'} />
      <Stat label="Gate shear"     value={`${gateShear.toFixed(0)} 1/s`} />
      <Stat label="Clamp util"     value={`${clampUtil.toFixed(0)} %`}    tone={clampUtil > 100 ? 'bad' : clampUtil > 80 ? 'warn' : 'ok'} />
      <Stat label="Press util"     value={`${machinePressUtil.toFixed(0)} %`} tone={machinePressUtil > 100 ? 'bad' : machinePressUtil > 80 ? 'warn' : 'ok'} />
    </dl>
  );
}

function Stat({
  label, value, tone = 'ok',
}: { label: string; value: string; tone?: 'ok' | 'warn' | 'bad' }) {
  const cls =
    tone === 'ok'   ? 'text-fg' :
    tone === 'warn' ? 'text-warn' :
                       'text-danger';
  return (
    <div className="flex items-center justify-between rounded border border-border/40 bg-bg/60 px-2 py-1">
      <dt className="text-[10px] text-muted">{label}</dt>
      <dd className={`num text-[11px] font-semibold ${cls}`}>{value}</dd>
    </div>
  );
}

function PendingBalanceDiff({
  pending, rows, lockedLevels, onApply, onReset,
}: {
  pending: NonNullable<ReturnType<typeof useWorkspace.getState>['pendingBalance']>;
  rows: { key: string; name: string; dia: number; len: number; swatch: string }[];
  lockedLevels: string[];
  onApply: () => void;
  onReset: () => void;
}) {
  // Build the diff list: only depth-based levels, only rows where the
  // recommended Ø or L would actually change something the user can see.
  const depthRe = /^L\d+$/;
  const items = rows
    .filter((r) => depthRe.test(r.key))
    .map((r) => {
      const recDia = pending.diaByLevel[r.key];
      const recLen = pending.lenByLevel[r.key];
      const dDia = recDia !== undefined ? recDia - r.dia : 0;
      const dLen = recLen !== undefined ? recLen - r.len : 0;
      return {
        key: r.key,
        name: r.name,
        swatch: r.swatch,
        currentDia: r.dia,
        currentLen: r.len,
        recDia,
        recLen,
        dDia,
        dLen,
        locked: lockedLevels.includes(r.key),
      };
    });

  const sigmaPct = pending.finalSigma * 100;
  const sigmaCls =
    sigmaPct <= 2 ? 'text-accent' :
    sigmaPct <= 5 ? 'text-warn' :
                    'text-danger';
  const meanMs = pending.meanFillTimeS * 1000;

  return (
    <div className="my-2 rounded-md border border-info/60 bg-info/10 p-2.5 text-[11px]">
      <div className="flex items-center justify-between gap-2">
        <span className="font-semibold text-info">Recommended dimensions</span>
        <span className={`num text-[11px] ${sigmaCls}`}>
          σ {sigmaPct.toFixed(2)}% · mean {meanMs.toFixed(1)} ms · {pending.iterations} iter
        </span>
      </div>
      {pending.usedEdgeTuning && (
        <p className="mt-1 rounded bg-info/15 px-1.5 py-0.5 text-[10px] text-info">
          Edge-tuned — solver assigned individual Ø to each runner segment
          (different sub-runners get different diameters to balance fill time).
        </p>
      )}
      {pending.hitFloorClamp && (
        <p className="mt-1 text-[10px] text-warn">
          Cascade clamped at the 2 mm manufacturability floor — solver compensated via lengths.
        </p>
      )}
      {!pending.converged && (
        <p className="mt-1 text-[10px] text-warn">
          Did not reach the 2 % target — accepting the partial fix still
          improves balance from the current state.
        </p>
      )}

      <ul className="mt-2 space-y-1">
        {items.map((it) => {
          const noChange = it.dDia === 0 && it.dLen === 0;
          if (noChange) return null;
          return (
            <li
              key={it.key}
              className="rounded border border-border/60 bg-bg/40 px-2 py-1"
            >
              <div className="flex items-center gap-2 text-[11px]">
                <span className={`inline-block h-2.5 w-1 rounded-sm ${it.swatch}`} aria-hidden />
                <span className="truncate font-medium">{it.name}</span>
                {it.locked && (
                  <span className="ml-auto rounded bg-warn/20 px-1.5 py-0.5 text-[9px] uppercase tracking-wider text-warn">
                    locked
                  </span>
                )}
              </div>
              <div className="mt-0.5 grid grid-cols-2 gap-x-2 text-[10px] text-muted">
                {it.recDia !== undefined && (
                  <div className="flex items-center gap-1">
                    <span>Ø</span>
                    <span className="num text-muted">{it.currentDia}</span>
                    <span className="text-info">→</span>
                    <span className="num text-fg">{it.recDia.toFixed(1)}</span>
                    <DeltaTag delta={it.dDia} unit="mm" />
                  </div>
                )}
                {it.recLen !== undefined && (
                  <div className="flex items-center gap-1">
                    <span>L</span>
                    <span className="num text-muted">{it.currentLen}</span>
                    <span className="text-info">→</span>
                    <span className="num text-fg">{it.recLen}</span>
                    <DeltaTag delta={it.dLen} unit="mm" />
                  </div>
                )}
              </div>
            </li>
          );
        })}
        {items.every((it) => it.dDia === 0 && it.dLen === 0) && (
          <li className="px-2 py-1 text-[10px] text-muted">
            No changes — current dimensions already balance to within {sigmaPct.toFixed(2)}%.
          </li>
        )}
      </ul>

      <div className="mt-2 flex gap-1.5">
        <button
          type="button"
          onClick={onApply}
          className="rounded-md border border-accent/60 bg-accent/20 px-2 py-1 text-[11px] font-semibold text-accent hover:bg-accent/30"
        >
          Apply
        </button>
        <button
          type="button"
          onClick={onReset}
          className="rounded-md border border-border bg-bg/60 px-2 py-1 text-[11px] text-muted hover:text-fg"
        >
          Discard
        </button>
      </div>
    </div>
  );
}

function DeltaTag({ delta, unit }: { delta: number; unit: string }) {
  if (Math.abs(delta) < 0.05) return null;
  const sign = delta > 0 ? '+' : '';
  const cls = delta > 0 ? 'text-warn' : 'text-info';
  return (
    <span className={`num ml-0.5 text-[10px] ${cls}`}>
      ({sign}{delta.toFixed(1)} {unit})
    </span>
  );
}

function PerCavityFillTable({
  analysis, balanceKind,
}: {
  analysis: FillBalanceResult;
  balanceKind: 'Natural' | 'Artificial' | 'Unbalanced';
}) {
  const volEntries = [...analysis.perCavityVolumeMm3.values()].filter(Number.isFinite);
  const volMean = volEntries.length
    ? volEntries.reduce((a, b) => a + b, 0) / volEntries.length
    : 0;
  const volStd = volEntries.length
    ? Math.sqrt(
        volEntries.reduce((a, v) => a + (v - volMean) ** 2, 0) / volEntries.length,
      )
    : 0;
  const volRatioPct = volMean > 0 ? (volStd / volMean) * 100 : 0;

  const rows = [...analysis.perCavityFillTimeS.entries()]
    .map(([id, t]) => {
      const vol = analysis.perCavityVolumeMm3.get(id) ?? 0;
      return {
        id,
        t,
        vol,
        pathMm: analysis.perCavityPathLengthMm.get(id) ?? 0,
        dev: analysis.meanFillTimeS > 0 ? (t - analysis.meanFillTimeS) / analysis.meanFillTimeS : 0,
        volDev: volMean > 0 ? (vol - volMean) / volMean : 0,
      };
    })
    .sort((a, b) => a.id - b.id);
  const meanMs = analysis.meanFillTimeS * 1000;
  const ratioPct = analysis.imbalanceRatio * 100;

  // Bar normalisation: longest bar = 100% of the bar column, scaled by max
  // fill time among the cavities (so all bars are visible).
  const tMax = Math.max(...rows.map((r) => r.t).filter(Number.isFinite), analysis.meanFillTimeS, 1e-9);

  const fillTone = (absPct: number) => (absPct <= 5 ? 'ok' : absPct <= 10 ? 'warn' : 'bad');
  const toneTxt = (t: 'ok' | 'warn' | 'bad') =>
    t === 'ok' ? 'text-accent' : t === 'warn' ? 'text-warn' : 'text-danger';
  const toneFooter = (absPct: number) =>
    absPct < 2 ? 'text-accent' : absPct < 5 ? 'text-warn' : 'text-danger';

  return (
    <div className="rounded-md border border-border/60">
      <div className="grid grid-cols-[22px_32px_1fr_38px_50px_38px] items-center gap-x-1.5 border-b border-border/60 bg-bg/60 px-2 py-1.5 text-[10px] font-semibold uppercase tracking-wider text-muted">
        <span>Cav</span>
        <span className="text-right">L</span>
        <span>t fill (ms)</span>
        <span className="text-right">Δt%</span>
        <span className="text-right">Vol mm³</span>
        <span className="text-right">Δv%</span>
      </div>
      {rows.map((r) => {
        const ms = r.t * 1000;
        const pct = r.dev * 100;
        const volPct = r.volDev * 100;
        const tTone = fillTone(Math.abs(pct));
        const vTone = fillTone(Math.abs(volPct));
        const barCls =
          tTone === 'ok'   ? 'bg-accent/70' :
          tTone === 'warn' ? 'bg-warn/80' :
                              'bg-danger/80';
        const tTxtCls = toneTxt(tTone);
        const vTxtCls = toneTxt(vTone);
        const widthPct = Number.isFinite(r.t) ? Math.max(2, (r.t / tMax) * 100) : 100;
        return (
          <div
            key={r.id}
            className="grid grid-cols-[22px_32px_1fr_38px_50px_38px] items-center gap-x-1.5 border-b border-border/60 px-2 py-1 last:border-0 text-[11px]"
          >
            <span className="num text-muted">{r.id}</span>
            <span className="num text-right text-muted">{r.pathMm}</span>
            <div className="relative h-3.5 w-full rounded-sm bg-bg/60">
              <div
                className={`absolute inset-y-0 left-0 rounded-sm ${barCls}`}
                style={{ width: `${widthPct}%` }}
              />
              <span className={`absolute inset-0 flex items-center justify-end pr-1 num text-[10px] font-medium ${tTxtCls}`}>
                {Number.isFinite(ms) ? ms.toFixed(1) : '∞'}
              </span>
            </div>
            <span className={`num text-right ${tTxtCls}`}>
              {pct >= 0 ? '+' : ''}{pct.toFixed(1)}
            </span>
            <span className="num text-right text-muted">{r.vol}</span>
            <span className={`num text-right ${vTxtCls}`}>
              {volPct >= 0 ? '+' : ''}{volPct.toFixed(1)}
            </span>
          </div>
        );
      })}
      <div className="space-y-0.5 border-t border-border/60 bg-bg/40 px-2 py-1.5 text-[10px] text-muted">
        <div className="flex items-center justify-between">
          <span>
            Fill mean <span className="num text-fg">{meanMs.toFixed(1)} ms</span> · σ{' '}
            <span className={`num font-medium ${toneFooter(ratioPct)}`}>{ratioPct.toFixed(2)}%</span>
          </span>
          <span className="num">{rows.length} cav</span>
        </div>
        <div className="flex items-center justify-between">
          <span>
            Vol mean <span className="num text-fg">{Math.round(volMean)} mm³</span> · σ{' '}
            <span className={`num font-medium ${toneFooter(volRatioPct)}`}>{volRatioPct.toFixed(1)}%</span>
          </span>
          <span className="num">target σ &lt; 5%</span>
        </div>
      </div>
      {balanceKind === 'Natural' && ratioPct < 0.01 && (
        <p className="border-t border-border/60 px-2 py-1.5 text-[10px] text-muted">
          ℹ Natural-balance layout — every sprue→cavity path is geometrically
          identical, so fill time stays uniform regardless of Ø/L overrides.
          Switch to Fishbone or T-Runner to see the balancer adjust dimensions.
        </p>
      )}
      {balanceKind !== 'Natural' && volRatioPct >= 5 && ratioPct < 2 && (
        <p className="border-t border-border/60 px-2 py-1.5 text-[10px] text-muted">
          ⚠ Fill is balanced but runner volume is not. To equalise both, unlock
          all upstream sections (Main / Sub / Drop) so the solver can tune the
          full cascade — locking any level forces the imbalance into the rest.
        </p>
      )}
    </div>
  );
}

/** Shared grid template used by every row + the header so columns line up. */
const ROW_GRID = 'grid grid-cols-[1fr_56px_56px_36px_28px] gap-x-2';

const cellInputClass =
  'num w-full rounded-md border border-border bg-bg px-1.5 py-1 text-right text-[11px] text-fg ' +
  'transition-colors focus-visible:border-blue-500';

/**
 * Renders a single level. For asymmetric layouts where the level's edges
 * fall into multiple path-length classes the group renders a header row
 * (with mixed-value indicators) plus one indented row per class. The
 * header's expand toggle drills further into individual edges.
 */
function LevelRowGroup({
  row, classes, multiClass, expanded, onToggleExpanded,
  tree, diaEdgeOverrides, lenEdgeOverrides,
  onDiaLevel, onLenLevel, onDiaEdge, onLenEdge,
  recommendedDia, recommendedLen,
  highlighted, onToggleHighlight, onFocusLevel, onBlurLevel,
  locked, onToggleLock,
  onHoverSection, onHoverLeaveSection,
}: {
  row: { key: string; name: string; dia: number; len: number; count: number; totalLen: number; swatch: string };
  classes: EdgeClass[];
  multiClass: boolean;
  expanded: boolean;
  onToggleExpanded: () => void;
  tree: CalcResult['tree'];
  diaEdgeOverrides: Record<number, number>;
  lenEdgeOverrides: Record<number, number>;
  onDiaLevel: (v: number) => void;
  onLenLevel: (v: number) => void;
  onDiaEdge: (edgeId: number, v: number) => void;
  onLenEdge: (edgeId: number, v: number) => void;
  recommendedDia: number | undefined;
  recommendedLen: number | undefined;
  highlighted: boolean;
  onToggleHighlight: () => void;
  onFocusLevel: () => void;
  onBlurLevel: () => void;
  locked: boolean;
  onToggleLock: () => void;
  onHoverSection: (edgeIds: readonly number[]) => void;
  onHoverLeaveSection: () => void;
}) {
  // Build edge-id → edge map for quick lookups in the per-edge view.
  const edgesById = useMemo(() => {
    const m = new Map<number, typeof tree.edges[number]>();
    for (const e of tree.edges) m.set(e.id, e);
    return m;
  }, [tree.edges]);

  // For each class compute its representative Ø and L. If every edge in
  // the class shares the same value we display it as a clean number;
  // otherwise we show "mixed" — the user can drill into expanded mode.
  const classStats = classes.map((cls) => {
    const dias = cls.edgeIds.map((eid) =>
      diaEdgeOverrides[eid] ?? edgesById.get(eid)?.diaMm ?? 0,
    );
    const lens = cls.edgeIds.map((eid) =>
      lenEdgeOverrides[eid] ?? Math.round(edgesById.get(eid)?.lenMm ?? 0),
    );
    const dia = dias[0] ?? 0;
    const len = lens[0] ?? 0;
    const sameDia = dias.every((v) => v === dia);
    const sameLen = lens.every((v) => v === len);
    const total = lens.reduce((a, b) => a + b, 0);
    return { cls, dia, len, sameDia, sameLen, total };
  });

  // The single-class case keeps the original lean rendering.
  if (!multiClass) {
    return (
      <LevelRow
        row={row}
        onDia={onDiaLevel}
        onLen={onLenLevel}
        recommendedDia={recommendedDia}
        recommendedLen={recommendedLen}
        highlighted={highlighted}
        onToggleHighlight={onToggleHighlight}
        onFocusLevel={onFocusLevel}
        onBlurLevel={onBlurLevel}
        locked={locked}
        onToggleLock={onToggleLock}
      />
    );
  }

  // Multi-class: header row shows aggregated state and expand toggle.
  const allDia = classStats.map((c) => c.dia);
  const allLen = classStats.map((c) => c.len);
  const headerDia = allDia.every((v) => v === allDia[0]) ? allDia[0]! : null;
  const headerLen = allLen.every((v) => v === allLen[0]) ? allLen[0]! : null;
  const totalLen = classStats.reduce((a, c) => a + c.total, 0);

  return (
    <>
      {/* Header row — class-level summary + expand toggle. */}
      <div className={`${ROW_GRID} items-center border-b border-border/60 bg-bg/30 px-2 py-1.5 hover:bg-bg/40`}>
        <div className="flex min-w-0 items-center gap-1.5 text-[11px]">
          <span className={`inline-block h-3 w-1 shrink-0 rounded-sm ${row.swatch}`} aria-hidden />
          <LockToggle name={row.name} locked={locked} onClick={onToggleLock} />
          <button
            type="button"
            onClick={onToggleExpanded}
            className="text-[10px] leading-none text-muted hover:text-fg"
            aria-label={`${expanded ? 'Collapse' : 'Expand'} ${row.name} edges`}
            title={expanded ? 'Collapse to class view' : 'Expand to per-edge view'}
          >
            {expanded ? '▾' : '▸'}
          </button>
          <span className="truncate">{row.name}</span>
          <span
            className="ml-auto shrink-0 rounded bg-info/15 px-1 py-0.5 text-[9px] font-semibold text-info"
            title={`${classes.length} path-length classes`}
          >
            ×{classes.length}
          </span>
        </div>
        <span className="num text-right text-[11px] text-muted" title="Mixed across classes — see sub-rows">
          {headerDia !== null ? headerDia : '—'}
        </span>
        <span className="num text-right text-[11px] text-muted" title="Mixed across classes — see sub-rows">
          {headerLen !== null ? headerLen : '—'}
        </span>
        <span className="num text-right text-[11px] text-muted">{totalLen}</span>
        <div className="flex justify-center">
          <HighlightToggle name={row.name} highlighted={highlighted} onClick={onToggleHighlight} />
        </div>
      </div>

      {/* Class sub-rows — one per path-length class. */}
      {!expanded &&
        classStats.map(({ cls, dia, len, sameDia, sameLen, total }) => (
          <ClassSubRow
            key={cls.key}
            cls={cls}
            dia={dia}
            len={len}
            sameDia={sameDia}
            sameLen={sameLen}
            totalLen={total}
            onDia={(v) => {
              for (const eid of cls.edgeIds) onDiaEdge(eid, v);
            }}
            onLen={(v) => {
              // For depth ≥ 1 levels (Sub Runner / Branch Runner / …) every
              // section is a junction-to-cavity branch — physical length is
              // fixed by geometry, so editing one section's L applies to
              // every section in the level. Only depth 0 (Main spine) keeps
              // independent per-section lengths.
              if (cls.shareLength) {
                for (const otherCls of classes) {
                  for (const eid of otherCls.edgeIds) onLenEdge(eid, v);
                }
              } else {
                for (const eid of cls.edgeIds) onLenEdge(eid, v);
              }
            }}
            onFocusLevel={onFocusLevel}
            onBlurLevel={onBlurLevel}
            locked={locked}
            onHoverEnter={onHoverSection}
            onHoverLeave={onHoverLeaveSection}
          />
        ))}

      {/* Expanded per-edge rows. */}
      {expanded &&
        classes.flatMap((cls) =>
          cls.edgeIds.map((eid, idx) => {
            const edge = edgesById.get(eid);
            if (!edge) return null;
            const dia = diaEdgeOverrides[eid] ?? edge.diaMm;
            const len = lenEdgeOverrides[eid] ?? Math.round(edge.lenMm);
            return (
              <EdgeSubRow
                key={`edge-${eid}`}
                edgeId={eid}
                label={`${cls.label} · edge ${idx + 1}/${cls.count}`}
                dia={dia}
                len={len}
                lenShared={cls.shareLength}
                onDia={(v) => onDiaEdge(eid, v)}
                onLen={(v) => {
                  if (cls.shareLength) {
                    // Same shared-L rule as the class-level view — propagate
                    // the new L to every edge in this level.
                    for (const otherCls of classes) {
                      for (const otherEid of otherCls.edgeIds) onLenEdge(otherEid, v);
                    }
                  } else {
                    onLenEdge(eid, v);
                  }
                }}
                onFocusLevel={onFocusLevel}
                onBlurLevel={onBlurLevel}
                locked={locked}
              />
            );
          }),
        )}
    </>
  );
}

function ClassSubRow({
  cls, dia, len, sameDia, sameLen, totalLen,
  onDia, onLen, onFocusLevel, onBlurLevel, locked,
  onHoverEnter, onHoverLeave,
}: {
  cls: EdgeClass;
  dia: number;
  len: number;
  sameDia: boolean;
  sameLen: boolean;
  totalLen: number;
  onDia: (v: number) => void;
  onLen: (v: number) => void;
  onFocusLevel: () => void;
  onBlurLevel: () => void;
  locked: boolean;
  onHoverEnter: (edgeIds: readonly number[]) => void;
  onHoverLeave: () => void;
}) {
  const idDia = useId();
  const idLen = useId();
  const cls_ = locked ? 'opacity-60' : '';
  // Track focus on the row's inputs so onMouseLeave doesn't tear down the
  // 3D spotlight while the user is still typing into a section's cell.
  // Without this ref the user clicks Section 1's Ø, the spotlight appears,
  // their mouse drifts off the row mid-edit, the highlight disappears, and
  // they think the highlight is broken.
  const focusedRef = useRef(false);
  return (
    <div
      className={`${ROW_GRID} items-center border-b border-border/60 px-2 py-1 last:border-0 hover:bg-info/10 ${cls_}`}
      onMouseEnter={() => onHoverEnter(cls.edgeIds)}
      onMouseLeave={() => { if (!focusedRef.current) onHoverLeave(); }}
      onFocus={() => { focusedRef.current = true; onHoverEnter(cls.edgeIds); }}
      onBlur={(e) => {
        // React focus events bubble — this fires when ANY child input loses
        // focus. Only treat it as "row blur" when focus is moving outside
        // the row (relatedTarget not contained), so tabbing between this
        // row's two inputs keeps the spotlight pinned.
        if (!e.currentTarget.contains(e.relatedTarget as Node)) {
          focusedRef.current = false;
          onHoverLeave();
        }
      }}
    >
      <div
        className="flex min-w-0 items-center gap-1 pl-3 text-[11px] text-muted"
        title={
          `${cls.label} — ${cls.count} segment${cls.count === 1 ? '' : 's'}, ` +
          `each ${cls.segmentLenMm} mm long. Click a cell or hover the row to spotlight in 3D.`
        }
      >
        <span className="truncate text-fg/90">{cls.label}</span>
        <span className="shrink-0 text-[10px] text-muted/70">{cls.segmentLenMm}mm</span>
        <span className="shrink-0 text-[10px] text-muted/70">×{cls.count}</span>
      </div>
      <label htmlFor={idDia} className="sr-only">{`${cls.label} diameter mm`}</label>
      <input
        id={idDia}
        type="number"
        className={cellInputClass + (sameDia ? '' : ' border-warn/60')}
        value={dia}
        min={0}
        step={0.5}
        onChange={(e) => onDia(parseFloat(e.target.value) || 0)}
        onFocus={onFocusLevel}
        onBlur={onBlurLevel}
        title={sameDia ? undefined : 'Edges in this class differ — expand to see individual values'}
        disabled={locked}
      />
      <label htmlFor={idLen} className="sr-only">{`${cls.label} length mm`}</label>
      <input
        id={idLen}
        type="number"
        className={
          cellInputClass +
          (sameLen ? '' : ' border-warn/60') +
          (cls.shareLength ? ' bg-info/5' : '')
        }
        value={len}
        min={0}
        step={1}
        onChange={(e) => onLen(parseFloat(e.target.value) || 0)}
        onFocus={onFocusLevel}
        onBlur={onBlurLevel}
        title={
          !sameLen
            ? 'Edges in this class differ — expand to see individual values'
            : cls.shareLength
              ? 'Length shared across every section in this level — editing here updates them all.'
              : undefined
        }
        disabled={locked}
      />
      <span className="num text-right text-[11px] text-muted">{totalLen}</span>
      <div />
    </div>
  );
}

function EdgeSubRow({
  edgeId, label, dia, len, lenShared = false,
  onDia, onLen, onFocusLevel, onBlurLevel, locked,
}: {
  edgeId: number;
  label: string;
  dia: number;
  len: number;
  lenShared?: boolean;
  onDia: (v: number) => void;
  onLen: (v: number) => void;
  onFocusLevel: () => void;
  onBlurLevel: () => void;
  locked: boolean;
}) {
  const idDia = useId();
  const idLen = useId();
  return (
    <div className={`${ROW_GRID} items-center border-b border-border/60 bg-bg/20 px-2 py-1 last:border-0 hover:bg-bg/30 ${locked ? 'opacity-60' : ''}`}>
      <div className="flex min-w-0 items-center gap-1 pl-5 text-[10px] text-muted">
        <span className="truncate" title={label}>{label}</span>
      </div>
      <label htmlFor={idDia} className="sr-only">{`Edge ${edgeId} diameter mm`}</label>
      <input
        id={idDia}
        type="number"
        className={cellInputClass}
        value={dia}
        min={0}
        step={0.5}
        onChange={(e) => onDia(parseFloat(e.target.value) || 0)}
        onFocus={onFocusLevel}
        onBlur={onBlurLevel}
        disabled={locked}
      />
      <label htmlFor={idLen} className="sr-only">{`Edge ${edgeId} length mm`}</label>
      <input
        id={idLen}
        type="number"
        className={cellInputClass + (lenShared ? ' bg-info/5' : '')}
        value={len}
        min={0}
        step={1}
        onChange={(e) => onLen(parseFloat(e.target.value) || 0)}
        onFocus={onFocusLevel}
        onBlur={onBlurLevel}
        disabled={locked}
        title={lenShared ? 'Length shared across this level — editing here updates every section.' : undefined}
      />
      <span className="num text-right text-[10px] text-muted">{Math.round(len)}</span>
      <div />
    </div>
  );
}

function LevelRow({
  row, onDia, onLen,
  recommendedDia, recommendedLen,
  highlighted, onToggleHighlight, onFocusLevel, onBlurLevel,
  locked, onToggleLock,
}: {
  row: { key: string; name: string; dia: number; len: number; count: number; totalLen: number; swatch: string };
  onDia: (v: number) => void;
  onLen: (v: number) => void;
  recommendedDia: number | undefined;
  recommendedLen: number | undefined;
  highlighted: boolean;
  onToggleHighlight: () => void;
  onFocusLevel: () => void;
  onBlurLevel: () => void;
  locked: boolean;
  onToggleLock: () => void;
}) {
  const idDia = useId();
  const idLen = useId();
  const showDiaHint = recommendedDia !== undefined && Math.abs(recommendedDia - row.dia) >= 0.5;
  const showLenHint = recommendedLen !== undefined && Math.abs(recommendedLen - row.len) >= 1;
  return (
    <div className={`${ROW_GRID} items-center border-b border-border/60 px-2 py-1.5 last:border-0 hover:bg-bg/40`}>
      <div className="flex min-w-0 items-center gap-1.5 text-[11px]">
        <span className={`inline-block h-3 w-1 shrink-0 rounded-sm ${row.swatch}`} aria-hidden />
        <LockToggle name={row.name} locked={locked} onClick={onToggleLock} />
        <span className="truncate">{row.name}</span>
      </div>
      <label htmlFor={idDia} className="sr-only">{`${row.name} diameter mm`}</label>
      <input
        id={idDia}
        type="number"
        className={cellInputClass}
        value={row.dia}
        min={0}
        step={0.5}
        onChange={(e) => onDia(parseFloat(e.target.value) || 0)}
        onFocus={onFocusLevel}
        onBlur={onBlurLevel}
      />
      <label htmlFor={idLen} className="sr-only">{`${row.name} length mm`}</label>
      <input
        id={idLen}
        type="number"
        className={cellInputClass}
        value={row.len}
        min={0}
        step={1}
        onChange={(e) => onLen(parseFloat(e.target.value) || 0)}
        onFocus={onFocusLevel}
        onBlur={onBlurLevel}
      />
      <span
        className="num text-right text-[11px] text-muted"
        title={`${row.count} edge${row.count === 1 ? '' : 's'} × ${row.len} mm`}
      >
        {row.totalLen}
      </span>
      <div className="flex justify-center">
        <HighlightToggle name={row.name} highlighted={highlighted} onClick={onToggleHighlight} />
      </div>

      {(showDiaHint || showLenHint) && (
        <div className={`${ROW_GRID} col-span-5 mt-0.5`}>
          <span /> {/* spacer for name column */}
          <RecHint show={showDiaHint} value={recommendedDia} />
          <RecHint show={showLenHint} value={recommendedLen} />
          <span /> {/* spacer for total */}
          <span /> {/* spacer for eye */}
        </div>
      )}
    </div>
  );
}

function RecHint({ show, value }: { show: boolean; value: number | undefined }) {
  if (!show || value === undefined) return <span aria-hidden />;
  return (
    <span
      className="num block text-right text-[9px] leading-none text-info"
      title={`Recommended: ${value} mm`}
    >
      → {value}
    </span>
  );
}

function ExtraRow({
  swatch, name, count,
  defaultDia, defaultLen, diaOverride, lenOverride,
  onDia, onLen,
  highlighted, onToggleHighlight, onFocusLevel, onBlurLevel,
}: {
  swatch: string;
  name: string;
  levelKey: string;
  count: number;
  defaultDia: number;
  defaultLen: number;
  diaOverride: number | undefined;
  lenOverride: number | undefined;
  onDia: (v: number) => void;
  onLen: (v: number) => void;
  highlighted: boolean;
  onToggleHighlight: () => void;
  onFocusLevel: () => void;
  onBlurLevel: () => void;
}) {
  const idDia = useId();
  const idLen = useId();
  const dia = diaOverride ?? defaultDia;
  const len = lenOverride ?? defaultLen;
  const total = len * count;
  return (
    <div className={`${ROW_GRID} items-center border-b border-border/60 px-2 py-1.5 last:border-0 hover:bg-bg/40`}>
      <div className="flex min-w-0 items-center gap-1.5 text-[11px]">
        <span className={`inline-block h-3 w-1 shrink-0 rounded-sm ${swatch}`} aria-hidden />
        {/* Empty placeholder so the level name lines up with LevelRow names. */}
        <span className="inline-block h-3.5 w-3.5 shrink-0" aria-hidden />
        <span className="truncate">{name}</span>
      </div>
      <label htmlFor={idDia} className="sr-only">{`${name} diameter mm`}</label>
      <input
        id={idDia}
        type="number"
        className={cellInputClass}
        value={dia}
        min={0}
        step={0.5}
        onChange={(e) => onDia(parseFloat(e.target.value) || 0)}
        onFocus={onFocusLevel}
        onBlur={onBlurLevel}
      />
      <label htmlFor={idLen} className="sr-only">{`${name} length mm`}</label>
      <input
        id={idLen}
        type="number"
        className={cellInputClass}
        value={len}
        min={0}
        step={1}
        onChange={(e) => onLen(parseFloat(e.target.value) || 0)}
        onFocus={onFocusLevel}
        onBlur={onBlurLevel}
      />
      <span
        className="num text-right text-[11px] text-muted"
        title={`${count} edge${count === 1 ? '' : 's'} × ${len} mm`}
      >
        {total}
      </span>
      <div className="flex justify-center">
        <HighlightToggle name={name} highlighted={highlighted} onClick={onToggleHighlight} />
      </div>
    </div>
  );
}

function HighlightToggle({
  name, highlighted, onClick,
}: {
  name: string; highlighted: boolean; onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={`${highlighted ? 'Stop highlighting' : 'Highlight'} ${name} in viewer`}
      aria-pressed={highlighted}
      title={highlighted ? `Hide highlight: ${name}` : `Highlight ${name} in viewer`}
      className={
        'inline-flex h-5 w-5 items-center justify-center rounded transition-colors ' +
        (highlighted
          ? 'text-amber-400 hover:text-amber-300'
          : 'text-muted hover:text-fg')
      }
    >
      {highlighted ? <EyeIconSolid /> : <EyeIconOutline />}
    </button>
  );
}

function LockToggle({
  name, locked, onClick,
}: {
  name: string; locked: boolean; onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={`${locked ? 'Unlock' : 'Lock'} ${name} for auto-balance`}
      aria-pressed={locked}
      title={
        locked
          ? `${name} locked — auto-balance won't change Ø or L`
          : `Lock ${name} so auto-balance preserves its Ø and L`
      }
      className={
        'inline-flex h-3.5 w-3.5 items-center justify-center rounded transition-colors ' +
        (locked
          ? 'text-amber-400 hover:text-amber-300'
          : 'text-muted/70 hover:text-fg')
      }
    >
      {locked ? <LockIconSolid /> : <LockIconOutline />}
    </button>
  );
}

function LockIconOutline() {
  return (
    <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor"
      strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <rect x="5" y="11" width="14" height="10" rx="2" />
      <path d="M8 11V7a4 4 0 0 1 8 0v4" />
    </svg>
  );
}

function LockIconSolid() {
  return (
    <svg width="10" height="10" viewBox="0 0 24 24" fill="currentColor" aria-hidden>
      <path d="M16 8V7a4 4 0 0 0-8 0v1H6a1 1 0 0 0-1 1v12a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1V9a1 1 0 0 0-1-1h-2zm-6-1a2 2 0 1 1 4 0v1h-4V7z" />
    </svg>
  );
}

function EyeIconOutline() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor"
      strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12z" />
      <circle cx="12" cy="12" r="3" />
    </svg>
  );
}

function EyeIconSolid() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor" aria-hidden>
      <path d="M12 5C5.5 5 2 12 2 12s3.5 7 10 7 10-7 10-7-3.5-7-10-7zm0 11a4 4 0 1 1 0-8 4 4 0 0 1 0 8z" />
      <circle cx="12" cy="12" r="2.2" fill="#0F172A" />
    </svg>
  );
}

function colorForLevel(levelKey: string): string {
  const n = parseInt(levelKey.replace(/[^0-9]/g, ''), 10) || 0;
  return depthPalette[n % depthPalette.length]!;
}

/**
 * Convention used by the layout generators (and pipeline.ts:145):
 *   diaForDepth(base, d) = clamp(round_to_0.5(base · 0.85^d), 3, 13)
 *
 * The anchor for the suggestion is `lastDiaKey` — the level the user most
 * recently edited. Every other depth level (overridden or not) gets a
 * suggested value derived from the anchor's implied base. This way, after
 * the user applies one suggestion, editing the anchor again re-prompts to
 * adjust the remaining levels — instead of going silent because every level
 * is now overridden.
 *
 * `drop` and `sprue` are intentionally ignored — they don't follow the
 * depth-based scaling rule.
 */
function computeDiaTaperSuggestion(
  diaOverrides: Record<string, number>,
  levels: { levelKey: string; diaMm: number }[],
  lastDiaKey: string | null,
): { shouldPrompt: boolean; suggestions: Record<string, number> } {
  const depthRe = /^L(\d+)$/;

  // Pick the anchor: prefer the most recently edited key if it's a depth
  // level with a positive override; otherwise (e.g. on first load with a
  // single legacy override) fall back to the only depth override present.
  let anchor: { key: string; depth: number; dia: number } | null = null;
  if (lastDiaKey) {
    const m = depthRe.exec(lastDiaKey);
    const v = diaOverrides[lastDiaKey];
    if (m && v !== undefined && v > 0) {
      anchor = { key: lastDiaKey, depth: parseInt(m[1]!, 10), dia: v };
    }
  }
  if (!anchor) {
    const depthOverrides = Object.entries(diaOverrides).filter(([k, v]) => {
      return depthRe.test(k) && v > 0;
    });
    if (depthOverrides.length === 1) {
      const [k, v] = depthOverrides[0]!;
      const m = depthRe.exec(k)!;
      anchor = { key: k, depth: parseInt(m[1]!, 10), dia: v };
    }
  }
  if (!anchor) return { shouldPrompt: false, suggestions: {} };

  const impliedBase = anchor.dia / Math.pow(0.85, anchor.depth);
  const round = (d: number) => Math.max(3, Math.min(13, Math.round(d * 2) / 2));

  const suggestions: Record<string, number> = {};
  let mismatch = false;
  for (const lvl of levels) {
    if (lvl.levelKey === anchor.key) continue;
    const m = depthRe.exec(lvl.levelKey);
    if (!m) continue;
    const depth = parseInt(m[1]!, 10);
    const expected = round(impliedBase * Math.pow(0.85, depth));
    const current = diaOverrides[lvl.levelKey] ?? lvl.diaMm;
    if (Math.abs(expected - current) >= 0.5) {
      suggestions[lvl.levelKey] = expected;
      mismatch = true;
    }
  }
  return { shouldPrompt: mismatch, suggestions };
}

function BalanceToolbar({
  balance, fillSigma, tone,
  hasLenOverrides, onResetLen,
  onAutoBalance, balanceBusy, balanceMsg,
  tightCount, hardOverlapCount, taperOff,
  fixDisabled, fixUnsolvable, onFix,
  edgeTuned, onClearEdgeTuning,
  balanceMode, onBalanceModeChange,
}: {
  balance: DetailedBalance;
  fillSigma: number;
  tone: 'ok' | 'warn' | 'bad';
  hasLenOverrides: boolean;
  onResetLen: () => void;
  onAutoBalance: () => void;
  balanceBusy: boolean;
  balanceMsg: string | null;
  tightCount: number;
  hardOverlapCount: number;
  taperOff: boolean;
  fixDisabled: boolean;
  fixUnsolvable: boolean;
  onFix: () => void;
  edgeTuned: boolean;
  onClearEdgeTuning: () => void;
  balanceMode: BalanceMode;
  onBalanceModeChange: (m: BalanceMode) => void;
}) {
  // Combine the existing 3-axis worst with the new fill-time σ to drive the
  // "max σ" indicator — fill-time variance is what the user is balancing
  // toward, so it has to participate in the colour decision.
  const worstRatio = Math.max(balance.maxRatio, fillSigma);
  const recomputedTone: 'ok' | 'warn' | 'bad' =
    worstRatio <= 0.05 ? 'ok' :
    worstRatio <= 0.10 ? 'warn' :
    'bad';
  const effectiveTone = recomputedTone === 'ok' && tone !== 'ok' ? tone : recomputedTone;
  const toneText =
    effectiveTone === 'ok'   ? 'text-accent' :
    effectiveTone === 'warn' ? 'text-warn' :
                                'text-danger';
  const toneBar =
    effectiveTone === 'ok'   ? 'bg-accent' :
    effectiveTone === 'warn' ? 'bg-warn' :
                                'bg-danger';
  const maxPct = worstRatio * 100;
  const fillPct = Math.max(0, Math.min(100, 100 - maxPct));

  let status: { text: string; cls: string };
  if (hardOverlapCount > 0) {
    status = {
      text: `${hardOverlapCount} cavity overlap${hardOverlapCount === 1 ? '' : 's'}`,
      cls: 'text-danger',
    };
  } else if (tightCount > 0) {
    status = {
      text: `${tightCount} cavity pair${tightCount === 1 ? '' : 's'} < ${CAVITY_MIN_GAP_MM} mm`,
      cls: 'text-warn',
    };
  } else if (taperOff) {
    status = { text: 'Diameter taper off', cls: 'text-info' };
  } else if (tone !== 'ok') {
    status = { text: 'Flow unbalanced — see metrics', cls: 'text-warn' };
  } else {
    status = { text: 'Cavities clear · flow balanced', cls: 'text-muted' };
  }

  return (
    <div className="mt-2 rounded-md border border-border/60 bg-bg/40 px-2.5 py-2">
      <div className="flex items-center gap-2 text-[10px] font-semibold uppercase tracking-wider text-muted">
        <span>Balance</span>
        {edgeTuned && (
          <button
            type="button"
            onClick={onClearEdgeTuning}
            className="rounded border border-info/60 bg-info/15 px-1.5 py-0.5 text-[9px] font-semibold text-info hover:bg-info/25"
            title="Clear per-edge Ø tuning and revert to per-level diameters."
          >
            Edge-tuned ✕
          </button>
        )}
        <span className={`ml-auto num text-[11px] ${toneText}`}>
          {tone === 'ok' ? 'Balanced' : 'Unbalanced'} · {maxPct.toFixed(1)}% max σ
        </span>
      </div>
      <div className="mt-1.5 h-1.5 w-full overflow-hidden rounded-full bg-bg">
        <div
          role="progressbar"
          aria-valuenow={Math.round(fillPct)}
          aria-valuemin={0}
          aria-valuemax={100}
          aria-label="Runner balance level"
          className={`h-full transition-[width] ${toneBar}`}
          style={{ width: `${fillPct}%` }}
        />
      </div>
      <dl
        className="mt-2 grid grid-cols-4 gap-1.5 text-[10px]"
        title="σ / mean across every sprue → cavity path"
      >
        <BalanceMetric label="L/D σ"  pct={balance.lOverDRatio   * 100} />
        <BalanceMetric label="ΔP σ"   pct={balance.pressureRatio * 100} />
        <BalanceMetric label="Vol σ"  pct={balance.volumeRatio   * 100} />
        <BalanceMetric label="Fill σ" pct={fillSigma             * 100} prod />
      </dl>
      <BalanceModeToggle value={balanceMode} onChange={onBalanceModeChange} />
      <div className="mt-2 flex items-center justify-between gap-2">
        <span className={`text-[10px] ${status.cls}`}>{status.text}</span>
        <div className="flex gap-1.5">
          <button
            type="button"
            onClick={onFix}
            disabled={fixDisabled}
            className="rounded-md border border-info/60 bg-info/15 px-2 py-1 text-[11px] font-semibold text-info hover:bg-info/25 disabled:cursor-not-allowed disabled:opacity-40"
            title={
              fixDisabled
                ? 'No recommended changes — every row matches the targets.'
                : fixUnsolvable
                  ? 'Cavity overlap can\'t be cleared automatically — reduce the overridden length or part size.'
                  : 'Apply all recommended Ø and L values shown beside each input.'
            }
          >
            Fix
          </button>
          <button
            type="button"
            onClick={onAutoBalance}
            disabled={balanceBusy}
            className="rounded-md border border-accent/60 bg-accent/20 px-2 py-1 text-[11px] font-semibold text-accent hover:bg-accent/30 disabled:cursor-not-allowed disabled:opacity-40"
            title="Solve for diameters (and lengths if needed) that minimise per-cavity fill-time σ. Locked rows stay fixed."
          >
            {balanceBusy ? 'Solving…' : 'Balance'}
          </button>
          <button
            type="button"
            onClick={onResetLen}
            disabled={!hasLenOverrides}
            className="rounded-md border border-border bg-bg/60 px-2 py-1 text-[11px] text-muted hover:text-fg disabled:cursor-not-allowed disabled:opacity-40"
            title={hasLenOverrides ? 'Clear all length overrides' : 'No length overrides to clear'}
          >
            Reset L
          </button>
        </div>
      </div>
      {balanceMsg && (
        <p className="mt-1.5 text-[10px] text-muted">{balanceMsg}</p>
      )}
    </div>
  );
}

/**
 * Three-way toggle that picks the balancer's objective:
 *   Fill  — minimise fill-time σ only (drops absorb the asymmetry)
 *   Both  — equal weight on fill σ and runner-volume σ
 *   Vol   — push runner-volume σ down aggressively, allow fill σ to drift
 */
function BalanceModeToggle({
  value, onChange,
}: { value: BalanceMode; onChange: (m: BalanceMode) => void }) {
  const opts: { id: BalanceMode; label: string; title: string }[] = [
    { id: 'fill',   label: 'Fill',   title: 'Minimise fill-time σ only — fastest, leaves runner volume uneven on chain layouts' },
    { id: 'both',   label: 'Both',   title: 'Balance fill AND runner volume — recommended for chain Fishbone / Inline / T-Runner' },
    { id: 'volume', label: 'Volume', title: 'Push runner volume σ down hard — fill σ may drift up to ~2 %' },
  ];
  return (
    <div className="mt-2 flex items-center gap-2">
      <span className="text-[10px] uppercase tracking-wider text-muted">Solver target</span>
      <div role="radiogroup" aria-label="Balance solver target" className="flex flex-1 overflow-hidden rounded-md border border-border/60">
        {opts.map((o) => {
          const active = value === o.id;
          return (
            <button
              key={o.id}
              type="button"
              role="radio"
              aria-checked={active}
              onClick={() => onChange(o.id)}
              title={o.title}
              className={
                'flex-1 px-1.5 py-1 text-[10px] font-semibold transition-colors ' +
                (active
                  ? 'bg-accent/25 text-accent'
                  : 'bg-bg/40 text-muted hover:text-fg hover:bg-bg/70')
              }
            >
              {o.label}
            </button>
          );
        })}
      </div>
    </div>
  );
}

function BalanceMetric({
  label, pct, prod = false,
}: { label: string; pct: number; prod?: boolean }) {
  // `prod` chips use the tighter Beaumont 5%/10% thresholds since fill-time
  // imbalance is what gets you short-shots in production. The other three
  // axes use the looser 10%/20% rule of thumb.
  const okT  = prod ?  5 : 10;
  const warnT = prod ? 10 : 20;
  const cls =
    pct <= okT   ? 'text-accent' :
    pct <= warnT ? 'text-warn' :
                   'text-danger';
  return (
    <div className="flex flex-col items-center rounded border border-border/60 bg-bg/60 py-1">
      <dt className="text-[9px] uppercase tracking-wider text-muted">{label}</dt>
      <dd className={`num text-[11px] ${cls}`}>{pct.toFixed(1)}%</dd>
    </div>
  );
}

interface DetailedBalance {
  lOverDRatio: number;   // σ(L/D)   / mean(L/D)   — Beaumont 2007
  pressureRatio: number; // σ(ΔP)    / mean(ΔP)    — Hagen-Poiseuille
  volumeRatio: number;   // σ(V)     / mean(V)     — flow distribution
  maxRatio: number;      // worst of the three
}

/**
 * Three-axis balance score for the runner network. Each metric is the
 * coefficient of variation (σ/μ) across all sprue → cavity paths:
 *
 *   • L/D — Beaumont 2007's rule of thumb; ≥10% is unbalanced.
 *   • ΔP  — Hagen-Poiseuille pressure drop along each path; flagged when
 *           paths see noticeably different pressure (cavities under-/over-pack).
 *   • Vol — Total runner volume per path; lopsided distribution implies
 *           uneven flow share even before pressure is considered.
 *
 * H-Bridge and other naturally balanced layouts return all three at ~0%.
 * Asymmetric layouts (Fishbone, T-runner) and aggressive overrides push
 * them up. The toolbar surfaces all three so the user can see WHICH aspect
 * of the system is out of whack.
 */
function computeDetailedBalance(calc: CalcResult): DetailedBalance {
  const lod = calc.balance.imbalanceRatio;

  const sprue = calc.tree.nodes.find((n) => n.kind === 'sprue');
  const parentEdgeOf = new Map<number, { parentNodeId: number; id: number; lenMm: number; diaMm: number }>();
  for (const e of calc.tree.edges) parentEdgeOf.set(e.childNodeId, e);

  const dpPerEdge = calc.runner.pressureDrop.perEdgeMPa;
  const pathDp: number[] = [];
  const pathVol: number[] = [];

  if (sprue) {
    for (const cav of calc.tree.cavities) {
      const cavNode = calc.tree.nodes.find((n) => n.cavityId === cav.id && n.kind === 'cavity');
      if (!cavNode) continue;
      let sumDp = 0;
      let sumVol = 0;
      let cur: number | undefined = cavNode.id;
      while (cur !== undefined && cur !== sprue.id) {
        const e = parentEdgeOf.get(cur);
        if (!e) break;
        sumDp += dpPerEdge.get(e.id) ?? 0;
        const r = e.diaMm / 2;
        sumVol += Math.PI * r * r * e.lenMm;
        cur = e.parentNodeId;
      }
      pathDp.push(sumDp);
      pathVol.push(sumVol);
    }
  }

  const cv = (xs: number[]): number => {
    if (xs.length < 2) return 0;
    const mean = xs.reduce((a, b) => a + b, 0) / xs.length;
    if (mean <= 0) return 0;
    const variance = xs.reduce((a, x) => a + (x - mean) ** 2, 0) / xs.length;
    return Math.sqrt(variance) / mean;
  };

  const dp = cv(pathDp);
  const vol = cv(pathVol);
  return {
    lOverDRatio: lod,
    pressureRatio: dp,
    volumeRatio: vol,
    maxRatio: Math.max(lod, dp, vol),
  };
}

/**
 * Total volumetric flow (Q_tot) used by the fill-time and balance solvers.
 * Mirrors what pipeline.ts assumes: 1-second nominal fill time over the
 * gross shot volume (cavities + sprue). Returning a stable value here means
 * fill-time σ depends only on the flow split, not the assumed nominal time.
 */
function computeTotalQ(calc: CalcResult): number {
  const cavVol = calc.input.part.volumeMm3 * calc.input.cavities;
  const sprueVol = calc.sprue?.volumeMm3 ?? 0;
  const assumedFillTimeS = 1;
  return (cavVol + sprueVol) / Math.max(0.1, assumedFillTimeS);
}

/**
 * Per-cavity fill-time analysis for the *current* calc state. Computes the
 * material viscosity at the mean melt temperature, then runs the Hagen-
 * Poiseuille resistance-based flow split through the runner network. The
 * resulting σ feeds the toolbar's Fill chip and the heatmap colouring.
 */
function analyseFillTimes(calc: CalcResult): FillBalanceResult {
  const material = calc.input.material;
  const processingTempK = ((material.tMeltMin + material.tMeltMax) / 2) + 273.15;
  const eta = apparentViscosity(material, 1000, processingTempK);
  return computeFillBalance({
    tree: calc.tree,
    viscosityPaS: eta,
    totalFlowMm3PerS: computeTotalQ(calc),
    powerLawN: material.powerLaw?.n,
    cavityVolumeMm3: calc.input.part.volumeMm3,
  });
}

interface AutoFitInputs {
  part: {
    weightG: number;
    volumeMm3: number;
    wallThicknessMm: number;
    projectedAreaMm2: number;
    dimsMm: { w: number; d: number; h: number };
  };
  cavities: number;
  gatesPerCavity: 1 | 2;
  layoutId: LayoutId;
  profile: RunnerProfile;
  hotRunner: boolean;
  materialId: string;
  machine: {
    nozzleDiaMm: number;
    injectionPressureBar: number;
    clampForceTonne: number;
    sprueLengthMm: number;
  };
  diaOverrides: Record<string, number>;
  lenOverrides: Record<string, number>;
}

/**
 * Searches for the smallest uniform scale factor s ≥ 1 to apply to the
 * non-overridden runner-level lengths such that calc.overlaps becomes empty.
 * Preserves user-overridden lengths untouched. Returns the new lenOverrides
 * to dispatch, or null if no scale up to 5× resolved the collisions.
 */
function computeAutoFitOverrides(s: AutoFitInputs): Record<string, number> | null {
  const material = findMaterial(s.materialId) ?? MATERIAL_SEED[0]!;
  const baseInput = {
    part: s.part,
    cavities: s.cavities,
    gatesPerCavity: s.gatesPerCavity,
    layoutId: s.layoutId,
    profile: s.profile,
    hotRunner: s.hotRunner,
    material,
    machine: s.machine,
    overrides: { diaByLevel: s.diaOverrides, lenByLevel: s.lenOverrides },
  };

  const baseCalc = runCalculations(baseInput);
  // Even when calc reports no overlaps, the cavities may be closer than
  // CAVITY_MIN_GAP_MM. Inflate the cavity AABB by the padding when checking
  // so "no inflated overlap" ⇒ at least CAVITY_MIN_GAP_MM clearance everywhere.
  const padW = s.part.dimsMm.w + CAVITY_MIN_GAP_MM * 2;
  const padD = s.part.dimsMm.d + CAVITY_MIN_GAP_MM * 2;
  if (detectCavityOverlaps(baseCalc.tree.cavities, padW, padD).length === 0) {
    return s.lenOverrides;
  }

  // Per-edge default length for every level the user has NOT overridden.
  const defaultPerEdgeLen = new Map<string, number>();
  for (const lvl of baseCalc.runner.levels) {
    if (s.lenOverrides[lvl.levelKey] === undefined) {
      const perEdge = lvl.lengthMm / Math.max(1, lvl.count);
      if (perEdge > 0) defaultPerEdgeLen.set(lvl.levelKey, perEdge);
    }
  }
  if (defaultPerEdgeLen.size === 0) return null;

  for (let scale = 1.05; scale <= 5.001; scale += 0.05) {
    const trial: Record<string, number> = { ...s.lenOverrides };
    for (const [key, baseLen] of defaultPerEdgeLen) {
      trial[key] = Math.round(baseLen * scale);
    }
    const test = runCalculations({
      ...baseInput,
      overrides: { diaByLevel: s.diaOverrides, lenByLevel: trial },
    });
    if (detectCavityOverlaps(test.tree.cavities, padW, padD).length === 0) {
      return trial;
    }
  }
  return null;
}

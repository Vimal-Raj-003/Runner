'use client';

import { useEffect, useMemo, useRef } from 'react';
import * as THREE from 'three';
import {
  apparentViscosity,
  computeFillBalance,
  type CalcResult,
} from '@runner/core';
import { buildSceneFromCalc, type HeatmapData, type RunnerMeshMeta } from './buildScene';
import { createAxisScene } from './axisTriad';
import { PRESETS } from './presets';
import { useWorkspace } from '@/state/store';

export interface Viewer3DHandle {
  setView(preset: keyof typeof PRESETS): void;
  fit(): void;
  reset(): void;
  /**
   * Enter "set spin centre" mode. The next pointer-down on the canvas
   * raycasts the scene; the hit point becomes the camera's rotation
   * pivot (lookAt target). Subsequent orbit-drags pivot around it.
   * Mode auto-exits after the click — caller doesn't have to toggle off.
   */
  setSpinPickActive(active: boolean): void;
}

interface Viewer3DProps {
  calc: CalcResult;
  onHandleReady?: (h: Viewer3DHandle) => void;
}

interface ViewerState {
  renderer: THREE.WebGLRenderer | null;
  mainCamera: THREE.PerspectiveCamera | null;
  axCamera: THREE.PerspectiveCamera | null;
  mainScene: THREE.Scene | null;
  axScene: THREE.Scene | null;
  runnerMeshes: THREE.Mesh[];
  /**
   * Cavity meshes — kept for future raycast features (e.g. clicking a
   * cavity to focus on it). The gate picker no longer uses this list;
   * picking happens in a dedicated single-part modal.
   */
  cavityMeshes: THREE.Mesh[];
  th: number;
  ph: number;
  dist: number;
  tx: number;
  ty: number;
  tz: number;
  af: number;
  drag: boolean;
  dx: number;
  dy: number;
  btn: number;
  raycaster: THREE.Raycaster;
  mouse: THREE.Vector2;
  hoveredKey: string | null;
  /** When true, the next pointer-down picks a new spin centre. */
  spinPickActive: boolean;
}

const GATE_MARKER_MAT = new THREE.MeshPhongMaterial({
  color: 0x22c55e,
  emissive: 0x064e3b,
  emissiveIntensity: 0.6,
  shininess: 90,
});

// Bright amber for click-to-highlight, deliberately distinct from the green
// hover material so the two interaction states read as different.
const SELECTED_MAT = new THREE.MeshPhongMaterial({
  color: 0xfbbf24,
  shininess: 110,
  specular: 0xfde68a,
  emissive: 0xb45309,
  emissiveIntensity: 0.55,
});

// Muted slate-grey applied to every non-selected runner so the focused
// part visually pops out of the network. Opacity is kept high enough that
// the surrounding context is still legible — just visually de-emphasised.
const DIMMED_MAT = new THREE.MeshPhongMaterial({
  color: 0x6b7280,
  shininess: 12,
  specular: 0x222222,
  transparent: true,
  opacity: 0.7,
});

function levelKeyMatches(meta: RunnerMeshMeta, key: string): boolean {
  // Sprue is conceptually one part — cone + base both light up together.
  if (key === 'sprue') return meta.levelKey === 'sprue' || meta.levelKey === 'sprue_base';
  return meta.levelKey === key;
}

/**
 * Highlight target — either a level (eye-pin) or a specific set of edges
 * (section-row hover). Edge-id targets win when both are supplied so the
 * panel hover always reflects the user's most recent intent.
 */
interface HighlightTarget {
  levelKey: string | null;
  edgeIds: ReadonlySet<number>;
}

function meshIsHighlighted(meta: RunnerMeshMeta, t: HighlightTarget): boolean {
  if (t.edgeIds.size > 0) {
    return meta.edgeId !== undefined && t.edgeIds.has(meta.edgeId);
  }
  return t.levelKey !== null && levelKeyMatches(meta, t.levelKey);
}

function applyHighlight(meshes: THREE.Mesh[], target: HighlightTarget): void {
  const active = target.edgeIds.size > 0 || target.levelKey !== null;
  for (const m of meshes) {
    const meta = m.userData as RunnerMeshMeta;
    if (!meta) continue;
    if (!active) {
      if (meta._origMat) m.material = meta._origMat;
      meta._selected = false;
      continue;
    }
    if (meshIsHighlighted(meta, target)) {
      m.material = SELECTED_MAT;
      meta._selected = true;
    } else {
      m.material = DIMMED_MAT;
      meta._selected = false;
    }
  }
}

export function Viewer3D({ calc, onHandleReady }: Viewer3DProps) {
  const mountRef = useRef<HTMLDivElement>(null);
  const tooltipRef = useRef<HTMLDivElement>(null);
  const labelsOverlayRef = useRef<HTMLDivElement>(null);
  const labelRefs = useRef<Map<number, HTMLDivElement | null>>(new Map());
  const stateRef = useRef<ViewerState>({
    renderer: null,
    mainCamera: null,
    axCamera: null,
    mainScene: null,
    axScene: null,
    runnerMeshes: [],
    cavityMeshes: [],
    th: 0.65,
    ph: 0.45,
    dist: 50,
    tx: 0,
    ty: 0,
    tz: 0,
    af: 0,
    drag: false,
    dx: 0,
    dy: 0,
    btn: 0,
    raycaster: new THREE.Raycaster(),
    mouse: new THREE.Vector2(),
    hoveredKey: null,
    spinPickActive: false,
  });

  const profile = useWorkspace((s) => s.profile);
  const hotRunner = useWorkspace((s) => s.hotRunner);
  const gatesPerCavity = useWorkspace((s) => s.gatesPerCavity);
  const showDims = useWorkspace((s) => s.view.showDims);
  const partW = useWorkspace((s) => s.part.dimsMm.w);
  const partD = useWorkspace((s) => s.part.dimsMm.d);
  const partH = useWorkspace((s) => s.part.dimsMm.h);
  const importedPart = useWorkspace((s) => s.importedPart);
  const gatePoint = useWorkspace((s) => s.gatePoint);
  const useGateDrop = useWorkspace((s) => s.useGateDrop);
  const partRotation = useWorkspace((s) => s.partRotation);
  const autoMirrorParts = useWorkspace((s) => s.autoMirrorParts);
  const cavityRotationOverrides = useWorkspace((s) => s.cavityRotationOverrides);
  const gateType = useWorkspace((s) => s.gateType);
  const demouldingDir = useWorkspace((s) => s.demouldingDir);
  // The gate picker now lives in a dedicated full-screen modal
  // (GatePickerModal) — much easier to click precisely on the part than
  // hunting for a tiny cavity instance in the multi-cavity layout. We
  // still render persistent gate markers here once the gate is set.
  const highlightedLevelKey = useWorkspace((s) => s.highlightedLevelKey);
  const focusedLevelKey = useWorkspace((s) => s.focusedLevelKey);
  const heatmapMode = useWorkspace((s) => s.heatmapMode);
  const highlightedEdgeIds = useWorkspace((s) => s.highlightedEdgeIds);
  // Focus on a panel input takes priority over the persistent eye-pin so
  // the row currently being edited always pops out, then reverts when blurred.
  const effectiveHighlightKey = focusedLevelKey ?? highlightedLevelKey;
  const effectiveHighlightTarget: HighlightTarget = useMemo(
    () => ({
      levelKey: highlightedEdgeIds.length > 0 ? null : effectiveHighlightKey,
      edgeIds: new Set(highlightedEdgeIds),
    }),
    [effectiveHighlightKey, highlightedEdgeIds],
  );

  // Heat-map data is computed only when the user has actually selected a
  // mode — `off` short-circuits all work to keep the default render path
  // free of solver overhead.
  const heatResult = useMemo(() => {
    if (heatmapMode === 'off') return null;
    const material = calc.input.material;
    const tempK = ((material.tMeltMin + material.tMeltMax) / 2) + 273.15;
    const eta = apparentViscosity(material, 1000, tempK);
    const cavVol = calc.input.part.volumeMm3;
    const sprueVol = calc.sprue?.volumeMm3 ?? 0;
    const totalQ = (cavVol * calc.input.cavities + sprueVol) / 1;
    const ft = computeFillBalance({
      tree: calc.tree,
      viscosityPaS: eta,
      totalFlowMm3PerS: totalQ,
      powerLawN: material.powerLaw?.n,
      cavityVolumeMm3: cavVol,
    });
    const data: HeatmapData = {};
    if (heatmapMode === 'fill' || heatmapMode === 'balance') {
      const out = new Map<number, number>();
      if (ft.meanFillTimeS > 0) {
        for (const [id, t] of ft.perCavityFillTimeS) {
          out.set(id, Number.isFinite(t) ? (t - ft.meanFillTimeS) / ft.meanFillTimeS : 1);
        }
      }
      data.fillDeviationByCavity = out;
    }
    if (heatmapMode === 'flow') {
      data.flowByEdge = ft.perEdgeFlowMm3PerS;
    }
    if (heatmapMode === 'pressure') {
      data.pressureByEdge = calc.runner.pressureDrop.perEdgeMPa;
    }
    if (heatmapMode === 'dia') {
      // Recommended Ø follows the Pye taper rule from the deepest non-zero
      // recommendation seed: D_main = base, D_sub = 0.85·base, etc.
      const ratios: Record<number, number> = { 0: 1, 1: 0.85, 2: 0.85 * 0.80, 3: 0.85 * 0.80 * 0.50 };
      const baseDia = calc.runner.recommendedDiaMm;
      const map = new Map<number, number>();
      for (const e of calc.tree.edges) {
        const m = /^L(\d+)$/.exec(e.levelKey);
        if (!m) continue;
        const r = ratios[parseInt(m[1]!, 10)] ?? 1;
        const recommended = Math.max(2, baseDia * r);
        map.set(e.id, recommended > 0 ? e.diaMm / recommended : 1);
      }
      data.diaRatioByEdge = map;
    }
    if (heatmapMode === 'balance') {
      data.balanceOk = ft.imbalanceRatio < 0.02;
    }
    return { data, fillTimes: ft };
  }, [heatmapMode, calc]);

  const heatmapData = heatResult?.data;
  const fillTimesByCavityMs = useMemo<Map<number, number> | null>(() => {
    if (!heatResult) return null;
    const m = new Map<number, number>();
    for (const [id, t] of heatResult.fillTimes.perCavityFillTimeS) {
      if (Number.isFinite(t)) m.set(id, t * 1000);
    }
    return m;
  }, [heatResult]);
  const showCavityLabels = heatmapMode === 'fill' || heatmapMode === 'balance';

  const updateCamera = () => {
    const s = stateRef.current;
    if (!s.mainCamera || !s.axCamera) return;
    const cp = Math.cos(s.ph);
    const sp = Math.sin(s.ph);
    const ct = Math.cos(s.th);
    const st = Math.sin(s.th);
    s.mainCamera.position.set(
      s.tx + s.dist * cp * st,
      s.ty + s.dist * sp,
      s.tz + s.dist * cp * ct,
    );
    s.mainCamera.lookAt(s.tx, s.ty, s.tz);
    s.mainCamera.up.set(0, Math.abs(s.ph) < Math.PI / 2 ? 1 : -1, 0);
    s.axCamera.position.set(5 * cp * st, 5 * sp, 5 * cp * ct);
    s.axCamera.lookAt(0, 0, 0);
    s.axCamera.up.set(0, Math.abs(s.ph) < Math.PI / 2 ? 1 : -1, 0);
  };

  // Initialise renderer + scenes (once)
  useEffect(() => {
    const mount = mountRef.current;
    if (!mount) return;
    const w = mount.clientWidth || 700;
    const h = mount.clientHeight || 520;
    const s = stateRef.current;

    const renderer = new THREE.WebGLRenderer({ antialias: true });
    renderer.setSize(w, h);
    renderer.setPixelRatio(window.devicePixelRatio);
    // Canvas background matches main area in page.tsx (#E2E5EA)
    renderer.setClearColor(0xe2e5ea);
    renderer.autoClear = false;
    mount.innerHTML = '';
    mount.appendChild(renderer.domElement);
    s.renderer = renderer;

    s.mainCamera = new THREE.PerspectiveCamera(40, w / h, 0.1, 2000);
    s.axCamera = new THREE.PerspectiveCamera(50, 1, 0.1, 100);
    s.axScene = createAxisScene();
    updateCamera();

    const projVec = new THREE.Vector3();
    const animate = () => {
      s.af = requestAnimationFrame(animate);
      if (!s.mainScene || !s.renderer || !s.mainCamera || !s.axCamera || !s.axScene) return;
      s.renderer.clear();
      s.renderer.setViewport(0, 0, w, h);
      s.renderer.render(s.mainScene, s.mainCamera);
      s.renderer.clearDepth();
      s.renderer.setViewport(8, 8, 100, 100);
      s.renderer.render(s.axScene, s.axCamera);

      // Project cavity world positions to screen for floating labels.
      if (labelRefs.current.size > 0 && s.mainCamera) {
        const canvasRect = s.renderer.domElement.getBoundingClientRect();
        const overlay = labelsOverlayRef.current;
        if (overlay) {
          for (const [id, el] of labelRefs.current) {
            if (!el) continue;
            const cav = (el.dataset.cavWorld ?? '').split(',').map(Number);
            if (cav.length !== 3) continue;
            projVec.set(cav[0]!, cav[1]!, cav[2]!).project(s.mainCamera);
            const x = (projVec.x * 0.5 + 0.5) * canvasRect.width;
            const y = (-projVec.y * 0.5 + 0.5) * canvasRect.height;
            const visible = projVec.z > -1 && projVec.z < 1;
            el.style.opacity = visible ? '1' : '0';
            el.style.transform = `translate(${x}px, ${y}px) translate(-50%, -110%)`;
            // Mark unused: we keep id reference for future mouseover hooks
            void id;
          }
        }
      }
    };
    animate();

    const onResize = () => {
      const w2 = mount.clientWidth || 700;
      const h2 = mount.clientHeight || 520;
      renderer.setSize(w2, h2);
      if (s.mainCamera) {
        s.mainCamera.aspect = w2 / h2;
        s.mainCamera.updateProjectionMatrix();
      }
    };
    window.addEventListener('resize', onResize);

    const handle: Viewer3DHandle = {
      setView(preset) {
        const p = PRESETS[preset as string];
        if (!p) return;
        s.th = p.th;
        s.ph = p.ph;
        updateCamera();
      },
      fit() {
        s.tx = 0;
        s.ty = 0;
        s.tz = 0;
        s.dist = 50;
        updateCamera();
      },
      reset() {
        s.th = 0.65;
        s.ph = 0.45;
        s.dist = 50;
        s.tx = 0;
        s.ty = 0;
        s.tz = 0;
        updateCamera();
      },
      setSpinPickActive(active) {
        s.spinPickActive = active;
        if (s.renderer?.domElement) {
          s.renderer.domElement.style.cursor = active ? 'crosshair' : 'default';
        }
      },
    };
    onHandleReady?.(handle);

    return () => {
      cancelAnimationFrame(s.af);
      window.removeEventListener('resize', onResize);
      renderer.dispose();
      if (mount) mount.innerHTML = '';
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Rebuild scene whenever calc / display options change
  useEffect(() => {
    const s = stateRef.current;
    const { scene, runnerMeshes, cavityMeshes } = buildSceneFromCalc(calc, {
      profile,
      hotRunner,
      showDims,
      gatesPerCavity,
      partWidthMm: partW,
      partDepthMm: partD,
      partHeightMm: partH,
      heatmapMode,
      heatmapData,
      importedPart,
      gatePoint,
      partRotation,
      useGateDrop,
      autoMirrorParts,
      cavityRotationOverrides,
      gateType,
      demouldingDir,
    });
    s.mainScene = scene;
    s.runnerMeshes = runnerMeshes;
    s.cavityMeshes = cavityMeshes;
    applyHighlight(s.runnerMeshes, effectiveHighlightTarget);

    // Persistent gate markers — rendered on every cavity instance once the
    // user has committed a gate point so they always see where it lives.
    // Each cavity mesh stashed its gate's world position in userData so
    // we don't have to redo the rotation-pivot math here.
    if (gatePoint && importedPart && cavityMeshes.length > 0) {
      for (const m of cavityMeshes) {
        const meta = m.userData as { gateWorld?: { x: number; y: number; z: number } };
        if (!meta.gateWorld) continue;
        const marker = new THREE.Mesh(
          new THREE.SphereGeometry(0.2, 16, 12),
          GATE_MARKER_MAT,
        );
        marker.position.set(meta.gateWorld.x, meta.gateWorld.y, meta.gateWorld.z);
        scene.add(marker);
      }
    }
  }, [
    calc, profile, hotRunner, gatesPerCavity, showDims, partW, partD, partH,
    effectiveHighlightTarget, heatmapMode, heatmapData, importedPart, gatePoint,
    useGateDrop, partRotation, autoMirrorParts, cavityRotationOverrides, gateType,
    demouldingDir,
  ]);

  // Re-apply highlight whenever the effective target changes (eye toggle, input focus, or section hover).
  useEffect(() => {
    applyHighlight(stateRef.current.runnerMeshes, effectiveHighlightTarget);
  }, [effectiveHighlightTarget]);

  // Interaction handlers
  const onPointerDown = (e: React.PointerEvent) => {
    e.preventDefault();
    (e.target as HTMLElement).setPointerCapture(e.pointerId);
    const s = stateRef.current;

    // Spin-centre pick: raycast the scene at the click; the hit point
    // becomes the camera's lookAt target. We KEEP the camera's world
    // position fixed and recompute (dist, th, ph) from the new target,
    // so the view smoothly re-centres on the pivot — same UX as
    // Solidworks / Onshape's "set centre of rotation" tool.
    if (s.spinPickActive && s.renderer && s.mainCamera && s.mainScene) {
      const rect = s.renderer.domElement.getBoundingClientRect();
      s.mouse.x = ((e.clientX - rect.left) / rect.width) * 2 - 1;
      s.mouse.y = -((e.clientY - rect.top) / rect.height) * 2 + 1;
      s.raycaster.setFromCamera(s.mouse, s.mainCamera);
      const hits = s.raycaster.intersectObjects(s.mainScene.children, true);
      if (hits.length > 0) {
        const hit = hits[0]!.point;
        const cam = s.mainCamera.position;
        s.tx = hit.x;
        s.ty = hit.y;
        s.tz = hit.z;
        const odx = cam.x - hit.x;
        const ody = cam.y - hit.y;
        const odz = cam.z - hit.z;
        const newDist = Math.sqrt(odx * odx + ody * ody + odz * odz);
        if (newDist > 1e-3) {
          s.dist = newDist;
          // dx = dist·cos(ph)·sin(th), dy = dist·sin(ph), dz = dist·cos(ph)·cos(th)
          s.ph = Math.asin(Math.max(-1, Math.min(1, ody / newDist)));
          s.th = Math.atan2(odx, odz);
        }
        updateCamera();
      }
      s.spinPickActive = false;
      if (s.renderer.domElement) s.renderer.domElement.style.cursor = 'default';
      return; // don't fall through to drag-start
    }

    s.drag = true;
    s.dx = e.clientX;
    s.dy = e.clientY;
    s.btn = e.button;
  };

  const onPointerUp = (e: React.PointerEvent) => {
    try {
      (e.target as HTMLElement).releasePointerCapture(e.pointerId);
    } catch {
      /* ignore */
    }
    stateRef.current.drag = false;
  };

  const onPointerMove = (e: React.PointerEvent) => {
    const s = stateRef.current;
    // Hover raycast when not dragging
    if (!s.drag && s.renderer && s.mainCamera && s.mainScene) {
      const rect = s.renderer.domElement.getBoundingClientRect();
      s.mouse.x = ((e.clientX - rect.left) / rect.width) * 2 - 1;
      s.mouse.y = -((e.clientY - rect.top) / rect.height) * 2 + 1;
      s.raycaster.setFromCamera(s.mouse, s.mainCamera);
      const hits = s.raycaster.intersectObjects(s.runnerMeshes, false);
      const newKey =
        hits.length > 0 && (hits[0]!.object.userData as RunnerMeshMeta)?.isRunner
          ? (hits[0]!.object.userData as RunnerMeshMeta).levelKey
          : null;

      if (newKey !== s.hoveredKey) {
        // While the user is in focus-mode (eye toggled or input focused),
        // hover should NOT swap materials — that would clobber the dim/glow
        // pair the user is using to compare. Tooltip still updates below.
        // Skip the hover material swap whenever something is already
        // spotlighted via eye-pin or section-row hover — we don't want
        // hover to fight the dim/glow pair.
        if (effectiveHighlightKey === null && highlightedEdgeIds.length === 0) {
          for (const m of s.runnerMeshes) {
            const meta = m.userData as RunnerMeshMeta;
            if (meta?._origMat && !meta._selected) m.material = meta._origMat;
          }
          if (newKey) {
            // Hover glow uses the design-system accent (#22C55E) so the viewer
            // cross-reads with selected Chips in the bars.
            const hoverMat = new THREE.MeshPhongMaterial({
              color: 0x22c55e,
              shininess: 100,
              specular: 0xbbf7d0,
              emissive: 0x052e16,
            });
            for (const m of s.runnerMeshes) {
              const meta = m.userData as RunnerMeshMeta;
              if (meta?.levelKey === newKey && !meta._selected) m.material = hoverMat;
            }
          }
        }
        s.hoveredKey = newKey;
        if (s.renderer?.domElement) {
          s.renderer.domElement.style.cursor = newKey ? 'pointer' : 'default';
        }
      }

      const tooltip = tooltipRef.current;
      if (tooltip) {
        if (hits.length > 0 && (hits[0]!.object.userData as RunnerMeshMeta)?.isRunner) {
          const meta = hits[0]!.object.userData as RunnerMeshMeta;
          const label =
            meta.isSprue ? 'Sprue' :
            meta.isDrop ? 'Gate Drop' :
            meta.isGate ? 'Gate Point' :
            meta.levelName;
          tooltip.style.display = 'block';
          tooltip.style.left = `${e.clientX + 15}px`;
          tooltip.style.top = `${e.clientY - 30}px`;
          tooltip.innerHTML =
            `<span style="color:#4ADE80;font-weight:600">${label}</span>` +
            `<br/><span style="color:#E2E8F0">Ø ${meta.diaMm.toFixed(1)} mm × L ${Math.round(meta.lenMm)} mm</span>`;
        } else {
          tooltip.style.display = 'none';
        }
      }
    }

    if (!s.drag) return;
    const mx = e.clientX - s.dx;
    const my = e.clientY - s.dy;
    s.dx = e.clientX;
    s.dy = e.clientY;
    if (s.btn === 1 || s.btn === 2 || e.shiftKey) {
      const p = s.dist * 0.002;
      const ct = Math.cos(s.th);
      const st = Math.sin(s.th);
      s.tx -= mx * p * ct;
      s.tz += mx * p * st;
      s.ty += my * p;
    } else {
      s.th += mx * 0.005;
      s.ph -= my * 0.005;
      const lim = Math.PI / 2 - 0.02;
      s.ph = Math.max(-lim, Math.min(lim, s.ph));
    }
    updateCamera();
  };

  const onWheel = (e: React.WheelEvent) => {
    const s = stateRef.current;
    const d = s.dist * (e.deltaY > 0 ? 1.1 : 1 / 1.1);
    s.dist = Math.max(5, Math.min(500, d));
    updateCamera();
  };

  return (
    <div className="relative h-full w-full">
      <div
        ref={mountRef}
        className="h-full w-full"
        role="img"
        aria-label="3D mould layout with runner network"
        onPointerDown={onPointerDown}
        onPointerUp={onPointerUp}
        onPointerMove={onPointerMove}
        onPointerLeave={onPointerUp}
        onWheel={onWheel}
        onContextMenu={(e) => e.preventDefault()}
      />
      <div
        ref={tooltipRef}
        role="status"
        aria-live="polite"
        className="pointer-events-none fixed z-50 hidden rounded-md border border-borderStrong bg-surface px-2.5 py-1.5 text-[11px] text-fg shadow-panel"
      />
      {showCavityLabels && (
        <div
          ref={labelsOverlayRef}
          className="pointer-events-none absolute inset-0 z-10"
          aria-hidden="true"
        >
          {calc.tree.cavities.map((cav) => {
            const ms = fillTimesByCavityMs?.get(cav.id);
            // Cavity world position: x and z are mm; y is the runner plane
            // (RZ = 0 in scene units). Labels float just above the cavity top.
            const worldX = cav.x / 10;
            const worldZ = cav.z / 10;
            const worldY = 0;
            return (
              <div
                key={cav.id}
                ref={(el) => {
                  if (el) labelRefs.current.set(cav.id, el);
                  else labelRefs.current.delete(cav.id);
                }}
                data-cav-world={`${worldX},${worldY},${worldZ}`}
                className="num absolute left-0 top-0 whitespace-nowrap rounded border border-borderStrong bg-surface px-1.5 py-0.5 text-[10px] font-medium text-fg shadow"
                style={{ willChange: 'transform' }}
              >
                C{cav.id} · {ms === undefined ? '—' : ms < 100 ? ms.toFixed(1) : ms.toFixed(0)} ms
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

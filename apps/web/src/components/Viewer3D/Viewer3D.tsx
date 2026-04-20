'use client';

import { useEffect, useRef } from 'react';
import * as THREE from 'three';
import type { CalcResult } from '@runner/core';
import { buildSceneFromCalc, type RunnerMeshMeta } from './buildScene';
import { createAxisScene } from './axisTriad';
import { PRESETS } from './presets';
import { useWorkspace } from '@/state/store';

export interface Viewer3DHandle {
  setView(preset: keyof typeof PRESETS): void;
  fit(): void;
  reset(): void;
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
}

export function Viewer3D({ calc, onHandleReady }: Viewer3DProps) {
  const mountRef = useRef<HTMLDivElement>(null);
  const tooltipRef = useRef<HTMLDivElement>(null);
  const stateRef = useRef<ViewerState>({
    renderer: null,
    mainCamera: null,
    axCamera: null,
    mainScene: null,
    axScene: null,
    runnerMeshes: [],
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
  });

  const profile = useWorkspace((s) => s.profile);
  const hotRunner = useWorkspace((s) => s.hotRunner);
  const gatesPerCavity = useWorkspace((s) => s.gatesPerCavity);
  const showDims = useWorkspace((s) => s.view.showDims);
  const partW = useWorkspace((s) => s.part.dimsMm.w);
  const partD = useWorkspace((s) => s.part.dimsMm.d);
  const partH = useWorkspace((s) => s.part.dimsMm.h);

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

    const animate = () => {
      s.af = requestAnimationFrame(animate);
      if (!s.mainScene || !s.renderer || !s.mainCamera || !s.axCamera || !s.axScene) return;
      s.renderer.clear();
      s.renderer.setViewport(0, 0, w, h);
      s.renderer.render(s.mainScene, s.mainCamera);
      s.renderer.clearDepth();
      s.renderer.setViewport(8, 8, 100, 100);
      s.renderer.render(s.axScene, s.axCamera);
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
    const { scene, runnerMeshes } = buildSceneFromCalc(calc, {
      profile,
      hotRunner,
      showDims,
      gatesPerCavity,
      partWidthMm: partW,
      partDepthMm: partD,
      partHeightMm: partH,
    });
    s.mainScene = scene;
    s.runnerMeshes = runnerMeshes;
  }, [calc, profile, hotRunner, gatesPerCavity, showDims, partW, partD, partH]);

  // Interaction handlers
  const onPointerDown = (e: React.PointerEvent) => {
    e.preventDefault();
    (e.target as HTMLElement).setPointerCapture(e.pointerId);
    const s = stateRef.current;
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
            `<span style="color:#22c55e;font-weight:600">${label}</span>` +
            `<br/><span style="color:#CBD5E1">Ø ${meta.diaMm.toFixed(1)} mm × L ${Math.round(meta.lenMm)} mm</span>`;
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
        className="pointer-events-none fixed z-50 hidden rounded-md border border-border bg-surface/95 px-2.5 py-1.5 text-[11px] text-fg shadow-panel backdrop-blur-sm"
      />
    </div>
  );
}

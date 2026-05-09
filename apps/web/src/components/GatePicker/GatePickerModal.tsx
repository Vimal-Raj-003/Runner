'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import * as THREE from 'three';
import { MATERIAL_GROUPS, findMaterial } from '@runner/core';
import { useWorkspace, type GateType } from '@/state/store';
import { useCalc } from '@/hooks/useCalc';
import { buildGateTip, GATE_TYPE_LABEL, GATE_TYPE_HELP } from '@/lib/gateGeometry';
import { analyzeGate, ltLimitForViscosity } from '@/lib/autoGate';
import {
  draftAnglesFromMesh,
  vertexColorsForDraft,
  draftAreaStats,
} from '@/lib/draft';

type CameraPreset = 'top' | 'front' | 'side' | 'iso';
const CAMERA_PRESETS: Record<CameraPreset, { th: number; ph: number }> = {
  top:   { th: 0,             ph: Math.PI / 2 - 0.001 },
  front: { th: 0,             ph: 0 },
  side:  { th: Math.PI / 2,   ph: 0 },
  iso:   { th: 0.6,           ph: 0.4 },
};

/**
 * Full-screen single-part gate picker.
 *
 * Workflow inside the modal:
 *   1. The part is rendered at the user's currently chosen orientation
 *      (drives all cavity instances in the layout view), so the user
 *      always picks on the part *as it will be placed*.
 *   2. **Drag** orbits the camera (look at the part from any angle).
 *      **Scroll** zooms. Camera moves are non-destructive.
 *   3. **Rotation buttons** in the side panel rotate the part itself by
 *      90° around the chosen axis. Pivot is the gate point so any
 *      already-placed gate stays anchored. Without a gate, the AABB
 *      centre/top is the pivot.
 *   4. **Use vertical drop** toggle controls whether the runner has a
 *      vertical drop tube above the part or plugs directly into it.
 *   5. **Click on the surface** to commit a gate point. The hit point
 *      is converted from world coords back to the part's *canonical*
 *      (pre-rotation) frame via `mesh.worldToLocal`, so the stored
 *      coordinates are consistent regardless of rotation.
 */

const PART_MAT = new THREE.MeshPhongMaterial({
  color: 0xa3a8b0,
  shininess: 80,
  specular: 0x222222,
});

// Material used when a demoulding direction is set: white base with
// `vertexColors: true` so the per-vertex green/yellow/red draft heatmap
// shows through directly without tinting.
const DRAFT_MAT = new THREE.MeshPhongMaterial({
  color: 0xffffff,
  shininess: 30,
  specular: 0x222222,
  vertexColors: true,
});

const HOVER_MAT = new THREE.MeshPhongMaterial({
  color: 0x22c55e,
  emissive: 0x064e3b,
  emissiveIntensity: 0.6,
  shininess: 90,
});

const PICKED_MAT = new THREE.MeshPhongMaterial({
  color: 0xfbbf24,
  emissive: 0xb45309,
  emissiveIntensity: 0.5,
  shininess: 90,
});

const RUNNER_MAT = new THREE.MeshPhongMaterial({
  color: 0xd9a23a,
  shininess: 70,
  specular: 0x553a14,
});

const RUNNER_PLANE_MAT = new THREE.MeshBasicMaterial({
  color: 0x3b82f6,
  transparent: true,
  opacity: 0.15,
  side: THREE.DoubleSide,
});

const AABB_WIRE_MAT = new THREE.LineBasicMaterial({
  color: 0x60a5fa,
  transparent: true,
  opacity: 0.55,
});

const SNAP_HOVER_MAT = new THREE.MeshPhongMaterial({
  color: 0xfde047,
  emissive: 0x713f12,
  emissiveIntensity: 0.7,
  shininess: 120,
});

/** Drop default length (mm) — matches DEFAULT_GATE_DROP_LEN_MM in @runner/core. */
const PREVIEW_DROP_LEN_MM = 55;
/** Drop default diameter (mm) — matches DEFAULT_GATE_DROP_DIA_MM in @runner/core. */
const PREVIEW_DROP_DIA_MM = 6;

interface PickerState {
  renderer: THREE.WebGLRenderer | null;
  scene: THREE.Scene | null;
  camera: THREE.PerspectiveCamera | null;
  hover: THREE.Mesh | null;
  pickedMarker: THREE.Mesh | null;
  partMesh: THREE.Mesh | null;
  /**
   * Live preview of the runner connection: drop tube + cone tip + a
   * horizontal stub representing the layout runner above. Lives in WORLD
   * space (sibling of the part mesh), so when the part rotates around
   * the gate, the runner stays put — exactly what the multi-cavity
   * layout will show.
   */
  runnerPreview: THREE.Group | null;
  /**
   * AABB wireframe (12 line segments) drawn on the part so the user
   * can read off the bounds visually while picking. Lives as a child
   * of partMesh so it follows any rotation applied to the geometry.
   */
  aabbWire: THREE.LineSegments | null;
  /**
   * Pre-computed snap candidate points in part-local mm. Hovering
   * within `snapRadiusMm` of one of these snaps the hover marker (and
   * the click) to the candidate. Currently 8 AABB corners + 6 face
   * centres + 12 edge midpoints = 26 candidates per part.
   */
  snapPoints: THREE.Vector3[];
  /** Snap proximity in mm — 5 % of the bbox diagonal. */
  snapRadiusMm: number;
  raycaster: THREE.Raycaster;
  target: THREE.Vector3;
  th: number;
  ph: number;
  dist: number;
  drag: boolean;
  dx: number;
  dy: number;
  didDrag: boolean;
}

function updateCamera(s: PickerState): void {
  if (!s.camera) return;
  const r = s.dist;
  s.camera.position.x = s.target.x + r * Math.cos(s.ph) * Math.sin(s.th);
  s.camera.position.y = s.target.y + r * Math.sin(s.ph);
  s.camera.position.z = s.target.z + r * Math.cos(s.ph) * Math.cos(s.th);
  s.camera.lookAt(s.target);
}

/**
 * Snap a part-local hit point to the nearest AABB feature (corner /
 * face centre / edge midpoint) when within the snap radius. Returns
 * the snapped point, or the original point if nothing's close enough.
 */
function snapToFeature(
  point: THREE.Vector3,
  candidates: THREE.Vector3[],
  radiusMm: number,
): { point: THREE.Vector3; snapped: boolean } {
  let best: THREE.Vector3 | null = null;
  let bestDist = radiusMm;
  for (const c of candidates) {
    const d = c.distanceTo(point);
    if (d < bestDist) {
      bestDist = d;
      best = c;
    }
  }
  return best ? { point: best.clone(), snapped: true } : { point, snapped: false };
}

export function GatePickerModal() {
  const importedPart = useWorkspace((s) => s.importedPart);
  const gatePickerActive = useWorkspace((s) => s.gatePickerActive);
  const gatePoint = useWorkspace((s) => s.gatePoint);
  const setGatePoint = useWorkspace((s) => s.setGatePoint);
  const setGatePickerActive = useWorkspace((s) => s.setGatePickerActive);
  const useGateDrop = useWorkspace((s) => s.useGateDrop);
  const setUseGateDrop = useWorkspace((s) => s.setUseGateDrop);
  const partRotation = useWorkspace((s) => s.partRotation);
  const rotatePart = useWorkspace((s) => s.rotatePart);
  const setPartRotation = useWorkspace((s) => s.setPartRotation);
  const cavityRotationOverrides = useWorkspace((s) => s.cavityRotationOverrides);
  const flipCavityRotation = useWorkspace((s) => s.flipCavityRotation);
  const resetCavityRotation = useWorkspace((s) => s.resetCavityRotation);
  const clearCavityRotations = useWorkspace((s) => s.clearCavityRotations);
  const gateType = useWorkspace((s) => s.gateType);
  const setGateType = useWorkspace((s) => s.setGateType);
  const demouldingDir = useWorkspace((s) => s.demouldingDir);
  const setDemouldingDir = useWorkspace((s) => s.setDemouldingDir);
  const demouldingPickActive = useWorkspace((s) => s.demouldingPickActive);
  const setDemouldingPickActive = useWorkspace((s) => s.setDemouldingPickActive);
  const mountRef = useRef<HTMLDivElement>(null);
  // Live coords of the cursor's current surface hit, displayed in the
  // sidebar so the user knows what they'd commit before clicking.
  const [hoverCoords, setHoverCoords] = useState<[number, number, number] | null>(null);
  // Memoised draft-area stats: total / positive / undercut mm² and the
  // undercut percentage. ImportedPart only carries positions + indices;
  // normals are computed on the fly via a temporary BufferGeometry
  // (cheap — we only do this when the dir / part changes).
  const draftStats = useMemo(() => {
    if (!importedPart || !demouldingDir) return null;
    const tmp = new THREE.BufferGeometry();
    tmp.setAttribute('position', new THREE.BufferAttribute(importedPart.positions, 3));
    tmp.setIndex(new THREE.BufferAttribute(importedPart.indices, 1));
    tmp.computeVertexNormals();
    const normals = (tmp.getAttribute('normal') as THREE.BufferAttribute).array as Float32Array;
    const angles = draftAnglesFromMesh(normals, demouldingDir);
    const stats = draftAreaStats(importedPart.positions, importedPart.indices, angles);
    tmp.dispose();
    return stats;
  }, [importedPart, demouldingDir]);
  // Calc result for the current workspace state. Used to drive the
  // top-down multi-cavity preview in the sidebar so the user can see
  // how the rotation will look across every cavity instance.
  const calc = useCalc();
  // Auto-suggest gate state. The Web Worker takes 1–3 s to analyse a
  // typical mesh; we show a progress percentage while it runs and
  // surface any error message in-place.
  const [autoBusy, setAutoBusy] = useState(false);
  const [autoPct, setAutoPct] = useState(0);
  const [autoError, setAutoError] = useState<string | null>(null);
  const [autoLtWarning, setAutoLtWarning] = useState<string | null>(null);
  const materialId = useWorkspace((s) => s.materialId);

  const onAutoSuggestGate = async (): Promise<void> => {
    if (!importedPart || autoBusy) return;
    setAutoBusy(true);
    setAutoPct(0);
    setAutoError(null);
    setAutoLtWarning(null);
    try {
      const material = findMaterial(materialId);
      const viscosity = material
        ? MATERIAL_GROUPS[material.group].viscosity
        : 'medium';
      const ltLimit = ltLimitForViscosity(viscosity);

      const result = await analyzeGate(
        {
          positions: importedPart.positions,
          indices: importedPart.indices,
          bbox: importedPart.geometry.bbox,
        },
        {
          ltLimit,
          onProgress: (pct) => setAutoPct(Math.round(pct)),
        },
      );

      if (!result.ok) {
        setAutoError(result.error.message);
        return;
      }

      // Convert from raw mesh coords (positions array frame, with
      // arbitrary origin) into the picker's part-local frame: AABB
      // centred on X / Z, AABB top at y = 0.
      const bbox = importedPart.geometry.bbox;
      const cx = (bbox.min[0] + bbox.max[0]) / 2;
      const cz = (bbox.min[2] + bbox.max[2]) / 2;
      const yMax = bbox.max[1];
      const local: [number, number, number] = [
        result.suggestion.position[0] - cx,
        result.suggestion.position[1] - yMax,
        result.suggestion.position[2] - cz,
      ];
      setGatePoint(local);

      if (result.suggestion.maxLtRatio > ltLimit) {
        setAutoLtWarning(
          `L/t ≈ ${result.suggestion.maxLtRatio.toFixed(0)} exceeds the ` +
          `${ltLimit} limit for this material. Single gate may short-shot — consider multi-gate.`,
        );
      }
    } catch (err) {
      setAutoError(err instanceof Error ? err.message : String(err));
    } finally {
      setAutoBusy(false);
    }
  };
  const stateRef = useRef<PickerState>({
    renderer: null,
    scene: null,
    camera: null,
    hover: null,
    pickedMarker: null,
    partMesh: null,
    runnerPreview: null,
    aabbWire: null,
    snapPoints: [],
    snapRadiusMm: 0,
    raycaster: new THREE.Raycaster(),
    target: new THREE.Vector3(),
    th: 0.6,
    ph: 0.4,
    dist: 100,
    drag: false,
    dx: 0,
    dy: 0,
    didDrag: false,
  });

  // Build the picker's scene whenever it opens. Tear-down on unmount.
  useEffect(() => {
    if (!gatePickerActive || !importedPart) return;
    const mount = mountRef.current;
    if (!mount) return;

    const s = stateRef.current;
    const scene = new THREE.Scene();
    scene.background = new THREE.Color(0x1a1a1f);
    scene.add(new THREE.AmbientLight(0xffffff, 0.55));
    const dirA = new THREE.DirectionalLight(0xffffff, 0.7);
    dirA.position.set(50, 80, 50);
    scene.add(dirA);
    const dirB = new THREE.DirectionalLight(0xffffff, 0.35);
    dirB.position.set(-30, 30, -50);
    scene.add(dirB);
    const dirC = new THREE.DirectionalLight(0xffffff, 0.2);
    dirC.position.set(0, -50, 0);
    scene.add(dirC);

    // Geometry in the canonical (pre-rotation) part-local frame: AABB
    // centred on X / Z, AABB top at y = 0. Picked points are stored in
    // this frame so rotating the mesh non-destructively (via
    // mesh.rotation) doesn't pollute the gate coordinates.
    const bbox = importedPart.geometry.bbox;
    const cx = (bbox.min[0] + bbox.max[0]) / 2;
    const cz = (bbox.min[2] + bbox.max[2]) / 2;
    const yMax = bbox.max[1];
    const partWidth = bbox.max[0] - bbox.min[0];
    const partHeight = yMax - bbox.min[1];
    const partDepth = bbox.max[2] - bbox.min[2];
    const positions = new Float32Array(importedPart.positions.length);
    for (let i = 0; i < importedPart.positions.length; i += 3) {
      positions[i]     = importedPart.positions[i]!     - cx;
      positions[i + 1] = importedPart.positions[i + 1]! - yMax;
      positions[i + 2] = importedPart.positions[i + 2]! - cz;
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    geo.setIndex(new THREE.BufferAttribute(importedPart.indices, 1));
    geo.computeVertexNormals();
    const partMesh = new THREE.Mesh(geo, PART_MAT);
    scene.add(partMesh);

    // AABB wireframe — 12 line segments that frame the part so the user
    // can see the bounds while picking. Geometry uses the same picker-
    // local frame (X/Z centred, Y top at 0). Child of partMesh so it
    // rotates along with any geometry transform we apply.
    const xMin = bbox.min[0] - cx, xMax = bbox.max[0] - cx;
    const zMin = bbox.min[2] - cz, zMax = bbox.max[2] - cz;
    const yMinL = bbox.min[1] - yMax, yMaxL = 0;
    const corners = [
      new THREE.Vector3(xMin, yMinL, zMin), new THREE.Vector3(xMax, yMinL, zMin),
      new THREE.Vector3(xMax, yMinL, zMax), new THREE.Vector3(xMin, yMinL, zMax),
      new THREE.Vector3(xMin, yMaxL, zMin), new THREE.Vector3(xMax, yMaxL, zMin),
      new THREE.Vector3(xMax, yMaxL, zMax), new THREE.Vector3(xMin, yMaxL, zMax),
    ];
    const wireIdx = [
      0, 1, 1, 2, 2, 3, 3, 0,  // bottom rectangle
      4, 5, 5, 6, 6, 7, 7, 4,  // top rectangle
      0, 4, 1, 5, 2, 6, 3, 7,  // vertical edges
    ];
    const wireGeo = new THREE.BufferGeometry();
    const wirePositions = new Float32Array(wireIdx.length * 3);
    for (let i = 0; i < wireIdx.length; i++) {
      const c = corners[wireIdx[i]!]!;
      wirePositions[i * 3]     = c.x;
      wirePositions[i * 3 + 1] = c.y;
      wirePositions[i * 3 + 2] = c.z;
    }
    wireGeo.setAttribute('position', new THREE.BufferAttribute(wirePositions, 3));
    const aabbWire = new THREE.LineSegments(wireGeo, AABB_WIRE_MAT);
    partMesh.add(aabbWire);

    // Snap candidates — 8 corners, 6 face centres, 12 edge midpoints.
    // All in the picker-local frame (where y = 0 is the AABB top).
    const snapPoints: THREE.Vector3[] = [];
    for (const c of corners) snapPoints.push(c.clone());
    const xMid = (xMin + xMax) / 2;
    const yMid = (yMinL + yMaxL) / 2;
    const zMid = (zMin + zMax) / 2;
    // Face centres
    snapPoints.push(new THREE.Vector3(xMin, yMid, zMid));
    snapPoints.push(new THREE.Vector3(xMax, yMid, zMid));
    snapPoints.push(new THREE.Vector3(xMid, yMinL, zMid));
    snapPoints.push(new THREE.Vector3(xMid, yMaxL, zMid));
    snapPoints.push(new THREE.Vector3(xMid, yMid, zMin));
    snapPoints.push(new THREE.Vector3(xMid, yMid, zMax));
    // Edge midpoints (12)
    const edgePairs: ReadonlyArray<readonly [number, number]> = [
      [0, 1], [1, 2], [2, 3], [3, 0],
      [4, 5], [5, 6], [6, 7], [7, 4],
      [0, 4], [1, 5], [2, 6], [3, 7],
    ];
    for (const [a, b] of edgePairs) {
      const ca = corners[a]!, cb = corners[b]!;
      snapPoints.push(new THREE.Vector3(
        (ca.x + cb.x) / 2,
        (ca.y + cb.y) / 2,
        (ca.z + cb.z) / 2,
      ));
    }

    // Marker scaled to ~2 % of the bounding-box span so it stays visible
    // on tiny parts without dwarfing big ones.
    const markerR = Math.max(partWidth, partDepth, partHeight) * 0.02;
    const hover = new THREE.Mesh(
      new THREE.SphereGeometry(markerR, 16, 12),
      HOVER_MAT,
    );
    hover.visible = false;
    scene.add(hover);

    // Marker for the currently-picked gate (if any). Sits in the part's
    // canonical local frame as a child of partMesh so it rotates with
    // the part — when the body swings, the gate stays anchored to the
    // surface point the user committed.
    const pickedMarker = new THREE.Mesh(
      new THREE.SphereGeometry(markerR * 1.1, 16, 12),
      PICKED_MAT,
    );
    pickedMarker.visible = false;
    partMesh.add(pickedMarker);

    const camera = new THREE.PerspectiveCamera(40, 1, 0.1, 100000);
    s.target.set(0, -partHeight / 2, 0);
    s.dist = Math.max(partWidth, partDepth, partHeight) * 2.4;
    s.th = 0.6;
    s.ph = 0.4;

    const renderer = new THREE.WebGLRenderer({ antialias: true });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    const updateSize = (): void => {
      const rect = mount.getBoundingClientRect();
      renderer.setSize(rect.width, rect.height);
      camera.aspect = rect.width / Math.max(1, rect.height);
      camera.updateProjectionMatrix();
    };
    updateSize();
    mount.appendChild(renderer.domElement);

    s.scene = scene;
    s.camera = camera;
    s.renderer = renderer;
    s.hover = hover;
    s.pickedMarker = pickedMarker;
    s.partMesh = partMesh;
    s.aabbWire = aabbWire;
    s.snapPoints = snapPoints;
    s.snapRadiusMm = Math.hypot(partWidth, partHeight, partDepth) * 0.05;
    updateCamera(s);

    let raf = 0;
    const tick = (): void => {
      raf = requestAnimationFrame(tick);
      renderer.render(scene, camera);
    };
    tick();

    const onResize = (): void => updateSize();
    window.addEventListener('resize', onResize);

    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener('resize', onResize);
      try { mount.removeChild(renderer.domElement); } catch { /* already gone */ }
      renderer.dispose();
      geo.dispose();
      hover.geometry.dispose();
      pickedMarker.geometry.dispose();
      wireGeo.dispose();
      s.scene = null;
      s.camera = null;
      s.renderer = null;
      s.hover = null;
      s.pickedMarker = null;
      s.partMesh = null;
      s.aabbWire = null;
      s.snapPoints = [];
    };
  }, [gatePickerActive, importedPart]);

  // Re-apply current rotation to the mesh whenever it changes. Pivot is
  // handled implicitly: since the mesh's geometry is centred on (gate or
  // origin), rotating the mesh by Euler angles around its position pivots
  // around that same point. When a gate has been picked we shift the mesh
  // so the gate is at world origin during the rotation, then shift back.
  useEffect(() => {
    const s = stateRef.current;
    if (!s.partMesh) return;
    const m = s.partMesh;
    const rx = (partRotation.x * Math.PI) / 180;
    const ry = (partRotation.y * Math.PI) / 180;
    const rz = (partRotation.z * Math.PI) / 180;

    if (gatePoint) {
      // Pivot rotation around the gate point in part-local mm. Reset the
      // mesh transform first so accumulated rotation doesn't compound.
      m.position.set(0, 0, 0);
      m.rotation.set(0, 0, 0);
      m.updateMatrix();
      const pivot = new THREE.Vector3(gatePoint[0], gatePoint[1], gatePoint[2]);
      // Build pivot rotation: T(+pivot) · R · T(-pivot)
      const mat = new THREE.Matrix4();
      mat.makeTranslation(pivot.x, pivot.y, pivot.z);
      mat.multiply(new THREE.Matrix4().makeRotationFromEuler(new THREE.Euler(rx, ry, rz, 'XYZ')));
      mat.multiply(new THREE.Matrix4().makeTranslation(-pivot.x, -pivot.y, -pivot.z));
      m.applyMatrix4(mat);
    } else {
      // No gate yet — rotate around the part's local origin (= AABB top
      // centre, the geometry's natural pivot).
      m.position.set(0, 0, 0);
      m.rotation.set(rx, ry, rz, 'XYZ');
      m.updateMatrix();
    }
    m.updateMatrixWorld(true);
  }, [partRotation, gatePoint, importedPart, gatePickerActive]);

  // The picked-gate marker is intentionally always hidden once a
  // gatePoint is set: the runner preview's gate cone (edge / pin /
  // submarine / etc.) is rendered at exactly that surface point and
  // serves as the visual confirmation. The reference sphere only
  // duplicated the position and frequently OCCLUDED the gate cone
  // from oblique angles, defeating its purpose.
  useEffect(() => {
    const s = stateRef.current;
    if (!s.pickedMarker) return;
    s.pickedMarker.visible = false;
  }, [gatePoint, gatePickerActive]);

  // Apply the draft heatmap to the part mesh whenever the demoulding
  // direction changes. When set: switch the part's material to
  // DRAFT_MAT (white phong with vertexColors) and write a per-vertex
  // green / yellow / red colour buffer derived from the angle between
  // each vertex normal and the demoulding direction. When cleared:
  // restore PART_MAT and remove the colour attribute.
  useEffect(() => {
    const s = stateRef.current;
    if (!s.partMesh) return;
    const geo = s.partMesh.geometry as THREE.BufferGeometry;
    const normals = geo.getAttribute('normal') as THREE.BufferAttribute | undefined;
    if (!normals) return;

    if (demouldingDir) {
      const angles = draftAnglesFromMesh(normals.array as Float32Array, demouldingDir);
      const colors = vertexColorsForDraft(angles);
      geo.setAttribute('color', new THREE.BufferAttribute(colors, 3));
      s.partMesh.material = DRAFT_MAT;
    } else {
      geo.deleteAttribute('color');
      s.partMesh.material = PART_MAT;
    }
  }, [demouldingDir, importedPart, gatePickerActive]);

  // Live preview of the runner ↔ gate connection. Rebuilds whenever the
  // gate point or the drop toggle changes. Lives in world space so it
  // stays put as the part rotates around the gate (which is exactly what
  // the multi-cavity layout will show).
  useEffect(() => {
    const s = stateRef.current;
    if (!s.scene) return;

    // Tear down the previous preview group + its tracked disposables.
    if (s.runnerPreview) {
      s.scene.remove(s.runnerPreview);
      const disposables = (s.runnerPreview as THREE.Group & {
        __disposables?: THREE.BufferGeometry[];
      }).__disposables;
      if (disposables) {
        for (const g of disposables) g.dispose();
      } else {
        s.runnerPreview.traverse((obj) => {
          if (obj instanceof THREE.Mesh) obj.geometry.dispose();
        });
      }
      s.runnerPreview = null;
    }

    if (!gatePoint || !importedPart) return;

    const [gx, gy, gz] = gatePoint;
    const r = PREVIEW_DROP_DIA_MM / 2;
    const group = new THREE.Group();

    // Reusable disposables registry — collected via the gate-tip helper
    // so the cleanup phase can free their geometry on group teardown.
    const disposables: THREE.BufferGeometry[] = [];

    if (useGateDrop) {
      // Vertical drop, with the gate tip body sitting in the AIR
      // between the drop bottom and the part surface (not buried
      // inside the part). Same outward-normal logic as the no-drop
      // case: figure out which AABB face the gate is on, route the
      // drop so it ends one tipDepth above the gate point along that
      // face's normal, then let the gate tip occupy the gap.
      const bbox = importedPart.geometry.bbox;
      const cxMm = (bbox.min[0] + bbox.max[0]) / 2;
      const czMm = (bbox.min[2] + bbox.max[2]) / 2;
      const yMaxMm = bbox.max[1];
      const xMinL = bbox.min[0] - cxMm, xMaxL = bbox.max[0] - cxMm;
      const yMinL = bbox.min[1] - yMaxMm, yMaxL = 0;
      const zMinL = bbox.min[2] - czMm, zMaxL = bbox.max[2] - czMm;
      const candidates: Array<{ d: number; n: THREE.Vector3 }> = [
        { d: Math.abs(gx - xMinL), n: new THREE.Vector3(-1, 0, 0) },
        { d: Math.abs(gx - xMaxL), n: new THREE.Vector3( 1, 0, 0) },
        { d: Math.abs(gy - yMinL), n: new THREE.Vector3(0, -1, 0) },
        { d: Math.abs(gy - yMaxL), n: new THREE.Vector3(0,  1, 0) },
        { d: Math.abs(gz - zMinL), n: new THREE.Vector3(0, 0, -1) },
        { d: Math.abs(gz - zMaxL), n: new THREE.Vector3(0, 0,  1) },
      ];
      candidates.sort((a, b) => a.d - b.d);
      const outDirLocal = candidates[0]!.n.clone();
      const rotMat = new THREE.Matrix4().makeRotationFromEuler(
        new THREE.Euler(
          (partRotation.x * Math.PI) / 180,
          (partRotation.y * Math.PI) / 180,
          (partRotation.z * Math.PI) / 180,
          'XYZ',
        ),
      );
      const outDir = outDirLocal.clone().applyMatrix4(rotMat).normalize();

      const tip = buildGateTip({ type: gateType, r, material: RUNNER_MAT });
      const dropTopY = PREVIEW_DROP_LEN_MM;
      // Air gap so fillets / rounded corners don't graze the drop.
      const airGap = Math.max(PREVIEW_DROP_DIA_MM * 2, r * 4);

      // Tip placement: position the GROUP so the orifice lands exactly
      // at the picked gate point. For direct / edge / pin / fan the
      // orifice offset is `(0, -tipDepth, 0)` so the group sits at
      // gate + outDir·tipDepth — same as before. For submarine the
      // 36° tilt shifts the orifice off-axis, so the group needs a
      // matching lateral compensation; otherwise the gate marker and
      // the orifice land at different points and the tip looks
      // detached from the runner.
      const tipQuat = new THREE.Quaternion()
        .setFromUnitVectors(new THREE.Vector3(0, 1, 0), outDir);
      const orificeWorld = new THREE.Vector3(...tip.orificeOffset)
        .applyQuaternion(tipQuat);
      const tipGroupX = gx - orificeWorld.x;
      const tipGroupY = gy - orificeWorld.y;
      const tipGroupZ = gz - orificeWorld.z;

      // The runner tube ends at the tip's WIDE END (= group origin).
      // For non-submarine this equals gate + outDir·tipDepth (since
      // group is shifted by tipDepth in +outDir from the gate). For
      // submarine the wide end is laterally offset too — the runner
      // tube routes to that position so it joins the angled tunnel
      // smoothly.
      const dropX = tipGroupX + outDir.x * airGap;
      const dropZ = tipGroupZ + outDir.z * airGap;
      const dropBotY = tipGroupY + outDir.y * airGap;

      // Build ONE smooth tube through every waypoint instead of stacking
      // cylinders + sphere caps. CatmullRomCurve3 rounds the corners
      // automatically, which gives the elbow a real bent-pipe look — no
      // visible knobs or seams where pieces meet.
      //
      // Waypoints, in flow order:
      //   ① runner-plane stub far end (5 dia upstream of the bend)
      //   ② drop-top corner — where vertical drop meets stub
      //   ③ drop-bottom corner — where drop meets the arm
      //   ④ gate-tip top — where the arm enters the gate
      const stubFarLen = PREVIEW_DROP_DIA_MM * 5;
      const stubFar    = new THREE.Vector3(dropX - stubFarLen, dropTopY, dropZ);
      const dropTop    = new THREE.Vector3(dropX,              dropTopY, dropZ);
      const dropBot    = new THREE.Vector3(dropX,              dropBotY, dropZ);
      // Wide end of the gate tip — where the runner tube terminates.
      // For non-submarine this is `gate + outDir·tipDepth`; for
      // submarine it's laterally offset because the body is angled.
      const tipTop     = new THREE.Vector3(tipGroupX, tipGroupY, tipGroupZ);

      const waypoints: THREE.Vector3[] = [];
      const pushWaypoint = (p: THREE.Vector3): void => {
        const last = waypoints[waypoints.length - 1];
        if (!last || last.distanceTo(p) > 1e-3) waypoints.push(p);
      };
      pushWaypoint(stubFar);
      pushWaypoint(dropTop);
      pushWaypoint(dropBot);
      pushWaypoint(tipTop);

      if (waypoints.length >= 2) {
        // Build a CurvePath: straight LineCurve3 segments separated by
        // QuadraticBezierCurve3 fillets at each interior corner. Bezier
        // control point at the corner with approach/depart endpoints
        // rolled back by `bendR` along the segment directions gives a
        // proper rounded elbow — tangent-continuous, no bite.
        const bendR = r * 2.5;
        const path = new THREE.CurvePath<THREE.Vector3>();
        let cursor = waypoints[0]!.clone();
        for (let i = 1; i < waypoints.length - 1; i++) {
          const prev = waypoints[i - 1]!;
          const corner = waypoints[i]!;
          const next = waypoints[i + 1]!;
          const inDir = corner.clone().sub(prev).normalize();
          const outDir = next.clone().sub(corner).normalize();
          const segIn = corner.distanceTo(prev);
          const segOut = corner.distanceTo(next);
          const rad = Math.min(bendR, segIn * 0.45, segOut * 0.45);
          const approach = corner.clone().sub(inDir.clone().multiplyScalar(rad));
          const depart = corner.clone().add(outDir.clone().multiplyScalar(rad));
          if (cursor.distanceTo(approach) > 1e-4) {
            path.add(new THREE.LineCurve3(cursor.clone(), approach.clone()));
          }
          // Skip the bezier when approach and depart are essentially the
          // same point (collinear corner — no actual bend to round).
          if (approach.distanceTo(depart) > 1e-4) {
            path.add(new THREE.QuadraticBezierCurve3(
              approach.clone(),
              corner.clone(),
              depart.clone(),
            ));
          }
          cursor = depart;
        }
        const last = waypoints[waypoints.length - 1]!;
        if (cursor.distanceTo(last) > 1e-4) {
          path.add(new THREE.LineCurve3(cursor.clone(), last.clone()));
        }

        const tubeGeo = new THREE.TubeGeometry(path, 96, r, 20, false);
        const tube = new THREE.Mesh(tubeGeo, RUNNER_MAT);
        group.add(tube);
        disposables.push(tubeGeo);
      }

      // Gate tip — group origin = tip's wide end (= where the runner
      // tube terminates). Orifice = group origin + rotated orificeOffset
      // = the picked gate point, by construction of tipGroup{X,Y,Z}.
      tip.group.position.set(tipGroupX, tipGroupY, tipGroupZ);
      tip.group.quaternion.copy(tipQuat);
      group.add(tip.group);
      disposables.push(...tip.geometries);

      // Translucent runner-plane indicator.
      const planeSize = Math.max(
        PREVIEW_DROP_DIA_MM * 12,
        Math.abs(dropX) * 2 + PREVIEW_DROP_DIA_MM * 6,
      );
      const planeGeo = new THREE.PlaneGeometry(planeSize, planeSize);
      const plane = new THREE.Mesh(planeGeo, RUNNER_PLANE_MAT);
      plane.rotation.x = -Math.PI / 2;
      plane.position.set(dropX, dropTopY, dropZ);
      group.add(plane);
      disposables.push(planeGeo);
    } else {
      // No drop: runner enters horizontally at the gate level. The
      // runner cylinder must stay OUTSIDE the part body, so we figure
      // out which AABB face the gate sits closest to and push the stub
      // outward along that face's normal. The gate tip then bridges
      // the gap between the runner end and the picked surface point —
      // exactly what an edge / fan gate looks like in real tooling.
      const bbox = importedPart.geometry.bbox;
      const cxMm = (bbox.min[0] + bbox.max[0]) / 2;
      const czMm = (bbox.min[2] + bbox.max[2]) / 2;
      const yMaxMm = bbox.max[1];
      const xMinL = bbox.min[0] - cxMm, xMaxL = bbox.max[0] - cxMm;
      const yMinL = bbox.min[1] - yMaxMm, yMaxL = 0;
      const zMinL = bbox.min[2] - czMm, zMaxL = bbox.max[2] - czMm;
      const candidates: Array<{ d: number; n: THREE.Vector3 }> = [
        { d: Math.abs(gx - xMinL), n: new THREE.Vector3(-1, 0, 0) },
        { d: Math.abs(gx - xMaxL), n: new THREE.Vector3( 1, 0, 0) },
        { d: Math.abs(gy - yMinL), n: new THREE.Vector3(0, -1, 0) },
        { d: Math.abs(gy - yMaxL), n: new THREE.Vector3(0,  1, 0) },
        { d: Math.abs(gz - zMinL), n: new THREE.Vector3(0, 0, -1) },
        { d: Math.abs(gz - zMaxL), n: new THREE.Vector3(0, 0,  1) },
      ];
      candidates.sort((a, b) => a.d - b.d);
      const outDirLocal = candidates[0]!.n.clone();

      // The bbox & gate point live in the part's pre-rotation local
      // frame, but the runner preview is rendered in world space (it's
      // a sibling of the part mesh, not a child). When the user
      // rotates the part, the local outward normal must be rotated by
      // the same Euler so the runner ends up coming off the face that
      // is *currently* visible — not the one that was outermost before
      // the rotation. Rotation is around the gate point, but direction
      // vectors only see the rotation matrix.
      const rotMat = new THREE.Matrix4().makeRotationFromEuler(
        new THREE.Euler(
          (partRotation.x * Math.PI) / 180,
          (partRotation.y * Math.PI) / 180,
          (partRotation.z * Math.PI) / 180,
          'XYZ',
        ),
      );
      const outDir = outDirLocal.clone().applyMatrix4(rotMat).normalize();

      // Gate tip + runner stub all live on the same outward axis — one
      // smooth TubeGeometry through the waypoints renders the entire
      // run as a single mesh. Submarine's angled body shifts the tip
      // group laterally so the orifice still lands at the picked gate
      // point — the runner stub then routes to the wide end of the
      // angled body, not to the gate point itself.
      const tip = buildGateTip({ type: gateType, r, material: RUNNER_MAT });
      const stubLen = PREVIEW_DROP_DIA_MM * 8;
      const airGap = Math.max(PREVIEW_DROP_DIA_MM * 2, r * 4);

      const tipQuat = new THREE.Quaternion()
        .setFromUnitVectors(new THREE.Vector3(0, 1, 0), outDir);
      const orificeWorld = new THREE.Vector3(...tip.orificeOffset)
        .applyQuaternion(tipQuat);
      const tipTop = new THREE.Vector3(
        gx - orificeWorld.x,
        gy - orificeWorld.y,
        gz - orificeWorld.z,
      );
      const stubFar = new THREE.Vector3(
        tipTop.x + outDir.x * (airGap + stubLen),
        tipTop.y + outDir.y * (airGap + stubLen),
        tipTop.z + outDir.z * (airGap + stubLen),
      );
      const curve = new THREE.CatmullRomCurve3([tipTop, stubFar], false);
      const tubeGeo = new THREE.TubeGeometry(curve, 24, r, 18, false);
      const tube = new THREE.Mesh(tubeGeo, RUNNER_MAT);
      group.add(tube);
      disposables.push(tubeGeo);

      tip.group.position.copy(tipTop);
      tip.group.quaternion.copy(tipQuat);
      group.add(tip.group);
      disposables.push(...tip.geometries);
    }

    s.scene.add(group);
    s.runnerPreview = group;
    // Stash the disposables on the group itself so the cleanup helper
    // (in the scene-rebuild effect) can free them.
    (s.runnerPreview as THREE.Group & { __disposables?: THREE.BufferGeometry[] })
      .__disposables = disposables;
  }, [gatePoint, useGateDrop, gatePickerActive, gateType, importedPart, partRotation]);

  // Esc cancels.
  useEffect(() => {
    if (!gatePickerActive) return;
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') setGatePickerActive(false);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [gatePickerActive, setGatePickerActive]);

  const onPointerDown = (e: React.PointerEvent): void => {
    e.preventDefault();
    (e.target as HTMLElement).setPointerCapture(e.pointerId);
    const s = stateRef.current;
    s.drag = true;
    s.didDrag = false;
    s.dx = e.clientX;
    s.dy = e.clientY;
  };

  const onPointerUp = (e: React.PointerEvent): void => {
    try { (e.target as HTMLElement).releasePointerCapture(e.pointerId); } catch { /* ignore */ }
    const s = stateRef.current;
    if (!s.drag) return;
    s.drag = false;

    // Click without drag = commit. Drag = orbit only, don't pick.
    if (s.didDrag || !s.renderer || !s.camera || !s.partMesh) return;
    const rect = s.renderer.domElement.getBoundingClientRect();
    const mx = ((e.clientX - rect.left) / rect.width) * 2 - 1;
    const my = -((e.clientY - rect.top) / rect.height) * 2 + 1;
    s.raycaster.setFromCamera(new THREE.Vector2(mx, my), s.camera);
    const hits = s.raycaster.intersectObject(s.partMesh, false);
    if (hits.length === 0) return;
    const hit = hits[0]!;

    // Demoulding-pick mode: commit the hit triangle's face normal
    // (transformed back to part-local frame) as the demoulding
    // direction. Mode auto-exits.
    if (demouldingPickActive) {
      // hit.face.normal is in the geometry's LOCAL frame (= part-local
      // pre-rotation) because the picker partMesh's geometry is in that
      // frame. Just normalise and store.
      const fn = hit.face?.normal;
      if (fn) {
        const len = Math.sqrt(fn.x * fn.x + fn.y * fn.y + fn.z * fn.z);
        if (len > 1e-9) {
          setDemouldingDir([fn.x / len, fn.y / len, fn.z / len]);
        }
      }
      setDemouldingPickActive(false);
      return;
    }

    // Convert world hit to the mesh's *local* (canonical, pre-rotation)
    // frame so the stored coordinates remain valid even after the user
    // rotates the part further. Then snap to AABB feature points so the
    // user can hit corners / face centres / edge midpoints precisely.
    const local = hit.point.clone();
    s.partMesh.worldToLocal(local);
    const snap = snapToFeature(local, s.snapPoints, s.snapRadiusMm);
    setGatePoint([snap.point.x, snap.point.y, snap.point.z]);
  };

  const onPointerMove = (e: React.PointerEvent): void => {
    const s = stateRef.current;
    if (s.drag) {
      const ndx = e.clientX - s.dx;
      const ndy = e.clientY - s.dy;
      if (Math.abs(ndx) > 3 || Math.abs(ndy) > 3) s.didDrag = true;
      s.th -= ndx * 0.005;
      s.ph += ndy * 0.005;
      s.ph = Math.max(-1.5, Math.min(1.5, s.ph));
      s.dx = e.clientX;
      s.dy = e.clientY;
      updateCamera(s);
      return;
    }
    if (!s.renderer || !s.camera || !s.partMesh || !s.hover) return;
    const rect = s.renderer.domElement.getBoundingClientRect();
    const mx = ((e.clientX - rect.left) / rect.width) * 2 - 1;
    const my = -((e.clientY - rect.top) / rect.height) * 2 + 1;
    s.raycaster.setFromCamera(new THREE.Vector2(mx, my), s.camera);
    const hits = s.raycaster.intersectObject(s.partMesh, false);
    if (hits.length > 0) {
      const local = hits[0]!.point.clone();
      s.partMesh.worldToLocal(local);
      const snap = snapToFeature(local, s.snapPoints, s.snapRadiusMm);
      // Snapped points are in part-local mm; lift back to world via the
      // mesh's matrix so the marker sits where the geometry is actually
      // drawn (handles rotation correctly).
      const world = snap.point.clone();
      s.partMesh.localToWorld(world);
      s.hover.position.copy(world);
      s.hover.visible = true;
      // Recolour to flag a snap visually — a tiny but high-leverage cue.
      s.hover.material = snap.snapped ? SNAP_HOVER_MAT : HOVER_MAT;
      setHoverCoords([snap.point.x, snap.point.y, snap.point.z]);
    } else {
      s.hover.visible = false;
      setHoverCoords(null);
    }
  };

  const onWheel = (e: React.WheelEvent): void => {
    e.preventDefault();
    const s = stateRef.current;
    s.dist *= e.deltaY > 0 ? 1.1 : 0.9;
    s.dist = Math.max(1, Math.min(100000, s.dist));
    updateCamera(s);
  };

  /**
   * Multi-cavity top-down preview. Live SVG schematic of the layout
   * with each cavity drawn at its world position and per-cavity Y
   * rotation. Lets the user verify that the chosen orientation +
   * gate-pick produces a sensible layout before closing the modal.
   *
   * Defined BEFORE the conditional early-return so the hook is called
   * in the same order every render, satisfying the Rules of Hooks. The
   * inner null-guard short-circuits the work when the modal is closed.
   */
  const layoutPreview = useMemo(() => {
    if (!gatePickerActive || !importedPart || calc.tree.cavities.length === 0) return null;
    const W = importedPart.geometry.dimsMm.w;
    const D = importedPart.geometry.dimsMm.d;
    let minX = -W / 2, maxX = W / 2;
    let minZ = -D / 2, maxZ = D / 2;
    for (const c of calc.tree.cavities) {
      minX = Math.min(minX, c.x - W / 2);
      maxX = Math.max(maxX, c.x + W / 2);
      minZ = Math.min(minZ, c.z - D / 2);
      maxZ = Math.max(maxZ, c.z + D / 2);
    }
    const padding = 8;
    minX -= padding; maxX += padding;
    minZ -= padding; maxZ += padding;
    const widthMm = maxX - minX;
    const heightMm = maxZ - minZ;
    const SVG_W = 220;
    const SVG_H = 180;
    const scale = Math.min(SVG_W / widthMm, SVG_H / heightMm);
    const wPx = widthMm * scale;
    const hPx = heightMm * scale;
    const xToPx = (x: number): number => (x - minX) * scale;
    const zToPx = (z: number): number => (z - minZ) * scale;

    const [gx, , gz] = gatePoint ?? [0, 0, 0];
    const gateMag = Math.hypot(gx, gz);

    return {
      svgW: wPx,
      svgH: hPx,
      runners: calc.tree.edges
        .filter((e) => !e.isDrop)
        .map((e) => {
          const p = calc.tree.nodes.find((n) => n.id === e.parentNodeId);
          const c = calc.tree.nodes.find((n) => n.id === e.childNodeId);
          if (!p || !c) return null;
          return {
            id: e.id,
            x1: xToPx(p.x), y1: zToPx(p.z),
            x2: xToPx(c.x), y2: zToPx(c.z),
          };
        })
        .filter((r): r is NonNullable<typeof r> => r !== null),
      // Drop bridges. The pipeline puts dropParent (gate junction) on the
      // straight runner line and cavityNode (gate corner) on the rotated
      // part. When those two xz points differ, the bridge is the angled
      // gate connector — drawn as a thinner line in the schematic so the
      // user can see the runner remains cardinal while the connector
      // bends to reach the gate.
      drops: calc.tree.edges
        .filter((e) => e.isDrop)
        .map((e) => {
          const p = calc.tree.nodes.find((n) => n.id === e.parentNodeId);
          const c = calc.tree.nodes.find((n) => n.id === e.childNodeId);
          if (!p || !c) return null;
          const dx = c.x - p.x;
          const dz = c.z - p.z;
          if (Math.hypot(dx, dz) < 1e-3) return null;
          return {
            id: e.id,
            x1: xToPx(p.x), y1: zToPx(p.z),
            x2: xToPx(c.x), y2: zToPx(c.z),
          };
        })
        .filter((r): r is NonNullable<typeof r> => r !== null),
      cavities: calc.tree.cavities.map((cav) => {
        const cavNode = calc.tree.nodes.find(
          (n) => n.kind === 'cavity' && n.cavityId === cav.id,
        );
        const offsetX = cavNode ? cavNode.x - cav.x : 0;
        const offsetZ = cavNode ? cavNode.z - cav.z : 0;
        const offsetMag = Math.hypot(offsetX, offsetZ);
        let yRotRad = 0;
        if (offsetMag > 1e-3 && gateMag > 1e-3) {
          const dirAngle  = Math.atan2(-offsetZ, offsetX);
          const gateAngle = Math.atan2(-gz, gx);
          yRotRad = dirAngle - gateAngle;
        }
        // Per-cavity manual override (Flip H = X-axis 180°, Flip V =
        // Y-axis 180°). Y override adds to the auto-mirror rotation;
        // X override doesn't show in the top-down 2D preview because
        // a 180° X rotation flips the part front-to-back, which from
        // top is invisible — we mark it with a small badge instead.
        const override = cavityRotationOverrides[cav.id] ?? { x: 0, y: 0 };
        // SVG rotate() is clockwise; THREE.js Y is counter-clockwise
        // when viewed from above.
        const svgDeg = -((yRotRad * 180) / Math.PI) + partRotation.y + override.y;
        return {
          id: cav.id,
          cx: xToPx(cav.x),
          cy: zToPx(cav.z),
          rotateDeg: svgDeg,
          flipped: override.x !== 0 || override.y !== 0,
          gateLocalPx: gateMag > 1e-3
            ? { x: gx * scale, y: -gz * scale }
            : null,
        };
      }),
      sprueCx: xToPx(0),
      sprueCy: zToPx(0),
      partWPx: W * scale,
      partDPx: D * scale,
      // Overall layout dimensions (mm) — width × depth of the bounding
      // rectangle that contains every cavity AABB. Plus total runner
      // length for a quick design metric.
      layoutWMm: widthMm,
      layoutDMm: heightMm,
      totalRunnerMm: calc.tree.edges
        .filter((e) => !e.isDrop)
        .reduce((sum, e) => sum + e.lenMm, 0),
    };
  }, [gatePickerActive, calc, importedPart, gatePoint, partRotation.y, cavityRotationOverrides]);

  // Early-return AFTER all hooks have been called. Anything below this
  // line is plain JSX/JS and may safely depend on `importedPart`.
  if (!gatePickerActive || !importedPart) return null;

  const rotationDirty =
    partRotation.x !== 0 || partRotation.y !== 0 || partRotation.z !== 0;

  return (
    <div className="fixed inset-0 z-50 flex flex-col bg-black/85 backdrop-blur-sm">
      <div className="flex items-center justify-between gap-3 border-b border-borderStrong bg-surface px-4 py-2">
        <div className="min-w-0">
          <h2 className="truncate text-sm font-semibold text-fg">
            Pick gate location · <span className="text-muted/80">{importedPart.fileName}</span>
          </h2>
          <p className="text-[11px] text-muted">
            Drag to orbit · scroll to zoom · click to {gatePoint ? 're-pick' : 'pick'} gate · Esc to close
          </p>
        </div>
        {/* Camera presets — change the viewing angle without losing the
            picked gate or current rotation. Helpful when the part has
            been rotated 90° and the default ISO view shows it tilted. */}
        <div className="flex shrink-0 gap-1 rounded-md border border-border/60 bg-bg/40 p-0.5">
          {(['top', 'front', 'side', 'iso'] as const).map((preset) => (
            <button
              key={preset}
              type="button"
              onClick={() => {
                const s = stateRef.current;
                s.th = CAMERA_PRESETS[preset].th;
                s.ph = CAMERA_PRESETS[preset].ph;
                updateCamera(s);
              }}
              className="rounded px-2 py-1 text-[10px] font-semibold uppercase text-muted hover:bg-bg/60 hover:text-fg"
              title={`View from ${preset}`}
            >
              {preset}
            </button>
          ))}
        </div>
        <button
          type="button"
          onClick={() => {
            setGatePoint(null);
            setPartRotation({ x: 0, y: 0, z: 0 });
            clearCavityRotations();
          }}
          className="shrink-0 rounded-md border border-warn/60 bg-warn/15 px-3 py-1 text-[11px] font-semibold text-warn hover:bg-warn/25"
          title="Clear gate, part rotation, and every per-cavity flip"
        >
          Reset all
        </button>
        <button
          type="button"
          onClick={() => setGatePickerActive(false)}
          className="shrink-0 rounded-md border border-border bg-bg/60 px-3 py-1 text-[11px] text-muted hover:text-fg"
        >
          Close
        </button>
      </div>
      <div className="flex flex-1 min-h-0">
        {/* Side panel: orientation + drop options live here so the user
            can flip and pick without leaving the modal. */}
        <aside className="flex w-64 shrink-0 flex-col gap-3 overflow-y-auto border-r border-borderStrong bg-surface p-3 text-[11px]">
          <section className="space-y-1.5 rounded-md border border-border/60 bg-bg/40 p-2">
            <div className="flex items-center justify-between">
              <span className="font-semibold text-fg">Part orientation</span>
              <button
                type="button"
                onClick={() => setPartRotation({ x: 0, y: 0, z: 0 })}
                disabled={!rotationDirty}
                className="rounded border border-border bg-bg/60 px-1.5 py-0.5 text-[10px] text-muted hover:text-fg disabled:cursor-not-allowed disabled:opacity-40"
              >
                Reset
              </button>
            </div>
            <p className="text-[10px] text-muted/80">
              Rotates around the {gatePoint ? 'picked gate' : 'AABB centre'} so the runner anchor stays put.
            </p>
            {(['x', 'y', 'z'] as const).map((axis) => (
              <div key={axis} className="space-y-1">
                <div className="flex items-center gap-1">
                  <span className="w-3 text-[10px] font-semibold uppercase text-muted">{axis}</span>
                  <button
                    type="button"
                    onClick={() => rotatePart(axis, -90)}
                    className="rounded border border-border bg-bg/60 px-1 py-1 text-[10px] font-medium text-muted hover:text-fg"
                    title={`-90° around ${axis.toUpperCase()}`}
                  >
                    −90°
                  </button>
                  <button
                    type="button"
                    onClick={() => rotatePart(axis, -1)}
                    className="rounded border border-border bg-bg/60 px-1 py-1 text-[10px] font-medium text-muted hover:text-fg"
                    title={`-1° around ${axis.toUpperCase()}`}
                  >
                    −1°
                  </button>
                  <input
                    type="number"
                    step={1}
                    className="num min-w-0 flex-1 rounded-md border border-border bg-bg px-1 py-1 text-right text-[11px] text-fg focus-visible:border-blue-500"
                    value={Math.round(partRotation[axis])}
                    onChange={(e) => {
                      const v = parseFloat(e.target.value);
                      const next = { ...partRotation };
                      next[axis] = Number.isFinite(v) ? ((v % 360) + 360) % 360 : 0;
                      setPartRotation(next);
                    }}
                    title={`Type any value, or use ↑/↓ for 1° steps. ${axis.toUpperCase()} axis.`}
                  />
                  <span className="text-[10px] text-muted">°</span>
                  <button
                    type="button"
                    onClick={() => rotatePart(axis, 1)}
                    className="rounded border border-border bg-bg/60 px-1 py-1 text-[10px] font-medium text-muted hover:text-fg"
                    title={`+1° around ${axis.toUpperCase()}`}
                  >
                    +1°
                  </button>
                  <button
                    type="button"
                    onClick={() => rotatePart(axis, 90)}
                    className="rounded border border-border bg-bg/60 px-1 py-1 text-[10px] font-medium text-muted hover:text-fg"
                    title={`+90° around ${axis.toUpperCase()}`}
                  >
                    +90°
                  </button>
                </div>
              </div>
            ))}
            <p className="text-[10px] text-muted/80">
              Use ±1° / ±90° buttons, type a value, or focus the input and press ↑/↓.
            </p>
          </section>

          <section className="space-y-1.5 rounded-md border border-border/60 bg-bg/40 p-2">
            <span className="block font-semibold text-fg">Runner connection</span>
            <label className="flex cursor-pointer items-center gap-2 text-[11px]">
              <input
                type="checkbox"
                className="h-3 w-3 accent-accent"
                checked={useGateDrop}
                onChange={(e) => setUseGateDrop(e.target.checked)}
              />
              <span className="text-fg">Use vertical gate drop</span>
            </label>
            <p className="text-[10px] text-muted/80">
              {useGateDrop
                ? 'Vertical 55 mm tube from runner plane to the gate point. Best for parts placed face-up.'
                : 'No drop. Runner enters the part directly at the gate. Best for horizontally-placed parts.'}
            </p>
          </section>

          {/* Demoulding direction — clicking a face on the part stores
              that face's outward normal as the mould-pull axis. The
              cavity surface is then re-coloured by draft angle: green
              positive draft (mouldable), yellow vertical wall, red
              undercut (needs slider / lifter). The undercut % flags
              parts where the chosen direction won't release cleanly. */}
          <section className="space-y-1.5 rounded-md border border-border/60 bg-bg/40 p-2">
            <span className="block font-semibold text-fg">Demoulding direction</span>
            <button
              type="button"
              onClick={() => setDemouldingPickActive(true)}
              disabled={demouldingPickActive}
              className={
                'w-full rounded border px-2 py-1.5 text-[11px] font-semibold ' +
                (demouldingPickActive
                  ? 'border-accent/80 bg-accent/25 text-accent'
                  : 'border-accent/60 bg-accent/15 text-accent hover:bg-accent/25')
              }
              title="Click a face on the part to set the mould-pull direction"
            >
              {demouldingPickActive ? 'Click a face on the part…' : 'Pick demoulding direction'}
            </button>
            {demouldingDir && (
              <div className="space-y-0.5 text-[10px]">
                <p className="text-muted">Picked normal (part-local)</p>
                <p className="num text-fg">
                  ({demouldingDir[0].toFixed(2)}, {demouldingDir[1].toFixed(2)}, {demouldingDir[2].toFixed(2)})
                </p>
              </div>
            )}
            {draftStats && (
              <div className="space-y-0.5 text-[10px]">
                <div className="flex items-center justify-between">
                  <span className="text-muted">Undercut area</span>
                  <span
                    className={
                      'num font-semibold ' +
                      (draftStats.undercutPct > 5 ? 'text-warn' : 'text-fg')
                    }
                  >
                    {draftStats.undercutPct.toFixed(1)} %
                  </span>
                </div>
                <p className="text-[10px] text-muted/80">
                  {draftStats.undercutPct === 0
                    ? 'No undercuts — part releases cleanly along this axis.'
                    : draftStats.undercutPct < 5
                    ? 'Minor undercuts — small slider or lifter likely sufficient.'
                    : 'Significant undercuts — major side-action mechanisms required.'}
                </p>
              </div>
            )}
            {demouldingDir && (
              <button
                type="button"
                onClick={() => setDemouldingDir(null)}
                className="w-full rounded border border-border bg-bg/60 px-2 py-1 text-[10px] text-muted hover:text-fg"
              >
                Clear
              </button>
            )}
          </section>

          {/* Gate-type selector — visualisation matches what the
              multi-cavity viewer will draw at the runner-to-part
              junction. Updates live in the runner preview above. */}
          <section className="space-y-1.5 rounded-md border border-border/60 bg-bg/40 p-2">
            <span className="block font-semibold text-fg">Gate type</span>
            <div className="grid grid-cols-3 gap-1">
              {(['direct', 'edge', 'pin', 'submarine', 'fan'] as const).map((t) => {
                const active = gateType === t;
                return (
                  <button
                    key={t}
                    type="button"
                    onClick={() => setGateType(t)}
                    title={GATE_TYPE_HELP[t]}
                    className={
                      'rounded border px-1.5 py-1 text-[10px] font-medium ' +
                      (active
                        ? 'border-accent/60 bg-accent/15 text-accent'
                        : 'border-border bg-bg/60 text-muted hover:text-fg')
                    }
                  >
                    {GATE_TYPE_LABEL[t].replace(/ \(.+\)$/, '')}
                  </button>
                );
              })}
            </div>
            <p className="text-[10px] text-muted/80">
              {GATE_TYPE_HELP[gateType]}
            </p>
          </section>

          {/* Quick-pick face centres + mirror buttons. Computed from
              the imported part's bounding box; saves the user from
              having to aim a click on the right face. */}
          <section className="space-y-1.5 rounded-md border border-border/60 bg-bg/40 p-2">
            <span className="block font-semibold text-fg">Quick gate placement</span>
            <p className="text-[10px] text-muted/80">
              Snap the gate to a face centre — useful when you know
              which face you want before clicking on the part.
            </p>
            <button
              type="button"
              onClick={onAutoSuggestGate}
              disabled={autoBusy}
              className={
                'w-full rounded border px-2 py-1.5 text-[11px] font-semibold transition-colors ' +
                (autoBusy
                  ? 'cursor-wait border-border bg-bg/40 text-muted'
                  : 'border-accent/60 bg-accent/15 text-accent hover:bg-accent/25')
              }
              title="Analyse part geometry and auto-pick the optimal gate location"
            >
              {autoBusy ? `Analysing… ${autoPct}%` : 'Auto-suggest gate'}
            </button>
            {autoError && (
              <p className="text-[10px] text-warn">{autoError}</p>
            )}
            {autoLtWarning && (
              <p className="text-[10px] text-warn">{autoLtWarning}</p>
            )}
            {(() => {
              const bbox = importedPart.geometry.bbox;
              const cxMm = (bbox.min[0] + bbox.max[0]) / 2;
              const czMm = (bbox.min[2] + bbox.max[2]) / 2;
              const yMaxMm = bbox.max[1];
              const xMinL = bbox.min[0] - cxMm;
              const xMaxL = bbox.max[0] - cxMm;
              const zMinL = bbox.min[2] - czMm;
              const zMaxL = bbox.max[2] - czMm;
              const yMinL = bbox.min[1] - yMaxMm;
              const yMidL = yMinL / 2;
              const faces: { label: string; pt: [number, number, number] }[] = [
                { label: 'Top',    pt: [0, 0, 0] },
                { label: 'Bottom', pt: [0, yMinL, 0] },
                { label: '−X',     pt: [xMinL, yMidL, 0] },
                { label: '+X',     pt: [xMaxL, yMidL, 0] },
                { label: '−Z',     pt: [0, yMidL, zMinL] },
                { label: '+Z',     pt: [0, yMidL, zMaxL] },
              ];
              return (
                <div className="grid grid-cols-3 gap-1">
                  {faces.map((f) => (
                    <button
                      key={f.label}
                      type="button"
                      onClick={() => setGatePoint(f.pt)}
                      className="rounded border border-border bg-bg/60 px-1 py-1 text-[10px] font-medium text-muted hover:text-fg"
                      title={`Gate at ${f.label} face centre`}
                    >
                      {f.label}
                    </button>
                  ))}
                </div>
              );
            })()}
            {gatePoint && (
              <div className="grid grid-cols-3 gap-1 pt-1">
                <button
                  type="button"
                  onClick={() => setGatePoint([-gatePoint[0], gatePoint[1], gatePoint[2]])}
                  className="rounded border border-info/60 bg-info/15 px-1 py-1 text-[10px] font-medium text-info hover:bg-info/25"
                  title="Mirror gate across X axis (flip x)"
                >
                  Mirror X
                </button>
                <button
                  type="button"
                  onClick={() => setGatePoint([gatePoint[0], gatePoint[1], -gatePoint[2]])}
                  className="rounded border border-info/60 bg-info/15 px-1 py-1 text-[10px] font-medium text-info hover:bg-info/25"
                  title="Mirror gate across Z axis (flip z)"
                >
                  Mirror Z
                </button>
                <button
                  type="button"
                  onClick={() => setGatePoint([-gatePoint[0], gatePoint[1], -gatePoint[2]])}
                  className="rounded border border-info/60 bg-info/15 px-1 py-1 text-[10px] font-medium text-info hover:bg-info/25"
                  title="Mirror gate across both axes (180° around Y)"
                >
                  Mirror XZ
                </button>
              </div>
            )}
          </section>

          <section className="space-y-1.5 rounded-md border border-border/60 bg-bg/40 p-2">
            <span className="block font-semibold text-fg">Gate point</span>
            {gatePoint ? (
              <>
                <p className="text-[10px] text-muted">
                  Picked at part-local
                </p>
                <p className="num text-[11px] text-fg">
                  ({gatePoint[0].toFixed(1)}, {gatePoint[1].toFixed(1)}, {gatePoint[2].toFixed(1)}) mm
                </p>
                {/* Distance from each AABB face — helps the user verify
                    the gate sits where they expect (e.g. 5 mm from the
                    edge means there'll be 5 mm of wall around the gate). */}
                {(() => {
                  const bbox = importedPart.geometry.bbox;
                  const cxMm = (bbox.min[0] + bbox.max[0]) / 2;
                  const czMm = (bbox.min[2] + bbox.max[2]) / 2;
                  const yMaxMm = bbox.max[1];
                  const W = bbox.max[0] - bbox.min[0];
                  const D = bbox.max[2] - bbox.min[2];
                  const H = yMaxMm - bbox.min[1];
                  // gate is in (xCentred, yTop=0, zCentred) frame.
                  const fmtX = ((W / 2 + gatePoint[0])).toFixed(1);
                  const fpX = ((W / 2 - gatePoint[0])).toFixed(1);
                  const fmtZ = ((D / 2 + gatePoint[2])).toFixed(1);
                  const fpZ = ((D / 2 - gatePoint[2])).toFixed(1);
                  // y is offset from AABB top (≤ 0). Distance from top = -y;
                  // distance from bottom = H + y.
                  const fmTop = (-gatePoint[1]).toFixed(1);
                  const fmBot = (H + gatePoint[1]).toFixed(1);
                  void cxMm; void czMm;
                  return (
                    <div className="grid grid-cols-2 gap-x-2 gap-y-0.5 text-[10px] text-muted/80">
                      <span>−X face</span><span className="num text-right text-fg">{fmtX} mm</span>
                      <span>+X face</span><span className="num text-right text-fg">{fpX} mm</span>
                      <span>Top</span>    <span className="num text-right text-fg">{fmTop} mm</span>
                      <span>Bottom</span> <span className="num text-right text-fg">{fmBot} mm</span>
                      <span>−Z face</span><span className="num text-right text-fg">{fmtZ} mm</span>
                      <span>+Z face</span><span className="num text-right text-fg">{fpZ} mm</span>
                    </div>
                  );
                })()}
                <button
                  type="button"
                  onClick={() => setGatePoint(null)}
                  className="rounded border border-border bg-bg/60 px-2 py-1 text-[10px] text-muted hover:text-fg"
                >
                  Clear gate
                </button>
              </>
            ) : (
              <p className="text-[10px] text-muted/80">
                Click on the part to set the gate. Hover position:
                {hoverCoords ? (
                  <span className="num ml-1 text-fg">
                    ({hoverCoords[0].toFixed(1)}, {hoverCoords[1].toFixed(1)}, {hoverCoords[2].toFixed(1)})
                  </span>
                ) : (
                  <span className="ml-1 text-muted">—</span>
                )}
              </p>
            )}
          </section>

          {/* Layout preview — top-down schematic of the multi-cavity
              layout with the current rotation applied. Updates live as
              the user changes the gate, the orientation, or any panel
              setting that affects the layout. */}
          {layoutPreview && (
            <section className="space-y-1.5 rounded-md border border-border/60 bg-bg/40 p-2">
              <div className="flex items-center justify-between">
                <span className="font-semibold text-fg">Layout preview</span>
                <span className="text-[10px] text-muted/70">
                  {calc.tree.cavities.length} cav · top view
                </span>
              </div>
              <svg
                viewBox={`0 0 ${layoutPreview.svgW} ${layoutPreview.svgH}`}
                width="100%"
                role="img"
                aria-label="Multi-cavity layout top view"
                className="block rounded border border-border/60 bg-bg/80"
              >
                {/* Runner edges */}
                {layoutPreview.runners.map((r) => (
                  <line
                    key={r.id}
                    x1={r.x1} y1={r.y1} x2={r.x2} y2={r.y2}
                    stroke="#3b82f6" strokeWidth={1} strokeOpacity={0.6}
                  />
                ))}
                {/* Drop bridges — angled connectors from the straight
                    runner to the rotated part's gate corner. Dashed
                    amber to distinguish them from the cardinal runner. */}
                {layoutPreview.drops.map((d) => (
                  <line
                    key={d.id}
                    x1={d.x1} y1={d.y1} x2={d.x2} y2={d.y2}
                    stroke="#fbbf24"
                    strokeWidth={0.8}
                    strokeOpacity={0.8}
                    strokeDasharray="2 1.5"
                  />
                ))}
                {/* Cavity rectangles + gate dots. Click a cavity to
                    toggle its Y flip — fastest way to fix one cavity
                    in the preview without scrolling the per-cavity
                    flip list. Cavities with manual overrides get an
                    amber border. */}
                {layoutPreview.cavities.map((c) => (
                  <g
                    key={c.id}
                    transform={`translate(${c.cx},${c.cy}) rotate(${c.rotateDeg})`}
                    style={{ cursor: 'pointer' }}
                    onClick={() => flipCavityRotation(c.id, 'y')}
                  >
                    <rect
                      x={-layoutPreview.partWPx / 2}
                      y={-layoutPreview.partDPx / 2}
                      width={layoutPreview.partWPx}
                      height={layoutPreview.partDPx}
                      fill="#1f2937"
                      stroke={c.flipped ? '#fbbf24' : '#9ca3af'}
                      strokeWidth={c.flipped ? 1 : 0.5}
                    />
                    {c.gateLocalPx && (
                      <circle
                        cx={c.gateLocalPx.x}
                        cy={c.gateLocalPx.y}
                        r={2.5}
                        fill="#22c55e"
                      />
                    )}
                    <text
                      x={0}
                      y={4}
                      textAnchor="middle"
                      fill="#9ca3af"
                      fontSize="9"
                      style={{ pointerEvents: 'none' }}
                    >
                      {c.id}
                    </text>
                  </g>
                ))}
                {/* Sprue marker */}
                <circle
                  cx={layoutPreview.sprueCx}
                  cy={layoutPreview.sprueCy}
                  r={3.5}
                  fill="#f97316"
                  stroke="#1f2937"
                  strokeWidth={0.8}
                />
              </svg>
              <p className="text-[10px] text-muted/70">
                Click a cavity to flip · green = gates · orange = sprue · amber border = flipped.
              </p>
              <dl className="grid grid-cols-2 gap-x-2 gap-y-0.5 text-[10px]">
                <dt className="text-muted">Layout extent</dt>
                <dd className="num text-right text-fg">
                  {Math.round(layoutPreview.layoutWMm)} × {Math.round(layoutPreview.layoutDMm)} mm
                </dd>
                <dt className="text-muted">Total runner</dt>
                <dd className="num text-right text-fg">
                  {Math.round(layoutPreview.totalRunnerMm)} mm
                </dd>
              </dl>
            </section>
          )}

          {/* Per-cavity manual flips. Click Flip H to mirror a cavity
              top-bottom (180° around X), Flip V to mirror left-right
              (180° around Y). Clear to revert that cavity to the
              auto-mirror default. Useful when the auto-rotation isn't
              what you want for a specific cavity instance. */}
          {layoutPreview && layoutPreview.cavities.length > 0 && (
            <section className="space-y-1.5 rounded-md border border-border/60 bg-bg/40 p-2">
              <div className="flex items-center justify-between">
                <span className="font-semibold text-fg">Per-cavity flips</span>
                <button
                  type="button"
                  onClick={clearCavityRotations}
                  disabled={Object.keys(cavityRotationOverrides).length === 0}
                  className="rounded border border-border bg-bg/60 px-1.5 py-0.5 text-[10px] text-muted hover:text-fg disabled:cursor-not-allowed disabled:opacity-40"
                >
                  Reset all
                </button>
              </div>
              <div className="max-h-48 space-y-1 overflow-y-auto pr-1">
                {layoutPreview.cavities.map((c) => {
                  const ov = cavityRotationOverrides[c.id];
                  const dirty = !!ov && (ov.x !== 0 || ov.y !== 0);
                  return (
                    <div key={c.id} className="flex items-center gap-1 text-[10px]">
                      <span className="num w-6 text-muted">C{c.id}</span>
                      <button
                        type="button"
                        onClick={() => flipCavityRotation(c.id, 'x')}
                        className={
                          'flex-1 rounded border px-1.5 py-0.5 ' +
                          (ov?.x
                            ? 'border-warn/60 bg-warn/15 text-warn'
                            : 'border-border bg-bg/60 text-muted hover:text-fg')
                        }
                        title="Flip top-bottom (180° around X)"
                      >
                        Flip H
                      </button>
                      <button
                        type="button"
                        onClick={() => flipCavityRotation(c.id, 'y')}
                        className={
                          'flex-1 rounded border px-1.5 py-0.5 ' +
                          (ov?.y
                            ? 'border-warn/60 bg-warn/15 text-warn'
                            : 'border-border bg-bg/60 text-muted hover:text-fg')
                        }
                        title="Flip left-right (180° around Y)"
                      >
                        Flip V
                      </button>
                      <button
                        type="button"
                        onClick={() => resetCavityRotation(c.id)}
                        disabled={!dirty}
                        className="rounded border border-border bg-bg/60 px-1 py-0.5 text-muted hover:text-fg disabled:cursor-not-allowed disabled:opacity-30"
                        title="Reset cavity rotation"
                      >
                        ×
                      </button>
                    </div>
                  );
                })}
              </div>
            </section>
          )}

          <section className="mt-auto space-y-1 rounded-md border border-border/60 bg-bg/40 p-2 text-[10px] text-muted/80">
            <span className="block font-semibold text-fg">Tips</span>
            <ul className="list-inside list-disc space-y-0.5">
              <li>Drag rotates the camera, not the part.</li>
              <li>Use the buttons above to flip the part itself.</li>
              <li>The picked gate stays anchored as you rotate.</li>
              <li>Scroll to zoom in for tight features.</li>
            </ul>
          </section>
        </aside>

        <div
          ref={mountRef}
          className="relative min-w-0 flex-1 cursor-crosshair"
          onPointerDown={onPointerDown}
          onPointerUp={onPointerUp}
          onPointerMove={onPointerMove}
          onPointerLeave={onPointerUp}
          onWheel={onWheel}
          onContextMenu={(e) => e.preventDefault()}
        />
      </div>
    </div>
  );
}

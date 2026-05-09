import * as THREE from 'three';
import type { CalcResult, RunnerProfile } from '@runner/core';
import type { ImportedPart } from '@/lib/occt';
import type { GateType } from '@/state/store';
import { buildGateTip } from '@/lib/gateGeometry';
import { draftAnglesFromMesh, vertexColorsForDraft } from '@/lib/draft';

/**
 * Converts the calculation pipeline's RunnerTree + CavityOverlap data
 * into a Three.js scene that matches the HTML prototype visually.
 *
 * Positions inside the tree are in millimetres; we divide by 10 so that
 * 1 scene unit = 10 mm (matching the HTML's original coordinate frame).
 */

export type HeatmapMode = 'off' | 'fill' | 'flow' | 'pressure' | 'dia' | 'balance';

export interface HeatmapData {
  /** Cavity.id → (t_i − mean) / mean — drives FILL mode cavity colour. */
  fillDeviationByCavity?: Map<number, number>;
  /** Edge.id → volumetric flow Q (mm³/s) — drives FLOW mode edge colour. */
  flowByEdge?: Map<number, number>;
  /** Edge.id → ΔP (MPa) — drives PRESSURE mode edge colour. */
  pressureByEdge?: Map<number, number>;
  /** Edge.id → current Ø ÷ recommended Ø — drives DIA mode edge colour.
   *  1.0 = on-target, < 1 = undersized, > 1 = oversized. */
  diaRatioByEdge?: Map<number, number>;
  /** True when σ(t_fill) < 2 % — drives BALANCE mode (uniform colour). */
  balanceOk?: boolean;
}

export interface BuildSceneOptions {
  profile: RunnerProfile;
  hotRunner: boolean;
  showDims: boolean;
  gatesPerCavity: 1 | 2;
  partWidthMm: number;
  partDepthMm: number;
  partHeightMm: number;
  heatmapMode?: HeatmapMode;
  heatmapData?: HeatmapData;
  /**
   * If set, render this triangulated part once per cavity instead of the
   * placeholder box. Each cavity gets its own `THREE.Mesh` so the gate
   * picker can raycast against it without sharing materials/userData.
   */
  importedPart?: ImportedPart | null;
  /**
   * Picked gate point in part-local mm (AABB-centred X/Z, AABB top at
   * Y=0). Only consumed here for rotation pivot and drop-off placement;
   * the calc pipeline owns the runner-side effects of the gate.
   */
  gatePoint?: [number, number, number] | null;
  /**
   * Per-axis rotation (degrees) applied to every cavity instance, around
   * the gate point. Lets the user flip / rotate the part for layout
   * efficiency while keeping the runner connection invariant.
   */
  partRotation?: { x: number; y: number; z: number };
  /**
   * False = no vertical drop tube; the gate point sits at the runner
   * plane and the part is positioned so the gate is exactly there. Drop
   * length is 0 mm in the calc, no drop cylinder is drawn.
   */
  useGateDrop?: boolean;
  /**
   * When true, each cavity gets a per-instance Y rotation (quantised to
   * 0/90/180/270°, around the gate point) so the part's gate side faces
   * the sprue. Goal: minimum sub-runner length per cavity. The simpler
   * "flip every -X cavity" rule was wrong — the correct mirror axis
   * depends on which quadrant the cavity sits in *and* where the gate
   * is on the part, so we compute it per cavity.
   */
  autoMirrorParts?: boolean;
  /**
   * Per-cavity rotation overrides (degrees), applied ON TOP of the
   * auto-mirror rotation. Pivot is the gate point so flipping a cavity
   * doesn't move the runner network. Keyed by `cavity.id`.
   */
  cavityRotationOverrides?: Record<number, { x: number; y: number }>;
  /**
   * Selected gate-type flavour. Drives the geometry rendered at the
   * runner-to-part junction (cone for direct, rectangular block for
   * edge, thin cylinder for pin, angled tube for submarine, fan-shaped
   * trapezoid for fan).
   */
  gateType?: GateType;
  /**
   * Demoulding direction in part-local frame, unit vector. When set,
   * the cavity meshes are rendered with a green / yellow / red draft
   * heatmap. Null = default slate phong material on every cavity.
   */
  demouldingDir?: [number, number, number] | null;
}

export interface CavityMeshMeta {
  isCavity: true;
  cavityId: number;
  /**
   * World position of the picked gate point on this specific cavity
   * instance (in scene units). Stashed here because the cavity mesh's
   * position is the rotation-pivot-adjusted origin, not the gate.
   * Viewer3D consumes this to render the persistent gate marker.
   */
  gateWorld?: { x: number; y: number; z: number };
}

export interface RunnerMeshMeta {
  isRunner: true;
  isSprue?: boolean;
  isGate?: boolean;
  isDrop?: boolean;
  /** Tree edge.id — only set for actual runner edges, not sprue/gate/drop. */
  edgeId?: number;
  levelKey: string;
  levelName: string;
  diaMm: number;
  lenMm: number;
  r: number;
  _origMat: THREE.Material;
  _selected?: boolean;
}

export interface BuildSceneResult {
  scene: THREE.Scene;
  runnerMeshes: THREE.Mesh[];
  /** Cavity meshes — populated whether or not an imported part is in use. */
  cavityMeshes: THREE.Mesh[];
}

const MM_PER_UNIT = 10;

export function buildSceneFromCalc(calc: CalcResult, opts: BuildSceneOptions): BuildSceneResult {
  const scene = new THREE.Scene();

  // Lighting
  scene.add(new THREE.AmbientLight(0xffffff, 0.45));
  const dirA = new THREE.DirectionalLight(0xffffff, 0.7);
  dirA.position.set(25, 35, 20);
  scene.add(dirA);
  const dirB = new THREE.DirectionalLight(0xffffff, 0.35);
  dirB.position.set(-20, 25, -15);
  scene.add(dirB);
  const dirC = new THREE.DirectionalLight(0xffffff, 0.15);
  dirC.position.set(0, -20, 0);
  scene.add(dirC);

  if (calc.tree.edges.length === 0) return { scene, runnerMeshes: [], cavityMeshes: [] };

  const runnerMeshes: THREE.Mesh[] = [];

  const RZ = 0;
  const cavH = opts.partHeightMm / MM_PER_UNIT;
  const sprTop = 12;

  const levelKeys = Array.from(new Set(calc.tree.edges.map((e) => e.levelKey))).sort();
  // Palette aligned with design-tokens: hot-runner = warn family, cold = cool family
  const levelColors = opts.hotRunner
    ? [0xf59e0b, 0xd97706, 0xb45309, 0x92400e, 0x78350f, 0x5a2a0a]
    : [0x38bdf8, 0x22d3ee, 0x22c55e, 0x10b981, 0x4ade80, 0x65a30d];
  const levelMats = new Map<string, THREE.MeshPhongMaterial>();
  levelKeys.forEach((key, i) => {
    const col = levelColors[i % levelColors.length]!;
    levelMats.set(
      key,
      new THREE.MeshPhongMaterial({ color: col, shininess: 60, specular: 0x222222 }),
    );
  });

  const juncMat = new THREE.MeshPhongMaterial({
    color: opts.hotRunner ? 0xf06030 : 0x35a835,
    shininess: 50,
  });
  const gateMat = new THREE.MeshPhongMaterial({
    color: 0xeab308,
    shininess: 80,
    specular: 0x443300,
  });
  const cavMat = new THREE.MeshPhongMaterial({
    color: 0x505050,
    shininess: 25,
    specular: 0x222222,
  });
  // Used in place of cavMat when a demoulding direction is set. White
  // base + vertexColors makes the per-vertex draft heatmap visible
  // without tinting from the material colour.
  const cavDraftMat = new THREE.MeshPhongMaterial({
    color: 0xffffff,
    shininess: 25,
    specular: 0x222222,
    vertexColors: true,
  });
  const cavOverlapMat = new THREE.MeshPhongMaterial({
    color: 0xcc1111,
    shininess: 40,
    specular: 0x441111,
    emissive: 0x880000,
  });
  const sprMat = new THREE.MeshPhongMaterial({
    color: 0xcc3333,
    shininess: 70,
    specular: 0x441111,
  });
  const sprBaseMat = new THREE.MeshPhongMaterial({
    color: opts.hotRunner ? 0xe05020 : 0x2e8b2e,
    shininess: 60,
  });

  function addSegment(
    x1: number,
    z1: number,
    x2: number,
    z2: number,
    rScene: number,
    mat: THREE.Material,
    meta?: Omit<RunnerMeshMeta, '_origMat'>,
  ): void {
    const dx = x2 - x1;
    const dz = z2 - z1;
    const len = Math.sqrt(dx * dx + dz * dz);
    if (len < 0.05) return;

    let geo: THREE.BufferGeometry;
    if (opts.profile === 'hex') {
      geo = new THREE.CylinderGeometry(rScene, rScene, len, 6);
    } else if (opts.profile === 'trapez' || opts.profile === 'mod_trapez') {
      geo = new THREE.CylinderGeometry(rScene * 0.7, rScene, len, 4);
    } else if (opts.profile === 'half_round') {
      geo = new THREE.CylinderGeometry(rScene, rScene, len, 14, 1, false, 0, Math.PI);
    } else {
      geo = new THREE.CylinderGeometry(rScene, rScene, len, 14);
    }

    const m = new THREE.Mesh(geo, mat);
    m.position.set((x1 + x2) / 2, RZ, (z1 + z2) / 2);
    const dir = new THREE.Vector3(dx, 0, dz).normalize();
    m.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), dir);
    if (meta) {
      const md: RunnerMeshMeta = { ...meta, _origMat: mat };
      m.userData = md;
      runnerMeshes.push(m);
    }
    scene.add(m);
  }

  // Edges (runners) — also tracks the max edge radius at each endpoint so
  // junction spheres can be sized to fully cover the cylinders meeting there.
  // Junction sphere tracker: at every unique cylinder endpoint on the
  // runner plane we drop a small sphere so the seams between meeting
  // cylinders are hidden behind a smooth bead. The sphere wears the
  // material of the LARGEST cylinder meeting at that point so it reads
  // as a continuation of that cylinder rather than a separate node.
  const ptKey = (x: number, z: number) => `${x.toFixed(1)}|${z.toFixed(1)}`;
  const junctionRadius = new Map<string, number>();
  const junctionMatByKey = new Map<string, THREE.Material>();
  const noteEndpoint = (x: number, z: number, r: number, mat: THREE.Material) => {
    const k = ptKey(x, z);
    const prev = junctionRadius.get(k) ?? 0;
    if (r > prev) {
      junctionRadius.set(k, r);
      junctionMatByKey.set(k, mat);
    }
  };

  // Edge colouring is heat-map-aware. In FLOW / PRESSURE / DIA modes the
  // segment colour reflects the chosen physical quantity; otherwise the
  // existing per-level palette is used.
  const heatMode = opts.heatmapMode ?? 'off';
  const heatData = opts.heatmapData;
  const flowRange = computeRange(heatData?.flowByEdge);
  const dpRange = computeRange(heatData?.pressureByEdge);
  const balanceMat = new THREE.MeshPhongMaterial({
    color: heatData?.balanceOk ? 0x22c55e : 0xef4444,
    shininess: 60,
    specular: 0x222222,
  });

  // ---- Drop xz clearance ----
  // For each cavity, compute how far OUTWARD (along upstream→junction
  // direction) the drop's xz must shift so the drop cylinder body —
  // including its own radius and a 2 mm clearance — clears the part's
  // axis-aligned bounding box. After auto-mirror snap, the part is
  // axis-aligned with W × D footprint centred on (cav.x, cav.z); the
  // junction lives along a cardinal axis from cav. With corner gates
  // on parts where r ≈ part half-extent, the drop centerline can be
  // just barely outside the part edge, so the cylinder body still
  // overlaps the part. The shift extends the runner edge + drop xz
  // until clearance is satisfied. Stored in scene units.
  const PART_CLEARANCE_MM = 2;
  const PART_CLEARANCE_SCN = PART_CLEARANCE_MM / MM_PER_UNIT;
  const partWScn = opts.partWidthMm / MM_PER_UNIT;
  const partDScn = opts.partDepthMm / MM_PER_UNIT;
  const dropShiftByCavity = new Map<number, { dx: number; dz: number }>();
  const cavityByJunctionId = new Map<number, number>();
  for (const cavP of calc.tree.cavities) {
    const cavNodeP = calc.tree.nodes.find(
      (n) => n.kind === 'cavity' && n.cavityId === cavP.id,
    );
    if (!cavNodeP) continue;
    const dropEdgeP = calc.tree.edges.find(
      (e) => e.isDrop && e.childNodeId === cavNodeP.id,
    );
    if (!dropEdgeP) continue;
    const jxnP = calc.tree.nodes.find((n) => n.id === dropEdgeP.parentNodeId);
    if (!jxnP) continue;
    cavityByJunctionId.set(jxnP.id, cavP.id);

    const dxScn = (jxnP.x - cavP.x) / MM_PER_UNIT;
    const dzScn = (jxnP.z - cavP.z) / MM_PER_UNIT;
    const distScn = Math.hypot(dxScn, dzScn);
    if (distScn < 1e-3) continue;
    const ux = dxScn / distScn;
    const uz = dzScn / distScn;

    // Axis-aligned half-extent in (ux, uz) direction from cav centre:
    //   t = min((W/2)/|ux|, (D/2)/|uz|), with a divide-by-zero guard.
    const ax = Math.abs(ux);
    const az = Math.abs(uz);
    let partExtent = Infinity;
    if (ax > 1e-6) partExtent = Math.min(partExtent, (partWScn / 2) / ax);
    if (az > 1e-6) partExtent = Math.min(partExtent, (partDScn / 2) / az);
    if (!isFinite(partExtent)) continue;

    const dRScn = (dropEdgeP.diaMm / 2) / MM_PER_UNIT;
    const requiredDist = partExtent + dRScn + PART_CLEARANCE_SCN;
    const shortfall = requiredDist - distScn;
    if (shortfall > 0) {
      dropShiftByCavity.set(cavP.id, { dx: ux * shortfall, dz: uz * shortfall });
    }
  }

  for (const edge of calc.tree.edges) {
    // Drop edges are rendered separately in the gates loop below as a
    // 3D-angled tube from junction to cavity_node, plus gate tip.
    if (edge.isDrop) continue;
    const parent = calc.tree.nodes.find((n) => n.id === edge.parentNodeId);
    const child = calc.tree.nodes.find((n) => n.id === edge.childNodeId);
    if (!parent || !child) continue;
    const x1 = parent.x / MM_PER_UNIT;
    const z1 = parent.z / MM_PER_UNIT;
    let x2 = child.x / MM_PER_UNIT;
    let z2 = child.z / MM_PER_UNIT;
    const rScene = edge.diaMm / 2 / MM_PER_UNIT;

    // If this edge ends at a drop junction whose drop has been pushed
    // OUTWARD for part-clearance, extend the rendered cylinder to the
    // shifted endpoint so the runner stays continuous with the drop.
    const cavIdAtEnd = cavityByJunctionId.get(edge.childNodeId);
    const shift = cavIdAtEnd !== undefined
      ? dropShiftByCavity.get(cavIdAtEnd)
      : undefined;
    if (shift) {
      x2 += shift.dx;
      z2 += shift.dz;
    }

    let mat = levelMats.get(edge.levelKey) ?? new THREE.MeshPhongMaterial({ color: 0x2e8b2e });
    if (heatMode === 'flow' && heatData?.flowByEdge && flowRange) {
      mat = phong(heatColor(heatData.flowByEdge.get(edge.id) ?? 0, flowRange));
    } else if (heatMode === 'pressure' && heatData?.pressureByEdge && dpRange) {
      mat = phong(heatColor(heatData.pressureByEdge.get(edge.id) ?? 0, dpRange));
    } else if (heatMode === 'dia' && heatData?.diaRatioByEdge) {
      const ratio = heatData.diaRatioByEdge.get(edge.id) ?? 1;
      mat = phong(diaRatioColor(ratio));
    } else if (heatMode === 'balance') {
      mat = balanceMat;
    }
    addSegment(x1, z1, x2, z2, rScene, mat, {
      isRunner: true,
      edgeId: edge.id,
      levelKey: edge.levelKey,
      levelName: edge.levelName,
      diaMm: edge.diaMm,
      lenMm: edge.lenMm,
      r: rScene,
    });
    noteEndpoint(x1, z1, rScene, mat);
    noteEndpoint(x2, z2, rScene, mat);
  }

  // Gates — cone + drop cylinder under each cavity. Drop dia/len now
  // come from per-cavity drop EDGES in the runner tree (isDrop = true,
  // child = cavity node), so each cavity can carry an independent
  // diameter set by the auto-balance solver. Falls back to legacy
  // defaults for any cavity whose layout hasn't been migrated yet.
  const DROP_DEFAULT_DIA_MM = 6;
  const DROP_DEFAULT_LEN_MM = 55;
  const dropEnabled = opts.useGateDrop !== false; // undefined ⇒ enabled
  const dropEdgeByCavityNodeId = new Map<number, typeof calc.tree.edges[number]>();
  for (const e of calc.tree.edges) {
    if (e.isDrop) dropEdgeByCavityNodeId.set(e.childNodeId, e);
  }

  const gatesPerCavity = opts.gatesPerCavity;
  for (const cav of calc.tree.cavities) {
    const cavNode = calc.tree.nodes.find(
      (n) => n.kind === 'cavity' && n.cavityId === cav.id,
    );
    const dropEdge = cavNode ? dropEdgeByCavityNodeId.get(cavNode.id) : undefined;
    const dropParent = dropEdge
      ? calc.tree.nodes.find((n) => n.id === dropEdge.parentNodeId)
      : undefined;
    const dropDiaMm = dropEdge?.diaMm ?? DROP_DEFAULT_DIA_MM;
    const dropLenMm = dropEdge?.lenMm ?? DROP_DEFAULT_LEN_MM;
    const dropR       = dropDiaMm / 2 / MM_PER_UNIT;
    const dropLenScn  = dropLenMm / MM_PER_UNIT;

    // Drop endpoints:
    //   • Top = parent (gate junction) on the runner plane. With auto-
    //     mirror + corner gate the pipeline pins the junction to the
    //     cardinal axis from upstream — so the runner stays straight.
    //   • Bottom = cavity node, which after pipeline rotation sits over
    //     the gate corner of the axis-aligned part.
    // The two can differ horizontally — the drop becomes a 3D-angled
    // bridge (the gate connector) rather than a vertical tube.
    const cx = (cavNode?.x ?? cav.x) / MM_PER_UNIT;
    const cz = (cavNode?.z ?? cav.z) / MM_PER_UNIT;
    // Apply the precomputed outward shift (if any) so the drop's xz
    // sits OUTSIDE the part bounding box with PART_CLEARANCE_MM
    // margin. The shift was computed from the part dimensions and
    // dropR; the runner-edge for-loop above already extended the
    // parent edge to the same shifted endpoint.
    const cavShift = dropShiftByCavity.get(cav.id);
    const shiftDx = cavShift?.dx ?? 0;
    const shiftDz = cavShift?.dz ?? 0;
    const jxnX = (dropParent?.x ?? cavNode?.x ?? cav.x) / MM_PER_UNIT + shiftDx;
    const jxnZ = (dropParent?.z ?? cavNode?.z ?? cav.z) / MM_PER_UNIT + shiftDz;
    const offsets = gatesPerCavity === 2 ? [-1.2, 1.2] : [0];
    for (const ox of offsets) {
      const gx = cx + ox;
      const gz = cz;
      if (gatesPerCavity === 2 && ox !== 0) {
        addSegment(cx, cz, gx, gz, 0.18, juncMat);
        const gj = new THREE.Mesh(new THREE.SphereGeometry(0.3, 8, 8), juncMat);
        gj.position.set(gx, RZ, gz);
        scene.add(gj);
      }
      // ---- No-drop mode ----
      // The user has disabled the vertical drop. The runner channel is
      // expected to enter the part horizontally at gate level, so the
      // part top sits AT runner-plane height (partTopY = RZ + |gy|/u
      // is computed in the cavity-mesh block). We render:
      //   • a horizontal connector at runner plane from the cardinal
      //     junction to the gate point on the part edge
      //   • the gate tip at the gate point, body extending TOWARD the
      //     part interior (= away from the runner)
      // The gate tip is the only element that touches the part wall.
      if (!dropEnabled) {
        const noDropUserData: RunnerMeshMeta = {
          isRunner: true,
          isDrop: true,
          edgeId: dropEdge?.id,
          levelKey: dropEdge?.levelKey ?? 'L_drop',
          levelName: 'Gate Drop',
          diaMm: dropDiaMm,
          lenMm: dropLenMm,
          r: dropR,
          _origMat: gateMat,
        };
        const connStart = new THREE.Vector3(jxnX + ox, RZ, jxnZ);
        const connEnd = new THREE.Vector3(gx, RZ, gz);
        const connLen = connStart.distanceTo(connEnd);
        if (connLen > 1e-3) {
          const horizGeo = new THREE.CylinderGeometry(dropR, dropR, connLen, 14);
          const horizMesh = new THREE.Mesh(horizGeo, gateMat);
          horizMesh.position.set(
            (connStart.x + connEnd.x) / 2,
            RZ,
            (connStart.z + connEnd.z) / 2,
          );
          const horizDir = connEnd.clone().sub(connStart).normalize();
          horizMesh.quaternion.setFromUnitVectors(
            new THREE.Vector3(0, 1, 0),
            horizDir,
          );
          horizMesh.userData = noDropUserData;
          runnerMeshes.push(horizMesh);
          scene.add(horizMesh);
        }

        // Note the runner-side endpoint so the runner-plane junction
        // sphere covers the seam between the parent runner and the
        // horizontal connector. (The sphere will pick max parent R.)
        noteEndpoint(connStart.x, connStart.z, dropR, gateMat);

        // Gate tip at the gate point. Body extends TOWARD the part
        // interior — direction = (cavity_centre − gate_point) in xz.
        // Helper builds body in local −Y; align local −Y with that
        // world direction so the cone narrows into the part.
        const partInteriorDir = new THREE.Vector3(
          cav.x / MM_PER_UNIT - connEnd.x,
          0,
          cav.z / MM_PER_UNIT - connEnd.z,
        );
        const gateTypeNoDrop: GateType = opts.gateType ?? 'direct';
        const gateTipNoDrop = buildGateTip({
          type: gateTypeNoDrop, r: dropR, material: gateMat,
        });
        gateTipNoDrop.group.position.copy(connEnd);
        if (partInteriorDir.lengthSq() > 1e-9) {
          partInteriorDir.normalize();
          gateTipNoDrop.group.quaternion.setFromUnitVectors(
            new THREE.Vector3(0, -1, 0),
            partInteriorDir,
          );
        }
        gateTipNoDrop.group.traverse((obj) => {
          if (obj instanceof THREE.Mesh) {
            obj.userData = {
              isRunner: true,
              isGate: true,
              levelKey: 'gate',
              levelName: `Gate (${gateTypeNoDrop})`,
              diaMm: dropDiaMm,
              lenMm: dropLenMm,
              r: dropR,
              _origMat: gateMat,
            } as RunnerMeshMeta;
            runnerMeshes.push(obj);
          }
        });
        scene.add(gateTipNoDrop.group);
        continue;
      }

      // L-shape drop. Real injection moulds DON'T tilt the drop tube —
      // the vertical drop is purely along Y from runner plane to part
      // top, and any horizontal offset between the cardinal junction
      // and the actual gate point on the part is bridged by a SHORT
      // HORIZONTAL CONNECTOR. The gate tip (rendered last) is the
      // only element that crosses the part's outer surface.
      //
      // Clearance rule: the runner channel — vertical drop AND
      // horizontal connector — must stay at least PART_CLEARANCE_MM
      // away from the part wall. The connector centerline alone is not
      // enough: the cylinder body extends radially by dropR around the
      // centerline, and the L-corner sphere by dropR × 1.2. So the
      // L-corner Y must clear the part top by `clearance + sphere_R`
      // (the larger of the two), guaranteeing every renderable point
      // on the connector / sphere sits at least clearance above the
      // part. The gate tip then spans the gap down to the gate point.
      const PART_CLEARANCE_MM = 2;
      const cornerSphereR = dropR * 1.2;
      const partTopY = RZ - DROP_DEFAULT_LEN_MM / MM_PER_UNIT;
      const lCornerY = partTopY
        + (PART_CLEARANCE_MM / MM_PER_UNIT)
        + Math.max(dropR, cornerSphereR);
      const dropTopPt = new THREE.Vector3(jxnX + ox, RZ, jxnZ);
      const dropBotPt = new THREE.Vector3(jxnX + ox, lCornerY, jxnZ);
      const gateEndPt = new THREE.Vector3(gx, lCornerY, gz);
      const verticalScn = RZ - lCornerY;
      const horizontalScn = dropBotPt.distanceTo(gateEndPt);

      // Vertical leg — pure +Y axis, no rotation needed.
      const dropMeshUserData: RunnerMeshMeta = {
        isRunner: true,
        isDrop: true,
        edgeId: dropEdge?.id,
        levelKey: dropEdge?.levelKey ?? 'L_drop',
        levelName: 'Gate Drop',
        diaMm: dropDiaMm,
        lenMm: dropLenMm,
        r: dropR,
        _origMat: gateMat,
      };
      const vertGeo = new THREE.CylinderGeometry(dropR, dropR, verticalScn, 14);
      const vertMesh = new THREE.Mesh(vertGeo, gateMat);
      vertMesh.position.set(dropTopPt.x, (RZ + partTopY) / 2, dropTopPt.z);
      vertMesh.userData = dropMeshUserData;
      runnerMeshes.push(vertMesh);
      scene.add(vertMesh);

      // Horizontal connector at part-top level — only when the gate
      // point is offset from the junction xz (corner gates etc.).
      if (horizontalScn > 1e-3) {
        const horizGeo = new THREE.CylinderGeometry(dropR, dropR, horizontalScn, 14);
        const horizMesh = new THREE.Mesh(horizGeo, gateMat);
        horizMesh.position.set(
          (dropBotPt.x + gateEndPt.x) / 2,
          partTopY,
          (dropBotPt.z + gateEndPt.z) / 2,
        );
        const horizDir = gateEndPt.clone().sub(dropBotPt).normalize();
        horizMesh.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), horizDir);
        horizMesh.userData = dropMeshUserData;
        runnerMeshes.push(horizMesh);
        scene.add(horizMesh);

        // L-corner sphere — sits where the vertical drop meets the
        // horizontal connector, hiding the cylinder seam at the bend.
        // Sized 1.2× the cylinder radius (both meeting cylinders are
        // dropR), wears the same gold material so it reads as a fillet.
        const cornerMesh = new THREE.Mesh(
          new THREE.SphereGeometry(cornerSphereR, 18, 18),
          gateMat,
        );
        cornerMesh.position.copy(dropBotPt);
        scene.add(cornerMesh);
      }

      // Note the drop's TOP endpoint so the runner-plane junction
      // sphere covers the seam where the drop meets the parent runner.
      // The sphere will pick max(parent runner radius, dropR).
      noteEndpoint(dropTopPt.x, dropTopPt.z, dropR, gateMat);

      // Gate tip — bridges the gap between L-corner (which sits 2 mm
      // above part top, per the clearance rule) and the actual gate
      // point on the part. Top of the tip body is at L-corner level,
      // its orifice lands at the picked gate point. Body length =
      // (lCornerY − gateWorldY) = clearance + |gy|. We stretch the
      // helper's default body (built at tip.tipDepth) along local Y to
      // match — the helper has no length parameter, but the group has
      // no rotation in this branch, so scale.y maps directly to world Y.
      const gy = opts.gatePoint?.[1] ?? 0;
      const gateWorldYDrop = partTopY + gy / MM_PER_UNIT;
      const desiredBodyLen = lCornerY - gateWorldYDrop;
      const gateType: GateType = opts.gateType ?? 'direct';
      const gateTip = buildGateTip({ type: gateType, r: dropR, material: gateMat });
      // Place the tip group at the L-corner level so its body bridges
      // down to the gate point on the part. Stretch along local Y if
      // the gap is bigger than the natural tipDepth.
      gateTip.group.position.copy(gateEndPt);
      const yScale = gateTip.tipDepth > 1e-6 && desiredBodyLen > gateTip.tipDepth
        ? desiredBodyLen / gateTip.tipDepth
        : 1;
      if (yScale !== 1) gateTip.group.scale.y = yScale;
      // Submarine's body is angled 36°, so its orifice is offset
      // sideways from the group origin by `sin36° · subL · scale.y` —
      // the gate would land off-axis from the cavity's gate marker.
      // Compensate by shifting the group origin by minus that lateral
      // offset, so the orifice X / Z lines up with gx / gz exactly.
      // For the four other gate types orificeOffset[0] = orificeOffset[2] = 0
      // and this correction is a no-op.
      if (gateType === 'submarine') {
        const lateralX = gateTip.orificeOffset[0];
        const lateralZ = gateTip.orificeOffset[2];
        // Y-stretch doesn't change X/Z components, so the lateral offset
        // is independent of yScale — just shift the group by -lateral.
        gateTip.group.position.x -= lateralX;
        gateTip.group.position.z -= lateralZ;
      }
      // Tag every mesh in the gate-tip group so the highlight system
      // and tooltip pick them up like the old single ConeGeometry tip.
      gateTip.group.traverse((obj) => {
        if (obj instanceof THREE.Mesh) {
          obj.userData = {
            isRunner: true,
            isGate: true,
            levelKey: 'gate',
            levelName: `Gate (${gateType})`,
            diaMm: dropDiaMm,
            lenMm: dropLenMm,
            r: dropR,
            _origMat: gateMat,
          } as RunnerMeshMeta;
          runnerMeshes.push(obj);
        }
      });
      scene.add(gateTip.group);
    }
  }

  // Junction spheres — drop a small bead at every unique cylinder
  // endpoint on the runner plane (sprue base, main↔sub junctions,
  // sub↔branch junctions, branch↔drop junctions, etc.). The bead's
  // diameter scales with the LARGEST cylinder meeting at that point:
  // small runner → small bead, big runner → big bead. Overshoot of
  // 1.2× makes the sphere visibly bigger than the cylinder cap so it
  // reads as a fillet bead. Bead wears the largest cylinder's
  // material so it blends in.
  const JUNCTION_OVERSHOOT = 1.2;
  const fallbackJuncMat = new THREE.MeshPhongMaterial({ color: 0x90a4ae, shininess: 50 });
  for (const [key, edgeR] of junctionRadius) {
    if (edgeR < 0.05) continue; // skip degenerate (e.g. force-included origin with no edges)
    const [xStr, zStr] = key.split('|');
    const x = parseFloat(xStr!);
    const z = parseFloat(zStr!);
    const r = edgeR * JUNCTION_OVERSHOOT;
    const mat = junctionMatByKey.get(key) ?? fallbackJuncMat;
    const js = new THREE.Mesh(new THREE.SphereGeometry(r, 18, 18), mat);
    js.position.set(x, RZ, z);
    scene.add(js);
  }

  // Cavity meshes — sit directly below their own gate drop so the drop
  // length physically represents the runner-plane-to-cavity gap. With
  // per-cavity drop dimensions, each cavity's top is at its own
  // -dropLen below the runner plane.
  //
  // Two render paths:
  //   • Imported part — share one BufferGeometry across all cavity
  //     instances; each instance gets its own Mesh so the gate picker can
  //     raycast individually and the userData carries cavityId.
  //   • Placeholder box — original behaviour, still used until the user
  //     uploads a STEP file.
  const overlapIds = new Set<number>();
  for (const o of calc.overlaps) {
    overlapIds.add(o.i);
    overlapIds.add(o.j);
  }
  const cavityMeshes: THREE.Mesh[] = [];
  const cavWUnits = opts.partWidthMm / MM_PER_UNIT;
  const cavDUnits = opts.partDepthMm / MM_PER_UNIT;

  // Build the shared part geometry once if the user has uploaded one.
  // Convention: identical to GatePickerModal — vertices are pre-shifted
  // so AABB centre is at (0, _, 0) on X / Z and AABB top sits at Y = 0,
  // with the body extending downward to negative Y. Each cavity instance
  // then lives at world (cav.x/u, cavTopThis, cav.z/u) and the imported
  // gate point coordinates can be applied additively without any further
  // frame conversion.
  //
  // Rotation: when the user has set a non-zero `partRotation` we rotate
  // the geometry around the gate point (in part-local mm). That keeps
  // the gate stationary while the rest of the body swings — the runner
  // network's connection point doesn't move, so the same calc result
  // covers any rotation. With no gate picked the rotation pivots around
  // the AABB top centre (origin in this frame).
  /**
   * One shared BufferGeometry with the user's manual partRotation baked
   * in. Per-cavity auto-mirror rotation is applied via mesh transform
   * (mesh.rotation + mesh.position) so we don't duplicate the vertex
   * data per cavity. Pivot for the per-mesh rotation is the gate point.
   */
  let importedGeo: THREE.BufferGeometry | null = null;
  if (opts.importedPart) {
    const p = opts.importedPart;
    const cxLocal = (p.geometry.bbox.min[0] + p.geometry.bbox.max[0]) / 2;
    const czLocal = (p.geometry.bbox.min[2] + p.geometry.bbox.max[2]) / 2;
    const yMax = p.geometry.bbox.max[1];
    importedGeo = new THREE.BufferGeometry();
    const positions = new Float32Array(p.positions.length);
    for (let i = 0; i < p.positions.length; i += 3) {
      positions[i]     = (p.positions[i]!     - cxLocal) / MM_PER_UNIT;
      positions[i + 1] = (p.positions[i + 1]! - yMax)    / MM_PER_UNIT;
      positions[i + 2] = (p.positions[i + 2]! - czLocal) / MM_PER_UNIT;
    }
    importedGeo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    importedGeo.setIndex(new THREE.BufferAttribute(p.indices, 1));

    // User-set rotation (uniform across all cavities) baked in here as
    // a pivot transform around the gate point. Auto-mirror is per-cavity
    // and applied via mesh.rotation below.
    const r = opts.partRotation ?? { x: 0, y: 0, z: 0 };
    if (r.x !== 0 || r.y !== 0 || r.z !== 0) {
      const px = (opts.gatePoint?.[0] ?? 0) / MM_PER_UNIT;
      const py = (opts.gatePoint?.[1] ?? 0) / MM_PER_UNIT;
      const pz = (opts.gatePoint?.[2] ?? 0) / MM_PER_UNIT;
      const m = new THREE.Matrix4();
      m.makeTranslation(px, py, pz);
      m.multiply(new THREE.Matrix4().makeRotationFromEuler(
        new THREE.Euler(
          (r.x * Math.PI) / 180,
          (r.y * Math.PI) / 180,
          (r.z * Math.PI) / 180,
          'XYZ',
        ),
      ));
      m.multiply(new THREE.Matrix4().makeTranslation(-px, -py, -pz));
      importedGeo.applyMatrix4(m);
    }
    importedGeo.computeVertexNormals();

    // Apply per-vertex draft-angle colours when the user has set a
    // demoulding direction. The colour buffer travels with the shared
    // geometry; every cavity instance reads the same heatmap. The
    // direction is in PART-LOCAL frame so we apply it to the local
    // normals BEFORE per-cavity rotation (which is per-mesh transform,
    // not baked into the geometry).
    if (opts.demouldingDir) {
      const normalsAttr = importedGeo.getAttribute('normal') as THREE.BufferAttribute;
      const angles = draftAnglesFromMesh(
        normalsAttr.array as Float32Array,
        opts.demouldingDir,
      );
      const colors = vertexColorsForDraft(angles);
      importedGeo.setAttribute('color', new THREE.BufferAttribute(colors, 3));
    }
  }

  for (let i = 0; i < calc.tree.cavities.length; i++) {
    const cav = calc.tree.cavities[i]!;
    const cavNode = calc.tree.nodes.find(
      (n) => n.kind === 'cavity' && n.cavityId === cav.id,
    );
    const dropEdge = cavNode ? dropEdgeByCavityNodeId.get(cavNode.id) : undefined;
    const cavLenMm = dropEdge?.lenMm ?? DROP_DEFAULT_LEN_MM;
    const cavTopThis = RZ - (cavLenMm / MM_PER_UNIT);
    let mat: THREE.Material;
    if (overlapIds.has(i)) {
      mat = cavOverlapMat;
    } else if (heatMode === 'fill' && heatData?.fillDeviationByCavity) {
      const dev = heatData.fillDeviationByCavity.get(cav.id) ?? 0;
      mat = phong(fillDeviationColor(dev));
    } else if (heatMode === 'balance') {
      mat = balanceMat;
    } else if (opts.demouldingDir && opts.importedPart) {
      // Draft heatmap takes precedence over the default cavMat when a
      // demoulding direction has been picked AND we have a real part
      // (the placeholder box has no normals to colour).
      mat = cavDraftMat;
    } else {
      mat = cavMat;
    }

    if (importedGeo) {
      const mesh = new THREE.Mesh(importedGeo, mat);
      // partTopY = world Y of AABB top. Derived to keep the gate exactly
      // at the drop bottom regardless of `gy` and the drop on/off mode.
      const gy = opts.gatePoint?.[1] ?? 0;
      const partTopY = dropEnabled
        ? RZ - DROP_DEFAULT_LEN_MM / MM_PER_UNIT
        : RZ - gy / MM_PER_UNIT;

      // Auto-mirror Y rotation, derived from how far the pipeline shifted
      // the cavity node relative to the cavity record. The pipeline
      // shifts the cavity node by (cavGx, cavGz) — for the auto-mirror
      // case that's the gate-direction-toward-parent vector. The Y rotation
      // is the angle that takes the part-local gate direction to the
      // (cavGx, cavGz) direction, so the gate ends up over the moved gate
      // junction position.
      let yRot = 0;
      if (opts.gatePoint && cavNode) {
        const offsetX = cavNode.x - cav.x;
        const offsetZ = cavNode.z - cav.z;
        const offsetMag = Math.hypot(offsetX, offsetZ);
        const [gxRaw, , gzRaw] = opts.gatePoint;
        const gateMag = Math.hypot(gxRaw, gzRaw);
        if (offsetMag > 1e-3 && gateMag > 1e-3) {
          // Three.js Y rotation is right-handed about +Y. atan2 gives the
          // direction in the XZ plane; flipping the sign of the Z arg
          // matches Three's rotation convention (so a + Y rotation by
          // π/2 takes +X to -Z).
          const dirAngle  = Math.atan2(-offsetZ, offsetX);
          const gateAngle = Math.atan2(-gzRaw,    gxRaw);
          yRot = dirAngle - gateAngle;
        }
      }

      // Per-cavity manual override (Flip H / Flip V buttons). Applied
      // on top of the auto-mirror Y rotation around the cavity centre.
      const override = opts.cavityRotationOverrides?.[cav.id];
      const overrideX = override ? (override.x * Math.PI) / 180 : 0;
      const overrideY = override ? (override.y * Math.PI) / 180 : 0;
      const totalY = yRot + overrideY;

      // Mesh sits at the cavity record's centre and rotates around its
      // own position. With the pipeline's snapped-rotation offset, the
      // gate vertex naturally ends up at (cav + cavGx, _, cav + cavGz)
      // — which is the cavity-node position. Result: every part is
      // axis-aligned, centred on its cavity grid slot.
      mesh.position.set(
        cav.x / MM_PER_UNIT,
        partTopY,
        cav.z / MM_PER_UNIT,
      );
      mesh.setRotationFromEuler(new THREE.Euler(overrideX, totalY, 0, 'YXZ'));

      // Gate world position — for the persistent gate-marker render in
      // Viewer3D. With axis-aligned mesh transform, this is just the
      // cavity-node position from the pipeline lifted to scene units.
      const gateWorldX = (cavNode?.x ?? cav.x) / MM_PER_UNIT;
      const gateWorldY = partTopY + (opts.gatePoint?.[1] ?? 0) / MM_PER_UNIT;
      const gateWorldZ = (cavNode?.z ?? cav.z) / MM_PER_UNIT;
      const meta: CavityMeshMeta = {
        isCavity: true,
        cavityId: cav.id,
        gateWorld: opts.gatePoint
          ? { x: gateWorldX, y: gateWorldY, z: gateWorldZ }
          : undefined,
      };
      mesh.userData = meta;
      scene.add(mesh);
      cavityMeshes.push(mesh);
    } else {
      const geo = new THREE.BoxGeometry(cavWUnits, cavH, cavDUnits);
      const mesh = new THREE.Mesh(geo, mat);
      mesh.position.set(cav.x / MM_PER_UNIT, cavTopThis - cavH / 2, cav.z / MM_PER_UNIT);
      const meta: CavityMeshMeta = { isCavity: true, cavityId: cav.id };
      mesh.userData = meta;
      scene.add(mesh);
      cavityMeshes.push(mesh);

      const edgeColor = overlapIds.has(i) ? 0xee2222 : 0x333333;
      const edges = new THREE.LineSegments(
        new THREE.EdgesGeometry(geo),
        new THREE.LineBasicMaterial({ color: edgeColor }),
      );
      edges.position.copy(mesh.position);
      scene.add(edges);
    }
  }

  // Sprue — scale visual cone + base based on the panel overrides so the
  // stylised proportions are preserved while the user can grow / shrink it.
  const sprueDiaDefaultMm = calc.sprue.exitDiaMm;
  const sprueLenDefaultMm = calc.input.machine.sprueLengthMm ?? 80;
  const sprueDiaMm = calc.input.overrides.diaByLevel?.['sprue'] || sprueDiaDefaultMm;
  const sprueLenMm = calc.input.overrides.lenByLevel?.['sprue'] || sprueLenDefaultMm;
  const sprueDiaScale = sprueDiaDefaultMm > 0 ? sprueDiaMm / sprueDiaDefaultMm : 1;
  const sprueLenScale = sprueLenDefaultMm > 0 ? sprueLenMm / sprueLenDefaultMm : 1;

  const sprTopR = 0.5 * sprueDiaScale;
  const sprBotR = 1.2 * sprueDiaScale;
  const sprueLenScn = (sprTop - RZ - 1) * sprueLenScale;
  const sprueBotY = RZ + 1;
  const sprueTopY = sprueBotY + sprueLenScn;

  const sprueMesh = new THREE.Mesh(
    new THREE.CylinderGeometry(sprTopR, sprBotR, sprueLenScn, 16),
    sprMat,
  );
  sprueMesh.position.set(0, (sprueBotY + sprueTopY) / 2, 0);
  sprueMesh.userData = {
    isRunner: true,
    isSprue: true,
    levelKey: 'sprue',
    levelName: 'Sprue',
    diaMm: sprueDiaMm,
    lenMm: sprueLenMm,
    r: sprBotR,
    _origMat: sprMat,
  } as RunnerMeshMeta;
  runnerMeshes.push(sprueMesh);
  scene.add(sprueMesh);

  const flangeR = sprBotR * 1.2;
  const sprBase = new THREE.Mesh(
    new THREE.CylinderGeometry(sprBotR, flangeR, 1.5, 16),
    sprBaseMat,
  );
  sprBase.position.set(0, RZ + 0.75, 0);
  sprBase.userData = {
    isRunner: true,
    isSprue: true,
    levelKey: 'sprue_base',
    levelName: 'Sprue Base',
    diaMm: flangeR * 2 * MM_PER_UNIT,
    lenMm: 15,
    r: flangeR,
    _origMat: sprBaseMat,
  } as RunnerMeshMeta;
  runnerMeshes.push(sprBase);
  scene.add(sprBase);

  // Hot-runner manifold indicator
  if (opts.hotRunner) {
    const maxX = Math.max(...calc.tree.cavities.map((c) => Math.abs(c.x / MM_PER_UNIT)));
    const maxZ = Math.max(...calc.tree.cavities.map((c) => Math.abs(c.z / MM_PER_UNIT)));
    const mfGeo = new THREE.BoxGeometry(Math.max(12, (maxX + 2) * 2), 0.8, Math.max(12, (maxZ + 2) * 2));
    const mfMat = new THREE.MeshPhongMaterial({
      color: 0xcc4422,
      shininess: 40,
      transparent: true,
      opacity: 0.35,
    });
    const mfMesh = new THREE.Mesh(mfGeo, mfMat);
    mfMesh.position.set(0, RZ + 1.5, 0);
    scene.add(mfMesh);
  }

  return { scene, runnerMeshes, cavityMeshes };
}

/**
 * Spec colour function: blue → green → red linear gradient over [min, max].
 * Used for FLOW and PRESSURE modes where high values = bright red.
 */
function heatColor(value: number, range: { min: number; max: number }): number {
  const span = range.max - range.min;
  if (span <= 0) return 0x22c55e;
  const norm = Math.max(0, Math.min(1, (value - range.min) / span));
  // blue (cold/low) → green → red (hot/high)
  if (norm < 0.5) {
    return lerpRgb(0x2563eb, 0x22c55e, norm * 2);
  }
  return lerpRgb(0x22c55e, 0xef4444, (norm - 0.5) * 2);
}

/**
 * FILL-mode cavity colour: gradient over fractional fill-time deviation
 * (t_i − mean) / mean. Tight ±5 % stays green; ±20 % saturates red/blue.
 */
function fillDeviationColor(dev: number): number {
  const clamped = Math.max(-1, Math.min(1, dev / 0.20));
  if (Math.abs(dev) <= 0.05) return 0x22c55e;
  if (clamped < 0) return lerpRgb(0x22c55e, 0x2563eb, -clamped);
  return lerpRgb(0x22c55e, 0xef4444, clamped);
}

/**
 * DIA-mode edge colour: ratio of current Ø to recommended Ø.
 *  • 1.0  → green (on-target)
 *  • <1.0 → red  (undersized — too much resistance, balance breaks)
 *  • >1.0 → blue (oversized — wastes material)
 */
function diaRatioColor(ratio: number): number {
  if (Math.abs(ratio - 1) < 0.05) return 0xeab308; // amber on-target
  if (ratio < 1) return lerpRgb(0xeab308, 0xef4444, Math.min(1, (1 - ratio) / 0.5));
  return lerpRgb(0xeab308, 0x2563eb, Math.min(1, (ratio - 1) / 0.5));
}

function phong(color: number): THREE.MeshPhongMaterial {
  return new THREE.MeshPhongMaterial({ color, shininess: 60, specular: 0x222222 });
}

function computeRange(map: Map<number, number> | undefined): { min: number; max: number } | null {
  if (!map || map.size === 0) return null;
  let min = Infinity;
  let max = -Infinity;
  for (const v of map.values()) {
    if (!Number.isFinite(v)) continue;
    if (v < min) min = v;
    if (v > max) max = v;
  }
  if (!Number.isFinite(min) || !Number.isFinite(max) || min === max) return null;
  return { min, max };
}

function lerpRgb(a: number, b: number, t: number): number {
  const ar = (a >> 16) & 0xff;
  const ag = (a >> 8) & 0xff;
  const ab = a & 0xff;
  const br = (b >> 16) & 0xff;
  const bg = (b >> 8) & 0xff;
  const bb = b & 0xff;
  const r = Math.round(ar + (br - ar) * t);
  const g = Math.round(ag + (bg - ag) * t);
  const c = Math.round(ab + (bb - ab) * t);
  return (r << 16) | (g << 8) | c;
}

import * as THREE from 'three';
import type { CalcResult, RunnerProfile } from '@runner/core';

/**
 * Converts the calculation pipeline's RunnerTree + CavityOverlap data
 * into a Three.js scene that matches the HTML prototype visually.
 *
 * Positions inside the tree are in millimetres; we divide by 10 so that
 * 1 scene unit = 10 mm (matching the HTML's original coordinate frame).
 */

export interface BuildSceneOptions {
  profile: RunnerProfile;
  hotRunner: boolean;
  showDims: boolean;
  gatesPerCavity: 1 | 2;
  partWidthMm: number;
  partDepthMm: number;
  partHeightMm: number;
}

export interface RunnerMeshMeta {
  isRunner: true;
  isSprue?: boolean;
  isGate?: boolean;
  isDrop?: boolean;
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

  if (calc.tree.edges.length === 0) return { scene, runnerMeshes: [] };

  const runnerMeshes: THREE.Mesh[] = [];

  const RZ = 0;
  const gateBot = -5.5;
  const cavTop = -5.5;
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

  // Edges (runners)
  for (const edge of calc.tree.edges) {
    const parent = calc.tree.nodes.find((n) => n.id === edge.parentNodeId);
    const child = calc.tree.nodes.find((n) => n.id === edge.childNodeId);
    if (!parent || !child) continue;
    const x1 = parent.x / MM_PER_UNIT;
    const z1 = parent.z / MM_PER_UNIT;
    const x2 = child.x / MM_PER_UNIT;
    const z2 = child.z / MM_PER_UNIT;
    const rScene = edge.diaMm / 2 / MM_PER_UNIT;
    const mat = levelMats.get(edge.levelKey) ?? new THREE.MeshPhongMaterial({ color: 0x2e8b2e });
    addSegment(x1, z1, x2, z2, rScene, mat, {
      isRunner: true,
      levelKey: edge.levelKey,
      levelName: edge.levelName,
      diaMm: edge.diaMm,
      lenMm: edge.lenMm,
      r: rScene,
    });
  }

  // Junctions: one sphere per unique edge endpoint (deduped at 0.1 unit precision)
  const junctionKeys = new Set<string>();
  const ptKey = (x: number, z: number) => `${x.toFixed(1)}|${z.toFixed(1)}`;
  for (const n of calc.tree.nodes) {
    if (n.kind === 'cavity') continue;
    junctionKeys.add(ptKey(n.x / MM_PER_UNIT, n.z / MM_PER_UNIT));
  }
  junctionKeys.add(ptKey(0, 0));
  for (const key of junctionKeys) {
    const [xStr, zStr] = key.split('|');
    const x = parseFloat(xStr!);
    const z = parseFloat(zStr!);
    const js = new THREE.Mesh(
      new THREE.SphereGeometry(0.75, 14, 14),
      new THREE.MeshPhongMaterial({ color: 0x90a4ae, shininess: 50 }),
    );
    js.position.set(x, RZ, z);
    scene.add(js);
  }

  // Gates — cone + drop cylinder under each cavity
  const gatesPerCavity = opts.gatesPerCavity;
  for (const cav of calc.tree.cavities) {
    const cx = cav.x / MM_PER_UNIT;
    const cz = cav.z / MM_PER_UNIT;
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
      const gLen = Math.abs(RZ - gateBot);
      const dropMesh = new THREE.Mesh(
        new THREE.CylinderGeometry(0.3, 0.3, gLen, 10),
        gateMat,
      );
      dropMesh.position.set(gx, (RZ + gateBot) / 2, gz);
      dropMesh.userData = {
        isRunner: true,
        isDrop: true,
        levelKey: 'drop',
        levelName: 'Gate Drop',
        diaMm: 6,
        lenMm: gLen * MM_PER_UNIT,
        r: 0.3,
        _origMat: gateMat,
      } as RunnerMeshMeta;
      runnerMeshes.push(dropMesh);
      scene.add(dropMesh);

      const tipMesh = new THREE.Mesh(new THREE.ConeGeometry(0.55, 0.8, 10), gateMat);
      tipMesh.position.set(gx, gateBot + 0.4, gz);
      tipMesh.userData = {
        isRunner: true,
        isGate: true,
        levelKey: 'gate',
        levelName: 'Gate Point',
        diaMm: 11,
        lenMm: 8,
        r: 0.55,
        _origMat: gateMat,
      } as RunnerMeshMeta;
      runnerMeshes.push(tipMesh);
      scene.add(tipMesh);
    }
  }

  // Cavity boxes — highlight overlap pairs red
  const overlapIds = new Set<number>();
  for (const o of calc.overlaps) {
    overlapIds.add(o.i);
    overlapIds.add(o.j);
  }
  const cavWUnits = opts.partWidthMm / MM_PER_UNIT;
  const cavDUnits = opts.partDepthMm / MM_PER_UNIT;
  for (let i = 0; i < calc.tree.cavities.length; i++) {
    const cav = calc.tree.cavities[i]!;
    const mat = overlapIds.has(i) ? cavOverlapMat : cavMat;
    const geo = new THREE.BoxGeometry(cavWUnits, cavH, cavDUnits);
    const mesh = new THREE.Mesh(geo, mat);
    mesh.position.set(cav.x / MM_PER_UNIT, cavTop - cavH / 2, cav.z / MM_PER_UNIT);
    scene.add(mesh);

    const edgeColor = overlapIds.has(i) ? 0xee2222 : 0x333333;
    const edges = new THREE.LineSegments(
      new THREE.EdgesGeometry(geo),
      new THREE.LineBasicMaterial({ color: edgeColor }),
    );
    edges.position.copy(mesh.position);
    scene.add(edges);
  }

  // Sprue
  const sprTopR = 0.5;
  const sprBotR = 1.2;
  const sprueMesh = new THREE.Mesh(
    new THREE.CylinderGeometry(sprTopR, sprBotR, sprTop - RZ - 1, 16),
    sprMat,
  );
  sprueMesh.position.set(0, (RZ + 1 + sprTop) / 2, 0);
  sprueMesh.userData = {
    isRunner: true,
    isSprue: true,
    levelKey: 'sprue',
    levelName: 'Sprue',
    diaMm: calc.sprue.exitDiaMm,
    lenMm: (sprTop - RZ - 1) * MM_PER_UNIT,
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

  return { scene, runnerMeshes };
}

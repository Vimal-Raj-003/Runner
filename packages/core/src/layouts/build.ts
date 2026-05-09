/**
 * Helpers used by every layout generator to assemble a RunnerTree.
 *
 * Positions are in millimetres. A default spacing of 80 mm between
 * cavities corresponds to the prototype's "8 scene units × 10 mm/unit".
 */

import type {
  Cavity,
  RunnerEdge,
  RunnerNode,
  RunnerTree,
} from '../geometry/tree';
import { levelKeyOf, levelName } from '../geometry/tree';
import { IdGen } from './types';

export interface BuildContext {
  readonly ids: IdGen;
  readonly edgeIds: IdGen;
  readonly nodes: RunnerNode[];
  readonly edges: RunnerEdge[];
  readonly cavities: Cavity[];
}

export function newContext(): BuildContext {
  return {
    ids: new IdGen(),
    edgeIds: new IdGen(),
    nodes: [],
    edges: [],
    cavities: [],
  };
}

export function addNode(
  ctx: BuildContext,
  kind: RunnerNode['kind'],
  x: number,
  z: number,
  cavityId?: number,
): RunnerNode {
  const node: RunnerNode = { id: ctx.ids.next(), kind, x, z, cavityId };
  ctx.nodes.push(node);
  return node;
}

/** Default vertical drop length (mm) — runner-plane to cavity top. */
export const DEFAULT_GATE_DROP_LEN_MM = 55;
/** Default drop diameter (mm). */
export const DEFAULT_GATE_DROP_DIA_MM = 6;

export function addCavity(ctx: BuildContext, x: number, z: number): { node: RunnerNode; cavity: Cavity } {
  const cavity: Cavity = { id: ctx.cavities.length, x, z };
  ctx.cavities.push(cavity);
  const node = addNode(ctx, 'cavity', x, z, cavity.id);
  return { node, cavity };
}

/**
 * Branch a drop edge directly off `sprue` for a cavity that coincides with
 * the sprue's xz position. Used by Inline/T-style layouts on odd cavity
 * counts to avoid a phantom zero-length main edge under the sprue. The
 * returned `gate` is the sprue itself — the drop is the only edge between
 * sprue and cavity, so the panel sees this as Section 1 of Gate Drop with
 * chainPos one shallower than the outer drops.
 */
export function addDropOnlyCavity(
  ctx: BuildContext,
  sprue: RunnerNode,
  x: number,
  z: number,
  dropDepth: number,
  opts?: { dropDiaMm?: number; dropLenMm?: number },
): { gate: RunnerNode; cavity: Cavity; cavityNode: RunnerNode } {
  const cavity: Cavity = { id: ctx.cavities.length, x, z };
  ctx.cavities.push(cavity);
  const cavityNode = addNode(ctx, 'cavity', x, z, cavity.id);
  addEdge(ctx, sprue, cavityNode, dropDepth, opts?.dropDiaMm ?? DEFAULT_GATE_DROP_DIA_MM, {
    isDrop: true,
    lenMm: opts?.dropLenMm ?? DEFAULT_GATE_DROP_LEN_MM,
  });
  return { gate: sprue, cavity, cavityNode };
}

/**
 * Like addCavity but ALSO inserts a gate junction at the cavity position
 * and a drop edge from the gate junction to the cavity. Layout generators
 * connect their sub-runner edge to the *gate* (returned), and the drop
 * edge handles the runner-plane → cavity-top transition with explicit
 * lenMm = DEFAULT_GATE_DROP_LEN_MM. Drops then participate in the
 * auto-balance solver like any other runner edge.
 */
export function addCavityWithDrop(
  ctx: BuildContext,
  x: number,
  z: number,
  dropDepth: number,
  opts?: { dropDiaMm?: number; dropLenMm?: number },
): { gate: RunnerNode; cavity: Cavity; cavityNode: RunnerNode } {
  const cavity: Cavity = { id: ctx.cavities.length, x, z };
  ctx.cavities.push(cavity);
  // Gate junction sits at the cavity's xz position on the runner plane;
  // the cavity node is conceptually "below" it (in y) but in our 2D model
  // they share xz. The drop edge's lenMm carries the height.
  const gate = addNode(ctx, 'junction', x, z);
  const cavityNode = addNode(ctx, 'cavity', x, z, cavity.id);
  addEdge(ctx, gate, cavityNode, dropDepth, opts?.dropDiaMm ?? DEFAULT_GATE_DROP_DIA_MM, {
    isDrop: true,
    lenMm: opts?.dropLenMm ?? DEFAULT_GATE_DROP_LEN_MM,
  });
  return { gate, cavity, cavityNode };
}

export function addEdge(
  ctx: BuildContext,
  parent: RunnerNode,
  child: RunnerNode,
  depth: number,
  diaMm: number,
  opts?: { isDrop?: boolean; lenMm?: number },
): RunnerEdge {
  const dx = child.x - parent.x;
  const dz = child.z - parent.z;
  const computedLen = Math.sqrt(dx * dx + dz * dz);
  // Drops have zero geometric length in 2D (parent and child share x,z);
  // callers pass an explicit lenMm for the drop's vertical extent.
  const lenMm = opts?.lenMm ?? computedLen;
  const isDrop = opts?.isDrop ?? false;
  const edge: RunnerEdge = {
    id: ctx.edgeIds.next(),
    parentNodeId: parent.id,
    childNodeId: child.id,
    depth,
    rScene: diaMm / 20,
    diaMm,
    lenMm,
    levelName: levelName(depth, isDrop),
    levelKey: levelKeyOf(depth, isDrop),
    isDrop,
  };
  ctx.edges.push(edge);
  return edge;
}

export function buildTree(ctx: BuildContext): RunnerTree {
  const byLevel = new Map<string, RunnerEdge[]>();
  for (const e of ctx.edges) {
    const arr = byLevel.get(e.levelKey) ?? [];
    arr.push(e);
    byLevel.set(e.levelKey, arr);
  }
  return {
    nodes: ctx.nodes,
    edges: ctx.edges,
    cavities: ctx.cavities,
    byLevel,
  };
}

/**
 * Assign diameters per level by scaling from a base value.
 * depth 0 = full base; each deeper level is 85% of its parent.
 */
export function diaForDepth(baseDiaMm: number, depth: number): number {
  const scaled = baseDiaMm * Math.pow(0.85, depth);
  return Math.max(3, Math.round(scaled * 2) / 2); // half-mm increments, min 3 mm
}

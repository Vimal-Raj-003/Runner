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

export function addCavity(ctx: BuildContext, x: number, z: number): { node: RunnerNode; cavity: Cavity } {
  const cavity: Cavity = { id: ctx.cavities.length, x, z };
  ctx.cavities.push(cavity);
  const node = addNode(ctx, 'cavity', x, z, cavity.id);
  return { node, cavity };
}

export function addEdge(
  ctx: BuildContext,
  parent: RunnerNode,
  child: RunnerNode,
  depth: number,
  diaMm: number,
): RunnerEdge {
  const dx = child.x - parent.x;
  const dz = child.z - parent.z;
  const lenMm = Math.sqrt(dx * dx + dz * dz);
  const edge: RunnerEdge = {
    id: ctx.edgeIds.next(),
    parentNodeId: parent.id,
    childNodeId: child.id,
    depth,
    rScene: diaMm / 20, // 1 scene unit = 10 mm; r in scene units for viewer
    diaMm,
    lenMm,
    levelName: levelName(depth),
    levelKey: levelKeyOf(depth),
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

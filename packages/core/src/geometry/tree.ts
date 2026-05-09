/**
 * Runner tree structure — replaces the prototype's flat `segs[]` +
 * `levelKey = r.toFixed(2)` trick, which collides when different branches
 * happen to share the same radius.
 *
 * A RunnerTree has a single sprue root at the origin, an ordered list of
 * nodes (junctions + cavity entries), and edges that carry segment
 * geometry plus a stable level index derived from tree depth.
 */

export interface Point2D {
  readonly x: number;
  readonly z: number;
}

export type NodeKind = 'sprue' | 'junction' | 'cavity';

export interface RunnerNode {
  readonly id: number;
  readonly kind: NodeKind;
  readonly x: number;
  readonly z: number;
  /** Cavity index in the original cavity list (only for kind = 'cavity') */
  readonly cavityId?: number;
}

export interface RunnerEdge {
  readonly id: number;
  readonly parentNodeId: number;
  readonly childNodeId: number;
  /** 0 = main runner (attached to sprue), 1 = sub, 2 = branch, … */
  readonly depth: number;
  /** Radius in abstract scene units; converted to mm by pipeline */
  readonly rScene: number;
  /** Assigned diameter in mm */
  diaMm: number;
  /** Length in mm */
  lenMm: number;
  /** Human-readable level name: "Main Runner", "Sub Runner", "Branch Runner 1", … */
  levelName: string;
  /** Stable level key used by UI for per-level overrides */
  levelKey: string;
  /**
   * True for the vertical gate drop between a runner-plane gate junction
   * and its cavity. Drop edges are zero-length in 2D layout (parent and
   * child share x,z) but carry the cylinder height in `lenMm`.
   */
  isDrop?: boolean;
}

export interface Cavity {
  readonly id: number;
  x: number;
  z: number;
}

export interface RunnerTree {
  readonly nodes: RunnerNode[];
  readonly edges: RunnerEdge[];
  readonly cavities: Cavity[];
  /** Map from level key → edges at that level (for dia/len overrides) */
  readonly byLevel: Map<string, RunnerEdge[]>;
}

export function levelName(depth: number, isDrop = false): string {
  if (isDrop) return 'Gate Drop';
  if (depth === 0) return 'Main Runner';
  if (depth === 1) return 'Sub Runner';
  return `Branch Runner ${depth - 1}`;
}

export function levelKeyOf(depth: number, isDrop = false): string {
  return isDrop ? 'L_drop' : `L${depth}`;
}

/** Compute 2D euclidean distance between two points. */
export function dist(a: Point2D, b: Point2D): number {
  const dx = a.x - b.x;
  const dz = a.z - b.z;
  return Math.sqrt(dx * dx + dz * dz);
}

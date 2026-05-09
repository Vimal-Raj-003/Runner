/**
 * Shared gate-tip geometry. Both the multi-cavity viewer and the gate-
 * picker modal render the runner-to-part junction the same way, so the
 * geometry recipes live here in one place.
 *
 * Each gate type returns a `THREE.Group` that's already positioned with
 * its "top" sitting at the supplied origin (typically the drop bottom in
 * the multi-cavity viewer, or the gate point in the picker preview). The
 * caller adds the group to the scene and disposes it when the scene is
 * rebuilt.
 *
 * All dimensions are in *scene units* (1 unit = `MM_PER_UNIT` mm = 10 mm
 * by convention) so the geometry scales consistently with the rest of
 * the viewer. The reference radius `r` should be the drop's radius;
 * each gate type then derives its own size from a fraction of `r`.
 */

import * as THREE from 'three';
import type { GateType } from '@/state/store';

export interface GateTipOptions {
  /** Type of gate to render. */
  type: GateType;
  /** Reference radius (drop radius) in scene units. */
  r: number;
  /** Material to apply to every mesh in the group. */
  material: THREE.Material;
}

export interface GateTipResult {
  group: THREE.Group;
  /**
   * Disposable resources owned by this group. Caller calls `dispose()`
   * on each when tearing the scene down.
   */
  geometries: THREE.BufferGeometry[];
  /**
   * Depth of the tip body from the group origin (top, where it meets
   * the runner) to its furthest extent in the local -Y direction (the
   * orifice). Used by the picker / multi-cav viewer to position the
   * runner stub so it ends flush with the tip's top — no gap, no
   * overlap. In scene units (same units as `r`).
   */
  tipDepth: number;
  /**
   * Local-frame offset FROM the group origin (= wide end / runner side)
   * TO the orifice (= narrow end on the part surface). For direct /
   * edge / pin / fan this is `(0, -tipDepth, 0)` since the body extends
   * straight along local -Y. Submarine's body is angled 36°, so its
   * orifice has a non-zero X component too. Callers use this to place
   * the group such that the orifice lands EXACTLY at the picked gate
   * point — without it, submarine's orifice ends up offset from the
   * gate marker.
   */
  orificeOffset: [number, number, number];
}

/**
 * Approximate tip body depth (along -Y from group origin) per gate
 * type, expressed as a multiple of the reference radius `r`. Submarine
 * is angled at ~36° from vertical so its vertical reach is shorter
 * than its body length.
 */
export const GATE_TIP_DEPTH_PER_R: Record<GateType, number> = {
  direct:    1.6,
  edge:      0.5,
  pin:       1.4,
  submarine: 2.4 * Math.cos(Math.PI / 5), // body × cos(36°) ≈ 1.94
  fan:       0.95,
};

/**
 * Build the geometry that sits at the bottom of a vertical drop tube,
 * representing the actual gate where the melt enters the part.
 *
 *   • direct    — tapered cone narrowing from drop dia to gate orifice.
 *                 Single-cavity / large-part default.
 *   • edge      — rectangular block at the part's edge. Most common in
 *                 multi-cavity moulds; cleanly trims off after ejection.
 *   • pin       — small thin cylinder. Used in 3-plate / hot-runner
 *                 systems where the gate self-degates on opening.
 *   • submarine — angled cylinder coming in from below the parting line.
 *                 Auto-degates on part ejection.
 *   • fan       — wide tapered slot. Good for thin parts / wide flow
 *                 fronts; reduces orientation stress.
 */
export function buildGateTip(opts: GateTipOptions): GateTipResult {
  const group = new THREE.Group();
  const geos: THREE.BufferGeometry[] = [];
  const r = opts.r;

  switch (opts.type) {
    case 'direct': {
      // Tapered sprue: top dia ≈ drop dia, bottom dia ≈ 70% (the gate
      // orifice). Top sits at y=0, body grows downward.
      const h = r * 1.6;
      const geo = new THREE.ConeGeometry(r, h, 16, 1, true);
      geos.push(geo);
      const m = new THREE.Mesh(geo, opts.material);
      // ConeGeometry's apex points up by default; flip and place so the
      // wide base sits at y=0 and apex (gate orifice) at y = -h.
      m.rotation.x = Math.PI;
      m.position.set(0, -h / 2, 0);
      group.add(m);
      break;
    }

    case 'edge': {
      // Small rectangular orifice at the part edge. Width:depth ≈ 3:1
      // (Beaumont rule of thumb — wide & shallow gives flatter flow).
      const widthScn  = r * 1.6;
      const depthScn  = r * 0.5;
      const lengthScn = r * 0.9;
      const geo = new THREE.BoxGeometry(widthScn, depthScn, lengthScn);
      geos.push(geo);
      const m = new THREE.Mesh(geo, opts.material);
      m.position.set(0, -depthScn / 2, 0);
      group.add(m);
      break;
    }

    case 'pin': {
      // Tiny cylindrical orifice — typical pin gate is 0.5–1.5 mm dia
      // (well below the runner dia). Render as a thin cylinder.
      const pinR = r * 0.22;
      const pinH = r * 1.4;
      const geo = new THREE.CylinderGeometry(pinR, pinR, pinH, 14);
      geos.push(geo);
      const m = new THREE.Mesh(geo, opts.material);
      m.position.set(0, -pinH / 2, 0);
      group.add(m);
      break;
    }

    case 'submarine': {
      // Angled tunnel gate. Industry standard ≈ 30–45° from the parting
      // plane; we draw it at 35°. Tip narrower than the upstream end.
      const subR = r * 0.45;
      const subL = r * 2.4;
      const angle = Math.PI / 5; // 36° from vertical
      const geo = new THREE.CylinderGeometry(subR, subR * 0.55, subL, 14);
      geos.push(geo);
      const m = new THREE.Mesh(geo, opts.material);
      // Pivot at the cylinder's TOP, then rotate around Z so the tube
      // angles into the part from the +X side.
      m.geometry.translate(0, -subL / 2, 0);
      m.rotation.z = angle;
      m.position.set(0, 0, 0);
      group.add(m);
      break;
    }

    case 'fan': {
      // Tapered fan gate: thin orifice at the runner end, fanning out
      // wider at the part. Approximated with a triangular prism via
      // ExtrudeGeometry on a 2D trapezoid.
      const wTop    = r * 0.55;
      const wBottom = r * 2.4;
      const depthScn = r * 0.32;
      const lenScn   = r * 0.95;
      const shape = new THREE.Shape();
      shape.moveTo(-wTop / 2,    0);
      shape.lineTo( wTop / 2,    0);
      shape.lineTo( wBottom / 2, -lenScn);
      shape.lineTo(-wBottom / 2, -lenScn);
      shape.closePath();
      const geo = new THREE.ExtrudeGeometry(shape, {
        depth: depthScn,
        bevelEnabled: false,
      });
      geos.push(geo);
      const m = new THREE.Mesh(geo, opts.material);
      // ExtrudeGeometry extrudes along +Z; centre on the gate origin.
      m.position.set(0, 0, -depthScn / 2);
      group.add(m);
      break;
    }
  }

  // Local-frame orifice offset. Body extends in -Y for direct / edge /
  // pin / fan, so the orifice is at (0, -tipDepth, 0). Submarine tilts
  // 36° around Z, so its narrow end (orifice) is at
  //   (sin36° · subL, -cos36° · subL, 0).
  const tipDepth = GATE_TIP_DEPTH_PER_R[opts.type] * r;
  let orificeOffset: [number, number, number];
  if (opts.type === 'submarine') {
    const subL = r * 2.4;
    const angle = Math.PI / 5;
    orificeOffset = [Math.sin(angle) * subL, -Math.cos(angle) * subL, 0];
  } else {
    orificeOffset = [0, -tipDepth, 0];
  }

  return {
    group,
    geometries: geos,
    tipDepth,
    orificeOffset,
  };
}

/**
 * Human-readable label for a GateType. Used by the UI selector and
 * tooltip help.
 */
export const GATE_TYPE_LABEL: Record<GateType, string> = {
  direct:    'Direct (sprue)',
  edge:      'Edge',
  pin:       'Pin',
  submarine: 'Submarine',
  fan:       'Fan',
};

/**
 * Brief description shown next to the gate-type selector — one line of
 * "what is this and when to use it".
 */
export const GATE_TYPE_HELP: Record<GateType, string> = {
  direct:    'Tapered sprue gate. Single-cavity moulds, large parts. Manual trim.',
  edge:      'Rectangular gate at the part edge. Most common multi-cavity choice.',
  pin:       'Small circular pin gate. 3-plate moulds, hot runners — auto-degates.',
  submarine: 'Angled tunnel gate, breaks off on ejection. No post-mould trimming.',
  fan:       'Wide tapered slot. Thin parts, sensitive surfaces, low stress.',
};

/**
 * Map per-vertex draft angles to RGB colours for a Three.js
 * BufferGeometry color attribute.
 *
 * Output layout: r0, g0, b0, r1, g1, b1, … — Float32 in [0, 1].
 * Length = 3 × vertexCount. Apply via:
 *
 *   geo.setAttribute('color', new THREE.BufferAttribute(colors, 3));
 *
 * and a material with `vertexColors: true`. Use a white-base material
 * so the vertex colour shows through directly without tinting.
 */

import { classifyDraftAngle } from './classify';

// Tailwind palette, lifted from the rest of the app for visual
// consistency with the heatmap / warning chips elsewhere.
const COL_POSITIVE = [0x22 / 255, 0xc5 / 255, 0x5e / 255]; // green-500
const COL_MARGINAL = [0xea / 255, 0xb3 / 255, 0x08 / 255]; // amber-500
const COL_UNDERCUT = [0xef / 255, 0x44 / 255, 0x44 / 255]; // red-500

export function vertexColorsForDraft(angles: Float32Array): Float32Array {
  const out = new Float32Array(angles.length * 3);
  for (let i = 0; i < angles.length; i++) {
    const cat = classifyDraftAngle(angles[i]!);
    const c = cat === 'positive' ? COL_POSITIVE
      : cat === 'marginal' ? COL_MARGINAL
      : COL_UNDERCUT;
    out[i * 3]     = c[0]!;
    out[i * 3 + 1] = c[1]!;
    out[i * 3 + 2] = c[2]!;
  }
  return out;
}

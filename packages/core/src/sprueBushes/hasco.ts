/**
 * HASCO sprue-bush Z-series (Z100 standard, Z102 cooled, Z104 extended).
 * Dimensions from HASCO catalogue; ISO-compatible.
 */

import type { SprueBush } from './dme';

export const HASCO_Z100: readonly SprueBush[] = [
  { series: 'HASCO-Z100', partNo: 'Z100/2.4', orificeMm: 2.4, lengthMm: 50,  taperDeg: 2, waterCooled: false },
  { series: 'HASCO-Z100', partNo: 'Z100/3.5', orificeMm: 3.5, lengthMm: 60,  taperDeg: 2, waterCooled: false },
  { series: 'HASCO-Z100', partNo: 'Z100/4.0', orificeMm: 4.0, lengthMm: 75,  taperDeg: 2, waterCooled: false },
  { series: 'HASCO-Z100', partNo: 'Z100/5.0', orificeMm: 5.0, lengthMm: 75,  taperDeg: 2, waterCooled: false },
  { series: 'HASCO-Z100', partNo: 'Z100/6.0', orificeMm: 6.0, lengthMm: 100, taperDeg: 2, waterCooled: false },
  { series: 'HASCO-Z100', partNo: 'Z100/8.0', orificeMm: 8.0, lengthMm: 100, taperDeg: 2, waterCooled: false },
];

export const HASCO_Z102: readonly SprueBush[] = [
  { series: 'HASCO-Z102', partNo: 'Z102/3.5', orificeMm: 3.5, lengthMm: 75,  taperDeg: 2, waterCooled: true },
  { series: 'HASCO-Z102', partNo: 'Z102/5.0', orificeMm: 5.0, lengthMm: 90,  taperDeg: 2, waterCooled: true },
  { series: 'HASCO-Z102', partNo: 'Z102/6.0', orificeMm: 6.0, lengthMm: 100, taperDeg: 2, waterCooled: true },
  { series: 'HASCO-Z102', partNo: 'Z102/8.0', orificeMm: 8.0, lengthMm: 120, taperDeg: 2, waterCooled: true },
];

export const HASCO_Z104: readonly SprueBush[] = [
  { series: 'HASCO-Z104', partNo: 'Z104/4.0',  orificeMm: 4.0,  lengthMm: 100, taperDeg: 2, waterCooled: true },
  { series: 'HASCO-Z104', partNo: 'Z104/6.0',  orificeMm: 6.0,  lengthMm: 125, taperDeg: 2, waterCooled: true },
  { series: 'HASCO-Z104', partNo: 'Z104/8.0',  orificeMm: 8.0,  lengthMm: 150, taperDeg: 2, waterCooled: true },
  { series: 'HASCO-Z104', partNo: 'Z104/10.0', orificeMm: 10.0, lengthMm: 150, taperDeg: 2, waterCooled: true },
];

/**
 * DME sprue-bush reference series (A-series standard production + B-series long).
 * Dimensions from published DME catalogue; 2° included taper is universal.
 */

export interface SprueBush {
  readonly series: 'DME-A' | 'DME-B' | 'HASCO-Z100' | 'HASCO-Z102' | 'HASCO-Z104';
  readonly partNo: string;
  readonly orificeMm: number;
  readonly lengthMm: number;
  readonly taperDeg: number; // included
  readonly waterCooled: boolean;
}

export const DME_A_SERIES: readonly SprueBush[] = [
  { series: 'DME-A', partNo: 'A-3.5-50', orificeMm: 3.5, lengthMm: 50, taperDeg: 2, waterCooled: false },
  { series: 'DME-A', partNo: 'A-4.0-50', orificeMm: 4.0, lengthMm: 50, taperDeg: 2, waterCooled: false },
  { series: 'DME-A', partNo: 'A-4.5-60', orificeMm: 4.5, lengthMm: 60, taperDeg: 2, waterCooled: false },
  { series: 'DME-A', partNo: 'A-5.0-60', orificeMm: 5.0, lengthMm: 60, taperDeg: 2, waterCooled: false },
  { series: 'DME-A', partNo: 'A-5.5-75', orificeMm: 5.5, lengthMm: 75, taperDeg: 2, waterCooled: false },
  { series: 'DME-A', partNo: 'A-6.5-75', orificeMm: 6.5, lengthMm: 75, taperDeg: 2, waterCooled: false },
  { series: 'DME-A', partNo: 'A-7.5-75', orificeMm: 7.5, lengthMm: 75, taperDeg: 2, waterCooled: false },
];

export const DME_B_SERIES: readonly SprueBush[] = [
  { series: 'DME-B', partNo: 'B-4.0-75',  orificeMm: 4.0, lengthMm: 75,  taperDeg: 2, waterCooled: true },
  { series: 'DME-B', partNo: 'B-5.0-90',  orificeMm: 5.0, lengthMm: 90,  taperDeg: 2, waterCooled: true },
  { series: 'DME-B', partNo: 'B-6.0-100', orificeMm: 6.0, lengthMm: 100, taperDeg: 2, waterCooled: true },
  { series: 'DME-B', partNo: 'B-7.0-100', orificeMm: 7.0, lengthMm: 100, taperDeg: 2, waterCooled: true },
  { series: 'DME-B', partNo: 'B-8.0-100', orificeMm: 8.0, lengthMm: 100, taperDeg: 2, waterCooled: true },
];

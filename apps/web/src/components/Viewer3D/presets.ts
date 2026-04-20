export interface CameraPreset {
  th: number;
  ph: number;
}

export const PRESETS: Record<string, CameraPreset> = {
  Top:    { th: 0, ph: Math.PI / 2 - 0.01 },
  Bottom: { th: 0, ph: -Math.PI / 2 + 0.01 },
  Front:  { th: 0, ph: 0.05 },
  Back:   { th: Math.PI, ph: 0.05 },
  Left:   { th: -Math.PI / 2, ph: 0.05 },
  Right:  { th:  Math.PI / 2, ph: 0.05 },
  'ISO 1': { th: 0.65, ph: 0.45 },
  'ISO 2': { th: -0.65, ph: 0.45 },
  'ISO 3': { th: Math.PI - 0.65, ph: 0.45 },
  'ISO 4': { th: Math.PI + 0.65, ph: 0.45 },
};

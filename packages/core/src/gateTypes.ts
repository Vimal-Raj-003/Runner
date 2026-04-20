/**
 * 13 gate-type reference data, exactly as in the HTML prototype.
 * `trim` indicates whether de-gating happens automatically on mould open
 * (pin, submarine, hot-runner, valve) or requires manual trimming.
 */

export type GateTrim = 'Manual' | 'Auto';

export type GateTypeId =
  | 'sprue'
  | 'edge'
  | 'tab'
  | 'overlap'
  | 'fan'
  | 'film'
  | 'diaphragm'
  | 'ring'
  | 'spoke'
  | 'pin'
  | 'submarine'
  | 'hot_runner'
  | 'valve';

export interface GateType {
  readonly id: GateTypeId;
  readonly label: string;
  readonly trim: GateTrim;
  readonly description: string;
}

export const GATE_TYPES: readonly GateType[] = [
  { id: 'sprue',      label: 'Sprue Gate',       trim: 'Manual', description: 'Direct feed, large mark, single cavity' },
  { id: 'edge',       label: 'Edge/Side Gate',   trim: 'Manual', description: 'Most common, rectangular channel at parting line' },
  { id: 'tab',        label: 'Tab Gate',         trim: 'Manual', description: 'Reduces stress via 90° turn, for solid blocks' },
  { id: 'overlap',    label: 'Overlap Gate',     trim: 'Manual', description: 'Prevents jetting, bridges to opposite wall' },
  { id: 'fan',        label: 'Fan Gate',         trim: 'Manual', description: 'Wide entry for thin-wall large-area parts' },
  { id: 'film',       label: 'Film/Flash Gate',  trim: 'Manual', description: 'Full-width thin gate for flat parts' },
  { id: 'diaphragm',  label: 'Diaphragm Gate',   trim: 'Manual', description: '360° feed for round parts, no weld lines' },
  { id: 'ring',       label: 'Ring Gate',        trim: 'Manual', description: 'External ring feed for tubular parts' },
  { id: 'spoke',      label: 'Spoke/Multipoint', trim: 'Manual', description: 'Multiple entry points from ring' },
  { id: 'pin',        label: 'Pin Gate',         trim: 'Auto',   description: 'Small round gate, 3-plate or hot runner' },
  { id: 'submarine',  label: 'Submarine/Tunnel', trim: 'Auto',   description: 'Below parting line, auto-shear on open' },
  { id: 'hot_runner', label: 'Hot Runner Gate',  trim: 'Auto',   description: 'Heated nozzle, no runner waste' },
  { id: 'valve',      label: 'Valve Gate',       trim: 'Auto',   description: 'Mechanical valve in hot runner nozzle' },
];

export function getGateType(id: GateTypeId): GateType {
  const gt = GATE_TYPES.find((g) => g.id === id);
  if (!gt) throw new Error(`Unknown gate type: ${id}`);
  return gt;
}

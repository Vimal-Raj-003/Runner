'use client';

import { forwardRef } from 'react';
import type { ButtonHTMLAttributes } from 'react';

/**
 * Chip button — palette matches the original HTML prototype:
 *   - neutral : dark panel button (#1e2128) with hover (#2a2d35)
 *   - active  : solid blue-600, white text (cavity count, gates, 3D, Eng Panel)
 *   - accent  : solid green-600, white text (layout selection, primary CTA)
 *   - warn    : solid orange-600, white text (Hot Runner, Reset)
 *
 * Disabled state is 40 % opacity + `cursor-not-allowed` on a dimmer bg.
 * Every button gets a green focus-visible ring for keyboard users.
 */

export type ButtonTone = 'neutral' | 'active' | 'accent' | 'warn';

export interface ChipButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  tone?: ButtonTone;
  compact?: boolean;
}

const base =
  'inline-flex items-center justify-center rounded-md font-medium transition-colors ' +
  'duration-150 ease-out select-none focus-visible:outline-none ' +
  'focus-visible:shadow-focus-accent';

const tones: Record<ButtonTone, string> = {
  // Dark resting button (the default look across the whole HTML prototype)
  neutral:
    'bg-[#1e2128] text-zinc-200 border border-[#2a2d35] hover:bg-[#2a2d35] ' +
    'disabled:bg-[#141619] disabled:text-zinc-600 disabled:border-[#1a1c22] disabled:cursor-not-allowed',
  // Blue selected state (matches the HTML's cavity/gates/3D/Eng-Panel active look)
  active:
    'bg-blue-600 text-white border border-blue-600 hover:bg-blue-700 ' +
    'disabled:opacity-40 disabled:cursor-not-allowed',
  // Green layout / primary CTA (matches the HTML's layout-selected look)
  accent:
    'bg-green-600 text-white border border-green-600 hover:bg-green-700 font-semibold ' +
    'disabled:opacity-40 disabled:cursor-not-allowed',
  // Orange hot-runner / Reset (matches the HTML's warm-tone action look)
  warn:
    'bg-orange-600 text-white border border-orange-600 hover:bg-orange-700 ' +
    'disabled:opacity-40 disabled:cursor-not-allowed',
};

export const ChipButton = forwardRef<HTMLButtonElement, ChipButtonProps>(function ChipButton(
  { tone = 'neutral', compact = false, className = '', children, ...rest },
  ref,
) {
  const size = compact ? 'h-7 px-2.5 text-[11px]' : 'h-8 px-3 text-xs';
  return (
    <button ref={ref} className={`${base} ${size} ${tones[tone]} ${className}`} {...rest}>
      {children}
    </button>
  );
});

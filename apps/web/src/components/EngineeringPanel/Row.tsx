import type { ReactNode } from 'react';

/**
 * Dense metric row. Left column is the label in muted body, right column
 * is the value in tabular-numeric monospace so columns align across many
 * rows. `emphasis` bolds and tints the value for key figures.
 */
export function Row({
  label, value, emphasis, hint,
}: {
  label: string;
  value: ReactNode;
  emphasis?: boolean;
  hint?: string;
}) {
  return (
    <div
      className="flex items-center justify-between border-b border-border/40 py-1 text-[11.5px] last:border-0"
      title={hint}
    >
      <span className="truncate text-muted">{label}</span>
      <span
        className={`num ml-3 shrink-0 text-right ${
          emphasis ? 'text-accent font-semibold' : 'text-fg'
        }`}
      >
        {value}
      </span>
    </div>
  );
}

export function SectionHeader({
  children,
  hint,
}: {
  children: ReactNode;
  hint?: string;
}) {
  return (
    <div className="mb-1.5 mt-4 first:mt-0">
      <div className="flex items-center gap-2">
        <span className="h-px flex-1 bg-border/60" aria-hidden />
        <span className="font-heading text-[10px] font-semibold uppercase tracking-[0.14em] text-accent">
          {children}
        </span>
        <span className="h-px flex-1 bg-border/60" aria-hidden />
      </div>
      {hint && (
        <div className="num mt-1 text-[10px] text-muted">{hint}</div>
      )}
    </div>
  );
}

export function Chip({
  children,
  tone = 'info',
}: {
  children: ReactNode;
  tone?: 'info' | 'warn' | 'error' | 'success';
}) {
  const classes = {
    info:    'bg-info/10    text-info    border-info/40',
    warn:    'bg-warn/10    text-warn    border-warn/40',
    error:   'bg-danger/10  text-danger  border-danger/40',
    success: 'bg-accent/10  text-accent  border-accent/40',
  }[tone];
  return (
    <span className={`inline-block rounded-md border px-2 py-0.5 text-[10px] font-semibold ${classes}`}>
      {children}
    </span>
  );
}

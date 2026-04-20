'use client';

import { useState, useId, type ReactNode } from 'react';

/**
 * Collapsible section wrapper used across the right-hand panels. The header
 * is a button whose click toggles the body; body mounts/unmounts so it
 * doesn't compete for vertical space when collapsed.
 */

export function Collapsible({
  title,
  hint,
  defaultOpen = true,
  children,
  count,
}: {
  title: string;
  hint?: ReactNode;
  defaultOpen?: boolean;
  children: ReactNode;
  count?: number | string;
}) {
  const [open, setOpen] = useState(defaultOpen);
  const panelId = useId();

  return (
    <section className="mt-3 first:mt-0">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        aria-controls={panelId}
        className="group flex w-full items-center gap-2 rounded-md px-1 py-1 text-left transition-colors hover:bg-bg/40 focus-visible:outline-none focus-visible:shadow-focus-accent"
      >
        <Chevron open={open} />
        <span className="flex-1 font-heading text-[11px] font-semibold uppercase tracking-[0.14em] text-accent">
          {title}
        </span>
        {count !== undefined && (
          <span className="num rounded-sm bg-bg/60 px-1.5 py-0.5 text-[9.5px] text-muted">
            {count}
          </span>
        )}
      </button>
      {hint && (
        <div className="num ml-5 text-[10px] text-muted">{hint}</div>
      )}
      {open && (
        <div id={panelId} className="mt-1.5">
          {children}
        </div>
      )}
    </section>
  );
}

function Chevron({ open }: { open: boolean }) {
  return (
    <svg
      width="10"
      height="10"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2.5"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      className={`text-muted transition-transform duration-150 ${open ? 'rotate-90' : ''}`}
    >
      <path d="M9 6l6 6-6 6" />
    </svg>
  );
}

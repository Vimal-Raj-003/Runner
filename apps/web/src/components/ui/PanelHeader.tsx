'use client';

import type { ReactNode } from 'react';

/**
 * Panel header primitive used by the right-hand panels.
 * Provides a title, optional subtitle, and a close "×" button.
 */

export function PanelHeader({
  title,
  subtitle,
  onClose,
  children,
  id,
}: {
  title: string;
  subtitle?: ReactNode;
  onClose: () => void;
  children?: ReactNode;
  id?: string;
}) {
  return (
    <header className="sticky -top-3 z-10 -mx-4 -mt-3 mb-2 flex items-start gap-2 border-b border-border bg-surface/95 px-4 py-3 backdrop-blur-sm">
      <div className="flex-1 min-w-0">
        <h2 id={id} className="font-heading text-sm font-semibold tracking-tight truncate">
          {title}
        </h2>
        {subtitle && (
          <p className="mt-0.5 text-[10px] text-muted truncate">{subtitle}</p>
        )}
        {children}
      </div>
      <button
        type="button"
        onClick={onClose}
        aria-label={`Close ${title}`}
        title={`Close ${title}`}
        className="grid h-7 w-7 place-items-center rounded-md border border-[#2a2d35] bg-[#1e2128] text-zinc-300 transition-colors hover:bg-[#2a2d35] hover:text-white focus-visible:outline-none focus-visible:shadow-focus-accent"
      >
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.25" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <path d="M6 6l12 12M18 6L6 18" />
        </svg>
      </button>
    </header>
  );
}

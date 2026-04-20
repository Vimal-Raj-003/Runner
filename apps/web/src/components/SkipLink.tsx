'use client';

/**
 * Keyboard-only skip link. Hidden until focused; lets tab-navigation users
 * jump past the control bars straight to the 3D viewer.
 */
export function SkipLink() {
  return (
    <a
      href="#viewer-3d"
      className="sr-only absolute left-2 top-2 z-[100] rounded-md bg-accent px-3 py-2 text-xs font-semibold text-accentFg focus:not-sr-only focus-visible:shadow-focus-accent"
    >
      Skip to 3D viewer
    </a>
  );
}

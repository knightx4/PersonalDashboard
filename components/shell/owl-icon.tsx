import type { SVGProps } from 'react';

/**
 * Maya's mark: an owl, drawn to lucide's grid so it sits beside the other
 * nav icons (24 units, a 2-unit round stroke, no fill). Lucide has no owl.
 *
 * It is the Maya tab's icon in the vault's nav (components/shell/nav-icons.ts)
 * and Maya's mark beside what it writes in a thread, so the two read as the
 * same character. Dash keeps the bot glyph; Maya is someone else.
 */
export function OwlIcon({
  strokeWidth = 2,
  className,
  ...props
}: SVGProps<SVGSVGElement> & { strokeWidth?: number | string }) {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 24 24"
      width={24}
      height={24}
      fill="none"
      stroke="currentColor"
      strokeWidth={strokeWidth}
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
      {...props}
    >
      {/* Head and body, the ear tufts at the two top corners. */}
      <path d="M5 3.5l3 3h8l3-3V13a7 7 0 0 1-14 0z" />
      <circle cx="9.25" cy="11" r="1.75" />
      <circle cx="14.75" cy="11" r="1.75" />
      {/* The beak. */}
      <path d="M11 14.25l1 1.5 1-1.5" />
    </svg>
  );
}

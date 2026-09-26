'use client';

import { Plus } from 'lucide-react';
import { cn } from '@/lib/cn';

/**
 * The line that opens a compose surface.
 *
 * The other half of law 14. A section whose job is to show what you have
 * written should not lead with an empty box for writing more: the box is what
 * this stands in for, and it costs one line instead of a hundred pixels of
 * chrome nobody asked for.
 *
 * Quiet on purpose -- ink-ghost, no border, no ground until it is pointed at.
 * It is an offer, not the point of the section, and a full-width bordered
 * "Add" button is just the empty box again wearing a different shape.
 */
export function AddTrigger({
  label,
  onClick,
  disabled,
  className,
}: {
  label: string;
  onClick: () => void;
  disabled?: boolean;
  className?: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className={cn(
        'press -ml-1.5 inline-flex items-center gap-1.5 rounded-control px-1.5 py-1',
        'text-ui text-ink-ghost transition-colors duration-150 hover:bg-sunken hover:text-ink-muted disabled:opacity-50',
        className,
      )}
    >
      <Plus className="size-3.5 shrink-0" strokeWidth={1.75} aria-hidden />
      {label}
    </button>
  );
}

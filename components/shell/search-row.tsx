'use client';

import { CornerDownLeft, Palette } from 'lucide-react';
import { cn } from '@/lib/cn';
import { HIT_KINDS } from '@/lib/search/sources';
import { ModuleMark } from '@/components/ui/module-mark';
import type { SearchRow } from '@/components/shell/use-search-rows';

/**
 * One row of a search box, wherever the box is.
 *
 * There are two boxes drawing the same rows -- the modal, and the bar across
 * the top of the workspace -- and what a row looks like is not the difference
 * between them. Left here it would be two copies of the mark, the hint, the
 * truncation and the Enter glyph, and the first of them to be changed would
 * be the only one that was.
 *
 * `use-search-rows.ts` already owns what goes in the list and in what order.
 * This owns what one of them looks like; the box itself owns the field, the
 * keys and where the list hangs.
 */
export function SearchRowLine({
  row,
  active,
  onChoose,
  onPoint,
}: {
  row: SearchRow;
  /** The row the arrow keys are on, which Enter would open. */
  active: boolean;
  onChoose: () => void;
  /** The pointer moved over this row, so it becomes the one Enter would open. */
  onPoint: () => void;
}) {
  const label = row.kind === 'command' ? row.command.label : row.hit.title;
  const hint =
    row.kind === 'command' ? row.command.hint : (row.hit.subtitle ?? HIT_KINDS[row.hit.kind]);
  const where = row.kind === 'command' ? (row.command.module ?? null) : row.hit.module;

  return (
    <button
      type="button"
      onClick={onChoose}
      onMouseMove={onPoint}
      className={cn(
        'flex w-full items-center gap-2.5 rounded-control px-2.5 py-2 text-left transition-colors',
        active ? 'bg-accent-tint' : 'hover:bg-sunken',
      )}
    >
      {row.kind === 'command' && row.command.icon === 'theme' ? (
        <Palette className="size-4 shrink-0 text-ink-muted" strokeWidth={1.75} aria-hidden />
      ) : (
        // The mark of wherever it lives, so which workspace a row belongs to
        // is readable without a label.
        <ModuleMark module={where} size="sm" />
      )}
      <span className="min-w-0 flex-1 truncate text-ui font-medium text-ink">{label}</span>
      {hint && <span className="shrink-0 truncate text-small text-ink-muted">{hint}</span>}
      {active && (
        <CornerDownLeft className="size-3.5 shrink-0 text-accent" strokeWidth={1.75} aria-hidden />
      )}
    </button>
  );
}

'use client';

import { useOptimistic, useTransition } from 'react';
import { Columns3, Rows3 } from 'lucide-react';
import { cn } from '@/lib/cn';
import type { PipelineView } from '@/components/jobs/pipeline/board';
import { setPipelineView } from '@/app/jobs/(app)/pipeline/actions';

const VIEWS: Array<{ id: PipelineView; label: string; icon: typeof Columns3 }> = [
  { id: 'board', label: 'Board', icon: Columns3 },
  { id: 'list', label: 'List', icon: Rows3 },
];

/**
 * Board or list, remembered.
 *
 * Optimistic because the write is a preference on the profile and the redraw
 * comes back through revalidation: without it the pressed segment would stay
 * unpressed for a round trip, which reads as the button not working.
 */
export function PipelineViewToggle({ view }: { view: PipelineView }) {
  const [busy, startTransition] = useTransition();
  const [shown, setShown] = useOptimistic(view);

  return (
    <span
      role="group"
      aria-label="Pipeline view"
      className="inline-flex overflow-hidden rounded-lg border border-border"
    >
      {VIEWS.map(({ id, label, icon: Icon }) => (
        <button
          key={id}
          type="button"
          disabled={busy}
          aria-pressed={shown === id}
          onClick={() =>
            startTransition(async () => {
              setShown(id);
              await setPipelineView(id);
            })
          }
          className={cn(
            'inline-flex items-center gap-1.5 px-2.5 py-1.5 text-small font-medium transition-colors duration-150',
            shown === id
              ? 'bg-accent-tint text-accent'
              : 'bg-surface text-ink-muted hover:bg-canvas hover:text-ink',
          )}
        >
          <Icon className="size-3.5" strokeWidth={1.75} aria-hidden />
          {label}
        </button>
      ))}
    </span>
  );
}

'use client';

import { ModuleMark } from '@/components/ui/module-mark';
import { cn } from '@/lib/cn';

/**
 * The start of a new chat with Dash, shared by the Dash page and the Ask Dash
 * sheet so the two open the same way: Dash's mark, a heading, and a line on what
 * he reads.
 */

/** Under the heading of a new chat: what Dash reads and what he will not do unasked. */
export const NEW_CHAT_LINE =
  'I look things up in your own orders, applications, todos, goals, notes and email, and link every row I used. Nothing is changed until you confirm it.';

/**
 * Dash's mark, the heading and the line under it. `compact` is the sheet's
 * size, narrower than the page's pane; `line` takes the place of the usual
 * one, as when rows sent from a list are what Dash will read.
 */
export function DashWelcome({ compact = false, line = NEW_CHAT_LINE }: { compact?: boolean; line?: string }) {
  return (
    <div className="flex flex-col items-center text-center">
      <ModuleMark module="dash" size={compact ? 'md' : 'lg'} />
      <h2
        className={cn(
          'font-display text-balance font-semibold tracking-tight text-ink',
          compact ? 'mt-3 text-heading' : 'mt-4 text-title',
        )}
      >
        What should we look up?
      </h2>
      <p className={cn('mt-1.5 text-pretty text-ink-muted', compact ? 'max-w-sm text-ui' : 'max-w-md text-body')}>
        {line}
      </p>
    </div>
  );
}

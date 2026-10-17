'use client';

import { ModuleMark } from '@/components/ui/module-mark';
import { buttonVariants } from '@/components/ui/button';
import { cn } from '@/lib/cn';
import type { ModuleId } from '@/lib/modules';

/**
 * The start of a new chat with Dash, shared by the Dash page and the Ask Dash
 * sheet so the two open the same way: Dash's mark, a heading, a line on what
 * he reads, and questions to start from under the box.
 */

/** Under the heading of a new chat: what Dash reads and what he will not do unasked. */
export const NEW_CHAT_LINE =
  'I look things up in your own orders, applications, todos, goals, notes and email, and link every row I used. Nothing is changed until you confirm it.';

/**
 * Questions a new chat offers to start from, one per workspace, shown for the
 * workspaces the account has on. Each is a question Dash can answer from
 * lookups alone, so a press costs one answer and changes nothing.
 */
export const STARTERS: readonly { workspace: ModuleId; question: string }[] = [
  { workspace: 'jobs', question: 'Which applications have not heard back in two weeks?' },
  { workspace: 'shopping', question: 'What did I spend this month, by shop?' },
  { workspace: 'todo', question: 'What is overdue on my todo list?' },
  { workspace: 'goals', question: 'Which goal have I left alone the longest?' },
  { workspace: 'learn', question: 'What is left on my reading list?' },
  { workspace: 'vault', question: 'What have I written about my job search?' },
];

/** The starters for these workspaces, or all of them when the list is not known. */
export function startersFor(workspaces: readonly ModuleId[] | undefined) {
  return workspaces ? STARTERS.filter((starter) => workspaces.includes(starter.workspace)) : STARTERS;
}

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

/**
 * The questions to start from, each with its workspace's mark; a press asks
 * it. On the page they wrap in a row under the box. The sheet is too narrow
 * for a row of them to read, so there they stack as quiet rows, lighter than
 * the box above them.
 */
export function DashStarters({
  workspaces,
  onAsk,
  compact = false,
}: {
  workspaces: readonly ModuleId[] | undefined;
  onAsk: (question: string) => void;
  compact?: boolean;
}) {
  const starters = startersFor(workspaces);
  if (starters.length === 0) return null;
  return (
    <ul
      aria-label="Questions to start from"
      className={compact ? '-mx-2 space-y-0.5' : 'flex flex-wrap justify-center gap-2'}
    >
      {starters.map(({ workspace, question }) => (
        <li key={workspace}>
          <button
            type="button"
            onClick={() => onAsk(question)}
            className={
              compact
                ? 'press flex min-h-11 w-full items-center gap-3 rounded-control px-2 text-left text-ui text-ink-muted transition-colors duration-quick hover:bg-sunken hover:text-ink sm:min-h-9'
                : cn(buttonVariants({ variant: 'secondary' }), 'h-auto min-h-11 text-left font-normal sm:min-h-9')
            }
          >
            <ModuleMark module={workspace} size="xs" />
            {question}
          </button>
        </li>
      ))}
    </ul>
  );
}

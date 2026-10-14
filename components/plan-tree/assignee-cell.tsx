'use client';

import { createContext, useContext, type ReactNode } from 'react';
import { StateLabel } from '@/components/dev/state-label';
import { DashMark } from '@/components/ui/dash-mark';
import { cn } from '@/lib/cn';

/**
 * Who a row is on, as the Assignee column draws it (plan #2069.1).
 *
 * You show as your avatar's initial, the same letter the account button in
 * the top bar carries, and Dash as its mark. A row split between you shows
 * both. The word sits beside them from sm up; on a phone the marks stand
 * alone, and the tooltip says who in words.
 *
 * Dash's mark moves only while a session is working the row, and goes still
 * under reduced motion like every other working mark (app/globals.css).
 * Otherwise it is drawn unlit, so a page of Dash's steps is not a page of
 * moving faces.
 *
 * Shared, so a goal's page can draw the same cell (plan #2069.2). Who is on
 * the row is the page's to work out: the plan's comes from `assigneeOf` and
 * `assigneeTitle` in lib/plan/tree.ts.
 */

export type AssigneeWho = 'you' | 'dash' | 'both';

const WORD: Record<AssigneeWho, string> = { you: 'You', dash: 'Dash', both: 'Both' };

/**
 * The person's initial, set once by the shell (lib/shell/shell-for.tsx) so a
 * cell anywhere under it can draw it. Null outside the shell, as in the
 * gallery, where the cell draws a "Y".
 */
const InitialContext = createContext<string | null>(null);

export function YourInitialProvider({
  initial,
  children,
}: {
  initial: string | null;
  children: ReactNode;
}) {
  return <InitialContext.Provider value={initial}>{children}</InitialContext.Provider>;
}

/** Your initial in the avatar's circle, the size of Dash's mark beside it. */
export function YourInitial({ className }: { className?: string }) {
  const initial = useContext(InitialContext) ?? 'Y';
  return (
    <span
      aria-hidden
      className={cn(
        'inline-flex size-4 shrink-0 items-center justify-center rounded-full bg-accent text-micro font-semibold leading-none text-fill-ink',
        className,
      )}
    >
      {initial}
    </span>
  );
}

export function AssigneeCell({
  who,
  working = false,
  title,
  align,
  defaultOpen,
  className,
}: {
  who: AssigneeWho;
  /** A session is working the row now: Dash's mark moves. */
  working?: boolean;
  /** Who, in a sentence, and on a split row how many steps each holds. */
  title: string;
  align?: 'start' | 'end';
  /** Start with the tooltip showing. For the gallery's shots. */
  defaultOpen?: boolean;
  className?: string;
}) {
  return (
    <StateLabel
      glyph={null}
      word={WORD[who]}
      tone="quiet"
      title={title}
      align={align}
      defaultOpen={defaultOpen}
      className={cn('gap-1', className)}
      wordClassName="max-sm:sr-only ml-0.5"
    >
      {who !== 'dash' && <YourInitial />}
      {who !== 'you' && (
        <DashMark
          size="icon"
          decorative
          tone="brand"
          state={working ? 'working' : 'idle'}
          still={!working}
        />
      )}
    </StateLabel>
  );
}

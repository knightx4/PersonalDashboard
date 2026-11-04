import { BackLink } from '@/components/shell/back-link';
import { PageWide } from '@/components/shell/page-width';
import { LinkedText } from '@/components/ui/linked-text';
import { SectionLabel } from '@/components/ui/section-heading';
import { cn } from '@/lib/cn';

/**
 * The messaging pattern (plan #2748.13, decision #2748.5, answer B): a list of
 * people beside the open thread, as a texting app draws it. It is the shell
 * and the parts of a thread; the Chat workspace's People tab fills it with
 * real threads (#2748.6).
 *
 * It sits beside the conversation pattern and does not replace it: that one is
 * built for Ask Dash (a hideable list, a reading-width chat, a glance column)
 * and neither groups bubbles by sender nor fixes the box at the foot.
 *
 * From 720 pixels wide the list of people is on the left and the open thread
 * on the right, each a pane of its own as tall as the window, so the box
 * stays at the foot while the messages scroll between the name and the box.
 * Below 720 pixels one pane is drawn at a time: the list, or the open thread
 * with the way back above the person's name. Each slot is drawn once and
 * hidden by width, never twice.
 */

/** A pane's height: the window less the shell's top bar and the page's padding, and from lg the status line. */
const PANE_H = 'min-[720px]:h-[calc(100dvh-6rem)] min-[720px]:min-h-[28rem] lg:h-[calc(100dvh-8rem)]';

export function Messaging({
  label,
  list,
  open,
  children,
}: {
  /** What the list is called, as the name of its landmark. */
  label: string;
  /** The list: its heading and what narrows it, then one row per person. */
  list: React.ReactNode;
  /** A thread is open, so a phone shows it in place of the list. */
  open: boolean;
  /** The open thread, drawn by MessagingThread. */
  children?: React.ReactNode;
}) {
  return (
    <PageWide className="grid grid-cols-1 min-[720px]:grid-cols-[16rem_minmax(0,1fr)] min-[720px]:gap-x-3 lg:grid-cols-[20rem_minmax(0,1fr)]">
      <aside
        aria-label={label}
        className={cn(
          'sheet flex min-w-0 flex-col overflow-hidden rounded-card bg-surface',
          PANE_H,
          open && 'max-[719px]:hidden',
        )}
      >
        {list}
      </aside>
      <section aria-label="Open thread" className={cn('min-w-0', !open && 'max-[719px]:hidden')}>
        {children}
      </section>
    </PageWide>
  );
}

/**
 * The open thread: the person's name on a bar of its own, the messages
 * scrolling under it, oldest at the top, and the box fixed at the foot. On a
 * phone the way back to the list sits above the name.
 */
export function MessagingThread({
  name,
  detail,
  avatar,
  back,
  box,
  children,
}: {
  name: string;
  /** One quiet line under the name, such as what they help with. */
  detail?: string;
  avatar?: React.ReactNode;
  /** On a phone, the way back to the list of people. */
  back: { href: string; label: string };
  /** The box, fixed at the foot of the pane. */
  box: React.ReactNode;
  /** The messages, oldest first: day labels and MessageGroups. */
  children: React.ReactNode;
}) {
  return (
    <div
      className={cn(
        'flex min-w-0 flex-col overflow-hidden bg-surface min-[720px]:sheet min-[720px]:rounded-card',
        'h-[calc(100dvh-6rem)] min-h-[28rem]',
        PANE_H,
      )}
    >
      <header className="shrink-0 border-b border-border px-4 py-2.5">
        <div className="mb-1 min-[720px]:hidden">
          <BackLink crumbs={[]} fallback={back} />
        </div>
        <div className="flex items-center gap-2.5">
          {avatar}
          <div className="min-w-0">
            <h1 className="truncate text-body font-semibold text-ink">{name}</h1>
            {detail && <p className="truncate text-small text-ink-muted">{detail}</p>}
          </div>
        </div>
      </header>
      {/* The only part that scrolls; the box below it stays where it is. */}
      <div className="flex min-h-0 flex-1 flex-col overflow-y-auto px-4 py-4 [scrollbar-gutter:stable]">
        {children}
      </div>
      <div className="shrink-0 border-t border-border px-3 py-3">{box}</div>
    </div>
  );
}

/** The day a run of messages was sent, centred above it. */
export function MessageDay({ children }: { children: React.ReactNode }) {
  return (
    <SectionLabel className="my-3 self-center first:mt-0">{children}</SectionLabel>
  );
}

/**
 * Consecutive messages from one sender: yours on the right, theirs on the
 * left, a small gap between the bubbles of a group and a larger one between
 * groups.
 */
export function MessageGroup({
  from,
  children,
}: {
  from: 'you' | 'them';
  /** The bubbles of the group, as MessageBubble. */
  children: React.ReactNode;
}) {
  return (
    <div
      data-from={from}
      className={cn(
        'mb-2 flex max-w-[80%] flex-col gap-0.5 sm:max-w-md',
        from === 'you' ? 'items-end self-end' : 'items-start self-start',
      )}
    >
      {children}
    </div>
  );
}

export function MessageBubble({ from, children }: { from: 'you' | 'them'; children: string }) {
  return (
    <p
      className={cn(
        'whitespace-pre-wrap break-words rounded-card px-3 py-2 text-body',
        from === 'you' ? 'bg-accent text-fill-ink' : 'bg-sunken text-ink',
      )}
    >
      <LinkedText text={children} />
    </p>
  );
}

/** A round mark with the person's initials, for the list and the thread's bar. */
export function PersonMark({ initials, size = 'md' }: { initials: string; size?: 'sm' | 'md' }) {
  return (
    <span
      aria-hidden
      className={cn(
        'flex shrink-0 items-center justify-center rounded-full bg-accent-tint font-display font-semibold text-accent',
        size === 'md' ? 'size-11 text-ui' : 'size-8 text-small',
      )}
    >
      {initials}
    </span>
  );
}

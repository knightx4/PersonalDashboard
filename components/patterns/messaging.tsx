import { BackLink } from '@/components/shell/back-link';
import { PageWide } from '@/components/shell/page-width';
import { chipVariants } from '@/components/ui/chip';
import Link from '@/components/ui/link';
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
 * on the right, one framed window as tall as the window with a hairline
 * between the two, so the box stays at the foot while the messages scroll
 * between the name and the box (plan #2748.6, after the reference). Below 720
 * pixels one pane is drawn at a time: the list, or the open thread with the
 * way back above the person's name, held between the top bar and the dock.
 * Each slot is drawn once and hidden by width, never twice.
 */

/** A pane's height: the window less the shell's top bar and the page's padding, and from lg the status line. */
const PANE_H = 'min-[720px]:h-[calc(100dvh-6rem)] min-[720px]:min-h-[28rem] lg:h-[calc(100dvh-8rem)]';

/**
 * A thread's pane on a phone: held between the top bar and the dock with the
 * reference's 16-pixel inset, so the way back and the name stay at its top,
 * the box sits on the dock, and only the messages scroll.
 */
const PHONE_PANE =
  'max-[719px]:sheet max-[719px]:fixed max-[719px]:inset-x-4 max-[719px]:top-[calc(env(safe-area-inset-top)+4.75rem)] max-[719px]:bottom-[calc(var(--dock-h)+env(safe-area-inset-bottom)+0.5rem)] max-[719px]:rounded-card';

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
    <PageWide
      className={cn(
        'grid grid-cols-1 min-[720px]:grid-cols-[16rem_minmax(0,1fr)] lg:grid-cols-[20rem_minmax(0,1fr)]',
        'min-[720px]:sheet min-[720px]:overflow-hidden min-[720px]:rounded-card min-[720px]:bg-surface',
      )}
    >
      <aside
        aria-label={label}
        className={cn(
          'flex min-w-0 flex-col overflow-hidden bg-surface max-[719px]:sheet max-[719px]:rounded-card',
          'min-[720px]:border-r min-[720px]:border-border',
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
  scrollRef,
  onScroll,
  children,
}: {
  /** Their name; a skeleton while the thread loads. */
  name: React.ReactNode;
  /** One quiet line under the name, such as what they help with. */
  detail?: string;
  avatar?: React.ReactNode;
  /** On a phone, the way back to the list of people. */
  back: { href: string; label: string };
  /** The box, fixed at the foot of the pane. */
  box: React.ReactNode;
  /** The scrolling part, for a thread that keeps its place or reads further back. */
  scrollRef?: React.Ref<HTMLDivElement>;
  onScroll?: React.UIEventHandler<HTMLDivElement>;
  /** The messages, oldest first: day labels and MessageGroups. */
  children: React.ReactNode;
}) {
  return (
    <div
      className={cn(
        'flex min-w-0 flex-col overflow-hidden bg-surface',
        PHONE_PANE,
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
            {typeof name === 'string' ? <h1 className="truncate text-body font-semibold text-ink">{name}</h1> : name}
            {detail && <p className="truncate text-small text-ink-muted">{detail}</p>}
          </div>
        </div>
      </header>
      {/* The only part that scrolls; the box below it stays where it is. */}
      <div
        ref={scrollRef}
        onScroll={onScroll}
        className="flex min-h-0 flex-1 flex-col overflow-y-auto px-4 py-4 [scrollbar-gutter:stable]"
      >
        {children}
      </div>
      <div className="shrink-0 px-3 pt-2 pb-3">{box}</div>
    </div>
  );
}

/** The day a run of messages was sent, centred above it. */
export function MessageDay({ children }: { children: React.ReactNode }) {
  // Small capitals at regular weight, as the reference, so a day reads as a marker between the bubbles.
  return <SectionLabel className="mt-4 mb-2 self-center font-normal tracking-wide">{children}</SectionLabel>;
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
        // Bubbles stop short of the far side, as the reference's 72%, so whose turn it is reads by side as well as fill.
        'mb-2 flex max-w-3/4 flex-col gap-0.5 lg:max-w-lg',
        from === 'you' ? 'items-end self-end' : 'items-start self-start',
      )}
    >
      {children}
    </div>
  );
}

/**
 * One message. Bubbles are round; within a group every bubble but the last
 * tucks its corner on the sender's side, so the run reads as one turn.
 */
export function MessageBubble({
  from,
  last = true,
  arriving = false,
  children,
}: {
  from: 'you' | 'them';
  last?: boolean;
  /** It came in while the thread was open, so it rises into place. */
  arriving?: boolean;
  children: string;
}) {
  return (
    <p
      className={cn(
        arriving && 'message-in',
        'whitespace-pre-wrap break-words rounded-[1.125rem] px-3 py-2 text-body', /* ui-ok: a chat bubble's round, from the reference; no card or control radius is a bubble */
        from === 'you' ? 'bg-accent text-fill-ink' : 'bg-sunken text-ink',
        // The corner tucked on the sender's side marks a run from one sender.
        !last && (from === 'you' ? 'rounded-br-md' : 'rounded-bl-md'), /* ui-ok: the reference's tucked corner inside a run of bubbles */
      )}
    >
      <LinkedText text={children} />
    </p>
  );
}

/** A row a message points at, such as the to do it is about: a small outlined chip under its bubble. */
export function MessageLink({ href, children }: { href: string; children: React.ReactNode }) {
  return (
    <Link
      href={href}
      className={cn(chipVariants({ tone: 'neutral' }), 'press-area my-0.5 max-w-full hover:text-ink')}
    >
      <span aria-hidden>↳</span>
      <span className="truncate">{children}</span>
    </Link>
  );
}

/** A quiet line under a message: Delivered, Read, Sending, or why it was not sent. */
export function MessageNote({ tone = 'quiet', children }: { tone?: 'quiet' | 'danger'; children: React.ReactNode }) {
  return (
    <p className={cn('mt-0.5 px-1 text-small', tone === 'danger' ? 'text-danger' : 'text-ink-muted')}>{children}</p>
  );
}

/** Their typing: three dots in a bubble of theirs, at the foot of the thread. */
export function TypingBubble({ name }: { name: string }) {
  return (
    <div className="typing-in mb-2 self-start" role="status" aria-label={`${name} is typing`}>
      <span className="flex items-center gap-1 rounded-[1.125rem] bg-sunken px-3.5 py-3.5">{/* ui-ok: a bubble's round, as MessageBubble */}
        {[0, 1, 2].map((i) => (
          <span
            key={i}
            aria-hidden
            className="typing-dot size-1.5 rounded-pill bg-ink-muted"
            style={{ animationDelay: `calc(var(--motion-quick) * ${i})` }}
          />
        ))}
      </span>
    </div>
  );
}

/** The thread's pane before one is chosen, on a laptop only, saying how to open one. */
export function MessagingPlaceholder({ children }: { children: React.ReactNode }) {
  return (
    <div className={cn('flex flex-col items-center justify-center bg-surface px-6 text-center', PANE_H)}>
      {children}
    </div>
  );
}

/**
 * A round mark with the person's initials, for the list and the thread's bar.
 * `colour` is the person's own, a dark hue that carries white initials;
 * without one it is drawn in the accent's tint.
 */
export function PersonMark({
  initials,
  colour,
  size = 'md',
}: {
  initials: string;
  colour?: string;
  size?: 'sm' | 'md' | 'lg';
}) {
  return (
    <span
      aria-hidden
      style={colour ? { backgroundColor: colour } : undefined}
      className={cn(
        'flex shrink-0 items-center justify-center rounded-full font-display font-semibold',
        colour ? 'text-white' : 'bg-accent-tint text-accent',
        size === 'lg' && 'size-16 text-title',
        size === 'md' && 'size-11 text-ui',
        size === 'sm' && 'size-8 text-small',
      )}
    >
      {initials}
    </span>
  );
}

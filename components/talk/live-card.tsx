import { Check, CircleAlert } from 'lucide-react';
import Link, { linkVariants } from '@/components/ui/link';
import { LiveDot } from '@/components/ui/live-dot';
import { cn } from '@/lib/cn';
import type { LiveLine as Line, WorkingCard } from '@/lib/you/live-cards';

/**
 * The live card's parts (plan #2854.3), chosen by what is going on rather
 * than by which action it is, so a new action gets a card without new UI:
 *
 * - LiveWorking: the small card at the foot of a People thread while they
 *   are still writing a reply and have already done something for it.
 * - LiveStatus: one line saying where a longer run stands (a build going,
 *   waiting on you, built or stopped) with its next move, set in the change card
 *   in place of the plain Done.
 *
 * Shape as well as colour: a pulsing dot while it works, a still caution dot
 * while it waits on you, a tick when finished and a ring with a mark when it
 * stopped, so the states differ without reading the words.
 */

function Glyph({ tone }: { tone: Line['tone'] }) {
  if (tone === 'done') return <Check className="size-3.5 shrink-0 text-positive" strokeWidth={1.75} aria-hidden />;
  if (tone === 'failed') return <CircleAlert className="size-3.5 shrink-0 text-danger" strokeWidth={1.75} aria-hidden />;
  // A dot is 8px; the box keeps it on the text's first line beside the 14px glyphs.
  return (
    <span className="inline-flex size-3.5 shrink-0 items-center justify-center" aria-hidden>
      <LiveDot tone={tone === 'needs' ? 'caution' : 'accent'} still={tone === 'needs'} />
    </span>
  );
}

/** Where a run stands, as a glyph, a sentence and the next move when there is one. */
export function LiveStatus({ line }: { line: Line }) {
  return (
    <div className="space-y-0.5" role="status">
      <p className="flex items-start gap-1.5 text-small">
        <span className="mt-0.5 flex">
          <Glyph tone={line.tone} />
        </span>
        <span className={cn('min-w-0', line.tone === 'done' ? 'font-medium text-ink' : 'text-ink-muted', line.tone === 'needs' && 'text-ink')}>
          {line.text}
        </span>
      </p>
      {line.linkLabel && (
        <Link href={line.href} className={`${linkVariants({ tone: 'inline' })} press-area ml-5 text-small`}>
          {line.linkLabel}
        </Link>
      )}
    </div>
  );
}

/**
 * What they are doing while their reply is still coming: the newest thing
 * done for your text, and how many came before it. It sits where their
 * typing would, in their corner of the thread, as wide as their bubbles and
 * on their fill, and gives way to the reply and its change card.
 */
export function LiveWorking({ card, name }: { card: WorkingCard; name: string }) {
  return (
    <div
      role="status"
      aria-label={`${name} is working on it`}
      className="typing-in mb-2 flex max-w-3/4 items-start gap-2 self-start rounded-pane rounded-bl-control bg-them px-3 py-2.5 lg:max-w-lg"
    >
      <span className="mt-1 flex">
        <Glyph tone="working" />
      </span>
      <p className="min-w-0 text-ui text-ink">
        <span className="line-clamp-2">{card.text}</span>
        {card.more > 0 && (
          <span className="mt-0.5 block text-small text-ink-muted">
            and {card.more} {card.more === 1 ? 'thing' : 'things'} before it
          </span>
        )}
      </p>
    </div>
  );
}

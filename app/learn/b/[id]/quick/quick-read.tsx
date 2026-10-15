'use client';

import { CloseButton } from '@/components/inbox/close-button';
import { useToast } from '@/components/ui/toast';
import { closedToast } from '@/lib/core/lifecycle';
import { useState, useTransition } from 'react';
import { ExternalLink } from 'lucide-react';
import { Deck, type DeckItem } from '@/components/patterns/deck';
import { Card } from '@/components/ui/card';
import { Disclosure } from '@/components/ui/disclosure';
import { EmptyState } from '@/components/ui/empty-state';
import { linkVariants } from '@/components/ui/link';
import { cn } from '@/lib/cn';
import type { FeedCard } from '@/lib/learn/feed/card';
import { dismissCard, openCardSource } from '@/app/learn/now/actions';

/**
 * A brief's quick read (plan #2023.6): the cards written from its sources,
 * one at a time, as a deck (components/patterns/deck.tsx). Next moves on and
 * records nothing. Not interested dismisses the card, the same row Learn now
 * deals, so it leaves both at once; a card dismissed in Learn now is not
 * loaded here.
 *
 * While the brief is still researching, or has no cards yet, the deck says
 * so and links back to the brief. After the last card it links back too.
 */

export type QuickReadActions = {
  dismiss: (id: string) => Promise<{ error?: string }>;
  open: (id: string) => Promise<void>;
};

const REAL_ACTIONS: QuickReadActions = { dismiss: dismissCard, open: openCardSource };

export function QuickRead({
  briefId,
  status,
  cards,
  actions = REAL_ACTIONS,
}: {
  briefId: string;
  status: 'researching' | 'ready' | 'failed';
  cards: readonly FeedCard[];
  actions?: QuickReadActions;
}) {
  const [dismissed, setDismissed] = useState<ReadonlySet<string>>(new Set());
  const [error, setError] = useState<string | null>(null);
  const [, startDismiss] = useTransition();
  const toast = useToast();
  const briefHref = `/learn/b/${briefId}`;
  const left = cards.filter((card) => !dismissed.has(card.id));

  if (cards.length === 0) {
    return (
      <EmptyState
        title={status === 'researching' ? 'Dash is still researching this' : 'No cards from this research yet'}
        description={
          status === 'researching'
            ? 'Each source becomes a card once the research is done, a few minutes after it starts.'
            : status === 'failed'
              ? 'The research did not finish, so no source became a card. Try it again from the brief.'
              : 'Each source becomes a card within a few minutes of the research ending. Look again shortly.'
        }
        action={{ label: 'Back to the brief', href: briefHref }}
      />
    );
  }

  // Decline, with the toast naming the card and an Undo that puts it back
  // in the deck, as the feed's Previous does (plan #1957.8).
  const dismiss = (card: FeedCard) => {
    setError(null);
    setDismissed((current) => new Set(current).add(card.id));
    toast({
      text: closedToast('declined', card.title),
      undo: () =>
        setDismissed((current) => {
          const next = new Set(current);
          next.delete(card.id);
          return next;
        }),
    });
    startDismiss(async () => {
      const result = await actions.dismiss(card.id).catch(() => ({ error: 'Check your connection.' }));
      if (result.error) setError(`"${card.title}" was not dismissed: ${result.error}`);
    });
  };

  const items: DeckItem[] = left.map((card) => ({
    key: card.id,
    body: <QuickReadCard card={card} onOpen={() => void actions.open(card.id)} />,
    actions: (
      <CloseButton lifecycle="declined" onClick={() => dismiss(card)} />
    ),
  }));

  return (
    <div className="space-y-3">
      {error && (
        <p role="alert" className="text-small text-danger">
          {error}
        </p>
      )}
      <Deck
        items={items}
        done={<QuickReadEnd briefId={briefId} />}
      />
    </div>
  );
}

/** After the last card: the deck is done, with the way back to the brief. */
export function QuickReadEnd({ briefId }: { briefId: string }) {
  return (
    <Card padding="standard">
      <EmptyState
        tone="finished"
        seed={briefId}
        title="That is every card from this research"
        description="They stay in Learn now too, until you pass or dismiss them there."
        action={{ label: 'Back to the brief', href: `/learn/b/${briefId}` }}
      />
    </Card>
  );
}

/** One source's card: its idea first, then why it holds, and the source to open. */
export function QuickReadCard({ card, onOpen }: { card: FeedCard; onOpen?: () => void }) {
  return (
    <Card padding="none">
      <article className="card-pad min-w-0">
        <p className="text-small text-ink-muted">{card.why}</p>
        <h2 className="mt-1 font-display text-title tracking-tight break-words text-ink">{card.title}</h2>
        {card.source && <p className="mt-0.5 text-small text-ink-muted">From {card.source}</p>}

        {card.takeaway && (
          <section className="mt-3 rounded-control border-l-2 border-accent bg-accent-tint px-3 py-2.5">
            <h3 className="text-small font-semibold text-accent">The takeaway</h3>
            <p className="mt-1 text-body font-medium text-ink">{card.takeaway}</p>
          </section>
        )}
        {card.context && <p className="mt-3 text-body text-ink">{card.context}</p>}
        {card.hook && <p className="mt-3 text-body font-semibold text-ink">{card.hook}</p>}
        <p className="mt-2 text-body text-ink">{card.summary}</p>

        {card.example && (
          <section className="mt-4 rounded-control bg-accent-tint px-3 py-2.5">
            <h3 className="text-small font-semibold text-accent">In practice</h3>
            <p className="mt-1 text-body text-ink">{card.example}</p>
          </section>
        )}

        {card.question && card.answer && (
          <section className="mt-4">
            <h3 className="text-small font-semibold text-ink-muted">Try this</h3>
            <p className="mt-1 text-body text-ink">{card.question}</p>
            <Disclosure
              className="mt-2"
              bodyClassName="mt-1"
              title={
                <>
                  <span className="group-open/disc:hidden">Show the answer</span>
                  <span className="hidden group-open/disc:inline">Answer</span>
                </>
              }
            >
              <p className="text-body text-ink">{card.answer}</p>
            </Disclosure>
          </section>
        )}

        {card.link && (
          <p className="mt-4 text-small text-ink-muted">
            <a
              href={card.link}
              target="_blank"
              rel="noopener noreferrer"
              onClick={onOpen}
              className={cn('inline-flex min-h-11 items-center gap-1 break-words', linkVariants({ tone: 'quiet' }))}
            >
              {card.article}
              <ExternalLink className="size-3.5 shrink-0" strokeWidth={1.75} aria-hidden />
            </a>
            {card.site && card.site !== card.article && (
              <>
                {' '}
                <span className="whitespace-nowrap">{`· ${card.site}`}</span>
              </>
            )}
          </p>
        )}
      </article>
    </Card>
  );
}

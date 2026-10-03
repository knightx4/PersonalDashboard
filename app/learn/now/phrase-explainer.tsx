'use client';

import {
  useActionState,
  useCallback,
  useEffect,
  useRef,
  useState,
  useTransition,
  type RefObject,
} from 'react';
import { Check, Plus, Sparkles, Sprout, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { PaidHint } from '@/components/ui/paid-hint';
import { MAX_SELECTION, normaliseSelection } from '@/lib/learn/graph/branch';
import type { FeedCard } from '@/lib/learn/feed/card';
import type { MarkedPart } from '@/lib/learn/feed/mentions';
import { startTrack, type NewTrackState } from '../new/actions';
import { explainPhrase, makePhraseCard, type ExplainedPhrase } from './actions';

/**
 * Explain a phrase you select on a Learn now card (plan #1057).
 *
 * Select a word or phrase anywhere on the card, its conversation with Dash
 * included, and an offer to explain it shows at the card's foot, above the
 * swipes, where it is on screen however far down the card you are. The
 * explanation opens in the same place, with Make it a card and Start a track
 * under it.
 *
 * The selection is read from `selectionchange`, as the concept page reads a
 * phrase in a claim, so it works however the phrase was selected. A tap on the
 * offer clears the selection on a phone before the tap lands, so the offer is
 * held for a moment after the selection goes, and the phrase it names is the
 * one explained.
 *
 * `usePhraseExplainer` holds the state and `explain` is exported through it,
 * so an underlined term (plan #1056) can open the same explanation with a tap
 * and no selection.
 */

/** How long the offer stays after the selection is cleared, so a tap on it lands. */
const OFFER_LINGER_MS = 400;

type Opened = { phrase: string; explained: ExplainedPhrase | null; error: string | null };

export type PhraseExplainerState = {
  /** The phrase selected on the card now, flattened, or empty. */
  selection: string;
  opened: Opened | null;
  explaining: boolean;
  /** Explain a phrase: the selection, or a tapped term. */
  explain: (phrase: string) => void;
  close: () => void;
};

export function usePhraseExplainer(
  cardId: string,
  within: RefObject<HTMLElement | null>,
): PhraseExplainerState {
  const [selection, setSelection] = useState('');
  const [opened, setOpened] = useState<Opened | null>(null);
  const [explaining, startExplain] = useTransition();
  const linger = useRef<number | null>(null);

  useEffect(() => {
    const read = () => {
      const node = within.current;
      const current = document.getSelection();
      const phrase =
        node &&
        current &&
        !current.isCollapsed &&
        current.rangeCount > 0 &&
        node.contains(current.getRangeAt(0).commonAncestorContainer)
          ? normaliseSelection(current.toString())
          : '';
      if (linger.current !== null) window.clearTimeout(linger.current);
      linger.current = null;
      if (phrase) setSelection(phrase);
      else linger.current = window.setTimeout(() => setSelection(''), OFFER_LINGER_MS);
    };
    document.addEventListener('selectionchange', read);
    return () => {
      document.removeEventListener('selectionchange', read);
      if (linger.current !== null) window.clearTimeout(linger.current);
    };
  }, [within]);

  const explain = useCallback(
    (raw: string) => {
      const phrase = normaliseSelection(raw);
      if (!phrase) return;
      setOpened({ phrase, explained: null, error: null });
      setSelection('');
      document.getSelection()?.removeAllRanges();
      startExplain(async () => {
        const result = await explainPhrase(cardId, phrase).catch(() => ({
          error: 'Could not reach Dash. Check your connection.',
          explained: undefined,
        }));
        setOpened({
          phrase,
          explained: result.explained ?? null,
          error: result.explained ? null : (result.error ?? 'Dash could not explain that.'),
        });
      });
    },
    [cardId],
  );

  const close = useCallback(() => setOpened(null), []);

  return { selection, opened, explaining, explain, close };
}

/** The offer while a phrase is selected, and the explanation once asked for. */
export function PhraseExplainer({
  cardId,
  cardTitle,
  state,
  onMadeCard,
}: {
  cardId: string;
  cardTitle: string;
  state: PhraseExplainerState;
  /** A card Make it a card wrote, for the deck to put next. */
  onMadeCard: (card: FeedCard) => void;
}) {
  const { selection, opened, explaining, explain, close } = state;
  // The phrase the offer names when the press starts, so the selection
  // clearing under a tap does not change what is explained.
  const pressed = useRef('');

  if (opened) {
    return (
      <Explanation
        key={opened.phrase}
        cardId={cardId}
        cardTitle={cardTitle}
        opened={opened}
        explaining={explaining}
        onClose={close}
        onMadeCard={onMadeCard}
      />
    );
  }
  if (!selection) return null;

  if (selection.length > MAX_SELECTION) {
    return (
      <p className="mb-2 text-small text-ink-muted">
        That is a paragraph rather than a phrase. Select the part you want explained.
      </p>
    );
  }

  return (
    <div className="mb-2 flex flex-wrap items-center gap-2">
      <Button
        type="button"
        variant="secondary"
        size="sm"
        className="max-w-full"
        // Without this the mousedown that starts the click collapses the
        // selection before the click lands.
        onMouseDown={(event) => event.preventDefault()}
        onPointerDown={() => {
          pressed.current = selection;
        }}
        onClick={() => explain(pressed.current || selection)}
      >
        <Sparkles className="size-3.5 shrink-0" strokeWidth={2} aria-hidden />
        <span className="truncate">Explain “{selection}”</span>
      </Button>
      <span onMouseDown={(event) => event.preventDefault()}>
        <PaidHint action="app/learn/now/actions.ts#explainPhrase" what="Cost of the explanation" />
      </span>
    </div>
  );
}

function Explanation({
  cardId,
  cardTitle,
  opened,
  explaining,
  onClose,
  onMadeCard,
}: {
  cardId: string;
  cardTitle: string;
  opened: Opened;
  explaining: boolean;
  onClose: () => void;
  onMadeCard: (card: FeedCard) => void;
}) {
  const { phrase, explained } = opened;
  const [making, startMake] = useTransition();
  // A phrase made into a card on an earlier visit is pressed again to bring
  // that card back next; the press writes nothing.
  const [made, setMade] = useState<{ title: string | null; already: boolean } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [trackState, startTrackAction, startingTrack] = useActionState<NewTrackState, FormData>(
    startTrack,
    {},
  );

  const makeCard = () =>
    startMake(async () => {
      setError(null);
      const result = await makePhraseCard(cardId, phrase).catch(() => ({
        error: 'Could not make that card. Check your connection.',
        card: undefined,
        already: undefined,
      }));
      if (result.error) {
        setError(result.error);
        return;
      }
      if (result.card) onMadeCard(result.card);
      setMade({ title: result.card?.title ?? null, already: result.already ?? false });
    });

  return (
    <section
      aria-live="polite"
      className="mb-2 max-h-[45vh] overflow-y-auto rounded-control bg-sunken px-3 py-2.5"
    >
      <div className="flex items-start justify-between gap-2">
        <h3 className="min-w-0 text-small font-semibold break-words text-ink">“{phrase}”</h3>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          onClick={onClose}
          aria-label="Close the explanation"
        >
          <X className="size-3.5" strokeWidth={2} aria-hidden />
        </Button>
      </div>

      {explaining && !explained && (
        <p className="mt-1 text-body text-ink-muted">Dash is explaining it…</p>
      )}
      {opened.error && <p className="mt-1 text-small text-danger">{opened.error}</p>}

      {explained && (
        <>
          <p className="mt-1 text-body text-ink">{explained.explanation}</p>

          <div className="mt-2 flex flex-wrap items-center gap-2">
            {explained.article && (
              <span className="inline-flex items-center gap-1">
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  onClick={makeCard}
                  pending={making}
                  disabled={made !== null}
                >
                  {made ? (
                    <Check className="size-3.5" strokeWidth={2} aria-hidden />
                  ) : (
                    <Plus className="size-3.5" strokeWidth={2} aria-hidden />
                  )}
                  {made ? 'Card made' : making ? 'Writing the card…' : 'Make it a card'}
                </Button>
                {!made && (
                  <PaidHint
                    action="app/learn/now/actions.ts#makePhraseCard"
                    what="Cost of writing the card"
                  />
                )}
              </span>
            )}
            <form action={startTrackAction}>
              <input type="hidden" name="title" value={phrase} />
              <input
                type="hidden"
                name="question"
                value={`What is ${phrase}, and how does it bear on ${cardTitle}?`}
              />
              <Button type="submit" variant="ghost" size="sm" pending={startingTrack}>
                <Sprout className="size-3.5" strokeWidth={2} aria-hidden />
                {startingTrack ? 'Starting a subject…' : 'Start a subject'}
              </Button>
            </form>
          </div>

          {making && (
            <p className="mt-1 text-small text-ink-muted">
              Writing it from {explained.article} on Wikipedia. This takes about half a minute.
            </p>
          )}
          {made && (
            <p className="mt-1 text-small text-ink-muted">
              {made.already
                ? `A card was made from this already${made.title ? `: “${made.title}”` : ''}. It is next in your deck.`
                : made.title
                  ? `“${made.title}” is the next card in your deck.`
                  : 'The card is in your deck.'}
            </p>
          )}
          {error && <p className="mt-1 text-small text-danger">{error}</p>}
          {trackState.error && <p className="mt-1 text-small text-danger">{trackState.error}</p>}
        </>
      )}
    </section>
  );
}

/**
 * One paragraph of a card with the ideas it mentions underlined (plan #1056).
 *
 * Each term is a button, so a tap on it opens its explanation, keyboard
 * users reach it with Tab, and the deck's swipe leaves it alone as it does
 * every button. The text inside stays selectable, so a selection can still
 * start or end on an underlined word.
 */
export function Mentioned({
  parts,
  onTap,
}: {
  parts: readonly MarkedPart[];
  onTap: (phrase: string) => void;
}) {
  return parts.map((part, index) =>
    part.mention ? (
      <button
        key={index}
        type="button"
        onClick={() => onTap(part.text)}
        title={part.mention.why || undefined}
        aria-label={`Explain ${part.text}`}
        className="inline cursor-pointer select-text rounded-sm p-0 text-left font-[inherit] text-inherit underline decoration-accent decoration-dotted decoration-2 underline-offset-4 hover:text-accent focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
      >
        {part.text}
      </button>
    ) : (
      part.text
    ),
  );
}

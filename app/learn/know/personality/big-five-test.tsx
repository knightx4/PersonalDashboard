'use client';

import { useState, useTransition } from 'react';
import { Button } from '@/components/ui/button';
import { cardVariants } from '@/components/ui/card';
import { Rating } from '@/components/ui/rating';
import { cn } from '@/lib/cn';
import { IPIP_ITEMS, IPIP_ITEM_COUNT, IPIP_SCALE } from '@/lib/learn/personality/ipip';
import type { BigFiveResult } from '@/lib/learn/personality/model';
import { saveBigFiveAction } from './actions';
import { BigFiveScoreList } from './scores';

/**
 * The 50-item Big Five test (plan #1632): every statement in one list, each
 * answered on a row of five, and the scores once all fifty are in.
 *
 * The answers live here and nowhere else until the last one, then go to the
 * server in one call, so leaving halfway saves nothing. A press of "See my
 * scores" with statements left takes you to the first one still blank
 * instead of saving.
 *
 * With an earlier result, the page opens on its scores and the test is one
 * press away; a retake is a new result beside the old one.
 */
export function BigFiveTest({
  latest,
  initialAnswers,
}: {
  latest: BigFiveResult | null;
  /** The gallery's way in, to draw the list part answered. */
  initialAnswers?: ReadonlyArray<number | null>;
}) {
  const [shown, setShown] = useState<BigFiveResult | null>(latest);
  const [taking, setTaking] = useState(latest === null);
  const [answers, setAnswers] = useState<Array<number | null>>(() =>
    initialAnswers ? [...initialAnswers] : Array(IPIP_ITEM_COUNT).fill(null),
  );
  const [message, setMessage] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const answered = answers.filter((a) => a !== null).length;
  const left = IPIP_ITEM_COUNT - answered;

  function answer(index: number, value: number) {
    setAnswers((current) => current.map((a, i) => (i === index ? value : a)));
    setMessage(null);
  }

  function finish() {
    const firstBlank = answers.findIndex((a) => a === null);
    if (firstBlank !== -1) {
      setMessage(
        left === 1 ? 'One statement is still blank.' : `${left} statements are still blank.`,
      );
      const row = document.getElementById(`ipip-${firstBlank + 1}`);
      row?.scrollIntoView({ behavior: 'smooth', block: 'center' });
      row?.querySelector('button')?.focus({ preventScroll: true });
      return;
    }
    startTransition(async () => {
      const outcome = await saveBigFiveAction(answers as number[]);
      if ('error' in outcome) {
        setMessage(outcome.error);
        return;
      }
      setShown(outcome.result);
      setTaking(false);
      setAnswers(Array(IPIP_ITEM_COUNT).fill(null));
      window.scrollTo({ top: 0, behavior: 'smooth' });
    });
  }

  if (!taking && shown) {
    return (
      <div className="max-w-2xl">
        <div className={cardVariants({ padding: 'standard' })}>
          <BigFiveScoreList scores={shown.scores} takenAt={shown.takenAt} />
        </div>
        <div className="mt-4">
          <Button variant="secondary" onClick={() => setTaking(true)}>
            Take it again
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div className="max-w-2xl">
      <p className="text-body text-ink">
        Fifty statements about how you usually are now, not how you wish to be. It takes about ten
        minutes, and nothing is saved until you finish. Already have a type from another test?{' '}
        <a href="#other-tests" className="text-accent underline-offset-2 hover:underline">
          Add it below
        </a>
        .
      </p>

      <div className="mt-5 flex justify-end">
        <p
          className="flex w-full justify-between gap-3 text-small text-ink-muted sm:w-[17rem] sm:mr-4"
          aria-hidden
        >
          <span>1 · Very inaccurate</span>
          <span className="text-right">5 · Very accurate</span>
        </p>
      </div>

      <ol className={cn(cardVariants(), 'mt-1.5 divide-y divide-border')}>
        {IPIP_ITEMS.map((item, index) => (
          <li
            key={item.number}
            id={`ipip-${item.number}`}
            className="scroll-mt-24 px-4 py-4 sm:grid sm:grid-cols-[1fr_17rem] sm:items-start sm:gap-6"
          >
            <p className="flex gap-2 text-body text-ink sm:pt-1.5">
              <span className="w-6 shrink-0 text-right tabular-nums text-ink-muted">
                {item.number}
              </span>
              <span>{item.text}</span>
            </p>
            <Rating
              className="mt-3 sm:mt-0"
              value={answers[index]}
              scale={IPIP_SCALE}
              onChange={(value) => answer(index, value)}
              label={`${item.number}. ${item.text}`}
              disabled={pending}
            />
          </li>
        ))}
      </ol>

      {/* Held above the dock on a phone and above the status line on a
          laptop, so the count and the way to finish stay in view from the
          first statement to the last. */}
      <div
        className={cn(
          cardVariants(),
          'sticky bottom-[calc(var(--dock-h)+env(safe-area-inset-bottom)+0.5rem)] z-over-link mt-4',
          'flex items-center justify-between gap-3 border border-border px-4 py-2.5 lg:bottom-10',
        )}
      >
        <span className="min-w-0 text-small tabular-nums text-ink-muted" aria-live="polite">
          {message ?? `${answered} of ${IPIP_ITEM_COUNT} answered`}
        </span>
        <Button size="lg" onClick={finish} pending={pending} className="shrink-0">
          {pending ? 'Scoring…' : 'See my scores'}
        </Button>
      </div>
      {shown ? (
        <div className="mt-3">
          <Button variant="ghost" onClick={() => setTaking(false)} disabled={pending}>
            Back to your last result
          </Button>
        </div>
      ) : null}
    </div>
  );
}

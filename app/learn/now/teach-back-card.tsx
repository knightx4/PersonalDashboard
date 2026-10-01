'use client';

import Link from 'next/link';
import { useState } from 'react';
import { MessageSquareQuote } from 'lucide-react';
import { TalkThread } from '@/components/talk/talk-thread';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Select } from '@/components/ui/field';
import { PaidHint } from '@/components/ui/paid-hint';
import type { FeedCard } from '@/lib/learn/feed/card';
import {
  stateLine,
  TEACH_BACK_DEFAULT_EVERY,
  TEACH_BACK_RATES,
  teachBackRateLabel,
  type TeachBackView,
} from '@/lib/learn/feed/teach-back';
import { explainBack, setTeachBackEvery, type TeachBackResult } from './actions';

/**
 * A teach-back (plan #1054): an idea you kept a few days ago, to explain as if
 * to a friend. What you write goes into the card's conversation and comes
 * back marked, with what was right, what was missing and one follow-up; the
 * answer to that is marked too, and the line under the thread says what the
 * idea is now marked on its page.
 *
 * Like a unit check it has no swipes: it is answered or skipped. The foot of
 * the card carries the setting for how often these come, since this is where
 * somebody who wants fewer of them will be.
 */
export function TeachBackCard({
  card,
  onSkip,
  onNext,
}: {
  card: FeedCard;
  onSkip: () => void;
  onNext: () => void;
}) {
  const [teach, setTeach] = useState<TeachBackView | null>(card.teach ?? null);
  const [every, setEvery] = useState(card.teachEvery ?? TEACH_BACK_DEFAULT_EVERY);
  const [settingError, setSettingError] = useState<string | null>(null);
  const stage = teach?.stage ?? 'explain';
  const done = stage === 'done';

  const send = async (body: string): Promise<TeachBackResult> => {
    const result = await explainBack(card.id, body);
    if (result.teach) setTeach(result.teach);
    return result;
  };

  const changeEvery = (value: number) => {
    const before = every;
    setEvery(value);
    setSettingError(null);
    void setTeachBackEvery(value)
      .then((result) => {
        if (result.error) {
          setEvery(before);
          setSettingError(result.error);
        }
      })
      .catch(() => {
        setEvery(before);
        setSettingError('That was not kept. Check your connection.');
      });
  };

  return (
    <Card padding="standard">
      <p className="flex items-center gap-1.5 text-small text-ink-muted">
        <MessageSquareQuote className="size-3.5" strokeWidth={2} aria-hidden />
        {card.why}
      </p>
      <h2 className="mt-1 font-display text-title tracking-tight break-words text-ink">{card.title}</h2>
      {card.context && <p className="mt-2 text-ui text-ink-muted">{card.context}</p>}
      <p className="mt-3 text-body text-ink">{card.question}</p>

      <div className="mt-3">
        <TalkThread
          id={`teach-${card.id}`}
          turns={card.conversation ?? []}
          send={send}
          label={stage === 'follow_up' ? 'Answer the follow-up' : 'Explain it'}
          placeholder={stage === 'follow_up' ? 'Two or three sentences' : 'A few sentences, as if to a friend'}
          waiting="Dash is marking it…"
          activity="reading"
          closed={() => (done ? 'Marked. That is the end of this one.' : null)}
          hint={
            <PaidHint action="app/learn/now/actions.ts#explainBack" what="Cost of marking the answer" />
          }
        />
      </div>

      {teach?.state && (
        <p className="mt-3 text-ui text-ink" aria-live="polite">
          {stateLine(card.title, teach.state)}{' '}
          <Link
            href={`/learn/c/${teach.conceptId}`}
            className="text-ink-muted underline underline-offset-2 hover:text-ink"
          >
            See it on its page
          </Link>
        </p>
      )}
      {done && teach?.claim && (
        <p className="mt-2 text-ui text-ink-muted">The idea as you kept it: {teach.claim}</p>
      )}

      <div className="mt-4 flex flex-wrap items-center gap-2">
        {done ? (
          <Button type="button" variant="primary" onClick={onNext}>
            Next
          </Button>
        ) : (
          <Button type="button" variant="secondary" onClick={onSkip}>
            Skip
          </Button>
        )}
        <label className="ml-auto flex items-center gap-2 text-small text-ink-muted">
          Explain-back cards
          <Select
            value={String(every)}
            onChange={(event) => changeEvery(Number(event.target.value))}
            className="w-auto"
          >
            {TEACH_BACK_RATES.map((rate) => (
              <option key={rate} value={rate}>
                {teachBackRateLabel(rate)}
              </option>
            ))}
          </Select>
        </label>
      </div>
      {settingError && <p className="mt-2 text-small text-danger">{settingError}</p>}
    </Card>
  );
}

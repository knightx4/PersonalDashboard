'use client';

import { useId, useState } from 'react';
import { CardSection } from '@/components/ui/card';
import { DashAction } from '@/components/ui/dash-action';
import { Input } from '@/components/ui/field';
import type { PaidAction } from '@/lib/core/spend/paid-actions';
import type { StoredAsk } from '@/lib/jobs/drafting/store';

/**
 * The questions Dash asked back while drafting, each with a one-line reply
 * box, and Redraft (plan #2130.4). Shown only when Dash asked something.
 *
 * A reply is saved when the box is left, so one typed and abandoned is still
 * there on the next visit and the next run uses it. Redraft sends every reply
 * with the run, so it never depends on that save having finished.
 *
 * Shared by the answers and the cover letter (plan #2135.2): the caller says
 * what an ask is about, how a reply is kept and what Redraft runs.
 */
export function DashQuestions({
  asks,
  aboutLabel,
  onSaveReply,
  onRedraft,
  redraftPaid,
  busy = false,
  hint = 'A line each is enough. Redraft uses your replies, and later drafts keep using them.',
}: {
  asks: readonly StoredAsk[];
  /** What an ask is about, from its answer id; null for the whole application. */
  aboutLabel: (answerId: string | null) => string;
  /** Keeps one reply; resolves to an error to show, or null. */
  onSaveReply: (askId: string, reply: string) => Promise<string | null>;
  /** Runs the redraft with every reply; resolves to an error to show, or null. */
  onRedraft: (replies: Record<string, string>) => Promise<string | null>;
  /** The server action Redraft calls, for its cost hint. */
  redraftPaid: PaidAction;
  /** Another run is going on the same drafts: Redraft waits for it. */
  busy?: boolean;
  hint?: string;
}) {
  const idBase = useId();
  const [replies, setReplies] = useState<Record<string, string>>(() =>
    Object.fromEntries(asks.map((ask) => [ask.id, ask.reply ?? ''])),
  );
  // What the store holds, so leaving a box unchanged saves nothing.
  const [kept, setKept] = useState<Record<string, string>>(() =>
    Object.fromEntries(asks.map((ask) => [ask.id, ask.reply ?? ''])),
  );
  const [saveError, setSaveError] = useState<string | null>(null);
  const [redrafting, setRedrafting] = useState(false);
  const [redraftError, setRedraftError] = useState<string | null>(null);

  if (asks.length === 0) return null;

  const anyReply = asks.some((ask) => (replies[ask.id] ?? '').trim() !== '');

  async function keep(askId: string) {
    const reply = (replies[askId] ?? '').trim();
    if (reply === (kept[askId] ?? '').trim()) return;
    const error = await onSaveReply(askId, reply);
    setSaveError(error);
    if (!error) setKept((before) => ({ ...before, [askId]: reply }));
  }

  async function redraft() {
    setRedrafting(true);
    setRedraftError(null);
    const sent = Object.fromEntries(asks.map((ask) => [ask.id, (replies[ask.id] ?? '').trim()]));
    const error = await onRedraft(sent);
    setRedrafting(false);
    setRedraftError(error);
    if (!error) setKept(sent);
  }

  return (
    <CardSection title="Dash's questions" hint={hint}>
      <ul className="mt-3 space-y-4">
        {asks.map((ask) => {
          const id = `${idBase}-${ask.id}`;
          return (
            <li key={ask.id}>
              <label htmlFor={id} className="block">
                <span className="block text-ui text-ink">{ask.question}</span>
                <span className="mt-0.5 block text-small text-ink-muted">{aboutLabel(ask.answer_id)}</span>
              </label>
              <Input
                id={id}
                className="mt-1.5 w-full"
                value={replies[ask.id] ?? ''}
                placeholder="Your reply"
                maxLength={4000}
                onChange={(event) => setReplies((before) => ({ ...before, [ask.id]: event.target.value }))}
                onBlur={() => void keep(ask.id)}
                onKeyDown={(event) => {
                  if (event.key === 'Enter') event.currentTarget.blur();
                }}
              />
            </li>
          );
        })}
      </ul>
      {saveError && (
        <p role="alert" className="mt-2 text-small text-danger">
          Your reply was not kept: {saveError}
        </p>
      )}
      <div className="mt-3 flex flex-wrap items-center gap-x-3 gap-y-1">
        <DashAction
          type="button"
          size="sm"
          variant="secondary"
          pending={redrafting}
          disabled={busy || redrafting || !anyReply}
          paid={redraftPaid}
          what="Cost of redrafting"
          onClick={() => void redraft()}
        >
          {redrafting ? 'Redrafting…' : 'Redraft'}
        </DashAction>
        {redrafting && (
          <span className="text-small text-ink-muted">This can take a minute or two.</span>
        )}
      </div>
      {redraftError && (
        <p role="alert" className="mt-1 text-small text-danger">
          {redraftError}
        </p>
      )}
    </CardSection>
  );
}

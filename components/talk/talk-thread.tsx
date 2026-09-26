'use client';

import { useRef, useState, useTransition } from 'react';
import { ArrowUp, Bot, CircleUser } from 'lucide-react';
import { AddTrigger } from '@/components/ui/add-trigger';
import { Button } from '@/components/ui/button';
import { ComposeBody, ComposeBox, FieldError } from '@/components/ui/field';
import { commentWhen, exactTime } from '@/lib/comments/when';
import { turnBody, MAX_TURN, type TalkRole, type TalkTurn } from '@/lib/talk/talk';
import { useClockNow } from '@/lib/use-clock-now';

/**
 * A saved conversation with Dash about a card or a story, and the box to add
 * to it (plan #1053). Modelled on the dev pages' comment thread
 * (components/dev/comment-thread.tsx): one row per turn, the author as a glyph
 * in a column of its own, a run by one author headed once.
 *
 * The caller owns the write. `send` keeps the person's turn, asks for Dash's
 * reply and returns every turn it wrote, so the thread shows what the table
 * holds. The turn is in the thread on the press; if nothing was kept, it goes
 * and the words come back in the box. If the question was kept and the reply
 * failed, the question stays and the error says why.
 */

/** What `send` hands back: the turns it kept, and why it stopped short, if it did. */
export type TalkSend = (body: string) => Promise<{ turns?: TalkTurn[]; error?: string }>;

const PENDING = 'pending';

const AUTHOR_NAME: Record<TalkRole, string> = { user: 'You', assistant: 'Dash' };

function AuthorMark({ role }: { role: TalkRole }) {
  const Glyph = role === 'assistant' ? Bot : CircleUser;
  return <Glyph className="size-3.5 text-ink-ghost" strokeWidth={2} aria-hidden />;
}

function Turn({ turn, grouped, now }: { turn: TalkTurn; grouped: boolean; now: number }) {
  return (
    <li className="flex gap-2">
      <div className="flex w-4 shrink-0 justify-center pt-1">
        {!grouped && <AuthorMark role={turn.role} />}
      </div>
      <div className="min-w-0 flex-1 space-y-0.5">
        {!grouped && (
          <div className="flex flex-wrap items-baseline gap-2">
            <span className="text-small font-semibold text-ink">{AUTHOR_NAME[turn.role]}</span>
            {turn.id !== PENDING && (
              <time
                dateTime={turn.createdAt}
                title={exactTime(turn.createdAt)}
                className="tabular text-small text-ink-muted"
              >
                {commentWhen(turn.createdAt, now)}
              </time>
            )}
          </div>
        )}
        <p className="text-body whitespace-pre-wrap text-ink">{turn.body}</p>
      </div>
    </li>
  );
}

export function TalkThread({
  id,
  turns: initial,
  send,
  label,
  placeholder,
  waiting = 'Dash is replying…',
  closed,
}: {
  /** Unique on the page: the textarea's id is built from it. */
  id: string;
  turns: readonly TalkTurn[];
  send: TalkSend;
  /** What the button that opens the box says. */
  label: string;
  placeholder?: string;
  /** The line shown while the reply is being written. */
  waiting?: string;
  /**
   * Whether the thread has ended, given its turns: the line to show in place
   * of the box, or null while it is open. A discussion of a news story closes
   * after three replies (plan #1060). Left out, the thread never closes.
   */
  closed?: (turns: readonly TalkTurn[]) => string | null;
}) {
  const [turns, setTurns] = useState<TalkTurn[]>([...initial]);
  const [writing, setWriting] = useState(false);
  const [draft, setDraft] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [sending, startSend] = useTransition();
  const form = useRef<HTMLFormElement>(null);
  const now = useClockNow();
  const ended = sending ? null : (closed?.(turns) ?? null);

  const submit = () => {
    const checked = turnBody(draft);
    if ('error' in checked) {
      setError(checked.error);
      return;
    }
    const pending: TalkTurn = {
      id: PENDING,
      role: 'user',
      body: checked.body,
      createdAt: new Date().toISOString(),
    };
    setError(null);
    setDraft('');
    setWriting(false);
    setTurns((current) => [...current, pending]);
    startSend(async () => {
      const result = await send(checked.body).catch(() => ({
        turns: undefined,
        error: 'That was not sent. Check your connection.',
      }));
      const kept = result.turns ?? [];
      setTurns((current) => [...current.filter((turn) => turn.id !== PENDING), ...kept]);
      if (result.error) setError(result.error);
      if (kept.length === 0) {
        setDraft(checked.body);
        setWriting(true);
      }
    });
  };

  return (
    <div className="space-y-2">
      {turns.length > 0 && (
        <ul className="space-y-2.5">
          {turns.map((turn, index) => (
            <Turn
              key={turn.id === PENDING ? `${PENDING}-${index}` : turn.id}
              turn={turn}
              grouped={turns[index - 1]?.role === turn.role}
              now={now}
            />
          ))}
          {sending && (
            <li className="flex gap-2" aria-live="polite">
              <div className="flex w-4 shrink-0 justify-center pt-1">
                <AuthorMark role="assistant" />
              </div>
              <p className="min-w-0 flex-1 text-body text-ink-muted">{waiting}</p>
            </li>
          )}
        </ul>
      )}

      {ended ? (
        <p className="text-ui text-ink-muted">{ended}</p>
      ) : !writing ? (
        <AddTrigger label={label} onClick={() => setWriting(true)} disabled={sending} />
      ) : (
        <form
          ref={form}
          onSubmit={(event) => {
            event.preventDefault();
            submit();
          }}
          onBlur={(event) => {
            if (draft.trim()) return;
            if (event.currentTarget.contains(event.relatedTarget)) return;
            setWriting(false);
          }}
        >
          <ComposeBox>
            <label htmlFor={`${id}-talk`} className="sr-only">
              {label}
            </label>
            <ComposeBody
              id={`${id}-talk`}
              rows={1}
              autoFocus
              maxLength={MAX_TURN}
              placeholder={placeholder}
              value={draft}
              onChange={(event) => setDraft(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === 'Escape') {
                  event.preventDefault();
                  setWriting(false);
                  return;
                }
                if (event.key !== 'Enter' || event.shiftKey) return;
                if (event.nativeEvent.isComposing) return;
                if (!draft.trim()) return;
                event.preventDefault();
                form.current?.requestSubmit();
              }}
            />
            <div className="mt-1 flex justify-end">
              <Button
                type="submit"
                size="sm"
                className="size-7 shrink-0 px-0"
                disabled={!draft.trim() || sending}
                title="Send"
              >
                <ArrowUp className="size-4" strokeWidth={2} aria-hidden />
                <span className="sr-only">Send</span>
              </Button>
            </div>
          </ComposeBox>
        </form>
      )}

      <FieldError>{error}</FieldError>
    </div>
  );
}

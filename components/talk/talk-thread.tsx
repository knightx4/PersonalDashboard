'use client';

import { useEffect, useMemo, useRef, useState, useTransition } from 'react';
import Link from 'next/link';
import { ArrowUp, CircleUser, CornerDownRight } from 'lucide-react';
import { CommentBody } from '@/components/dev/comment-body';
import { DashMark, type DashActivity, type DashState } from '@/components/ui/dash-mark';
import { AddTrigger } from '@/components/ui/add-trigger';
import { Button } from '@/components/ui/button';
import { ComposeBody, ComposeBox, FieldError } from '@/components/ui/field';
import { commentWhen, exactTime } from '@/lib/comments/when';
import {
  turnBody,
  MAX_TURN,
  type TalkCitation,
  type TalkRole,
  type TalkTurn,
} from '@/lib/talk/talk';
import { useClockNow } from '@/lib/use-clock-now';
import { LinkedText } from '@/components/ui/linked-text';

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
 *
 * Dash's mark says where the answer stands (plan #1337): working on the line
 * shown while it is written, done on the answer when it lands and then idle,
 * and failed beside the error when it does not come. Working is the mark's
 * indeterminate orbit; nothing here measures progress Dash does not report.
 */

/** What `send` hands back: the turns it kept, and why it stopped short, if it did. */
export type TalkSend = (body: string) => Promise<{ turns?: TalkTurn[]; error?: string }>;

const PENDING = 'pending';

/**
 * Who answers in the thread: Dash unless the caller says otherwise. Maya's
 * threads in the vault (plan #1286) pass Maya's name and its owl, so the
 * thread never names Dash for words Maya wrote.
 */
export type TalkAssistant = {
  name: string;
  Mark: React.ComponentType<{ className?: string; strokeWidth?: number; 'aria-hidden'?: boolean }>;
  /**
   * The mark drawn in a state other than idle: working, done or failed. Left
   * out, the assistant's mark stays as it is whatever the answer is doing.
   */
  StateMark?: React.ComponentType<{
    state: DashState;
    activity?: DashActivity;
    className?: string;
  }>;
};

/** Dash's own mark at the size of the glyph beside every other turn. */
function DashTurnMark({
  className,
  state = 'idle',
  activity,
}: {
  className?: string;
  state?: DashState;
  activity?: DashActivity;
}) {
  // A reply on its way, or just landed, is Dash as the subject: the brand ramp.
  const tone = state === 'working' || state === 'done' ? 'brand' : 'current';
  return <DashMark size="2xs" state={state} activity={activity} tone={tone} decorative className={className} />;
}

const DASH: TalkAssistant = { name: 'Dash', Mark: DashTurnMark, StateMark: DashTurnMark };

/** How long an answer's mark stays done before it settles back to idle. */
export const DONE_FOR_MS = 1600;

function AuthorMark({
  role,
  assistant,
  state = 'idle',
  activity,
}: {
  role: TalkRole;
  assistant: TalkAssistant;
  state?: DashState;
  /** What kind of work the working mark shows. */
  activity?: DashActivity;
}) {
  if (role === 'assistant' && state !== 'idle' && assistant.StateMark) {
    const StateMark = assistant.StateMark;
    // Failed takes the error's colour, so the mark and the words beside it read as one.
    return (
      <StateMark
        state={state}
        activity={activity}
        className={state === 'failed' ? 'size-3.5 text-danger' : 'size-3.5 text-ink-ghost'}
      />
    );
  }
  const Glyph = role === 'assistant' ? assistant.Mark : CircleUser;
  return <Glyph className="size-3.5 text-ink-ghost" strokeWidth={2} aria-hidden />;
}

function Turn({
  turn,
  grouped,
  now,
  below,
  assistant,
  state,
}: {
  turn: TalkTurn;
  grouped: boolean;
  now: number;
  below?: React.ReactNode;
  assistant: TalkAssistant;
  /** The mark's state on an assistant turn: done just after it lands. */
  state?: DashState;
}) {
  return (
    <li className="flex gap-2">
      <div className="flex w-4 shrink-0 justify-center pt-1">
        {!grouped && <AuthorMark role={turn.role} assistant={assistant} state={state} />}
      </div>
      <div className="min-w-0 flex-1 space-y-0.5">
        {!grouped && (
          <div className="flex flex-wrap items-baseline gap-2">
            <span className="text-small font-semibold text-ink">
              {turn.role === 'assistant' ? assistant.name : 'You'}
            </span>
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
        {/* An answer is written as markdown, and pre-wrapped it read as one
            wall of text with asterisks and hyphens in it (note 7cf4109a). What
            you typed stays as you typed it. */}
        {turn.role === 'assistant' ? (
          <div className="text-body text-ink">
            <CommentBody body={turn.body} refs={false} />
          </div>
        ) : (
          <p className="text-body whitespace-pre-wrap text-ink">
            <LinkedText text={turn.body} />
          </p>
        )}
        {turn.citations && turn.citations.length > 0 && <Cited citations={turn.citations} />}
        {below}
      </div>
    </li>
  );
}

const CITED_LINK = 'min-w-0 truncate text-ui text-accent underline-offset-2 hover:underline';

/**
 * The rows an answer rests on, each a link to where it lives (plan #1090).
 * Only a question asked of Dash from anywhere carries these; a card's or a
 * story's thread never does, so it draws exactly as it did.
 */
function Cited({ citations }: { citations: readonly TalkCitation[] }) {
  return (
    <ul className="pt-1" aria-label="What this answer used">
      {citations.map((citation) => (
        <li
          key={`${citation.table}:${citation.ref}`}
          className="flex min-w-0 items-baseline gap-1.5"
        >
          <CornerDownRight
            className="size-3 shrink-0 translate-y-0.5 text-ink-ghost"
            strokeWidth={2}
            aria-hidden
          />
          {citation.href.startsWith('/') ? (
            <Link href={citation.href} className={CITED_LINK}>
              {citation.title}
            </Link>
          ) : (
            // A message Dash searched in Gmail (plan #1316): it opens there, in a new tab.
            <a
              href={citation.href}
              target="_blank"
              rel="noopener noreferrer"
              className={CITED_LINK}
            >
              {citation.title}
              <span className="sr-only"> (opens in Gmail)</span>
            </a>
          )}
        </li>
      ))}
    </ul>
  );
}

export function TalkThread({
  id,
  turns: initial,
  send,
  label,
  placeholder,
  waiting,
  closed,
  hint,
  above,
  startWriting = false,
  ask,
  below,
  assistant = DASH,
  activity,
  incoming,
}: {
  /** Unique on the page: the textarea's id is built from it. */
  id: string;
  turns: readonly TalkTurn[];
  send: TalkSend;
  /** What the button that opens the box says. */
  label: string;
  placeholder?: string;
  /** The line shown while the reply is being written. Defaults to "<name> is replying…". */
  waiting?: string;
  /**
   * Whether the thread has ended, given its turns: the line to show in place
   * of the box, or null while it is open. A discussion of a news story closes
   * after three replies (plan #1060). Left out, the thread never closes.
   */
  closed?: (turns: readonly TalkTurn[]) => string | null;
  /** Beside the button that opens the box: the $ hint for what a reply costs. */
  hint?: React.ReactNode;
  /** Just above the box, or the button that opens it: what goes with a question. */
  above?: React.ReactNode;
  /**
   * Open with the box already up and the cursor in it. For a surface opened
   * in order to write, such as the Ask Dash sheet, where the button first
   * would be a second press for the same intent.
   */
  startWriting?: boolean;
  /**
   * Send this as soon as the thread appears: the words typed into ⌘K and
   * chosen as a question for Dash (plan #1090). Sent once per mount.
   */
  ask?: string;
  /**
   * What to draw under a turn, after the rows it used: the changes Dash
   * proposed in an Ask Dash answer (plan #1190). Left out, nothing is.
   */
  below?: (turn: TalkTurn) => React.ReactNode;
  /** Who answers: Dash when left out. */
  assistant?: TalkAssistant;
  /**
   * What kind of work the mark shows while a reply is coming, chosen by the
   * surface from the job it starts: searching for Ask, reading for marking
   * an answer. Left out, the working mark leans and races.
   */
  activity?: DashActivity;
  /**
   * Turns written elsewhere since the thread was drawn, such as the backup
   * routine's reply to an Ask Dash hand-off (plan #1402). Any not already in
   * the thread are added at the end.
   */
  incoming?: readonly TalkTurn[];
}) {
  const [own, setTurns] = useState<TalkTurn[]>([...initial]);
  // The thread's own turns, with any written elsewhere slotted in by time.
  const turns = useMemo(() => {
    if (!incoming?.length) return own;
    const have = new Set(own.map((turn) => turn.id));
    const added = incoming.filter((turn) => !have.has(turn.id));
    if (added.length === 0) return own;
    return [...own, ...added].sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  }, [own, incoming]);
  const [writing, setWriting] = useState(startWriting && !ask);
  const [draft, setDraft] = useState('');
  const [error, setError] = useState<string | null>(null);
  // Why the last answer did not come: drawn in the thread with the failed
  // mark, where the working line was, until the next question is sent.
  const [failed, setFailed] = useState<string | null>(null);
  // The answer that has just landed, whose mark shows done for a moment.
  const [landed, setLanded] = useState<string | null>(null);
  const [sending, startSend] = useTransition();
  const form = useRef<HTMLFormElement>(null);
  const now = useClockNow();
  const ended = sending ? null : (closed?.(turns) ?? null);

  const submit = (raw: string = draft) => {
    const checked = turnBody(raw);
    if ('error' in checked) {
      setError(checked.error);
      return;
    }
    const question: TalkTurn = {
      id: PENDING,
      role: 'user',
      body: checked.body,
      createdAt: new Date().toISOString(),
    };
    setError(null);
    setFailed(null);
    setLanded(null);
    setDraft('');
    setWriting(false);
    setTurns((current) => [...current, question]);
    startSend(async () => {
      const result = await send(checked.body).catch(() => ({
        turns: undefined,
        error: 'That was not sent. Check your connection.',
      }));
      const kept = result.turns ?? [];
      // Inside the transition, so the answer and its done mark replace the
      // working line in one commit rather than drawing beneath it for a frame.
      startSend(() => {
        setTurns((current) => [...current.filter((turn) => turn.id !== PENDING), ...kept]);
        if (result.error) setFailed(result.error);
        else setLanded(kept.find((turn) => turn.role === 'assistant')?.id ?? null);
        if (kept.length === 0) {
          setDraft(checked.body);
          setWriting(true);
        }
      });
    });
  };

  useEffect(() => {
    if (!landed) return;
    const timer = setTimeout(() => setLanded(null), DONE_FOR_MS);
    return () => clearTimeout(timer);
  }, [landed]);

  // Once per mount, including under Strict Mode's second effect run: a
  // question sent twice is two answers paid for.
  const asked = useRef(false);
  useEffect(() => {
    if (!ask || asked.current) return;
    asked.current = true;
    submit(ask);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- sent once, on arrival
  }, []);

  return (
    <div className="space-y-2">
      {(turns.length > 0 || failed) && (
        <ul className="space-y-2.5">
          {turns.map((turn, index) => (
            <Turn
              key={turn.id === PENDING ? `${PENDING}-${index}` : turn.id}
              turn={turn}
              grouped={turns[index - 1]?.role === turn.role}
              now={now}
              below={turn.id === PENDING ? undefined : below?.(turn)}
              assistant={assistant}
              state={turn.id === landed ? 'done' : undefined}
            />
          ))}
          {sending && (
            <li className="flex gap-2" aria-live="polite">
              <div className="flex w-4 shrink-0 justify-center pt-1">
                <AuthorMark
                  role="assistant"
                  assistant={assistant}
                  state="working"
                  activity={activity}
                />
              </div>
              <p className="min-w-0 flex-1 text-body text-ink-muted">
                {waiting ?? `${assistant.name} is replying…`}
              </p>
            </li>
          )}
          {!sending && failed && (
            <li className="flex gap-2" role="alert">
              <div className="flex w-4 shrink-0 justify-center pt-1">
                <AuthorMark role="assistant" assistant={assistant} state="failed" />
              </div>
              <p className="min-w-0 flex-1 text-body text-danger">{failed}</p>
            </li>
          )}
        </ul>
      )}

      {!ended && above}

      {ended ? (
        <p className="text-ui text-ink-muted">{ended}</p>
      ) : !writing ? (
        <div className="flex items-center gap-1">
          <AddTrigger label={label} onClick={() => setWriting(true)} disabled={sending} />
          {hint}
        </div>
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

'use client';

import { useActionState, useState } from 'react';
import { ArrowUp, CircleUser, MessagesSquare } from 'lucide-react';
import { ThreadPanel } from '@/components/patterns/thread';
import { CommentBody } from '@/components/dev/comment-body';
import { AddTrigger } from '@/components/ui/add-trigger';
import { Button } from '@/components/ui/button';
import { DashMark } from '@/components/ui/dash-mark';
import { Disclosure } from '@/components/ui/disclosure';
import { ComposeBody, ComposeBox, FieldError } from '@/components/ui/field';
import { PaidHint } from '@/components/ui/paid-hint';
import type { PaidAction } from '@/lib/core/spend/paid-actions';
import { commentWhen, exactTime } from '@/lib/comments/when';
import type { DevComment } from '@/lib/comments/load';
import type { InterviewCardView } from '@/lib/specs/interview-view';
import type { VisionScope } from '@/lib/specs/vision';
import { useClockNow } from '@/lib/use-clock-now';
import { cn } from '@/lib/cn';
import {
  answerInterviewQuestion,
  startInterview,
  stopInterview,
  type InterviewActionState,
} from './interview-actions';

/**
 * Dash's interview about one workspace, under its vision on the specs page
 * (plan #1641, feature #1637).
 *
 * With no interview there, one quiet line offers it. An interview left
 * unfinished is the same line saying Continue, and opens into the card: the
 * questions and answers oldest first, Dash's on the recessed ground, how many
 * of the questions have been asked, and the answer box last, closed until it
 * is pressed (the thread pattern). Draft it now sits beside the box once
 * there is an answer to draft from; before then the way out is Stop.
 *
 * A drafted interview stays as a card while either draft waits, saying what
 * Dash took from the answers and linking to the vision edit above it and the
 * spec change at the head of the page. A draft the person has decided has
 * left the page, and the card says so in place of its link.
 *
 * The card draws what the server last read. Each press reads the page again,
 * and only the answer on its way and Dash's line while it writes are drawn
 * ahead of that.
 */

const START: PaidAction = 'app/dev/specs/interview-actions.ts#startInterview';
const ANSWER: PaidAction = 'app/dev/specs/interview-actions.ts#answerInterviewQuestion';

const AUTHOR_NAME = { me: 'You', claude: 'Dash' } as const;

function Turn({ turn, now }: { turn: DevComment; now: number }) {
  const dash = turn.author === 'claude';
  return (
    <li className={cn('flex gap-2', dash && '-mx-2 rounded-lg bg-canvas px-2 py-1.5')}>
      <div className="flex w-4 shrink-0 justify-center pt-1">
        {dash ? (
          <DashMark size="2xs" decorative className="text-ink-ghost" />
        ) : (
          <CircleUser className="size-3.5 text-ink-ghost" strokeWidth={2} aria-hidden />
        )}
      </div>
      <div className="min-w-0 flex-1 space-y-0.5">
        <div className="flex flex-wrap items-baseline gap-2">
          <span className="text-small font-semibold text-ink">{AUTHOR_NAME[turn.author]}</span>
          <time dateTime={turn.createdAt} title={exactTime(turn.createdAt)} className="tabular text-small text-ink-muted">
            {commentWhen(turn.createdAt, now)}
          </time>
        </div>
        <div className="text-body text-ink">
          <CommentBody body={turn.body} refs={false} />
        </div>
      </div>
    </li>
  );
}

/** Dash's line while it writes, in the place its turn will take. */
function Writing({ children }: { children: React.ReactNode }) {
  return (
    <li className="-mx-2 flex gap-2 rounded-lg bg-canvas px-2 py-1.5" aria-live="polite">
      <div className="flex w-4 shrink-0 justify-center pt-1">
        <DashMark size="2xs" state="working" activity="writing" tone="brand" decorative />
      </div>
      <div className="min-w-0 flex-1 space-y-0.5">
        <span className="text-small font-semibold text-ink-muted">Dash</span>
        <p className="text-body text-ink-muted">{children}</p>
      </div>
    </li>
  );
}

/** The quiet line that starts or reopens an interview. */
function Offer({
  label,
  onClick,
  type = 'button',
  disabled,
}: {
  label: string;
  onClick?: () => void;
  type?: 'button' | 'submit';
  disabled?: boolean;
}) {
  return (
    <button
      type={type}
      onClick={onClick}
      disabled={disabled}
      className="press -ml-1.5 inline-flex items-center gap-1.5 rounded-control px-1.5 py-1 text-ui text-ink-ghost transition-colors duration-quick hover:bg-sunken hover:text-ink-muted disabled:opacity-50"
    >
      <MessagesSquare className="size-3.5 shrink-0" strokeWidth={1.75} aria-hidden />
      {label}
    </button>
  );
}

function drafted(view: InterviewCardView): string {
  const answers = `${view.answered} ${view.answered === 1 ? 'answer' : 'answers'}`;
  if (!view.finishedAt) return `Drafted from ${answers}`;
  // The day as stored, read in UTC on both sides so the server's and the
  // browser's renderings agree.
  const day = new Date(`${view.finishedAt.slice(0, 10)}T12:00:00Z`).toLocaleDateString('en-GB', {
    day: 'numeric',
    month: 'long',
    timeZone: 'UTC',
  });
  return `Drafted on ${day} from ${answers}`;
}

export function InterviewPanel({
  module,
  label,
  view,
  defaultOpen = false,
  defaultWriting = false,
}: {
  module: VisionScope;
  /** What the workspace is called: "Job search", or "the app". */
  label: string;
  view: InterviewCardView | null;
  /** Open the card at once, rather than behind Continue: the gallery's. */
  defaultOpen?: boolean;
  /** Open the answer box at once: the gallery's. */
  defaultWriting?: boolean;
}) {
  const now = useClockNow();
  const [open, setOpen] = useState(defaultOpen);
  const [writing, setWriting] = useState(defaultWriting);
  const [draft, setDraft] = useState('');
  const [sent, setSent] = useState<string | null>(null);
  const [drafting, setDrafting] = useState(false);
  const [started, startAction, starting] = useActionState(startInterview, {} as InterviewActionState);
  const [answered, answerAction, answering] = useActionState(
    answerInterviewQuestion,
    {} as InterviewActionState,
  );
  const [stopped, stopAction, stopping] = useActionState(stopInterview, {} as InterviewActionState);

  // An answer that did not go in comes back to the box. Adjusted during
  // render, the way the vision panel shuts its box.
  const [seen, setSeen] = useState<InterviewActionState>(answered);
  if (answered !== seen) {
    setSeen(answered);
    setSent(null);
    if (answered.body) {
      setDraft(answered.body);
      setWriting(true);
    }
  }

  const collapsed = !starting && (!view || (view.status === 'open' && !open));
  if (collapsed) {
    return (
      <div className="pb-2">
        {view ? (
          <Offer
            label={`Continue the interview · ${view.asked} of ${view.questionLimit} asked`}
            onClick={() => setOpen(true)}
          />
        ) : (
          <form action={startAction} onSubmit={() => setOpen(true)} className="flex flex-wrap items-center gap-x-2">
            <input type="hidden" name="module" value={module} />
            <Offer type="submit" label={`Interview me about ${label}`} />
            <PaidHint action={START} what="Cost of Dash's first question" />
          </form>
        )}
        <FieldError>{started.error}</FieldError>
      </div>
    );
  }

  const title = `Interview about ${label}`;

  if (view && view.status === 'drafted') {
    return (
      <ThreadPanel title={title} meta={drafted(view)} className="mb-2">
        {view.summary && <p className="text-body text-ink">{view.summary}</p>}
        <ul className="space-y-1 text-ui">
          <li>
            {view.visionHref ? (
              <a href={view.visionHref} className="inline-flex min-h-11 items-center text-accent hover:underline">
                The drafted vision, waiting above
              </a>
            ) : (
              <span className="text-ink-muted">You have decided the drafted vision.</span>
            )}
          </li>
          <li>
            {view.specChangeHref ? (
              <a href={view.specChangeHref} className="inline-flex min-h-11 items-center text-accent hover:underline">
                The drafted spec change, under Changes to specs
              </a>
            ) : (
              <span className="text-ink-muted">You have decided the drafted spec change.</span>
            )}
          </li>
        </ul>
        <Disclosure title="The questions and answers" meta={`${view.asked} asked`}>
          <ul className="space-y-2 pt-1">
            {view.turns.map((turn) => (
              <Turn key={turn.id} turn={turn} now={now} />
            ))}
          </ul>
        </Disclosure>
      </ThreadPanel>
    );
  }

  const move = view?.move ?? 'ask';
  const asked = view?.asked ?? 0;
  const limit = view?.questionLimit ?? 12;
  const hasAnswer = (view?.answered ?? 0) > 0 || (answering && sent !== null);
  // How it ends is said while nothing is answered, and only the count after.
  const meta = !view
    ? 'Starting'
    : view.answered === 0
      ? `${asked} of ${limit} questions asked. Dash drafts the vision and a spec after the last, or when you say.`
      : `${asked} of ${limit} questions asked`;
  const busy = starting || answering || stopping;
  const draftingNow = answering && (drafting || move === 'draft' || asked >= limit);

  return (
    <ThreadPanel title={title} meta={meta} className="mb-2">
      <ul className="space-y-2">
        {view?.turns.map((turn) => <Turn key={turn.id} turn={turn} now={now} />)}
        {answering && sent && (
          <Turn turn={{ id: 'sent', author: 'me', body: sent, createdAt: new Date().toISOString() }} now={now} />
        )}
        {starting && <Writing>Writing the next question…</Writing>}
        {answering &&
          (draftingNow ? (
            <Writing>Drafting the vision and a spec from your answers. This takes about a minute.</Writing>
          ) : (
            <Writing>Writing the next question…</Writing>
          ))}
      </ul>

      {view && move === 'ask' && !busy && (
        <form action={startAction}>
          <input type="hidden" name="module" value={module} />
          <div className="flex flex-wrap items-center gap-2">
            <Button type="submit" size="sm" variant="secondary">
              Ask the next question
            </Button>
            <PaidHint action={START} what="Cost of Dash's next question" />
          </div>
        </form>
      )}

      {view && (move === 'answer' || move === 'draft') && !busy && (
        <form
          action={answerAction}
          onSubmit={(event) => {
            const submitter = (event.nativeEvent as SubmitEvent).submitter as HTMLButtonElement | null;
            setDrafting(submitter?.value === 'draft');
            setSent(draft.trim() || null);
            setDraft('');
          }}
        >
          <input type="hidden" name="id" value={view.id} />
          {move === 'answer' &&
            (writing ? (
              <ComposeBox>
                <ComposeBody
                  name="body"
                  rows={1}
                  autoFocus
                  placeholder="Your answer"
                  className="min-h-11"
                  value={draft}
                  onChange={(event) => setDraft(event.target.value)}
                  onKeyDown={(event) => {
                    if (event.key === 'Escape') {
                      event.preventDefault();
                      if (!draft.trim()) setWriting(false);
                      return;
                    }
                    if (event.key !== 'Enter' || event.shiftKey || event.nativeEvent.isComposing) return;
                    event.preventDefault();
                    if (draft.trim()) event.currentTarget.form?.requestSubmit();
                  }}
                />
                <div className="mt-1 flex items-center justify-end gap-1">
                  <PaidHint action={ANSWER} what="Cost of answering" />
                  <button
                    type="submit"
                    name="intent"
                    value="answer"
                    disabled={!draft.trim()}
                    title="Send your answer"
                    className="press flex size-7 items-center justify-center rounded-full bg-accent text-fill-ink transition-colors duration-quick hover:bg-accent-hover disabled:bg-sunken disabled:text-ink-ghost"
                  >
                    <ArrowUp className="size-4" strokeWidth={2} aria-hidden />
                    <span className="sr-only">Send your answer</span>
                  </button>
                </div>
              </ComposeBox>
            ) : (
              <AddTrigger label="Answer Dash's question" onClick={() => setWriting(true)} />
            ))}

          <div className="mt-1.5 flex flex-wrap items-center gap-2">
            {hasAnswer ? (
              <>
                <Button
                  type="submit"
                  name="intent"
                  value="draft"
                  size="sm"
                  variant={move === 'draft' ? 'primary' : 'secondary'}
                >
                  {move === 'draft' ? 'Draft it' : 'Draft it now'}
                </Button>
                <PaidHint action={ANSWER} what="Cost of drafting" />
                <span className="text-small text-ink-muted">Drafting takes about a minute.</span>
              </>
            ) : (
              <Button type="submit" formAction={stopAction} size="sm" variant="ghost">
                Stop the interview
              </Button>
            )}
          </div>
        </form>
      )}

      <FieldError>{started.error ?? answered.error ?? stopped.error}</FieldError>
    </ThreadPanel>
  );
}

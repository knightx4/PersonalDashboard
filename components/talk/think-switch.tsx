'use client';

import { createContext, useContext } from 'react';
import Link, { linkVariants } from '@/components/ui/link';
import { Lightbulb } from 'lucide-react';
import { ToggleChip } from '@/components/ui/chip';
import { Tooltip } from '@/components/ui/tooltip';
import { approxDollars } from '@/lib/core/spend/estimate-types';
import { sessionSentState, turnSessionSent, turnThought, type SessionSentState } from '@/lib/talk/thought';
import { sessionThreadPath } from '@/lib/core/session-threads-model';
import { useSessionThreadLive } from '@/components/thread/use-session-thread-live';
import type { TalkToolCall } from '@/lib/talk/talk';
import { cn } from '@/lib/cn';

/**
 * A picker under the box set as quiet words, as Claude sets its model and
 * effort under its box (plan #2863): grey text, a ground only on hover.
 */
export const QUIET_PICKER =
  'press-area inline-flex h-(--control-h) shrink-0 items-center gap-1 rounded-control px-1.5 text-small text-ink-muted transition-colors duration-quick hover:bg-sunken hover:text-ink [&_svg]:size-3.5 [&_svg]:shrink-0';

/**
 * "Think it through" on Dash's box (plan #2789.10): pressed, the next
 * questions are answered on Opus at high effort, with web search, the specs,
 * the code and a mockup (lib/dash/think.ts). Off, it is the bulb alone, since
 * the foot already holds the file, scope and model chips; on, it says its name
 * in the model chip's place, since the model is then Opus whatever was
 * picked. It stays on until it is pressed again.
 */
export function ThinkSwitch({
  on,
  onChange,
  quiet = false,
}: {
  on: boolean;
  onChange: (on: boolean) => void;
  /** Plain grey words under the box, with no ring, as Chat's Dash tab sets its pickers (plan #2863). */
  quiet?: boolean;
}) {
  if (quiet) {
    return (
      <Tooltip
        label={
          on
            ? 'Dash thinks each answer through on Opus, with the web and the code. Slower, and costs more.'
            : 'Think it through: a slower, deeper answer on Opus, with the web and the code.'
        }
        className="shrink-0"
      >
        <button
          type="button"
          aria-pressed={on}
          onClick={() => onChange(!on)}
          className={cn(QUIET_PICKER, on && 'text-accent hover:text-accent')}
        >
          <Lightbulb strokeWidth={1.75} aria-hidden />
          {on ? 'Think it through' : 'Think'}
        </button>
      </Tooltip>
    );
  }
  return (
    <Tooltip
      label={
        on
          ? 'Dash thinks each answer through on Opus, with the web and the code. Slower, and costs more.'
          : 'Think it through: a slower, deeper answer on Opus, with the web and the code.'
      }
      className="shrink-0"
    >
      <ToggleChip
        on={on}
        aria-label="Think it through"
        onClick={() => onChange(!on)}
        className={on ? 'h-5.5 px-2' : 'h-5.5 w-7 justify-center px-0'}
      >
        <Lightbulb strokeWidth={1.75} aria-hidden />
        {on && <span>Think it through</span>}
      </ToggleChip>
    </Tooltip>
  );
}

/** "Thought through on Opus · About $0.42", under an answer that was; nothing under one that was not. */
export function ThoughtLine({ calls }: { calls: readonly TalkToolCall[] | undefined }) {
  const thought = turnThought(calls);
  if (!thought) return null;
  const cost =
    thought.costMicros === null
      ? 'cost not recorded'
      : thought.costMicros < 10_000
        ? 'under a cent'
        : `about ${approxDollars(thought.costMicros)}`;
  return (
    <p className="mt-2 flex items-start gap-1.5 text-small text-ink-muted">
      <Lightbulb className="mt-0.5 size-3.5 shrink-0" strokeWidth={1.75} aria-hidden />
      <span className="min-w-0">
        Thought through on Opus · <span className="tabular">{cost}</span>
        {/* Why it was not sent to a session (plan #2789.11). */}
        {thought.fallback ? <> · Answered here because {thought.fallback}</> : null}
      </span>
    </p>
  );
}

/**
 * Under Ask Dash's reply to a question sent to a session thread (plan
 * #2789.11): where the session has got to, heard live, and the link to the
 * thread. Nothing under any other reply.
 */
export function SessionSentLine({ calls }: { calls: readonly TalkToolCall[] | undefined }) {
  const sent = turnSessionSent(calls);
  const fixture = useContext(SessionSentFixture);
  const live = useSessionThreadLive({ threadId: sent?.threadId ?? null, enabled: !fixture });
  if (!sent) return null;
  return <SessionSentView threadId={sent.threadId} state={fixture ?? sessionSentState(live.messages, live.latest)} />;
}

/** The gallery's stand-in for the live thread: drawn in this state, with nothing heard. */
export const SessionSentFixture = createContext<SessionSentState | null>(null);

const SENT_LABEL: Record<SessionSentState['state'], string> = {
  waiting: 'Sent to a session · Waiting for it to start',
  working: 'Thinking it through in a session',
  asked: 'The session has a question for you',
  answered: 'The session has answered',
};

const SENT_LINK: Record<SessionSentState['state'], string> = {
  waiting: 'Open the thread',
  working: 'Open the thread',
  asked: 'Answer it',
  answered: 'Read it',
};

/** The line as drawn, for a given state; the gallery draws each. */
export function SessionSentView({ threadId, state }: { threadId: string; state: SessionSentState }) {
  return (
    <p className="mt-2 flex items-start gap-1.5 text-small text-ink-muted" aria-live="polite">
      <Lightbulb className="mt-0.5 size-3.5 shrink-0" strokeWidth={1.75} aria-hidden />
      <span className="min-w-0 break-words">
        {SENT_LABEL[state.state]}
        {state.state === 'working' ? <> · <span className="text-ink">{state.line}</span></> : null}
        {' · '}
        <Link href={sessionThreadPath(threadId)} className={cn(linkVariants({ tone: 'inline' }), 'press-area')}>
          {SENT_LINK[state.state]}
        </Link>
      </span>
    </p>
  );
}

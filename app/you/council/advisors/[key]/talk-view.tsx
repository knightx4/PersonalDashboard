'use client';

import { createContext, useContext, useOptimistic, useRef, useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { RotateCcw } from 'lucide-react';
import { ThreadPanel } from '@/components/patterns/thread';
import { Thread, type TalkAssistant, type TalkSend } from '@/components/thread/thread';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { FieldError } from '@/components/ui/field';
import Link, { linkVariants } from '@/components/ui/link';
import { SectionLabel } from '@/components/ui/section-heading';
import { whenDate } from '@/lib/core/when';
import { cn } from '@/lib/cn';
import type { TalkTurn } from '@/lib/talk/talk';
import type { RosterAdvisor } from '@/lib/you/board-advisors';
import { MEMORY_KIND_LABELS, type AdvisorChat, type AdvisorMemory, type Opener } from '@/lib/you/advisor-talk';
import { advisorHref } from '@/lib/you/board-profile';
import { AdvisorAvatar } from '../../advisor-avatar';
import type { TalkResult } from './talk-actions';

/**
 * The Talk tab on an advisor's profile (plan #2581.6), on the thread
 * pattern: the talk on one card, named first, then the turns oldest first,
 * the advisor's on the recessed ground with their avatar, and the box last.
 * A first talk opens with three ways in, drawn from the person's open
 * decisions. Under it, the earlier talks with this advisor, each of which can
 * be carried on, and what the advisor remembers, each line of which can be
 * forgotten.
 *
 * A reply that failed leaves the person's words in the talk with Try again
 * under them, which asks for the reply again without sending the words twice.
 */

export type TalkData = {
  /** Every talk with this advisor, the latest first. */
  chats: readonly AdvisorChat[];
  /** The open talk; null for a new one. */
  chat: AdvisorChat | null;
  turns: readonly TalkTurn[];
  memory: readonly AdvisorMemory[];
  /** Three ways to open a first talk. */
  openers: readonly Opener[];
};

export type TalkActions = {
  send: (key: string, chatId: string | null, body: string, retry?: boolean) => Promise<TalkResult>;
  forget: (key: string, id: string) => Promise<{ error: string | null }>;
};

const TurnAdvisor = createContext<Pick<RosterAdvisor, 'key' | 'name'> | null>(null);

/** The advisor's avatar at the head of their turns: their one mark, no other badge (plan #2581.3). */
function AdvisorTurnMark() {
  const advisor = useContext(TurnAdvisor);
  if (!advisor) return null;
  return <AdvisorAvatar advisorKey={advisor.key} name={advisor.name} size="sm" decorative />;
}

function talkHref(key: string, chat: string): string {
  return `${advisorHref(key, 'talk')}&chat=${encodeURIComponent(chat)}`;
}

export function TalkTab({
  advisor,
  data,
  actions,
  timeZone,
  pendingQuestion,
}: {
  advisor: RosterAdvisor;
  data: TalkData;
  actions: TalkActions;
  timeZone: string;
  /** For the gallery: the thread drawn with this on its way and the advisor typing. */
  pendingQuestion?: string;
}) {
  const router = useRouter();
  const [chatId, setChatId] = useState<string | null>(data.chat?.id ?? null);
  const last = data.turns[data.turns.length - 1];
  /** The person's message no reply followed, which Try again asks about again. */
  const [waiting, setWaiting] = useState<string | null>(last?.role === 'user' ? last.id : null);
  /** Whether that message came unanswered from an earlier visit, so nothing else on the page says so. */
  const [stale, setStale] = useState(last?.role === 'user');
  const retrying = useRef(false);
  const [opener, setOpener] = useState<string | null>(null);
  const assistant: TalkAssistant = { name: advisor.name, Mark: AdvisorTurnMark };

  const send: TalkSend = async (body) => {
    const retry = retrying.current;
    retrying.current = false;
    const result = await actions.send(advisor.key, chatId, body, retry);
    if (result.error) {
      const mine = result.turns?.find((turn) => turn.role === 'user');
      setWaiting(mine?.id ?? (retry ? waiting : null));
      setStale(false);
    } else {
      setWaiting(null);
    }
    if (result.chatId && result.chatId !== chatId) {
      setChatId(result.chatId);
      // The new talk gets its own address, so it is listed and can be carried on.
      if (!pendingQuestion) router.replace(talkHref(advisor.key, result.chatId), { scroll: false });
    }
    return { turns: result.turns, error: result.error };
  };

  const fresh = data.turns.length === 0 && !opener && !pendingQuestion;
  const title = data.chat?.title ?? `A new talk with ${advisor.name}`;
  const meta = data.chat
    ? `Started ${whenDate(data.chat.createdAt, { timeZone, year: 'auto' })}`
    : `Nothing said yet. ${advisor.name} keeps what you say for later talks and meetings.`;

  return (
    <div className="space-y-6">
      <TurnAdvisor value={advisor}>
        <ThreadPanel title={title} meta={meta}>
          <Thread
            key={`${data.chat?.id ?? 'new'}:${opener ?? ''}`}
            id={`advisor-talk-${advisor.key}`}
            turns={data.turns}
            send={send}
            assistant={assistant}
            label={data.turns.length > 0 ? `Reply to ${advisor.name}` : `Talk to ${advisor.name}`}
            placeholder={`Ask ${advisor.name} anything`}
            waiting={`${advisor.name} is writing…`}
            cost={{
              action: 'app/you/council/advisors/[key]/talk-actions.ts#sendToAdvisor',
              what: `Cost of each reply from ${advisor.name}`,
            }}
            ask={opener ?? undefined}
            pendingQuestion={pendingQuestion}
            above={
              fresh && data.openers.length > 0 ? (
                <Openers openers={data.openers} onPick={setOpener} />
              ) : undefined
            }
            below={(turn, thread) =>
              turn.id === waiting && !thread.busy ? (
                <TryAgain
                  stale={stale}
                  name={advisor.name}
                  onPress={() => {
                    retrying.current = true;
                    thread.resend(turn.body);
                  }}
                />
              ) : null
            }
          />
        </ThreadPanel>
      </TurnAdvisor>
      <Talks advisor={advisor} chats={data.chats} open={data.chat?.id ?? null} timeZone={timeZone} />
      <Memory advisor={advisor} memory={data.memory} forget={actions.forget} timeZone={timeZone} />
    </div>
  );
}

/** The three ways into a first talk, each sent as it is pressed. */
function Openers({ openers, onPick }: { openers: readonly Opener[]; onPick: (send: string) => void }) {
  return (
    <div className="space-y-1.5">
      <SectionLabel>Start with</SectionLabel>
      <ul className="space-y-1.5">
        {openers.map((opener) => (
          <li key={opener.send}>
            <button
              type="button"
              onClick={() => onPick(opener.send)}
              className={cn(linkVariants({ tone: 'inline' }), 'press-area text-left text-ui [overflow-wrap:anywhere]')}
            >
              {opener.shown}
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}

function TryAgain({ stale, name, onPress }: { stale: boolean; name: string; onPress: () => void }) {
  return (
    <div className="flex flex-wrap items-center gap-x-2 gap-y-1 pt-1">
      {stale && <p className="text-small text-ink-muted">{name} did not reply to this.</p>}
      <Button type="button" variant="secondary" size="sm" onClick={onPress}>
        <RotateCcw aria-hidden strokeWidth={1.75} className="size-3.5" />
        Try again
      </Button>
    </div>
  );
}

/** Every talk with this advisor, the open one marked, with a new one to start. */
function Talks({
  advisor,
  chats,
  open,
  timeZone,
}: {
  advisor: RosterAdvisor;
  chats: readonly AdvisorChat[];
  open: string | null;
  timeZone: string;
}) {
  if (chats.length === 0) return null;
  return (
    <section className="space-y-2">
      <div className="flex items-baseline justify-between gap-3">
        <SectionLabel as="h2" count={chats.length}>
          Talks
        </SectionLabel>
        {open && (
          <Link href={talkHref(advisor.key, 'new')} className={cn(linkVariants(), 'press-area text-ui')}>
            New talk
          </Link>
        )}
      </div>
      <Card padding="none">
        <ul className="divide-y divide-border">
          {chats.map((chat) => {
            const here = chat.id === open;
            const when = whenDate(chat.lastMessageAt ?? chat.createdAt, { timeZone, year: 'auto' });
            return (
              <li key={chat.id} className="card-pad-x row-pad flex items-baseline justify-between gap-3">
                {here ? (
                  <span className="min-w-0 text-ui font-medium text-ink [overflow-wrap:anywhere]" aria-current="page">
                    {chat.title ?? 'Untitled talk'}
                  </span>
                ) : (
                  <Link
                    href={talkHref(advisor.key, chat.id)}
                    className="min-w-0 text-ui text-ink hover:text-accent [overflow-wrap:anywhere]"
                  >
                    {chat.title ?? 'Untitled talk'}
                  </Link>
                )}
                <span className="tabular shrink-0 text-small text-ink-muted">{here ? 'Open' : when}</span>
              </li>
            );
          })}
        </ul>
      </Card>
    </section>
  );
}

/** What the advisor keeps between talks and meetings, each line forgettable. */
function Memory({
  advisor,
  memory,
  forget,
  timeZone,
}: {
  advisor: RosterAdvisor;
  memory: readonly AdvisorMemory[];
  forget: TalkActions['forget'];
  timeZone: string;
}) {
  const [shown, drop] = useOptimistic(memory, (rows: readonly AdvisorMemory[], id: string) =>
    rows.filter((row) => row.id !== id),
  );
  const [error, setError] = useState<string | null>(null);
  const [, startTransition] = useTransition();
  const press = (id: string) => {
    setError(null);
    startTransition(async () => {
      drop(id);
      const result = await forget(advisor.key, id);
      if (result.error) setError(result.error);
    });
  };
  // Newest first: what was said last is what the person looks for.
  const rows = [...shown].reverse();
  // Nothing remembered yet: the talk card's empty line says what will be kept.
  if (rows.length === 0 && !error) return null;
  return (
    <section className="space-y-2">
      <SectionLabel as="h2" count={rows.length}>
        What {advisor.name} remembers
      </SectionLabel>
      <Card padding="none">
        <ul className="divide-y divide-border">
          {rows.map((row) => (
            <li key={row.id} className="card-pad-x row-pad flex items-start gap-3">
              <div className="min-w-0 flex-1 space-y-0.5">
                <p className="text-ui text-ink [overflow-wrap:anywhere]">{row.text}</p>
                <p className="text-small text-ink-muted">
                  {MEMORY_KIND_LABELS[row.kind]} · {whenDate(row.createdAt, { timeZone, year: 'auto' })}
                </p>
              </div>
              <Button type="button" variant="ghost" size="xs" onClick={() => press(row.id)}>
                Forget
              </Button>
            </li>
          ))}
        </ul>
      </Card>
      <FieldError>{error}</FieldError>
    </section>
  );
}

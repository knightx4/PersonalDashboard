'use client';

import { useEffect, useRef, useState, useTransition } from 'react';
import { Check, Send, X } from 'lucide-react';
import { PageHeader, type Subject } from '@/components/shell/page-header';
import { PageColumn } from '@/components/shell/page-width';
import { Banner } from '@/components/ui/banner';
import { Button } from '@/components/ui/button';
import { Card, CardSection } from '@/components/ui/card';
import { Disclosure } from '@/components/ui/disclosure';
import { CheckRow, ComposeBody, ComposeBox, FieldError } from '@/components/ui/field';
import { IconButton } from '@/components/ui/icon-button';
import Link, { linkVariants } from '@/components/ui/link';
import { LinkedText } from '@/components/ui/linked-text';
import { cn } from '@/lib/cn';
import { whenAgo, whenDay } from '@/lib/core/when';
import { cadenceWords } from '@/lib/you/advisor-watch-words';
import type { Brain } from '@/lib/you/board-brain';
import { threadHref } from '@/lib/you/chat-threads-model';
import {
  MESSAGE_MAX,
  replyState,
  type CouncilChat,
  type CouncilMemory,
  type CouncilMessage,
  type CouncilNote,
  type Mentor,
  type MentorWatch,
} from '@/lib/you/council-model';
import { MentorMark } from '../../mentor-mark';
import { NoteCard, type NoteActions } from '../../note-card';
import { useRefreshWhileRunning } from '../../refresh-while-running';

/**
 * One mentor's page on the Council (you 0037): their newest note, the one
 * running talk with them, what they are holding the person to, what they
 * have noted about the person, and how they think.
 *
 * A message is saved at once and the mentor's reply is written by the board
 * routine on the person's plan, so it arrives a few minutes later; the page
 * looks again every minute while it waits. Opening the page reads the
 * mentor's notes. Opened from a note's Talk about this, the note shows above
 * the box and the message is sent about it.
 */

export type MentorActions = NoteActions & {
  readMentor: (advisorId: string, key: string) => Promise<{ error: string | null }>;
  send: (advisorId: string, text: string, noteId?: string | null) => Promise<{ error: string | null; saved: boolean }>;
  commitment: (id: string, done: boolean, key: string) => Promise<{ error: string | null }>;
  forget: (id: string, key: string) => Promise<{ error: string | null }>;
  stopWatch: (id: string, key: string) => Promise<{ error: string | null }>;
};

const MEMORY_LABELS: Record<Exclude<CouncilMemory['kind'], 'commitment'>, string> = {
  fact: 'Fact',
  preference: 'Preference',
  open_thread: 'Open thread',
};

export function MentorView({
  mentor,
  brain,
  notes,
  chat,
  messages,
  memory,
  watches,
  about,
  timezone,
  now,
  actions,
  subject,
  draft = '',
}: {
  mentor: Mentor;
  brain: Brain | null;
  notes: readonly CouncilNote[];
  chat: CouncilChat | null;
  messages: readonly CouncilMessage[];
  memory: readonly CouncilMemory[];
  /** Watches Dash wrote for this mentor (plan #3030.1.4). */
  watches: readonly MentorWatch[];
  /** The note the talk was opened from, by Talk about this. */
  about: CouncilNote | null;
  timezone: string;
  now: number;
  actions: MentorActions;
  subject?: Subject;
  /** What the box starts with. Only the gallery sets it. */
  draft?: string;
}) {
  const reply = replyState(chat, now);
  useRefreshWhileRunning(reply.kind === 'waiting');

  const hasUnread = notes.some((n) => !n.readAt);
  const readOnce = useRef(false);
  useEffect(() => {
    if (!hasUnread || readOnce.current) return;
    readOnce.current = true;
    void actions.readMentor(mentor.id, mentor.key);
  }, [hasUnread, actions, mentor.id, mentor.key]);

  const [text, setText] = useState(draft);
  const [aboutNote, setAboutNote] = useState<CouncilNote | null>(about);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const send = () => {
    setError(null);
    startTransition(async () => {
      const result = await actions.send(mentor.id, text, aboutNote?.id ?? null);
      if (result.saved) {
        setText('');
        setAboutNote(null);
      }
      if (result.error) setError(result.error);
    });
  };

  const commitments = memory.filter((m) => m.kind === 'commitment');
  const open = commitments.filter((c) => !c.doneAt);
  const done = commitments.filter((c) => c.doneAt);
  const running = watches.filter((w) => w.status !== 'stopped');
  const stopped = watches.filter((w) => w.status === 'stopped');
  const known =memory.filter((m) => m.kind !== 'commitment');
  const [latest, ...earlier] = notes;
  const author = { key: mentor.key, name: mentor.name, kind: mentor.kind };

  return (
    <PageColumn>
      <PageHeader
        title={mentor.name}
        leading={<MentorMark mentorKey={mentor.key} name={mentor.name} kind={mentor.kind} size="lg" />}
        description={
          <>
            {mentor.question}
            {mentor.kind === 'guest' && (
              <span className="block text-small text-ink-muted">
                A persona Dash built from their public work. It never speaks for the real person.
              </span>
            )}
          </>
        }
        subject={subject}
      />

      <div className="space-y-6">
        {latest && (
          <section className="space-y-2">
            <NoteCard note={latest} author={author} timezone={timezone} now={now} actions={actions} showAuthor={false} />
            {earlier.length > 0 && (
              <Disclosure title="Earlier notes" meta={`${earlier.length}`}>
                <div className="space-y-2">
                  {earlier.map((note) => (
                    <NoteCard key={note.id} note={note} author={author} timezone={timezone} now={now} actions={actions} showAuthor={false} />
                  ))}
                </div>
              </Disclosure>
            )}
          </section>
        )}

        <section id="talk" className="scroll-mt-20 space-y-3">
          <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
            <h2 className="text-ui font-semibold text-ink">Talk with {mentor.name}</h2>
            {/* The whole thread, live, is on Chat's People tab (plan #2748.6). */}
            <Link href={threadHref(mentor.key)} className={cn(linkVariants({ tone: 'quiet' }), 'press-area text-small')}>
              Open your thread in Chat
            </Link>
          </div>
          {messages.length === 0 && reply.kind === 'idle' && (
            <p className="text-ui text-ink-muted">
              {mentor.canTalk
                ? `Ask anything. ${mentor.name} reads your goals, notes and what you have done before answering, and remembers what you settle.`
                : `${mentor.name} cannot talk until their brain is built, on Mentors.`}
            </p>
          )}
          {messages.length > 0 && (
            <ol className="space-y-3">
              {messages.map((message) => (
                <MessageRow key={message.id} message={message} mentor={mentor} timezone={timezone} now={now} />
              ))}
            </ol>
          )}
          {reply.kind === 'waiting' && (
            <p className="text-small text-ink-muted" role="status">
              {mentor.name} is writing back. Replies take a few minutes, and this page checks every minute.
            </p>
          )}
          {reply.kind === 'failed' && <Banner tone="warn">{reply.error}</Banner>}

          {mentor.canTalk && (
            <form
              className="space-y-2"
              onSubmit={(event) => {
                event.preventDefault();
                if (text.trim() && !pending && reply.kind !== 'waiting') send();
              }}
            >
              {aboutNote && (
                <div className="flex items-start gap-2 rounded-control bg-sunken px-3 py-2 text-small text-ink-muted">
                  <span className="min-w-0 flex-1">
                    About their note: <span className="text-ink">{aboutNote.text}</span>
                  </span>
                  <IconButton label="Not about this note" size="sm" onClick={() => setAboutNote(null)}>
                    <X aria-hidden strokeWidth={1.75} className="size-3.5" />
                  </IconButton>
                </div>
              )}
              <ComposeBox>
                <ComposeBody
                  aria-label={`Message to ${mentor.name}`}
                  className="min-h-11"
                  placeholder={aboutNote ? 'What do you make of it?' : `Ask ${mentor.name} something`}
                  value={text}
                  maxLength={MESSAGE_MAX}
                  rows={2}
                  onChange={(event) => setText(event.target.value)}
                  onKeyDown={(event) => {
                    if (event.key === 'Enter' && (event.metaKey || event.ctrlKey)) {
                      event.preventDefault();
                      if (text.trim() && !pending && reply.kind !== 'waiting') send();
                    }
                  }}
                />
                <div className="flex justify-end pt-1">
                  <Button type="submit" size="sm" pending={pending} disabled={!text.trim() || reply.kind === 'waiting'}>
                    <Send aria-hidden strokeWidth={1.75} className="size-3.5" />
                    {pending ? 'Sending…' : 'Send'}
                  </Button>
                </div>
              </ComposeBox>
              <FieldError>{error}</FieldError>
            </form>
          )}
        </section>

        <CardSection title="Holding you to" hint={open.length === 0 ? 'Nothing yet' : undefined}>
          {open.length === 0 ? (
            <p className="card-pad-x row-pad text-small text-ink-muted">
              When you agree to do something in a talk, {mentor.name} keeps it here and asks how it went.
            </p>
          ) : (
            <ul>
              {open.map((c) => (
                <CommitmentRow key={c.id} item={c} mentorKey={mentor.key} timezone={timezone} now={now} actions={actions} />
              ))}
            </ul>
          )}
          {done.length > 0 && (
            <div className="card-pad-x pb-2">
              <Disclosure title="Done" meta={`${done.length}`}>
                <ul>
                  {done.map((c) => (
                    <CommitmentRow key={c.id} item={c} mentorKey={mentor.key} timezone={timezone} now={now} actions={actions} />
                  ))}
                </ul>
              </Disclosure>
            </div>
          )}
        </CardSection>

        {watches.length > 0 && (
          <CardSection title={`What Dash watches for ${mentor.name}`}>
            {running.length > 0 && (
              <ul>
                {running.map((w) => (
                  <WatchRow key={w.id} item={w} mentorKey={mentor.key} timezone={timezone} now={now} actions={actions} />
                ))}
              </ul>
            )}
            {stopped.length > 0 && (
              <div className="card-pad-x pb-2">
                <Disclosure title="Stopped" meta={`${stopped.length}`}>
                  <ul>
                    {stopped.map((w) => (
                      <WatchRow key={w.id} item={w} mentorKey={mentor.key} timezone={timezone} now={now} actions={actions} />
                    ))}
                  </ul>
                </Disclosure>
              </div>
            )}
          </CardSection>
        )}

        {known.length > 0 && (
          <CardSection title={`What ${mentor.name} knows about you`}>
            <ul>
              {known.map((m) => (
                <MemoryRow key={m.id} item={m} mentorKey={mentor.key} actions={actions} />
              ))}
            </ul>
          </CardSection>
        )}

        {brain && <HowTheyThink brain={brain} name={mentor.name} focus={mentor.focus} />}
      </div>
    </PageColumn>
  );
}

function MessageRow({
  message,
  mentor,
  timezone,
  now,
}: {
  message: CouncilMessage;
  mentor: Mentor;
  timezone: string;
  now: number;
}) {
  const mine = message.role === 'person';
  return (
    <li className={cn('flex gap-2.5', mine && 'justify-end')}>
      {!mine && <MentorMark mentorKey={mentor.key} name={mentor.name} kind={mentor.kind} size="sm" className="mt-0.5" />}
      <div
        className={cn(
          'max-w-prose space-y-1.5 rounded-card px-3 py-2',
          // Each side on its own ground, so no message sits bare on the page.
          mine ? 'ml-10 bg-sunken sm:ml-20' : 'mr-10 bg-surface sm:mr-20',
        )}
      >
        <p className="whitespace-pre-line text-ui text-ink">
          <LinkedText text={message.text} refs={false} />
        </p>
        {message.receipts.length > 0 && (
          <ul className="flex flex-wrap gap-x-3 gap-y-1 text-small">
            {message.receipts.map((r) => (
              <li key={r.link + r.label}>
                <Link href={r.link} className={cn(linkVariants({ tone: 'quiet' }), 'press-area')}>
                  {r.label}
                </Link>
              </li>
            ))}
          </ul>
        )}
        <p className="text-micro text-ink-muted">{whenAgo(message.createdAt, { timeZone: timezone, now })}</p>
      </div>
    </li>
  );
}

function CommitmentRow({
  item,
  mentorKey,
  timezone,
  now,
  actions,
}: {
  item: CouncilMemory;
  mentorKey: string;
  timezone: string;
  now: number;
  actions: MentorActions;
}) {
  const [pending, startTransition] = useTransition();
  const done = !!item.doneAt;
  const late = !done && item.dueOn && item.dueOn < new Date(now).toISOString().slice(0, 10);
  return (
    <li className="card-pad-x row-pad flex min-h-11 items-center gap-3">
      <CheckRow
        className="min-w-0 flex-1"
        aria-label={done ? `Not done: ${item.text}` : `Done: ${item.text}`}
        checked={done}
        disabled={pending}
        onChange={() => startTransition(async () => void (await actions.commitment(item.id, !done, mentorKey)))}
        title={<span className={done ? 'text-ink-muted line-through' : undefined}>{item.text}</span>}
      />
      {item.dueOn && (
        <span className={cn('tabular shrink-0 text-small', late ? 'text-caution' : 'text-ink-muted')}>
          {whenDay(item.dueOn, { timeZone: timezone, now })}
        </span>
      )}
    </li>
  );
}

function WatchRow({
  item,
  mentorKey,
  timezone,
  now,
  actions,
}: {
  item: MentorWatch;
  mentorKey: string;
  timezone: string;
  now: number;
  actions: MentorActions;
}) {
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const state =
    item.status === 'stopped'
      ? 'Stopped'
      : item.status === 'paused'
        ? 'Paused after errors'
        : item.lastRunAt
          ? `Running, last checked ${whenAgo(item.lastRunAt, { timeZone: timezone, now })}`
          : 'Running, not checked yet';
  return (
    <li className="card-pad-x row-pad flex min-h-11 items-center gap-3">
      <span className="min-w-0 flex-1">
        <span className={cn('block text-ui', item.status === 'stopped' ? 'text-ink-muted' : 'text-ink')}>{item.about}</span>
        <span className="block text-small text-ink-muted">
          Checked {cadenceWords(item.everyDays)}. {state}.
        </span>
        {item.status === 'paused' && item.lastError && <span className="block text-small text-caution">{item.lastError}</span>}
        <FieldError>{error}</FieldError>
      </span>
      {item.status !== 'stopped' && (
        <Button
          type="button"
          size="xs"
          variant="ghost"
          pending={pending}
          aria-label={`Stop watching: ${item.about}`}
          onClick={() =>
            startTransition(async () => {
              setError(null);
              const result = await actions.stopWatch(item.id, mentorKey);
              if (result.error) setError(result.error);
            })
          }
        >
          Stop
        </Button>
      )}
    </li>
  );
}

function MemoryRow({ item, mentorKey, actions }: { item: CouncilMemory; mentorKey: string; actions: MentorActions }) {
  const [pending, startTransition] = useTransition();
  const label = item.kind === 'commitment' ? 'Commitment' : MEMORY_LABELS[item.kind];
  return (
    <li className="card-pad-x row-pad flex min-h-11 items-center gap-3">
      <span className="min-w-0 flex-1">
        <span className="block text-ui text-ink">{item.text}</span>
        <span className="block text-small text-ink-muted">{label}</span>
      </span>
      <Button
        type="button"
        size="xs"
        variant="ghost"
        disabled={pending}
        onClick={() => startTransition(async () => void (await actions.forget(item.id, mentorKey)))}
      >
        Forget
      </Button>
    </li>
  );
}

function HowTheyThink({ brain, name, focus }: { brain: Brain; name: string; focus: string | null }) {
  return (
    <Card padding="standard">
      <Disclosure title={`How ${name} thinks`} meta={brain.assessment?.name ?? undefined} remember="you.council.fold.how-they-think">
        <div className="space-y-4 text-ui text-ink">
          {focus && <p className="text-ink-muted">{focus}</p>}
          {brain.assessment && (
            <div>
              <h3 className="text-small font-semibold text-ink-muted">{brain.assessment.name}</h3>
              <p>{brain.assessment.text}</p>
            </div>
          )}
          {brain.questions.length > 0 && (
            <div>
              <h3 className="text-small font-semibold text-ink-muted">What they ask</h3>
              <ul className="list-disc space-y-1 pl-5">
                {brain.questions.map((q) => (
                  <li key={q}>{q}</li>
                ))}
              </ul>
            </div>
          )}
          {brain.rules.length > 0 && (
            <div>
              <h3 className="text-small font-semibold text-ink-muted">Their rules</h3>
              <ul className="list-disc space-y-1 pl-5">
                {brain.rules.map((r) => (
                  <li key={r}>{r}</li>
                ))}
              </ul>
            </div>
          )}
          {brain.voice && (
            <div>
              <h3 className="text-small font-semibold text-ink-muted">How they talk</h3>
              <p>{brain.voice}</p>
            </div>
          )}
          {brain.sources.length > 0 && (
            <p className="text-small text-ink-muted">
              <Check aria-hidden strokeWidth={1.75} className="mr-1 inline size-3.5" />
              Built from {brain.sources.length} sources.
            </p>
          )}
        </div>
      </Disclosure>
    </Card>
  );
}

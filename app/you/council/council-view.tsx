'use client';

import { useTransition } from 'react';
import { PageHeader, type Subject } from '@/components/shell/page-header';
import { PageColumn } from '@/components/shell/page-width';
import { Banner } from '@/components/ui/banner';
import { Button, buttonVariants } from '@/components/ui/button';
import { cardVariants } from '@/components/ui/card';
import { Group } from '@/components/ui/disclosure';
import Link from '@/components/ui/link';
import { cn } from '@/lib/cn';
import { whenAgo } from '@/lib/core/when';
import { NOTES_PER_DAY, UNREAD_MAX, type CouncilNote, type Mentor } from '@/lib/you/council-model';
import { MentorMark } from './mentor-mark';
import { NoteCard, type NoteActions } from './note-card';

/**
 * The Council (you 0037): the home of the You tab that was the Board.
 *
 * First, anything the board's decisions need from the person today (a
 * check-back or a tripwire), as one line to the Decisions page. Then the
 * notes the mentors wrote since the person last read, oldest first, each
 * with what can be done with it. Then every mentor as a tile: their mark,
 * the question they own, and their newest note, or the question alone when
 * they have written nothing yet. A tile opens the mentor's page, where the
 * person talks to them.
 *
 * The notes are capped so they do not pile up: one unread per mentor, six
 * unread at most, three written a day. When the cap holds the round back,
 * the section says so, so silence is never mistaken for a broken routine.
 */

export function CouncilView({
  mentors,
  unread,
  due,
  timezone,
  now,
  actions,
  subject,
}: {
  mentors: readonly Mentor[];
  unread: readonly CouncilNote[];
  /** Check-backs and tripwires due on the board's decisions. */
  due: number;
  timezone: string;
  now: number;
  actions: NoteActions;
  subject?: Subject;
}) {
  const [pending, startTransition] = useTransition();
  const byId = new Map(mentors.map((m) => [m.id, m]));
  const seats = mentors.filter((m) => m.kind === 'seat');
  const guests = mentors.filter((m) => m.kind === 'guest');
  const held = unread.length >= UNREAD_MAX;

  return (
    <PageColumn>
      <PageHeader
        title="Council"
        subject={subject}
        actions={
          <>
            <Link href="/you/council/advisors" className={buttonVariants({ variant: 'ghost' })}>
              Mentors
            </Link>
            <Link href="/you/council/decisions" className={buttonVariants({ variant: 'secondary' })}>
              Decisions
            </Link>
          </>
        }
      />

      {due > 0 && (
        <Banner tone="warn" className="mb-4">
          <Link href="/you/council/decisions" className="font-medium text-ink underline underline-offset-2">
            {due === 1 ? 'One decision is waiting on you' : `${due} decisions are waiting on you`}
          </Link>{' '}
          <span className="text-ink-muted">to say how it went, or whether a tripwire was crossed.</span>
        </Banner>
      )}

      <div className="space-y-6">
        <Group
          title={unread.length > 0 ? `New from your council (${unread.length})` : 'New from your council'}
          action={
            unread.length > 1 ? (
              <Button
                type="button"
                size="sm"
                variant="ghost"
                pending={pending}
                onClick={() => startTransition(async () => void (await actions.read(unread.map((n) => n.id))))}
              >
                Mark all read
              </Button>
            ) : undefined
          }
        >
          {unread.length === 0 ? (
            <p className="text-ui text-ink-muted">
              Nothing new. A few mentors write each day, about something of yours that changed. At most{' '}
              {NOTES_PER_DAY} a day, and they hold off while {UNREAD_MAX} are waiting for you.
            </p>
          ) : (
            <div className="space-y-3">
              {held && (
                <p className="text-small text-ink-muted">
                  The council is holding back until you read some of these: it stops at {UNREAD_MAX} unread.
                </p>
              )}
              {unread.map((note) => {
                const mentor = byId.get(note.advisorId);
                if (!mentor) return null;
                return (
                  <NoteCard
                    key={note.id}
                    note={note}
                    author={{ key: mentor.key, name: mentor.name, kind: mentor.kind }}
                    timezone={timezone}
                    now={now}
                    actions={actions}
                  />
                );
              })}
            </div>
          )}
        </Group>

        <Group title="The five seats">
          <MentorGrid mentors={seats} timezone={timezone} now={now} />
        </Group>
        {guests.length > 0 && (
          <Group title={`Guests (${guests.length})`}>
            <MentorGrid mentors={guests} timezone={timezone} now={now} />
          </Group>
        )}
      </div>
    </PageColumn>
  );
}

function MentorGrid({ mentors, timezone, now }: { mentors: readonly Mentor[]; timezone: string; now: number }) {
  return (
    <ul className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
      {mentors.map((mentor) => (
        <li key={mentor.id}>
          <MentorTile mentor={mentor} timezone={timezone} now={now} />
        </li>
      ))}
    </ul>
  );
}

/** One mentor: mark, name, the question they own, and their newest note or where they stand. */
export function MentorTile({ mentor, timezone, now }: { mentor: Mentor; timezone: string; now: number }) {
  const unread = mentor.note && !mentor.note.readAt;
  return (
    <Link
      href={`/you/council/mentors/${mentor.key}`}
      className={cn(cardVariants({ padding: 'standard', interactive: true }), 'flex h-full flex-col gap-2')}
    >
      <span className="flex items-center gap-2.5">
        <MentorMark mentorKey={mentor.key} name={mentor.name} kind={mentor.kind} />
        <span className="min-w-0 flex-1">
          <span className="block truncate text-ui font-semibold text-ink">{mentor.name}</span>
          <span className="line-clamp-2 block text-small text-ink-muted">{mentor.question}</span>
        </span>
        {unread && (
          <span className="size-2 shrink-0 rounded-pill bg-accent" aria-label="New note" role="img" />
        )}
      </span>
      {mentor.note ? (
        <span className="line-clamp-3 text-small text-ink">{mentor.note.text}</span>
      ) : (
        <span className="text-small text-ink-muted">
          {mentor.canTalk ? 'No note yet. Open to talk.' : 'Their brain is not built yet, so they cannot write or talk.'}
        </span>
      )}
      <span className="mt-auto text-micro text-ink-muted">
        {mentor.waiting
          ? 'Writing back to you…'
          : mentor.note
            ? whenAgo(mentor.note.createdAt, { timeZone: timezone, now })
            : ' '}
      </span>
    </Link>
  );
}

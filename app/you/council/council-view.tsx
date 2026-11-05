'use client';

import { PageHeader, type Subject } from '@/components/shell/page-header';
import { PageColumn } from '@/components/shell/page-width';
import { Banner } from '@/components/ui/banner';
import { buttonVariants } from '@/components/ui/button';
import { Card, cardVariants } from '@/components/ui/card';
import { Group } from '@/components/ui/disclosure';
import Link, { linkVariants } from '@/components/ui/link';
import { cn } from '@/lib/cn';
import { whenAgo } from '@/lib/core/when';
import { UNREAD_MAX, type Mentor } from '@/lib/you/council-model';
import { CHAT_URL } from '@/lib/you/council-texts';
import { MentorMark } from './mentor-mark';

/**
 * The Council (you 0037): the home of the You tab that was the Board.
 *
 * First, anything the board's decisions need from the person today (a
 * check-back or a tripwire), as one line to the Decisions page. Then one
 * line to Chat, where the mentors' daily notes now arrive as texts in their
 * threads (plan #2748.7), with how many are unread. Then every mentor as a
 * tile: their mark, the question they own, and their newest note, or the
 * question alone when they have written nothing yet. A tile opens the
 * mentor's page.
 *
 * The texts are capped so they do not pile up: one unread per mentor, six
 * unread at most, three a day. When the cap holds the round back, the line
 * says so, so silence is never mistaken for a broken routine.
 */

export function CouncilView({
  mentors,
  unreadTexts,
  due,
  timezone,
  now,
  subject,
}: {
  mentors: readonly Mentor[];
  /** Mentors' texts in Chat the person has not read. */
  unreadTexts: number;
  /** Check-backs and tripwires due on the board's decisions. */
  due: number;
  timezone: string;
  now: number;
  subject?: Subject;
}) {
  const seats = mentors.filter((m) => m.kind === 'seat');
  const guests = mentors.filter((m) => m.kind === 'guest');
  const held = unreadTexts >= UNREAD_MAX;

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
          <Link href="/you/council/decisions" className={cn(linkVariants(), 'font-medium')}>
            {due === 1 ? 'One decision is waiting on you' : `${due} decisions are waiting on you`}
          </Link>{' '}
          <span className="text-ink-muted">to say how it went, or whether a tripwire was crossed.</span>
        </Banner>
      )}

      <div className="space-y-6">
        <Card padding="standard" className="text-ui text-ink-muted">
          <Link href={CHAT_URL} className={cn(linkVariants(), 'font-medium')}>
            {unreadTexts === 0
              ? 'Open Chat'
              : unreadTexts === 1
                ? 'One unread text in Chat'
                : `${unreadTexts} unread texts in Chat`}
          </Link>
          {unreadTexts === 0
            ? '. Your mentors text you there, about something of yours that changed.'
            : held
              ? `. Your mentors hold off until you read some: they stop at ${UNREAD_MAX}.`
              : ' from your mentors.'}
        </Card>

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

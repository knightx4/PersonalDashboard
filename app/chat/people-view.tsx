import { ListPage } from '@/components/patterns/list-detail';
import { RowLink } from '@/components/shell/back-link';
import { PageHeader } from '@/components/shell/page-header';
import { PageColumn } from '@/components/shell/page-width';
import { EmptyState } from '@/components/ui/empty-state';
import { cn } from '@/lib/cn';
import { whenAgo } from '@/lib/core/when';
import type { Mentor } from '@/lib/you/council-model';
import { MentorMark } from '@/app/you/council/mentor-mark';

/** Where a mentor's thread is until the People tab has threads of its own. */
export function mentorHref(mentor: Pick<Mentor, 'key'>): string {
  return `/you/council/mentors/${mentor.key}`;
}

/** The line under a mentor's name: them writing, their newest note, or the question they own. */
export function mentorPreview(mentor: Mentor): string {
  if (mentor.waiting) return 'Writing back to you…';
  if (mentor.note) return mentor.note.text;
  return mentor.canTalk ? mentor.question : 'Not ready to talk yet.';
}

/**
 * Chat's People tab (plan #2748.1): every mentor on the council, newest note
 * first, as a messaging app lists its threads. A row opens the mentor's page
 * on the Council, which is where their thread is until the People tab step
 * (#2748.6) draws threads here.
 */
export function PeopleView({
  mentors,
  failed = false,
  timezone,
  now,
}: {
  mentors: readonly Mentor[];
  failed?: boolean;
  timezone: string;
  now: number;
}) {
  const header = <PageHeader title="People" />;
  if (failed) {
    return (
      <PageColumn>
        {header}
        <p className="text-ui text-danger">Your mentors could not be read. Reload to try again.</p>
      </PageColumn>
    );
  }
  if (mentors.length === 0) {
    return (
      <PageColumn>
        {header}
        <EmptyState
          title="No mentors yet"
          description="Put mentors on your council and each one gets a thread here."
          action={{ label: 'Open the Council', href: '/you/council' }}
        />
      </PageColumn>
    );
  }
  const sorted = [...mentors].sort((a, b) => (b.note?.createdAt ?? '').localeCompare(a.note?.createdAt ?? ''));
  const unread = mentors.filter((m) => m.note && !m.note.readAt).length;
  return (
    <ListPage
      // The line between threads starts at the text, as a messaging app
      // draws it, so the avatars stand in one column with nothing under them.
      className="[&_ul]:divide-y-0"
      header={header}
      foot={`${mentors.length} ${mentors.length === 1 ? 'mentor' : 'mentors'}${unread > 0 ? `, ${unread} unread` : ''}`}
    >
      {sorted.map((mentor) => {
        const isUnread = Boolean(mentor.note && !mentor.note.readAt);
        return (
          <li
            key={mentor.id}
            className="relative [&+li]:before:absolute [&+li]:before:inset-x-0 [&+li]:before:top-0 [&+li]:before:ml-[calc(var(--card-p)+3.75rem)] [&+li]:before:border-t [&+li]:before:border-border [&+li]:before:content-['']"
          >
            <RowLink
              href={mentorHref(mentor)}
              className="card-pad-x row-pad flex min-h-11 items-center gap-3 hover:bg-sunken"
            >
              <MentorMark mentorKey={mentor.key} name={mentor.name} kind={mentor.kind} size="lg" />
              <span className="min-w-0 flex-1">
                <span className="flex items-baseline gap-2">
                  <span className={cn('min-w-0 flex-1 truncate text-ui text-ink', isUnread ? 'font-semibold' : 'font-medium')}>
                    {mentor.name}
                  </span>
                  {mentor.note && (
                    <span className="tabular shrink-0 text-small text-ink-muted">
                      {whenAgo(mentor.note.createdAt, { timeZone: timezone, now })}
                    </span>
                  )}
                </span>
                <span className="flex items-start gap-2">
                  <span
                    className={cn(
                      'line-clamp-2 min-w-0 flex-1 text-small',
                      mentor.waiting ? 'text-accent' : isUnread ? 'text-ink' : 'text-ink-muted',
                    )}
                  >
                    {mentorPreview(mentor)}
                  </span>
                  {isUnread && <span className="mt-1.5 size-2 shrink-0 rounded-pill bg-accent" aria-label="Unread" role="img" />}
                </span>
              </span>
            </RowLink>
          </li>
        );
      })}
    </ListPage>
  );
}

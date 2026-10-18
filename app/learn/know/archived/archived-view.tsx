import { Archive } from 'lucide-react';
import { RowLink } from '@/components/shell/back-link';
import { PageHeader } from '@/components/shell/page-header';
import { PageColumn } from '@/components/shell/page-width';
import { ListPage } from '@/components/patterns/list-detail';
import { EmptyState } from '@/components/ui/empty-state';
import { sectionSubject } from '@/lib/core/section-path';
import { whenDate } from '@/lib/core/when';
import type { ArchivedSubject } from '@/lib/learn/archive';
import { RestoreSubject } from '@/app/learn/s/[id]/archive';
import type { ArchiveState } from '@/app/learn/s/[id]/actions';

/**
 * The Archived list (plan #2355.2), reached from the Subjects list: every
 * archived subject, the most recently archived first, each with a Restore
 * press. The name opens the subject's page, which still opens while it is
 * archived. The page and the gallery both draw this, so it takes the rows and
 * reads nothing itself.
 */
export function ArchivedView({
  subjects,
  timezone,
  now,
  shown,
}: {
  subjects: readonly ArchivedSubject[];
  timezone: string;
  now: number;
  /** For the gallery: a Restore press that came back with an error, by subject id. */
  shown?: ReadonlyMap<string, ArchiveState>;
}) {
  const header = (
    <PageHeader
      subject={sectionSubject('/learn/know', 'Subjects', { label: 'Archived', href: '/learn/know/archived' })}
      title="Archived subjects"
    />
  );

  if (subjects.length === 0) {
    return (
      <PageColumn>
        {header}
        <EmptyState
          icon={Archive}
          title="Nothing archived"
          description="Archive a subject from its page to set it aside: it leaves Now, the Subjects list and Dash’s hourly work. Restoring it puts it back with its lessons and progress."
          action={{ label: 'Back to Subjects', href: '/learn/know' }}
        />
      </PageColumn>
    );
  }

  const count = `${subjects.length} archived ${subjects.length === 1 ? 'subject' : 'subjects'}`;
  return (
    <ListPage header={header} foot={count}>
      {subjects.map((subject) => (
        <li key={subject.id} className="card-pad-x flex flex-wrap items-center gap-x-3 hover:bg-sunken">
          {/* The row opens the subject; Restore sits beside the link rather
              than inside it, and a failed restore says so on a line of its
              own under the row. */}
          <RowLink href={`/learn/s/${subject.id}`} className="row-pad flex min-h-11 min-w-0 flex-1 flex-col justify-center">
            <span className="block truncate text-ui text-ink">{subject.name}</span>
            <span className="block truncate text-small text-ink-muted">
              Archived on {whenDate(subject.archivedAt, { timeZone: timezone, year: 'auto', now })}
            </span>
          </RowLink>
          <RestoreSubject subjectId={subject.id} size="sm" initial={shown?.get(subject.id)} errorLine />
        </li>
      ))}
    </ListPage>
  );
}

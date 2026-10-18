import { PageHeader } from '@/components/shell/page-header';
import { PageColumn } from '@/components/shell/page-width';
import { ReadingPageSkeleton } from '@/components/ui/skeleton';
import type { ArchivedSubject } from '@/lib/learn/archive';
import { SubjectsHeader } from '@/app/learn/know/subjects-header';
import { ArchivedView } from '@/app/learn/know/archived/archived-view';
import { ArchivedBanner, ArchiveSubject } from '@/app/learn/s/[id]/archive';
import { deleteSubject } from '@/app/learn/s/[id]/actions';
import { ConfirmStep } from '@/components/ui/confirm-step';
import { SubjectPresses, subjectDescription } from '@/app/learn/s/[id]/header';

/**
 * Archiving a Learn subject and restoring it (plan #2355.2): the Subjects
 * list's Archived link, an archived subject's banner, and the Archived list
 * with its empty, loading and error states.
 */

const NOW = new Date('2026-10-18T09:30:00Z').getTime();
const ZONE = 'Europe/London';

const ARCHIVED: ArchivedSubject[] = [
  {
    id: 'a1',
    name: 'Urban economics and the economics of housing supply in growing cities',
    note: null,
    archivedAt: '2026-10-17T18:04:00Z',
  },
  { id: 'a2', name: 'Bayesian statistics', note: null, archivedAt: '2026-09-02T08:00:00Z' },
  { id: 'a3', name: 'Mandarin', note: 'For the trip that did not happen.', archivedAt: '2025-12-11T12:00:00Z' },
];

const NO_CLAIMS = { unknown: 0, shaky: 0, recognised: 0, known: 0, sharp: 0, misconception: 0, total: 0 };

export function LearnSubjectsHeaderPreview() {
  return (
    <PageColumn>
      <SubjectsHeader making={false} />
    </PageColumn>
  );
}

/** A subject page's header as the page draws it: the presses, then Archive and Delete together. */
function SubjectHeader({ archived }: { archived: boolean }) {
  return (
    <PageHeader
      title="Urban economics and the economics of housing supply"
      description={subjectDescription({ tested: 12, inferred: 9, declared: 0, total: 46 }, NO_CLAIMS)}
      actions={
        <>
          <SubjectPresses id="s1" lensId="l1" owner />
          <div className="flex items-start gap-1">
            {!archived && <ArchiveSubject subjectId="s1" />}
            <ConfirmStep
              action={deleteSubject}
              fields={{ subjectId: 's1' }}
              prompt="Deletes this subject and its curriculum."
              confirmLabel="Yes, delete it"
              pendingLabel="Deleting…"
            >
              Delete subject
            </ConfirmStep>
          </div>
        </>
      }
    />
  );
}

/** The top of a live subject's page, with Archive beside Delete subject. */
export function LearnSubjectHeaderPreview() {
  return <SubjectHeader archived={false} />;
}

/** The top of an archived subject's page: the header with no Archive press, then the banner. */
export function LearnSubjectArchivedPreview() {
  return (
    <>
      <SubjectHeader archived />
      <ArchivedBanner subjectId="s1" archivedOn="17 Oct" />
    </>
  );
}

export function LearnArchivedPreview() {
  return <ArchivedView subjects={ARCHIVED} timezone={ZONE} now={NOW} />;
}

export function LearnArchivedEmptyPreview() {
  return <ArchivedView subjects={[]} timezone={ZONE} now={NOW} />;
}

/** Learn's shared loading skeleton, which the Archived list shows as the Subjects list does. */
export function LearnArchivedLoadingPreview() {
  return <ReadingPageSkeleton />;
}

/** A Restore press whose write failed, with the message under it. */
export function LearnArchivedErrorPreview() {
  return (
    <ArchivedView
      subjects={ARCHIVED}
      timezone={ZONE}
      now={NOW}
      shown={new Map([['a2', { error: 'Restoring failed: the connection was reset. Try again.' }]])}
    />
  );
}

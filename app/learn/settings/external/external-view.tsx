import Link from '@/components/ui/link';
import { PageHeader } from '@/components/shell/page-header';
import { PageColumn } from '@/components/shell/page-width';
import { buttonVariants } from '@/components/ui/button';
import { cardVariants } from '@/components/ui/card';
import { cn } from '@/lib/cn';
import { sectionSubject } from '@/lib/core/section-path';
import { scoreLine, type ExternalCheckListItem } from '@/lib/learn/external/model';
import { NewSetForm } from './new-set-form';

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/** "15 Oct 2026": a score is kept with its date, so the date is never relative. */
export function externalDate(iso: string): string {
  const at = new Date(iso);
  return `${at.getUTCDate()} ${MONTHS[at.getUTCMonth()]} ${at.getUTCFullYear()}`;
}

function standing(check: ExternalCheckListItem): string {
  if (check.scored && check.correctCount !== null) {
    return `Score ${scoreLine(check.correctCount, check.total)}`;
  }
  return `${check.answered} of ${check.total} answered`;
}

/**
 * External check (plan #2179.4): the published sets sat so far with their
 * scores, newest first. A set is answered once and its score is the anchor
 * lens progress is compared against later. The paste form opens from the
 * header's action (`?new=1`), and stands open when no set has been sat.
 */
export function ExternalChecksView({
  checks,
  showForm = false,
}: {
  checks: ExternalCheckListItem[];
  showForm?: boolean;
}) {
  const open = showForm || checks.length === 0;

  return (
    <PageColumn>
      <PageHeader
        subject={sectionSubject('/learn/settings', 'Learn settings', {
          label: 'External check',
          href: '/learn/settings/external',
        })}
        title="External check"
        actions={
          open ? null : (
            <Link
              href="/learn/settings/external?new=1"
              className={buttonVariants({ variant: 'secondary' })}
            >
              Sit another set
            </Link>
          )
        }
      />

      <div className="max-w-2xl">
        {checks.length > 0 && (
          <>
            <ul className={cn(cardVariants(), 'mt-6 divide-y divide-border overflow-hidden')}>
              {checks.map((check) => (
                <li key={check.id}>
                  <Link
                    href={`/learn/settings/external/${check.id}`}
                    className="flex flex-wrap items-baseline gap-x-2.5 gap-y-0.5 px-4 py-3 transition-colors hover:bg-sunken"
                  >
                    <span className="min-w-0 flex-1 truncate text-ui text-ink">{check.name}</span>
                    <span className="shrink-0 text-small tabular-nums text-ink-muted">{standing(check)}</span>
                    <span className="basis-full text-small text-ink-ghost">
                      {check.scored ? `Scored ${externalDate(check.on)}` : `Started ${externalDate(check.on)}`}
                    </span>
                  </Link>
                </li>
              ))}
            </ul>
            <p className="mt-3 text-small text-ink-muted">
              {checks.length} {checks.length === 1 ? 'set' : 'sets'}
            </p>
          </>
        )}

        {open && <NewSetForm first={checks.length === 0} />}
      </div>
    </PageColumn>
  );
}

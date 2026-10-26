import { PageHeader } from '@/components/shell/page-header';
import { PageColumn } from '@/components/shell/page-width';
import Link from '@/components/ui/link';
import { EmptyState } from '@/components/ui/empty-state';
import { SectionHeading } from '@/components/ui/section-heading';
import { APPLIED_STATUSES, TO_APPLY_STATUSES, type FollowUp } from '@/lib/jobs/followup/load';
import { FollowUpCard } from './follow-up-card';

/**
 * The Follow-ups page: applications waiting on a first reply, then roles
 * still to apply for, each as its follow-up card.
 */
export function FollowUpsView({ followUps, timezone }: { followUps: FollowUp[]; timezone: string }) {
  const toApply = followUps.filter((f) => (TO_APPLY_STATUSES as readonly string[]).includes(f.status));
  // Notes still to send first, then the ones with nobody named, then the sent.
  const applied = followUps
    .filter((f) => (APPLIED_STATUSES as readonly string[]).includes(f.status))
    .sort((a, b) => order(a) - order(b) || (b.submittedAt ?? '').localeCompare(a.submittedAt ?? ''));

  return (
    <PageColumn>
      <PageHeader
        title="Follow-ups"
        description="Who to tell about each application, and the note to send them."
      />
      {followUps.length === 0 ? (
        <EmptyState
          title="No applications to follow up yet"
          description="Roles you save or apply for show up here, each with the person to tell and a note to them."
          action={{ label: 'Find roles', href: '/jobs/find' }}
        />
      ) : (
        <div className="space-y-8">
          <Group title="Applied" items={applied} timezone={timezone} empty="Nothing applied for and waiting on a reply." />
          <Group title="To apply" items={toApply} timezone={timezone} empty="No roles waiting to be applied for." />
        </div>
      )}
    </PageColumn>
  );
}

function order(f: FollowUp): number {
  if (f.draft) return 0;
  if (!f.person) return 1;
  return 2;
}

function Group({ title, items, timezone, empty }: { title: string; items: FollowUp[]; timezone: string; empty: string }) {
  return (
    <section className="space-y-3">
      <SectionHeading title={title} count={items.length > 0 ? String(items.length) : undefined} />
      {items.length === 0 ? (
        <EmptyState size="inline" title={empty} />
      ) : (
        <div className="space-y-3">
          {items.map((f) => (
            <FollowUpCard
              key={f.applicationId}
              initial={f}
              timezone={timezone}
              heading={
                <Link href={`/jobs/roles/${f.roleId}`} className="press-area text-ink">
                  {f.role} at {f.company}
                </Link>
              }
            />
          ))}
        </div>
      )}
    </section>
  );
}

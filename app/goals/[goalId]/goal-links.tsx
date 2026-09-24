'use client';

import Link from 'next/link';
import { useActionState, useState } from 'react';
import { ActionMenu } from '@/components/ui/action-menu';
import { AddTrigger } from '@/components/ui/add-trigger';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Select } from '@/components/ui/field';
import { useToast } from '@/components/ui/toast';
import { aimProgressLine, jobWeekLine, type GoalLinks } from '@/lib/goals/links';
import {
  linkAimAction,
  linkJobSearchAction,
  unlinkAction,
  type LinkActionState,
} from './link-actions';

const initial: LinkActionState = {};

/**
 * What a goal holds from Learn and the job search (plan #931): each linked
 * Learn goal with its progress, and the job search with this week's
 * applications and interviews. The counts are read from those modules when
 * the page loads; nothing here is logged twice.
 */
export function GoalLinksSection({
  goalId,
  links,
  aimChoices,
  jobsOn,
}: {
  goalId: string;
  /** Null when the links could not be read. */
  links: GoalLinks | null;
  /** Learn goals not yet linked; null when Learn is off or could not be read. */
  aimChoices: { id: string; name: string }[] | null;
  jobsOn: boolean;
}) {
  const [adding, setAdding] = useState(false);

  if (!links) {
    return (
      <p className="px-1 text-small text-ink-muted">
        The links to Learn and the job search could not be read. Reload to try again.
      </p>
    );
  }

  const canLinkSearch = jobsOn && !links.jobSearch;
  const canLinkAim = (aimChoices?.length ?? 0) > 0;
  const empty = links.aims.length === 0 && !links.jobSearch && links.jobs.length === 0;

  if (empty && !adding) {
    if (!canLinkAim && !canLinkSearch) return null;
    return (
      <AddTrigger
        label={canLinkSearch ? 'Link a Learn goal or the job search' : 'Link a Learn goal'}
        onClick={() => setAdding(true)}
      />
    );
  }

  return (
    <section aria-labelledby="links-heading" className="space-y-2">
      <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1 px-1">
        <h2 id="links-heading" className="text-ui font-semibold text-ink">
          Linked
        </h2>
        <span className="text-small text-ink-muted">Progress read from Learn and Jobs</span>
      </div>
      <Card>
        <ul aria-label="Linked from other modules" className="divide-y divide-border">
          {links.aims.map((aim) => (
            <LinkRow
              key={aim.linkId}
              linkId={aim.linkId}
              title={aim.name ?? 'A Learn goal'}
              href={aim.name ? '/learn/goals' : null}
              line={aimProgressLine(aim)}
              what="Learn goal"
            />
          ))}
          {links.jobSearch && (
            <LinkRow
              linkId={links.jobSearch.linkId}
              title="Job search"
              href="/jobs/today"
              line={links.jobSearch.week ? jobWeekLine(links.jobSearch.week) : ''}
              what="job search"
            />
          )}
          {links.jobs.map((job) => (
            <LinkRow
              key={job.linkId}
              linkId={job.linkId}
              title={
                job.title
                  ? `${job.title}${job.company ? ` at ${job.company}` : ''}`
                  : job.kind === 'role'
                    ? 'A role'
                    : 'An application'
              }
              href={job.roleId ? `/jobs/roles/${job.roleId}` : null}
              line={job.title ? (job.status ?? 'Role') : 'No longer in the job search'}
              what={job.kind}
            />
          ))}
        </ul>
        {(canLinkAim || canLinkSearch) && (
          <AddLinks
            goalId={goalId}
            aimChoices={canLinkAim ? (aimChoices ?? []) : []}
            canLinkSearch={canLinkSearch}
          />
        )}
      </Card>
    </section>
  );
}

function LinkRow({
  linkId,
  title,
  href,
  line,
  what,
}: {
  linkId: string;
  title: string;
  href: string | null;
  line: string;
  what: string;
}) {
  const toast = useToast();
  const unlink = async (form: FormData) => {
    const result = await unlinkAction(form);
    if (result.error) toast({ text: result.error });
  };
  return (
    <li className="flex items-center gap-3 px-3 py-2">
      <div className="min-w-0 flex-1">
        {href ? (
          <Link href={href} className="text-ui text-ink hover:text-accent">
            {title}
          </Link>
        ) : (
          <span className="text-ui text-ink">{title}</span>
        )}
        {line && <p className="tabular text-small text-ink-muted">{line}</p>}
      </div>
      <ActionMenu
        label={`${title} actions`}
        items={[
          {
            id: 'unlink',
            label: `Unlink this ${what}`,
            formAction: unlink,
            formFields: { id: linkId },
          },
        ]}
      />
    </li>
  );
}

function AddLinks({
  goalId,
  aimChoices,
  canLinkSearch,
}: {
  goalId: string;
  aimChoices: { id: string; name: string }[];
  canLinkSearch: boolean;
}) {
  const toast = useToast();
  const [state, linkAim, linking] = useActionState(linkAimAction, initial);
  const linkSearch = async (form: FormData) => {
    const result = await linkJobSearchAction(form);
    if (result.error) toast({ text: result.error });
  };
  return (
    <div className="flex flex-wrap items-center gap-2 border-t border-border px-3 py-2 first:border-t-0">
      {aimChoices.length > 0 && (
        <form action={linkAim} key={state.done ?? 0} className="flex flex-wrap items-center gap-2">
          <input type="hidden" name="goalId" value={goalId} />
          <Select name="aimId" required defaultValue="" aria-label="A Learn goal to link" className="w-56">
            <option value="" disabled>
              A Learn goal…
            </option>
            {aimChoices.map((aim) => (
              <option key={aim.id} value={aim.id}>
                {aim.name}
              </option>
            ))}
          </Select>
          <Button type="submit" size="sm" variant="secondary" disabled={linking}>
            {linking ? 'Linking…' : 'Link'}
          </Button>
        </form>
      )}
      {canLinkSearch && (
        <form action={linkSearch} className="ml-auto">
          <input type="hidden" name="goalId" value={goalId} />
          <Button type="submit" size="sm" variant="ghost">
            Link the job search
          </Button>
        </form>
      )}
      {state.error && <p className="w-full text-small text-danger">{state.error}</p>}
    </div>
  );
}

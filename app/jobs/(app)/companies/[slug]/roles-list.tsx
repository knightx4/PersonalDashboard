'use client';

import { useState, useTransition } from 'react';
import { newRoleHref } from './new-role-href';
import Link from 'next/link';
import { Briefcase, GitMerge } from 'lucide-react';
import { StatusPicker } from '@/components/jobs/ui/status-picker';
import { Button } from '@/components/ui/button';
import { EmptyState } from '@/components/ui/empty-state';
import { FieldError, Label, Select } from '@/components/ui/field';
import { formatDate } from '@/lib/jobs/applications/load';
import type { ApplicationStatus } from '@/lib/jobs/pipeline';
import { mergeRoles } from '../actions';

export interface CompanyRoleRow {
  id: string;
  title: string;
  location: string | null;
  firstSeenAt: string;
  applications: Array<{
    id: string;
    attempt: number;
    status: ApplicationStatus;
    submittedAt: string | null;
    outcome: string | null;
  }>;
}

/**
 * The same role posted twice — a placeholder the linker made before it
 * learned the recruiter's domain, or two confirmation emails that never
 * matched — shows up here as two rows to fold into one. Selection is opt-in:
 * nothing about a normal visit to this page changes.
 */
export function RolesList({
  companyId,
  companyName,
  roles,
  timezone,
}: {
  companyId: string;
  /** Carried into the new-role form so it opens with this company filled in. */
  companyName: string;
  roles: CompanyRoleRow[];
  timezone: string;
}) {
  const [picking, setPicking] = useState(false);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [survivorId, setSurvivorId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  if (roles.length === 0) {
    // Already inside the section's card, so the placeholder border comes off.
    return (
      <EmptyState
        icon={Briefcase}
        title="No roles saved at this company yet"
        description="A role you add here is what the inbox links its mail to."
        action={{ label: 'Add a role', href: newRoleHref(companyName) }}
        className="border-0 py-8"
      />
    );
  }

  function toggle(roleId: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(roleId)) next.delete(roleId);
      else next.add(roleId);
      if (!next.has(survivorId ?? '')) setSurvivorId(next.size > 0 ? [...next][0]! : null);
      return next;
    });
  }

  function cancel() {
    setPicking(false);
    setSelected(new Set());
    setSurvivorId(null);
    setError(null);
  }

  function merge() {
    if (!survivorId || selected.size < 2) return;
    setError(null);
    startTransition(async () => {
      const result = await mergeRoles({
        companyId,
        survivorRoleId: survivorId,
        mergedRoleIds: [...selected].filter((id) => id !== survivorId),
      });
      if (result.error) setError(result.error);
      else cancel();
    });
  }

  return (
    <div>
      <div className="mb-2 flex items-center justify-between gap-2">
        <p className="text-small text-ink-muted">
          {picking
            ? 'Pick the roles that are really the same posting, then which one to keep.'
            : null}
        </p>
        {roles.length > 1 && (
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={() => (picking ? cancel() : setPicking(true))}
            className="ml-auto shrink-0"
          >
            <GitMerge className="size-3.5" strokeWidth={1.75} aria-hidden />
            {picking ? 'Cancel' : 'Merge roles'}
          </Button>
        )}
      </div>

      <ul className="divide-y divide-border">
        {roles.map((role) => (
          <li key={role.id} className="row-pad flex flex-wrap items-center gap-2">
            {picking && (
              <input
                type="checkbox"
                checked={selected.has(role.id)}
                onChange={() => toggle(role.id)}
                aria-label={`Select ${role.title} to merge`}
                className="size-4 shrink-0"
              />
            )}
            <Link
              href={`/jobs/roles/${role.id}`}
              className="flex-1 text-ui font-medium text-ink transition-colors duration-150 hover:text-accent"
            >
              {role.title}
            </Link>
            {role.location && <span className="text-small text-ink-muted">{role.location}</span>}
            {role.applications.map((application) => (
              <span key={application.id} className="flex items-center gap-1.5">
                <StatusPicker
                  applicationId={application.id}
                  status={application.status}
                  submittedAt={application.submittedAt}
                />
                <span className="tabular text-small text-ink-muted">
                  {application.attempt > 1 && `#${application.attempt} `}
                  {formatDate(application.submittedAt, timezone)}
                </span>
              </span>
            ))}
          </li>
        ))}
      </ul>

      {picking && selected.size >= 2 && (
        // The bar that appears once two roles are ticked. A ground rather than
        // a frame: it is inside the section's card, where a border would be the
        // card's edge said a second time, and the well is what makes it read as
        // something that arrived rather than something that was always there.
        <div className="mt-3 flex flex-wrap items-center gap-2 rounded-card bg-canvas p-2.5">
          <Label className="mb-0" htmlFor="merge-survivor">
            Keep
          </Label>
          <Select
            id="merge-survivor"
            value={survivorId ?? ''}
            onChange={(event) => setSurvivorId(event.target.value)}
            // Width to the content; height off the dial, like the button beside it.
            className="w-auto"
          >
            {[...selected].map((id) => {
              const role = roles.find((r) => r.id === id);
              if (!role) return null;
              return (
                <option key={id} value={id}>
                  {role.title} — first seen {formatDate(role.firstSeenAt, timezone)}
                </option>
              );
            })}
          </Select>
          <span className="text-small text-ink-muted">
            {selected.size - 1} other{selected.size - 1 === 1 ? '' : 's'} fold into it as one
            application.
          </span>
          <Button type="button" size="sm" pending={pending} onClick={merge} className="ml-auto">
            {pending ? 'Merging…' : `Merge ${selected.size} roles`}
          </Button>
        </div>
      )}

      <FieldError>{error}</FieldError>
    </div>
  );
}

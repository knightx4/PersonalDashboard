'use client';

import { useRef, useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { GitMerge } from 'lucide-react';
import { Button, buttonVariants } from '@/components/ui/button';
import { FieldError, Label, Select } from '@/components/ui/field';
import { Popover } from '@/components/ui/popover';
import { usePopover } from '@/lib/use-popover';
import type { SameCompanyReason } from '@/lib/jobs/companies/same-company';
import { mergeCompanies } from '../actions';

export interface MergeCandidate {
  id: string;
  name: string;
  /** Why it looks like this company, when it does. */
  likely: SameCompanyReason | null;
}

const REASON: Record<SameCompanyReason, string> = {
  board: 'same job board',
  domain: 'same domain',
  name: 'same name',
};

/**
 * Fold another company into this one.
 *
 * For the same employer recorded twice, as Heron and Heron Data were. This
 * page's company is the one kept, so its name, URL and anything already filled
 * in stay; the other's roles, contacts, notes and to-dos move here, its empty
 * fields fill this one's gaps, and its page goes. Companies that look like
 * this one are listed first.
 *
 * A plain button carrying the button's look rather than `Button`, because the
 * popover needs a ref on the trigger to hand focus back to it on close.
 */
export function MergeCompany({
  companyId,
  name,
  candidates,
}: {
  companyId: string;
  name: string;
  candidates: MergeCandidate[];
}) {
  const likely = candidates.filter((candidate) => candidate.likely);
  const rest = candidates.filter((candidate) => !candidate.likely);
  const [open, setOpen] = useState(false);
  const [mergeId, setMergeId] = useState(likely[0]?.id ?? '');
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const router = useRouter();
  const panelRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  usePopover({ open, onClose: () => setOpen(false), panelRef, triggerRef });

  if (candidates.length === 0) return null;

  const chosen = candidates.find((candidate) => candidate.id === mergeId) ?? null;

  const merge = () => {
    if (!chosen) return;
    setError(null);
    startTransition(async () => {
      const result = await mergeCompanies({ keepId: companyId, mergeId: chosen.id });
      if (result.error) {
        setError(result.error);
        return;
      }
      setOpen(false);
      setMergeId('');
      if (result.slug) router.replace(`/jobs/companies/${result.slug}`);
      router.refresh();
    });
  };

  return (
    <div className="relative">
      <button
        ref={triggerRef}
        type="button"
        aria-expanded={open}
        aria-haspopup="dialog"
        onClick={() => setOpen((o) => !o)}
        className={buttonVariants({ variant: 'ghost', size: 'sm' })}
      >
        <GitMerge className="size-3.5" strokeWidth={1.75} aria-hidden />
        Merge
        {likely.length > 0 && (
          <span className="tabular text-small text-ink-muted">{likely.length}</span>
        )}
      </button>
      {open && (
        <Popover
          ref={panelRef}
          role="dialog"
          aria-label={`Merge another company into ${name}`}
          padding="panel"
          className="space-y-3 sm:w-80"
        >
          <div>
            <Label htmlFor="merge-company">Fold into {name}</Label>
            <Select
              id="merge-company"
              value={mergeId}
              onChange={(event) => setMergeId(event.target.value)}
              className="max-sm:min-h-11"
            >
              <option value="" disabled>
                Pick a company
              </option>
              {likely.length > 0 && (
                <optgroup label="Looks like the same company">
                  {likely.map((candidate) => (
                    <option key={candidate.id} value={candidate.id}>
                      {candidate.name} ({REASON[candidate.likely!]})
                    </option>
                  ))}
                </optgroup>
              )}
              <optgroup label={likely.length > 0 ? 'Everything else' : 'Your companies'}>
                {rest.map((candidate) => (
                  <option key={candidate.id} value={candidate.id}>
                    {candidate.name}
                  </option>
                ))}
              </optgroup>
            </Select>
          </div>
          {chosen && (
            <p className="text-small text-ink-muted">
              {chosen.name}&rsquo;s roles, contacts, notes and to-dos move to {name}, and its page
              goes. {name} keeps its name; anything it has blank is filled from {chosen.name}.
            </p>
          )}
          <Button type="button" pending={pending} disabled={!chosen} onClick={merge} className="w-full">
            {pending ? 'Merging…' : chosen ? `Merge ${chosen.name} into ${name}` : 'Merge'}
          </Button>
          <FieldError>{error}</FieldError>
        </Popover>
      )}
    </div>
  );
}

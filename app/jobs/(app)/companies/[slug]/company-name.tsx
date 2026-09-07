'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { Pencil } from 'lucide-react';
import { FieldError } from '@/components/ui/field';
import { renameCompany } from '../actions';

/**
 * The company's name, overridable.
 *
 * Names arrive from an ATS board or from the signature block of an email, so
 * "Galaxy Digital Holdings LP" and "galaxy" are both things this page has been
 * called, and neither is what you would write yourself.
 *
 * Renaming moves the slug, and the slug is the URL, so this navigates to the
 * new one on success rather than leaving the page sitting on an address that
 * no longer resolves. Not optimistic for the same reason: the name a clash
 * refuses is one this page must never claim to have taken.
 */
export function CompanyName({ companyId, name }: { companyId: string; name: string }) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(name);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const router = useRouter();

  if (!editing) {
    return (
      <button
        type="button"
        onClick={() => {
          setDraft(name);
          setError(null);
          setEditing(true);
        }}
        className="group inline-flex items-center gap-1.5 text-left"
        title="Edit the company name"
      >
        {name}
        <Pencil
          className="size-3.5 shrink-0 text-ink-muted opacity-0 transition-opacity duration-150 group-hover:opacity-100"
          strokeWidth={1.75}
          aria-hidden
        />
      </button>
    );
  }

  const save = () => {
    const next = draft.trim();
    if (!next || next === name) {
      setEditing(false);
      return;
    }
    setError(null);
    startTransition(async () => {
      const result = await renameCompany(companyId, next);
      if (result.error) {
        setError(result.error);
        return;
      }
      setEditing(false);
      if (result.slug) router.replace(`/jobs/companies/${result.slug}`);
    });
  };

  return (
    <span className="inline-flex flex-wrap items-center gap-2">
      <input
        autoFocus
        value={draft}
        disabled={pending}
        onChange={(event) => setDraft(event.target.value)}
        onBlur={save}
        onKeyDown={(event) => {
          if (event.key === 'Enter') {
            event.preventDefault();
            save();
          }
          if (event.key === 'Escape') {
            event.preventDefault();
            setEditing(false);
          }
        }}
        // A control, so its border is the 3:1 token; the size matches the page title it stands in for.
        className="rounded-lg border border-control bg-surface px-2 py-1 font-display text-title font-semibold tracking-tight text-ink focus:border-accent focus:outline-none focus:ring-2 focus:ring-accent/25 disabled:opacity-50"
      />
      <FieldError>{error}</FieldError>
    </span>
  );
}

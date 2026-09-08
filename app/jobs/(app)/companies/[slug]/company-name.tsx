'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { Pencil } from 'lucide-react';
import { FieldError, InlineInput } from '@/components/ui/field';
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
      {/* The title is the field. This drew its own bordered box at the title's
        * size, which is the shape law 12 exists to get rid of -- a form about
        * the name, standing where the name was. `InlineInput` is the same
        * input without the box: it arrives focused, so it wears the accent
        * ring the moment it appears, and leaving it commits.
        *
        * The size has to be named at both breakpoints because the primitive
        * sets `text-base sm:text-ui` -- 16px on a phone is what stops Safari
        * zooming the page on focus, and a title-sized field is already past
        * that, so the exception does not apply here and the `sm:` half has to
        * be overridden or the heading shrinks to interface size on a laptop. */}
      <InlineInput
        autoFocus
        value={draft}
        disabled={pending}
        aria-label="Company name"
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
        className="w-auto font-display text-title font-semibold tracking-tight sm:text-title"
      />
      <FieldError>{error}</FieldError>
    </span>
  );
}

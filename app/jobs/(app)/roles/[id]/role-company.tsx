'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useState, useTransition } from 'react';
import { Pencil } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/field';
import { moveRoleToCompany } from './actions';

/**
 * The company a role belongs to, correctable in place.
 *
 * Mail is attributed by sender domain, and a shared ATS domain or a forwarded
 * thread files a pursuit under the wrong name often enough to need an answer
 * that is not "delete it and lose the timeline".
 */
export function RoleCompany({
  roleId,
  name,
  slug,
  companies,
}: {
  roleId: string;
  name: string;
  slug: string;
  companies: string[];
}) {
  const router = useRouter();
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(name);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  if (!editing) {
    return (
      <span className="inline-flex items-center gap-1.5">
        <Link
          href={`/jobs/companies/${slug}`}
          className="transition-colors duration-150 hover:text-accent"
        >
          {name}
        </Link>
        {/* The icon button's full hit target, pulled in with negative margins
            so a 32px box does not push the subtitle's line apart. */}
        <button
          type="button"
          onClick={() => {
            setDraft(name);
            setError(null);
            setEditing(true);
          }}
          title="Move this role to another company"
          className="press -my-2 flex size-8 items-center justify-center rounded-lg text-ink-muted transition-colors duration-150 hover:bg-sunken hover:text-ink"
        >
          <Pencil className="size-4 shrink-0" strokeWidth={1.75} aria-hidden />
          <span className="sr-only">Move this role to another company</span>
        </button>
      </span>
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
      const result = await moveRoleToCompany(roleId, next);
      if (result.error) {
        setError(result.error);
        return;
      }
      setEditing(false);
      router.refresh();
    });
  };

  return (
    <span className="inline-flex flex-wrap items-center gap-2">
      <Input
        autoFocus
        value={draft}
        disabled={pending}
        list="role-companies"
        aria-label="Company"
        onChange={(event) => setDraft(event.target.value)}
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
        // Width only. The height and the inset come off the density dial, so
        // this lines up with the two buttons beside it at every density -- it
        // was a hand-typed 32px, which is one density's answer written down as
        // if it were every density's.
        className="w-64"
      />
      <datalist id="role-companies">
        {companies.map((company) => (
          <option key={company} value={company} />
        ))}
      </datalist>
      <Button type="button" size="sm" variant="secondary" pending={pending} onClick={save}>
        {pending ? 'Moving…' : 'Move'}
      </Button>
      <Button
        type="button"
        size="sm"
        variant="ghost"
        disabled={pending}
        onClick={() => setEditing(false)}
      >
        Cancel
      </Button>
      {error && <span className="text-small text-danger">{error}</span>}
    </span>
  );
}

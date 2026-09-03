'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useState, useTransition } from 'react';
import { Pencil } from 'lucide-react';
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
        <Link href={`/jobs/companies/${slug}`} className="hover:text-accent">
          {name}
        </Link>
        <button
          type="button"
          onClick={() => {
            setDraft(name);
            setError(null);
            setEditing(true);
          }}
          title="Move this role to another company"
          aria-label="Move this role to another company"
        >
          <Pencil
            className="size-3 shrink-0 text-ink-muted hover:text-accent"
            strokeWidth={1.75}
            aria-hidden
          />
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
      <input
        autoFocus
        value={draft}
        disabled={pending}
        list="role-companies"
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
        className="rounded-lg border border-border bg-surface px-2 py-0.5 text-ui text-ink focus:border-accent focus:outline-none focus:ring-2 focus:ring-accent/20 disabled:opacity-50"
      />
      <datalist id="role-companies">
        {companies.map((company) => (
          <option key={company} value={company} />
        ))}
      </datalist>
      <button
        type="button"
        disabled={pending}
        onClick={save}
        className="text-small text-accent underline underline-offset-2 disabled:opacity-50"
      >
        {pending ? 'Moving…' : 'Move'}
      </button>
      <button
        type="button"
        disabled={pending}
        onClick={() => setEditing(false)}
        className="text-small text-ink-muted underline underline-offset-2 disabled:opacity-50"
      >
        Cancel
      </button>
      {error && <span className="text-small text-status-rejected">{error}</span>}
    </span>
  );
}

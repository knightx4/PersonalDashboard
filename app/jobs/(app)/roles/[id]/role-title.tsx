'use client';

import { useState, useTransition } from 'react';
import { Pencil } from 'lucide-react';
import { renameRole } from './actions';

/**
 * The inbox's guess at a role's name, overridable.
 *
 * A placeholder ("Role from email") or a mis-extracted title should not be
 * something you live with until the next email happens to correct it.
 */
export function RoleTitle({ roleId, title }: { roleId: string; title: string }) {
  const [editing, setEditing] = useState(false);
  const [shown, setShown] = useState(title);
  const [draft, setDraft] = useState(title);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  if (!editing) {
    return (
      <button
        type="button"
        onClick={() => {
          setDraft(shown);
          setEditing(true);
        }}
        className="group inline-flex items-center gap-1.5 text-left"
        title="Edit the role name"
      >
        {shown}
        <Pencil
          className="size-3.5 shrink-0 text-ink-faint opacity-0 transition-opacity duration-150 group-hover:opacity-100"
          strokeWidth={1.75}
          aria-hidden
        />
      </button>
    );
  }

  const save = () => {
    const next = draft.trim();
    if (!next || next === shown) {
      setEditing(false);
      return;
    }
    const previous = shown;
    setShown(next);
    setEditing(false);
    setError(null);
    startTransition(async () => {
      const result = await renameRole(roleId, next);
      if (result.error) {
        setShown(previous);
        setError(result.error);
      }
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
        className="rounded-lg border border-border bg-surface px-2 py-1 font-display text-xl font-semibold tracking-tight text-ink focus:border-brand focus:outline-none focus:ring-2 focus:ring-brand/20 disabled:opacity-50"
      />
      {error && <span className="text-[12px] font-normal text-status-rejected">{error}</span>}
    </span>
  );
}

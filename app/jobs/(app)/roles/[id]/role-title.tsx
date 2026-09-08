'use client';

import { useState, useTransition } from 'react';
import { Pencil } from 'lucide-react';
import { Input } from '@/components/ui/field';
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
          className="size-4 shrink-0 text-ink-muted opacity-0 transition-opacity duration-150 group-hover:opacity-100"
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
      {/* This input *is* the page title while it is open, so it keeps the
          heading's face and size rather than the control's 13px. */}
      <Input
        autoFocus
        value={draft}
        disabled={pending}
        aria-label="Role name"
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
        className="font-display h-auto w-auto py-1 text-title font-semibold tracking-tight sm:text-title"
      />
      {error && <span className="text-small font-normal text-danger">{error}</span>}
    </span>
  );
}

'use client';

import { Plus } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useState, useTransition } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/field';
import { addCompany } from './actions';

/**
 * Add a company, on the Companies tab (note 8554f9d8). The tab used to offer
 * Add a role here, which only makes a company as a side effect of a posting.
 * The press opens one line for the name; Add makes the company, or finds the
 * one already on the list, and opens its page.
 */
export function AddCompany({ variant = 'primary' }: { variant?: 'primary' | 'secondary' }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [name, setName] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  if (!open) {
    return (
      <Button type="button" variant={variant} size="sm" onClick={() => setOpen(true)}>
        <Plus className="size-4" strokeWidth={1.75} aria-hidden />
        Add a company
      </Button>
    );
  }

  function submit(event: React.FormEvent) {
    event.preventDefault();
    setError(null);
    startTransition(async () => {
      const result = await addCompany({ name });
      if (result.error || !result.slug) {
        setError(result.error ?? 'Could not add the company.');
        return;
      }
      router.push(`/jobs/companies/${result.slug}`);
    });
  }

  return (
    <form onSubmit={submit} className="flex flex-wrap items-center gap-2">
      <Input
        autoFocus
        aria-label="Company name"
        placeholder="Company name"
        value={name}
        onChange={(event) => setName(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === 'Escape') setOpen(false);
        }}
        aria-invalid={error ? true : undefined}
        className="w-48"
      />
      <Button type="submit" size="sm" pending={pending} disabled={!name.trim()}>
        Add
      </Button>
      <Button type="button" variant="ghost" size="sm" disabled={pending} onClick={() => setOpen(false)}>
        Cancel
      </Button>
      {error && (
        <p role="alert" className="w-full text-small text-danger">
          {error}
        </p>
      )}
    </form>
  );
}

'use client';

import { useActionState } from 'react';
import { useRouter } from 'next/navigation';
import { Button } from '@/components/ui/button';
import { cardVariants } from '@/components/ui/card';
import { ComposeBody, ComposeTitle, FieldError, PressLabel } from '@/components/ui/field';
import { cn } from '@/lib/cn';
import { newVaultNote, type NewNoteState } from '@/app/vault/actions';

/**
 * New note, opened from the vault page's header (note 09ff8039): a compose
 * surface with the name large and the note under it, whatever is natural to
 * write. It goes into the vault's Inbox and opens there; Cancel goes back to
 * the list.
 */
export function NewVaultNote() {
  const router = useRouter();
  const [state, action, pending] = useActionState<NewNoteState, FormData>(newVaultNote, { error: null });

  return (
    <form action={action} className={cn(cardVariants(), 'mb-5 space-y-3 p-4')}>
      <div className="relative">
        <PressLabel htmlFor="vault-new-note-title" />
        <ComposeTitle
          id="vault-new-note-title"
          name="title"
          placeholder="Name it"
          aria-label="Note name"
          autoFocus
          maxLength={60}
          className="relative"
        />
      </div>
      <ComposeBody name="body" placeholder="Write the note" aria-label="Note" className="min-h-24" />
      <FieldError>{state.error}</FieldError>
      <p className="text-small text-ink-muted">Goes into your Inbox folder.</p>
      <div className="flex items-center justify-end gap-2">
        <Button type="button" variant="ghost" size="sm" onClick={() => router.push('/vault')} disabled={pending}>
          Cancel
        </Button>
        <Button type="submit" size="sm" pending={pending}>
          {pending ? 'Adding…' : 'Add to vault'}
        </Button>
      </div>
    </form>
  );
}

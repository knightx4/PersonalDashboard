'use client';

import { useActionState } from 'react';
import { Button } from '@/components/ui/button';
import { FieldError, Label, Textarea } from '@/components/ui/field';
import type { VaultRules } from '@/lib/vault/map/rules';
import { savePrivateFolders, type VaultActionState } from './actions';

/**
 * The folders whose notes never go to a model (migrations-vault 0041): the
 * journals, and anything else left out. One folder per line, as a path from
 * the top of the vault.
 */
export function PrivateFoldersForm({ rules }: { rules: VaultRules }) {
  const [state, action, pending] = useActionState<VaultActionState, FormData>(savePrivateFolders, {});

  return (
    <form action={action} className="space-y-4">
      <div>
        <Label htmlFor="journal_folders">Journal folders</Label>
        <Textarea
          id="journal_folders"
          name="journal_folders"
          rows={3}
          defaultValue={rules.journalFolders.join('\n')}
          placeholder="Journal"
        />
        <p className="mt-1 text-ui text-ink-muted">
          One folder per line. Their notes are never sent to a model, except to the personality
          read, which compares what you wrote about yourself.
        </p>
      </div>
      <div>
        <Label htmlFor="excluded_folders">Left out entirely</Label>
        <Textarea
          id="excluded_folders"
          name="excluded_folders"
          rows={3}
          defaultValue={rules.excludedFolders.join('\n')}
          placeholder="Work/Applications"
        />
        <p className="mt-1 text-ui text-ink-muted">
          Notes here are never sent to a model at all.
        </p>
      </div>
      {state.error && <FieldError>{state.error}</FieldError>}
      {state.message && <p className="text-ui text-ink-muted">{state.message}</p>}
      <Button type="submit" pending={pending}>
        {pending ? 'Saving…' : 'Save folders'}
      </Button>
    </form>
  );
}

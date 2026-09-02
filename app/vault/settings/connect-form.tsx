'use client';

import { useActionState } from 'react';
import { Button } from '@/components/ui/button';
import { Input, Label, FieldError } from '@/components/ui/field';
import { connectVault, type VaultActionState } from './actions';

/**
 * The one form in this workspace.
 *
 * It doubles as the reconnect form, because the fields are the same and an
 * expired token is the common case rather than an exceptional one: a
 * fine-grained PAT has a maximum life of a year, so everyone who connects a
 * vault will eventually be back here.
 */
export function ConnectVaultForm({
  defaults,
  submitLabel,
}: {
  defaults?: { repo?: string; branch?: string; subpath?: string };
  submitLabel: string;
}) {
  const [state, action, pending] = useActionState<VaultActionState, FormData>(connectVault, {});

  return (
    <form action={action} className="space-y-4">
      <div>
        <Label htmlFor="repo">Repository</Label>
        <Input
          id="repo"
          name="repo"
          required
          defaultValue={defaults?.repo ?? ''}
          placeholder="owner/my-vault"
          autoComplete="off"
        />
        <p className="mt-1 text-[13px] text-ink-muted">
          A full GitHub URL works too. The repository can stay private.
        </p>
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <div>
          <Label htmlFor="branch">Branch</Label>
          <Input
            id="branch"
            name="branch"
            defaultValue={defaults?.branch ?? 'main'}
            autoComplete="off"
          />
        </div>
        <div>
          <Label htmlFor="subpath">Folder (optional)</Label>
          <Input
            id="subpath"
            name="subpath"
            defaultValue={defaults?.subpath ?? ''}
            placeholder="notes"
            autoComplete="off"
          />
          <p className="mt-1 text-[13px] text-ink-muted">
            Only if the vault is a subfolder of the repository.
          </p>
        </div>
      </div>

      <div>
        <Label htmlFor="token">Fine-grained access token</Label>
        <Input
          id="token"
          name="token"
          type="password"
          required
          placeholder="github_pat_…"
          autoComplete="off"
        />
        <p className="mt-1 text-[13px] text-ink-muted">
          Needs <strong>Contents: Read-only</strong> on this one repository, and nothing else. It
          is encrypted before it is stored and never sent back to your browser.
        </p>
      </div>

      {state.error && <FieldError>{state.error}</FieldError>}
      {state.message && <p className="text-[13px] text-positive">{state.message}</p>}

      <Button type="submit" disabled={pending}>
        {pending ? 'Saving…' : submitLabel}
      </Button>
    </form>
  );
}

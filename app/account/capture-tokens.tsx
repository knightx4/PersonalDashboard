'use client';

import { useActionState, useState } from 'react';
import { Check, Copy } from 'lucide-react';
import { Banner } from '@/components/ui/banner';
import { Button } from '@/components/ui/button';
import { ConfirmStep } from '@/components/ui/confirm-step';
import { FieldError, Input, Label } from '@/components/ui/field';
import { Segmented } from '@/components/ui/segmented';
import { CAPTURE_TOKEN_LABEL_MAX } from '@/lib/capture/token-label';
import type { CaptureTokenListing, DashTokenKind } from '@/lib/capture/tokens';
import {
  makeCaptureTokenAction,
  revokeCaptureTokenAction,
  type MakeTokenState,
} from './capture-token-actions';
import { whenDay } from '@/lib/core/when';

/**
 * Personal tokens (plan #1705): what lets a Siri Shortcut or another tool add
 * things to the app, or ask Dash a question, without signing in. The list is
 * read on the server (lib/capture/tokens.ts); a token is shown here once,
 * right after it is made, and only its hash is kept.
 */

const KINDS: { value: DashTokenKind; label: string }[] = [
  { value: 'capture', label: 'Adds only' },
  { value: 'ask', label: 'Asks Dash' },
];
export function CaptureTokensSection({
  tokens,
  failed,
  timezone,
  justMade,
}: {
  tokens: CaptureTokenListing[];
  /** The list could not be read; what the section says instead. */
  failed: string | null;
  timezone: string;
  /** The gallery's: a token as it shows straight after it is made. */
  justMade?: { label: string; token: string; kind?: DashTokenKind };
}) {
  // The name box opens only when asked for, and closes once the token is made,
  // so the token just shown sits directly above its own row.
  const [making, setMaking] = useState(false);
  const [kind, setKind] = useState<DashTokenKind>('capture');
  const [state, action, pending] = useActionState<MakeTokenState, FormData>(
    async (prev, formData) => {
      const next = await makeCaptureTokenAction(prev, formData);
      if (next.made) setMaking(false);
      return next;
    },
    justMade ? { made: justMade } : {},
  );
  // The day alone: a token's history is read by the day, and the time would
  // wrap each row's line to two at 390.
  const when = (at: string) => whenDay(at, { timeZone: timezone });

  return (
    <section>
      <div className="flex items-start justify-between gap-3">
        <h3 className="text-ui font-semibold text-ink">Tokens</h3>
        {!making && (
          <Button type="button" size="sm" variant="secondary" onClick={() => setMaking(true)}>
            Make a token
          </Button>
        )}
      </div>
      <p className="mt-0.5 text-ui text-ink-muted">
        A token lets a Siri Shortcut or another tool use Dash without signing in. A token that adds
        only can never read anything. A token that asks Dash can read whatever Dash can, so keep it
        to your own phone. You can revoke either here at any time.
      </p>

      {making && (
        <form action={action} className="mt-4 flex flex-wrap items-end gap-2">
          <input type="hidden" name="kind" value={kind} />
          <div className="w-full">
            <Segmented label="What the token may do" value={kind} options={KINDS} onChange={setKind} disabled={pending} />
          </div>
          <div className="min-w-48 flex-1">
            <Label htmlFor="capture-token-label">Name it for the phone or tool that will use it</Label>
            <Input
              id="capture-token-label"
              name="label"
              maxLength={CAPTURE_TOKEN_LABEL_MAX}
              required
              autoFocus
            />
          </div>
          <div className="flex gap-2">
            <Button type="button" variant="ghost" onClick={() => setMaking(false)} disabled={pending}>
              Cancel
            </Button>
            <Button type="submit" pending={pending}>
              {pending ? 'Making…' : 'Make it'}
            </Button>
          </div>
        </form>
      )}
      <FieldError>{state.error}</FieldError>

      {state.made && <MadeToken made={state.made} />}

      {failed ? (
        <p role="alert" className="mt-3 text-ui text-danger">
          {failed}
        </p>
      ) : tokens.length === 0 ? (
        <div className="mt-4 border-y border-border">
          <p className="row-pad text-small leading-snug text-ink-muted">
            No tokens yet. Make one for each phone or tool, so you can revoke one without the
            others.
          </p>
        </div>
      ) : (
        <ul className="mt-4 divide-y divide-border border-y border-border">
          {tokens.map((token) => (
            <TokenRow key={token.id} token={token} when={when} />
          ))}
        </ul>
      )}
    </section>
  );
}

/** The token just made, with its one chance to be copied. */
function MadeToken({ made }: { made: { label: string; token: string; kind?: DashTokenKind } }) {
  const [copied, setCopied] = useState(false);
  return (
    <div className="mt-4 space-y-2">
      <Banner tone="info">
        Copy the token for {made.label} now. Dash keeps only a scrambled form of it and cannot
        show it again.
      </Banner>
      <div className="flex flex-wrap items-center gap-2">
        <code className="min-w-0 flex-1 rounded-control bg-sunken px-3 py-2 font-mono text-small text-ink select-all [overflow-wrap:anywhere]">
          {made.token}
        </code>
        <Button
          type="button"
          size="sm"
          variant="secondary"
          onClick={() => {
            navigator.clipboard.writeText(made.token).then(
              () => {
                setCopied(true);
                setTimeout(() => setCopied(false), 1800);
              },
              () => setCopied(false),
            );
          }}
        >
          {copied ? (
            <Check className="size-4" strokeWidth={1.75} aria-hidden />
          ) : (
            <Copy className="size-4" strokeWidth={1.75} aria-hidden />
          )}
          {copied ? 'Copied' : 'Copy'}
        </Button>
      </div>
    </div>
  );
}

function TokenRow({ token, when }: { token: CaptureTokenListing; when: (at: string) => string }) {
  const used = token.lastUsedAt ? `last used ${when(token.lastUsedAt)}` : 'never used';
  const may = token.kind === 'ask' ? 'Asks Dash' : 'Adds only';
  return (
    <li className="row-pad flex items-start justify-between gap-3">
      <span className="min-w-0 flex-1">
        <span className={token.revokedAt ? 'block text-ui text-ink-muted' : 'block text-ui font-medium text-ink'}>
          {token.label}
        </span>
        <span className="block text-small text-ink-muted">
          {may} · made {when(token.createdAt)} · {used}
          {token.revokedAt && ` · revoked ${when(token.revokedAt)}`}
        </span>
      </span>
      {!token.revokedAt && (
        <ConfirmStep
          variant="secondary"
          prompt={`Anything using ${token.label} stops being able to ${token.kind === 'ask' ? 'ask Dash' : 'add to Dash'} at once. This cannot be undone.`}
          confirmLabel="Yes, revoke"
          pendingLabel="Revoking…"
          action={revokeCaptureTokenAction}
          fields={{ id: token.id }}
        >
          Revoke
        </ConfirmStep>
      )}
    </li>
  );
}

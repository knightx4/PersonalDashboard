import { Banner } from '@/components/ui/banner';
import { ValueList, ValueRow } from '@/components/ui/value-row';
import { decideConnection } from './actions';
import { DecisionButtons } from './decision-buttons';

/**
 * What the consent page draws, apart from the page so the surface gallery can
 * draw it without a request to Supabase's OAuth server.
 */

/** An app asking to connect: who it is, where it sends you back, and the answer. */
export function ConsentRequest({
  name,
  redirectUri,
  email,
  authorizationId,
  failed,
}: {
  name: string;
  redirectUri: string;
  email: string | undefined;
  authorizationId: string;
  failed: boolean;
}) {
  return (
    <>
      <h1 className="font-display text-title tracking-tight text-ink">Connect {name}?</h1>
      <p className="mt-1 mb-4 text-body text-ink-muted">
        {name} is asking to read your dashboard. It will be able to look things up the same way Dash
        does when you ask it a question. It cannot change anything. Every lookup it makes is listed
        under Connected apps on your account page, where you can remove it.
      </p>

      {failed && (
        <Banner tone="warn" className="mb-4">
          That did not go through. Try again, or start the connection again from {name}.
        </Banner>
      )}

      <ValueList className="mb-5">
        <ValueRow label="App" value={name} />
        <ValueRow label="Sends you back to" value={redirectUri} />
        <ValueRow label="Signed in as" value={email} />
      </ValueList>

      <form action={decideConnection} className="flex gap-2">
        <input type="hidden" name="authorization_id" value={authorizationId} />
        <DecisionButtons />
      </form>
    </>
  );
}


export function Notice({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <>
      <h1 className="font-display text-title tracking-tight text-ink">{title}</h1>
      <p className="mt-1 text-body text-ink-muted">{children}</p>
    </>
  );
}

export function Refused({ name, address }: { name?: string; address?: string }) {
  return (
    <Notice title="This app cannot connect">
      Only Claude can connect to your dashboard, and this request would send your access to{' '}
      {address ? (
        <span className="[overflow-wrap:anywhere] text-ink">{address}</span>
      ) : (
        'another address'
      )}
      {name ? ` (${name})` : ''}. Nothing has been shared.
    </Notice>
  );
}

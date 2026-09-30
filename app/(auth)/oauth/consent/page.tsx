import { redirect } from 'next/navigation';
import { Banner } from '@/components/ui/banner';
import { ValueList, ValueRow } from '@/components/ui/value-row';
import { createClient, requireUser } from '@/lib/auth/server';
import { isAllowedConnectorRedirect, isAllowedConnectorReturn } from '@/lib/connector/redirect';
import { decideConnection } from './actions';
import { DecisionButtons } from './decision-buttons';

export const metadata = { title: 'Connect an app' };

/**
 * Where Supabase's OAuth server sends the browser when an app such as Claude
 * asks to connect: the Authorization Path set for the project is
 * /oauth/consent, so this page must stay at exactly that address.
 *
 * It sits behind sign-in like every other page. A signed-out visit goes to
 * /login with the whole address, query included, as ?next= (see
 * signInRedirect in lib/paths.ts), so it comes back here with its request.
 */
export default async function ConsentPage({
  searchParams,
}: {
  searchParams: Promise<{ authorization_id?: string; failed?: string }>;
}) {
  await requireUser();
  const { authorization_id: id, failed } = await searchParams;

  if (!id) {
    return (
      <Notice title="Nothing to connect">
        This address is missing the request it should carry. Start the connection again from the app
        you were adding.
      </Notice>
    );
  }

  const supabase = await createClient();
  const { data, error } = await supabase.auth.oauth.getAuthorizationDetails(id);

  if (error || !data) {
    return (
      <Notice title="This request has ended">
        It has expired or has already been answered. Start the connection again from the app you
        were adding.
      </Notice>
    );
  }

  // Allowed before: Supabase answers with the address to go back to at once.
  if (!('authorization_id' in data)) {
    if (isAllowedConnectorReturn(data.redirect_url)) redirect(data.redirect_url);
    return <Refused />;
  }

  if (!isAllowedConnectorRedirect(data.redirect_uri)) {
    return <Refused name={data.client.name} address={data.redirect_uri} />;
  }

  const name = data.client.name || 'An app';

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
        <ValueRow label="Sends you back to" value={data.redirect_uri} />
        <ValueRow label="Signed in as" value={data.user.email} />
      </ValueList>

      <form action={decideConnection} className="flex gap-2">
        <input type="hidden" name="authorization_id" value={data.authorization_id} />
        <DecisionButtons />
      </form>
    </>
  );
}

function Notice({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <>
      <h1 className="font-display text-title tracking-tight text-ink">{title}</h1>
      <p className="mt-1 text-body text-ink-muted">{children}</p>
    </>
  );
}

function Refused({ name, address }: { name?: string; address?: string }) {
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

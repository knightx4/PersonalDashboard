import { redirect } from 'next/navigation';
import { createClient, requireUser } from '@/lib/auth/server';
import { isAllowedConnectorRedirect, isAllowedConnectorReturn } from '@/lib/connector/redirect';
import { ConsentRequest, Notice, Refused } from './consent-view';

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

  return (
    <ConsentRequest
      name={data.client.name || 'An app'}
      redirectUri={data.redirect_uri}
      email={data.user.email}
      authorizationId={data.authorization_id}
      failed={Boolean(failed)}
    />
  );
}

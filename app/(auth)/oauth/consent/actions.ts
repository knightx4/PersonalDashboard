'use server';

import { redirect } from 'next/navigation';
import { createClient, requireUser } from '@/lib/auth/server';
import { isAllowedConnectorRedirect, isAllowedConnectorReturn } from '@/lib/connector/redirect';

/**
 * Allow or refuse a connection request from the consent page.
 *
 * The page hides the buttons for a client whose redirect address is not
 * Claude's connector callback, but a form can be posted without the page, so
 * the check is made again here against what Supabase says the request is,
 * never against anything the form carries beyond the request's id.
 */
// latency: pending
export async function decideConnection(formData: FormData): Promise<void> {
  await requireUser();

  const id = formData.get('authorization_id');
  const decision = formData.get('decision');
  if (typeof id !== 'string' || !id || (decision !== 'allow' && decision !== 'refuse')) {
    redirect('/oauth/consent');
  }

  const page = `/oauth/consent?authorization_id=${encodeURIComponent(id)}`;
  const supabase = await createClient();

  const details = await supabase.auth.oauth.getAuthorizationDetails(id);
  if (details.error || !details.data) redirect(`${page}&failed=1`);

  if (!('authorization_id' in details.data)) {
    // Already allowed earlier: Supabase has the address to go back to.
    const back = details.data.redirect_url;
    redirect(isAllowedConnectorReturn(back) ? back : page);
  }

  const allowedClient = isAllowedConnectorRedirect(details.data.redirect_uri);
  if (!allowedClient) {
    // Answer the request so it cannot be approved later, and stay here. The
    // client's own address is exactly where this page will not send anyone.
    await supabase.auth.oauth.denyAuthorization(id, { skipBrowserRedirect: true });
    redirect(page);
  }

  const result =
    decision === 'allow'
      ? await supabase.auth.oauth.approveAuthorization(id, { skipBrowserRedirect: true })
      : await supabase.auth.oauth.denyAuthorization(id, { skipBrowserRedirect: true });

  const back = result.data?.redirect_url;
  if (result.error || !isAllowedConnectorReturn(back)) redirect(`${page}&failed=1`);
  redirect(back);
}

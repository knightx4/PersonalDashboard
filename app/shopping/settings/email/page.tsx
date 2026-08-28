import { redirect } from 'next/navigation';

/** Dashboard still links here; canonical inbox UI lives on /shopping/settings#inboxes. */
export default function SettingsEmailRedirect() {
  redirect('/shopping/settings#inboxes');
}

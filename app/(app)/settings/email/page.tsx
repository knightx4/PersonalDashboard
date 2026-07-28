import { redirect } from 'next/navigation';

/** Dashboard still links here; canonical inbox UI lives on /settings#inboxes. */
export default function SettingsEmailRedirect() {
  redirect('/settings#inboxes');
}

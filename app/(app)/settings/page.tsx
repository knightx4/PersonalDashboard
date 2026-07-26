import { Mail, ShieldCheck, Tags, User } from 'lucide-react';
import { createClient, requireUser } from '@/lib/auth/server';
import { PageHeader } from '@/components/shell/page-header';
import { Card, CardBody, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { signOut } from '@/app/(auth)/actions';

export const metadata = { title: 'Settings' };

export default async function SettingsPage() {
  const user = await requireUser();
  const supabase = await createClient();

  const { data: profile } = await supabase
    .from('profiles')
    .select('display_name, timezone')
    .eq('id', user.id)
    .single();

  const { data: accounts } = await supabase
    .from('email_accounts')
    .select('id, email_address, status, last_synced_at')
    .eq('user_id', user.id);

  return (
    <div className="mx-auto max-w-3xl">
      <PageHeader title="Settings" />

      <div className="space-y-4">
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <User className="size-4 text-ink-muted" strokeWidth={1.75} />
              Profile
            </CardTitle>
          </CardHeader>
          <CardBody className="space-y-1 text-sm text-ink-muted">
            <p>{profile?.display_name ?? '—'}</p>
            <p>{user.email}</p>
            {/* Period boundaries use this, so "this month" means their month. */}
            <p>Timezone: {profile?.timezone ?? 'UTC'}</p>
          </CardBody>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Mail className="size-4 text-ink-muted" strokeWidth={1.75} />
              Connected inboxes
            </CardTitle>
          </CardHeader>
          <CardBody>
            {accounts && accounts.length > 0 ? (
              <ul className="space-y-2 text-sm">
                {accounts.map((account) => (
                  <li key={account.id} className="flex items-center justify-between">
                    <span className="text-ink">{account.email_address}</span>
                    <span className="text-ink-muted">{account.status}</span>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="text-sm text-ink-muted">
                No inbox connected. The app works without one — you can add orders by hand.
                Connecting Gmail arrives with build step 10.
              </p>
            )}
          </CardBody>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Tags className="size-4 text-ink-muted" strokeWidth={1.75} />
              Categories
            </CardTitle>
          </CardHeader>
          <CardBody>
            <p className="text-sm text-ink-muted">
              Built-in categories are shared and read-only. Your own categories live alongside
              them.
            </p>
          </CardBody>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <ShieldCheck className="size-4 text-ink-muted" strokeWidth={1.75} />
              Your data
            </CardTitle>
          </CardHeader>
          <CardBody className="space-y-3">
            <p className="text-sm text-ink-muted">
              We never store the contents of your email. Deleting your account revokes our
              access to your inbox and removes every row we hold. Arrives with build step 15.
            </p>
            <form action={signOut}>
              <Button variant="secondary" size="sm" type="submit">
                Sign out
              </Button>
            </form>
          </CardBody>
        </Card>
      </div>
    </div>
  );
}

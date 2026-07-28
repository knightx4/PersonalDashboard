import Link from 'next/link';
import { AlertCircle, Mail, RefreshCw } from 'lucide-react';
import { Button, buttonVariants } from '@/components/ui/button';
import { cn } from '@/lib/cn';
import { isGmailOAuthConfigured } from '@/lib/email/gmail-env';
import { disconnectInbox } from './actions';

type Account = {
  id: string;
  email_address: string;
  status: string;
  last_synced_at: string | null;
};

const STATUS_LABEL: Record<string, string> = {
  active: 'Connected',
  needs_reauth: 'Needs reconnection',
  disconnected: 'Disconnected',
  error: 'Error',
};

function inboxBanner(code: string | undefined): { tone: 'ok' | 'warn' | 'err'; text: string } | null {
  switch (code) {
    case 'connected':
      return {
        tone: 'ok',
        text: 'Gmail connected. Order import starts once backfill is wired (build step 12).',
      };
    case 'denied':
      return { tone: 'warn', text: 'Google access was not granted. Your inbox was not connected.' };
    case 'no_refresh':
      return {
        tone: 'warn',
        text: 'Google did not issue a refresh token. Disconnect in Google account settings, then connect again.',
      };
    case 'unconfigured':
      return {
        tone: 'err',
        text: 'Gmail OAuth is not configured on this deployment yet.',
      };
    case 'error':
      return { tone: 'err', text: 'Something went wrong connecting Gmail. Try again.' };
    default:
      return null;
  }
}

export function InboxSection({
  accounts,
  bannerCode,
}: {
  accounts: Account[];
  bannerCode?: string;
}) {
  const configured = isGmailOAuthConfigured();
  const banner = inboxBanner(bannerCode);

  return (
    <section id="inboxes" className="scroll-mt-6">
      {banner && (
        <p
          className={cn(
            'mb-3 rounded-lg border px-3 py-2 text-sm',
            banner.tone === 'ok' && 'border-emerald-200 bg-emerald-50 text-emerald-900',
            banner.tone === 'warn' && 'border-amber-200 bg-amber-50 text-amber-950',
            banner.tone === 'err' && 'border-red-200 bg-red-50 text-red-900',
          )}
        >
          {banner.text}
        </p>
      )}

      {accounts.length > 0 ? (
        <ul className="space-y-3">
          {accounts.map((account) => (
            <li
              key={account.id}
              className="flex flex-col gap-3 rounded-lg border border-border bg-canvas px-3 py-3 sm:flex-row sm:items-center sm:justify-between"
            >
              <div className="min-w-0">
                <p className="truncate text-sm font-medium text-ink">{account.email_address}</p>
                <p className="text-xs text-ink-muted">
                  {STATUS_LABEL[account.status] ?? account.status}
                  {account.last_synced_at
                    ? ` · Last synced ${new Date(account.last_synced_at).toLocaleDateString()}`
                    : ' · Not synced yet'}
                </p>
              </div>
              <div className="flex shrink-0 flex-wrap gap-2">
                {account.status === 'needs_reauth' && configured && (
                  <Link
                    href="/api/auth/gmail/connect"
                    className={buttonVariants({ variant: 'secondary', size: 'sm' })}
                  >
                    <RefreshCw className="size-3.5" strokeWidth={1.75} />
                    Reconnect
                  </Link>
                )}
                <form action={disconnectInbox}>
                  <input type="hidden" name="id" value={account.id} />
                  <Button variant="ghost" size="sm" type="submit">
                    Disconnect
                  </Button>
                </form>
              </div>
            </li>
          ))}
        </ul>
      ) : (
        <div className="space-y-3 text-sm text-ink-muted">
          <p>
            No inbox connected. The app works without one — you can add orders by hand. Connect Gmail
            to import order confirmations automatically (sync arrives in build step 12).
          </p>
          {configured ? (
            <Link href="/api/auth/gmail/connect" className={buttonVariants({ variant: 'primary', size: 'sm' })}>
              <Mail className="size-4" strokeWidth={1.75} />
              Connect Gmail
            </Link>
          ) : (
            <p className="flex items-start gap-2 text-amber-900">
              <AlertCircle className="mt-0.5 size-4 shrink-0" strokeWidth={1.75} />
              Gmail OAuth credentials are not set on this server. Add GOOGLE_GMAIL_CLIENT_ID and
              GOOGLE_GMAIL_CLIENT_SECRET to the environment.
            </p>
          )}
        </div>
      )}

      {accounts.length > 0 && configured && (
        <p className="mt-3 text-xs text-ink-faint">
          We request read-only Gmail access. Email bodies are never stored — only parsed order
          metadata after sync runs.
        </p>
      )}
    </section>
  );
}

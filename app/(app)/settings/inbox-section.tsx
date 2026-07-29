import Link from 'next/link';
import { AlertCircle, Mail, RefreshCw } from 'lucide-react';
import { Button, buttonVariants } from '@/components/ui/button';
import { cn } from '@/lib/cn';
import { isGmailOAuthConfigured } from '@/lib/email/gmail-env';
import { disconnectInbox } from './actions';
import { InboxSyncButton, type InboxSyncProgress } from './inbox-sync-button';

type Account = {
  id: string;
  email_address: string;
  status: string;
  last_synced_at: string | null;
  backfill_completed_at?: string | null;
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
        text: 'Gmail connected. Click Import orders from Gmail below to pull in confirmations.',
      };
    case 'denied':
      return { tone: 'warn', text: 'Google access was not granted. Your inbox was not connected.' };
    case 'no_refresh':
      return {
        tone: 'warn',
        text: 'Google did not issue a refresh token. Disconnect Shopping Manager under Google Account → Security → Third-party access, then connect again.',
      };
    case 'scope_denied':
      return {
        tone: 'warn',
        text: 'Gmail read access was not granted. Connect again and leave “See and download your email” checked on Google’s consent screen (do not uncheck it).',
      };
    case 'unconfigured':
      return {
        tone: 'err',
        text: 'Gmail OAuth is not configured on this deployment yet.',
      };
    case 'state':
      return {
        tone: 'err',
        text: 'The sign-in session expired during Google consent. Stay signed in and try Connect Gmail again.',
      };
    case 'exchange':
      return {
        tone: 'err',
        text: 'Google rejected the token exchange. Confirm the OAuth client redirect URI is exactly https://shopping.selveyknight.com/api/auth/gmail/callback',
      };
    case 'profile':
      return {
        tone: 'err',
        text: 'Connected to Google but could not read the Gmail address. Enable the Gmail API on the Google Cloud project, then try again.',
      };
    case 'db_write':
    case 'db_lookup':
      return {
        tone: 'err',
        text: 'Google connected, but saving the inbox failed. Try again; if it persists, check Supabase RLS on email_accounts.',
      };
    case 'encrypt':
      return {
        tone: 'err',
        text: 'Token encryption key is invalid on this server (must be 32 bytes, base64).',
      };
    case 'missing_code':
    case 'error':
      return { tone: 'err', text: 'Something went wrong connecting Gmail. Try again.' };
    default:
      return null;
  }
}

export function InboxSection({
  accounts,
  bannerCode,
  latestJobs = {},
}: {
  accounts: Account[];
  bannerCode?: string;
  latestJobs?: Record<string, InboxSyncProgress | null>;
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
              className="flex flex-col gap-3 rounded-lg border border-border bg-canvas px-3 py-3"
            >
              <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                <div className="min-w-0">
                  <p className="truncate text-sm font-medium text-ink">{account.email_address}</p>
                  <p className="text-xs text-ink-muted">
                    {STATUS_LABEL[account.status] ?? account.status}
                    {account.last_synced_at
                      ? ` · Last synced ${new Date(account.last_synced_at).toLocaleString()}`
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
              </div>
              {account.status === 'active' && (
                <InboxSyncButton
                  accountId={account.id}
                  initialJob={latestJobs[account.id] ?? null}
                  backfillCompleted={Boolean(account.backfill_completed_at)}
                />
              )}
            </li>
          ))}
        </ul>
      ) : (
        <div className="space-y-3 text-sm text-ink-muted">
          <p>
            No inbox connected. The app works without one — you can add orders by hand. Connect Gmail
            to import order confirmations.
          </p>
          {configured ? (
            <Link
              href="/api/auth/gmail/connect"
              className={buttonVariants({ variant: 'primary', size: 'sm' })}
            >
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
          metadata. For accurate product names and line items, set{' '}
          <code className="text-[11px]">ANTHROPIC_API_KEY</code> on Vercel (Haiku). Without it
          we still import totals from a simpler heuristic parser.
        </p>
      )}
    </section>
  );
}

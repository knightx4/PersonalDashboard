import Link from '@/components/ui/link';
import { AlertCircle, Mail } from 'lucide-react';
import { Banner } from '@/components/ui/banner';
import { buttonVariants } from '@/components/ui/button';
import { publicEnv } from '@/lib/env';
import { isGmailOAuthConfigured } from '@/lib/email/gmail-env';
import { InboxControls, type InboxSyncProgress } from './inbox-sync-button';
import { InboxPerson } from './inbox-person';
import type { Person } from '@/lib/people/load';

/** The day an inbox last synced, as the rest of the page writes dates: "7 Oct 2026". */
const SYNCED_DAY = new Intl.DateTimeFormat('en-GB', {
  day: 'numeric',
  month: 'short',
  year: 'numeric',
});

type Account = {
  id: string;
  email_address: string;
  status: string;
  last_synced_at: string | null;
  backfill_completed_at?: string | null;
  person_id?: string | null;
};

const CONNECT_HREF = '/api/auth/gmail/connect?return_to=%2Fsettings';

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
        text: 'Gmail connected. Import orders from each inbox below — you can connect more than one.',
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
        text:
          'Google rejected the token exchange. Confirm the OAuth client redirect URI ' +
          `is exactly ${publicEnv().NEXT_PUBLIC_APP_URL.replace(/\/$/, '')}/api/auth/gmail/callback`,
      };
    case 'profile':
      return {
        tone: 'err',
        text: 'Connected to Google but could not read the Gmail address. Enable the Gmail API on the Google Cloud project, then try again.',
      };
    case 'schema':
      return {
        tone: 'err',
        text: 'Google connected, but the inbox could not be saved: the database schema that stores it is not exposed by the API. In Supabase open Settings → API → Exposed schemas and include public, job_search and core.',
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
  people = [],
}: {
  accounts: Account[];
  bannerCode?: string;
  latestJobs?: Record<string, InboxSyncProgress | null>;
  people?: Person[];
}) {
  const configured = isGmailOAuthConfigured();
  const banner = inboxBanner(bannerCode);

  return (
    <section id="inboxes" className="scroll-mt-6">
      {banner && (
        <Banner
          className="mb-3"
          tone={banner.tone === 'ok' ? 'info' : banner.tone === 'warn' ? 'warn' : 'bad'}
        >
          {banner.text}
        </Banner>
      )}

      {accounts.length > 0 ? (
        <div className="space-y-3">
          {/* One inbox per row, divided rather than boxed: the Connected
              inboxes card is already the frame, and a ground per account
              inside it was a second one. Law 11. */}
          <ul className="divide-y divide-border">
            {accounts.map((account) => (
              <li key={account.id} className="row-pad">
                <InboxControls
                  accountId={account.id}
                  email={account.email_address}
                  status={account.status}
                  reconnectHref={
                    account.status === 'needs_reauth' && configured ? CONNECT_HREF : undefined
                  }
                  initialJob={latestJobs[account.id] ?? null}
                  backfillCompleted={Boolean(account.backfill_completed_at)}
                  heading={
                    <>
                      <p className="truncate text-body font-medium text-ink">
                        {account.email_address}
                      </p>
                      <p className="text-small text-ink-muted">
                        {STATUS_LABEL[account.status] ?? account.status}
                        {account.last_synced_at
                          ? ` · Synced ${SYNCED_DAY.format(new Date(account.last_synced_at))}`
                          : ' · Not synced yet'}
                      </p>
                    </>
                  }
                >
                  <InboxPerson
                    accountId={account.id}
                    people={people}
                    personId={account.person_id ?? null}
                  />
                </InboxControls>
              </li>
            ))}
          </ul>
          {configured && (
            <Link
              href={CONNECT_HREF}
              className={buttonVariants({ variant: 'secondary', size: 'sm' })}
            >
              <Mail className="size-4" strokeWidth={1.75} />
              Connect another Gmail
            </Link>
          )}
        </div>
      ) : (
        <div className="space-y-3 text-body text-ink-muted">
          <p>
            No inbox connected. The app works without one, and you can add orders by hand. Connect
            Gmail to import order confirmations from one or more inboxes: access is read-only, and
            only the order details are kept, never the email itself.
          </p>
          {configured ? (
            <Link
              href={CONNECT_HREF}
              className={buttonVariants({ variant: 'primary', size: 'sm' })}
            >
              <Mail className="size-4" strokeWidth={1.75} />
              Connect Gmail
            </Link>
          ) : (
            <p className="flex items-start gap-2 text-caution">
              <AlertCircle className="mt-0.5 size-4 shrink-0" strokeWidth={1.75} />
              Gmail OAuth credentials are not set on this server. Add GOOGLE_GMAIL_CLIENT_ID and
              GOOGLE_GMAIL_CLIENT_SECRET to the environment.
            </p>
          )}
        </div>
      )}

    </section>
  );
}

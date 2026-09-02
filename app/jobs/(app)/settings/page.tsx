import { createClient, requireUser } from '@/lib/jobs/auth/server';
import { createCoreClient } from '@/lib/core/auth/server';
import { PageHeader } from '@/components/jobs/shell/page-header';
import { isGmailOAuthConfigured } from '@/lib/email/gmail-env';
import { publicEnv } from '@/lib/env';
import { SettingsView } from './view';

export const metadata = { title: 'Settings' };

function inboxBanner(code: string | undefined): { tone: 'ok' | 'warn' | 'err'; text: string } | null {
  switch (code) {
    case 'connected':
      return { tone: 'ok', text: 'Gmail connected. Start the first scan below whenever you are ready.' };
    case 'denied':
      return { tone: 'warn', text: 'Google access was not granted.' };
    case 'scope_denied':
      return {
        tone: 'warn',
        text: 'Gmail read access was not granted. Connect again and leave “See and download your email” checked on Google’s screen.',
      };
    case 'schema':
      return {
        tone: 'err',
        text: 'Google connected, but the inbox could not be saved: the database schema that stores it is not exposed by the API. In Supabase open Settings → API → Exposed schemas and include public, job_search and core.',
      };
    case 'unconfigured':
      return { tone: 'err', text: 'Gmail OAuth is not configured on this deployment yet.' };
    case 'no_refresh':
      return {
        tone: 'err',
        text: 'Google did not return a refresh token. Remove the app under your Google account permissions, then connect again.',
      };
    default:
      return code ? { tone: 'err', text: 'Something went wrong connecting Gmail. Try again.' } : null;
  }
}

export default async function SettingsPage({
  searchParams,
}: {
  searchParams: Promise<{ inbox?: string }>;
}) {
  const user = await requireUser();
  const supabase = await createClient();
  const core = await createCoreClient();
  const params = await searchParams;

  const [{ data: profile }, { data: accounts }, { data: resumes }, { data: evidence }, { data: excludedSenders }] =
    await Promise.all([
      supabase
        .from('profiles')
        .select(
          'display_name, timezone, target_titles, search_started_on, ghost_threshold_days, writing_style_notes, banned_constructions',
        )
        .eq('id', user.id)
        .single(),
      core
        .from('email_accounts')
        .select(
          'id, email_address, status, last_synced_at, backfill_completed_at, backfill_window_days',
        )
        .eq('user_id', user.id)
        .order('created_at'),
      supabase
        .from('resume_versions')
        .select('id, label, is_default, notes, created_at, text_content')
        .eq('user_id', user.id)
        .order('created_at', { ascending: false }),
      supabase
        .from('evidence_items')
        .select('id, title, body, context, skills, metrics, strength, used_count')
        .eq('user_id', user.id)
        .order('strength', { ascending: false }),
      supabase
        .from('excluded_senders')
        .select('id, domain')
        .eq('user_id', user.id)
        .order('created_at', { ascending: false }),
    ]);

  // The last first-scan attempt per mailbox. Without it the page cannot tell a
  // scan that has never been run from one that stopped six times partway, and
  // it invited the user to "start" a scan they had already started.
  type BackfillRow = {
    email_account_id: string;
    status: string;
    messages_seen: number;
    error: string | null;
    finished_at: string | null;
  };

  const accountIds = (accounts ?? []).map((a) => a.id as string);
  const backfills: BackfillRow[] = accountIds.length
    ? (((
        await core
          .from('sync_jobs')
          .select('email_account_id, status, messages_seen, error, finished_at')
          .in('email_account_id', accountIds)
          .eq('type', 'backfill')
          .order('created_at', { ascending: false })
      ).data ?? []) as BackfillRow[])
    : [];

  const latestBackfill = new Map<string, BackfillRow>();
  for (const row of backfills) {
    if (!latestBackfill.has(row.email_account_id)) latestBackfill.set(row.email_account_id, row);
  }

  return (
    <div className="mx-auto max-w-3xl">
      <PageHeader title="Settings" description="Your profile, your inboxes, and your data." />
      <SettingsView
        email={user.email ?? ''}
        banner={inboxBanner(params.inbox)}
        gmailConfigured={isGmailOAuthConfigured()}
        appOrigin={publicEnv().NEXT_PUBLIC_APP_URL}
        profile={{
          displayName: (profile?.display_name as string) ?? '',
          timezone: (profile?.timezone as string) ?? 'UTC',
          targetTitles: ((profile?.target_titles as string[]) ?? []).join(', '),
          searchStartedOn: (profile?.search_started_on as string) ?? '',
          ghostThresholdDays: (profile?.ghost_threshold_days as number) ?? 30,
          writingStyleNotes: (profile?.writing_style_notes as string) ?? '',
          bannedConstructions: ((profile?.banned_constructions as string[]) ?? []).join('\n'),
        }}
        accounts={(accounts ?? []).map((account) => {
          const job = latestBackfill.get(account.id as string);
          return {
            id: account.id as string,
            emailAddress: account.email_address as string,
            status: account.status as string,
            lastSyncedAt: (account.last_synced_at as string) ?? null,
            backfillCompletedAt: (account.backfill_completed_at as string) ?? null,
            backfillWindowDays: account.backfill_window_days as number,
            latestBackfill: job
              ? {
                  status: job.status,
                  messagesSeen: job.messages_seen,
                  error: job.error,
                  finishedAt: job.finished_at,
                }
              : null,
          };
        })}
        excludedSenders={(excludedSenders ?? []).map((entry) => ({
          id: entry.id as string,
          domain: entry.domain as string,
        }))}
        resumes={(resumes ?? []).map((resume) => ({
          id: resume.id as string,
          label: resume.label as string,
          isDefault: resume.is_default as boolean,
          notes: (resume.notes as string) ?? null,
          // Whether it can be read, not the text: a resume is several kilobytes
          // and the client only needs to know the option is offerable.
          hasText: Boolean((resume.text_content as string | null)?.trim()),
        }))}
        evidence={(evidence ?? []).map((item) => ({
          id: item.id as string,
          title: item.title as string,
          body: item.body as string,
          context: (item.context as string) ?? null,
          skills: (item.skills as string[]) ?? [],
          metrics: (item.metrics as string) ?? null,
          strength: item.strength as number,
          usedCount: item.used_count as number,
        }))}
      />
    </div>
  );
}

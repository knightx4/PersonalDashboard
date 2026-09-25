import type { ModuleSources } from '@/lib/sources/types';

/**
 * The shared core tables, as Goals reads them (lib/sources/types.ts). None of
 * them is about the person's life; mail itself is read through the Gmail
 * connector, not from here. A new table in core goes in one of these two
 * lists, or the gate says so.
 */
export const coreSources: ModuleSources = {
  sources: [],
  notSources: [
    { table: 'core.account_settings', reason: 'Settings.' },
    { table: 'core.email_accounts', reason: 'Mailbox connections and their tokens.' },
    { table: 'core.ingested_messages', reason: 'Mail sync bookkeeping; the Gmail connector reads mail.' },
    { table: 'core.model_spend', reason: 'Model cost accounting.' },
    { table: 'core.people', reason: 'Who a shopping order was for.' },
    { table: 'core.saved_views', reason: 'Saved list filters.' },
    { table: 'core.sync_jobs', reason: 'Sync bookkeeping.' },
    { table: 'public.profiles', reason: 'Display name and settings.' },
  ],
};

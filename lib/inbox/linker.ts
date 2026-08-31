import 'server-only';

import type { SupabaseClient } from '@supabase/supabase-js';
import type { DomainLinker, LinkerCounters } from '@/lib/core/inbox/fan-out';
import { emptyLinkerCounters } from '@/lib/core/inbox/fan-out';
import { linkEnvelopes, reprocessPendingLifecycleMessages } from '@/lib/inbox/ingest-messages';
import { loadMerchantExclusions } from '@/lib/inbox/merchant-exclusions';
import { loadMerchantsForUser } from '@/lib/merchants/resolve-order-merchant';
import { loadCategoryContext } from '@/lib/inbox/context';

/**
 * The commerce workspace, as something the shared sync can hand mail to.
 *
 * Everything below the surface is the extraction this app has always done. What
 * changed is where the message comes from: core fetched the envelope once, for
 * both workspaces, so this no longer asks Gmail for metadata at all. It reads
 * the sender and subject it was given, decides whether the message is a
 * purchase, and only then spends an API call on the body.
 */
export function commerceLinker(supabase: SupabaseClient): DomainLinker {
  return {
    domain: 'commerce',

    /**
     * Lifecycle mail that arrived before its confirmation, looked at again --
     * which is how a shipping notice attaches to an order imported minutes
     * ago. Once per invocation rather than per page: it costs a body fetch per
     * message, and paying that for every six new messages is what made the
     * first scan crawl.
     */
    async sweep({ userId, accountId, accessToken, budgetMs }) {
      const [merchantRows, exclusions, categories] = await Promise.all([
        loadMerchantsForUser(supabase, userId),
        loadMerchantExclusions(supabase, userId),
        loadCategoryContext(supabase, userId),
      ]);

      await reprocessPendingLifecycleMessages(supabase, {
        userId,
        accountId,
        accessToken,
        merchants: merchantRows.map((m) => ({
          id: m.id,
          slug: m.slug,
          name: m.name,
          domains: m.domains,
        })),
        exclusions,
        categoryIdsBySlug: categories.categoryIdsBySlug,
        categoryOptions: categories.categoryOptions,
        counters: {
          messagesSeen: 0,
          messagesClassified: 0,
          messagesParsed: 0,
          ordersCreated: 0,
          skipped: 0,
          errors: 0,
        },
        budgetMs,
      });
    },

    async link({ userId, accountId, accessToken, envelopes }) {
      const counters = emptyLinkerCounters();
      counters.offered = envelopes.length;
      if (envelopes.length === 0) return counters;

      // Whose mailbox this is, resolved once for the batch. Every order
      // imported below inherits it, which is what makes shopping split by
      // person without anybody labelling a single order.
      const personId = await personForAccount(supabase, accountId);

      const [merchantRows, exclusions, categories] = await Promise.all([
        loadMerchantsForUser(supabase, userId),
        loadMerchantExclusions(supabase, userId),
        loadCategoryContext(supabase, userId),
      ]);

      const merchants = merchantRows.map((m) => ({
        id: m.id,
        slug: m.slug,
        name: m.name,
        domains: m.domains,
      }));

      const ingest = {
        messagesSeen: 0,
        messagesClassified: 0,
        messagesParsed: 0,
        ordersCreated: 0,
        skipped: 0,
        errors: 0,
      };

      await linkEnvelopes(supabase, {
        userId,
        accessToken,
        envelopes,
        merchants,
        exclusions,
        categoryIdsBySlug: categories.categoryIdsBySlug,
        categoryOptions: categories.categoryOptions,
        counters: ingest,
        personId,
      });

      counters.alreadyJudged = ingest.skipped;
      counters.classified = ingest.messagesClassified;
      counters.claimed = ingest.messagesParsed;
      counters.linked = ingest.ordersCreated;
      counters.failed = ingest.errors;
      return counters;
    },
  };
}

export type { LinkerCounters };

/**
 * The person who owns a mailbox.
 *
 * Read through the commerce client, which is bound to `public` -- so this
 * cannot use `core.email_accounts` directly and goes through the view the
 * commerce side already reads its mail from. Returns null rather than throwing
 * when nobody is assigned: an unattributed order is fine, and a sync that
 * fails because a label is missing is not.
 */
async function personForAccount(
  supabase: SupabaseClient,
  accountId: string,
): Promise<string | null> {
  const { data, error } = await supabase
    .from('email_account_people')
    .select('person_id')
    .eq('email_account_id', accountId)
    .maybeSingle();

  if (error) {
    console.error('person lookup failed', error.message);
    return null;
  }
  return (data?.person_id as string | null) ?? null;
}

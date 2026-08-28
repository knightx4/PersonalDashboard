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
    async link({ userId, accountId, accessToken, envelopes }) {
      const counters = emptyLinkerCounters();
      counters.offered = envelopes.length;
      if (envelopes.length === 0) return counters;

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
      });

      // Lifecycle mail that arrived before its confirmation gets another look
      // once this batch has landed, which is how a shipping notice attaches to
      // an order imported minutes ago.
      await reprocessPendingLifecycleMessages(supabase, {
        userId,
        accountId,
        accessToken,
        merchants,
        exclusions,
        categoryIdsBySlug: categories.categoryIdsBySlug,
        categoryOptions: categories.categoryOptions,
        counters: ingest,
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

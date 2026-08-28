import 'server-only';

import type { AppSupabaseClient } from '@/lib/jobs/db/schema-name';
import type { DomainLinker } from '@/lib/core/inbox/fan-out';
import { emptyLinkerCounters } from '@/lib/core/inbox/fan-out';
import { linkEnvelopes, emptyCounters } from '@/lib/jobs/inbox/ingest-messages';
import { loadCompanies, loadLinkCandidates } from '@/lib/jobs/inbox/link-candidates';

/**
 * The job search workspace, as something the shared sync can hand mail to.
 *
 * This is the half that never had a mailbox of its own. It has all the
 * machinery -- Tier A over ATS senders, Tier B for the euphemistic rejections
 * Tier A cannot place, and the linker that attaches a message to an application
 * -- and until now nothing to feed it, because wiring up a second Gmail grant
 * was the price of admission. Sharing core's envelopes removes that price
 * entirely: the same fetch that finds order confirmations finds rejections.
 */
export function jobLinker(supabase: AppSupabaseClient): DomainLinker {
  return {
    domain: 'jobs',
    async link({ userId, accountId, accessToken, envelopes }) {
      const counters = emptyLinkerCounters();
      counters.offered = envelopes.length;
      if (envelopes.length === 0) return counters;

      const [companies, candidates] = await Promise.all([
        loadCompanies(supabase, userId),
        loadLinkCandidates(supabase, userId),
      ]);

      const ingest = emptyCounters();

      await linkEnvelopes(
        supabase,
        {
          userId,
          accountId,
          accessToken,
          companies: companies.map((c) => ({
            id: c.id,
            slug: c.slug,
            name: c.name,
            domains: c.domains,
          })),
          candidates,
          counters: ingest,
        },
        envelopes,
      );

      counters.alreadyJudged = ingest.skipped;
      counters.classified = ingest.messagesClassified;
      counters.claimed = ingest.messagesParsed;
      counters.linked = ingest.applicationsCreated + ingest.leadsCreated;
      counters.failed = ingest.errors;
      return counters;
    },
  };
}

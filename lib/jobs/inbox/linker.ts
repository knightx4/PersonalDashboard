import 'server-only';

import type { AppSupabaseClient } from '@/lib/jobs/db/schema-name';
import type { DomainLinker } from '@/lib/core/inbox/fan-out';
import { emptyLinkerCounters } from '@/lib/core/inbox/fan-out';
import {
  linkEnvelopes,
  emptyCounters,
  reprocessHeldMessages,
  resetRelinkAttempts,
} from '@/lib/jobs/inbox/ingest-messages';
import { loadCompanies, loadLinkCandidates } from '@/lib/jobs/inbox/link-candidates';
import { normalizeTimeZone } from '@/lib/jobs/timezone';

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
    async link({ userId, accountId, accountEmail, accessToken, envelopes }) {
      const counters = emptyLinkerCounters();
      counters.offered = envelopes.length;

      // No early return on an empty batch. A sync that finds no new mail is
      // exactly when the held queue is most worth another pass -- and it is the
      // common case, because incremental syncs offer only mail that has just
      // arrived. Returning here meant "Sync now" on a quiet mailbox did nothing
      // at all for messages waiting to be linked.

      const [companies, candidates, profile] = await Promise.all([
        loadCompanies(supabase, userId),
        loadLinkCandidates(supabase, userId),
        // Only for invites that state a wall-clock time with no zone at all.
        supabase.from('profiles').select('timezone').eq('id', userId).maybeSingle(),
      ]);

      const ingest = emptyCounters();

      const ctx = {
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
        accountEmail,
        // Normalised, not raw: this is applied to invites that carry a wall
        // clock with no zone, and a stored "ET" would silently read as UTC and
        // put the interview five hours out.
        timezone: normalizeTimeZone(profile.data?.timezone as string | undefined),
        counters: ingest,
      };

      if (envelopes.length > 0) await linkEnvelopes(supabase, ctx, envelopes);

      // Mail held on an earlier sync gets another look now that this batch has
      // landed, which is how a rejection attaches to the application the
      // confirmation in the same run just created.
      //
      // Companies and candidates are reloaded first, and that reload is the
      // whole point: the lists above were read before this batch ran, so
      // reusing them would compare held mail against a picture of the pipeline
      // that predates everything the batch added.
      // Anything created just now changes what held mail can match against, so
      // messages that used up their retries before it existed get their budget
      // back -- and get it back in time for the pass below.
      if (ingest.applicationsCreated + ingest.leadsCreated > 0) {
        await resetRelinkAttempts(supabase, accountId);
      }

      const [freshCompanies, freshCandidates] = await Promise.all([
        loadCompanies(supabase, userId),
        loadLinkCandidates(supabase, userId),
      ]);

      await reprocessHeldMessages(supabase, {
        ...ctx,
        companies: freshCompanies.map((c) => ({
          id: c.id,
          slug: c.slug,
          name: c.name,
          domains: c.domains,
        })),
        candidates: freshCandidates,
      });

      counters.alreadyJudged = ingest.skipped;
      counters.classified = ingest.messagesClassified;
      counters.claimed = ingest.messagesParsed;
      counters.linked = ingest.applicationsCreated + ingest.leadsCreated;
      counters.failed = ingest.errors;
      return counters;
    },
  };
}

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

    /**
     * Mail held on an earlier pass, looked at again.
     *
     * Companies and candidates are read here rather than reused from `link`:
     * the whole point of the second look is that the batch just landed may
     * have created the very application a held rejection belongs to, and a
     * list read before the batch would compare against a pipeline that no
     * longer exists.
     */
    async sweep({ userId, accountId, accountEmail, accessToken, budgetMs }) {
      const [companies, candidates, profile] = await Promise.all([
        loadCompanies(supabase, userId),
        loadLinkCandidates(supabase, userId),
        supabase.from('profiles').select('timezone').eq('id', userId).maybeSingle(),
      ]);

      await reprocessHeldMessages(
        supabase,
        {
          userId,
          accountId,
          accessToken,
          accountEmail,
          companies: companies.map((c) => ({
            id: c.id,
            slug: c.slug,
            name: c.name,
            domains: c.domains,
          })),
          candidates,
          timezone: normalizeTimeZone(profile.data?.timezone as string | undefined),
          counters: emptyCounters(),
        },
        { budgetMs },
      );
    },

    async link({ userId, accountId, accountEmail, accessToken, envelopes }) {
      const counters = emptyLinkerCounters();
      counters.offered = envelopes.length;

      // A sync that finds no new mail is exactly when the held queue is most
      // worth another look, and that now happens in `sweep` -- which the pump
      // calls whether or not this batch had anything in it.
      if (envelopes.length === 0) return counters;

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

      // Anything created just now changes what held mail can match against, so
      // messages that used up their retries before it existed get their budget
      // back -- in time for the sweep at the end of this invocation.
      if (ingest.applicationsCreated + ingest.leadsCreated > 0) {
        await resetRelinkAttempts(supabase, accountId);
      }

      counters.alreadyJudged = ingest.skipped;
      counters.classified = ingest.messagesClassified;
      counters.claimed = ingest.messagesParsed;
      counters.linked = ingest.applicationsCreated + ingest.leadsCreated;
      counters.failed = ingest.errors;
      return counters;
    },
  };
}

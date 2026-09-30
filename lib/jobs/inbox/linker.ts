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
import { loadCompanies, loadExcludedDomains, loadLinkCandidates } from '@/lib/jobs/inbox/link-candidates';
import { normalizeTimeZone } from '@/lib/core/timezone';
import type { SpendReport } from '@/lib/core/spend/pricing';
import { recordSpendReports, type SpendClient } from '@/lib/core/spend/record';
import { jevEnabledFor } from '@/lib/jev/enabled';
import {
  companyLookbackQuery,
  companyLookbackVersion,
  recruitingCandidateQuery,
} from '@/lib/jobs/email/providers/gmail-query';

/**
 * Bumped whenever the recruiting search widens, so mail from before the
 * mailbox was connected is listed again under the new terms. 1: "thanks for
 * your interest" and "applying", which the Keystone acknowledgement needed.
 */
export const JOBS_CATCH_UP_VERSION = 1;

/**
 * The catch-up key for one company's lookback. core.inbox_catch_ups allows
 * 41 characters of [a-z0-9_-], so the id goes in without its dashes.
 */
export function companyCatchUpKey(companyId: string): string {
  return `jobs-co-${companyId.replace(/-/g, '').toLowerCase()}`;
}

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
export function jobLinker(
  supabase: AppSupabaseClient,
  /** Where Tier B's spend is written: the core schema, service role. */
  core?: SpendClient,
): DomainLinker {
  const record = async (userId: string, spend: SpendReport[]) => {
    if (!core) return;
    await recordSpendReports(core, userId, { module: 'jobs', operation: 'classify-job-email' }, spend);
  };
  // Read once per sweep or batch, never per message. Without the core client
  // there is no way to know, and not knowing means no text goes to TypeSafe.
  const jevEnabled = (userId: string) => (core ? jevEnabledFor(core, userId) : Promise.resolve(false));

  return {
    domain: 'jobs',

    /**
     * The recruiting search over the whole backfill window again. The backfill
     * only ran it once, when the mailbox was connected, so a term added since
     * never reached anything older than that day.
     */
    catchUp: {
      version: JOBS_CATCH_UP_VERSION,
      query: ({ backfillWindowDays }) => recruitingCandidateQuery(backfillWindowDays),
    },

    /** One lookback per tracked company, run again when its domains change. */
    async catchUps({ userId, backfillWindowDays }) {
      const companies = await loadCompanies(supabase, userId);
      return companies.flatMap((company) => {
        const query = companyLookbackQuery(company.domains, backfillWindowDays);
        if (!query) return [];
        return [
          {
            key: companyCatchUpKey(company.id),
            version: companyLookbackVersion(company.domains),
            query,
          },
        ];
      });
    },

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
      const spend: SpendReport[] = [];
      const [companies, candidates, excludedDomains, profile, jev] = await Promise.all([
        loadCompanies(supabase, userId),
        loadLinkCandidates(supabase, userId),
        loadExcludedDomains(supabase, userId),
        supabase.from('profiles').select('timezone').eq('id', userId).maybeSingle(),
        jevEnabled(userId),
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
          excludedDomains,
          timezone: normalizeTimeZone(profile.data?.timezone as string | undefined),
          counters: emptyCounters(),
          onSpend: (report) => spend.push(report),
          jevEnabled: jev,
        },
        { budgetMs },
      );
      await record(userId, spend);
    },

    async link({ userId, accountId, accountEmail, accessToken, envelopes }) {
      const counters = emptyLinkerCounters();
      counters.offered = envelopes.length;

      // A sync that finds no new mail is exactly when the held queue is most
      // worth another look, and that now happens in `sweep` -- which the pump
      // calls whether or not this batch had anything in it.
      if (envelopes.length === 0) return counters;

      const [companies, candidates, excludedDomains, profile, jev] = await Promise.all([
        loadCompanies(supabase, userId),
        loadLinkCandidates(supabase, userId),
        loadExcludedDomains(supabase, userId),
        // Only for invites that state a wall-clock time with no zone at all.
        supabase.from('profiles').select('timezone').eq('id', userId).maybeSingle(),
        jevEnabled(userId),
      ]);

      const ingest = emptyCounters();
      const spend: SpendReport[] = [];

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
        excludedDomains,
        accountEmail,
        // Normalised, not raw: this is applied to invites that carry a wall
        // clock with no zone, and a stored "ET" would silently read as UTC and
        // put the interview five hours out.
        timezone: normalizeTimeZone(profile.data?.timezone as string | undefined),
        counters: ingest,
        onSpend: (report: SpendReport) => spend.push(report),
        jevEnabled: jev,
      };

      if (envelopes.length > 0) await linkEnvelopes(supabase, ctx, envelopes);
      await record(userId, spend);

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

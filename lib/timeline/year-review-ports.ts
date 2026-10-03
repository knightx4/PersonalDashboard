import 'server-only';

import type { CoreSupabaseClient } from '@/lib/core/db/schema-name';
import type { CoreOperation } from '@/lib/core/spend/operations';
import { recordSpend } from '@/lib/core/spend/record';
import { TIMELINE_COLUMNS, withRefs, type TimelineEvent, type TimelineRow } from './timeline';
import { writeYearParagraphs, YEAR_REVIEW_MODEL } from './year-review-model';
import type { YearReviewPorts } from './year-review-run';

/**
 * The year review run's reads and writes against a core client (plan #1121).
 * The page's button passes the person's own client, under which RLS and the
 * security_invoker timeline decide whose rows come back; the yearly clock
 * passes the service client. Every read names the person either way.
 */

const OPERATION: CoreOperation = 'write-year-review';
const PAGE = 1000;

export function yearReviewPorts(core: CoreSupabaseClient): YearReviewPorts {
  const apiKey = process.env.ANTHROPIC_API_KEY ?? null;

  return {
    async stored(userId, year) {
      const { data, error } = await core
        .from('year_reviews')
        .select('complete')
        .eq('user_id', userId)
        .eq('year', year)
        .maybeSingle();
      if (error) throw new Error(`Reading the year's review failed: ${error.message}`);
      return (data as { complete: boolean } | null) ?? null;
    },

    async timeline(userId, from, to) {
      const events: TimelineEvent[] = [];
      for (let offset = 0; ; offset += PAGE) {
        const { data, error } = await core
          .from('timeline')
          .select(TIMELINE_COLUMNS)
          .eq('user_id', userId)
          .gte('occurred_at', from)
          .lt('occurred_at', to)
          .order('occurred_at', { ascending: true })
          .order('source_table', { ascending: true })
          .order('source_id', { ascending: true })
          .range(offset, offset + PAGE - 1);
        if (error) throw new Error(`Reading the timeline failed: ${error.message}`);
        const page = withRefs((data ?? []) as unknown as TimelineRow[]);
        events.push(...page);
        if (page.length < PAGE) return events;
      }
    },

    async write(summary, onSpend) {
      // Without a key there is nothing to write the paragraphs with.
      if (!apiKey) return null;
      const paragraphs = await writeYearParagraphs(summary, { apiKey, onSpend });
      return { model: YEAR_REVIEW_MODEL, paragraphs };
    },

    async ledger(userId, report) {
      await recordSpend(core, userId, {
        module: 'core',
        operation: OPERATION,
        model: report.model,
        usage: report.usage,
      });
    },

    async save(row) {
      const { error } = await core
        .from('year_reviews')
        .upsert({ ...row, written_at: new Date().toISOString() }, { onConflict: 'user_id,year' });
      if (error) throw new Error(`Saving the year's review failed: ${error.message}`);
    },
  };
}

import 'server-only';

import { createCoreClient } from '@/lib/core/auth/server';
import { recordSpend } from '@/lib/core/spend/record';
import type { SpendReport } from '@/lib/core/spend/pricing';

/**
 * The learn module's way into the ledger.
 *
 * The spend table lives in `core` and the module's own client is bound to
 * `learn`, so a recording needs a second client. That is one line, and putting
 * it here rather than in each server action keeps the operation names in one
 * list where they can be seen to be consistent -- `plan-topic` and
 * `planTopic()` and `Planning a topic` would all be defensible in isolation
 * and useless together on a screen that groups by them.
 *
 * Never throws. The ledger is a measurement of work that already succeeded,
 * and a measurement that fails must not take the work with it.
 */

/**
 * Every operation in this module that spends.
 *
 * A list rather than a bare union so the spend screen can group by it and so
 * a sixth call site has one obvious place to declare itself. The strings are
 * what land in the column, so they are stable: renaming one splits a month of
 * history into two rows that look like different things.
 */
export const LEARN_OPERATIONS = [
  'parse-references',
  'resolve-reference',
  'suggest-sources',
  'plan-topic',
  'name-areas',
  'locate-passage',
  'generate-chain',
  // Starting a track from a theme in the vault map, from the offer card in
  // Practice Flow (plan #778). The same call as 'generate-chain' with the
  // theme's positions in the prompt, kept apart so what offered tracks cost
  // can be read against how often they are started.
  'generate-track-from-theme',
  'write-probe',
  // Practice Flow writing its next few questions before they are needed
  // (plan #771). Apart from 'write-probe', which is a question somebody is
  // waiting on, so the cost of questions written and never shown can be read
  // against the rows the flow threw away.
  'write-probe-ahead',
  'name-misconception',
  'propose-floor',
  'classify-note',
  'concepts-from-note',
  'concepts-from-prior',
  'concepts-from-brief',
  'branch-from-selection',
  'name-opening-claims',
  'write-opening-question',
  'grade-opening-answer',
  'write-quiz-questions',
  'grade-quiz-answer',
  'write-applied-case',
  'grade-applied-answer',
  // The catalogue embedding sweep, which records through its own postgres
  // connection rather than through `recordLearnSpend`: it runs from a script,
  // and reaching the ledger the usual way would pull `next/headers` in. The
  // name is declared here anyway, because this list is what the spend screen
  // groups by and an operation missing from it is one nobody can find.
  'embed-catalogue',
  // Embedding one claim as a query, to find the catalogue segments nearest it.
  // Separate from the sweep above because it is the cheap half of a press
  // somebody is waiting on rather than a batch job, and because the two answer
  // different questions on the spend screen: what the catalogue cost to take
  // in, and what searching it costs.
  'embed-claim',
  // One Haiku call per candidate segment, asking whether it teaches the claim.
  // The only cost in the catalogue feature that scales with how much material
  // has been pulled in rather than with how much you study, so it is worth
  // being able to see on its own.
  'judge-segment',
  // Reading one vault note for the map: the classifier call and one Haiku call
  // per chunk, recorded together because they are one press on the note's
  // page. Kept apart from 'classify-note' and 'concepts-from-note', which are
  // the older path into learn.concepts, so the two can be compared.
  'map-note',
  // The same reading done by the sweep over the whole vault (plan #757),
  // recorded through the service role from the cron call rather than through
  // `recordLearnSpend`, which needs a session. Kept apart from 'map-note' so
  // the cost of the sweep can be read against the 75-note trial's estimate.
  'map-sweep',
  // Placing Wikipedia's Level 3 vital articles into the areas, the check in
  // docs/LEARN-AREAS-SPEC.md. Recorded through the service role from its cron
  // call, like 'map-sweep', and a one-off rather than something that recurs.
  'check-areas',
] as const;

export type LearnOperation = (typeof LEARN_OPERATIONS)[number];

export async function recordLearnSpend(
  userId: string,
  operation: LearnOperation,
  reports: SpendReport[],
): Promise<void> {
  if (reports.length === 0) return;

  try {
    const supabase = await createCoreClient();
    for (const report of reports) {
      await recordSpend(supabase, userId, {
        module: 'learn',
        operation,
        model: report.model,
        usage: report.usage,
      });
    }
  } catch (error) {
    console.error(
      `[learn spend] ${operation}`,
      error instanceof Error ? error.message : error,
    );
  }
}

/**
 * A sink and the reports it collected.
 *
 * The library functions report synchronously as each call returns; the action
 * writes them afterwards, once, rather than awaiting a database round trip in
 * the middle of a search the person is waiting on.
 */
export function collectSpend(): { sink: (report: SpendReport) => void; reports: SpendReport[] } {
  const reports: SpendReport[] = [];
  return { sink: (report) => reports.push(report), reports };
}

import type { CoreSupabaseClient } from '@/lib/core/db/schema-name';
import { toRef } from '@/lib/core/refs';
import { currentYear, parseYear } from '@/lib/timeline/year-review';
import { yearReviewPorts } from '@/lib/timeline/year-review-ports';
import { writeYearReviewFor, yearReviewRefusal } from '@/lib/timeline/year-review-run';
import type { DashPaidTool } from './registry';
import { LEARN_PAID_TOOLS } from './paid-tools-learn';

/**
 * Dash's paid tools (plan #2228.1): each one a button that spends money,
 * declared beside the button's key in PAID_ACTIONS
 * (lib/core/spend/paid-actions.ts). Calling one queues the press for an
 * approval (lib/dash/paid.ts); approving runs `run`, which calls the same
 * function the button's server action calls, named in `runs`.
 *
 * Each tool is a top-level constant here, or in a file of its own under
 * lib/dash/, so paid-actions.test.ts can follow its `run` to the ledger and
 * check it reaches `runs` and records what the hint names. A button whose
 * work sits inline in its server action has it moved into a plain function
 * first, which both then call.
 *
 * The workspace steps of feature #2228 add the rest: Jobs (#2228.3), Learn
 * (#2228.4) and the other workspaces (#2228.5). Each one's catalogue entry
 * (lib/<module>/agent-actions.ts) then names the tool in place of
 * none('spends').
 */

const QUEUED =
  'It costs money, so calling this runs nothing: it is queued on a card under your answer with its estimated cost, and runs only when they approve it.';

/** The timeline's Write this year up, and Write it again (plan #1121). */
export const writeYearReviewTool: DashPaidTool = {
  name: 'write_year_review',
  kind: 'paid',
  inAppOnly: true,
  action: 'app/timeline/actions.ts#writeYearReview',
  runs: 'lib/timeline/year-review-run.ts#writeYearReviewFor',
  workspace: null,
  definition: {
    name: 'write_year_review',
    description: `Write the review of a year on their timeline, or write the current year's again, when they ask for it. A year written up after it ended stays as it is, and a year with too few events is not written. ${QUEUED}`,
    input_schema: {
      type: 'object',
      properties: {
        year: { type: 'integer', minimum: 2000, description: 'The year to write up, such as 2026.' },
      },
      required: ['year'],
      additionalProperties: false,
    },
  },
  async prepare(ctx, input) {
    const args = input && typeof input === 'object' ? (input as Record<string, unknown>) : {};
    const now = new Date(ctx.now ?? Date.now());
    const year = parseYear(String(args.year ?? ''), currentYear(now, ctx.timezone ?? 'UTC'));
    if (year == null) return { ok: false, error: 'That year cannot be written up: it has not started, or it is before 2000.' };
    const core = await ctx.db('core');
    const { data, error } = await core
      .from('year_reviews')
      .select('complete')
      .eq('user_id', ctx.userId)
      .eq('year', year)
      .maybeSingle();
    if (error) return { ok: false, error: 'The year could not be checked against the database.' };
    if ((data as { complete: boolean } | null)?.complete) {
      return { ok: false, error: `The review of ${year} was written after the year ended, so it stays as it is.` };
    }
    return {
      ok: true,
      args: { year },
      line: data ? `Write the review of ${year} again from the timeline.` : `Write the review of ${year} from the timeline.`,
      paths: [`/timeline/year/${year}`],
    };
  },
  async run(ctx, args) {
    const year = Number(args.year);
    const core = (await ctx.db('core')) as unknown as CoreSupabaseClient;
    const before = await core.from('year_reviews').select('id').eq('user_id', ctx.userId).eq('year', year).maybeSingle();
    const result = await writeYearReviewFor(yearReviewPorts(core), {
      userId: ctx.userId,
      year,
      timezone: ctx.timezone,
      now: ctx.now,
    });
    const refusal = yearReviewRefusal(result, year);
    if (refusal || result.status !== 'written') return { ok: false, error: refusal ?? 'Dash could not write the review.' };
    const { data, error } = await core.from('year_reviews').select('id').eq('user_id', ctx.userId).eq('year', year).maybeSingle();
    const id = (data as { id: string } | null)?.id;
    if (error || !id) return { ok: false, error: 'Dash wrote the review, but it could not be read back.' };
    return {
      ok: true,
      subjectRef: toRef('core.year_reviews', id),
      op: before.data ? 'update' : 'insert',
      summary: `Dash wrote the review of ${year}: ${result.paragraphs} paragraphs from ${result.events} events.`,
    };
  },
};

/** Every paid tool, in the order the model is sent them. */
export const PAID_TOOLS: readonly DashPaidTool[] = [
  writeYearReviewTool,
  ...LEARN_PAID_TOOLS,
];

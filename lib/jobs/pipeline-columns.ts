import type { PipelineRow } from '@/lib/jobs/applications/load';
import { isLive } from '@/lib/jobs/pipeline';
import {
  EXCITEMENT_MINIMUMS,
  PIPELINE_STAGES,
  pipelineHref,
  type PipelineParams,
  type PipelineState,
} from '@/lib/jobs/pipeline-view';
import { CHANCE_BAND_LABELS } from '@/lib/jobs/suggest/chance-check';
import { FIT_MINIMUMS } from '@/lib/jobs/suggest/score-notes';
import { FIT_SCORE_LABEL } from '@/lib/jobs/suggest/scores';
import { choiceColumn, columnFilters, commonValues, type ColumnFilter, type FilterColumn } from '@/lib/table-view';

/**
 * The filters a column header on the Pipeline table offers (note f05f5f04):
 * click a column, and its menu narrows the table by what that column shows,
 * beside the sort it already had. Each choice is a link built the way the
 * filter chips build theirs, so a header and a chip set the same address.
 *
 * Role and last activity have no filter, only their sort; comp has neither.
 *
 * The menus and their links are built by the shared table module
 * (lib/table-view.ts); what is here is which columns Pipeline's are.
 */

export type { ColumnFilter, ColumnFilterChoice } from '@/lib/table-view';

/** The most companies a Company menu lists, so it stays on the screen. */
export const COLUMN_COMPANY_LIMIT = 8;

/** The sent-within choices the Date applied column offers, in days. */
const SENT_CHOICES = [7, 30, 90] as const;

export function pipelineColumnFilters(
  params: PipelineParams,
  state: PipelineState,
  /** The rows in scope, which the counts are taken from. */
  scoped: readonly PipelineRow[],
  /** Every row, for the status counts, which span live and closed. */
  rows: readonly PipelineRow[],
  scored: boolean,
): Record<string, ColumnFilter> {
  // The table is where these menus are, so every link stays on it.
  const href = (changes: Partial<Record<keyof PipelineParams, string | undefined>>) =>
    pipelineHref(params, { view: 'table', ...changes });
  const live = rows.filter((row) => isLive(row.status));

  const status: FilterColumn<PipelineParams> = {
    id: 'status',
    active: state.scope !== 'live' || state.stage !== null,
    options: [
      {
        id: 'live',
        label: `Live · ${live.length}`,
        changes: { status: undefined, stage: undefined },
        current: state.scope === 'live' && !state.stage,
      },
      ...PIPELINE_STAGES.map((stage) => ({
        id: `stage-${stage.key}`,
        label: `${stage.label} · ${live.filter((row) => (stage.statuses as readonly string[]).includes(row.status)).length}`,
        changes: { status: undefined, stage: stage.key },
        current: state.scope === 'live' && state.stage?.key === stage.key,
      })),
      {
        id: 'closed',
        label: `Closed · ${rows.length - live.length}`,
        changes: { status: 'closed', stage: undefined },
        current: state.scope === 'closed',
      },
      {
        id: 'all',
        label: `All · ${rows.length}`,
        changes: { status: 'all', stage: undefined },
        current: state.scope === 'all',
      },
    ],
  };

  // The companies with the most applications in scope, then by name.
  const companies = commonValues(
    scoped,
    (row) => row.companySlug,
    (row) => row.companyName,
    COLUMN_COMPANY_LIMIT,
    state.company,
  );
  const fit = FIT_SCORE_LABEL.toLowerCase();

  return columnFilters<PipelineParams>(
    [
      status,
      choiceColumn({
        id: 'company',
        param: 'company',
        current: state.company,
        anyLabel: 'Any company',
        choices: companies.map(({ value, name, count }) => ({ value, label: `${name} · ${count}` })),
      }),
      choiceColumn({
        id: 'applied',
        param: 'sent',
        prefix: 'sent',
        current: state.sentDays === null ? null : String(state.sentDays),
        anyLabel: 'Any time',
        choices: SENT_CHOICES.map((days) => ({ value: String(days), label: `In the last ${days} days` })),
      }),
      choiceColumn({
        id: 'excitement',
        param: 'excitement',
        current: state.excitement ? String(state.excitement) : null,
        anyLabel: 'Any excitement',
        choices: EXCITEMENT_MINIMUMS.map((level) => ({
          value: String(level),
          label: level === 5 ? '★'.repeat(level) : `${'★'.repeat(level)} and up`,
        })),
      }),
      scored &&
        choiceColumn({
          id: 'fit',
          param: 'minfit',
          current: state.minimum.fit ? String(state.minimum.fit) : null,
          anyLabel: `Any ${fit}`,
          choices: FIT_MINIMUMS.map((value) => ({ value: String(value), label: `${value} and up` })),
        }),
      scored &&
        choiceColumn({
          id: 'chance',
          param: 'minchance',
          current: state.minimum.chance === 'any' ? null : state.minimum.chance,
          anyLabel: 'Any chance',
          choices: [
            { value: 'medium', label: `${CHANCE_BAND_LABELS.medium} or better` },
            { value: 'high', label: CHANCE_BAND_LABELS.high },
          ],
        }),
      // The same yes and no the Ready and Questions chips set.
      choiceColumn({
        id: 'ready',
        param: 'ready',
        current: state.ready === null ? null : state.ready ? 'yes' : 'no',
        anyLabel: 'Ready or not',
        choices: [
          { value: 'yes', label: `Ready to apply · ${scoped.filter((row) => row.readyToApply).length}` },
          { value: 'no', label: `Not ready · ${scoped.filter((row) => !row.readyToApply).length}` },
        ],
      }),
      choiceColumn({
        id: 'questions',
        param: 'questions',
        current: state.questions === null ? null : state.questions ? 'yes' : 'no',
        anyLabel: 'Any questions',
        choices: [
          { value: 'yes', label: `All questions added · ${scoped.filter((row) => row.allQuestionsAdded).length}` },
          { value: 'no', label: `Not all added · ${scoped.filter((row) => !row.allQuestionsAdded).length}` },
        ],
      }),
    ],
    href,
  );
}

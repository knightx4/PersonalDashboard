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

/**
 * The filters a column header on the Pipeline table offers (note f05f5f04):
 * click a column, and its menu narrows the table by what that column shows,
 * beside the sort it already had. Each choice is a link built the way the
 * filter chips build theirs, so a header and a chip set the same address.
 *
 * Role, last activity and comp have no filter, only their sort.
 */

export type ColumnFilterChoice = { id: string; label: string; href: string; current: boolean };

/** A column's choices, and whether one of them other than "any" is set. */
export type ColumnFilter = { active: boolean; choices: ColumnFilterChoice[] };

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

  const filters: Record<string, ColumnFilter> = {};

  filters.status = {
    active: state.scope !== 'live' || state.stage !== null,
    choices: [
      {
        id: 'live',
        label: `Live · ${live.length}`,
        href: href({ status: undefined, stage: undefined }),
        current: state.scope === 'live' && !state.stage,
      },
      ...PIPELINE_STAGES.map((stage) => ({
        id: `stage-${stage.key}`,
        label: `${stage.label} · ${live.filter((row) => (stage.statuses as readonly string[]).includes(row.status)).length}`,
        href: href({ status: undefined, stage: stage.key }),
        current: state.scope === 'live' && state.stage?.key === stage.key,
      })),
      {
        id: 'closed',
        label: `Closed · ${rows.length - live.length}`,
        href: href({ status: 'closed', stage: undefined }),
        current: state.scope === 'closed',
      },
      {
        id: 'all',
        label: `All · ${rows.length}`,
        href: href({ status: 'all', stage: undefined }),
        current: state.scope === 'all',
      },
    ],
  };

  // The companies with the most applications in scope, then by name; the one
  // chosen is always listed, so the menu can show where you are.
  const byCompany = new Map<string, { name: string; count: number }>();
  for (const row of scoped) {
    const entry = byCompany.get(row.companySlug) ?? { name: row.companyName, count: 0 };
    entry.count += 1;
    byCompany.set(row.companySlug, entry);
  }
  const companies = [...byCompany.entries()]
    .sort(([, a], [, b]) => b.count - a.count || a.name.localeCompare(b.name))
    .slice(0, COLUMN_COMPANY_LIMIT);
  if (state.company && !companies.some(([slug]) => slug === state.company)) {
    const chosen = byCompany.get(state.company);
    if (chosen) companies.push([state.company, chosen]);
  }
  filters.company = {
    active: state.company !== null,
    choices: [
      { id: 'any', label: 'Any company', href: href({ company: undefined }), current: !state.company },
      ...companies.map(([slug, { name, count }]) => ({
        id: `company-${slug}`,
        label: `${name} · ${count}`,
        href: href({ company: slug }),
        current: state.company === slug,
      })),
    ],
  };

  filters.applied = {
    active: state.sentDays !== null,
    choices: [
      { id: 'any', label: 'Any time', href: href({ sent: undefined }), current: state.sentDays === null },
      ...SENT_CHOICES.map((days) => ({
        id: `sent-${days}`,
        label: `In the last ${days} days`,
        href: href({ sent: String(days) }),
        current: state.sentDays === days,
      })),
    ],
  };

  filters.excitement = {
    active: state.excitement !== null,
    choices: [
      { id: 'any', label: 'Any excitement', href: href({ excitement: undefined }), current: !state.excitement },
      ...EXCITEMENT_MINIMUMS.map((level) => ({
        id: `excitement-${level}`,
        label: level === 5 ? '★'.repeat(level) : `${'★'.repeat(level)} and up`,
        href: href({ excitement: String(level) }),
        current: state.excitement === level,
      })),
    ],
  };

  if (scored) {
    const fit = FIT_SCORE_LABEL.toLowerCase();
    filters.fit = {
      active: state.minimum.fit > 0,
      choices: [
        { id: 'any', label: `Any ${fit}`, href: href({ minfit: undefined }), current: !state.minimum.fit },
        ...FIT_MINIMUMS.map((value) => ({
          id: `fit-${value}`,
          label: `${value} and up`,
          href: href({ minfit: String(value) }),
          current: state.minimum.fit === value,
        })),
      ],
    };
    filters.chance = {
      active: state.minimum.chance !== 'any',
      choices: [
        { id: 'any', label: 'Any chance', href: href({ minchance: undefined }), current: state.minimum.chance === 'any' },
        {
          id: 'chance-medium',
          label: `${CHANCE_BAND_LABELS.medium} or better`,
          href: href({ minchance: 'medium' }),
          current: state.minimum.chance === 'medium',
        },
        {
          id: 'chance-high',
          label: CHANCE_BAND_LABELS.high,
          href: href({ minchance: 'high' }),
          current: state.minimum.chance === 'high',
        },
      ],
    };
  }

  return filters;
}

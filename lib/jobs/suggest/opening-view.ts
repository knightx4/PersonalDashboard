import { FIT_MINIMUMS } from './score-notes';
import {
  NO_OPENING_FILTER,
  OPENING_SORTS,
  WORKPLACES,
  type OpeningFilter,
  type OpeningSort,
  type Workplace,
} from './scores';

/**
 * The recommended roles' sort and filters, read from the URL (law 5).
 *
 * Every parameter starts with `r` so it sits beside the Roles table's own
 * (`sort`, `status`, `minfit` and the rest) without either reading the other's.
 * The section's filter form is a GET form that submits these names, so a
 * narrowed list survives a refresh and works before JavaScript (law 6).
 * Anything unreadable is the default. Pure, so the mapping is tested.
 */

/** The parameter each control submits. */
export const OPENING_PARAMS = {
  sort: 'rsort',
  workplace: 'rwork',
  fit: 'rmatch',
  salary: 'rpay',
  coverLetter: 'rletter',
  minFit: 'rfit',
  minChance: 'rchance',
  hideRedFlags: 'rflags',
  hideDuplicates: 'rfile',
} as const;

const OWN = new Set<string>(Object.values(OPENING_PARAMS));

export type OpeningView = { sort: OpeningSort; filter: OpeningFilter };

type Params = Record<string, string | string[] | undefined>;

function first(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

export function parseOpeningView(params: Params): OpeningView {
  const get = (key: keyof typeof OPENING_PARAMS) => first(params[OPENING_PARAMS[key]]);
  const sort = OPENING_SORTS.find((value) => value === get('sort')) ?? 'newest';
  const workplace = WORKPLACES.find((value) => value !== 'unclear' && value === get('workplace'));
  const fit = get('fit');
  const letter = get('coverLetter');
  const minFit = Number(get('minFit'));
  const chance = get('minChance');
  return {
    sort,
    filter: {
      workplace: (workplace as Workplace | undefined) ?? NO_OPENING_FILTER.workplace,
      fit: fit === 'strong' || fit === 'partial_up' ? fit : 'any',
      salary: get('salary') === 'shown',
      coverLetter: letter === 'yes' || letter === 'no' ? letter : 'any',
      minFit: (FIT_MINIMUMS as readonly number[]).includes(minFit) ? minFit : 0,
      minChance: chance === 'medium' || chance === 'high' ? chance : 'any',
      hideRedFlags: get('hideRedFlags') === 'hide',
      hideDuplicates: get('hideDuplicates') === 'hide',
    },
  };
}

/** How many filters are set (sort is not a filter). */
export function activeFilters(filter: OpeningFilter): number {
  return (Object.keys(NO_OPENING_FILTER) as (keyof OpeningFilter)[]).filter(
    (key) => filter[key] !== NO_OPENING_FILTER[key],
  ).length;
}

/**
 * The page's other parameters, which the filter form carries as hidden
 * fields so submitting it does not clear the table's filters.
 */
export function otherParams(params: Params): [string, string][] {
  const out: [string, string][] = [];
  for (const [key, value] of Object.entries(params)) {
    if (OWN.has(key) || value === undefined) continue;
    for (const one of Array.isArray(value) ? value : [value]) out.push([key, one]);
  }
  return out;
}

/** The page's URL with the section's own parameters cleared, for Clear. */
export function clearedHref(pathname: string, params: Params): string {
  const query = new URLSearchParams(otherParams(params)).toString();
  return query ? `${pathname}?${query}` : pathname;
}

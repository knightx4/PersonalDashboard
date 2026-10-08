/**
 * Where practice questions are asked (plan #1486): the Now tab with its
 * Practice only switch on. Practice Flow had its own route at /learn/flow
 * until then, and that route now redirects here with its query kept.
 *
 * `track` focuses the questions on one subject (plan #779), `goal` on one
 * learning goal (plan #1387), and `only` is the Tracks only or Goals only
 * filter (plans #842 and #1387). The page decides which of them wins when more
 * than one is given, so this only writes what it was handed.
 *
 * Without the switch, `track` narrows the feed to one subject's cards (plan
 * #1698): `nowHref` writes that link, and the subject page's Now button uses it.
 */

export const NOW_HREF = '/learn/now';

export type PracticeScope = {
  track?: string | null;
  goal?: string | null;
  only?: string | null;
};

export function practiceHref(scope: PracticeScope = {}): string {
  const params = new URLSearchParams({ practice: '1' });
  if (scope.track) params.set('track', scope.track);
  if (scope.goal) params.set('goal', scope.goal);
  if (scope.only) params.set('only', scope.only);
  return `${NOW_HREF}?${params.toString()}`;
}

/** Now's feed, narrowed to one subject's cards when `track` is given (plan #1698). */
export function nowHref(track?: string | null): string {
  return track ? `${NOW_HREF}?${new URLSearchParams({ track }).toString()}` : NOW_HREF;
}

/**
 * Whether a visit to Now asks for practice. The switch writes `practice=1`;
 * an old Practice Flow link carried `goal` or `only` with no switch, and
 * either means practice too. `track` alone is the feed for one subject (plan
 * #1698): /learn/flow redirects with the switch on, so no link that meant
 * practice by a track alone is still written.
 */
export function wantsPractice(params: {
  practice?: string | string[];
  track?: string | string[];
  goal?: string | string[];
  only?: string | string[];
}): boolean {
  if (params.practice === '1') return true;
  if (params.practice === '0') return false;
  return params.goal !== undefined || params.only !== undefined;
}

/** The first value of a search parameter, when it was given once or more. */
export function firstParam(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

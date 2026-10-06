/**
 * A goal typed into the search box opens the goal (plan #1618).
 *
 * The box listed what you can go to and start above the things you own,
 * whatever they scored, so for a goal's whole title the first row was often a
 * capture whose name its first word happens to spell: "Land your next role"
 * put "Log what happened" first, and Enter opened that instead of the goal.
 * The halves are now merged on their points, and the goal's row is first.
 *
 * Built from the same pieces the box uses: the goals source's hits, the
 * capture actions matched by matchCaptureActions, and the Goals sections.
 */
import { describe, expect, it, vi } from 'vitest';

vi.mock('next/navigation', () => ({
  usePathname: () => '/goals',
  useRouter: () => ({ push: () => {}, replace: () => {}, refresh: () => {} }),
  useSearchParams: () => new URLSearchParams(),
}));

const { orderRows, rankCommands } = await import('@/components/shell/use-search-rows');
const { CAPTURE_ACTIONS, matchCaptureActions } = await import('@/lib/capture/actions');
const { paletteHits } = await import('@/lib/search/rank');
const { goalHits } = await import('@/lib/search/sources/goals-map');
import type { SearchCommand, SearchRow } from '@/components/shell/use-search-rows';
import type { GoalItemRow } from '@/lib/search/sources/goals-map';

const goal = (id: string, title: string): GoalItemRow => ({
  id,
  level: 'goal',
  parent_id: null,
  title,
  status: 'open',
  kind: null,
});

const GOALS: GoalItemRow[] = [
  goal('11111111-1111-4111-8111-111111111111', 'Land your next role'),
  goal('22222222-2222-4222-8222-222222222222', 'Put five finished things out under your name'),
  goal('33333333-3333-4333-8333-333333333333', "Sam's Birthday"),
  goal('44444444-4444-4444-8444-444444444444', 'Pay off student debt'),
];

const noop = () => {};

/** The Goals workspace's sections, as the layout passes them. */
const SECTIONS: SearchCommand[] = [
  { id: 'section:/goals', label: 'Home', hint: 'Go to', module: 'goals', run: noop },
  { id: 'section:/goals/all', label: 'All goals', hint: 'Go to', module: 'goals', run: noop },
];

/** What the box lists for a query, in order, with the held list in hand. */
function rowsFor(query: string): SearchRow[] {
  const captures = matchCaptureActions(query, CAPTURE_ACTIONS).map(({ action, points, seed }) => ({
    points,
    command: { id: `capture:${action.id}`, label: action.label, hint: seed, module: action.module, run: noop },
  }));
  const commands = rankCommands({ commands: SECTIONS, captures, query });
  const hits = paletteHits(goalHits(GOALS, { limit: 5000 }), query);
  return orderRows({ commands, hits, query, ask: null });
}

function where(row: SearchRow | undefined): string | undefined {
  if (!row) return undefined;
  return row.kind === 'hit' ? row.hit.href : row.command.id;
}

describe('a goal typed into the search box', () => {
  it.each(GOALS.map((row) => [row.title, row.id]))('%s is the row Enter opens', (title, id) => {
    expect(where(rowsFor(title)[0])).toBe(`/goals/${id}`);
  });

  it('opens on its own page, not on All goals', () => {
    const rows = rowsFor('Land your next role');
    const hit = rows.find((row) => row.kind === 'hit');
    expect(hit?.kind === 'hit' && hit.hit.href).toBe('/goals/11111111-1111-4111-8111-111111111111');
    expect(where(rows[0])).not.toBe('section:/goals/all');
  });

  it('still offers the capture, below the goal', () => {
    const rows = rowsFor('Land your next role').map(where);
    expect(rows).toContain('capture:goals');
    expect(rows.indexOf('capture:goals')).toBeGreaterThan(0);
  });

  it('puts a section first when it matches as well as a thing you own', () => {
    const rows = orderRows({
      commands: rankCommands({ commands: SECTIONS, captures: [], query: 'all goals' }),
      hits: [
        {
          module: 'goals',
          kind: 'goal',
          id: 'g',
          ref: 'goals.items:g',
          title: 'All goals',
          subtitle: 'Goal',
          href: '/goals/g',
        },
      ],
      query: 'all goals',
      ask: null,
    });
    expect(rows.map(where)).toEqual(['section:/goals/all', '/goals/g']);
  });
});

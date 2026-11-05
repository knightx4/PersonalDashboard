import { describe, expect, it } from 'vitest';
import type { GitRunner } from './ui-check-guard';
import {
  featureLandCheck,
  featureSurfaces,
  featureUnpassed,
  pageGroups,
  roundsAtHead,
  type BuiltScreenStep,
  type FeatureRound,
} from './ui-feature-review';

/**
 * A branch of five commits in a line, a000001 to a000005, with a side commit f00000f that is
 * on none of their histories. a000005 changed the page's file after a000004.
 */
const line = ['a000001', 'a000002', 'a000003', 'a000004', 'a000005'];
const git: GitRunner = (args) => {
  if (args[0] === 'merge-base' && args[1] === '--is-ancestor') {
    const [ancestor, descendant] = [args[2]!, args[3]!];
    const i = line.indexOf(ancestor);
    const j = line.indexOf(descendant);
    if (i >= 0 && j >= 0 && i <= j) return '';
    throw new Error('not an ancestor');
  }
  if (args[0] === 'diff') {
    const [from, to] = [args[2]!, args[3]!];
    const changed: string[] = [];
    if (line.indexOf(from) < 4 && line.indexOf(to) >= 4) changed.push('app/goals/page.tsx');
    if (line.indexOf(from) < 3 && line.indexOf(to) >= 3) changed.push('lib/goals/sum.ts');
    return changed.join('\n');
  }
  throw new Error(`unexpected git ${args.join(' ')}`);
};

const round = (surface: string, n: number, verdict: string, commit: string | null, layout_ok?: boolean | null): FeatureRound => ({
  surface,
  round: n,
  verdict,
  commit_sha: commit,
  layout_ok,
});

/** Four screen steps that reach the same two pages, and one that changed no screen. */
const steps: BuiltScreenStep[] = [
  { number: 11, outline: '10.1', commit: 'a000001', files: ['app/goals/page.tsx'], surfaces: ['goals-hours', 'goals-hours-day-empty'] },
  { number: 12, outline: '10.2', commit: 'a000002', files: ['components/goals/day.tsx'], surfaces: ['goals-hours-day-empty', 'goals-inbox'] },
  { number: 13, outline: '10.3', commit: 'a000003', files: ['app/goals/inbox/page.tsx'], surfaces: ['goals-inbox', 'goals-inbox-empty'] },
  { number: 14, outline: '10.4', commit: 'a000004', files: ['app/goals/page.tsx'], surfaces: ['goals-hours'] },
  { number: 15, outline: '10.5', commit: 'a000004', files: ['lib/goals/sum.ts'], surfaces: [] },
];

const routes = {
  'goals-hours': ['/goals/hours'],
  'goals-hours-day-empty': ['/goals/hours'],
  'goals-inbox': ['/goals/inbox'],
  'goals-inbox-empty': ['/goals/inbox'],
};

describe('roundsAtHead', () => {
  it('counts a round taken at a commit holding every built step, and none taken before the last', () => {
    const rounds = [round('goals-hours', 1, 'fix', 'a000002'), round('goals-hours', 2, 'pass', 'a000004'), round('goals-inbox', 1, 'pass', null)];
    const counted = roundsAtHead(rounds, { contains: ['a000001', 'a000002', 'a000003', 'a000004'] }, git);
    expect(counted.map((r) => r.round)).toEqual([2]);
  });

  it('drops a round from another history and one whose screen files changed before the head', () => {
    const rounds = [round('goals-hours', 1, 'pass', 'f00000f'), round('goals-hours', 2, 'pass', 'a000004'), round('goals-inbox', 1, 'pass', 'a000005')];
    const at = roundsAtHead(rounds, { contains: [], head: 'a000005', screenFiles: ['app/goals/page.tsx'] }, git);
    expect(at.map((r) => `${r.surface}:${r.round}`)).toEqual(['goals-inbox:1']);
    // A change to a file that draws no screen leaves the round standing.
    const notScreen = roundsAtHead([round('goals-hours', 2, 'pass', 'a000003')], { contains: [], head: 'a000004', screenFiles: ['lib/goals/sum.ts'] }, git);
    expect(notScreen).toHaveLength(1);
  });
});

describe('featureSurfaces', () => {
  it('is the union of what the screen steps reach, once each', () => {
    expect(featureSurfaces(steps)).toEqual(['goals-hours', 'goals-hours-day-empty', 'goals-inbox', 'goals-inbox-empty']);
  });
});

describe('featureLandCheck', () => {
  it('closes every step from one round per page at the head', () => {
    // One round per page: the main state's verdict recorded for its states too (ui-check --states).
    const all = [
      round('goals-hours', 1, 'pass', 'a000004'),
      round('goals-hours-day-empty', 1, 'pass', 'a000004'),
      round('goals-inbox', 1, 'pass', 'a000004'),
      round('goals-inbox-empty', 1, 'pass', 'a000004'),
    ];
    const counting = roundsAtHead(all, { contains: steps.map((s) => s.commit) }, git);
    const check = featureLandCheck({ feature: 10, steps, all, counting });
    expect(check.closes).toEqual([11, 12, 13, 14, 15]);
    expect(check.held.size).toBe(0);
  });

  it('holds only the steps whose surfaces are not passed at the head, naming the feature review', () => {
    const all = [
      round('goals-hours', 1, 'pass', 'a000004'),
      round('goals-hours-day-empty', 1, 'pass', 'a000004'),
      // Passed by a builder's round before the last step: does not count.
      round('goals-inbox', 1, 'pass', 'a000002'),
      round('goals-inbox-empty', 1, 'fix', 'a000004'),
    ];
    const counting = roundsAtHead(all, { contains: steps.map((s) => s.commit) }, git);
    const check = featureLandCheck({ feature: 10, outline: '10', steps, all, counting });
    expect(check.closes).toEqual([11, 14, 15]);
    expect([...check.held.keys()]).toEqual([12, 13]);
    expect(check.held.get(13)).toContain('goals-inbox (no round at the branch head)');
    expect(check.held.get(13)).toContain('goals-inbox-empty (round 1 asked for fixes)');
    expect(check.held.get(13)).toContain('npm run ui-guard -- 10 --feature --compare');
  });

  it('keeps a layout that differs from its reference unpassed, even from a round that no longer counts', () => {
    const all = [round('goals-hours', 1, 'fix', 'a000002', false), round('goals-hours', 2, 'pass', 'a000004')];
    const counting = roundsAtHead(all, { contains: ['a000004'] }, git);
    const missing = featureUnpassed(['goals-hours'], all, counting);
    expect(missing).toEqual([{ surface: 'goals-hours', round: 2, verdict: 'pass', layoutNo: true }]);
    const cleared = [...all, round('goals-hours', 3, 'pass', 'a000004', true)];
    expect(featureUnpassed(['goals-hours'], cleared, roundsAtHead(cleared, { contains: ['a000004'] }, git))).toEqual([]);
  });
});

describe('pageGroups', () => {
  it('puts the surfaces of one page in one sheet, the state the others extend first', () => {
    expect(pageGroups(['goals-hours-day-empty', 'goals-inbox-empty', 'goals-hours', 'goals-inbox'], routes)).toEqual([
      { route: '/goals/hours', main: 'goals-hours', states: ['goals-hours-day-empty'] },
      { route: '/goals/inbox', main: 'goals-inbox', states: ['goals-inbox-empty'] },
    ]);
  });

  it('stands a surface with no route on its own', () => {
    expect(pageGroups(['ui-kit'], routes)).toEqual([{ route: 'ui-kit', main: 'ui-kit', states: [] }]);
  });
});

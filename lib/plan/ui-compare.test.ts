import { describe, expect, it } from 'vitest';
import { compareReport, mainPreviewPort, probePort, shares, splitSurfaces } from './ui-compare';
import { surfaceOfComponent, surfacesForFiles } from '../preview/routes';

describe('splitSurfaces', () => {
  const surfaces = ['dev-comment-thread', 'dev-plan-tree', 'ask-dash-thread', 'ui-kit'];

  it('leaves for the critic the surfaces the step links and those the critic has judged', () => {
    const split = splitSurfaces(
      surfaces,
      'Fix the gap in the thread: /preview?s=ask-dash-thread',
      [{ surface: 'ui-kit', round: 1, verdict: 'fix' }],
    );
    expect(split.named).toEqual(['ask-dash-thread', 'ui-kit']);
    expect(split.reached).toEqual(['dev-comment-thread', 'dev-plan-tree']);
  });

  it('compares every surface when the step names none', () => {
    expect(splitSurfaces(surfaces, 'Make comment bodies quieter.', []).reached).toEqual(surfaces);
  });

  it('does not read a page address in the words as naming every surface of the page', () => {
    const split = splitSurfaces(['dev-plan-tree', 'ui-kit'], 'The rows on /dev/plan lose their gap.', []);
    expect(split.named).toEqual([]);
    expect(split.reached).toEqual(['dev-plan-tree', 'ui-kit']);
  });

  it('leaves out what has passed, and does not count a settle as the critic looking', () => {
    const split = splitSurfaces(surfaces, '', [
      { surface: 'dev-comment-thread', round: 2, verdict: 'pass' },
      { surface: 'dev-plan-tree', round: 1, verdict: 'accepted' },
      { surface: 'ui-kit', round: 1, verdict: 'accepted' },
      { surface: 'ui-kit', round: 2, verdict: 'fix' },
    ]);
    expect(split.named).toEqual(['ui-kit']);
    expect(split.reached).toEqual(['ask-dash-thread']);
  });
});

describe('shares', () => {
  it('deals the surfaces round robin and drops empty shares', () => {
    expect(shares(['a', 'b', 'c', 'd', 'e'], 2)).toEqual([['a', 'c', 'e'], ['b', 'd']]);
    expect(shares(['a'], 3)).toEqual([['a']]);
    expect(shares([], 3)).toEqual([]);
  });

  it('takes at least one worker', () => {
    expect(shares(['a', 'b'], 0)).toEqual([['a', 'b']]);
  });
});

describe('ports', () => {
  it('gives each builder its own block of probe ports, main above the branch', () => {
    expect(probePort(3400, 'branch', 0)).toBe(9600);
    expect(probePort(3402, 'branch', 2)).toBe(9622);
    expect(probePort(3402, 'main', 0)).toBe(9625);
    expect(new Set([0, 1, 2, 3, 4].flatMap((w) => [probePort(3401, 'branch', w), probePort(3401, 'main', w)])).size).toBe(10);
    expect(mainPreviewPort(3402)).toBe(4402);
  });
});

describe('compareReport', () => {
  const timings = { build: 200_000, shoot: 61_000, compare: 900 };

  it('lists the named and the changed for the critic and settles the same', () => {
    const report = compareReport({
      name: '#2748.12',
      step: 2770,
      named: ['ask-page'],
      comparisons: [
        { surface: 'dev-comment-thread', outcome: 'same', reasons: [] },
        { surface: 'learn-now', outcome: 'changed', reasons: ['phone-light differs in 812 pixels (0.06%)'] },
        { surface: 'chat-people', outcome: 'unshot', reasons: ["phone-light has no shot of main's"] },
      ],
      newOnBranch: ['chat-people'],
      timings,
    });
    expect(report.forCritic).toEqual(['ask-page', 'learn-now', 'chat-people']);
    expect(report.settled).toEqual(['dev-comment-thread']);
    expect(report.text).toContain('3 surfaces reached through a shared file');
    expect(report.text).toContain('learn-now: phone-light differs in 812 pixels');
    expect(report.text).toContain('chat-people: new on this branch');
    expect(report.text).toContain('building 3 min 20 s, shooting 61.0 s, comparing 900 ms');
    expect(report.text).toContain('npm run ui-check -- 2770 <surface> <round>');
  });

  it('says so when nothing is left for the critic', () => {
    const report = compareReport({
      name: '#1',
      step: 1,
      named: [],
      comparisons: [{ surface: 'ui-kit', outcome: 'same', reasons: [] }],
      newOnBranch: [],
      timings,
    });
    expect(report.forCritic).toEqual([]);
    expect(report.text).toContain('Nothing for the critic');
  });
});

describe('the widest shared parts have a surface of their own', () => {
  it('stops at the comment body, the comment count, the Dash mark and the page frame', () => {
    expect(surfaceOfComponent('components/dev/comment-body.tsx')).toBe('dev-comment-thread');
    expect(surfaceOfComponent('components/dev/comment-count.tsx')).toBe('dev-plan-tree');
    expect(surfaceOfComponent('components/ui/dash-mark.tsx')).toBe('dash-mark');
    for (const file of ['page-header', 'breadcrumb', 'back-link', 'page-width']) {
      expect(surfacesForFiles([`components/shell/${file}.tsx`])).toEqual(['shell-page-header']);
    }
  });
});

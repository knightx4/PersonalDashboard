import { describe, expect, it } from 'vitest';
import {
  filesOfStep,
  isScreenFile,
  uiCheckRefusal,
  uiGuardSql,
  unpassedSurfaces,
  type GitRunner,
} from './ui-check-guard';

const screen = ['app/news/saved/saved-view.tsx', 'lib/news/load.ts'];

describe('uiCheckRefusal', () => {
  it('refuses a screen change with a surface unchecked, naming it', () => {
    const refusal = uiCheckRefusal({
      step: 42,
      files: screen,
      surfaces: ['news-saved', 'news-home'],
      checks: [{ surface: 'news-home', round: 1, verdict: 'pass' }],
    });
    expect(refusal).toContain('news-saved (no round recorded)');
    expect(refusal).not.toContain('news-home');
    expect(refusal).toContain('npm run ui-check -- 42 news-saved 1');
  });

  it('closes once every surface passes', () => {
    expect(
      uiCheckRefusal({
        step: 42,
        files: screen,
        surfaces: ['news-saved'],
        checks: [
          { surface: 'news-saved', round: 1, verdict: 'fix' },
          { surface: 'news-saved', round: 2, verdict: 'pass' },
        ],
      }),
    ).toBeNull();
  });

  it('reads the latest round: a pass then a failed re-shoot is not passed', () => {
    const refusal = uiCheckRefusal({
      step: 42,
      files: screen,
      surfaces: ['news-saved'],
      checks: [
        { surface: 'news-saved', round: 2, verdict: 'fix' },
        { surface: 'news-saved', round: 1, verdict: 'pass' },
      ],
    });
    expect(refusal).toContain('news-saved (round 2 asked for fixes)');
    expect(refusal).toContain('npm run ui-check -- 42 news-saved 3');
  });

  it('does not count a pass recorded for another surface', () => {
    expect(
      uiCheckRefusal({
        step: 7,
        files: ['components/todo/day.tsx'],
        surfaces: ['todo-day'],
        checks: [{ surface: 'todo-week', round: 1, verdict: 'pass' }],
      }),
    ).toContain('todo-day');
  });

  it('lets a screen the person accepted after round 3 close (plan #1610)', () => {
    expect(
      uiCheckRefusal({
        step: 42,
        files: screen,
        surfaces: ['news-saved'],
        checks: [
          { surface: 'news-saved', round: 3, verdict: 'fix' },
          { surface: 'news-saved', round: 4, verdict: 'accepted' },
        ],
      }),
    ).toBeNull();
  });

  it('lets a step that changed no screen close', () => {
    expect(
      uiCheckRefusal({ step: 7, files: ['lib/news/load.ts', 'scripts/plan.ts'], surfaces: [], checks: [] }),
    ).toBeNull();
  });

  it('has nothing to check for a screen file no surface stands for', () => {
    expect(uiCheckRefusal({ step: 7, files: ['app/dev/odd/page.tsx'], surfaces: [], checks: [] })).toBeNull();
  });
});

describe('isScreenFile', () => {
  it('takes .tsx under app/ and components/, not tests, the gallery or other folders', () => {
    expect(isScreenFile('app/jobs/page.tsx')).toBe(true);
    expect(isScreenFile('./components/ui/button.tsx')).toBe(true);
    expect(isScreenFile('app/jobs/actions.ts')).toBe(false);
    expect(isScreenFile('app/jobs/page.test.tsx')).toBe(false);
    expect(isScreenFile('app/preview/surfaces.tsx')).toBe(false);
    expect(isScreenFile('lib/plan/thing.tsx')).toBe(false);
  });
});

describe('unpassedSurfaces', () => {
  it('keeps the order given and reports the last round', () => {
    expect(
      unpassedSurfaces(['b', 'a'], [
        { surface: 'a', round: 3, verdict: 'fix' },
        { surface: 'a', round: 1, verdict: 'fix' },
      ]),
    ).toEqual([
      { surface: 'b', round: null, verdict: null },
      { surface: 'a', round: 3, verdict: 'fix' },
    ]);
  });
});

describe('filesOfStep', () => {
  function fakeGit(parents: string): { git: GitRunner; calls: string[][] } {
    const calls: string[][] = [];
    const git: GitRunner = (args) => {
      calls.push(args);
      if (args[0] === 'rev-list') return `${parents}\n`;
      if (args[0] === 'diff') return 'app/a/page.tsx\nlib/a.ts\n';
      if (args[0] === 'show') return 'lib/own.ts\n';
      if (args[0] === 'log') return 'components/b.tsx\n\nlib/a.ts\n';
      throw new Error('unexpected');
    };
    return { git, calls };
  }

  it('reads a merge against its first parent and adds the commits tagged with the step', () => {
    const { git, calls } = fakeGit('abc1234 p1 p2');
    expect(filesOfStep(12, 'abc1234', git)).toEqual(['app/a/page.tsx', 'components/b.tsx', 'lib/a.ts']);
    expect(calls).toContainEqual(['diff', '--name-only', 'abc1234^1', 'abc1234']);
    expect(calls.find((c) => c[0] === 'log')).toContain('--grep=(plan #12)');
  });

  it('reads an ordinary commit with show', () => {
    const { git } = fakeGit('abc1234 p1');
    expect(filesOfStep(12, 'abc1234', git)).toEqual(['components/b.tsx', 'lib/a.ts', 'lib/own.ts']);
  });

  it('refuses what is not a sha, and throws when git does', () => {
    expect(() => filesOfStep(12, 'main; rm', () => '')).toThrow();
    expect(() =>
      filesOfStep(12, 'abc1234', () => {
        throw new Error('bad object');
      }),
    ).toThrow('bad object');
  });
});

describe('uiGuardSql', () => {
  it('asks for every surface whose latest round is not a pass', () => {
    const sql = uiGuardSql(42, ['news-saved', 'news-home']);
    expect(sql).toContain("array['news-saved', 'news-home']");
    expect(sql).toContain('c.step = 42');
    expect(sql).toContain('order by c.round desc limit 1');
    expect(sql).toContain("not in ('pass', 'accepted')");
    expect(sql).toContain('from plan_items p where p.number = 42');
  });

  it('takes a named account, and refuses anything that could break out of the quotes', () => {
    expect(uiGuardSql(1, ['a'], 'd001bb0f-ffe8-4bfb-880f-17dd1a62b685')).toContain(
      "c.user_id = 'd001bb0f-ffe8-4bfb-880f-17dd1a62b685'",
    );
    expect(() => uiGuardSql(1, ["a'; select 1"])).toThrow();
    expect(() => uiGuardSql(1, ['a'], "x' or 1=1")).toThrow();
  });
});

/**
 * What the dot on the status line is allowed to claim.
 *
 * Three properties, and all three are about not lying. A reading that is old
 * stops being drawn as a colour, because the whole failure this exists to stop
 * is main sitting red for two hours while something said otherwise. A GitHub
 * refusal is a different fact from having nothing, and reads as the sentence
 * that says which permission the key is short of. And nothing is judged stale
 * before the component has mounted, because the age of a reading is the
 * reader's clock and the server does not have it.
 */
import { describe, expect, it } from 'vitest';
import {
  deployLine,
  failureReason,
  migrationsLine,
  MAIN_CHECK_STALE_MINUTES,
  MAIN_DOT_MEANING,
  MAIN_DOT_ORDER,
  mainCheckStale,
  mainCheckTitle,
  mainDot,
  type MainCheck,
  type MainDot,
} from '@/lib/plan/main-check';

const NOW = Date.parse('2026-09-18T21:40:00.000Z');
const minutesAgo = (n: number) => new Date(NOW - n * 60_000).toISOString();

function check(over: Partial<MainCheck> = {}): MainCheck {
  return {
    sha: 'a405587bd91f0c3e2d4a6b8c9f1e2d3a4b5c6d7e',
    conclusion: 'passed',
    checkedAt: minutesAgo(1),
    error: null,
    reason: null,
    runUrl: null,
    deployState: null,
    deployUrl: null,
    deployError: null,
    unapplied: null,
    migrationsError: null,
    ...over,
  };
}

describe('mainDot', () => {
  it('draws each conclusion main can take', () => {
    expect(mainDot(check({ conclusion: 'passed' }), NOW)).toBe('passed');
    expect(mainDot(check({ conclusion: 'failed' }), NOW)).toBe('failed');
    expect(mainDot(check({ conclusion: 'running' }), NOW)).toBe('running');
  });

  it('does not call a commit nothing checked a pass', () => {
    expect(mainDot(check({ conclusion: 'none' }), NOW)).toBe('unknown');
  });

  it('is unknown with nothing stored at all', () => {
    expect(mainDot(null, NOW)).toBe('unknown');
  });

  it('is unknown when GitHub refused, however recently it was asked', () => {
    expect(
      mainDot(check({ conclusion: null, sha: null, error: 'GITHUB_READ_TOKEN was rejected' }), NOW),
    ).toBe('unknown');
  });

  it('stops standing behind a reading once it is stale', () => {
    const old = check({ conclusion: 'passed', checkedAt: minutesAgo(MAIN_CHECK_STALE_MINUTES) });
    expect(mainDot(old, NOW)).toBe('unknown');
    expect(mainDot(check({ checkedAt: minutesAgo(MAIN_CHECK_STALE_MINUTES - 1) }), NOW)).toBe(
      'passed',
    );
  });

  it('judges nothing stale before the reader has a clock', () => {
    const ancient = check({ conclusion: 'failed', checkedAt: minutesAgo(600) });
    // Pre-mount: the stored conclusion as it stands, so the dot does not change
    // shape or place on hydration.
    expect(mainDot(ancient, null)).toBe('failed');
    expect(mainDot(ancient, NOW)).toBe('unknown');
  });

  it('treats a timestamp it cannot read as stale rather than fresh', () => {
    expect(mainCheckStale(check({ checkedAt: 'not a time' }), NOW)).toBe(true);
  });
});

describe('mainCheckTitle', () => {
  it('names the commit and the time it was read', () => {
    expect(mainCheckTitle(check(), NOW, '22:39')).toBe(
      'main a405587 passed its checks. Read at 22:39.',
    );
  });

  it('leaves the time out until the reader has one', () => {
    expect(mainCheckTitle(check({ conclusion: 'failed' }), null, null)).toBe(
      'main a405587 failed its checks.',
    );
  });

  it('says how old a stale reading is rather than repeating it as fact', () => {
    const said = mainCheckTitle(check({ checkedAt: minutesAgo(94) }), NOW, '20:06');
    expect(said).toContain('94 minutes ago');
    expect(said).toContain('nothing has read it since');
  });

  it('repeats the refusal whole, since it names the permission to fix', () => {
    const said = mainCheckTitle(
      check({
        conclusion: null,
        sha: null,
        error: 'GITHUB_READ_TOKEN is missing a permission (403). Give it "Actions: Read".',
      }),
      NOW,
      '22:39',
    );
    expect(said).toContain('Actions: Read');
    expect(said).toContain('could not be read');
  });

  it('says nothing has been read when nothing has', () => {
    expect(mainCheckTitle(null, NOW, '22:39')).toBe('CI on main has not been read yet.');
  });
});

/**
 * The legend behind the dot: the panel a click opens has to cover every colour
 * the dot can be, or a reader meets one the panel does not explain.
 */
describe('the dot legend', () => {
  it('explains every state the dot can take, once each', () => {
    const dots: MainDot[] = ['passed', 'failed', 'running', 'unknown'];
    expect([...MAIN_DOT_ORDER].sort()).toEqual([...dots].sort());
    for (const dot of dots) expect(MAIN_DOT_MEANING[dot]).toMatch(/\S/);
  });

  it('names the colour, since the legend is what maps a hue to a meaning', () => {
    expect(MAIN_DOT_MEANING.passed).toContain('Green');
    expect(MAIN_DOT_MEANING.failed).toContain('Red');
    expect(MAIN_DOT_MEANING.running).toContain('Amber');
    expect(MAIN_DOT_MEANING.unknown).toContain('Grey');
  });
});

describe('failureReason', () => {
  it('names the job and the step that broke', () => {
    expect(
      failureReason([
        {
          name: 'CI',
          conclusion: 'failure',
          jobs: [
            {
              name: 'check',
              conclusion: 'failure',
              runner_id: 1,
              steps: [
                { name: 'Typecheck', conclusion: 'success' },
                { name: 'Test', conclusion: 'failure' },
                { name: 'Build', conclusion: 'skipped' },
              ],
            },
            {
              name: 'design',
              conclusion: 'failure',
              runner_id: 2,
              steps: [{ name: 'UI laws', conclusion: 'failure' }],
            },
            { name: 'audit', conclusion: 'success', runner_id: 3, steps: [] },
          ],
        },
      ]),
    ).toBe('Failed at check › Test, design › UI laws.');
  });

  // What main did on 22 September: three jobs, none given a runner, no steps,
  // no logs. Pointing at the code would send somebody into logs that do not
  // exist.
  it('says GitHub never started jobs that got no runner, and where to look', () => {
    const said = failureReason([
      {
        name: 'CI',
        conclusion: 'failure',
        jobs: ['check', 'audit', 'design'].map((name) => ({
          name,
          conclusion: 'failure',
          runner_id: null,
          steps: [],
        })),
      },
    ]);
    expect(said).toContain('GitHub never started check, audit, design');
    expect(said).toContain('Actions minutes');
    expect(said).toContain('github.com/settings/billing');
  });

  it('says a run with no jobs could not be started at all', () => {
    expect(failureReason([{ name: 'CI', conclusion: 'startup_failure', jobs: [] }])).toContain(
      'could not start the workflow',
    );
  });

  it('has nothing to add when no job failed', () => {
    expect(failureReason([])).toBeNull();
    expect(
      failureReason([
        { name: 'CI', conclusion: 'failure', jobs: [{ name: 'check', conclusion: 'success' }] },
      ]),
    ).toBeNull();
  });

  it('stays inside the column', () => {
    const jobs = Array.from({ length: 60 }, (_, i) => ({
      name: `job-with-a-long-name-${i}`,
      conclusion: 'failure',
      runner_id: 1,
      steps: [{ name: 'a step with a long name', conclusion: 'failure' }],
    }));
    expect(
      failureReason([{ name: 'CI', conclusion: 'failure', jobs }])!.length,
    ).toBeLessThanOrEqual(500);
  });
});

describe('mainDot with the deploy and migrations', () => {
  it('turns red on a failed or missing deploy even when CI passed', () => {
    expect(mainDot(check({ deployState: 'failed' }), NOW)).toBe('failed');
    expect(mainDot(check({ deployState: 'missing' }), NOW)).toBe('failed');
  });

  it('turns amber while a passed commit is deploying', () => {
    expect(mainDot(check({ deployState: 'deploying' }), NOW)).toBe('running');
    expect(mainDot(check({ deployState: 'deployed' }), NOW)).toBe('passed');
  });

  it('turns red when a migration on main is not applied', () => {
    expect(mainDot(check({ unapplied: ['migrations/0097_x.sql'] }), NOW)).toBe('failed');
    expect(mainDot(check({ unapplied: [] }), NOW)).toBe('passed');
  });

  it('never makes a failed CI reading look better', () => {
    expect(
      mainDot(check({ conclusion: 'failed', deployState: 'deployed', unapplied: [] }), NOW),
    ).toBe('failed');
  });

  // A reading that could not be taken says so in the panel. It is not evidence
  // that anything is wrong, so the dot stays as CI has it.
  it('leaves the dot alone when the other readings were refused', () => {
    expect(mainDot(check({ deployError: 'refused', migrationsError: 'refused' }), NOW)).toBe(
      'passed',
    );
  });

  it('says in the sentence what turned the dot', () => {
    const said = mainCheckTitle(
      check({ deployState: 'failed', unapplied: ['a.sql', 'b.sql'] }),
      NOW,
      '21:39',
    );
    expect(said).toContain('passed its checks');
    expect(said).toContain('Its deploy failed.');
    expect(said).toContain('2 migrations are not applied.');
  });
});

describe('deployLine and migrationsLine', () => {
  it('have nothing to say about a reading from before they existed', () => {
    expect(deployLine(check())).toBeNull();
    expect(migrationsLine(check())).toBeNull();
  });

  it('say what was read, or why it could not be', () => {
    expect(deployLine(check({ deployState: 'deployed' }))).toBe('Deployed to production.');
    expect(deployLine(check({ deployError: 'Give it "Deployments: Read"' }))).toContain(
      'Deployments: Read',
    );
    expect(migrationsLine(check({ unapplied: [] }))).toBe(
      'Every migration on main is applied to the live database.',
    );
    expect(migrationsLine(check({ unapplied: ['migrations/0097_x.sql'] }))).toContain(
      'migrations/0097_x.sql',
    );
  });
});

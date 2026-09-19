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

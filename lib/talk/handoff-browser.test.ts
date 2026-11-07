import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { browserChoice, browserCloseRefusal, MAX_BROWSER_REASON, signInWall } from './handoff-browser';
import { THREAD_SQL } from './handoff-session';

describe('browserChoice (plan #3040.2)', () => {
  it('keeps chrome and headless as the row names them, and none as no browser', () => {
    expect(browserChoice('chrome', 'Claude in Chrome was connected.')).toEqual({
      ok: true,
      browser: 'chrome',
      reason: 'Claude in Chrome was connected.',
    });
    expect(browserChoice(' Headless ', 'Chrome was not reachable;  the page is public.')).toEqual({
      ok: true,
      browser: 'headless',
      reason: 'Chrome was not reachable; the page is public.',
    });
    expect(browserChoice('none', 'The page needs a sign-in and Chrome was not reachable.')).toMatchObject({
      ok: true,
      browser: null,
    });
  });

  it('refuses an unknown route or a missing or long reason', () => {
    expect(browserChoice('firefox', 'x')).toMatchObject({ ok: false, error: expect.stringMatching(/--route/) });
    expect(browserChoice(null, 'x')).toMatchObject({ ok: false });
    expect(browserChoice('headless', '   ')).toMatchObject({ ok: false, error: expect.stringMatching(/--reason/) });
    expect(browserChoice('headless', 'x'.repeat(MAX_BROWSER_REASON + 1))).toMatchObject({ ok: false });
  });
});

describe('browserCloseRefusal (plan #3040.2)', () => {
  const task = { browserTask: true, browser: null, browserReason: null };

  it('holds a browser task done until its route is recorded', () => {
    expect(browserCloseRefusal(task, true)).toMatch(/handoff-session\.ts browser/);
    expect(browserCloseRefusal({ ...task, browser: 'headless', browserReason: 'public page' }, true)).toBeNull();
    expect(browserCloseRefusal({ ...task, browserReason: 'needs a sign-in' }, true)).toBeNull();
  });

  it('lets a failure and a hand-off that is no browser task close as before', () => {
    expect(browserCloseRefusal(task, false)).toBeNull();
    expect(browserCloseRefusal({ ...task, browserTask: false }, true)).toBeNull();
    expect(browserCloseRefusal(null, true)).toBeNull();
  });

  it('reads the columns it checks', () => {
    expect(THREAD_SQL).toMatch(/browser_task, browser, browser_reason/);
  });
});

describe('signInWall (plan #3040.2)', () => {
  it('sees a password box or a sign-in address', () => {
    expect(signInWall({ url: 'https://example.com/', passwordFields: 1 })).toBe(true);
    expect(signInWall({ url: 'https://github.com/login', passwordFields: 0 })).toBe(true);
    expect(signInWall({ url: 'https://shop.example/users/sign_in?next=/cart', passwordFields: 0 })).toBe(true);
    expect(signInWall({ url: 'https://accounts.google.com/v3/signin/identifier', passwordFields: 0 })).toBe(true);
    expect(signInWall({ url: 'https://login.microsoftonline.com/common/oauth2', passwordFields: 0 })).toBe(true);
  });

  it('leaves a public page alone', () => {
    expect(signInWall({ url: 'https://example.com/', passwordFields: 0 })).toBe(false);
    expect(signInWall({ url: 'https://example.com/blog/authors', passwordFields: 0 })).toBe(false);
    expect(signInWall({ url: 'https://www.loginsoft.com/', passwordFields: 0 })).toBe(false);
    expect(signInWall({ url: 'not a url', passwordFields: 0 })).toBe(false);
  });
});

describe('the dash-backup skill (plan #3040.2)', () => {
  const skill = readFileSync(join(process.cwd(), '.claude/skills/dash-backup/SKILL.md'), 'utf8');

  it('sends a browser task through Chrome, then headless, then a stop, and records the route', () => {
    expect(skill).toMatch(/## A browser task/);
    expect(skill).toMatch(/mcp__claude-in-chrome__/);
    expect(skill).toMatch(/scripts\/browse\.ts/);
    expect(skill).toMatch(/handoff-session\.ts browser <id> --route/);
  });
});

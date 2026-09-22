import { describe, expect, it, vi } from 'vitest';
import { closeRefusal, commitOnMain, type CommitLanding } from '@/lib/plan/github';

const answering = (body: unknown, status = 200) =>
  vi.fn(async () => new Response(JSON.stringify(body), { status }));

describe('commitOnMain', () => {
  it('asks GitHub to compare main with the commit, with the key on it', async () => {
    vi.stubEnv('GITHUB_READ_TOKEN', 'ghp_test');
    const fetchFn = answering({ status: 'behind' });

    const landing = await commitOnMain({ sha: 'a405587', fetch: fetchFn as never });

    expect(landing).toEqual({ onMain: true, status: 'behind', error: null });
    const [url, init] = fetchFn.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toContain('/repos/knightx4/PersonalDashboard/compare/main...a405587');
    expect((init.headers as Record<string, string>).authorization).toBe('Bearer ghp_test');
    vi.unstubAllEnvs();
  });

  it('counts the commit that is main itself as on main', async () => {
    vi.stubEnv('GITHUB_READ_TOKEN', 'ghp_test');
    await expect(
      commitOnMain({ sha: 'a405587', fetch: answering({ status: 'identical' }) as never }),
    ).resolves.toMatchObject({ onMain: true });
    vi.unstubAllEnvs();
  });

  it('says not on main for work main has never carried', async () => {
    vi.stubEnv('GITHUB_READ_TOKEN', 'ghp_test');
    for (const status of ['ahead', 'diverged']) {
      await expect(
        commitOnMain({ sha: 'a405587', fetch: answering({ status }) as never }),
      ).resolves.toEqual({ onMain: false, status, error: null });
    }
    vi.unstubAllEnvs();
  });

  it('says so rather than guessing when there is no key', async () => {
    vi.stubEnv('GITHUB_READ_TOKEN', '');
    const landing = await commitOnMain({ sha: 'a405587' });
    expect(landing.onMain).toBeNull();
    expect(landing.error).toContain('GITHUB_READ_TOKEN');
    vi.unstubAllEnvs();
  });

  it('carries a refusal back as no answer rather than as not on main', async () => {
    vi.stubEnv('GITHUB_READ_TOKEN', 'ghp_test');
    const landing = await commitOnMain({
      sha: 'a405587',
      fetch: answering({ message: 'Not Found' }, 404) as never,
    });
    expect(landing.onMain).toBeNull();
    expect(landing.error).toContain('404');
    vi.unstubAllEnvs();
  });

  it('treats a comparison with no status as no answer', async () => {
    vi.stubEnv('GITHUB_READ_TOKEN', 'ghp_test');
    const landing = await commitOnMain({ sha: 'a405587', fetch: answering({}) as never });
    expect(landing.onMain).toBeNull();
    expect(landing.error).toContain('a405587');
    vi.unstubAllEnvs();
  });
});

const landing = (over: Partial<CommitLanding>): CommitLanding => ({
  onMain: null,
  status: null,
  error: null,
  ...over,
});

describe('closeRefusal', () => {
  it('lets a close on main through', () => {
    expect(
      closeRefusal({ sha: 'a405587', landing: landing({ onMain: true, status: 'behind' }) }),
    ).toBeNull();
  });

  it('refuses a commit that is not on main, naming the branch it is on', () => {
    const said = closeRefusal({
      sha: 'a405587',
      landing: landing({ onMain: false, status: 'diverged' }),
      branches: ['claude/festive-faraday-32duwy', 'origin/claude/festive-faraday-32duwy', 'main'],
    });
    expect(said).toContain('a405587');
    expect(said).toContain('is not on main');
    expect(said).toContain('claude/festive-faraday-32duwy');
    // Main is not one of the branches worth naming: we are here because it
    // does not carry the commit.
    expect(said).not.toContain('on main, claude');
  });

  it('says no branch carries it when the commit is nowhere this checkout knows', () => {
    const said = closeRefusal({
      sha: 'a405587',
      landing: landing({ onMain: false, status: 'diverged' }),
      branches: [],
    });
    expect(said).toContain('no branch here carries it');
  });

  it('refuses a close that could not reach GitHub, and repeats what it said', () => {
    const said = closeRefusal({
      sha: 'a405587',
      landing: landing({
        error: 'No GITHUB_READ_TOKEN is set, so whether a commit is on main cannot be read.',
      }),
    });
    expect(said).toContain('could not be read');
    expect(said).toContain('GITHUB_READ_TOKEN');
  });
});

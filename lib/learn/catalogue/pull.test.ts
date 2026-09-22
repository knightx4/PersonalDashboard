import { describe, expect, it, vi } from 'vitest';
import type { EmbedSweepResult } from './embed-sweep';
import { MAX_EMBEDDED, MAX_TITLES, parseTitles, pullArticles, type PullPorts } from './pull';
import type { SweepResult } from './sweep';

function stored(title: string, written = 4): SweepResult {
  return { ok: true, title, itemId: `item-${title}`, written, removed: 0 };
}

function swept(overrides: Partial<EmbedSweepResult> = {}): EmbedSweepResult {
  return { embedded: 0, skipped: 0, calls: 0, tokens: 0, model: null, stopped: null, ...overrides };
}

function ports(overrides: Partial<PullPorts> = {}): PullPorts {
  return {
    sweep: vi.fn(async (title: string) => stored(title)),
    embed: vi.fn(async () => swept({ embedded: 40, calls: 1, tokens: 9000, model: 'voyage-3.5' })),
    ...overrides,
  };
}

describe('parseTitles', () => {
  it('reads one title per line and drops blanks and repeats', () => {
    expect(parseTitles('Marginal utility\n\n  Indifference curve \nmarginal utility\nMarginal_utility')).toEqual({
      ok: true,
      titles: ['Marginal utility', 'Indifference curve'],
    });
  });

  it('reads a pasted article link as its title', () => {
    expect(
      parseTitles('https://en.wikipedia.org/wiki/Consumer_surplus#History\nhttps://en.m.wikipedia.org/wiki/Pareto_efficiency'),
    ).toEqual({ ok: true, titles: ['Consumer surplus', 'Pareto efficiency'] });
    expect(parseTitles('https://en.wikipedia.org/wiki/Engel%27s_law')).toEqual({
      ok: true,
      titles: ["Engel's law"],
    });
  });

  it('refuses an empty list and one longer than a press can fetch', () => {
    expect(parseTitles(' \n ').ok).toBe(false);
    const many = Array.from({ length: MAX_TITLES + 1 }, (_, i) => `Article ${i}`).join('\n');
    const result = parseTitles(many);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toContain(String(MAX_TITLES));
  });
});

describe('pullArticles', () => {
  it('stores ten articles in order and then embeds once', async () => {
    const titles = Array.from({ length: 10 }, (_, i) => `Article ${i}`);
    const p = ports();

    const report = await pullArticles(p, titles);

    expect(vi.mocked(p.sweep).mock.calls.map(([title]) => title)).toEqual(titles);
    expect(report.articles).toHaveLength(10);
    expect(report.articles.every((article) => article.ok)).toBe(true);
    expect(p.embed).toHaveBeenCalledTimes(1);
    expect(p.embed).toHaveBeenCalledWith(MAX_EMBEDDED);
    expect(report.embedding).toEqual({ embedded: 40, tokens: 9000, stopped: null, capped: false });
  });

  it('reports a Wikipedia refusal against its title and keeps the rest', async () => {
    const p = ports({
      sweep: vi.fn(async (title: string) =>
        title === 'Nonsense page'
          ? ({ ok: false, reason: 'not-found', detail: 'no article called Nonsense page' } as const)
          : stored(title),
      ),
    });

    const report = await pullArticles(p, ['Marginal utility', 'Nonsense page', 'Indifference curve']);

    expect(report.articles[1]).toEqual({
      ok: false,
      asked: 'Nonsense page',
      reason: 'not-found',
      detail: 'no article called Nonsense page',
    });
    expect(report.articles.filter((article) => article.ok)).toHaveLength(2);
    expect(p.embed).toHaveBeenCalledTimes(1);
  });

  it('turns a store that throws into a line rather than losing the press', async () => {
    const p = ports({
      sweep: vi.fn(async (title: string) => {
        if (title === 'Second') throw new Error('connection refused');
        return stored(title);
      }),
    });

    const report = await pullArticles(p, ['First', 'Second', 'Third']);

    expect(report.articles[1]).toMatchObject({ ok: false, reason: 'store', detail: 'connection refused' });
    expect(report.articles[2]).toMatchObject({ ok: true, title: 'Third' });
  });

  it('does not embed when nothing was stored', async () => {
    const p = ports({
      sweep: vi.fn(async () => ({ ok: false, reason: 'not-found', detail: 'missing' }) as const),
    });

    const report = await pullArticles(p, ['A', 'B']);

    expect(p.embed).not.toHaveBeenCalled();
    expect(report.embedding).toBeNull();
  });

  it('shows a missing key instead of swallowing it', async () => {
    const p = ports({
      embed: vi.fn(async () =>
        swept({ stopped: { reason: 'no-key', detail: 'EMBEDDING_API_KEY is not set on this deployment' } }),
      ),
    });

    const report = await pullArticles(p, ['Marginal utility']);

    expect(report.embedding?.stopped).toEqual({
      reason: 'no-key',
      detail: 'EMBEDDING_API_KEY is not set on this deployment',
    });
  });

  it('shows a Voyage refusal with what was embedded before it', async () => {
    const p = ports({
      embed: vi.fn(async () =>
        swept({ embedded: 64, calls: 2, tokens: 30000, stopped: { reason: 'http', detail: '401 Unauthorized' } }),
      ),
    });

    const report = await pullArticles(p, ['Marginal utility']);

    expect(report.embedding).toEqual({
      embedded: 64,
      tokens: 30000,
      stopped: { reason: 'http', detail: '401 Unauthorized' },
      capped: false,
    });
  });

  it('reports an embedding pass that throws as stopped', async () => {
    const p = ports({ embed: vi.fn(async () => Promise.reject(new Error('DATABASE_URL is not set'))) });

    const report = await pullArticles(p, ['Marginal utility']);

    expect(report.embedding?.stopped).toEqual({ reason: 'error', detail: 'DATABASE_URL is not set' });
  });

  it('says when a press stopped at the cap with more possibly left', async () => {
    const p = ports({ embed: vi.fn(async () => swept({ embedded: MAX_EMBEDDED })) });

    const report = await pullArticles(p, ['Marginal utility']);

    expect(report.embedding?.capped).toBe(true);
  });
});

import type { EmbedSweepResult } from './embed-sweep';
import type { SweepResult } from './sweep';

/**
 * Pulling a list of Wikipedia articles into the catalogue from the app.
 *
 * The same two passes `npm run catalogue -- "…" --embed` makes: store each
 * article, then embed every segment that has no vector yet. This module is the
 * part of that a test can reach: reading the titles out of what was typed, the
 * loop over them, and the report the page shows. The database and the two
 * providers come in as ports.
 *
 * Nothing is thrown past it. A mistyped title, a Wikipedia refusal, a missing
 * key and a database error all come back as lines in the report, because the
 * person pressing the button needs to see which of the ten went wrong, and a
 * thrown error would lose the nine that worked.
 */

/**
 * The most titles one press takes.
 *
 * #765 asked for twenty to finish inside one function run. Every article is a
 * Wikipedia request and a transaction, and every sixty-four sections is an
 * embedding call, so twenty-five leaves room without letting a pasted list of
 * two hundred run into the time limit halfway.
 */
export const MAX_TITLES = 25;

/**
 * The most segments one press embeds.
 *
 * The embedding pass works through every segment in the catalogue that has no
 * vector, including ones an earlier run left behind, such as a course pulled
 * in by the script without `--embed`. Capping it keeps a press inside the time
 * limit whatever the backlog is; the next press carries on from where it
 * stopped.
 */
export const MAX_EMBEDDED = 1500;

export type ParsedTitles = { ok: true; titles: string[] } | { ok: false; error: string };

/**
 * One title per line, as typed or as pasted.
 *
 * A pasted article link is read as its title, because copying the address bar
 * is the quickest way to name an article exactly. Blank lines and repeats are
 * dropped, so pasting the same list twice does not fetch everything twice.
 */
export function parseTitles(raw: string): ParsedTitles {
  const seen = new Set<string>();
  const titles: string[] = [];

  for (const line of raw.split(/\r?\n/)) {
    const title = titleFromLine(line);
    if (!title) continue;
    const key = title.toLowerCase().replace(/_/g, ' ');
    if (seen.has(key)) continue;
    seen.add(key);
    titles.push(title);
  }

  if (titles.length === 0) return { ok: false, error: 'Name at least one article, one per line.' };
  if (titles.length > MAX_TITLES) {
    return {
      ok: false,
      error: `${titles.length} articles is more than one press can fetch. Send at most ${MAX_TITLES} at a time.`,
    };
  }
  return { ok: true, titles };
}

function titleFromLine(line: string): string {
  const trimmed = line.trim();
  if (!trimmed) return '';

  const link = trimmed.match(/^https?:\/\/[a-z-]+(?:\.m)?\.wikipedia\.org\/wiki\/([^?#]+)/i);
  if (!link) return trimmed;

  try {
    return decodeURIComponent(link[1]).replace(/_/g, ' ').trim();
  } catch {
    return link[1].replace(/_/g, ' ').trim();
  }
}

export type PulledArticle =
  | { ok: true; asked: string; title: string; segments: number; removed: number }
  | { ok: false; asked: string; reason: string; detail: string };

/**
 * The embedding pass that follows a pull. `stopped` is set when Voyage
 * refused, the key is missing, the press ran out of time, or the pass threw.
 */
export type EmbeddingReport = {
  embedded: number;
  tokens: number;
  stopped: { reason: string; detail: string } | null;
  /** True when it stopped at MAX_EMBEDDED with segments possibly left. */
  capped: boolean;
};

export type PullReport = {
  articles: PulledArticle[];
  /** Null when the pass did not run because no article was stored. */
  embedding: EmbeddingReport | null;
};

export type PullPorts = {
  sweep(title: string): Promise<SweepResult>;
  embed(limit: number): Promise<EmbedSweepResult>;
};

function message(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/**
 * Store each article in turn, then embed.
 *
 * One at a time rather than all at once: Wikipedia asks API clients not to
 * make parallel requests, and each store is its own transaction, so a failure
 * on the seventh leaves the first six stored.
 */
export async function pullArticles(ports: PullPorts, titles: string[]): Promise<PullReport> {
  const articles: PulledArticle[] = [];

  for (const asked of titles) {
    try {
      const result = await ports.sweep(asked);
      articles.push(
        result.ok
          ? { ok: true, asked, title: result.title, segments: result.written, removed: result.removed }
          : { ok: false, asked, reason: result.reason, detail: result.detail },
      );
    } catch (error) {
      articles.push({ ok: false, asked, reason: 'store', detail: message(error) });
    }
  }

  if (!articles.some((article) => article.ok)) return { articles, embedding: null };

  return { articles, embedding: await embedAfterPull(ports.embed) };
}

/**
 * The embedding pass after something was stored, as a report line. Shared by
 * the article pull and the course pull, and like them it throws nothing.
 */
export async function embedAfterPull(
  embed: (limit: number) => Promise<EmbedSweepResult>,
): Promise<EmbeddingReport> {
  try {
    const swept = await embed(MAX_EMBEDDED);
    return {
      embedded: swept.embedded,
      tokens: swept.tokens,
      stopped: swept.stopped,
      capped: swept.stopped === null && swept.embedded + swept.skipped >= MAX_EMBEDDED,
    };
  } catch (error) {
    return { embedded: 0, tokens: 0, stopped: { reason: 'error', detail: message(error) }, capped: false };
  }
}

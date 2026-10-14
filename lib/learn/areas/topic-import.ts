import 'server-only';

import type { LearnSupabaseClient } from '@/lib/learn/db/schema-name';
import { runEmbedSweep, vectorLiteral, type EmbedSweepResult, type SegmentStore } from '@/lib/learn/catalogue/embed-sweep';
import { embedTexts } from '@/lib/learn/embed/embed';
import { ledgerIdeaSpend } from '@/lib/learn/embed/idea-embedding';
import { dueFilter } from '@/lib/learn/embed/idea-sweep';
import { DEFAULT_EMBEDDING_MODEL, type EmbeddingDimensions } from '@/lib/learn/embed/voyage';
import {
  cleanAliases,
  LEVEL4_INDEX,
  LEVEL4_MIN_ARTICLES,
  LEVEL4_SECTIONS,
  parseLevel4Index,
  parseLevel4Section,
  parseRedirects,
  rawPageUrl,
  REDIRECT_BATCH,
  redirectsUrl,
  resolveTitle,
  statedTotal,
  transcludedPages,
} from '@/lib/learn/areas/level4';

/**
 * The import of Wikipedia's Level 4 topics (plan #2016.1).
 *
 * One call does as much as it can in its time and stops, so it is called
 * again until `remaining` says nothing is left, the same as the areas check:
 *
 *   1. The list, on the first call (no article at level 4 yet) and on a call
 *      asked to refresh it, which is what re-running the import means:
 *      the eleven Level 4 section pages are read and every article not in
 *      learn.area_check_articles is added at level 4. A title already there
 *      is left as it is, so the Level 3 rows keep level 3.
 *   2. The names. Articles whose redirects have not been read (aliases null)
 *      are asked about fifty at a time, one request every REQUEST_GAP_MS,
 *      and each gets its other names, or an empty list when it has none. So
 *      each article's redirects are read once, ever.
 *   3. The vectors. Titles with no embedding are embedded with voyage-4-lite
 *      at 512 dimensions, billed to the app's owner under 'embed-idea'.
 *
 * Wikipedia answers a client that asks too fast with 429. That is a wait, not
 * a failure: the call backs off and, if the wait would run past its time,
 * stops and leaves the rest for the next call.
 */

export const TOPIC_DIMENSIONS: EmbeddingDimensions = 512;

/** Time one call spends; the route's limit is 300 seconds. */
export const IMPORT_BUDGET_MS = 230_000;

/** Between two requests to Wikipedia, so the import never asks in a burst. */
export const REQUEST_GAP_MS = 1_500;

const BACKOFF_MS = [15_000, 30_000, 60_000];

const USER_AGENT = 'PersonalTracker-Learn/1.0 (https://dash.selveyknight.com; one user)';

export type ImportPorts = {
  /** A GET returning the status and body. Injected by the tests. */
  get: (url: string) => Promise<{ status: number; text: string }>;
  sleep: (ms: number) => Promise<void>;
  now: () => number;
};

export const livePorts: ImportPorts = {
  async get(url) {
    const response = await fetch(url, {
      headers: { 'user-agent': USER_AGENT, 'api-user-agent': USER_AGENT },
      signal: AbortSignal.timeout(30_000),
      cache: 'no-store',
    });
    return { status: response.status, text: await response.text() };
  },
  sleep: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
  now: () => Date.now(),
};

export type TopicImportSummary = {
  /** Articles the list pages gave this call, or 0 when the list was not read. */
  listed: number;
  /** Rows the list added. */
  added: number;
  /** Articles whose other names were read this call. */
  named: number;
  embedded: EmbedSweepResult | null;
  /** Articles still to name and to embed after this call. */
  remaining: { names: number; vectors: number };
  /** Why the call stopped short, when it did. */
  stopped: string | null;
};

class OutOfTime extends Error {}

/**
 * A polite GET: spaced from the last one, and retried after a 429 or a
 * maxlag refusal while the deadline allows.
 */
function politeGetter(ports: ImportPorts, deadline: number) {
  let last = 0;
  return async (url: string): Promise<string> => {
    for (let attempt = 0; ; attempt += 1) {
      const gap = last + REQUEST_GAP_MS - ports.now();
      if (gap > 0) await ports.sleep(gap);
      if (ports.now() >= deadline) throw new OutOfTime('ran out of time');
      last = ports.now();
      const { status, text } = await ports.get(url);
      const lagged = status === 200 && text.includes('"code":"maxlag"');
      if (status === 200 && !lagged) return text;
      const retryable = status === 429 || status === 503 || lagged;
      if (!retryable || attempt >= BACKOFF_MS.length) {
        throw new Error(`Wikipedia answered ${status} for ${url}`);
      }
      const wait = BACKOFF_MS[attempt];
      if (ports.now() + wait >= deadline) throw new OutOfTime(`Wikipedia asked us to slow down (${status})`);
      await ports.sleep(wait);
    }
  };
}

type Getter = (url: string) => Promise<string>;

/** Every article on the Level 4 list, each once, with where it was filed. */
export async function fetchLevel4(get: Getter): Promise<{ title: string; section: string }[]> {
  const sections = parseLevel4Index(await get(rawPageUrl(LEVEL4_INDEX)));
  if (sections.length !== LEVEL4_SECTIONS) {
    throw new Error(`The Level 4 index named ${sections.length} sections, not ${LEVEL4_SECTIONS}; nothing was added.`);
  }

  const seen = new Set<string>();
  const articles: { title: string; section: string }[] = [];
  const add = (list: { title: string; section: string }[]) => {
    for (const article of list) {
      const key = article.title.toLowerCase();
      if (seen.has(key)) continue;
      seen.add(key);
      articles.push(article);
    }
  };

  for (const section of sections) {
    const text = await get(rawPageUrl(section.page));
    const found = parseLevel4Section(text, section.name);
    add(found);
    // A section split into subpages pulls them in; their articles are this
    // section's too.
    let fromSubpages = 0;
    for (const page of transcludedPages(text)) {
      const sub = parseLevel4Section(await get(rawPageUrl(page)), section.name);
      fromSubpages += sub.length;
      add(sub);
    }
    const stated = statedTotal(text);
    if (stated !== null && found.length + fromSubpages < stated * 0.9) {
      throw new Error(
        `${section.name} parsed to ${found.length + fromSubpages} articles against the ${stated} its page states; nothing was added.`,
      );
    }
  }

  if (articles.length < LEVEL4_MIN_ARTICLES) {
    throw new Error(
      `The Level 4 pages parsed to ${articles.length} articles, fewer than ${LEVEL4_MIN_ARTICLES}; nothing was added.`,
    );
  }
  return articles;
}

/**
 * The other names of up to REDIRECT_BATCH articles, keyed by the titles as
 * given. Follows the query's continuation until every redirect is in.
 */
export async function fetchAliases(get: Getter, titles: string[]): Promise<Map<string, string[]>> {
  const redirects = new Map<string, { title: string; fragment?: string }[]>();
  const renamed = new Map<string, string>();
  let next: string | null = null;
  do {
    const answer = parseRedirects(await get(redirectsUrl(titles, next)));
    if (!answer) throw new Error('Wikipedia answered the redirects query with something that is not one.');
    for (const [title, list] of answer.byTitle) {
      redirects.set(title, [...(redirects.get(title) ?? []), ...list]);
    }
    for (const [from, to] of answer.renamed) renamed.set(from, to);
    next = answer.next;
  } while (next);

  const out = new Map<string, string[]>();
  for (const title of titles) {
    const actual = resolveTitle(title, renamed);
    const list = redirects.get(actual) ?? [];
    // An article the list links by an old name: that name is one of its
    // names too, and the article's own title is the better match.
    const names = actual !== title ? [{ title: actual }, ...list] : list;
    out.set(title, cleanAliases(title, names));
  }
  return out;
}

async function count(learn: LearnSupabaseClient, column: 'aliases' | 'embedding'): Promise<number> {
  const { count: n, error } = await learn
    .from('area_check_articles')
    .select('id', { count: 'exact', head: true })
    .is(column, null);
  if (error) throw new Error(`Counting articles without ${column} failed: ${error.message}`);
  return n ?? 0;
}

async function hasLevel4(learn: LearnSupabaseClient): Promise<boolean> {
  const { data, error } = await learn.from('area_check_articles').select('id').eq('level', 4).limit(1);
  if (error) throw new Error(`Reading the Level 4 articles failed: ${error.message}`);
  return (data ?? []).length > 0;
}

/** Titles with no vector, embedded at TOPIC_DIMENSIONS. */
export function topicStore(learn: LearnSupabaseClient): SegmentStore {
  return {
    async unembedded(limit) {
      const { data, error } = await learn
        .from('area_check_articles')
        .select('id, title')
        .or(dueFilter(DEFAULT_EMBEDDING_MODEL))
        .order('title')
        .limit(limit);
      if (error) throw new Error(`Reading topics without an embedding failed: ${error.message}`);
      return ((data ?? []) as { id: string; title: string }[]).map((row) => ({ id: row.id, text: row.title }));
    },
    async store(rows) {
      let written = 0;
      // Sixteen at a time keeps a chunk of 128 to a handful of round trips.
      for (let i = 0; i < rows.length; i += 16) {
        const results = await Promise.all(
          rows.slice(i, i + 16).map((row) =>
            learn
              .from('area_check_articles')
              .update({ embedding: vectorLiteral(row.vector, TOPIC_DIMENSIONS), embedding_model: row.model })
              .eq('id', row.id)
              .eq('title', row.text)
              .select('id'),
          ),
        );
        for (const { data, error } of results) {
          if (error) throw new Error(`Storing a topic's embedding failed: ${error.message}`);
          written += (data ?? []).length;
        }
      }
      return written;
    },
  };
}

export type TopicImportOptions = {
  /** Read the list pages again and add any article new to them. */
  refresh?: boolean;
  /** Who the embedding calls are billed to; none means no embedding this call. */
  payer?: string | null;
  ports?: ImportPorts;
  budgetMs?: number;
};

export async function runTopicImportTick(
  learn: LearnSupabaseClient,
  options: TopicImportOptions = {},
): Promise<TopicImportSummary> {
  const ports = options.ports ?? livePorts;
  const payer = options.payer ?? null;
  const deadline = ports.now() + (options.budgetMs ?? IMPORT_BUDGET_MS);
  const get = politeGetter(ports, deadline);
  const summary: TopicImportSummary = {
    listed: 0,
    added: 0,
    named: 0,
    embedded: null,
    remaining: { names: 0, vectors: 0 },
    stopped: null,
  };

  try {
    // 1. The list, on the first call or when asked. A call that only carries
    // on naming and embedding never reads the list pages again.
    if (options.refresh || !(await hasLevel4(learn))) {
      const articles = await fetchLevel4(get);
      summary.listed = articles.length;
      for (let i = 0; i < articles.length; i += 500) {
        const { data, error } = await learn
          .from('area_check_articles')
          .upsert(
            articles.slice(i, i + 500).map((a) => ({ ...a, level: 4 })),
            { onConflict: 'title', ignoreDuplicates: true },
          )
          .select('id');
        if (error) throw new Error(`Adding the Level 4 articles failed: ${error.message}`);
        summary.added += (data ?? []).length;
      }
    }

    // 2. The names.
    for (;;) {
      const { data, error } = await learn
        .from('area_check_articles')
        .select('id, title')
        .is('aliases', null)
        .order('title')
        .limit(REDIRECT_BATCH);
      if (error) throw new Error(`Reading articles to name failed: ${error.message}`);
      const batch = (data ?? []) as { id: string; title: string }[];
      if (batch.length === 0) break;

      const aliases = await fetchAliases(get, batch.map((row) => row.title));
      const results = await Promise.all(
        batch.map((row) =>
          learn
            .from('area_check_articles')
            .update({ aliases: aliases.get(row.title) ?? [] })
            .eq('id', row.id)
            .is('aliases', null),
        ),
      );
      for (const { error: writeError } of results) {
        if (writeError) throw new Error(`Storing other names failed: ${writeError.message}`);
      }
      summary.named += batch.length;
    }
  } catch (error) {
    if (!(error instanceof OutOfTime)) throw error;
    summary.stopped = error.message;
  }

  // 3. The vectors, with whatever time is left, whether or not the names are done.
  if (payer && ports.now() < deadline) {
    summary.embedded = await runEmbedSweep(
      {
        store: topicStore(learn),
        embed: ({ texts, model, onSpend }) =>
          embedTexts({ texts, model, inputType: 'document', dimensions: TOPIC_DIMENSIONS, onSpend }),
        ledger: (report) => ledgerIdeaSpend(learn, payer, [report]),
      },
      { model: DEFAULT_EMBEDDING_MODEL, chunk: 128, deadline, now: ports.now },
    );
    if (summary.embedded.stopped && !summary.stopped) {
      summary.stopped = `${summary.embedded.stopped.reason}: ${summary.embedded.stopped.detail}`;
    }
  }

  summary.remaining = { names: await count(learn, 'aliases'), vectors: await count(learn, 'embedding') };
  return summary;
}

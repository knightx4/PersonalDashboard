import type postgres from 'postgres';
import { fetchWikipediaArticle } from '@/lib/learn/providers/wikipedia';
import { storeArticle, type StoredArticle } from './store';

/**
 * Naming an article and having it stored.
 *
 * Fetch, split, write -- the whole of the Wikipedia sweep, in the order
 * docs/LEARN-SOURCES-SPEC.md puts it: the catalogue is filled before anything
 * is embedded, and embedding is a second pass over the segments this leaves
 * behind with a null `embedding`.
 *
 * A refusal is returned rather than thrown. A mistyped title is an ordinary
 * outcome of naming an article by hand, and the caller wants to print it
 * rather than catch it.
 */

export type SweepResult =
  | ({ ok: true; title: string } & StoredArticle)
  | { ok: false; reason: string; detail: string };

export async function sweepWikipediaArticle(
  sql: postgres.Sql,
  title: string,
): Promise<SweepResult> {
  const article = await fetchWikipediaArticle(title);
  if (!article.ok) return { ok: false, reason: article.reason, detail: article.detail };

  const stored = await storeArticle(sql, article);
  return { ok: true, title: article.title, ...stored };
}

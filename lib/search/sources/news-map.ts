import { readStories } from '@/lib/news/issues/stories';
import type { SearchHit } from '@/lib/search/sources';
import { firstLine } from '@/lib/search/sources/dev-map';

/**
 * Newsletter stories into hits, apart from the read so the matching and the
 * hrefs can be tested without a database -- the same split as dev-map.ts.
 *
 * A story is not a row: it is an entry in the `stories` column of
 * news.issues, which PostgREST cannot filter inside, so the source reads the
 * newest issues and the headline is matched here. A story has no page of its
 * own either, and lands on the issue it came in, which is where it is read.
 *
 * Headlines only. A summary is a paragraph, and the palette's subsequence
 * ranker finds two letters in almost any paragraph, so matching on it would
 * put a story at the top of nearly every search.
 *
 * The same story often arrives in more than one newsletter, so a headline is
 * kept once, from the newest issue it came in (the rows arrive newest first).
 */

export type IssueRow = {
  id: string;
  subject: string | null;
  stories: unknown;
};

export function storyHits(
  issues: readonly IssueRow[],
  { query, limit }: { query?: string; limit: number },
): SearchHit[] {
  const needle = query?.trim().toLowerCase();
  const seen = new Set<string>();
  const hits: SearchHit[] = [];

  for (const issue of issues) {
    readStories(issue.stories).forEach((story, index) => {
      if (hits.length >= limit) return;
      const key = story.headline.toLowerCase();
      if (seen.has(key)) return;
      if (needle && !key.includes(needle)) return;
      seen.add(key);
      hits.push({
        module: 'news',
        kind: 'story',
        id: `${issue.id}:${index}`,
        // The issue the story is printed in: a story is a part of its row.
        ref: `news.issues:${issue.id}`,
        title: story.headline,
        subtitle: issue.subject?.trim() ? `Story · ${firstLine(issue.subject, 60)}` : 'Story',
        href: `/news/i/${issue.id}`,
      });
    });
    if (hits.length >= limit) break;
  }

  return hits;
}

/**
 * One story in a newsletter, as kept in the `stories` column of news.issues
 * (supabase/migrations-news/0005_issues_digest.sql).
 *
 * `link` is the article's address from the email, and is absent when the
 * email gave the story none.
 */
export type NewsStory = {
  headline: string;
  summary: string;
  link?: string;
};

/**
 * The stories column as the reading page can trust it.
 *
 * The column is jsonb and the database only checks that it is an array, so an
 * entry without a headline or summary is dropped here rather than shown as a
 * blank story, and a link that is not http(s) is dropped from its story so the
 * page never renders a `javascript:` or `mailto:` href as an article link.
 * Anything that is not an array reads as no stories.
 */
export function readStories(value: unknown): NewsStory[] {
  if (!Array.isArray(value)) return [];
  const stories: NewsStory[] = [];
  for (const entry of value) {
    if (!entry || typeof entry !== 'object') continue;
    const { headline, summary, link } = entry as Record<string, unknown>;
    if (typeof headline !== 'string' || !headline.trim()) continue;
    if (typeof summary !== 'string' || !summary.trim()) continue;
    const story: NewsStory = { headline: headline.trim(), summary: summary.trim() };
    if (typeof link === 'string' && /^https?:\/\//i.test(link.trim())) story.link = link.trim();
    stories.push(story);
  }
  return stories;
}

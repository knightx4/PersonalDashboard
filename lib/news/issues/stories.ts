import { readTopic, type NewsTopic } from './topics';

/**
 * One story in a newsletter, as kept in the `stories` column of news.issues
 * (supabase/migrations-news/0005_issues_digest.sql).
 *
 * `link` is the article's address from the email, and is absent when the
 * email gave the story none. `image` is the address of the picture the email
 * printed with the story, and `text` is the story as the email itself told
 * it, paragraphs separated by a blank line. Both are absent when the email had
 * none, and on issues summarised before they existed.
 *
 * `topic` is one of NEWS_TOPICS (lib/news/issues/topics.ts), picked by Haiku
 * in the same call that writes the summary (plan #859). It is absent on a
 * story summarised before topics existed, and on a stored topic that is no
 * longer on the list.
 */
export type NewsStory = {
  headline: string;
  summary: string;
  link?: string;
  image?: string;
  text?: string;
  topic?: NewsTopic;
};

const WEB_ADDRESS = /^https?:\/\//i;

/**
 * The stories column as the reading page can trust it.
 *
 * The column is jsonb and the database only checks that it is an array, so an
 * entry without a headline or summary is dropped here rather than shown as a
 * blank story, and a link or image that is not http(s) is dropped from its
 * story so the page never renders a `javascript:` or `data:` address. A topic
 * not on the list is dropped from its story the same way.
 * Anything that is not an array reads as no stories.
 */
export function readStories(value: unknown): NewsStory[] {
  if (!Array.isArray(value)) return [];
  const stories: NewsStory[] = [];
  for (const entry of value) {
    if (!entry || typeof entry !== 'object') continue;
    const { headline, summary, link, image, text, topic } = entry as Record<string, unknown>;
    if (typeof headline !== 'string' || !headline.trim()) continue;
    if (typeof summary !== 'string' || !summary.trim()) continue;
    const story: NewsStory = { headline: headline.trim(), summary: summary.trim() };
    if (typeof link === 'string' && WEB_ADDRESS.test(link.trim())) story.link = link.trim();
    if (typeof image === 'string' && WEB_ADDRESS.test(image.trim())) story.image = image.trim();
    if (typeof text === 'string' && text.trim()) story.text = text.trim();
    const listed = readTopic(topic);
    if (listed) story.topic = listed;
    stories.push(story);
  }
  return stories;
}

/** A story's own text as paragraphs, for the page to set one after another. */
export function storyParagraphs(text: string | undefined): string[] {
  if (!text) return [];
  return text
    .split(/\n\s*\n/)
    .map((paragraph) => paragraph.replace(/\s+/g, ' ').trim())
    .filter(Boolean);
}

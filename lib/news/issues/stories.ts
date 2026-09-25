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
 *
 * `importance` is how much a well-informed reader needs to know the story,
 * from 1 (filler) to 5 (front-page news), rated by Haiku when the newsletter
 * is summarised or, for a story stored before ratings existed, by
 * scoreImportance in lib/news/issues/importance.ts. Quick read ranks by it.
 * It is absent until the story has been rated.
 */
export type NewsStory = {
  headline: string;
  summary: string;
  link?: string;
  image?: string;
  text?: string;
  topic?: NewsTopic;
  importance?: Importance;
};

/** A story's importance rating, 1 to 5. */
export type Importance = 1 | 2 | 3 | 4 | 5;

/** A value as an importance rating, or undefined when it is not a whole number from 1 to 5. */
export function readImportance(value: unknown): Importance | undefined {
  const n = typeof value === 'string' && /^\d$/.test(value.trim()) ? Number(value) : value;
  return typeof n === 'number' && Number.isInteger(n) && n >= 1 && n <= 5
    ? (n as Importance)
    : undefined;
}

const WEB_ADDRESS = /^https?:\/\//i;

/**
 * The stories column as the reading page can trust it.
 *
 * The column is jsonb and the database only checks that it is an array, so an
 * entry without a headline or summary is dropped here rather than shown as a
 * blank story, and a link or image that is not http(s) is dropped from its
 * story so the page never renders a `javascript:` or `data:` address. A topic
 * not on the list is dropped from its story the same way, as is an importance
 * that is not a whole number from 1 to 5.
 * Anything that is not an array reads as no stories.
 */
export function readStories(value: unknown): NewsStory[] {
  if (!Array.isArray(value)) return [];
  const stories: NewsStory[] = [];
  for (const entry of value) {
    if (!entry || typeof entry !== 'object') continue;
    const { headline, summary, link, image, text, topic, importance } = entry as Record<
      string,
      unknown
    >;
    if (typeof headline !== 'string' || !headline.trim()) continue;
    if (typeof summary !== 'string' || !summary.trim()) continue;
    const story: NewsStory = { headline: headline.trim(), summary: summary.trim() };
    if (typeof link === 'string' && WEB_ADDRESS.test(link.trim())) story.link = link.trim();
    if (typeof image === 'string' && WEB_ADDRESS.test(image.trim())) story.image = image.trim();
    if (typeof text === 'string' && text.trim()) story.text = text.trim();
    const listed = readTopic(topic);
    if (listed) story.topic = listed;
    const rated = readImportance(importance);
    if (rated) story.importance = rated;
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

/** A passage as its words alone: lower case, no punctuation, single spaces. */
function wordsOf(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim();
}

/**
 * Whether the full story says anything the summary above it has not.
 *
 * Some newsletters are one short paragraph a story, and the summariser keeps
 * it nearly as it is, so "Read the full story" opened onto the same words
 * again (note 86b9c6d1). Compared by words, ignoring case and punctuation. A
 * text no longer than the summary whose words are nearly all in it adds
 * nothing either: in the live issues those differ by a word ("turn over" for
 * "hand over", "its" for "the"), which is not a story worth opening.
 */
export function storyAddsToSummary(text: string | undefined, summary: string | undefined): boolean {
  const full = wordsOf(storyParagraphs(text).join(' '));
  if (!full) return false;
  if (!summary) return true;
  const shown = wordsOf(summary);
  if (shown.includes(full)) return false;

  const fullWords = full.split(' ');
  const shownWords = shown.split(' ');
  if (fullWords.length > shownWords.length * NEAR_LENGTH) return true;
  const left = new Map<string, number>();
  for (const word of shownWords) left.set(word, (left.get(word) ?? 0) + 1);
  let shared = 0;
  for (const word of fullWords) {
    const count = left.get(word) ?? 0;
    if (count === 0) continue;
    shared += 1;
    left.set(word, count - 1);
  }
  return shared < fullWords.length * NEAR_SHARED;
}

/** How much longer than the summary a text can be and still be the same story. */
const NEAR_LENGTH = 1.2;

/** The share of the text's words the summary must hold for the two to be the same. */
const NEAR_SHARED = 0.85;

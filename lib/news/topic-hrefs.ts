import type { NewsTopic } from '@/lib/news/issues/topics';

/**
 * Each topic's chip address, from a function that builds the page's address.
 * Kept out of the chips component, which is a client module: the News pages
 * call this while rendering on the server.
 */
export function topicHrefs(
  topics: readonly NewsTopic[],
  href: (topic: NewsTopic) => string,
): Partial<Record<NewsTopic, string>> {
  return Object.fromEntries(topics.map((topic) => [topic, href(topic)]));
}

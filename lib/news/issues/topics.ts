/**
 * The topics a story can be tagged with (plan #859).
 *
 * #858 settled on a fixed list written once in the code, with Haiku picking
 * one per story in the same call that summarises the newsletter. #874 chose
 * this general news list. A story that fits none of the others is Other.
 *
 * Changing the list does not re-tag stories already stored: a stored topic
 * that is no longer on the list reads as no topic (readTopic), and those
 * issues only get a topic from the new list when they are summarised again.
 */
export const NEWS_TOPICS = [
  'Politics',
  'World',
  // A story mainly about the place the reader lives, as named in News
  // settings (note 552a9407, news.preferences). With no place set, nothing
  // is tagged Local.
  'Local',
  'Business',
  'Markets',
  'Technology',
  'Science',
  'Health',
  'Climate',
  'Culture',
  'Sport',
  'Lifestyle',
  'Other',
] as const;

export type NewsTopic = (typeof NEWS_TOPICS)[number];

/** The topic a story gets when the model gives none, or one not on the list. */
export const FALLBACK_TOPIC: NewsTopic = 'Other';

/**
 * A value as one of NEWS_TOPICS, matched without regard to case or the spaces
 * around it, or undefined when it is not on the list.
 */
export function readTopic(value: unknown): NewsTopic | undefined {
  if (typeof value !== 'string') return undefined;
  const wanted = value.trim().toLowerCase();
  return NEWS_TOPICS.find((topic) => topic.toLowerCase() === wanted);
}

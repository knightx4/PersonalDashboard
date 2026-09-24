import { NEWS_TOPICS, readTopic, type NewsTopic } from '@/lib/news/issues/topics';

/**
 * One recommended newsletter, and the checks every one passes before it is
 * stored or shown (plan #944).
 *
 * The list lives in news.recommendations.picks
 * (supabase/migrations-news/0012_recommendations.sql), a jsonb array the
 * database only checks is an array. `readPicks` is the one reading of it, used
 * both on the model's reply and on the stored row, so a pick the page shows has
 * always passed the same rules.
 */
export type NewsletterPick = {
  name: string;
  /** Who publishes it. The name again when the model gave none. */
  publisher: string;
  topic: RecommendTopic;
  /** One line on why it suits you. */
  reason: string;
  /** The sign-up page, always http(s). */
  link: string;
};

/** Every topic but Other, which is where stories go when nothing else fits. */
export type RecommendTopic = Exclude<NewsTopic, 'Other'>;

/** The most picks kept for one topic. The prompt asks for two to four. */
export const MAX_PER_TOPIC = 4;

const MAX_TEXT = 300;

/**
 * The topics a list is made for: NEWS_TOPICS without Other, and without Local
 * unless a place is set in News settings.
 */
export function topicsFor(localArea: string | null): RecommendTopic[] {
  return RECOMMEND_TOPICS.filter((topic) => topic !== 'Local' || !!localArea);
}

/** Every topic a pick may carry, in the order of NEWS_TOPICS. */
export const RECOMMEND_TOPICS: readonly RecommendTopic[] = NEWS_TOPICS.filter(
  (topic): topic is RecommendTopic => topic !== 'Other',
);

function text(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const clean = value.replace(/\s+/g, ' ').trim();
  return clean ? clean.slice(0, MAX_TEXT) : null;
}

/** An http(s) address as the browser would write it, or null. */
function webLink(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  try {
    const url = new URL(value.trim());
    return url.protocol === 'http:' || url.protocol === 'https:' ? url.href : null;
  } catch {
    return null;
  }
}

/** One entry as a pick, or null when it lacks a name, a reason, a link or a listed topic. */
function readPick(entry: unknown, allowed: readonly RecommendTopic[]): NewsletterPick | null {
  if (!entry || typeof entry !== 'object') return null;
  const raw = entry as Record<string, unknown>;
  const name = text(raw.name);
  const reason = text(raw.reason);
  const link = webLink(raw.link);
  const topic = readTopic(raw.topic);
  if (!name || !reason || !link || !topic) return null;
  if (!(allowed as readonly string[]).includes(topic)) return null;
  return {
    name,
    publisher: text(raw.publisher) ?? name,
    topic: topic as RecommendTopic,
    reason,
    link,
  };
}

/**
 * Picks as the page can trust them, in topic order and at most MAX_PER_TOPIC
 * to a topic. An entry without a name, a reason or an http(s) link is
 * dropped, as is one whose topic is not in `allowed`, and a second pick with
 * the same name or link as an earlier one. Anything that is not an array
 * reads as no picks.
 */
export function readPicks(
  value: unknown,
  allowed: readonly RecommendTopic[] = RECOMMEND_TOPICS,
): NewsletterPick[] {
  if (!Array.isArray(value)) return [];
  const seen = new Set<string>();
  const byTopic = new Map<RecommendTopic, NewsletterPick[]>();
  for (const entry of value) {
    const pick = readPick(entry, allowed);
    if (!pick) continue;
    const byName = `name:${normalName(pick.name)}`;
    const byLink = `link:${pick.link.toLowerCase()}`;
    if (seen.has(byName) || seen.has(byLink)) continue;
    const list = byTopic.get(pick.topic) ?? [];
    if (list.length >= MAX_PER_TOPIC) continue;
    seen.add(byName).add(byLink);
    list.push(pick);
    byTopic.set(pick.topic, list);
  }
  return allowed.flatMap((topic) => byTopic.get(topic) ?? []);
}

/** Picks under their topic, in the order of NEWS_TOPICS, with empty topics left out. */
export function groupPicks(
  picks: readonly NewsletterPick[],
): { topic: RecommendTopic; picks: NewsletterPick[] }[] {
  return RECOMMEND_TOPICS
    .map((topic) => ({ topic, picks: picks.filter((pick) => pick.topic === topic) }))
    .filter((group) => group.picks.length > 0);
}

// ---------------------------------------------------------------------------
// Leaving out what you already get
// ---------------------------------------------------------------------------

/** A sender as news.senders holds it. */
export type KnownSender = { email: string; name: string | null };

/**
 * Hosts that carry many unrelated newsletters. A sender at one of these is
 * matched by its own name on the host (`name@substack.com` against
 * `name.substack.com`), since matching the host would leave out every
 * newsletter published there.
 */
const SHARED_HOSTS = [
  'substack.com',
  'beehiiv.com',
  'ghost.io',
  'buttondown.email',
  'buttondown.com',
  'mailchimp.com',
  'mailchi.mp',
  'list-manage.com',
  'convertkit.com',
  'kit.com',
  'medium.com',
  'gmail.com',
];

/** Second-level labels under which a registered name takes three labels (bbc.co.uk). */
const SECOND_LEVEL = new Set(['co', 'com', 'org', 'net', 'ac', 'gov', 'edu']);

/** The registered part of a host: nytimes.com for email.nytimes.com. */
function registered(host: string): string {
  const labels = host.toLowerCase().replace(/\.$/, '').split('.').filter(Boolean);
  const keep = labels.length >= 3 && SECOND_LEVEL.has(labels[labels.length - 2]) ? 3 : 2;
  return labels.slice(-keep).join('.');
}

function sharedHost(host: string): string | undefined {
  const bare = host.toLowerCase();
  return SHARED_HOSTS.find((shared) => bare === shared || bare.endsWith(`.${shared}`));
}

/** A name as words only: lower case, no punctuation, no leading "the". */
function normalName(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim()
    .replace(/^the /, '');
}

/** The domains and names that mark a newsletter as one you already receive. */
export type SenderIndex = { domains: Set<string>; names: string[] };

export function indexSenders(senders: readonly KnownSender[]): SenderIndex {
  const domains = new Set<string>();
  const names: string[] = [];
  for (const sender of senders) {
    const at = sender.email.lastIndexOf('@');
    if (at > 0) {
      const local = sender.email.slice(0, at).toLowerCase();
      const host = sender.email.slice(at + 1).toLowerCase();
      const shared = sharedHost(host);
      domains.add(shared ? `${local}@${shared}` : registered(host));
    }
    if (sender.name) {
      const key = normalName(sender.name);
      if (key) names.push(key);
    }
  }
  return { domains, names };
}

/** The key a pick's link is compared on, the same way indexSenders keys an address. */
function linkKey(link: string): string | null {
  let host: string;
  try {
    host = new URL(link).hostname.toLowerCase();
  } catch {
    return null;
  }
  const shared = sharedHost(host);
  if (!shared) return registered(host);
  const sub = host.slice(0, -shared.length).replace(/\.$/, '').split('.').pop();
  return sub ? `${sub}@${shared}` : null;
}

/**
 * Whether a pick is a newsletter you already receive: its link is on the
 * domain of one of your senders, or its name matches one of theirs. A sender
 * name like "Money Stuff from Bloomberg" matches a pick called "Money Stuff",
 * so a name counts when it appears in a sender's name as whole words, as long
 * as it is more than one short word.
 */
export function alreadyReceived(pick: NewsletterPick, index: SenderIndex): boolean {
  const key = linkKey(pick.link);
  if (key && index.domains.has(key)) return true;
  const name = normalName(pick.name);
  if (!name) return false;
  const specific = name.includes(' ') || name.length >= 8;
  return index.names.some(
    (sender) => sender === name || (specific && ` ${sender} `.includes(` ${name} `)),
  );
}

import { checkDraft } from '@/lib/dev/post-check';
import { LINK_PATTERN } from '@/lib/dev/posts';
import { X_POST_PRICE_USD, X_POST_WITH_URL_PRICE_USD } from './price';

/**
 * Posting a draft to X from the Posts tab (plan #2072).
 *
 * A draft is sent with POST /2/tweets, one request per post. A thread chains
 * each post to the one before it with `reply.in_reply_to_tweet_id`, so it
 * reads in order on X. The ids X returns are handed to `onSent` after every
 * post, which stores them on the draft (social_posts.x_thread_ids): a send
 * that stops part-way then carries on from the last post that went up rather
 * than posting the start again, which X would refuse as a duplicate anyway.
 *
 * The draft is read against the same check the posts run holds every draft
 * to (lib/dev/post-check.ts): X's 280-character count and the never-in-a-post
 * rules. On the tab these are warnings, never a refusal: the person decides,
 * and X refuses what it will not take (a post past 280) with its own reason.
 * A link is left out of the warnings, since docs/X-POSTS.md says the person
 * may add one when posting; it is priced instead.
 *
 * Prices are X's pay-per-use rates, read from the owner's X console on
 * 14 October 2026: a post is one Post: Create request, and a post holding a
 * link is billed as Post: Create (with URL) instead.
 *
 * `fetch` is passed in so the tests answer for X; nothing here runs on its own.
 */

export const X_TWEETS_URL = 'https://api.x.com/2/tweets';

/** Whether X bills this post as one with a URL. */
export function postHasLink(text: string): boolean {
  LINK_PATTERN.lastIndex = 0;
  const found = LINK_PATTERN.test(text);
  LINK_PATTERN.lastIndex = 0;
  return found;
}

export type XSendCheck = {
  /** False only when nothing is left to send. */
  ok: boolean;
  /** What the check found, as it words it ("post 2 is 291 characters…"). They warn and do not stop the send. */
  warnings: string[];
  /** The posts, numbered from 1, that hold a link and so cost the URL rate. */
  linkPosts: number[];
  /** How many requests the send makes: the posts not yet on X. */
  requests: number;
  /** What those requests cost, in USD. */
  priceUsd: number;
};

/** The check's wording for a link, which the send prices instead of warning about. */
const LINK_PROBLEM = /has a link or a domain$/;

/**
 * Whether a draft has anything left to send, what sending it costs, and what
 * the check would warn about. `sent` is how many
 * of its posts are already on X from a send that stopped part-way; they are
 * neither checked again nor paid for again.
 *
 * The angle is the tab's own label and never goes to X, so only the posts
 * are held to the rules.
 */
export function xSendCheck(input: { body: readonly string[]; sent?: number }): XSendCheck {
  const sent = Math.min(input.sent ?? 0, input.body.length);
  const result = checkDraft({ angle: 'A post', posts: input.body });
  const warnings = result.problems.filter((p) => !LINK_PROBLEM.test(p));
  const linkPosts: number[] = [];
  let priceUsd = 0;
  input.body.forEach((text, i) => {
    const link = postHasLink(text);
    if (link) linkPosts.push(i + 1);
    if (i >= sent) priceUsd += link ? X_POST_WITH_URL_PRICE_USD : X_POST_PRICE_USD;
  });
  return {
    ok: input.body.length > sent,
    warnings,
    linkPosts,
    requests: input.body.length - sent,
    // Summed in floating point; three places is what is shown.
    priceUsd: Math.round(priceUsd * 1000) / 1000,
  };
}

/** The link to a post on X, as the reads store it. */
export function xPostUrl(handle: string, id: string): string {
  return `https://x.com/${handle}/status/${id}`;
}

/** X refused a post or could not be reached; `message` is what the tab shows. */
export class XPostError extends Error {
  constructor(
    message: string,
    /** The ids of the posts that did go up, this send and earlier ones. */
    readonly sent: string[],
    readonly status: number | null,
    /** True when the sign-in itself was refused and Connect X again is the fix. */
    readonly reconnect = false,
  ) {
    super(message);
    this.name = 'XPostError';
  }
}

/** The tab's line for a refused post, from X's status and problem body. */
export function xPostProblem(status: number, body: unknown): { message: string; reconnect: boolean } {
  const b = (body ?? {}) as Record<string, unknown>;
  const words = [b.title, b.detail, b.type, b.reason, b.error]
    .filter((w): w is string => typeof w === 'string')
    .join(' - ');
  if (status === 402 || /credit|usagecap|usage cap|billing|payment/i.test(words)) {
    return {
      message: 'X said the developer account is out of credit. Add credit at console.x.com, then press Post again.',
      reconnect: false,
    };
  }
  if (status === 429) {
    return { message: 'X’s rate limit was reached. Wait fifteen minutes, then press Post again.', reconnect: false };
  }
  if (/duplicate/i.test(words)) {
    return {
      message: 'X refused this as a duplicate of a post already on the account. Change the text, or mark it posted with the link.',
      reconnect: false,
    };
  }
  if (status === 401 || status === 403) {
    return {
      message: `X refused the post (${status}). Press Disconnect, then Connect X, so the sign-in can post.`,
      reconnect: true,
    };
  }
  return { message: `X answered with an error (${status}). Press Post again in a minute.`, reconnect: false };
}

/**
 * Send the posts of a draft that are not on X yet, in order, each a reply to
 * the one before. `sent` holds the ids already up from an earlier send that
 * stopped part-way; the next post replies to the last of them.
 *
 * `onSent` is called with the whole list after every post X accepts, before
 * the next is sent, so the stored list never trails what is on X by more than
 * the post in flight. Returns every id, in thread order.
 */
export async function sendXThread(input: {
  token: string;
  posts: readonly string[];
  sent?: readonly string[];
  onSent?: (ids: string[]) => Promise<void>;
  fetchImpl?: typeof fetch;
}): Promise<string[]> {
  const fetchImpl = input.fetchImpl ?? fetch;
  const ids = [...(input.sent ?? [])];
  for (let i = ids.length; i < input.posts.length; i++) {
    const previous = ids.at(-1);
    const payload: Record<string, unknown> = { text: input.posts[i] };
    if (previous) payload.reply = { in_reply_to_tweet_id: previous };

    let res: Response;
    try {
      res = await fetchImpl(X_TWEETS_URL, {
        method: 'POST',
        headers: { authorization: `Bearer ${input.token}`, 'content-type': 'application/json' },
        body: JSON.stringify(payload),
        cache: 'no-store',
      });
    } catch {
      throw new XPostError('Could not reach X. Press Post again in a minute.', ids, null);
    }
    const json = (await res.json().catch(() => null)) as { data?: { id?: unknown } } | null;
    const id = typeof json?.data?.id === 'string' ? json.data.id : null;
    if (!res.ok || !id) {
      const said = res.ok
        ? { message: 'X did not say which post it made. Check the account on X before posting again.', reconnect: false }
        : xPostProblem(res.status, json);
      throw new XPostError(said.message, ids, res.status, said.reconnect);
    }
    ids.push(id);
    if (input.onSent) await input.onSent([...ids]);
  }
  return ids;
}

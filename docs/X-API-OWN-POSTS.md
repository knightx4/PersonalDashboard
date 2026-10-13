# Reading my own posts from the X API

What it would take for Dash to read the person's posts on X and mark the
matching drafts on the Posts tab (/dev/posts) as posted, with their links,
instead of the person pasting each link back. Research for plan #1796, from
idea a680910e. Checked on 11 October 2026; the sources and their dates are
listed at the end.

## The answer

There is no access tier to choose any more. Since 6 February 2026 the
self-serve X API is pay-per-use: you buy credits and each request is charged
for what it returns. Reading your own posts is the cheapest thing it sells, at
$0.001 per post returned. At the rate the Posts tab produces posts, that is
cents a month, and the $20 of free credit a new account gets for saving a card
would last years.

A read-only app, with an access token for the person's own account, is
enough. Matching is done on the text, and a matched draft gets the link
`https://x.com/<handle>/status/<post id>`.

**Recommendation: keep pasting links for now, and connect it once posting from
the tab is routine.** On 11 October no draft had been marked posted: 20 were
dropped and 2 are waiting. The cost is negligible, but connecting needs an X
developer account, a saved payment card and a stored token, which only the
person can set up, plus a sync routine and a matcher to build. That work pays
off when there are links to save. A sensible point to connect is after the
first handful of posts have gone out through the tab.

## Access and cost

The endpoint is `GET /2/users/{id}/tweets`, the user Post timeline. It returns
the 3,200 most recent posts, reposts, replies and quotes, newest first, up to
100 per page, and takes `since_id` or `start_time` so a sync asks only for
what is new. With `exclude=replies` it reaches back only 800 posts. A request
past those limits succeeds with no data.

Prices on the pay-per-use page:

| What is returned | Price |
|---|---|
| A post from another account | $0.005 |
| A user record | $0.010 |
| An "owned read": your own posts, mentions, likes, bookmarks and so on | $0.001 |

Owned reads apply "when `{id}` matches the authenticated user and that user is
the owner of the developer app". So the app has to be created under the
person's own X account, and the request has to be signed with that account's
token. Read with an app-only bearer token instead, the same posts are charged
at the $0.005 rate. That is still under a dollar a month here, so it is a
fallback rather than a blocker.

Other terms that matter:

- A resource is charged once per UTC day. Asking for the same post again
  before midnight UTC costs nothing more, though X calls this a "soft
  guarantee".
- Pay-per-use accounts are capped at 3 million post reads per monthly billing
  cycle. Enterprise is the only way above that.
- A spending limit per billing cycle can be set in the Developer Console.
  When it is reached, requests are refused until the next cycle.
- New pay-per-use accounts get $20 of credit for saving a first payment card,
  and a match of the first auto-recharge up to $50. Free credit is spent first
  and expires after three months.
- The old Basic ($200 a month) and Pro ($5,000 a month) subscriptions were
  still open to existing subscribers at the February launch. Several
  third-party guides say new sign-ups can no longer buy them; X's own pages do
  not mention them at all. The legacy Free tier is gone: its recently active
  users got a one-time $10 voucher.

An estimate for this app: one sync a day using `since_id` returns only the
posts made since the last one. At five posts a day that is about 150 owned
reads a month, or $0.15. Even a sync that re-reads a full page of 100 posts
every day costs about $3 a month.

## Rate limits

From X's rate-limit table, per 15-minute window:

| Endpoint | Per app | Per user |
|---|---|---|
| `GET /2/users/:id/tweets` | 10,000 | 900 |
| `GET /2/users/me` | none listed | 75 |

One request a day is far inside both. The rate limits and the billing are
separate: staying under the limits does not make a request free. One
third-party summary gives 180 per user and another 1,500 per app for the
timeline; both are older than X's table and should be ignored.

## Which token

The timeline endpoint accepts three kinds of authentication: OAuth 1.0a user
context, OAuth 2.0 app-only, and OAuth 2.0 authorization code with PKCE
(scopes `tweet.read` and `users.read`).

The simplest that earns the owned-read rate is OAuth 1.0a with the app owner's
own access token and secret. The Developer Console generates them for the
account that owns the app, they "make requests on behalf of your own account",
and they do not expire. Set the app's permission to "Read only": it can read
posts and users but cannot post, like or follow, which matches the rule that
Dash never posts. If the permission is changed later, the token has to be
regenerated to carry it.

OAuth 2.0 with PKCE would work as well, but its access tokens expire after two
hours. Keeping one alive means storing a refresh token and rotating it on each
use, which is more to build for a single account.

So the person would set four values: the app's API key and secret, and the
account's access token and secret. They would also note their numeric user id
and their handle once (from the console, or one call to `GET /2/users/me`),
so a sync never needs to look them up.

## Matching a post to a draft

`social_posts` already has what marking a draft posted needs: `status`,
`posted_url` and `posted_at`, with a constraint that a posted row has both.
`markPosted` in `app/dev/posts/actions.ts` does it today from a pasted link.

A sync would do this for each new post on the timeline:

1. Skip reposts and replies to other accounts. Keep original posts, and keep
   replies to the person's own posts so a thread can be recognised.
2. Normalise the text on both sides: decode `&amp;`, `&lt;` and `&gt;` (the
   API returns text with these escaped), remove `t.co` links (the person may
   add a link when posting, and X rewrites it), fold curly quotes to straight
   ones, and collapse whitespace.
3. Compare the post against the first element of `body` of each `suggested`
   row created before the post. `body` holds the text after the person's edits
   on the tab, so it is the closest thing to what they posted.
4. Mark the row posted when one draft matches exactly, or when one draft
   scores clearly above the rest on a similarity measure such as normalised
   edit distance. The person may still edit the text on X, so an exact match
   alone would miss some. Set `posted_url` to
   `https://x.com/<handle>/status/<id>` and `posted_at` to the post's
   `created_at`.
5. Leave anything ambiguous for the person: two drafts scoring close together,
   or a post that is near but under the threshold. The tab could show it as
   "this looks like it was posted" with the link filled in, and the person
   confirms it with one tap.

For a thread, the link is the first post's. Later posts in it share its
`conversation_id` and are replies to it, so they need no match of their own.

The request should ask for
`tweet.fields=created_at,conversation_id,referenced_tweets,note_tweet`, because a post over 280 characters (from a
Premium account) has its full text in `note_tweet` rather than `text`.

## What connecting would add to the plan

If the person decides to connect, the work is roughly:

- A setup step for the person: create the developer app under their own X
  account with read-only permission, save a card, set a spending limit, and
  put the four keys in Vercel.
- A sync step: a scheduled call to the timeline with `since_id`, the matcher
  above, and the posted update through the same path `markPosted` uses.
- A screen step: the "looks like it was posted" confirmation on the Posts tab
  for ambiguous matches.

## Sources

All read on 11 October 2026.

- X API pricing, docs.x.com/x-api/getting-started/pricing. Undated; says
  "prices are subject to change". Source for every price, owned reads and
  their condition, the 3 million cap, the daily deduplication, spending
  limits and the credit offers.
- X API changelog, docs.x.com/changelog, latest entry 2 October 2026. Dates
  pay-per-use (6 February 2026), owned reads at $0.001 (announced 16 April,
  effective 20 April 2026), and the free credits (2 October 2026). The April
  change was also announced on the X Developer Community forum.
- X API rate limits, docs.x.com/x-api/fundamentals/rate-limits. Undated.
- Timelines introduction and integration guide,
  docs.x.com/x-api/posts/timelines. Undated. Source for the 3,200 and 800
  limits, paging, and `since_id`.
- Authentication mapping,
  docs.x.com/fundamentals/authentication/guides/v2-authentication-mapping.
  Undated. Source for the auth methods and scopes.
- Developer apps, docs.x.com/fundamentals/developer-apps. Undated. Source for
  the permission levels and the owner's access token.
- OAuth 2.0 authorization code flow,
  docs.x.com/fundamentals/authentication/oauth-2-0/authorization-code.
  Undated. Source for the two-hour access token and `offline.access`.
- Third-party guides (postproxy.dev, scrapecreators.com, blotato.com and
  others, September to October 2026), used only for the status of the legacy
  Basic and Pro plans, which X's own pages do not cover. Treat that part as
  unconfirmed.
- The Posts tab's data: `social_posts` read on 11 October 2026 (20 dropped,
  2 suggested, none posted).

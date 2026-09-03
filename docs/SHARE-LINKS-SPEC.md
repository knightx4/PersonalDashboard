# Share links

A link you send to someone who has no account, which they open and fill in, and
whose answers land back in your database live.

The first one is a disposition form: a board game shelf, grouped, with a
keep / sell / give away split per game. The machinery underneath is not
board-game shaped and not shopping shaped, because the second one will not be
either.

## What this is not

Ruled out on purpose, each because it costs something real later.

- **Not a Google Form.** A form you fill in and submit is a snapshot. This is a
  view onto rows that already exist: she opens it, sees what she chose last
  Tuesday, changes one number, closes it. There is no submit button and no
  blank second copy.
- **Not an invite with an account behind it.** No sign-up, no magic link in v1,
  no password. The link is the credential. That is the whole point and it is
  also the whole risk, which is why the credential is a row (revocable,
  rotatable, labelled) rather than a column on the thing being shared.
- **Not a service-role route handler.** The same argument as the case page in
  `migrations-job-search/0017`: a route handler holding the service key is the
  only thing between a typo and every row in the database. Anonymous access
  goes through `security definer` functions that take one opaque token, accept
  no identity, and expose no table.
- **Not an RLS exemption.** No `anon` policy on `inventory_items`. A policy is
  inherited by every future query on that table, and the next join gets the
  exemption for free.
- **Not a mutation of my inventory.** Her marks are a proposal. Nothing she
  touches changes `inventory_items.status`. Applying a decision is a separate,
  deliberate action on my side. A shared link that can silently flip forty rows
  to `sold` is a link you cannot send.

## The link is a window, never an engine

**The shared page reads what is already in the database and does nothing else.**
No lookup, no search, no enrichment, no LLM call, no outbound HTTP of any kind,
no background job queued, nothing written except the answer she just typed.

This is a hard rule rather than a preference, and it is worth being blunt about
why, because every one of these is a real path that already exists in this
codebase and would be easy to reach for:

- `loadSellGames()` calls the eBay Browse API on load, and on the
  `web_estimate` path an Anthropic lookup that is **billed per call**. An
  unauthenticated URL that spends money per page view is a bug waiting to be
  found by a crawler, and `noindex` is a request, not a control.
- `lib/games/providers/bgg.ts` and `wikidata.ts` are rate-limited against
  someone else's terms of service. A link passed around a family group chat is
  not a caller you can rate-limit by politeness.
- Ingestion, sync, backfill and estimate jobs are all reachable from the
  shopping schema. None of them may be triggered by a stranger opening a page.
- Latency and failure: a page that waits on a third party is a page that hangs
  or errors on someone who cannot debug it and cannot ask you to.

So the page's data comes from four tables and nothing else — `inventory_items`
(name, `short_name`, `image_url`), `game_details` (bgg id, condition,
`manual_expected_price_cents`), `game_price_quotes` (whatever was **already**
cached, never refreshed from here), and the share tables. A missing price is
rendered as a missing price. It is not a reason to go and find one.

Enrichment is my side's job, done while signed in, and it lands in those tables
long before she opens the link. If a game has no photo and no price, the honest
fix is that I enrich it in `/shopping` and her page shows it on the next load —
not that her page goes looking.

### How it is enforced, not just intended

1. **A lint boundary**, the same shape as the `lib/vault/providers/` rule the
   repo already runs: nothing under `app/s/`, `app/api/s/` or `lib/share/read/`
   may import `lib/sell/`, `lib/games/providers/`, `lib/books/providers/`,
   `lib/email/`, `inngest/`, `@anthropic-ai/sdk`, or `lib/db/admin.ts`. Added to
   `eslint.config.mjs` and asserted still-firing in
   `tests/lint-boundaries.test.ts`, so deleting the rule fails the build.
2. **One loader with one job.** `lib/share/read/load-disposition.ts` is the only
   module the anonymous page reads through. It takes a Supabase client and a
   token and returns a plain projection. It has no network import to remove
   later because it never had one.
3. **A test that asserts the absence.** `global.fetch` is stubbed to throw in
   `tests/share-read.test.ts`; rendering a full share page with every price
   cache row missing must still succeed. A page that reaches out fails the
   suite loudly.
4. **The read function is `stable`, not `volatile`.** `share_page()` is declared
   `language sql stable`, so it cannot write, and there is no `pg_net`,
   `http` or `pg_cron` call anywhere in it.

The single exception is `share_respond()`, which writes exactly three integers,
a capped note, one event row and a `last_seen_at` — all inside the database,
all scoped to the one share the token names.

## Three layers

The stack is deliberately three separable things, because only the top one is
about board games.

1. **Share links** — a generic "here is a set of subjects, and a token that
   lets a stranger read and answer about them". Module-agnostic. Knows nothing
   about games, prices or photos.
2. **Item families** — a grouping layer on inventory: which items are the same
   thing (quantity) and which items belong together (Monopoly, Catan and its
   expansions). Lives on the inventory, not on the share, so a second share and
   the main inventory page both get it.
3. **The disposition form** — the one rendered surface. Games, photos, prices,
   keep/sell/give-away counts.

---

## Layer 1 — share links

### Schema (`supabase/migrations/0039_share_links.sql`)

```
share_links
  id, user_id, kind, title, intro, status, created_at, updated_at
```

`kind` is an enum starting at `disposition`. It is what tells the renderer
which page to draw and which response shape is legal, and it is the seam every
future use case comes in through. `status` is `active | archived`.

```
share_link_tokens
  id, share_link_id, token, label, can_respond,
  expires_at, revoked_at, last_seen_at, created_at
```

**The credential is a row, not a column.** This is the one piece of forward
design worth paying for now. `0017_public_case_page` put `public_slug` on
`cover_letters`, which works for one anonymous reader and stops working the day
you want two. Here:

- v1 issues one token, `label = 'Anyone with the link'`, `can_respond = true`.
- "Share with a specific person" later is a second row, `label = 'Sarah'`,
  delivered by email, and a revoke on the first. No schema change, no change to
  the read function's signature.
- Rotating a leaked link is an insert plus a revoke, and the old link dies
  without disturbing the answers.

`token` is 32 bytes of `randomBytes(...).toString('base64url')`. `expires_at`
is **nullable** — unlike the case page, a household form should not quietly die
in fourteen days. The default on create is null, with an explicit "expire this"
control.

```
share_link_items
  id, share_link_id, subject_type, subject_id,
  group_key, family_key, position, added_at
```

`subject_type` is an enum starting at `inventory_item`. One row per real unit —
three copies of the same game are three rows, because they are three things I
own and one of them might get sold.

`group_key` and `family_key` are **denormalized here on purpose**. They are
computed by the application from layer 2 when an item is added (and recomputed
by an explicit regroup action), and stored so the anonymous write function can
answer "how many units does this group have?" with a `count(*)` against a table
it already trusts, instead of taking a quantity from the caller.

```
share_link_responses
  id, share_link_id, group_key,
  keep_qty, sell_qty, giveaway_qty, note,
  answered_by_token, updated_at, created_at
```

Keyed by `(share_link_id, group_key)`, unique. Not keyed per item: she is
choosing "sell two of the three", and which two is not a question anyone can
answer about identical boxes. The mapping from counts to specific
`inventory_items` happens on my side, at apply time, deterministically by id.

Non-negative checks in the constraint; the "sums to no more than the quantity"
rule is enforced in the write function, because a check constraint cannot count
rows in another table.

```
share_link_events
  id, share_link_id, token_id, kind, payload, created_at
```

Every anonymous write appends one. Three jobs: it is the rate limit's counter,
it is the "she opened it and changed her mind twice" history in my UI, and it
is how a vandalised form gets diagnosed and rolled back.

### RLS

Owner policies exactly as everywhere else — `user_id = (select auth.uid())` on
`share_links`, `exists (...)` through the parent on the four child tables.
`anon` gets no policy and no grant on any of them.

### The anonymous read (`0041_share_rpcs.sql`)

```sql
public.share_page(p_token text) returns jsonb
  language sql stable security definer set search_path = public, pg_temp
```

Same shape of argument as the case page: one opaque token, no identity, a fixed
return. It resolves the token, checks `revoked_at is null` and
`(expires_at is null or expires_at > now())` and `length(p_token) >= 24`, then
builds the page.

What it returns is a **projection, not a join**. The renderer gets title, intro,
and a list of groups: display name, quantity, image url, unit price cents (or
null), family, and the current response. It does not get `inventory_items`
rows, `user_id`, cost, merchant, acquisition date or notes. What is not in the
`jsonb_build_object` was never sent.

A wrong token, a revoked token and an expired token are one outcome — the page
404s — for the same reason the case page does it: a distinct "this expired"
message confirms the token was real.

### The anonymous write (`0041_share_rpcs.sql`)

This is new ground; the case page is read-only.

```sql
public.share_respond(
  p_token text, p_group_key text,
  p_keep int, p_sell int, p_giveaway int, p_note text
) returns jsonb
  language plpgsql volatile security definer set search_path = public, pg_temp
```

The function *is* the authorization decision, so all of it is in the migration
where it can be read:

1. Resolve token → share. Reject unless live and `can_respond`.
2. `select count(*) from share_link_items where share_link_id = ... and
   group_key = p_group_key` → the quantity. **Zero means the group is not on
   this share**, and the call is refused. The caller cannot invent a group.
3. Clamp: every count `>= 0`, and `keep + sell + giveaway <= quantity`. Over
   the quantity is an error, not a silent truncation — she should see why the
   number would not take.
4. `p_note` trimmed and capped at 500 characters.
5. Rate limit: refuse if this token wrote more than 60 events in the last
   minute. Unguessability stops strangers; this stops a stuck client and makes
   a determined nuisance bounded and visible.
6. Upsert the response, append the event, touch `last_seen_at`, return the
   group's fresh state.

`revoke all ... from public; grant execute ... to anon, authenticated` on both,
matching `0007_lock_down_definer_functions.sql`'s rule and its stated exception.

### Routes

- `app/s/[token]/page.tsx` — `force-dynamic`, `robots: noindex, nofollow,
  nocache`, read through `createPublicClient()` (a new
  `lib/share/auth/public.ts`, the shopping-schema twin of
  `lib/jobs/auth/public.ts`: anon key, no cookie storage, so a signed-in
  stranger and a signed-out one see the identical page).
- `app/api/s/[token]/respond/route.ts` — POST, Zod-parsed body, same anon
  client, calls `share_respond`, returns the fresh group.
- `proxy.ts` — add `/s` and `/api/s` to `PUBLIC_PATHS`, with the same comment
  the case page got: authorized by an unguessable token and one definer
  function that checks it.

### What "live" means

Her page holds no local draft. Each control writes immediately, the response
comes back with the server's version of that group, and the UI renders that.
Two consequences worth stating: her page revalidates on focus and on a slow
poll, so a change I make while she has the tab open shows up; and if I remove
an item from the share, her next write to that group is refused rather than
writing into a hole.

Supabase Realtime is the obvious upgrade and is deliberately not v1 —
subscribing `anon` to a filtered channel needs its own RLS story, and
refresh-on-focus covers "she came back the next evening", which is the actual
behaviour being designed for.

---

## Layer 2 — item families

This is the "tagging system" the grouping needs. It is two questions, and they
are genuinely different questions, so they get two mechanisms.

### Question one: are these the same thing? (quantity)

`group_key`, computed. Deterministic, in `lib/share/grouping.ts`, with tests:

- A game with a confirmed `game_details.bgg_id` → `game:bgg:<id>`. Two boxes
  with the same BGG id are the same product and stack.
- Otherwise → `game:title:<normalized title>` using the existing
  `lib/games/clean-title.ts` normalisation.
- The generic fallback for a non-game inventory item →
  `item:<fingerprint_loose>`, which the codebase already computes.

Computed rather than stored on `inventory_items` because it is derived from
data that already exists and a stored copy is a thing that can be wrong. It is
cached onto `share_link_items` at add time, and a **Regroup** action on the
share recomputes it. Regroup remaps responses whose `group_key` changed and
where the mapping is unambiguous, drops the ones that are not, and logs both to
`share_link_events` — silence there would be a form that lost her answers.

### Question two: do these belong together? (family)

```
item_families
  id, user_id, name, slug, kind, created_at, updated_at

inventory_item_families
  id, inventory_item_id, family_id, role, position, created_at
```

(`supabase/migrations/0040_item_families.sql`)

`role` is an enum: `base | expansion | edition | accessory | member`. That is
what makes this structurally sound rather than a folder — the form can render
"Monopoly" with the base games first and the twelve themed editions beneath,
and the sell assistant can eventually know that an expansion without its base
is worth less.

Existing `item_tags` is **not** reused for this. It is flat, it carries no
relationship, and it attaches to `order_items` — which manually-added games do
not have. Overloading it would mean the shape of the data lies about what it
means.

**Populating families** is assist-then-confirm, not automatic:

- BGG's `boardgameexpansion` inbound links (already parsed in
  `lib/games/providers/bgg.ts`) propose `expansion → base`.
- Title clustering proposes editions: a shared leading segment before a colon
  or a known franchise word ("Monopoly: Star Wars" → Monopoly).
- Both write **suggestions** that I accept or reject in the UI. "Ticket to
  Ride: Europe" is arguably a standalone game, not an edition of anything, and
  no heuristic settles that — a person does, once, and it stays settled.

### And: tags that actually reach inventory

```
inventory_item_tags
  id, inventory_item_id, tag_id, created_at, updated_at
```

Same migration. It reuses the existing `item_tags` vocabulary table and gives
it the join it is missing, so "everything tagged `board-games`" is one query
against inventory rather than a walk back through order lines that half the
shelf does not have. This is the selector the bulk-add below leans on.

---

## Layer 3 — the disposition form

### What she sees

One card per **group**, with:

- The photo (`inventory_items.image_url`), or a neutral placeholder.
- The display name (`short_name` falling back to `name`).
- **Quantity**, when it is more than one. "Monopoly Classic × 3".
- **Sell price, each** — and blank when unknown.
- Three steppers: Keep / Sell / Give away, and a live "1 undecided" remainder.
- An optional note.

Groups are nested under their family when one exists, with the base game first.
Families with a single member render flat — a heading over one game is noise.

### The price rule, stated as a rule

> An unknown price renders as nothing at all. Never `$0.00`, never `—$0`.
> Zero is a claim, and the claim is usually false.

`formatMoney(cents: number)` in `lib/money.ts` cannot express this — it takes a
number. Add `formatMoneyOrBlank(cents: number | null)` **in that file**, because
the lint rule that keeps `Intl.NumberFormat` out of components is the thing
enforcing that money has one home.

The price shown is the unit price, not the line total, because the quantity is
right there next to it.

### Where the price comes from

`game_details.manual_expected_price_cents` first, then whatever row already
sits in `game_price_quotes` for that bgg id, then null. Nothing is fetched and
nothing is refreshed — see *The link is a window, never an engine* above, which
is the rule this is one instance of. A price that is stale is shown as it is; a
price that is absent is shown as nothing.

### Bringing decisions back

`/shopping/share/[id]` shows the same grouped list with her marks on it, plus
the event trail. Per group: **Apply** — which assigns the counts to specific
`inventory_items` in id order and sets `status` (`sold` / `gifted`) with the
matching `disposal_method`. Applying is mine, explicit, and per-group, and the
existing `sync_order_state()` / `lib/status.ts` rules stay the only thing that
writes status.

Her marks also surface where I already look: a small keep/sell/give chip on the
inventory row and the item page for any item currently on an active share.

---

## My side of the link

- `/shopping/share` — the shares, create one, copy the link, revoke or rotate
  the token, archive.
- **Send to form** on the inventory item page and inline on each inventory row:
  pick a share, insert one `share_link_items` row. This is the "I found another
  one" path.
- **Add all N results** on the inventory list, which adds whatever the current
  filters (category, tag, list, search, merchant) have narrowed to. This is the
  "put all the board games in" path done by hand.
- **Regroup** and **Remove from form**, both per-share.

## The AI-facing surface

"Put all things of a certain kind in there" has to be a small, boring call, not
a UI errand. Three things make it so:

1. **Server actions with flat signatures** in `app/shopping/share/actions.ts`:
   `createShare({kind, title, intro})`,
   `addToShare({shareId, inventoryItemIds})`,
   `addToShareByFilter({shareId, filter})` where `filter` is the same parsed
   shape the inventory page already uses (`category`, `tag`, `list`,
   `merchant`, `q`, `person`), `removeFromShare`, `regroupShare`,
   `applyResponse`.
2. **A script**: `scripts/share-add.ts`, run as
   `npm run share:add -- --share=<slug> --tag=board-games`. Service-role client,
   which is legal there and only there per the repo rule, and it filters by
   `user_id` explicitly like everything else in `scripts/`.
3. **A stated contract** — this file — so the group/family keys, the response
   shape and the apply semantics can be reasoned about without reading the UI.

Families and tags are the vocabulary that makes the instruction expressible.
"All my board games" is `category = board-games`. "Everything Monopoly" is a
family. "The heavy euros" is a tag I can add once and use forever.

## Tests

Following the existing files rather than inventing a new style.

- `tests/rls-share.test.ts`
  - `anon` selects zero rows from all five share tables directly.
  - `share_page` with a valid token returns the page; with a revoked one, an
    expired one, a truncated one and a random one returns null — four separate
    negative cases.
  - The projection **omits** cost, merchant, `user_id` and notes. Asserted on
    the returned keys, so a later `select *` cannot widen it quietly.
  - `share_respond` refuses a `group_key` that is not on that share.
  - `share_respond` refuses `keep + sell + giveaway > quantity`.
  - `share_respond` on user A's token never touches user B's rows.
  - The rate limit fires.
- `lib/share/grouping.test.ts` — identical BGG ids stack; different ids with the
  same title do not; an expansion is not folded into its base's quantity;
  regroup remaps unambiguously and refuses to guess otherwise.
- `tests/share-read.test.ts` — `global.fetch` stubbed to throw. A full share
  page renders with no cached prices, no photos and no confirmed bgg ids. If the
  read path ever grows a lookup, this is what fails.
- `tests/lint-boundaries.test.ts` — extend, so the share-read import boundary is
  asserted to still fire, exactly as the vault providers rule is.
- `tests/schema-exposed.test.ts` — extend, so the new tables are asserted
  unreachable over PostgREST as `anon`.

## Build order

Each step is a commit that leaves the app working.

1. `0039_share_links.sql` + `0040_item_families.sql` + `0041_share_rpcs.sql`,
   Drizzle schema in `lib/db/schema.ts`, `tests/rls-share.test.ts` green.
2. `lib/share/grouping.ts` and its tests. No UI.
3. The import boundary in `eslint.config.mjs` and its assertion in
   `tests/lint-boundaries.test.ts` — **before** the read path exists, so it is
   never possible to write a version that reaches out.
4. `formatMoneyOrBlank`, and `lib/share/read/load-disposition.ts`: the one
   loader the anonymous page reads through, plus `tests/share-read.test.ts`
   with `fetch` stubbed to throw.
5. `/s/[token]` read-only: the grouped page, photos, prices, quantities.
   Sendable at this point, just not answerable.
6. The respond route and the steppers. The form works.
7. `/shopping/share` — create, copy, revoke, and the responses view.
8. Send-to-form and add-by-filter on inventory.
9. Family suggestions (BGG expansion links + title clustering) and the accept
   UI. Note this is enrichment, so it lives entirely on my authenticated side.
10. `scripts/share-add.ts` and the `share:add` npm script.
11. Apply-a-decision.

Steps 1–6 are the whole thing she needs. 7–11 are the parts that make it
pleasant and repeatable.

## Open questions

- **Expiry default.** Currently proposed as "never, until revoked". A form for
  a person in the house is not a link to an employer. Say if you want a default.
- **Attribution.** `share_link_responses.answered_by_token` records which token
  answered, which is enough to say "Sarah's link" once there is more than one.
  No name is collected from the page. An optional "who are you?" field is a
  five-minute addition if you want it.
- **Whether Apply should exist at all in v1**, or whether reading her marks in
  my UI is enough for the first pass. Step 10 is last precisely because it may
  not be needed.

## Non-goals

- No accounts, no sign-in, no email delivery in v1. Sending the link is a text
  message.
- No comments, threads or notifications. One note field per group.
- No editing my inventory from the shared page. She marks; she cannot rename,
  delete, or re-price anything.
- No public discovery. Every share page is `noindex` and reachable only by its
  token.
- **No work performed by the link.** No price lookups, no catalog searches, no
  enrichment, no jobs, no LLM calls, no outbound HTTP. Opening the page costs a
  few indexed reads and nothing else, forever. This is the non-goal most likely
  to get quietly violated by a well-meaning "the price is missing, let's just
  fetch it" — it is a lint rule and a test for that reason.

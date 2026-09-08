# Build order

Do not hand the whole spec over at once. One phase at a time, in this order.

## Done

0. **Google Cloud setup** — *deferred deliberately.* Not needed until Gmail
   OAuth (done as step 7 below). See [SETUP.md](SETUP.md) Tier 2.
1. ✅ **Schema and migrations.** All tables, `profiles` and its insert trigger,
   `item_uses`, both fingerprint columns. RLS on every table, with `categories`
   and `merchants` written by hand rather than from the template. Categories and
   merchants seeded.
2. ✅ **The cross-user isolation test.** Written before any feature code, so a
   missing policy fails immediately rather than months later.
3. ✅ **`lib/money.ts`** with the allocation rule and spend queries, plus the
   January/March return fixture.
4. ✅ **Supabase Auth.** Sign-up, sign-in, Google sign-in, password reset,
   session refresh and route protection in `proxy.ts`.
5. ✅ **App shell, navigation, empty states.** No data yet.
6. ✅ **Manual order entry plus inventory CRUD.** Order form writes one
   `inventory_items` row per physical unit via `allocateLandedCost`. Inventory
   list/detail (search, category filter, edit, note, dispose, mark returned
   through a refunded `returns` row). Orders list grouped by month + detail.
7. ✅ **Gmail OAuth grant and connection management (build step 10).** Connect /
   disconnect / reconnect on Settings; tokens encrypted at rest.
8. ✅ **Email extraction + inbox sync.** Classifier (merchant domains), Zod
   extraction with arithmetic gate, Gmail message fetch, and session-scoped
   `/api/inbox/sync` batches that write orders + inventory. LLM via Anthropic
   Haiku when `ANTHROPIC_API_KEY` is set; heuristic fallback otherwise.
9. ✅ **Dashboard** on top of order/inventory data, reading only from
   `lib/money.ts`.
10. ✅ **Saved items.** Paste URL → JSON-LD then Open Graph enrichment →
    preview/edit → save. List by status, detail edit, dismiss / purchased /
    delete. Loose fingerprint already-own warning. Merchant match from URL
    host. No paid unfurl vendor yet.
11. ✅ **Onboarding flow.** Welcome → Gmail pre-consent explanation → connect
    or skip. Uses `profiles.onboarding_completed_at`; app shell redirects
    incomplete users. Existing users with inbox/orders are grandfathered.

Also done ahead of schedule because they are cheap and everything depends on
them: `lib/fingerprint.ts`, `lib/status.ts` and the SQL/TypeScript agreement
test, CI with dependency scanning, the privacy and terms pages Google will want
at Tier 2.

## Next

12. ✅ **Background Gmail backfill.** Import starts on the server (`after` +
    continue chain), survives navigation, and Settings/Dashboard poll
    `sync_jobs` for progress. Full Inngest remains optional further hardening.
13. ✅ **Incremental sync** (Gmail historyId). Durable cursor on
    `email_accounts.sync_cursor`; page tokens on `sync_page_token`. Daily
    cron at `/api/cron/inbox-incremental` (Hobby limit) plus Settings
    “Sync now”. Expired history falls back to a bounded `messages.list`
    catch-up.
14. ✅ **Review queue.** Heuristic orders (`needs_review`) and failed /
    unmatched emails (`parse_status = needs_review`). Confirm, discard, or
    dismiss; Open in Gmail; nav badge counts both.
15. ✅ **Account deletion** with token revocation and full cascade. On
    `/account`, not inside a workspace — an account you can only delete from
    the job search is one you cannot delete with the job search switched off.
    Revokes every Google grant, clears this app’s storage bucket, and deletes
    the `auth.users` row, which every table naming a user cascades from in all
    six schemas. `tests/account-cascade.test.ts` reads the migrations and
    refuses one that adds a table without that cascade. The vault’s GitHub
    token is the one credential this cannot revoke — it was pasted in, so only
    its owner can delete it, and the page says so.
16. ✅ **Books resolution engine** — ISBN/title → canonical book via Google
    Books + Open Library, tested with fixtures.
17. ✅ **Owned-book ingestion** — manual search, paste list, barcode scan,
    shelf/cover photo (confirm mandatory), receipt photo; `book_details`
    table; standalone inventory (no synthetic orders).
18. ✅ **Sell assistant v1** — buyback quotes + eBay Browse asking ceiling,
    net_self / net_buyback math, routing UI on `/sell` (draft only).
19. **Phase 2** — the anti-spending layer, on the *shopping* side. No
    migrations needed; the schema already carries `item_uses`, the budget
    columns and `cooldown_until`. `price_checks` for saved items also waits
    until then. (The job side's own second phase is a separate body of work
    with its own name — see [EVIDENCE-LAYER.md](EVIDENCE-LAYER.md) — so that
    "Phase 2" here means one thing only.)

### Vault — the third workspace

Full detail in [VAULT-SPEC.md](VAULT-SPEC.md). Four steps, in this order, and
none of them depends on 19. The v1 deliverable is a viewer and nothing more;
everything the vault is actually *for* is deferred until something reads it.

All four are done. What the spec got wrong on contact with the code: the
backfill does not need `resume.ts` (a stored path is a resume point, so there
is no hand-off chain to keep alive); account deletion needed no change because
all three tables cascade from `auth.users` already; and the schema could not be
called `vault`, which is Supabase's own — see the head of the migration.

20. ✅ **Schema and the isolation test.** New `obsidian` schema in
    `supabase/migrations-vault/` (`vault_connections`, `notes`, `sync_runs`),
    added to the `db-reset.sh` loop. RLS on all three, and the cross-user
    isolation test extended to cover them **before any feature code** — the same
    rule as step 2, for the same reason. The three tables also go into the
    step 15 delete cascade.
21. ✅ **The GitHub source.** `lib/vault/providers/github.ts`, containment enforced
    the way `lib/email/providers/` already is. Tree call filtered to `.md`
    *before* any blob is requested, so attachment bytes never cross the network.
    Backfill reuses `lib/core/inbox/pump-budget.ts` and `resume.ts` rather than
    reimplementing them; incremental is the compare API with the commit SHA as
    cursor, falling back to a full tree diff on a rewritten history. Third stage
    on `/api/cron/daily`.
22. ✅ **The viewer.** `app/vault/` plus a third entry in `WORKSPACES` in
    `workspace-switcher.tsx`. List, note detail, search. `react-markdown` +
    `remark-gfm` + `gray-matter`, and deliberately **not** `rehype-raw` —
    disabled raw HTML is the sanitizer, and clipped notes carry arbitrary web
    HTML. Wikilinks resolve; attachment embeds render as a placeholder.
23. ✅ **Connect UI.** `/vault/settings` — connect, disconnect, sync now, reauth
    banner on an expired PAT. Near-copy of the Gmail connection panel.

### Todo — the fourth workspace

Specified in full in [TODO-SPEC.md](TODO-SPEC.md). All eight steps are done.

What the spec got wrong on contact with the code, recorded because the next
module will be tempted by the same things:

- **The timezone move could not be a refactor.** About thirty call sites read
  `profiles.timezone`, so `core.account_settings` became the one writer and a
  trigger keeps both columns true. Mirrors maintained by the database, not a
  second writer -- they retire whenever their readers do.
- **The ownership trigger had to let the check constraint speak.** A BEFORE
  trigger runs first, so a link pointing at nothing was answered with "you do
  not own that", which sends someone looking for a permissions problem they do
  not have.
- **`lastCorrespondents` moved to `lib/jobs/followup/recipients.ts`.** Two pages
  address the same draft now, and two ways of doing it would have drifted.
- **Interviews needed their own shape.** They are appointments, so `DayContext`
  exists alongside `AgendaItem` -- a checkbox beside a meeting invites a person
  to lie to their own list.
- **The select list in `links/load.ts` is written by hand.** supabase-js parses
  it at the type level and a computed string degrades the whole result to an
  error type, so a test asserts it names every target column instead.

The rule everything else follows from: an obligation is displayed by whoever
needs to show it and written by whoever owns it. The module owns the tasks you
typed into it. A job reminder is finished and deferred on the job side's own
row, so both pages agree; a return deadline gets a dismissal and nothing else.
No import job, no second copy, and nothing read out of the vault at all in v1.

24. ✅ **Account settings.** `core.account_settings`, and the timezone moved into
    it — there are currently two `profiles` tables with a `timezone` each, both
    defaulting to UTC, and only the jobs one has an edit screen, so the shopping
    half of the account has silently been on UTC. Account-level settings
    (timezone, display name, currency, which modules are on, deletion) move
    behind the account icon; each module keeps its own gear for its own
    settings. A change to all three existing workspaces, and first because
    everything below renders a date.
25. ✅ **Schema and the isolation test.** New `todo` schema in
    `supabase/migrations-todo/`, applied last by `db-reset.sh` because its
    foreign keys point into the other three. RLS **and** the link-ownership
    trigger, with the cross-user isolation test covering both before any feature
    code -- the same rule as steps 2 and 20, and it matters more here: a
    foreign key is not an ownership check, because referential integrity in
    Postgres bypasses RLS.
26. ✅ **The list you typed.** `/todo`, `/todo/all`, create, edit, complete, drop,
    snooze, due dates, pinned. Fourth entry in `WORKSPACES`. Zero integration,
    and already worth having.
27. ✅ **Links and the inline sections.** `todo.task_links` -- real cross-schema
    foreign keys, one parent from six, the shape `job_search.notes` already
    uses. A Tasks section on the role, company, contact and interview pages and
    on a note. This is the entire vault integration for now, and it is the half
    that costs nothing.
28. ✅ **The source registry.** The `AgendaSource` interface, the switches in
    `/todo/settings` (all off), batched label lookups and the pure merge, with
    no sources implemented. A scaffold with nothing plugged into it sounds like
    a step to skip; it is the step that decides whether the next two are one
    file each or a rewrite.
29. ✅ **The job source.** Reminders on the agenda with the follow-up composer
    intact (`fd33268` applies here with full force), completion writing
    `completed_at` and deferral moving `due_at`, both on the job row.
    Interviews as day context rather than as items.
30. ✅ **The shopping source.** `orders.return_deadline` within the horizon. Last
    of the sources because it is the thinnest.
31. ✅ **`/home`.** The top slice of the agenda on the front door, plus tiles
    for the vault and the todo module, which it never had.

Deliberately not a step: reading `- [ ]` checkboxes out of notes. A checkbox is
a line of text inside a note rather than a row, and every way of extracting one
today costs something -- moving whole note bodies to the app, or writing
Obsidian's formatting rules in SQL, or maintaining a derived table. It waits for
the vault to hold notes as something more structured than text, and is then one
file against the step 28 interface. The spec records the three options and why
none of them is chosen yet.

## The learn module

Specified in [LEARN-SPEC.md](LEARN-SPEC.md). The ordering is the argument:
resolution before generation, because generation was tested first and is the
weak half -- twenty-plus searches per curriculum, quality that tracks whether a
topic has a free canonical corpus rather than anything about the prompt, and
gaps it does not admit to. Resolving a list somebody already handed you is the
half that works.

32. ✅ **Schema, RLS and the isolation test.** Four tables in `learn`, policies
    in the first migration, `rls-learn.test.ts` written before any feature
    code. Build step 2's rule for the fifth time and the same reason.
33. ✅ **The guarded fetcher.** The first integration that reaches an address
    nobody here chose, so the address guard, the redirect re-check and the
    containment boundary come before anything that would use them.
34. ✅ **Parse and resolve.** A paste becomes citations; each citation becomes a
    source with a link, an access, and a proposed location. Separate steps so
    one bad row does not cost the whole import.
35. ✅ **The locate pass.** Fetch on open, find the passage, verify the phrase
    is really in the page. This is where "never send someone to a page that is
    not there" stops being a sentence in a spec.
36. ✅ **The workspace.** Tracks, a track, a reading, and the paste-and-confirm
    intake. Fifth entry in `MODULES`, and a migration turning the module on for
    accounts that already exist.

Deliberately not a step: PDF passages, the MCP connector, curriculum
generation, and the vault link. Each is sketched at the end of the spec, and
each assumes the one before it worked. The vault link is the interesting one --
materialising wikilinks would turn every unresolved `[[link]]` into a track
worth building, which is a reading queue you have been writing for years
without knowing it -- and it waits because nothing yet proves a resolved queue
gets read.

### Ordering notes worth respecting

- Step 32 before 33, and both before 34, for the reason every block here
  repeats: a missing policy has to fail immediately.
- Step 33 before 34 specifically, not just conventionally. Resolution produces
  URLs, and the moment anything fetches one without the guard in place the
  guard is decoration.
- Step 35 after 34 because it needs somewhere to write back to, and it is the
  step that makes the module worth more than a bookmark list.

### Ordering notes worth respecting

- Step 2 before step 4, so a missing policy surfaces immediately.
- Step 3 early, because every screen depends on those numbers and they are cheap
  to test in isolation and expensive to correct once six components compute them
  inline.
- Steps 9 and 10 are independent: dashboard reads spend; saved items are a
  separate queue. Either order is fine.
- Step 20 before 21, and 21 before 22, for the same reason step 2 came before
  step 4: a missing policy has to fail immediately, and a viewer with no data
  behind it proves nothing. Step 23 can land alongside 22 — until it does, a
  connection row inserted by hand is enough to develop against.
- The vault block (20–23) is independent of 19. Either order is fine, and
  neither blocks the other.
- Step 24 before everything else in the block: two timezones that disagree
  cannot render one agenda. This held in practice -- every later step reads
  `loadAccountSettings`. Step 25 before 26, for the third time and the same
  reason a missing policy has to fail immediately. Steps 26 and 27 are worth
  having on their own and can ship without any of 28–31. Step 28 before 29 and
  30, which are otherwise independent of each other. Step 27 needs the vault
  (20–23) shipped for the note half of it; nothing else in the block depends on
  another block.

## Open questions, still open

Carried forward from the spec. None of them block the next few steps, but the
household one is worth deciding before launch rather than after.

- **Backfill window.** 180 days is a guess. Longer means better inventory but
  more LLM cost and more noise.
- **Groceries and consumables.** Track them in inventory at all, or count them
  toward spend and exclude them from the inventory view? Leaning excluded by
  default with a toggle, since 40 grocery items will bury the things worth
  tracking.
- **One order across two connected inboxes** (a shared household inbox).
  Reconcile at the order-number level, but this needs a test.
- **Gift purchases** — bought but not owned. Probably an `is_gift` flag on
  `order_items` that counts toward spend and skips inventory. Deliberately not
  added to the schema yet, because it is still a question.
- **Household / shared accounts.** The one plausible feature that breaks the
  current `user_id` model: it needs a `households` table and a membership join,
  and retrofitting it means touching every RLS policy. **Decide before launch.**
- **When to start CASA.** Around user 60 of the 100 cap. See
  [consent-tally.md](consent-tally.md).
- **Trigram threshold** of 0.55 for cross-merchant matching is a guess. Tune
  against real data and measure false positives specifically — a wrong "you
  already own this" is more annoying than a missed one.
- **Vault scope, size and freshness.** Three open questions specific to the
  vault, kept in [VAULT-SPEC.md](VAULT-SPEC.md) rather than duplicated here.
  None blocks steps 20–23.
- **Whether recurring todos can wait.** Renewals, bills and appointments are
  the repetition-heavy category that justified the todo module in the first
  place, so a v1 without them may miss its own point. Four more questions
  specific to the module are kept in [TODO-SPEC.md](TODO-SPEC.md) rather than
  duplicated here. None blocks steps 24–31.
- **Whether Promotions actually contains order confirmations** in practice.
  Measure recall both ways on a real mailbox before hardcoding either behaviour.
  The exclusion is a config flag, default off.

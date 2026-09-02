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
15. **Account deletion** with token revocation and full cascade.
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
- **Whether Promotions actually contains order confirmations** in practice.
  Measure recall both ways on a real mailbox before hardcoding either behaviour.
  The exclusion is a config flag, default off.

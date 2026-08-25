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
19. **Phase 2** — the anti-spending layer. No migrations needed; the schema
    already carries `item_uses`, the budget columns and `cooldown_until`.
    `price_checks` for saved items also waits until then.

### Ordering notes worth respecting

- Step 2 before step 4, so a missing policy surfaces immediately.
- Step 3 early, because every screen depends on those numbers and they are cheap
  to test in isolation and expensive to correct once six components compute them
  inline.
- Steps 9 and 10 are independent: dashboard reads spend; saved items are a
  separate queue. Either order is fine.

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
- **Whether Promotions actually contains order confirmations** in practice.
  Measure recall both ways on a real mailbox before hardcoding either behaviour.
  The exclusion is a config flag, default off.

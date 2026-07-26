# Build order

Do not hand the whole spec over at once. One phase at a time, in this order.

## Done

0. **Google Cloud setup** — *deferred deliberately.* Not needed until step 10.
   See [SETUP.md](SETUP.md) Tier 2.
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

Also done ahead of schedule because they are cheap and everything depends on
them: `lib/fingerprint.ts`, `lib/status.ts` and the SQL/TypeScript agreement
test, CI with dependency scanning, the privacy and terms pages Google will want
at Tier 2.

## Next

7. **Dashboard** on top of that data, reading only from `lib/money.ts`.
8. **Saved items**, URL scraping, OG tag extraction.
9. **Email extraction as a pure function** with the fixtures test suite. No
   database, no OAuth. Get this correct in isolation — it determines whether the
   product works at all.
10. **Gmail OAuth grant**, connection management, token encryption, reauth
    handling. Needs [SETUP.md](SETUP.md) Tier 2 done first.
11. **Onboarding flow** including the pre-consent explanation screen.
12. **Inngest backfill job** wiring stages 1–5 together.
13. **Incremental sync.**
14. **Review queue.**
15. **Account deletion** with token revocation and full cascade.
16. **Phase 2** — the anti-spending layer. No migrations needed; the schema
    already carries `item_uses`, the budget columns and `cooldown_until`.

### Ordering notes worth respecting

- Step 2 before step 4, so a missing policy surfaces immediately.
- Step 3 early, because every screen depends on those numbers and they are cheap
  to test in isolation and expensive to correct once six components compute them
  inline.
- Step 9 before step 10. Debugging a parser and an OAuth flow simultaneously is
  miserable.

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

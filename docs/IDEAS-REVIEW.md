# Reading the ideas page

A record of each pass over the open ideas on `/dev/ideas`, so the next pass
starts from what the last one decided rather than from 60 rows in no order.

A pass reads every open idea, groups them, and removes two kinds: one that
says the same thing as another, and one the code has since made pointless.
Removing means dismissing, which keeps the row under **Dismissed** with a
comment saying why, so anything taken out wrongly is one press from coming
back. An idea you wrote yourself is never touched — only the ones a session
filed. Nothing here is deleted.

The two guards that keep the list from growing back are `lib/ideas/duplicate.ts`,
which refuses a body close to one already filed, and `lib/ideas/rate.ts`, which
stops a session filing more than two an hour.

## 17 September 2026 (plan #545)

65 open, 62 of them filed by sessions over five days. All 65 were read. Four
came out and 61 remain.

Dismissed:

- **A step says when a session is working on it** — built. `lib/plan/handover.ts`
  refuses a step under a feature a session already holds, and `lib/plan/claims.ts`
  expires a claim after two hours so a dead session cannot lock the feature.
- **Fix the two plan-view tests left failing by the Dash rename** — fixed.
  `tests/plan-view.test.tsx` passes 30 of 30.
- **Apply `0017_next_outcomes.sql` to the live project** — applied.
  `learn.next_outcomes` is there with its policy, its read-once index and the
  `readings_user_id_uq` constraint the migration adds to `learn.readings`.
- **Which other long lists should get selection** — the same question as the
  idea about what a selection is for on a list with no batch action, which now
  carries the Select all part too.

The rest stand, and no two of them say the same thing. They group as:

| Group | Count | What they are |
|---|---|---|
| Dev: the plan, runs and Dash | 18 | The conversation with Dash, what a run records, the guards on sending a step |
| Learn | 23 | The graph, the gaps tracks, quizzes, what gets asked next |
| App-wide | 14 | Search and ⌘K, the newsletters, theming, the not-found page |
| Vault, todo, jobs | 6 | Per-module follow-ons |

A quarter of them are the deferred questions migrated off features that
have since shipped, and most of those say in their own words that they cannot
be answered until the thing has been used for a few weeks. They were left
alone deliberately: they are waiting on time rather than on a decision, and
none of them is wrong yet.

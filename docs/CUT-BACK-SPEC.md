# Cutting back

The app has about 130 pages across eight workspaces, and most of the work in
the last month went into making more of them. This spec does three things
before anything else is added: it records which pages are opened, it uses that
record to cut each workspace down to the screens that get used, starting with
Learn, and it slows the build loop while the cutting happens.

Nothing in this spec deletes data. A cut page is hidden or merged into another;
its tables stay, and anything frozen can be brought back.

> **Status:** proposed, 2 October 2026. Not yet in the plan.

## What the numbers say

There is no record of page views today, so these figures come from the rows
each workspace writes when it is used. They are from the live database on
2 October 2026 and cover the previous 30 days unless they say otherwise.

| Workspace | Pages | Plan steps, all time | Notes filed | What was used |
|---|---|---|---|---|
| Learn | 28 | 346 | 10 | 125 feed cards acted on, across 8 days. 4 practice questions answered, on 1 day. 2 clips shown, 0 finished. 4 videos watched. 0 lesson pieces passed. 0 quizzes completed, ever. |
| Shopping | 23 | 39 | 29 | 8 orders recorded, 43 inventory items changed. |
| Jobs | 20 | 31 | 118 | 89 applications added, 259 application events. |
| Vault | 8 | 85 | 10 | 2 Maya threads, ever. The note map holds 4,934 positions and 8,064 merge proposals. |
| Goals | 8 | 142 | 18 | 1,323 history rows. |
| News | 6 | 71 | 18 | 537 Quick read passes. 3 thumbs, which change nothing yet. 0 saved stories. |
| Todo | 4 | 61 | 27 | 52 tasks added, 42 done. |
| Home | 3 | n/a | 10 | 18 morning briefs written, 1 open recorded. Opens are recorded only from the push notification, so this undercounts. |

The pattern is that size and use do not line up. Jobs and Todo are small for
how much they are used. Learn is the largest workspace by pages and by plan
steps, and one of its screens, Learn now, accounts for nearly all of its use.

Model spend is not the reason to cut. Learn's $44 over 30 days was mostly the
one-time build of the vault note map, which finished on 22 and 23 September;
over the last 7 days the whole app spent $18.86, of which Learn was $8.08 and
Jobs $6.98. The cost of the extra pages is in building and maintaining them,
and in the person having to choose between four starting points in Learn.

## Part 1: Record which pages are opened

A table, `core.page_views`, with one row per real navigation: the user, the
path with ids replaced by their route pattern (`/learn/s/[id]`), the workspace,
and the time. It is bookkeeping, so it goes in the sources catalogue as not a
source.

It is written from `proxy.ts`, which already runs on every request and already
has the verified user and the path. It counts document requests and client
navigations, and skips prefetches (the `next-router-prefetch` header), `/api/*`,
server action posts and static files. The insert runs after the response so it
adds no wait to the page. A client navigation arrives as an RSC request without
the prefetch header, which is how it is told apart from a prefetch.

Pressing a button is not recorded in this version. The tables that already
store an `acted_at`, `answered_at` or `opened_at` cover the actions that matter
for the cuts below, and a wrapper on every server action is a larger change
than the first cut needs.

Rows older than 180 days are rolled up into a daily count per route and then
removed, which keeps the table small and keeps the history.

A **Usage** tab in Dev shows, per workspace and per page: opens in the last 7
and 30 days, when it was last opened, and the model spend behind it. A page not
opened in 30 days is listed under "Not opened" at the top. The weekly vision
review (#1104) reads the same numbers, which is what "against use" in its title
was waiting for.

## Part 2: The rule for cutting

Once a page has 30 days of recorded opens, it falls into one of four outcomes:

- **Keep.** It is opened, or it is the only way to do something the person
  does.
- **Merge.** What it shows moves into another page that is opened, and the old
  route redirects there.
- **Freeze.** It leaves the nav and its background jobs stop. The route and the
  tables stay, so a bookmark still works and the data is there if it comes back.
- **Remove.** The page and its code go; the tables stay. Only for pages that are
  already redirects, or frozen pages that stay unopened for another 60 days.

A session proposes the outcome for each page. The person decides on the page,
because removing a page is hard to undo and the person may use something the
numbers miss. A background job whose output no opened page shows is paused with
its page, and its schedule is kept in the migration that defined it so it can
be turned back on.

Learn does not wait for the 30 days. The rows above already show which of its
screens are used, and Part 3 can start straight away.

## Part 3: Learn

Learn's tabs are Home, Learn now, Practice Flow, Tracks, Goals, Reading lists
and Quizzes, plus Videos, Clips and YouTube for the owner. Four of them answer
the question "what should I learn next": Home lists what is waiting, Learn now
mixes reviews into the feed, Flow asks re-check questions, and each lesson piece
shows its own reviews. "Track" means a subject on screen and a reading list in
the code.

The proposed shape is three tabs and one owner tab.

| Tab | What it holds | What it absorbs |
|---|---|---|
| **Now** | The feed, with what is waiting (reviews due, readings queued) as a short strip at the top. A "Practice only" switch shows just the questions. | Home's waiting list, Practice Flow |
| **Subjects** | Each subject, what you know in it, its concepts. | Tracks (`/learn/know`, `/learn/s/[id]`, `/learn/c/[id]`) |
| **Reading lists** | Lists, one list, one reading, adding a list. | unchanged |
| **Videos** (owner) | The playlist, clips from it, and the YouTube library on one page. | Videos, Clips, YouTube |

Redirects already in place (`/learn`, `/learn/next`, `/learn/today`) are kept
until page views show nobody opens them, then removed.

Quizzes, clips and lesson plans are the three parts with almost no use. What to
do with them is the first decision below, because the person may have plans for
them that the numbers do not show.

The feed's dropped cards are worth a look while this is open. Of 131 dropped
cards, 33 failed because "the report did not match its schema" and 8 more for
a hook or example that broke a length rule. Each of those was a paid card the
person never saw, and the fix belongs in the card writer, not in more top-up.
The top-up size stays as the person set it on 23 September: refill at 7 or
fewer, 15 at a time.

## Part 4: The other workspaces

These wait for 30 days of page views. What follows is the starting proposal,
to be checked against the numbers rather than built from as it stands.

**Jobs** is heavily used and has 11 tabs, three more than the design allows. It
is merged, not frozen. A role's pipeline stage, interviews and company are on
the role's page, so the tabs can become Home, Pipeline (with Roles and
Interviews as views of it), People (Companies and Contacts), Prep (Answers and
Career goals), Insights (Analytics and Activity) and Review. That is six.

**Shopping** has nine tabs for 8 orders a month. Returns can be a filter on
Orders, and Sell and Share are both about letting go of things you own. The
numbers decide whether Dashboard, Recurring and Saved stay as tabs.

**Vault** moves Education (transcripts and courses) into Learn, next to the
videos it is read with.

**News** keeps its three tabs. The thumbs either start changing what Quick read
shows or are removed, since a button that does nothing is worse than none.

Redirect-only pages with no opens in 30 days are removed: `/jobs/feedback`,
`/jobs/today`, `/shopping/feedback`, `/shopping/saved/new` and
`/shopping/settings/email`.

## Part 5: Build pace while this happens

In the 30 days to 2 October, 1,399 plan steps were created and 1,340 were
closed, and 314 notes were filed. The overnight runner starts work every four
minutes. Most of the recent notes are about layout on pages that already exist.
The app is being extended faster than the person can use what is there, and
the cuts above will not hold if new pages keep arriving at the same rate.

For four weeks from when this spec is approved:

- A new feature needs a note, idea or answer from the person behind it, or a
  page-view number. Features shaped from ideas a session filed wait.
- The overnight runner keeps building approved steps, so work already decided
  on continues.
- Whether the inspiration and X post routines keep running is the second
  decision below.

Two things found while writing this get fixed regardless. The Sunday week
review is scheduled `11 * * * 0`, which fires every hour on Sundays, and
`core.week_reviews` has no rows, so the review has never been written. And the
morning brief records an open only when it is reached from the push
notification, so its open count says nothing about whether it is read on Home.

## Decisions

**1. What happens to Quizzes, clips and lesson plans in Learn?**

- A. Freeze all three. They leave the nav, the jobs that write lessons and cut
  clips stop, and the tables stay. Cost: anything half-finished in them waits.
- B. Keep lesson plans, freeze Quizzes and clips. Lesson plans are how a
  learning goal turns into steps, and they may be used once Subjects is the
  clearer page. Cost: the largest of the three stays.
- C. Keep all three and only change the nav. Cost: the code and jobs behind
  them stay as they are.

Recommendation: B. Quizzes and clips have no use to point to. Lesson plans are
tied to learning goals, which the person has written four of.

**2. Should the inspiration and X post routines pause during the four weeks?**

- A. Pause both. Inspiration files new ideas and posts draft content about new
  features, and both add to what the cut is trying to slow. Cost: no posts for
  a month.
- B. Pause inspiration only. Posts describe what shipped and add no work to the
  plan. Cost: none beyond A's benefit being smaller.
- C. Keep both.

Recommendation: B. Posts take nothing from the build loop; inspiration feeds it.

**3. Does Learn keep its own Goals tab?**

- A. Move learning goals into Goals, as goals in a Learn area, and let Learn
  read them from there. Cost: the feed and plans read aims from
  `learn.aims` today, so this is a data move and a code change.
- B. Keep the tab, renamed "Aims", inside Learn. Cost: two places called goals
  in one app stays the case.

Recommendation: A, but after Parts 1 to 3, since it is the one change here that
moves data. It also fits [CORE-AND-DASH-SPEC.md](CORE-AND-DASH-SPEC.md), which
gives every workspace one way to say what it is working towards.

## Order of work

1. `core.page_views`, the proxy write, and the Usage tab. Nothing else waits on
   the four-week build rule, which starts on approval.
2. Learn's nav down to Now, Subjects, Reading lists and Videos, with Home and
   Flow merged into Now and "track" renamed on screen.
3. The outcome of decision 1, and the feed card writer's schema failures.
4. The week review schedule and the brief's open record.
5. After 30 days of page views, a proposed outcome for every page in Jobs,
   Shopping, Vault and News, for the person to decide on `/dev/plan`.

## What this does not do

It does not delete rows, change what Jobs can do, or add offline support. It
does not stop work on steps the person has already approved.

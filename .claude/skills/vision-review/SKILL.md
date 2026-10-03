---
name: vision-review
description: Review each workspace's vision against what the person filed and did since the last review, and record the finding in vision_reviews. For every workspace the run writes either a dated "still holds" or a proposed edit citing the notes and likes that argue for it, closes the likes it read, and dismisses session-filed ideas that serve no part of the vision, each with a comment. The first run also drafts fuller visions for workspaces whose vision is one sentence. Use when the weekly tick fires it, or when the user says "review the visions", "run the vision review", or asks whether a workspace's vision still fits.
---

# Reviewing the visions

Each workspace has a vision in `module_visions`: what the person says it is
for. Plan briefs open with it and shaping reads it. This review checks once a
week whether it still describes what the person is actually doing there. The
evidence is what they filed and what got built since the last review.

The output is rows in `vision_reviews`, one per workspace per run, which the
specs page reads (plan #1106). A holds row is dated and says why. An edit
waits beside the vision as `pending` until the person accepts or dismisses
it. The review never writes `module_visions` itself: the vision stays in the
person's words until they accept an edit.

The table, its rules and the loaders are described in
`supabase/migrations/0108_vision_reviews.sql` and `lib/specs/vision-review.ts`.

## How it is fired

Once a week, on Sundays, by `/api/cron/vision-review`, which fires the
routine whose prompt is `reference/routine-prompt.md` and records the fire in
`plan_runs` with job `vision`. The tick refuses when a review was written in
the last six days, so a review run by hand midweek counts as that week's and
the Sunday tick after it starts nothing.

## Working without the CLI

There is no script for this yet. Use the **`Supabase`** connector
(`mcp__Supabase__*`, loaded through ToolSearch), project ref
`asjztutnqxbecruvyrbj`, and filter every query by the account's `user_id`.
The SQL below is what a run writes.

Before starting, generate one `review_id` for the run
(`select gen_random_uuid()`) and use it on every row the run writes. Take the
session id from `CLAUDE_CODE_REMOTE_SESSION_ID` (the `cse_…` value) for
`session_id`, or leave it null when there is none.

## Which workspaces

Every id in `MODULE_IDS` (`lib/modules.ts`): shopping, jobs, todo, vault,
learn, news, goals and dev. Each gets exactly one row from the run.

The app as a whole is reviewed under `app` only when `module_visions` has an
`app` row. When it has none, skip it and say so in the report: there is no
vision to check, and writing one is the person's job, not a review's.

## What to read for each workspace

The window is everything since the workspace's last review
(`max(created_at)` in `vision_reviews` for that module). On the first run
there is no review, so the window starts when the vision was last written
(`module_visions.updated_at`): anything older was there when the person
wrote it.

```sql
-- the vision, and when it was written
select module, body, updated_at from module_visions where user_id = '…';

-- when each workspace was last reviewed
select module, max(created_at) as last_review from vision_reviews
where user_id = '…' group by module;

-- a pending edit, if there is one (at most one per workspace)
select id, module, proposed_body, note, evidence_ids, created_at
from vision_reviews where user_id = '…' and status = 'pending';

-- notes (bugs and feature requests) filed in the window. The workspace is
-- the first segment of page_path, the same mapping as moduleForPath().
select id, kind, page_path, body, created_at from feedback_items
where user_id = '…' and kind in ('bug', 'feature') and created_at >= '<window start>'
order by page_path, created_at;

-- likes: every open one, whatever its date. Closing them is what keeps the
-- next run from reading them again.
select id, page_path, body, created_at from feedback_items
where user_id = '…' and kind = 'like' and status = 'open'
order by page_path, created_at;

-- steps finished and dropped in the window
select number, title, status, completed_at from plan_items
where user_id = '…' and module = '<workspace>' and kind = 'build'
  and status in ('done', 'dropped') and updated_at >= '<window start>'
order by updated_at;

-- ideas the person dismissed in the window. A dismissal this review made
-- carries a comment starting 'Dismissed by the vision review', so leave
-- those out: they say what a session thought, not what the person did.
select i.id, i.source, i.body, i.dismissed_at from ideas i
where i.user_id = '…' and i.module = '<workspace>'
  and i.dismissed_at >= '<window start>'
  and not exists (
    select 1 from core.thread_turns c
    where c.ref = 'public.ideas:' || i.id and c.author = 'claude'
      and c.body like 'Dismissed by the vision review%'
  );
```

### Page opens

What the person opens is the other half of the evidence (plan #1483):
a workspace they file nothing about but open every day is in use, and one
they never open is not, whatever its notes say. Since plan #1481 every page
they open is recorded in `core.page_views`. `core.workspace_opens` counts
the opens and the distinct pages opened per workspace since a time, reaching
into the daily counts in `core.page_view_days` for anything older than 180
days. A workspace with no opens in the window has no row, and `workspace`
is null for pages outside every workspace (`/home`, `/ask`), which go under
`app`.

The turn that fires the run already lists the opens since the last review.
Read them again for a workspace whose window differs from that:

```sql
-- opens and pages opened per workspace since the window's start
select workspace, opens, pages
from core.workspace_opens('…', '<window start>');

-- when recording began: anything before this was never measured
select least(
  (select min(viewed_at) from core.page_views where user_id = '…'),
  (select min(day)::timestamptz from core.page_view_days where user_id = '…')
) as recording_since;

-- which pages, when a count needs explaining
select route, count(*) as opens from core.page_views
where user_id = '…' and workspace = '<workspace>' and viewed_at >= '<window start>'
group by route order by opens desc;
```

**Cite the opens in every row's note**, holds or edit: the count for the
window and, where it matters, the pages behind it ("41 opens across 6 pages
since 27 Sep, nearly all /jobs/board"). When `recording_since` is null,
nothing has been recorded yet: say "no page opens recorded yet" and do not
read it as disuse. When recording began after the window's start, say the
count covers only the days since then.

Opens weigh the vision the same way notes do. Steady opens of a part the
vision leaves out can argue for naming it, and a workspace opened rarely is
worth a sentence in a holds note. Opens alone never argue for an edit
removing something: a cut is the person's call, not the
review's.

A note filed from a workspace's page is not always about that workspace. The
header, the search bar, the module switcher and the mobile dock are on every
page, so a note about them says nothing about the workspace it was filed
from. Count it under `app` (or nowhere, when there is no app vision). Paths
outside every module prefix, such as `/home`, also go under `app`.

## Deciding holds or edit

Group what you read by what it is about, then compare each group with the
vision. Three things can come out of that.

- Nothing in the window goes past what the vision already says, or all of it
  is local: a layout fix, a broken button, a missing field. The vision holds.
  Most weeks, most workspaces are this.
- Several notes or likes point at something the vision does not cover, or
  contradict something it says. That is a finding, and the edit proposes the
  sentence that would cover it.
- A single note points that way. Mention it in the holds note, so the next
  run can see whether it recurs.

**How many notes make a finding is not settled.** Nobody has written the
rule down, and inventing a number here would only hide that. The first two
or three reviews, read against which edits the person accepts and which they
dismiss, should show where the line is (the fog on plan #1104). Until then:

- Lean towards holds.
- In every note, give the window's page opens (see "Page opens").
- In every note, say how many items the finding rests on and why they point
  at the vision rather than at one screen.
- In a holds note, name anything that nearly made an edit.

Those sentences are what the person's accepts and dismisses will be read
against when the rule is written.

A liked thing is evidence that the vision's direction is right, and it can
also argue for naming something the vision leaves out. It is never evidence
for removing anything.

## Writing the result

One row per workspace, all with the run's `review_id`.

```sql
-- still holds. No proposed text, no status, no evidence: the database
-- refuses a holds row with any of them.
insert into vision_reviews (user_id, module, review_id, session_id, outcome,
                            vision_body, note)
values ('…', 'jobs', '<review_id>', '<cse_…>', 'holds', '<the vision as read>',
        '<what the window held and why the vision still covers it>');

-- a proposed edit. evidence_ids are feedback_items ids only (notes and likes).
insert into vision_reviews (user_id, module, review_id, session_id, outcome,
                            vision_body, proposed_body, note, evidence_ids,
                            status)
values ('…', 'news', '<review_id>', '<cse_…>', 'edit', '<the vision as read>',
        '<the whole vision as it would read>', '<the argument>',
        array['<id>', '<id>']::uuid[], 'pending');
```

`proposed_body` is the whole vision as it would read after accepting, not a
diff: accepting copies it into `module_visions` as it stands. Write it in the
person's voice and keep their sentences where they still hold. Extend what
they wrote rather than replacing it with your own framing.

**When an edit is already pending** for the workspace, the database refuses a
second one. Do not dismiss it: deciding an edit is the person's move. Update
the pending row instead, so the run still leaves one result for the
workspace. Stamp it with this run, fold in any new evidence, and rewrite the
proposed text only if the new evidence changes it:

```sql
update vision_reviews
set review_id = '<review_id>', session_id = '<cse_…>',
    proposed_body = '<unchanged, or rewritten>',
    note = '<the argument, with "First proposed <date>." at the end>',
    evidence_ids = (select array_agg(distinct e) from unnest(evidence_ids || array['<new id>']::uuid[]) e)
where id = '<the pending edit>' and user_id = '…' and status = 'pending';
```

**Accepting an edit also re-reads the workspace's open features.** Decision
#1109 settled that, and the run it starts follows "After a vision edit" in
`.claude/skills/plan/reference/reshaping.md`, writing only proposals and
questions. The app starts that run when the person accepts; this review does
not. The review proposes edits to the vision and nothing else, and it does
not touch plan features.

## The first run: drafting fuller visions

On the first run, when no workspace has a row in `vision_reviews` yet, a
workspace whose vision is one sentence gets a drafted fuller vision as its
edit. Dev's "Help make the website." is the example the feature names.

Draft it from what the person has written for that workspace: the ideas they
filed themselves (`ideas.source = 'me'`), their notes, and what they liked.
Keep their sentence as the opening line and add two to four sentences on
what the workspace is for, as their own words show it. Do not add goals
they have not expressed. The note says it is a first-run draft of a
one-sentence vision, and names what each added sentence comes from. Cite the
notes and likes it rests on in `evidence_ids`; ideas cannot be cited there,
so name them in the note.

A workspace whose vision is already more than one sentence is reviewed the
ordinary way on the first run too.

## Closing the likes it read

A like stays `open` until a review has read it. The notes queue leaves likes
alone (`.claude/skills/notes`, "Likes are not in the queue"), so this is the
only place they close. Close every like the run read, whether it was cited
or not, once the workspace's row is written:

```sql
update feedback_items
set status = 'done', completed_at = now(), commit_sha = null,
    resolution_note = 'Read by the vision review of <D Mon YYYY>: <cited in the proposed edit to the <workspace> vision | the <workspace> vision still holds>.'
where user_id = '…' and kind = 'like' and status = 'open' and id in ('<id>', …);
```

Record each like it closed with `core.record_dash_action`, in the same call
as the update, keeping the rows first with `core.dash_before`, so Home lists
them under what Dash did today with an Undo:

```sql
select core.dash_before('public.feedback_items:' || id) from feedback_items
where user_id = '…' and kind = 'like' and status = 'open' and id in ('<id>', …);
update feedback_items set … ;  -- the update above
select core.record_dash_action('…', 'public.feedback_items:' || id, 'update', 'close_like',
  $s$Dash read your like in the review of the <workspace> vision and closed it.$s$)
from feedback_items where user_id = '…' and id in ('<id>', …);
```

`done` is the status because a like asks for nothing, so reading it is all
there is to do. A like is never `declined`. `commit_sha` stays null: no
commit closed it.

## Dismissing session-filed ideas

Sessions file ideas (`ideas.source = 'claude'`) far faster than the person
reads them. The review dismisses the ones that serve no part of the
workspace's vision. This is the one place a session dismisses anything: the
person asked for it when they approved plan #1104. Everywhere else the rule
in `.claude/skills/plan/reference/dismissed.md` stands.

Read every live, unshaped session idea in the workspace:

```sql
select id, body, created_at from ideas
where user_id = '…' and source = 'claude' and dismissed_at is null
  and plan_item_id is null and module = '<workspace>'
order by created_at;
```

Dismiss one only when it clearly serves no part of the vision:

- It is about something the workspace is not for.
- What it asks for is already on main, so it asks for nothing any more.
- It is repository housekeeping filed as an idea, which serves no vision.
  The person has dismissed ideas of this kind by hand before (applying a
  migration, fixing a failing test).

An idea that is merely small, old or unlikely still serves the vision if
building it would move the workspace towards what the vision says. Leave it.
When in doubt, leave it. The person can dismiss it in one press, and a
wrong dismissal hides a suggestion they may have wanted.

Never dismiss an idea the person filed (`source = 'me'`), and never one
that has been shaped into a feature (`plan_item_id` set). Ideas with no
module are judged against the `app` vision, and left alone while there is
none.

Each dismissal is two writes, and the comment is what the person reads under
the idea on `/dev/ideas`:

```sql
select core.dash_before('public.ideas:<idea>');
update ideas set dismissed_at = now()
where id = '<idea>' and user_id = '…' and source = 'claude' and dismissed_at is null;
select core.record_dash_action('…', 'public.ideas:<idea>', 'update', 'dismiss_idea',
  $s$Dash set aside the idea "<its first words>" in the vision review: <why, in a few words>.$s$);

select core.add_thread_turn('…', 'public.ideas:<idea>', 'claude',
  'Dismissed by the vision review of <D Mon YYYY>: <which part of the vision it does not serve, or what already did it>.');
```

Keep the opening words exactly. The next run finds its own dismissals by
them, so it does not count them as the person's. The comment is written after
the record call: it hangs off the idea and does not change the idea's row.

## Before stopping

Check that the run landed:

```sql
-- one row per workspace for this run
select module, outcome, status from vision_reviews
where user_id = '…' and review_id = '<review_id>' order by module;

-- nothing left open that the run read
select count(*) from feedback_items
where user_id = '…' and kind = 'like' and status = 'open'
  and created_at <= '<when the run read them>';
```

Then report:

- The run's `review_id`.
- Each workspace's outcome, in one line.
- The edits proposed, with how many notes and likes each rests on.
- The likes closed.
- The ideas dismissed, with the reason for each.
- Anything skipped, such as `app` with no vision.

Write every note, draft and comment to `docs/WRITING-GUIDE.md`. The person
reads these on the specs page and under their ideas. In anything they read,
the assistant is Dash.

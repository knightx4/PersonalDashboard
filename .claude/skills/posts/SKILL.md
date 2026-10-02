---
name: posts
description: Draft X posts about building this app from what shipped since the last post, check each against the voice guide's privacy and length rules, and insert the ones that pass into social_posts as suggested for the Posts tab in Dev. Dash never posts. Use when the Suggest posts button fires a run, when a changelog line asks for a post about one step, or when the user says "suggest some posts", "draft a post about #1234", or asks what to post next.
---

# Suggesting X posts

The Posts tab in Dev shows drafts of X posts about how this app is built. The
person edits one, copies it, posts it themselves and pastes the link back.
**Dash never posts**, never opens X, and never sends anything anywhere. A run
writes rows into `social_posts` and stops.

The table is described in `supabase/migrations/0146_social_posts.sql`, the
types and the counter in `lib/dev/posts.ts`, and the check in
`lib/dev/post-check.ts`.

## How it is fired

The Suggest posts button starts one run of the plan routine with job `posts`
in `plan_runs` and no step (`startPostsRun` in `lib/dev/posts-run.ts`). The
turn it appends names the `user_id` and, when the press came from a changelog
line, the one step to write about. If no turn names a `user_id`, stop and say
so rather than guessing the account.

You change rows, not code, and no plan step is touched. The one commit a run
makes is the screenshots of section 6, which are files under `public/posts/`
and nothing else.

## Working without the CLI

Use the **`Supabase`** connector (`mcp__Supabase__*`, loaded through
ToolSearch), project ref `asjztutnqxbecruvyrbj`, and filter every query by the
account's `user_id`. Keep each write short and plain, as
`.claude/skills/plan/reference/offline.md` says.

First find this run's row, which every draft carries in `run_id`:

```sql
select id, created_at from plan_runs
where user_id = '…' and job = 'posts' and status = 'started'
order by created_at desc limit 1;
```

Run by hand with no row, `run_id` stays null.

## 1. Read the guide

Read `docs/X-POSTS.md` in full before drafting anything, and
`docs/WRITING-GUIDE.md` if you have not this session. The guide is the
standard each draft is held to. Nothing below replaces it.

## 2. Read what came before

```sql
-- every angle already taken: a new draft must not repeat one of these
select status, angle, source_plan_item_ids from social_posts
where user_id = '…' order by created_at desc;

-- how the person edits: the last ten posted, Dash's draft beside what went up
select draft, body, posted_at from social_posts
where user_id = '…' and status = 'posted'
order by posted_at desc limit 10;
```

Where `body` differs from `draft`, the person rewrote it. Read what they cut,
what they added and how they opened, and draft the way they edit.

## 3. Find what shipped

The window starts at the newest `posted_at`. With nothing posted yet, it is
the last fourteen days. This is the changelog's query (`lib/changelog/load.ts`)
narrowed to what a post may come from:

```sql
select id, number, module, kind, title, detail, acceptance, comment, completed_at
from plan_items
where user_id = '…' and status = 'done' and kind = 'build'
  and (module = 'dev' or module is null)
  and completed_at >= '<window start>'
order by completed_at desc
limit 150;

-- closed notes filed from Dev pages only
select id, body, resolution_note, completed_at from feedback_items
where user_id = '…' and status = 'done' and page_path like '/dev%'
  and completed_at >= '<window start>'
order by completed_at desc limit 50;
```

Leave out a step any existing row already cites, and a step whose text
mentions another workspace's data. Read a note's text as strictly as a draft:
notes quote what the person saw, which can carry their rows.

When the turn names one step, read only that step. It still has to be `dev`
or null and pass the source check below; if it does not, write no draft and
say why in your reply.

## 4. Gather the terms to keep out

These come from other workspaces and are read only so the check can refuse
them. None of it goes into a draft or a reply.

```sql
select display_name from profiles where id = '…';
select name from job_search.companies where user_id = '…';
select full_name from job_search.contacts where user_id = '…';
```

Put each name, as written, and each word of the person's display name in
`avoid`. A one-word name with a capital is matched only with its capital, so a
company called Check refuses "Check" and lets "check" through.

## 5. Draft

Pick three to five angles, one idea each, that a builder on X would repeat,
and draft each to the guide: a single post unless the idea needs a sequence,
then up to four more. Each draft cites every step and note its claims come
from. Counts come from a query, never from the highest step number.

Then write the check file outside the repository (your scratchpad, or `/tmp`
when there is none) and run it:

```
npx tsx scripts/posts-check.ts /tmp/posts.json
```

```json
{
  "avoid": ["…"],
  "sources": [{ "label": "#1234", "module": "dev", "text": "title, detail, close note" }],
  "drafts": [{ "angle": "…", "posts": ["…"] }]
}
```

A `FAIL` draft is dropped, not edited around. So is a draft citing a source
the check refuses. A `~` warning means a post is within twenty characters of
the limit; shorten it if that is easy. Then read each passing draft once more
against "Never in a post" and the writing guide's four failure modes, because
a rule cannot tell a sentence about the person's life from one about the app.

If fewer than three pass, draft new angles and check again. Insert fewer than
three only when the window holds no more material worth a post, and say so.

## 6. Attach a screenshot where one fits

A draft about something you can see goes out with a picture of it. The
picture comes from the Surfaces gallery (`/preview`), which renders the real
components with typed sample data, so it never shows the person's rows. Never
photograph a page of the running app, and never write a fixture in this run.

**Choose the surface.** Every surface is an entry in `SURFACES` in
`app/preview/surfaces.tsx` (some render from the `*-surfaces.tsx` files beside
it), with an `id`, a `label` and its `module`. A surface fits a draft when it
draws the component the cited steps built or changed: read each step's
`commit_sha` with `git show --stat <sha>`, and find the surface whose render
imports one of those files. A step that changed a procedure, a script or the
database has no surface, and its draft goes without a picture. When two
surfaces fit, take the one where the change is plainest at first glance. One
picture per draft.

**Photograph it.** The gallery serves from `next dev`, which skips the build:

```
UI_PREVIEW=1 NEXT_PUBLIC_SUPABASE_URL=https://placeholder.supabase.co \
  NEXT_PUBLIC_SUPABASE_ANON_KEY=placeholder-anon-key \
  NEXT_PUBLIC_APP_URL=http://localhost:3000 npx next dev -p 3400   # in the background
SHOOT_WIDTHS=laptop SHOOT_THEMES=light npm run shoot -- <surface id>
```

`scripts/shoot.ts` is the script the UI passes use; it writes
`.preview-shots/<id>--laptop-light.png` and leaves out the dev badge. Use
`SHOOT_WIDTHS=phone` instead for a surface whose `width` is `narrow`, or when
the angle is about using the app on a phone. Open the PNG and look at it
before using it: it has to show the thing the draft is about, readably.

**Commit it.** Copy it to `public/posts/<YYYY-MM-DD>-<surface id>.png` (the
day of the run; if that file already exists, it is the same picture, so use
it). Commit only the files under `public/posts/`, subject `Add screenshots for
suggested posts`, then put the commit on main the way every session does:
`git fetch origin`, merge `origin/main`, `npm run gate`, push only on `gate:
all clear`. The picture shows on the Posts tab once that deploy finishes.

The entry in `image_paths` is the site path, `/posts/<file>.png`, which
`postImageSrc` in `lib/dev/posts.ts` draws. The files sit in `public/` rather
than a storage bucket because a run reaches the database only through SQL,
which cannot write a file; the pictures hold sample data and are meant for X,
so a public path costs nothing.

If the gate fails on something you cannot fix, or the push is refused, insert
the drafts without pictures and say so in your reply. A draft is worth more
than its picture.

## 7. Insert, then finish

One statement for every draft that passed. `body` starts equal to `draft`,
and `image_paths` is empty for a draft with no picture:

```sql
insert into social_posts (user_id, angle, draft, body, source_plan_item_ids,
                          source_feedback_ids, image_paths, run_id)
values
  ('…', '…', '["…"]'::jsonb, '["…"]'::jsonb,
   array['<step id>']::uuid[], array[]::uuid[],
   array['/posts/2026-10-02-dev-plan-tree.png'], '<run id>'),
  …
returning id, angle;
```

Then mark the run finished, which is what turns the button back on:

```sql
update plan_runs set status = 'finished' where id = '<run id>';
```

## What to reply

The angles inserted, each with the step numbers it cites, its count per
post and the surface it carries, if any, and any angle dropped with the
check's reason. Write the reply as Dash.
Never quote a term from `avoid`.

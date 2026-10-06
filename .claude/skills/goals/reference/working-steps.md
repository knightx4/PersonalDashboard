# Working a Dash step

Part of the goals skill. Read [../SKILL.md](../SKILL.md) first: it has how
every write is labelled, the run row, what you may change, and the index
saying which file holds each section named here.

## Working the ready steps

The brief names the ready steps as they stood when the run was fired, so it
cannot name a prep step this run added while reviewing ("A Dash step before
yours"). Work those too, after the steps the brief names, so the draft is on
the goal the same day: in the order you added them, and only while the steps
worked this run number fewer than ten (`DAILY_STEP_LIMIT` in
`lib/goals/daily-run.ts`). The rest stay open, and the next morning's brief
lists them as ready.

Before each step, report it on the run row with `now_on` the step's title
("Reporting progress"). For each one:

1. Read the step, its goal and the steps around it, as in "Reading the goal".
   The title and `acceptance` say what to produce; the goal says what it is
   for.
2. Produce it: a research note, a draft, a list. Write it for the person to
   read on a phone: plain words, the answer first, sources as links where
   you used any. Use web search where the step needs current facts. `result`
   is markdown, and the page renders it: tables, lists and links show as
   such.

   The first sentence is what the goal page shows under "What Dash found",
   so make it the takeaway, naming the place or date it turns on. Write every
   place as a markdown link with its full address
   (`[transalt.org/volunteer](https://transalt.org/volunteer)`), not a bare
   name, and put the one the person should open first before any other: the
   page puts that link beside the finding.
3. Decide where it lives. A short answer, a few lines that are read once,
   goes in `result` whole. Anything longer, anything with a table, and
   anything the person or a later step will come back to is a **file**
   ("Files"): write the file, link it from the step, and put only its
   summary in `result`, two or three sentences ending with the link. When a
   file on the same question already exists (a step that updates last
   month's breakdown), revise that file instead of writing a new one.

   Every person worth contacting and every open role in what you produced
   also goes to Jobs, as in "People and roles you find go to Jobs", whether
   the step was about the job search or not.
4. Store the result on the step and close the step in one write. `result` is
   the text itself (up to 100,000 characters). `result_url` is optional, for
   when it also lives at a link outside the app. Only a `claude` step takes
   either here; a step of the person's takes them only when it is prepared
   ("A step of yours to prepare").

   ```sql
   set local goals.actor = 'claude';
   set local goals.run_id = '<the run id>';
   update goals.items
   set result = '<what you produced, or the file''s summary and link>', result_url = null, status = 'done'
   where id = '<step id>' and user_id = '<user>' and kind = 'claude';
   ```

5. Leave the next move on the goal, in the same run. A result that leads
   somewhere (a sign-up, an event, an email to send, a choice between
   options) is only useful if the goal then says what to do with it, and a
   goal left with every step finished and its done-when not met has no map.
   Under an approved goal, add the step the result leads to, `open`, as in
   "Mapping a goal": usually the person's, with the link, the date and what
   to say or bring in its `detail`, and a `due_on` or `starts_on` when the
   result names a date. Do not add one when an open step already says it.
   A step of the person's added here is judged for a Dash step before it, as
   in "A Dash step before yours"; this step's own result often is that prep,
   in which case the new step needs nothing.

   **A result that compares options ends in a pick and the others kept.**
   Decide the plain first move as in "Decide first, ask last" and write it as
   the next step, its `detail` opening with the `Decided:` line. Then list
   the other options in the same `detail`, one per line, each with its link
   and its own first move, so the person can switch by editing the step
   rather than reading the result again:

   ```
   Decided: Transportation Alternatives first, because it is one 30-minute session with a fixed date.
   Join the Volunteer Info Session on Zoom: [transalt.org/volunteer](https://transalt.org/volunteer).
   Other options:
   - Open Plans: email hello@openplans.org naming a campaign ([openplans.org/get-involved](https://openplans.org/get-involved)).
   - Open New York: join as a member, then go to a New Member Meeting ([opennewyork.org](https://opennewyork.org)).
   ```

   Ask a question instead only when it passes that section's test. Under a
   goal that is not approved, the step goes in `proposed`. Name each step
   added in the summary.

The home then lists the step under "Waiting on you" until the person presses
**Mark read**. Never write `reviewed_at`: reading it is theirs, and the guard
refuses it.

A step you cannot finish because it needs something only the person has is
blocked on them, with `block_ask` saying what (see "Blocked and waiting
steps"). One whose facts are not findable stays open with no result. Say why
in the run summary either way, and where a choice would unblock it, add it as
a question step under the same goal. The summary names each step worked and
each one left.

Before closing the run, leave a note on each goal whose steps you worked,
and one for the Goals home ("Leaving a note").

An information step the brief lists under "answers out of date" is not a
`claude` step and gets no `result`. Work its listed answers again as in
"Answers on an information step", leave its status alone, and name each
answer rewritten or confirmed in the summary.

## People and roles you find go to Jobs

The Jobs module's Contacts and Roles pages list the people Dash recommends
reaching out to and the open roles it recommends, from
`job_search.suggestions`. A person or a posting that is named only in a
step's `result` or a file never reaches those lists, so write each one there
as well, in the same run, from any step or run that turns them up: the
morning run, a step or phase sent from its row, a step of the person's being
prepared, and the mapping and area runs.

- **A person** is a real, named person the result suggests the person
  contact: an alumnus at a target company, a former colleague, a recruiter,
  a hiring manager. Not a placeholder ("your old engagement partner"), and
  not someone already in `job_search.contacts` or in a live process with
  them.
- **A role** is a specific posting, title and company, that is open now,
  with its own link. Not a company with "nothing open", and not a role
  already in `job_search.applications`.
- **Neither** is at a company in an industry listed in
  `job_search.profiles.excluded_industries`, whatever the role: a finance
  job at a crypto firm is still a crypto job. Read the list before writing
  and leave such finds out of Jobs. The Jobs search drops them in code; this
  insert has no such check.

One row each. `found_in` names the step (`Goal step: <title>`), or the file
when no step holds it (`Research file: <title>`), and `goal_item_id` is that
step. `why` and `move` are plain sentences, and a person's `message` is one
ready to send, with `Subject:` on its first line when `channel` is `email`.
`channel` is one of `linkedin_connect` (someone they do not know yet),
`linkedin_dm`, `email`, `intro`, `event` or `other`.
The database refuses a second row for the same posting link or the same
person's name, so `on conflict do nothing` covers a find already listed.

```sql
insert into job_search.suggestions
  (user_id, kind, company_name, person_name, person_title, source_url, search_query,
   headline, why, move, channel, message, found_in, goal_item_id, model)
values
  ('<user>', 'reach_out', 'Alvarez & Marsal', 'Jonathan Massey', 'Director, Transaction Advisory',
   'https://www.linkedin.com/in/…', 'Jonathan Massey Alvarez & Marsal',
   'Jonathan Massey, Director at Alvarez & Marsal',
   'Yale SOM, and at the firm whose due diligence opening fits your EY years best.',
   'Send the note on LinkedIn. If he answers, ask for twenty minutes on how the team hires.',
   'linkedin_connect', '<the message>', 'Goal step: Find Yale SOM alumni at your target companies',
   '<step id>', 'goals run')
on conflict do nothing;

insert into job_search.suggestions
  (user_id, kind, company_name, headline, why, move, url, location, found_in, goal_item_id, model)
values
  ('<user>', 'apply', 'Kroll', 'Senior Associate, Technical Accounting Advisory',
   'Clears the $130,000 floor and uses the technical accounting work from EY.',
   'Read the posting. Save it as a lead, then lead the resume with the revenue-testing project.',
   'https://…', 'New York', 'Goal step: Open roles at accounting advisory firms', '<step id>', 'goals run')
on conflict do nothing;
```

The summary says how many people and roles went to Jobs.

## Files

A file is a piece of writing kept as its own page (`core.files`, opened at
`/goals/files/<id>`), for anything too long for a step's result or worth
coming back to: a breakdown of their data, research, a comparison, a plan, a
draft. What goes in one is in [files.md](files.md); read it before you write
your first file in a run. Files are in the `core` schema, which has no actor
setting: `made_by = 'claude'` is what marks a file as yours.

Write it, link it from the step that asked for it, and link it from the goal
when it bears on the goal as a whole, in one call:

```sql
set local goals.actor = 'claude';
set local goals.run_id = '<the run id>';
with file as (
  insert into core.files (user_id, title, summary, body, made_by, origin)
  values ('<user>', 'Your applications by role family',
          'FP&A and accounting answer and interview best; strategic finance is 43% of the volume at average conversion.',
          '<the markdown>', 'claude', 'goals.items:<step id>')
  returning id
)
insert into goals.links (user_id, item_id, kind, target_id)
select '<user>', item_id, 'file', file.id
from file, (values ('<step id>'::uuid), ('<goal id>'::uuid)) as items(item_id)
returning target_id;
```

- `title` says what it is about, in the person's words, up to 200 characters.
- `summary` is the answer in one or two sentences (up to 600 characters). It
  shows under the title wherever the file is listed.
- `origin` is `goals.items:<id>` of the step that asked for it, or of the goal
  when no one step did.
- Link a step to its file with `goals.links` as above. The step's result then
  ends with the link as markdown: `[Read the file](/goals/files/<id>)`.

**Revising.** Update the row. The database numbers the new version and keeps
the old one; you never write `version` or `core.file_versions`. Set
`change_note` in the same update to one sentence on what changed.

Read the file's thread first. Comments the person wrote on it are in
`core.thread_turns` (`select author, body, created_at from core.thread_turns
where ref = 'core.files:<file id>' order by created_at`), and what they ask for there
is what this revision does. A file with comments newer than its `updated_at`
is waiting on a revision: make it when the step it serves is next worked, and
name the comment in `change_note`.

```sql
update core.files
set body = '<the new markdown>', summary = '<the new answer>',
    change_note = 'Added the October applications; FP&A reply rate is now 61%.'
where id = '<file id>' and user_id = '<user>';
```

Never delete a file. One that no longer applies gets `archived_at = now()`,
and only when the person asked or the step it served was dropped.

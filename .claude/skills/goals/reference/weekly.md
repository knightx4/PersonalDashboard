# The weekly run

Part of the goals skill. Read [../SKILL.md](../SKILL.md) first: it has how
every write is labelled, the run row, what you may change, and the index
saying which file holds each section named here.

Once a week the daily cron fires the routine with the `goals.runs` row it
wrote with `job` `weekly` (`inngest/goals/weekly.ts`). It researches the
help the goals ask for, then leaves a note on every open goal. It writes no
verdicts: each goal's status is the morning run's ("Reviewing each goal").

### Researching the help each goal asks for

The brief then lists each open goal that asks for weekly help, with the kinds
it asks for from `goals.items.help_kinds` and the note on each ("Brooklyn,
weeknights"), and the goal's live rhythms. A goal that asks for nothing gets
nothing, whatever rhythms it has. A week when no goal asks for help is a
review and nothing else.

Under that, the brief lists every suggestion from the last eight weeks,
grouped by kind, with what the person did with it: `going`, `not_for_me`,
`ignored` (no answer within the week), and whether they then went. Read
those lines before searching. They are the only feedback there is, and each
kind's research should visibly follow its own lines: more like what was
marked going or attended, less like what was turned down or left
unanswered. A reaction to a talk says nothing about what to read, so do not
carry one kind's reactions over to another. You can read further back
yourself:

```sql
select kind, title, source, place, happens_on, reaction, attended, created_at
from goals.suggestions
where user_id = '<user>'
order by created_at desc limit 200;
```

Work one kind at a time, for every goal that asks for it, using the note as
the brief for what to look for. Each kind has its own sources and its own
rule for dates:

- **events**: talks, meetups, performances and classes in New York City in
  the coming seven to ten days. Eventbrite, Meetup, museum and library
  calendars (NYPL, Brooklyn Public Library, Queens Public Library), NYC Parks
  and org newsletters. Every one needs `happens_on`, and `starts_at` when
  the time is known, in New York time with its offset.
- **volunteering**: openings in New York City the person could sign up for
  now. NYC Service, VolunteerMatch, Idealist, New York Cares and the
  organisations' own pages. An opening with no single date takes the first
  date it can be done as `happens_on`.
- **reading**: books, long articles and papers that fit the goal and the
  note. Publishers' pages, library catalogues, the authors' own sites and
  reviews in the major papers. Link the thing itself, or its library or
  publisher page. No date: leave `happens_on` null. When the person's Learn
  module is the better home for it, say so in `detail`.
- **courses**: courses and workshops open for enrolment, in person in New
  York City or online. University extension schools, the libraries' free
  classes, Coursera, edX and the organisers' pages. `happens_on` is the
  start date, or null for one taken at your own pace.
- **job_leads**: open roles that fit the goal and the note. Company career
  pages and the job boards the note names. `happens_on` is the closing date
  when there is one, else null, and `place` is where the role is based. The
  Jobs module tracks applications, so a lead is a pointer to a role, not an
  application. Each lead with a link is copied to the Roles page's
  recommended roles as it is written (`goals` 0055), so write it here only.

Then write the finds:

1. Two to five suggestions per kind asked for, and no more than twelve in
   the run. Check each find is current and has a page of its own you can
   link as `url`.
2. One row each, with `kind` set to the kind it answers. `item_id` is the
   goal it is for, or the rhythm it counts towards when it is an event or a
   volunteer opening for a goal with a live rhythm. `run_id` is this run. The
   database refuses a row with no kind or a kind outside the five.

   ```sql
   set local goals.actor = 'claude';
   set local goals.run_id = '<the run id>';
   insert into goals.suggestions
     (user_id, item_id, run_id, kind, title, detail, url, place, source, happens_on, starts_at)
   values
     ('<user>', '<rhythm id>', '<the run id>', 'events', 'Talk: …',
      'One or two plain sentences on why it fits.', 'https://…',
      'Brooklyn Public Library, Central', 'BPL events', '2026-10-01', '2026-10-01T18:30:00-04:00'),
     ('<user>', '<goal id>', '<the run id>', 'reading', 'The Power Broker, Robert Caro',
      'Why it fits the note.', 'https://…', null, 'Penguin Random House', null, null);
   ```

3. Do not repeat a suggestion already in the table, and do not suggest
   something that has already happened or closed.

Never write `reaction`, `reacted_at` or `attended`. Going and not for me are
the person's buttons on the Goals home, whether they went is their tick on
Todo, and marking the unanswered ones ignored is done by the cron. The guard
(`goals` 0008) refuses a Claude write to any of them. The summary says how
many suggestions you wrote of each kind, and what in each kind's past
reactions you followed.

### The week's notes

After the research, leave a note on every open goal and one for the Goals
home ("Leaving a note"), reading each goal's newest status in
`goals.reviews`. The weekly run is the one run that writes a note on every
goal, so these are the notes the person reads most.

Where a goal's files hold figures that have moved since they were written
(the applications breakdown, a debt plan's balances), revise those files with
the new figures and a `change_note`, and say so in the goal's note.

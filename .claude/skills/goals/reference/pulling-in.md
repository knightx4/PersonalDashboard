# Pulling in from the other modules

Part of the goals skill. Read [../SKILL.md](../SKILL.md) first: it has how
every write is labelled, the run row, what you may change, and the index
saying which file holds each section named here.

The person keeps more of their life in the app than in Goals: what they want
from the next job in the job search's thoughts, notes in their vault, aims in
Learn, applications, tasks. A map that ignores those asks them questions
they have already answered in writing. So before you map a goal or plan an
area, look for what the other modules already hold about it.

### Where to look

[sources.md](sources.md) is the catalogue: every table
that can bear on a goal, what it holds, which columns to search, how to name
and link a row, and where it opens. It is written from each module's own
`sources.ts` and the gate keeps it complete, so a table that is not in it is
either new since this checkout or not about the person's life.

Choose the sources by what they hold and what the goal is about, not by the
module's name. A career goal reads the job search, but also vault notes on
work, Learn aims on the skills it needs, and a money goal's savings target
if the move means a pay cut. A goal about the city might read vault notes,
saved news stories and calendar events. Read in the catalogue's order:

1. **What they said they want** (`intent`). Read all of it that bears on the
   goal. These are the person's own words about what they want; quote them
   rather than paraphrase, and let a newer entry win over an older one.
2. **What they did or have** (`record`). Read for progress and for facts to
   fill the goal's collections.
3. **Mentions** (`incidental`). Leads only, never evidence of what they want.

### How to search

Every read is scoped to the person: `user_id = '<user>'` unless the catalogue
names another way. Search the columns it lists with the goal's words and
their near neighbours ("job", "career", "role", "work", the field's name):

```sql
select id, left(body, 400) as body, created_at
from job_search.thoughts
where user_id = '<user>'
order by created_at desc;

select id, title from job_search.roles
where user_id = '<user>'
  and (title ilike '%planner%' or jd_text ilike '%urban%');
```

The vault is the largest source, so search it two ways:

```sql
-- by meaning: read the theme list whole and pick the themes that bear on the goal
select id, name, about from obsidian.themes where user_id = '<user>' order by name;

-- then the notes under them, by name only: a theme can hold hundreds
select n.path, n.title, n.updated_at
from obsidian.theme_notes tn
join obsidian.notes n on n.id = tn.note_id and n.deleted_at is null
where tn.theme_id = any('{<theme ids>}'::uuid[]) and tn.user_id = '<user>'
order by n.updated_at desc;

-- by words: full text over every note
select path, title, ts_headline('english', body, q) as hit
from obsidian.notes, websearch_to_tsquery('english', 'job OR career OR "looking for"') q
where user_id = '<user>' and deleted_at is null and search_tsv @@ q
order by ts_rank(search_tsv, q) desc limit 20;
```

Searching is cheap; reading is what costs. The vault is about 1,300 notes
and well over a million words, far more than a run can read, so narrow
first and read last:

1. Search by name and by full text, which return paths, titles and a
   highlighted line, not bodies.
2. From those, choose the notes that plainly bear on the goal: usually five
   to fifteen, never more than about twenty-five in a run.
3. Read only those in full, and rely on nothing you have not read in full.

A run with kept context on the goal starts from those rows and reads their
notes again, and searches only for what has changed since
(`updated_at > <the last run on the goal>`). Report progress on the run row
while you search ("Reading the vault for job notes").

### Search by meaning from a row you found

A word search misses whatever the person wrote in other words: a note on
gentrification never says "zoning", yet it holds their view on the fights a
rezoning starts. So once the word and theme searches have turned up a row
that plainly bears on the goal, ask for the passages nearest to it. Every
note, thought, goal step, file, Learn card and purchase the person has is cut
into passages in `core.memory_chunks`, each with a vector, and
`core.search_memory_from` scores every other passage by how close it comes
to any passage of the row you give it:

```sql
select source_table, source_ref, max(similarity) as best,
       (array_agg(left(body, 300) order by similarity desc))[1] as passage
from core.search_memory_from(
  '<user>',                -- the owner, always
  'obsidian.notes',        -- the row you found: its table, schema and all
  'Bulk/Strong Towns Housing Course.md',  -- and its ref (below)
  null,                    -- or '{obsidian.notes,job_search.thoughts}' to narrow
  50,                      -- passages back, at most 50
  0.53                     -- the floor
)
group by source_table, source_ref
order by best desc;
```

- **The ref** is how the catalogue links the row: a vault note's `path`,
  `job_search.profiles` by the owner's id, every other table by its `id` as
  text.
- **Group by row.** A long note can return several passages; the row is what
  you read and cite.
- **The floor is 0.53.** Passages above it have been on topic in every test
  on the person's data; below it they drift. Treat anything from 0.53 to
  about 0.6 as a lead to check, not a find.
- **Your own writing or Dash's.** `author` on each passage is `me` or
  `dash`. Pass `'{me}'` as the seventh argument when you want only what the
  person wrote, which is the only kind that can say what they want.
- **It needs a row to start from.** A row with no passages yet (written in
  the last few minutes) returns nothing, and no topic can be searched without
  a row. Start from the one or two best rows the word search found, not from
  every hit.

Rows found this way are read and judged the same as any other: read the
note in full before relying on it, and keep it only if it changes the map.
When you keep one, say in its `why` that the meaning search found it ("Found
by meaning from Strong Towns Housing Course: says the real problem is
displacement."), so the person can see what the word search would have
missed.

### What is already on the goal

```sql
select source, ref, title, status from goals.context
where item_id = '<goal id>' and user_id = '<user>';
```

**Kept** rows are where to start: read them again first, since they may have
changed. **Dismissed** rows were turned down: never propose the same
`source` and `ref` again. **Proposed** rows wait on the person; leave them.

### Writing what you found

Write a `goals.context` row for each thing that changes the map, the
done-when or the questions, and only those: a handful, rarely more than
eight. A note that only mentions the subject is not context.

- `source` is the table as the catalogue names it, `ref` the row by the
  column the catalogue says to link it by (a vault note's `path`).
- `title` is the row's name as the catalogue says to take it.
- `why` is one sentence on how it bears on this goal: "Says you want a
  planning role with fieldwork, not a desk job."
- `excerpt` is the words that matter, quoted exactly, a few sentences at
  most. Never copy a whole note.
- `status` is `proposed` on a goal that is not approved; on an approved one
  you may write it `kept`.

```sql
set local goals.actor = 'claude';
set local goals.run_id = '<the run id>';
insert into goals.context (user_id, item_id, source, ref, title, why, excerpt, status, run_id)
values ('<user>', '<goal id>', 'obsidian.notes', 'Career/What I want next.md',
        'What I want next',
        'Lists what you want from the next role: fieldwork, a public-sector employer, under an hour''s commute.',
        'I want to be out in neighbourhoods at least two days a week. Public sector over consulting.',
        'proposed', '<the run id>')
on conflict (item_id, source, ref) do nothing;
```

The database refuses a dismissed row from you, a change to one the person
dismissed, and keeping a proposal on a goal that is not approved.

### Using it

What you found should show in the map, or it was not worth writing:

- **Steps and done-whens follow it.** A step that says "Shortlist roles with
  fieldwork and a public-sector employer" rather than "Shortlist roles".
- **Do not ask what is already written.** If a thought or a note answers a
  question you would have asked, build on the answer and cite it in the
  step's `detail` instead. Ask only when sources disagree or are silent.
- **Facts fill collections as drafts**, the way Gmail does: `source = 'app'`
  and `source_ref` the row as `schema.table:ref`
  (`job_search.thoughts:<id>`). The page links the draft back to it.
- **Progress is read, not copied.** Where a goal is measured by something a
  module counts (applications, readings), link it with `goals.links` where
  the kind exists, and say how it is counted rather than logging a number.

### Something the catalogue does not list

If a table outside the catalogue plainly holds something about the goal
(read table and column comments with `obj_description` and
`col_description` to find out what a table is for), you may use it, and the
run summary must name it: "Found your career notes in
`job_search.profiles.summary`, which is not in the catalogue." That line is
how the catalogue gets fixed.

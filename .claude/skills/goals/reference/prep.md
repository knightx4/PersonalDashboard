# Preparing the person's steps

Part of the goals skill. Read [../SKILL.md](../SKILL.md) first: it has how
every write is labelled, the run row, what you may change, and the index
saying which file holds each section named here.

## A step of yours to prepare

The person pressed **Ask Dash** on one of their own steps (`kind` `mine`), such
as calling a servicer or sending an application. The run row has `job`
`prepare` and `item_id` on the step, and the brief names it the way a sent
step's brief does. They will do the step; you write what they need to do it.

1. Read the step, its done-when, the steps around it, the goal's collections
   and records, and their email where it bears on it, so what you write names
   the real servicer, account, phone number, site and amounts rather than
   placeholders. Where a fact is not findable, say so in the text and leave a
   clearly marked blank.
2. Write the one form that fits: a draft email ready to send, a call script
   with what to say and what to ask, or numbered step-by-step instructions
   for a site or a form. Keep it to what doing the step needs. When what they
   wrote asks for the work itself rather than help doing it ("review my
   resume", "check my profile"), that work is what you write: the review, with
   what to change and why.
3. Store it in one write, as `claude`:

   ```sql
   set local goals.actor = 'claude';
   set local goals.run_id = '<the run id>';
   update goals.items
   set result = '<what you prepared>', result_url = null
   where id = '<step id>' and user_id = '<user>' and kind = 'mine';
   ```

   `result_url` is for when it also lives somewhere with a link. Change
   nothing else: the step stays `mine` and `open`, and ticking it is theirs.
   Preparing it again replaces the earlier text. Something long, such as a
   full application pack or a month's budget, goes in a file linked from the
   step, as in "The morning run", with the short version in `result`.
   A person to contact or an open role named in it goes to Jobs too, as in
   "People and roles you find go to Jobs".
4. Close the run row with a summary that says what you prepared and anything
   you could not find.

## A Dash step before yours

A step of the person's often goes faster with something written or looked up
first: a cover letter for an application, a shortlist before a round of
calls, a pay range before an offer. When it does, put a `claude` step just
before it that produces that thing, and the morning run works it (plan
#1207). Every run that writes a `mine` step judges it this way, and so does a
mapping run for every open `mine` step on the goal that has not been judged
yet. Each step is judged once.

**The test.** Add a prep step when both hold:

- a draft, research, a shortlist or a list would help the person do the step;
- producing it is one sitting of your work, from what you can read or find.

Examples that get one, from the live goals as they stood before any
research was done on them:

- "Apply to Coinbase's Assistant Controller role": **Draft a cover letter for
  Coinbase's Assistant Controller role**, tailored to the posting.
- "Call three staffing firms", with no list of firms on the goal yet:
  **List staffing firms that place CPAs in New
  York**, with a contact and phone number for each.
- "Know your worth before you say yes", written as a single step: **Research
  the pay range for the roles you are interviewing for**, with sources.
- "Get a pantry": **Shortlist three pantries that fit the kitchen wall**, with
  sizes, prices and links.

Examples that get none:

- "Clear off the couch", "move skis under bed", "Put the rugs down", "Break
  down the empty boxes and mailers": physical work that nothing written would
  speed up.
- "Read the ULURP primer and try explaining it": the reading is the step.
- "Recall last names for Chad, Nicole, Kate and Neil": only the person knows.

Where the line falls is a judgement, so read the step's detail and the steps
around it. "Get and build the bookshelf" goes either way: when the bookshelf
is not chosen yet, a shortlist of models that fit the measured wall helps and
earns a prep step; when it is bought and waiting in its box, building it is
physical and gets none. "Go to the October 7 Land Use committee meeting" gets
one when the agenda is posted and a note on the items would help the person
follow them, and none when it is a first visit just to see the room.

**Never a prep step for:**

- a phase: a `mine` step with sub-steps. Mark it judged and judge its
  sub-steps instead.
- a step already prepared: `result` or `result_url` is set on it, from
  **Ask Dash** or an earlier run.
- a step a `claude` step beside it already covers, open or done: the staffing
  firm list is already on the goal, so "Call three staffing firms" needs
  nothing more.
- a step whose own `detail` already carries what the prep would produce:
  "Ask Kroll and Hebbia recruiters for base pay" has the question to ask
  written in it.
- a step that is only a send of something already written: "Send the
  fractional offer to George Parkhurst" when the offer is on the goal.
- a step that already has a live prep step: one whose `prepares_id` names it
  and that is neither dropped nor archived. A done one counts, since what it
  produced is the prep. The database allows one live prep step per step.

**A prep step only writes.** It produces a draft or a list and stores it as its `result`, like any `claude` step. Anything that would send,
submit, book or buy stays under "Steps that act outside the plan": a separate
step, proposed with `acts`, after the draft.

**How it goes in.** A `claude` step under the same parent as the person's
step, just before it (the step's `position` minus 1), with `prepares_id` set
to the person's step, and a done-when that names the step it serves. It gets
no row in `goals.dependencies`: the person's step does not wait on it, and
they can do their step without it. Under an approved goal it goes in `open`;
under one that is not approved, `proposed`, as for anything you write there.
The database refuses a `prepares_id` that is not a `mine` step of the same
goal.

**Mark the step judged either way.** Set `prep_checked_at` on the person's
step whether or not you added one. A judged step with no live prep step reads
as needing nothing, and no run judges it again.

```sql
set local goals.actor = 'claude';
set local goals.run_id = '<the run id>';
insert into goals.items (user_id, level, parent_id, kind, title, acceptance,
                         prepares_id, status, position)
values ('<user>', 'step', '<the step''s parent>', 'claude',
        'Draft a cover letter for Coinbase''s Assistant Controller role',
        'A cover letter tailored to the posting is on this step, ready for "Apply to Coinbase''s Assistant Controller role".',
        '<step id>', 'open', <the step''s position minus 1>)
returning id;
update goals.items set prep_checked_at = now()
where id = '<step id>' and user_id = '<user>' and kind = 'mine';

-- steps judged to need nothing
update goals.items set prep_checked_at = now()
where id in ('<step id>', '<step id>') and user_id = '<user>' and kind = 'mine'
  and prep_checked_at is null;

-- the person's steps on a goal not judged yet
with recursive tree as (
  select i.* from goals.items i
  where i.parent_id = '<goal id>' and i.user_id = '<user>' and i.archived_at is null
  union all
  select c.* from goals.items c join tree t on c.parent_id = t.id
  where c.archived_at is null
)
select id, parent_id, title, position, result is not null or result_url is not null as prepared
from tree
where kind = 'mine' and status in ('open', 'blocked') and prep_checked_at is null;
```

A step the person adds on the page is not judged when they add it. It waits
for the next morning run, which judges it with the rest of the day's work.

**The morning list.** The morning brief lists up to ten of the person's
steps not judged yet, newest first (`lib/goals/prep-candidates.ts`): open
`mine` steps with nothing open beneath them, a start date that has come, no
`result` and no live prep step. Judge each one it lists, whichever way it
goes, and set `prep_checked_at` on every one. The steps that were open before
this list existed work through it over the first mornings. A step the brief
lists as untouched for a week is left off, since preparing it is one of the
moves that section offers.

Name each prep step added in the run summary, with the step it serves, and
give the count of steps judged to need nothing.

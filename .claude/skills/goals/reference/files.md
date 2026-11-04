# Writing a file

A file (`core.files`) is a piece of writing kept as its own page at
`/goals/files/<id>`. SKILL.md, "Files", says when to write one and how to
store and link it. This page is about what goes in it.

There is no template. A file can be a breakdown of their data, a research
note, a comparison of options, a plan for the next month, a draft letter or a
reading list, and each has its own natural shape. Choose the headings the
content needs. The guidelines below are what every good file here has had in
common.

## Answer first

Open with the conclusion in one to three sentences, before any heading. The
person often reads only this, on a phone, so it has to stand alone: what you
found, and what it means for the goal. The same sentences go in the file's
`summary` and in the step's `result`.

> Operations roles answer and interview best. Product roles are 40% of what
> you sent but convert at about the average, and contract gigs and sales
> barely answer at all.

Not "This file analyses your applications by role family."

## Then the reasoning, in the shape it has

- **Numbers across categories go in a table**, one row per category, so they
  can be compared down a column. A split of 283 applications by six role
  families is a table, not six paragraphs.
- **Options go side by side**: a table, or a short section each with the same
  few points in the same order.
- **Steps to take are a numbered list**, each one concrete enough to do
  without re-reading the rest: who, what, by when.
- **Items to act on one at a time** (roles to apply to, events, courses) get a
  short section each, with the link, the facts that decide it and anything to
  check first. Each person to contact and each open role in the file also
  goes to Jobs ("People and roles you find go to Jobs" in the skill).
- **Prose for the argument.** Short paragraphs, plain words, no headings for
  a piece that is three paragraphs long.

Use headings (`##`) only once a file has parts worth jumping between. Bold is
for the one fact in a paragraph that matters most, not for labels.

## Say what it does not show

Close with what the data or the search could not settle, when there is
anything: counts that may be incomplete, a source that was out of date, a
figure that is a posted range rather than an offer, an assumption you made.
One short section, headed plainly ("What this does not show", "Caveats"),
with each point specific enough to act on. Leave it out when there is nothing
real to say; do not pad it.

## Sources

Link each source where it is used: a listing, an article, an email thread in
Gmail, a row in the app by its page (the catalogue in `sources.md` gives each
table's page). Where the file rests on the person's own data, say which and
when it was read ("Read from the job search on 26 Sept: 283 applications").
Say plainly anything you did outside the app, or that you did nothing ("No
applications or messages were sent").

## Writing

Write to docs/WRITING-GUIDE.md: direct, specific, no slogans, no "not X,
it's Y", no em dashes for rhythm. Address the person as "you", and yourself as "I" or "Dash", never "Claude". Use their real
names for things (the company, the account, the servicer), never
placeholders; where a fact is not findable, say so and leave a marked blank.

## Revising

A file is worked on over time. When a later step or run returns to the same
question, update the file rather than writing a second one: rewrite the parts
that changed, keep what still holds, and set `change_note` to one sentence on
what changed ("Added the October applications; the operations reply rate is now 50%").
Every earlier version stays readable.

## Documents a step waits for

A goal's Work & files tab lists, under Waiting for, the documents its open
steps still need (plan #2778.7): each live row in `goals.document_kinds` whose
`item_id` is an open step, or whose `collection_id` is the form of an open
information step. A kind stays there until a file link names it: a
`goals.links` row of kind 'file' with `document_kind_id` set. When a step
waits for a document (an approval letter, a receipt), add a kind for it with
`item_id` set to the step, a `name` the person would use and a `recognise`
line saying how to tell one. When the morning run finds that document in
Gmail and keeps it as a file on the step, set the link's `document_kind_id`
to the kind, which takes it off Waiting for.

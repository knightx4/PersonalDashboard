# Laying out a goal's dashboard

Part of the goals skill. Read [../SKILL.md](../SKILL.md) first: it has how
every write is labelled, the run row, and what you may change.

Every goal page opens on its Dashboard tab: a row of small tiles, then wide
ones, each reading something the goal already holds (plan #2778). You pick
the tiles. A goal gets its layout when you map it, the morning run lays out
any open goal its brief lists as having none, and a run whose brief asks for
the dashboard ("Lay out this goal's dashboard") lays out that one goal.

## The rule

Start from the template for the goal's kind below, keep the tiles the goal
can fill today, and save the layout through the script. Never write
`goals.items.dashboard` in SQL: the script runs the same check as the page,
which refuses a tile whose list, field, metric or step is not on the goal,
and it records the change on the Goals home with an Undo. It records the
change itself, so do not call `core.record_dash_action` for it.

```sh
npm run goals:dashboard -- show <goal id>            # its lists and fields, metrics, steps, and the layout now
npm run goals:dashboard -- check <goal id> <file>    # check a layout without saving it
npm run goals:dashboard -- save <goal id> <file> --run <the run id>
```

`<file>` is a JSON list of tiles, written to your scratchpad or `/tmp`.
Name a list, metric or step by its name or its id, and a field by its label
or its key; the script turns names into ids. A refusal names the tile at
fault and says what the goal has instead. Fix the tile and save again.

Lay out a goal only when it has no layout (`show` prints `"layout": null`).
A layout the person has arranged is theirs: change it only when they ask,
and then save the whole layout with their tiles kept in their order.

## The tiles

| Type | Reads | Shape |
|---|---|---|
| `number` | a metric's latest period, or a list: the sum of a number, money or percent field, or without a field the count of rows | `{metric}` or `{list, field?}` |
| `countdown` | days to a step's due date, or to the soonest future date in a list's date field | `{step}` or `{list, field}` |
| `chart` | a metric's periods, or the readings of a tracked number field | `{style: "line" or "bar", metric}` or `{style, list, field}` |
| `table` | a list's rows, with the fields named or all of them | `{list, fields?}` |
| `rooms` (Parts) | a card per step directly under `parent`, or under the goal, each with a ring of its sub-steps done and its next step | `{parent?}` |
| `slots` | a row of `count` slots filling from a list's rows, or from the rows whose yes/no field is yes | `{list, count, field?}` |
| `tracker` | checkpoints in order: the steps named, or the steps under `parent` | `{steps: [...]}` or `{parent}`, at most 30 |
| `grid` | a list's rows by the fields named, yes/no fields drawn as checkboxes | `{list, fields: [...]}` |

Every tile may carry a short `title`. Without one the page names it from what
it reads, which is usually enough; give one when two tiles read the same
list. A goal holds at most 24 tiles; two to six is the useful range.

## Templates by kind of goal

Nothing on a goal says which kind it is. Read the done-when and the map and
pick the nearest. Where the template names a list or metric the goal does not
have, drop that tile rather than making a list for it: lists come from
mapping ("Lists the goal needs" in `mapping.md`). A goal with no lists still
has steps, so every goal can have the step tiles.

**Pay down a number** (loans, a credit card, a savings target). A number of
the balance (`number` over the money field of the list that holds the
balances), a line `chart` of that field when it is tracked, a `table` of the
list, and a `countdown` to the next dated step. With no such list, a
`tracker` of the stages and a `countdown`.

```json
[
  {"type": "number", "title": "Owed", "list": "Loans", "field": "Balance"},
  {"type": "countdown", "step": "Apply for income-driven repayment"},
  {"type": "chart", "style": "line", "list": "Loans", "field": "Balance"},
  {"type": "table", "list": "Loans", "fields": ["Name", "Balance", "Rate"]}
]
```

When the stages are top-level steps among others, name them in order with
`steps`, since `parent` would also pick up the steps that are not stages.

**A pipeline** (a job search, outreach to people). A `number` counting the
list's rows, a `countdown` to the soonest date in its deadline or follow-up
field, and a `table` of the list with its stage field shown. Add `rooms` when
the stages are steps.

**Fill N slots** (know ten people by name, put five things out). A `slots`
tile with `count` set to the N in the done-when, over the list that holds
them, with `field` set to its yes/no field when only some rows count. Then a
`table` of the list.

```json
[
  {"type": "slots", "title": "People I know by name", "list": "People", "count": 10, "field": "Know by name"},
  {"type": "table", "list": "People"}
]
```

**A set of applications** (programs, grants, schools). A `countdown` to the
soonest deadline in the list's date field, a `grid` of the list with its
yes/no fields as the columns (the documents each one needs), and a `number`
of the rows. A grid needs at least one field; with no yes/no fields yet, use
a `table` and leave the grid for when the fields are added.

**A space to sort out** (an apartment, a garage). `rooms` with no parent,
when each room or area is a step directly under the goal; otherwise `rooms`
with `parent` set to the step the rooms sit under. Add a `countdown` when a
step has a date.

```json
[{"type": "rooms", "title": "Rooms"}]
```

**Make a thing** (a song, an essay, a portfolio piece). A `tracker` of the
stages in order (write, record, mix, release), and a `countdown` to the
release or due date.

**A habit or a regular thing** (go to the community board, volunteer every
week). A bar `chart` of the goal's metric and a `number` of it, when it has
one; otherwise `rooms` of its stages and a `countdown` to the next dated step.

## Afterwards

The script's sentence goes on the Goals home under what Dash did today, with
an Undo that puts back the layout as it was. Say in the run's summary which
goals you laid out and which you left, with why (no steps yet, already laid
out by the person).

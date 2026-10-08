# Waiting, blocked, later and watched steps

Part of the goals skill. Read [../SKILL.md](../SKILL.md) first: it has how
every write is labelled, the run row, what you may change, and the index
saying which file holds each section named here.

## Blocked and waiting steps

A step that cannot start until another step closes **waits on it**: a row in
`goals.dependencies`, not a status. It reads as Waiting on the goal page, stays
out of the morning run and the home's next steps, and becomes ready by itself
when the other step is done or dropped. Use it for order that matters: pay the
card only once the statement is in. Both ends are steps of the same account;
the database refuses a goal at either end, and a loop ("That would make the
two steps wait on each other").

```sql
set local goals.actor = 'claude';
insert into goals.dependencies (user_id, item_id, depends_on_id)
values ('<user>', '<the step that waits>', '<the step it waits on>');

-- taking it off again
delete from goals.dependencies where id = '<dependency id>' and user_id = '<user>';
```

A step that needs something only the person can give (an account number, a
login, a decision that is not worth a question step) is **blocked on them**:
`status = 'blocked'` with `block_ask`, one sentence saying what it needs. That
sentence is the step's Needs line on the page. `block_kind` is `outside`
unless you leave it out, which means the same. Blocking again rewrites the
sentence. Only a step can be blocked, never a goal.

```sql
set local goals.actor = 'claude';
update goals.items
set status = 'blocked', block_ask = 'The account number for the Chase card.'
where id = '<step id>' and user_id = '<user>' and level = 'step'
  and status in ('open', 'blocked');
```

Unblocking is setting it back to `open`; the database clears `block_ask` and
`block_kind` itself. Unblock a step once what it asked for has arrived, in a
comment, a record or an answer. `block_kind = 'steps'` is for a block that
waits on the steps it depends on and clears itself once they all close; a
plain dependency row is almost always the better way to say that.

## Steps for later

A step that makes no sense until a date is a **step for later**: `starts_on`
on the step, the first day it can be done. Turning on autopay for a loan whose
first payment is in December is a November job; renewing a lease is a job for
two months before it ends. Until that day the step and everything beneath it
stay off the home's next steps, out of the morning and night runs, off Todo
(a step on Todo shows on its start day), and a rhythm under it counts no
periods. The goal page shows it as "Starts 1 Nov". From that day it is an
ordinary open step.

Set it when you map a goal and the date is known, from a due date, a
statement or what the person said; leave it null when the step can start at
once. Only steps take one, and a step with a `due_on` must start on or before
it. It is not a dependency: use `goals.dependencies` when a step waits on
another step, and `starts_on` when it waits on the calendar.

```sql
set local goals.actor = 'claude';
update goals.items set starts_on = '2026-11-01'
where id = '<step id>' and user_id = '<user>' and level = 'step';
```

## Watching a price outside the app

A step that waits on a price on a page outside the app gets a **watch**: buy
the tickets once the resale price drops under $200, order the part when it
comes back under its old price. A watch is a row in `core.watches`. Each hour
the app reads the lowest price on its page, pushes to the person's phone when
the price goes under the line, sends a report at the times set on it either
way, shows on the home page while it runs, and ends itself at `ends_at`.
Start one when you map or work such a step, or when a comment asks for it
("tell me if these drop under $200"), instead of leaving the step to be
checked by hand.

- `url`: the https page to read, from the step, its thread or the person.
  With no link, block the step asking for it; never guess one.
- `condition`: `{"below": 200, "currency": "USD"}` pushes under 200 dollars.
  `{}` only reports, so give it report times.
- `report_times`: up to six times of day, `HH:MM` in the person's timezone
  (`core.account_settings.timezone`). Empty for none; then `below` is needed.
- `ends_at`: when the price stops mattering, such as the event or the step's
  `due_on`, at most 180 days away. A timestamp with its zone.
- `goal_item_id`: the step it serves, so the home row links to it.

A watch only reads a price. A step that waits on a date alone is a step for
later (`starts_on`, above), not a watch.

```sql
-- one running watch per page: look before starting another
select id, title, status from core.watches
where user_id = '<user>' and url = '<the page>' and status = 'running';

insert into core.watches (user_id, title, url, condition, report_times, ends_at, goal_item_id)
values ('<user>', 'Jamie xx at Nowadays, 2 tickets', 'https://…',
        '{"below": 200, "currency": "USD"}', '{09:00,18:00}',
        '2026-10-18 23:59:00-04', '<step id>')
returning id;

-- does anything reach their phone?
select exists (select 1 from core.push_subscriptions where user_id = '<user>') as push_on;
```

Say on the step, in its `result` or the thread reply, what the watch will do
and when it ends, and that it shows on the home page. When `push_on` is false,
say that nothing will reach their phone until they switch push on in Account,
under Notifications, on the phone. The watch still runs and shows on the home
page. A watch is stopped from its home row, by the person; never stop or
delete one yourself.

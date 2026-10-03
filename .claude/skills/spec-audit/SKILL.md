---
name: spec-audit
description: Compare the code with every spec in lib/specs/registry.ts and record what the audit found in spec_findings, one subagent per spec. Each spec gets findings saying what holds, what has drifted, what is described but not built, and what code no spec covers; every workspace with no spec gets one undescribed finding. Findings that call for a change draft a spec change in spec_changes, within the 60-line limit, and no new change is drafted while five are waiting on the person. Use when the weekly tick fires it, or when the user says "audit the specs", "run the spec audit", or asks whether the code still matches its specs.
---

# Auditing the specs

The specs in `docs/` are what the person approves. This audit checks whether
the code still does what they say, once a week, and drafts the change that
would bring the two back together. It is Part 2 of
`docs/SPEC-LAYER-SPEC.md`; read that part before a first run.

The output is rows, not code:

- `spec_findings`: one row per thing the audit found, every row of a run
  stamped with that run's `audit_id`. A spec's page in Dev shows the latest
  audit's findings (plan #1525).
- `spec_changes`: a drafted change to a spec's markdown, which the person
  approves or declines on `/dev/specs`. Approving it starts the run that
  writes it into `docs/` and shapes the work
  (`.claude/skills/plan/reference/shaping.md`, "From an approved spec
  change").

The tables and their checks are in `supabase/migrations/0155_spec_changes.sql`
and `0162_spec_findings_audit_id.sql`. The types and the line count are in
`lib/specs/changes.ts`.

The audit never commits, never edits `docs/`, never writes `plan_items`,
never approves or declines a change, and never touches a vision.

## How it is fired

By hand for now: a session told to audit the specs. The Monday schedule is
plan #1524, which fires the routine whose prompt is
`reference/routine-prompt.md`.

## Working without the CLI

There is no script. Use the **`Supabase`** connector (`mcp__Supabase__*`,
loaded through ToolSearch), project ref `asjztutnqxbecruvyrbj`, and filter
every query by the account's `user_id`. Keep each write short and plain, as
`.claude/skills/plan/reference/offline.md` says: the connector holds some
statements for a confirmation, and in a routine nobody is there to give it.

Before starting:

1. `git fetch origin && git checkout origin/main` (detached is fine). The
   audit reads main, not a branch somebody left half-built.
2. Generate one `audit_id` for the run (`select gen_random_uuid()`) and use it
   on every finding. Take `session_id` from `CLAUDE_CODE_REMOTE_SESSION_ID`
   (the `cse_…` value), or leave it null.

## What the run covers

**Every spec in `SPECS`** (`lib/specs/registry.ts`). Each gets at least one
finding from the run, even a spec that describes no code (the writing guide,
the posts guide, the build order): those are read against what they govern,
and a spec with nothing wrong gets one `holds` row saying what was checked.

**Every workspace with no spec.** Compare `MODULE_IDS` (`lib/modules.ts`) with
the `module` of each entry in `SPECS`. A workspace that no entry names gets
exactly one `undescribed` finding, under the slug its spec would have (the
workspace id), with `section` null. Not one finding per file. If `docs/`
already holds a spec for it that the registry does not list, say so in the
finding: the fix is then a line in the registry, not a new spec.

## Before the subagents start

Read what is already waiting, so nothing is drafted twice:

```sql
-- changes still open: proposed ones wait on the person, approved ones are
-- being written in
select id, spec, title, status, created_at from spec_changes
where user_id = '…' and status in ('proposed', 'approved')
order by created_at;

-- the previous audit's findings that proposed a change but got none, which
-- this run may draft now that there is room
select spec, section, kind, finding, proposal from spec_findings
where user_id = '…' and audit_id = (
  select audit_id from spec_findings
  where user_id = '…' and audit_id is not null
  order by created_at desc limit 1)
  and proposal <> 'none' and spec_change_id is null;

-- rules the notes routine proposed since the last audit (plan #1526). A
-- spec page shows these only until the next audit starts, so re-record each
-- one that still stands under this run's audit_id, with the same
-- spec_change_id, or it drops off the page
select spec, section, finding, evidence, proposal, spec_change_id from spec_findings
where user_id = '…' and audit_id is null and kind = 'missing_rule'
  and created_at >= coalesce((
    select min(created_at) from spec_findings
    where user_id = '…' and audit_id = (
      select audit_id from spec_findings
      where user_id = '…' and audit_id is not null
      order by created_at desc limit 1)), '-infinity');

-- changes the person declined, so the run does not propose them again
select spec, title, why from spec_changes
where user_id = '…' and status = 'declined';
```

A notes rule still stands while its change is proposed or approved, or when
it was drafted with no change because five were waiting. Re-record it as a
`missing_rule` finding of this run. One whose change was applied is now a rule
in the spec and is checked like the others; one whose change was declined is
left out.

## One subagent per spec

Send each spec to its own subagent, so no run has to hold every spec and the
whole codebase at once. Run them a few at a time. The subagent reads and
reports; only the main session writes rows. A subagent that writes is one
whose rows nobody has checked.

Give each subagent this brief, filled in:

```
Audit the spec docs/<file> ("<title>", slug <slug>, workspace <module or
"the app as a whole">) against the code on this checkout. Do not write any
file, row or commit; report only.

1. Read the spec. Note each claim about what the app does: a page, a table,
   a column, a rule, a limit, a routine, a behaviour. Skip the parts that
   argue or explain.
2. If it has a "## Rules" section, read each rule and its "Checked by:" line.
   A count's value is in scripts/spec-baseline.json and its counter in
   scripts/spec-counts.ts. A "pending #N" rule is not built yet by design.
3. For each claim, find the code it is about (grep for the paths, tables,
   routes and names it uses; read around the hits, not whole files) and
   decide which it is:
   - holds: the code does what the spec says.
   - drifted: the code does something else.
   - missing: the spec describes it and nothing builds it.
   - undescribed: code in this spec's area that does something the spec
     never mentions and the person would want to know about (a whole page,
     table or routine, not a helper).
4. A spec with a "Status" block naming plan steps describes work that may be
   planned rather than built. Before calling something missing, check the
   plan: `select number, title, status from plan_items where user_id = '…'
   and number in (…)` or search titles. Missing and planned is still
   missing, with the step in the evidence.

Report as a list, one entry per finding, each with: section (the heading it
is about, or null for the whole spec; "R3" style for a rule), kind,
finding (one or two plain sentences), evidence (file paths with line
numbers, counts, step numbers), and what you would propose: change_code
(the spec is right and the code should follow it), change_spec (the code
moved on for a reason and the spec should say so), or none. Give at most
twelve entries: group small things of the same kind under one entry. Say
what you checked and found holding in one "holds" entry with section null,
listing the sections it covers.
```

Check what comes back before writing it. A finding whose evidence does not
name a file, a count, a step or a row is not a finding yet: open the file and
look, or leave it out.

## Choosing the proposal

The spec is the person's word, so the default when the two disagree is that
the code is wrong. The exceptions say the code moved on for a reason:

- **change_code** when the spec states what the person approved and nothing
  since overturns it.
- **change_spec** when something the person decided after the spec was
  written explains the code: a decision answered on the plan, a step they
  approved that changed it, a note they filed asking for it. Cite it in the
  evidence. Also `change_spec` for an `undescribed` finding, since the fix is
  a spec that describes the code.
- **none** for `holds`, and for `missing` work that an open plan step
  already covers.

A `missing` finding that nothing on the plan covers is `change_code`: the
person said they wanted it, and nobody is building it.

## Drafting spec changes

Both `change_code` and `change_spec` findings draft a change, because a code
change has to be stated against the spec before it can be built. For
`change_spec` the diff rewrites the spec to say what the code does. For
`change_code` the diff adds the rule that holds the code to the spec: a
`**Rn.**` sentence in `## Rules` with its `Checked by:` line (a count or test
with `pending #N` is not available to the audit, since it writes no plan
steps, so use `audit` when no existing check fits). If the spec already has
a rule that covers it, the rule is failing and nothing new needs saying:
record the finding with no change and name it in the report. The same goes
for a `missing` finding: the spec already states what to build, so the next
move is shaping it on the plan, not a new line in the spec. Name it in the
report as work for the plan.

**At most five waiting.** Before every draft, count the proposed changes. When
five are waiting, draft nothing more: record the finding with its proposal and
`spec_change_id` null, and the next run picks it up. Draft in this order
until the room runs out:

1. `drifted` findings against a rule in `## Rules`.
2. Other `drifted` findings, `change_code` before `change_spec`.
3. `undescribed` workspaces, the most-used first (`core.workspace_opens`
   since 30 days ago).

One change per finding, and never two open changes about the same section of
the same spec: if an open change already covers the section, link the new
finding to it instead of drafting. Do not redraft a change the person
declined unless the evidence is new, and then say what is new in the why.

**Writing the diff.** Copy the spec into the scratchpad, edit the copy, and
diff it:

```bash
cp docs/<FILE>.md "$SCRATCH/<FILE>.md"
# edit "$SCRATCH/<FILE>.md"
diff -u --label a/docs/<FILE>.md --label b/docs/<FILE>.md \
  docs/<FILE>.md "$SCRATCH/<FILE>.md" > "$SCRATCH/<slug>.diff"
```

A new spec is a diff from nothing: `--label /dev/null` and
`--label b/docs/<NEW>-SPEC.md`, against an empty file. Then check it before
writing it:

```bash
npx tsx -e "import {countChangedLines} from './lib/specs/changes'; import {readFileSync} from 'node:fs'; \
  console.log(countChangedLines(readFileSync('$SCRATCH/<slug>.diff', 'utf8')))"
cp docs/<FILE>.md "$SCRATCH/check.md"
npx tsx scripts/apply-spec-diff.ts "$SCRATCH/check.md" "$SCRATCH/<slug>.diff"
```

The count must be 1 to 60; the database refuses anything else. A change that
needs more is split, or narrowed to the part that matters most. The apply
check is what the approve run will do, so a diff it refuses would be a change
the person cannot accept. A new spec of 60 lines is short: write what the
workspace does and the rules it keeps, and leave the rest to a later change.

**Title** says what will be true afterwards, in about eight words ("Learn
says it keeps four tabs", not "Fix Learn tabs drift"). **Why** is two to five
sentences, citing the findings behind it with their evidence. Both are read by
the person on `/dev/specs`, so write them to `docs/WRITING-GUIDE.md`, and the
assistant is Dash in both.

## Writing the result

Insert a change only while fewer than five are waiting. The count goes in
the insert itself, so a check made earlier in the run cannot go stale:

```sql
insert into spec_changes (user_id, spec, title, why, diff, made_by)
select '…', '<slug>', '<title>', $w$<why>$w$, $d$<diff>$d$, 'claude'
where (select count(*) from spec_changes
       where user_id = '…' and status = 'proposed') < 5
returning id;
```

No row back means five are waiting: stop drafting for the rest of the run.

Then the finding, with the change's id when there is one:

```sql
insert into spec_findings (user_id, audit_id, session_id, spec, section, kind,
                           finding, evidence, proposal, spec_change_id)
values ('…', '<audit_id>', '<cse_… or null>', '<slug>', '<section or null>',
        '<kind>', $f$<finding>$f$, $e$<evidence>$e$, '<proposal>',
        '<change id or null>');
```

Several findings of one spec can go in one multi-row insert. Dollar-quote
the text, since findings quote code.

## Before stopping

```sql
-- every registered spec, and every workspace with no spec, has a row
select spec, count(*) as findings,
       count(*) filter (where kind <> 'holds') as problems,
       count(spec_change_id) as drafted
from spec_findings where user_id = '…' and audit_id = '<audit_id>'
group by spec order by spec;

-- never more than five waiting
select count(*) from spec_changes where user_id = '…' and status = 'proposed';
```

Compare the first list with `SPECS` and with the workspaces that have none.
A slug missing from it is a spec the run did not finish: finish it before
reporting.

Then report:

- The run's `audit_id`.
- Each spec, in one line: how many findings of each kind.
- The changes drafted, by title and spec, and the findings each rests on.
- Findings that proposed a change but got none, and why: five waiting, an
  open change already covers it, or a failing rule that needs no new text.
- Anything the run could not check, and why.

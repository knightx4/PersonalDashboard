---
name: ui-review
description: Review one module's interface against the design laws and record what the pass found in ui_reviews and ui_findings — the rows /dev/ui/review reads. Use when the review button on that page fires a routine, or when the user says "review the vault's UI", "do a UI pass on learn", or asks which modules have not been looked at.
---

# Reviewing one module

One module, one pass, and you stop. The mechanical half of the design laws is
already held by `npm run check:ui` on every push; this is the half a grep
cannot see — whether a surface says what it claims, and whether it shows more
of itself than it needs to.

The output is rows, not a report. A session's report is read once and then
lost; a row in `ui_findings` is on `/dev/ui/review` until somebody confirms it
or turns it down.

**You review. You do not fix.** A pass that also edits is a pass whose findings
nobody can check, and the confirm step exists because a session's taste is the
thing that has gone wrong before — five sweeps ran on evidence that was not
evidence. Fixing is `.claude/agents/ui-sweep.md` (the mechanical work) and
`.claude/agents/ui-polish.md` (the visual work), and each runs after somebody
has confirmed there is something to do.

## What a pass reads

Which files belong to the module is not a judgement call: `scopeForFile()` in
`lib/ui-review/scope.ts` decides, and the gate uses the same mapping.

```
npm run check:ui -- --module <id> --list   # the module's mechanical count
git log --oneline -15 -- app/<id> components/<id>
```

Then read, in this order:

1. `app/dev/ui/laws.ts` — the fifteen laws. Laws 1 to 3 are what a surface
   claims; 9 to 12 are how much of itself it shows. Those are the two halves of
   the reading.
2. Every page and view under the module's own prefixes — `app/<id>/**` and the
   component directories `scope.ts` maps to it.
3. The module's spec in `docs/`, where it has one. A surface that is honest
   about the wrong thing is still wrong.

## What a pass looks at

Reading JSX and forming an opinion is not a review. The evidence is the
picture:

```
UI_PREVIEW=1 npm run build
UI_PREVIEW=1 PORT=3400 npx next start -p 3400 &
npx tsx scripts/shoot.ts                 # every surface, both widths, both themes
npx tsx scripts/shoot.ts <surface-id>    # one, while looking closely
```

Shots land in `.preview-shots/` and are gitignored. **Open them.** Every
surface the module has in `app/preview/surfaces.tsx`, at 390 and at 1280, in
paper and in ink. The 390px shots are where the crowding is, and they are the
ones most likely to be skipped.

Say what you could not see. `/preview` renders content surfaces without the
shell and without a database, so the nav, real data density and an empty state
under real conditions are outside what a pass can judge. A finding about
something you did not look at is a guess with a file path on it.

## What a finding has to carry

A finding that cannot be acted on is noise. Each one names:

- **the file**, repository-relative, and **the line** where there is one. A
  finding about a whole surface leaves the line null.
- **the law** it breaks, as its number on `/dev/ui`. If no law covers it, it is
  taste, and taste goes in the review's note rather than in a finding.
- **the surface** it was seen on, as an id from `app/preview/surfaces.tsx`, so
  the page can put the finding beside the shot.
- **what is wrong and what to do instead**, in the body, in two or three
  sentences. "Feels cluttered" is not a finding. "The three filters are each in
  their own bordered box inside the card — law 11; give them a shared ground
  and drop the frames" is one.

Write them the way the plan's rows are written: plain technical English, no
stock phrases, no claims that a finding matters.

## What a pass must not do

- **No fixes.** Not even a one-line one. See above.
- **Never a `ui-ok:` comment to clear a count.** The valve is for markup that is
  genuinely right; using it to make a number fall turns the gate into a lie.
- **No new laws.** `app/dev/ui/laws.ts` is the standard. A rule you wish existed
  is a raise (`scripts/plan.ts raise`), not a finding.
- **No re-filing what was turned down.** Read the module's dismissed findings
  before you file: a nit somebody dismissed in March is settled, and filing it
  again is how the page stops being read.
- **No pass with no row.** A review that finds nothing still records itself, or
  the module goes on reading as never reviewed.

## Recording the pass

Two tables in `public`, both under RLS, both read by `lib/ui-review/load.ts`.
The `module` column takes a module id or `shared`; `commit_sha` is `git rev-parse
--short HEAD` at the time of the pass.

```sql
insert into ui_reviews (user_id, module, commit_sha, violations, note)
values ('<the account>', '<id>', '<sha>', <the gate's count>, '<what you left alone>')
returning id;

insert into ui_findings (user_id, review_id, file, line, law, surface, body)
values ('<the account>', '<the review>', 'app/<id>/page.tsx', 42, '11',
        '<surface id>', '<what is wrong, and what to do instead>');
```

Findings go in as `open`, which is what puts them on the page for a decision.
Never write `confirmed` or `dismissed` yourself: the whole shape of this is
that a session proposes and the person disposes, and a pass that confirms its
own findings is a pass with no reader.

The review's `note` is what you looked at and deliberately left alone, and what
you could not see. It is the paragraph that stops the next pass repeating this
one.

## Then report

The module, the gate's count, how many surfaces you looked at, and each finding
by file and law. Then stop — do not start another module, and do not fix
anything you found.

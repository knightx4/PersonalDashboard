# Trial: Jev against Haiku on the map trial's notes

Run 2026-09-29 on production, for plan #1168 under feature #1161. Jev
(`jev-1.13.0`, TypeSafe's classifier) and Haiku (`claude-haiku-4-5`, the map
sweep's classify prompt) were each asked to classify the 75 notes of the
[75-note map trial](2026-09-19-map-75-notes.md). One call did all 75. Jev
answered every question it was asked. Haiku failed on one note, returning no
tool call.

**Recommendation: switch the sweep's classifier to Jev at 0.8, with Haiku
below it. It routes the trial's notes as well as Haiku does, and it saves
little.** On the 27 notes the trial says should be read, the rollout sends 23
to be read, the same as Haiku alone. Across all 55 notes it differs from
Haiku on one, a job application in a folder the sweep does not read. Jev was
sure of only 23 of the 55 notes, though, so Haiku still classifies most of
them, and the classify step was never the expensive part of a sweep.

## How it was run

The job is `inngest/vault/jev-trial.ts`, behind `/api/cron/jev-vault-trial`.
It drew the trial's sample again: every live note except `Me/Journal.md`,
`Me/Dreams.md` and `Me/Passwords.md`, ordered by `md5(id || 'trial75')`, first
75. The draw contains the notes the trial write-up names, so it is the same
sample. Nineteen notes were not sent to either model: 13 under 80 characters,
4 journals in `Me/` and 2 carrying something shaped like an API key. That left
56. Haiku gave no answer on one (`Pending/Edra Application`), so 55 notes are
compared below.

For each note, Jev was asked the two questions in
`lib/vault/map/jev-question.ts`. The class question offers knowledge, mixed or
operational, each worded as Haiku's prompt defines it. The second asks whether
the note is evidence of what somebody did or studied. Haiku was asked its own
prompt from `lib/vault/map/classify.ts`. Both saw the title and the first part
of the body, and neither saw the path. Results are in
`obsidian.jev_trial_answers`, trial `map-75-2026-09`.

**The trial stored no verdict per note.** Its readers classified the notes but
kept only totals. The reference here is the 27 notes the write-up says should
be read: the ones its clusters were built from, the four short notes it said
the old floor lost, and the two evidence notes it said carried positions
(`TRIAL_READS` in `lib/vault/map/jev-trial.ts`). There is no reference for
the other 28, so where the models differ there I read the note.

## Against the trial's reference

| | Of 27 notes the trial read |
| --- | ---: |
| Jev would read | 22 |
| Haiku would read | 23 |
| The rollout would read (Jev at 0.8 or more, Haiku otherwise) | 23 |

Both models skip the same four: `Galaxy Interview Prep` (read by both as a
checklist, Jev at 0.91; the trial found two positions in 6,000 of its 147,133 characters),
`Game Design` (a brainstormed list of games), `Tasks/SEWB Application
Assignment` (the first 6,000 characters are the assignment prompt, which is
where the trial said its argument was hidden) and `MGT 430 - The Executive` (a
course record). These are misses of the classify step itself, on notes whose
argument is either past the opening sample or scattered through a list. Neither
model does better on them.

Jev's fifth miss is `garage application`, at 0.23 confidence. The rollout
sends it to Haiku, which reads it as mixed.

The two evidence notes: Haiku flagged both. Jev gave `MGT 430` 0.50 and the
Hamilton case 0.45, so it flagged one. Evidence does not decide whether a note
is read, and in the rollout Jev's flag is used only where Jev is sure of the
class, which neither of these was.

## Agreement between the two

| | Notes | Same class | Same route (read or not) |
| --- | ---: | ---: | ---: |
| All compared | 55 | 40 | 49 |
| Jev at 0.8 or more | 23 | 19 | 22 |
| Jev under 0.8 | 32 | 21 | 27 |

By Haiku's class: of the 31 Haiku called knowledge, Jev agreed on 24; of 13
operational, on 12; of 11 mixed, on 4. Mixed is where Jev is weakest, as the
job-email trial found for its rarer labels. A swap between knowledge and mixed
changes nothing downstream, since both are read.

**The sure disagreements.** Jev was sure and differed from Haiku on four
notes:

| Note | Jev | Haiku | Same route? |
| --- | --- | --- | --- |
| `Pending/Duetti Cover Letter` | mixed, 0.92 | knowledge | yes |
| `Career/Job Applications/Canonical Written Interview` | mixed, 0.88 | knowledge | yes |
| `Pending/Fleet AI Operations Generalist Application` | mixed, 0.86 | knowledge | yes |
| `Career/Job Applications/Incandescent Application` | operational, 0.83 | mixed | no |

The first three are applications arguing the writer is a good fit. The prompt
names "application prose that argues a thesis" as mixed, so Jev's class is the
better reading of the prompt, and both are read either way.

The fourth is the one route disagreement where Jev is sure. I read it: a
posting summary (role, firm, pay) followed by a cover letter about the
writer's experience. Haiku's mixed follows the prompt's wording. Jev's
operational is also defensible, since the letter argues for a hire rather than
about anything the map holds. It sits in `Career/Job Applications/`, which the
sweep leaves out, so in practice the sweep never asks about it.

**The unsure route disagreements.** Five more notes differ on route with Jev
under 0.8: `Card Based Rule Changing`, `Ages trading game`, `Music bits` and
`garage application` (Jev operational, Haiku mixed or knowledge), and `Ramp
Application` (Jev mixed, Haiku operational). The rollout takes Haiku's answer
on all five.

## What the rollout changes

The sweep's routing, on this sample, not at all. The rollout reads 41 of the
55 notes and Haiku alone reads 42; the difference is the Incandescent
application, which the sweep excludes by folder.

What the person sees changes a little. The 23 notes Jev is sure of carry no
reason sentence; a note the sweep skips on Jev's word reads "Not read: judged a
record with nothing argued (91% sure)." instead. The 32 it is unsure of keep
Haiku's reason.

The saving is small. Measured on this run, a Haiku classify cost $0.0017 a
note ($0.095 for 56 calls) and a Jev question cost $0.00003 ($0.0032 for 112).
Under the rollout Haiku still runs on 32 of 55 notes, so classifying costs
about 40% less: roughly 70 cents less on a full sweep of the vault's thousand or
so readable notes. The step's detail expected the sweep to fall from about $13
to cents. That does not happen here, because most of a sweep's cost is reading
the notes for themes and positions, which stays on Haiku.

## Decision

`VAULT_CLASS_ON_JEV` is switched on. The rollout meets the bar: it reads as
many of the trial's notes as Haiku does, and its only change of route falls on
a note the sweep excludes. It is worth keeping on for the confidence it adds
to each verdict and a modest saving, and not for speed or cost at the scale
the step hoped for.

## What this does not tell you

- **Whether 0.8 is the right floor for notes.** Only 23 of 55 cleared it. A
  lower floor would send fewer notes to Haiku, but the unsure answers include
  five route disagreements, and this sample is too small to find a floor that
  keeps the good ones.
- **How Jev does on the rest of the vault.** 55 notes, drawn at random, with a
  reference for 27. The earlier sweeps' Haiku answers exist for about half the
  vault and could be compared the same way.
- **Anything about the four notes both models skip.** Those are a limit of
  classifying from the opening of a note, which is a design question for the
  sweep and not a model question.

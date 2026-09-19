# Direction

What this app is for, and the standing commitments a proposed feature is
checked against. The counterpart to
[WRITING-GUIDE.md](WRITING-GUIDE.md): that one is the standard for anything
written here, this one is the standard for anything built here.

It is not a plan and holds no work. `/dev/plan` is the source of truth for what
gets built next, `/dev/ideas` for what has not become a feature yet, and neither
of them says why a thing deserves to exist at all. That is what this is.

**Only the person writes this document.** A session reads it, checks against it
and reports what it found; it never adds a commitment, softens one, or decides
that a proposal meets one. The reasoning is the same as `plan/SKILL.md` gives
for never answering your own decision: a session that can write its own
commitments has no commitments, only preferences with a paper trail.

## Where it is read

- **Shaping an idea into a proposed feature.** The proposal names the
  commitment it serves. One that cannot name any is still allowed to be
  proposed, and says so in its detail, because the person may want it anyway.
- **An ideas review pass.** Alongside "duplicate" and "made pointless by the
  code", a third reason to dismiss: serves no commitment and is not wanted
  regardless.
- **Re-shaping a feature.** A feature whose answered decisions have moved it
  away from the commitment it was shaped against is a feature to re-read, not
  to keep building.

## What the app is

Five workspaces over one person's real records: what they bought, where their
job search stands, what they have to do, what they have written, and what they
mean to read. One login, one database, one deployment, and per-workspace
schemas so that no workspace owns a fact belonging to another.

The value is in records that are accurate because they collected themselves,
and in the questions that only become answerable once more than one workspace
can be read at once. Being somewhere to put things is not the point, and is the
part every other tool already does.

## The commitments

### 1. A source that needs no habit

Prefer a source that accumulates whether or not this app exists. Gmail was the
first for exactly that reason, the vault is the second, and both were chosen
over sources that would need feeding.

`VAULT-SPEC.md` states the general case: the failure mode of personal-insight
tools is that they need feeding, and this one does not. `JOB-SEARCH-SPEC.md`
makes the same argument from the other end, that the confirmation email is the
log entry, so applying creates the record whether or not you remembered to.

A feature that only works if you remember to do something is a feature that
stops working in a month. If one is worth building anyway, it says so and says
what happens when the habit lapses.

### 2. One owner per fact, and no copies

`TODO-SPEC.md` puts it as a rule: an obligation is displayed by whoever needs to
show it and written by whoever owns it. Nothing copies a row across a workspace
boundary. What a reader stores about a foreign fact is its own decision to stop
showing it.

Every spec says what its module is authoritative for, and the vault's says what
it is deliberately not authoritative for. A proposal that introduces a second
writer for a fact that already has one is refused on the three failures
`TODO-SPEC.md` names: drift between the copies, resurrection of a deleted
upstream row, and a write-back the app is not allowed to make.

### 3. The reliable half first

`LEARN-SPEC.md` cut curriculum generation from v1 and kept resolution, having
tested both: generation needed twenty searches, silently left holes, and its
quality tracked whether the topic had a free corpus rather than anything about
the prompt. Ship the reliable half and let the unreliable half inherit a proven
queue.

The general form: when a feature has an impressive half and a dependable half,
the dependable half is v1, and the other one is revisited deliberately once the
first works.

### 4. v1 is shaped to make the end cheap

Two specs say this in almost the same sentence. The vault's v1 is a viewer
whose shape is chosen to make what it is eventually for cheap rather than to
make v1 impressive; the todo module's v1 is shaped to make the integration
honest rather than to make v1 impressive.

So a v1 is judged on what it costs the version after it, not on how much of the
spec it covers.

### 5. A measurement behind anything sizeable

`LEARN-SPEC.md` rests on a measurement taken before the spec was written: the
five-item list resolved four of five to free full text and located the fifth,
and the document says that measurement is the whole basis for the module
existing. `EVIDENCE-LAYER.md` opens on 341 pursuits, 203 of them dead, after six
months.

A proposal for something sizeable carries a number, an example worked by hand,
or a specific occasion when the absence cost something. "It would be nice to
have" is a fine reason for a small thing and a poor one for a feature.

### 6. Mechanical, and not already done by what you use

`LEARN-SPEC.md` justifies itself on three clauses: the work is mechanical, it is
not hard for a machine, and nothing you currently use does it. All three have to
hold. The first two without the third describe a feature of a tool you already
own.

### 7. Foundations whose retrofit costs a rewrite are paid up front

`JOB-SEARCH-SPEC.md` argues it for row level security: a day now against a
rewrite later, and if nobody else ever signs in you have lost a day. The build
order applied it by writing the cross-user isolation test before any feature
code, and `tests/account-cascade.test.ts` extends it by refusing a migration
that adds a table without a cascade from the user row.

The test is whether the thing can be added later at the same cost. Auth,
isolation, deletion and the cascade cannot. Most other things can, and waiting
is then the right call.

### 8. Where it is not sure, it says so

`LEARN-SPEC.md` is built to obey one rule: never send someone to a page that is
not there. A pointer that is confidently wrong costs more than no pointer,
because you spend the twenty minutes anyway and you stop trusting the queue.

This generalises to everything the app infers rather than reads: an extracted
order, a matched role, a claim about what you know. Where it cannot be sure, it
says so and shows its working.

The review queue is this commitment already in code, and so is the commerce
side's arithmetic gate, which refuses an extraction whose figures do not
reconcile. The job side is the instructive case: `lib/jobs/email/extract.ts`
records that no arithmetic check is available there, so it had to build
substitutes rather than proceed without a gate.

### 9. No team coordination machinery

`PLAN-SPEC.md` leaves out everything Linear and Jira have that exists to
coordinate more people than one account, one repository and two builders.
Assignment, workflow states, approvals and roles are all machinery for a team.

### 10. Non-goals are written down

Every spec has a section listing what the module is not, and two of them give
the same reason: these will otherwise get invented. The convention is itself a
commitment. A proposal of any size says what it is not doing, especially where
the obvious next step is one this document would refuse.

## Failure modes in a proposal

The short form, for a pass over a list of ideas. Each maps to a commitment
above.

| | Signal |
|---|---|
| Needs feeding | Only works if you remember to do something, and does not say what happens when you stop |
| Second writer | Copies or re-derives a fact another workspace owns |
| Impressive half first | The demonstrable part is the unreliable part |
| v1 for its own sake | Nothing about its shape makes the version after it cheaper |
| Nothing measured | Sizeable, and rests only on it being a good idea |
| Already solved | Mechanical and automatable, but your existing tools do it |
| Deferred foundation | Something whose retrofit is a rewrite, left for later |
| Confidently wrong | Infers something and has no way to say it is unsure |
| Team machinery | Assignment, approval, workflow, roles, notification |
| Surface, not depth | A new page where an existing one should have got better |

The last one has no numbered commitment because it comes from a practice rather
than a document: `EVIDENCE-LAYER.md` records that `/jobs/today` is where a new
surface earns its place or does not. A sixth workspace, or a seventh page in
one, is the expensive answer and is usually the first one to hand.

## How this document changes

Rarely, and by the person, when something built changes what the app is for. A
commitment that gets argued around twice is either wrong or badly worded, and
the fix is to change it here rather than to keep making the exception.

It is a description of the app's direction and not a promise. Where it and the
code disagree, one of them is wrong, and which one is worth finding out.

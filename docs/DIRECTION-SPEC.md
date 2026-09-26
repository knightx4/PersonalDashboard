# Direction: the vision and what using the app shows

How the app decides what to build. Two inputs feed the plan, and this document
says how they relate and what has to exist for them to work with as little of
the person's time as possible.

## The two inputs

**The vision** is what each workspace is for, in the person's words. It is the
top of the plan: features exist to serve a line of it, and steps exist to
finish a feature. It changes rarely.

**Instances** are specific things the person notices while using the app: a
bug, a request, something they like. They arrive through the feedback button
and the ideas page, and there are many of them.

An instance is evidence about the vision. Each one is one of two kinds:

1. **A local miss.** The vision was right and the build fell short of it. The
   notes queue fixes it, and nothing above the step changes. Most instances are
   this kind.
2. **A finding about the vision.** The vision is wrong or missing something.
   Fixing it where it was noticed treats the symptom; the vision should change,
   and the change reaches features and steps through the plan the same way any
   top-down change does.

Telling the two apart is the step that joins the two directions. Without it,
instances only ever get fixed one at a time and the app drifts from what the
person wanted, or the vision never learns from use and the plan keeps building
something use has already shown to be wrong.

## Who does what

The person's aim is to spend as little time on the tool as possible. So the
work splits like this.

The person:

- writes each workspace's vision, and the app's, and revises it when a review
  proposes an edit they agree with;
- reacts in the moment with the feedback button: a bug, a request, or a like,
  about ten seconds each;
- answers the few decisions that change what gets built.

Sessions:

- turn the vision into features and steps, and add, split and reorder steps
  beneath a feature the person approved without asking again;
- fix local misses from the notes queue, as they do now;
- once a week, read the instances since the last review against each
  workspace's vision, and either confirm the vision still holds or propose a
  specific edit to it, citing the instances.

The person approves at two levels only: a vision edit, and a feature. Anything
beneath an approved feature is the sessions' to write, with one exception kept
from the goals skill: a step that acts outside the repository (sending a
message, buying something, changing another service) still waits for approval.

## What already exists

- **Visions.** `module_visions` (migration 0093) holds one per workspace,
  edited on `/dev/specs`. All eight workspaces have one. Some are a single
  sentence: dev's is "Help make the website." Nothing a session reads uses
  them. A step's brief tops out at its feature's done-when, printed as
  *Destination* by `lib/plan/brief.ts`.
- **Instances.** `feedback_items` takes `bug` and `feature` (migration 0026).
  319 have been filed and all but two are closed, so the notes loop works. It
  closes each note on its own and nothing reads across them.
- **Ideas.** 115 open on `/dev/ideas`, 110 of them filed by sessions rather
  than the person. `docs/IDEAS-REVIEW.md` records passes that thinned them by hand.
- **Approval.** Approving a proposed feature approves every proposed step
  beneath it in one click. A re-shape or a build session that later adds a step
  under that feature writes it as proposed, so it waits for a second approval.

## What has to be built

Four features, shaped into the plan under the dev workspace as proposals.
None is approved yet.

### 1. Sessions build against the vision (#1091)

Every step brief opens with the vision of its workspace, above *Destination*,
so a session building a step can check the step against why the workspace
exists. The app as a whole gets its own vision, stored under the module key
`app` and edited on the specs index, and it goes in the brief of a step with no
workspace. Shaping reads the vision and says in the feature's detail which part
of it the feature serves; a feature that serves none of it says so, which is a
signal the person should see before approving.

### 2. Say what you like (#1100)

The feedback button gets a third kind, `like`. A like names something to keep
or extend. It is not work, so the notes queue does not claim it; the weekly
review reads it and closes it.

### 3. A weekly review of each vision (#1104)

A scheduled run reads, per workspace, the notes and likes filed since the last
review, the ideas the person dismissed, and the steps finished. It groups what
it read and writes one of two results: the vision still holds, with a sentence
saying why, or a proposed edit with the instances that argue for it. A proposed
edit shows beside the vision on `/dev/specs`, and accepting it replaces the
vision. On its first run the review also drafts a fuller vision for any
workspace whose vision is too short to build from, as a proposed edit like any
other.

The same run reads the open ideas sessions filed and dismisses those that serve
no line of the vision, with a comment naming why, so the ideas page stops
growing faster than the person can read it.

Whether accepting an edit should also re-shape the workspace's open features is
left as a decision on the feature (#1109).

### 4. Approval stops at the feature (#1095)

A step a session adds beneath an approved feature is written ready to build,
stamped with where it came from so the page can show it was not the person's.
The person can still drop it in one click. A step that acts outside the
repository is still written as proposed. This changes a rule the plan skill
states as absolute, so the skill, `docs/PLAN-SPEC.md` and the CLI change
together.

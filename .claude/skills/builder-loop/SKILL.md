---
name: builder-loop
description: Make building this app get easier every day. Read what cost builders time (build_friction - guard refusals, failed gate checks, broken tools, misleading docs, repeated mistakes, the design critic's recurring fixes and every failed run's stop line), group it into lessons (build_lessons), take any regression first, then remove the costliest cause in code with a test and ship it through the gate to main, mark it fixed, and write what a builder should do for causes code cannot remove, which every builder is shown when it claims a step. Use when the daily builder review fires with "Follow .claude/skills/builder-loop/SKILL.md", or the user says "review the builders", "why do the builders keep doing X", "work the builder lessons", or "what keeps going wrong in the plan runs".
---

# The builder review

Builders keep paying for the same mistakes. In the fortnight before 5
November 2026, 57 of 279 plan runs failed, 18 of them on one close guard,
and #2879 took six runs to land because one command recorded the wrong
commit. Each session wrote a good stop line, and none read the others'.

This review is the session that reads them all. Its job each day is to
make one recurring cost disappear for good, and to make sure every builder
knows about the ones that have not disappeared yet.

## The pipeline

- **Friction** (`build_friction`): one row per thing that cost time.
  Builders log as they go (`npm run friction -- log`, building.md). The
  tools log their own refusals: `plan.ts done`, `land` and `built`, the
  writing check, and every failed `npm run gate` check (filed by lint rule
  or check name). This review reads in each failed run's stop line and the
  design critic's fixes, filed by the law they break.
- **Lessons** (`build_lessons`): the cause behind a group of friction, under
  a key. `open` until this review acts; `fixed` when code now prevents it
  (with `fix` naming the commit and what stops it); `taught` when the best
  available answer is words for builders; `wont_fix` when it is not worth
  doing, with why.
- **Feeding forward**: `plan.ts start` prints every taught or open lesson
  that has words, costliest first, and any regression. A tool that refuses
  prints how many times builders hit that wall this fortnight and the
  lesson's words.
- **Regression**: friction filed under a fixed lesson reopens it and dates
  the regression. A regression is the first thing a review takes.
- **History** (`build_reviews`): one row per review. The next review reads
  critic fixes from where this one stopped.

## A day's work

1. **Read in and rank.**

   ```
   npm run friction -- review
   ```

   It reads failed runs and critic fixes in, then prints regressions,
   lessons by minutes lost (with a trend against the fortnight before), and
   the friction no lesson holds yet. Read `npm run friction -- lessons
   --all` as well, so you know what has been tried.

2. **File what is unfiled.** Every row under NOT YET UNDER A LESSON goes
   under a lesson: an existing key where the cause is the same, a new key
   where it is not. Group by cause, not by symptom: three stop lines that
   each say "fetch failed", "port held" and "compare timed out" may all be
   the preview server not starting in a cloud session.

   ```
   npm run friction -- file <id>,<id> --lesson <key> [--title "the cause, in one sentence"]
   ```

   When the tools' word list (`KNOWN` in lib/plan/friction.ts) would have
   filed a row by itself, add the pattern there with a test, so tomorrow it
   is filed without you.

3. **Take any regression first.** A fixed lesson hit again means the fix
   was incomplete or something routes around it. Find how, and fix that.

4. **Remove the costliest cause.** Take the top lesson that is not
   `taught` with a fix already impossible, and remove the cause in the
   tools, in this order of preference:

   - **Make the mistake impossible.** A guard that refuses the wrong input
     with a message that names the right one, a default that picks the
     right thing (as `built` now picks the step's own commit), a check in
     the gate.
   - **Make the wall cheaper.** Where a guard is right but costly to clear,
     make clearing it automatic or fast: a step with no screen change in
     its own commit needs no critic round; a parent counts its children's
     rounds.
   - **Make the message lead somewhere.** A refusal that names the command
     that clears it, and the most likely cause first.
   - **Fix the doc** that pointed builders the wrong way. A skill or
     reference that tells builders to do the thing that fails is a bug.

   Build it with a test that would have failed on the friction you read,
   run `npm run gate`, and merge to main as CLAUDE.md says. Then:

   ```
   npm run friction -- fixed <key> --fix "<sha>: what now stops it"
   ```

   One cause removed properly beats three patched. When time remains, take
   the next.

5. **Teach what code cannot remove.** For each lesson still costing time
   that this run did not fix, write what a builder should do, in one to
   three sentences a builder can act on mid-step:

   ```
   npm run friction -- teach <key> --lesson "When X, do Y; Z is why."
   ```

   Every builder sees it the next time it claims a step. Rewrite a lesson
   whose friction keeps coming after it was taught: the words are not
   working. A lesson that is really a design question for the person (for
   example, whether a guard should exist at all) is a raise
   (`plan.ts raise`, raising.md), with the counts as the evidence.

6. **Record the review.**

   ```
   npm run friction -- reviewed --note "what you found and changed" --fixed <key>,… --taught <key>,…
   ```

## Report

A few lines: regressions and what you did about each, the cause removed
(lesson, minutes it cost this fortnight, the commit), lessons taught or
rewritten, anything raised. Then the top three lessons still open, by
minutes lost, so the person can see where building time goes.

## Rules

- Only the owner's rows. The scripts scope every read and write to
  `core.dev_owner_id()`.
- Never weaken a guard to make a count fall. A guard that refuses correctly
  and often is a lesson about what builders do before they reach it.
- Never delete friction. A row filed under the wrong lesson is moved with
  `file`.
- Spend nothing on models beyond this session; the pipeline calls none.

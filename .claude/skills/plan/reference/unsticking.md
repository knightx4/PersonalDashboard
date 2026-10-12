# Finding out why a feature stalled

The overnight tick sends this job when the last two build runs on a feature
closed nothing. Sending the feature again unchanged reaches the same wall, so
this run finds the wall. It either removes it or writes it down where the plan
shows it. The turn names the feature and quotes what each run ended with.

This is not the build job. Do not build steps here. If the fix is a step's own
work, the fix is to make that step workable and let the next build run do it.

## Read first

- `show <feature>`: the brief, the open steps, what each waits on.
- The thread and comment on each open step. Earlier sessions often wrote the
  reason there and never recorded it anywhere the app reads.
- `check-backs --all`, for the check-backs on these steps.
- The code and data each open step needs. If a step says "from two weeks of
  undos", count the undos.

## Leave every open step in one of five states

1. **Workable now.** Something in the repository or the database stood in the
   way, and you removed it. Examples: a migration that was never applied, a
   script that fails, an acceptance line no code can meet, a step too big for
   one sitting. Fix it and merge the fix to main, rewrite the done-when, or
   split the step with `add`. Say what you changed in the stop line.
2. **Waiting on data or time.** The work needs something that does not exist
   yet: two weeks of a new log, a month of page opens, a scheduled run that has
   not fired. Add a check-back on the step:

   ```
   npx tsx scripts/plan.ts check-back "<what has to exist>" --at <ISO time> --from <n> \
     --detail "what to count, and what to do if it is there or not"
   ```

   The check-back holds the step. The plan shows "Waiting on the check on
   <day>", and the runner does not send it until a session has done the check.
   Pick the day the data will be there, not a guess at the earliest it might
   be. If a step is already `in_progress` with nobody on it, `reopen` it.
3. **Waiting on another step.** `depends <n> --on <m>`.
4. **Waiting on the person.** For something only they can do, such as setting
   a key, connecting an account or paying for a service, use
   `needs "<what to set>" --for <n>`, which writes their setup job and makes
   the step wait on it. For a decision only they can make, use
   `block <n> --ask "<the question>"` with the options in the detail. Both
   show under On you. Do not ask what you can find out, and do not ask whether
   to wait for data: that is state 2.
5. **No longer worth doing.** `drop <n> --note "<why>"`.

A step left as it was, with nothing recorded, means this run failed, and the
next build run will stop in the same place.

## Finish

Write one line on the run before you end, even when everything is fixed:

```
npx tsx scripts/plan.ts stopped <feature> --reason "<what you found, and what you changed>"
```

For example: "#1135 needs five closes from evidence and there are four; added
a check-back for 26 October." If the stall comes back after this run, the
person sees that line, so make it say what the wall was.

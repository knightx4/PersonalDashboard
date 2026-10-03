# The spec audit routine

The standing prompt for the Claude Code routine that runs the weekly spec
audit. Scheduling it is plan #1524: a tick on Mondays fires the routine
through the API and records the fire in `plan_runs`. Until that is built the
audit is run by hand, by a session told to audit the specs, and this prompt
is what to paste into the routine once it exists.

The app appends a turn naming the account's `user_id`. The prompt and the
connectors are stored on claude.ai, not read from here, so a change to
either takes effect only once it is made on the routine itself.

## Setting it up

1. On claude.ai, create a routine on this repository with the **Supabase**
   connector attached. It needs no schedule of its own: the weekly tick fires
   it through the API.
2. Paste the prompt below as its instructions.
3. Copy the routine's id (`trig_…`) and create a token for it. Where they go
   in Vercel is set by plan #1524.

## The prompt

```
You audit this repository's specs against its code, and record what you find
in its Supabase project (asjztutnqxbecruvyrbj), through the Supabase
connector.

Read .claude/skills/spec-audit/SKILL.md first and follow it. It says which
specs and workspaces to cover, how to brief one subagent per spec, how to
choose between changing the code and changing the spec, and the rows to
write.

The turn after this one names the user_id to audit for. If there is no such
turn, stop and say so rather than guessing the account.

You write rows, not code. Do not commit, push or edit docs/. Never draft a
spec change while five are waiting on the person, and never approve or
decline one.
```

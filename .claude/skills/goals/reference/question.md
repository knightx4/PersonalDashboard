# A question handed to a goal

A run whose row has a `question` (goals 0092) was started from a chat: the
person asked Ask Dash, a Claude chat or the goal's own thread to figure
something out for one goal ("should I consolidate my loans"), and the chat
handed it to you with `take_on_for_goal`. The brief quotes the question and
says where it came from. The app reports back for you: when you close the
run, the person gets a notification reading "Done: <question>" with the first
sentence of your summary, and a question from Ask Dash also gets that
sentence as a reply line in the conversation. Both open the goal's Dashboard
at a card showing your answer and what you suggest.

## What to do

1. Read the goal as "Reading the goal" says, and pull in what their records
   hold about the question as "Pulling in from the other modules" says. A
   loans question reads the loan list's balances and rates, the statements in
   their mail and anything they wrote about the loans.
2. Research what the question needs on the web, as a Dash step would, and
   settle it as "Decide first, ask last" says: give an answer, not a menu.
3. Write the answer as one file on the goal (`reference/files.md`, and
   "Files" in `reference/working-steps.md` for storing and linking it), linked
   to the goal itself. Its opening sentences are the answer.
4. Put each change you would make in `goals.suggestions` with this run's id,
   one row each, and nothing on the goal itself:
   - a step: `kind = 'step'`, `item_id` the goal, `title` the step as it would
     be written, `detail` one or two sentences on why;
   - a dashboard tile: `kind = 'tile'`, `item_id` the goal, `title` what it
     shows ("Total owed"), and `tile` the tile object as `lib/goals/dashboard.ts`
     checks it, naming only lists, metrics and steps the goal already has.

   ```sql
   set local goals.actor = 'claude';
   set local goals.run_id = '<the run id>';
   insert into goals.suggestions (user_id, item_id, run_id, kind, title, detail, tile)
   values
     ('<user>', '<goal id>', '<the run id>', 'step', 'Ask the servicer for a payoff quote on the two private loans',
      'Consolidating raises their rate; paying these two first saves more.', null),
     ('<user>', '<goal id>', '<the run id>', 'tile', 'Total owed',
      'One figure for what is left, from the loans list.', '{"type": "number", "list": "<list id>", "field": "balance"}');
   ```

   They answer each with Add or No on the result card. Add makes the step, or
   puts the tile on the end of the dashboard; never write either yourself in
   this run, and never write `reaction`, `reacted_at` or `attended`.
5. Close the run with a summary whose first sentence answers the question in
   plain words ("Not yet: consolidating would raise the rate on two of your
   four loans."), then a short paragraph of why. That sentence is what the
   notification and the reply say, so it has to stand alone on a lock screen.

Do not map the goal, add or close steps, answer its open questions or change
its dashboard in this run, even where you see something to fix: that is a
suggestion too. A run that cannot answer closes as failed with the reason in
one sentence; the person is told that instead.

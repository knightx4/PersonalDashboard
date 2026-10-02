# Writing X posts about the app

What a post about this app should look like, for the run behind Suggest posts on
/dev/posts (plan #1417) and for anyone editing its drafts. Everything in
[WRITING-GUIDE.md](WRITING-GUIDE.md) applies. This document adds what is
particular to a short public post.

The run reads this document in full before it drafts, and checks every draft
against "Never in a post" and "Counting characters" before saving it.

## Who reads them

AI builders and investors on X. They know what a coding agent, a pull request
and CI are. They do not know this app, its workspaces or its vocabulary, and
they scroll past anything that reads like an announcement.

What they want from a post about this app is how it is built: one person
directing Dash sessions that work from a written plan, several of them merging
to main each day, with checks that keep main working. Each post shows one
concrete piece of that.

## What a post is

- **One idea.** Each post makes a single point that a reader could repeat.
  The `angle` column holds that point in one sentence, and the run compares it
  with the angles already posted or dropped and skips one that repeats them.
- **At most 280 characters**, counted the way X counts them (below). A thread
  adds at most four more posts, each also at most 280. Use a thread only when
  the idea needs a sequence, such as a rule and what happens when it fails.
  Most posts are a single post.
- **First person, from the person who builds the app.** "I asked Dash to…",
  "Dash now…". Dash is the recurring subject: what it was told to do, what rule
  it follows, what it checks. A reader new to the account does not know who
  Dash is, so a post that would not make sense otherwise says so: "Dash, the
  AI that builds my app".
- **Opens with a concrete fact.** A number, a rule, or what changed, taken
  from the plan. The opening line is what decides whether anyone reads the
  rest, so it carries the substance rather than a teaser.
- **Explains its terms.** Write "the checks every merge must pass" or "the
  pre-merge check" rather than "the gate", and "a question Dash writes for me
  to answer" rather than "a decision row". App vocabulary goes in only with
  enough words around it to make sense to a stranger.

## What the plan can back

Every claim in a post must be traceable to a plan step or a closed note the
row cites in `source_plan_item_ids` or `source_feedback_ids`. If the step does
not say it, the post does not say it.

- **Counts come from the table, not from step numbers.** Some rows have been
  deleted and numbers are never reused, so the highest number overstates how
  many steps exist. On 2 October 2026 the highest was #1421, while 1,392 rows
  existed, 1,337 were done, and 1,077 of those were build steps rather than
  questions or setup. Count rows with a query, and say which kind you counted.
- **Rates come from `completed_at`.** "79 build steps closed on 30 September"
  is a fact. "Ships 80 features a day" is not: a step is not a feature.
- **No outcome the plan does not record.** Not "saves hours", "never breaks",
  "fully autonomous" or any measure of speed, quality or users unless a step
  measured it.
- **The post does not need the step number.** Readers outside the app cannot
  open it. The citation lives on the row, where the Posts tab shows it.

## Style

- No hashtags, no emoji, and no thread markers such as "🧵" or "1/".
- No launch language: "excited to share", "introducing", "game changer",
  "the future of", "big news".
- No questions asked for engagement ("What do you think?") and no call to
  follow.
- No links in a draft. The person can add one when posting.
- Plain sentences. The four failure modes in the writing guide are the ones to
  check: slogans and staged cadence, claims without substance, wordiness and
  jargon, and framing that delays the point. Em dashes, colons and "not X, it's
  Y" turn up most often in short posts, so check for them first.
- Name a model or vendor only where it is the fact, for example that a check
  fails when a button calls Claude without showing its cost.

## Never in a post

The run checks every draft for each of these before inserting it, and drops a
draft that fails rather than editing around it. The part a rule can catch is
`scripts/posts-check.ts` (`lib/dev/post-check.ts`); the rest is the run
reading the draft.

- **Anything from a workspace other than Dev.** Jobs, goals, the vault, Learn,
  news, shopping, todo, mail and calendar hold the person's life, and a step
  in one of them describes that life even when its title looks technical. Draft
  only from steps whose module is `dev` or null, and leave out a null-module
  step whose text mentions another workspace's data.
- **People's names**, including the person's own and anything that contains
  it, such as the app's domain.
- **Amounts of money**, including what a run or a model call cost.
- **Employers**, companies applied to, and anyone the person corresponds with.
- **Email addresses**, phone numbers and street addresses.
- **Identifiers from the running system**: session ids, the Supabase project
  ref, keys, tokens and internal URLs. Commit hashes and file paths are allowed
  but rarely help a reader.
- **Images other than Surfaces-gallery screenshots.** The gallery draws sample
  data. A screenshot of a live page shows the person's rows.

A closed note (`feedback_items`) is a source only when it is about the app
itself. Notes often quote what the person saw on a page, which can carry their
data, so check a note's text against this list as strictly as a draft.

## Counting characters

X counts most characters as 1, and a link as 23 whatever its length. Emoji
and characters from Chinese, Japanese and Korean count as 2. Drafts contain no
links and no emoji, so for them the count is the length of the text. Keep a
margin of about 20 characters so the person can edit without going over.

The limit assumes the account does not have X Premium. If it does, raising the
limit is a change to this section and to the counter on the Posts tab, and
nothing else.

## Examples

Each example is written from a shipped step, cited by number, with its
character count. They show the range of subjects, not a template to copy.

**Main's status on every page** (#639, done 18 September 2026), 255
characters:

> Sessions of Dash, the AI that builds my app, merge to main many times a
> day, so I asked it to show main's CI on every page: a dot that is green when
> the last commit passed, red when it failed, amber while running, grey once
> the reading is six minutes old.

**A check for paid buttons** (#919, done 24 September 2026), 226 characters:

> Every button in my app that calls Claude has to show what it costs. Dash
> wrote a test that walks every server action and fails the pre-merge check
> when one calls the model without a cost hint, naming the file and the
> function.

**Setup steps instead of blocks** (#600 and #601, done 18 September 2026),
257 characters:

> When a Dash session needs a key only I have, it no longer marks the step
> blocked. It writes me a setup step saying where to go and what to set, and
> the stuck step waits on it. When I tick the setup step done, the work is
> ready again with nothing to unblock.

**Dash scored against the writing guide** (#1175, done 29 September 2026),
240 characters:

> My app has a writing guide, and the text Dash writes is scored against it.
> Every plan step a session writes and every reply Dash leaves on a comment is
> checked for six patterns, such as "not X, it's Y", and the session is warned
> on a match.

**Questions Dash will not answer for me** (#58 and #648, done 8 and 18
September 2026), 246 characters:

> When a Dash session reaches a choice it should not make for me, it writes it
> on the plan as a question with lettered options and its recommendation. I
> answer in one box. The question closes with my words, and the steps waiting
> on it become ready.

**When a merge fails** (#699, done 19 September 2026), a thread of three posts,
187, 209 and 127 characters:

> Dash, the AI that builds my app, runs several sessions in parallel, each
> merging its plan step to main as it closes. Sometimes the merge fails. This
> is the rule Dash follows when it does.

> First it pushes the working branch, then marks the step blocked with that
> branch named in the reason. The work outlives the session, and whoever picks
> up the step reads the branch instead of building it twice.

> Then it stops the batch instead of sending the next step, and reports which
> steps reached main and which are still on a branch.

### A draft to reject

> This isn't just a dashboard — it's an AI-native dev shop. 1,400+ steps.
> Zero humans writing code. The future is here. 🚀 #buildinpublic

It fails on almost every count: an inflated contrast and an em dash, a step
count taken from the highest number, a claim no step records, launch language,
an emoji and a hashtag.

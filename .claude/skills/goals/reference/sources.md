# Where to look

<!-- Written by `npm run sources:write` from lib/sources/catalogue.ts. Do not edit by hand. -->

Every table in the app that can tell you something about a goal, grouped by how much it
says about what the person wants. Each is scoped to the person by `user_id` unless it says
otherwise. The goals skill, "Pulling in from the other modules", says how to use it.

## What they said they want (read first, quote rather than paraphrase)

### `job_search.thoughts` (Job search)

What the person is looking for in the next job and where they are now, in their own words, one dated entry at a time.

- Search: `body`
- Name a row by `body`; link it by `id`
- Opens at `/jobs/thoughts`
- A newer entry supersedes an older one where they disagree; read them newest first.

### `job_search.profiles` (Job search)

The titles they are targeting and how they like their writing to sound.

- Search: `target_titles`, `writing_style_notes`
- Name a row by `display_name`; link it by `id`
- Scoped to the person by `id`, not user_id
- Opens at `/jobs/settings`

### `obsidian.notes` (Vault)

Every note in their Obsidian vault: what they think, plan and want, in their own words.

- Search: `title`, `body`, `path`
- Name a row by `title`; link it by `path`
- Opens at `/vault/n/<path>`
- Search with full text: `search_tsv @@ websearch_to_tsquery('english', …)`. Rows with deleted_at set are gone from the vault. Find notes by meaning through the map as well: themes, then theme_notes.

### `obsidian.themes` (Vault)

The subjects their notes keep coming back to, each named and described.

- Search: `name`, `about`
- Name a row by `name`; link it by `id`
- Opens at `/vault/map/<id>`
- The list is short enough to read whole and pick from by judgement. A chosen theme leads to its notes through theme_notes (theme_id, note_id) and to its positions through theme_positions.

### `obsidian.positions` (Vault)

Positions they hold, each a sentence drawn from their notes.

- Search: `name`, `statement`
- Name a row by `name`; link it by `id`
- position_sources (position_id, quote) gives the sentence in the note each one came from.

### `obsidian.tensions` (Vault)

Places where two of their positions pull against each other.

- Search: `crux`
- Name a row by `crux`; link it by `id`

### `learn.aims` (Learn)

What they want to learn and why, each a named aim.

- Search: `name`, `about`
- Name a row by `name`; link it by `id`
- Opens at `/learn/goals`
- An aim can be linked under a goal (goals.links kind aim), which shows its progress on the goal page.

### `learn.subjects` (Learn)

The subjects they are studying, with their note on each.

- Search: `name`, `note`
- Name a row by `name`; link it by `id`
- Opens at `/learn/s/<id>`

### `learn.goals` (Learn)

Topics they typed in to learn, in their own words.

- Search: `asked`
- Name a row by `asked`; link it by `id`

### `learn.card_notes` (Learn)

Notes they wrote on Learn cards and on ideas, in their own words.

- Search: `body`
- Name a row by `body`; link it by `id`
- concept_id is the idea a note is about, whose page is /learn/c/<concept_id>; card_id is the Learn now card it was written on, null when written on the idea page or once the card is gone.

### `news.preferences` (News)

The neighbourhood they want local news for.

- Search: `local_area`
- Name a row by `local_area`; link it by `user_id`
- Opens at `/news/settings`

### `public.saved_items` (Shopping)

Things they want to buy, saved from shops, with their notes.

- Search: `title`, `notes`, `url`
- Name a row by `title`; link it by `id`
- Opens at `/shopping/saved/<id>`

### `core.conversation_turns` (Learn)

What they asked or explained, and what Dash replied, turn by turn.

- Search: `body`
- Name a row by `body`; link it by `id`
- role 'user' is theirs and 'assistant' is Dash's: read their turns as what they wanted to know, and Dash's only for context. conversation_id joins core.conversations, which says what the turn is about.

## What they did or have (read for progress and facts)

### `job_search.roles` (Job search)

Each role they are considering or have applied to, with its description and requirements.

- Search: `title`, `jd_text`, `location`, `seniority`, `requirements`
- Name a row by `title`; link it by `id`
- Opens at `/jobs/roles/<id>`

### `job_search.applications` (Job search)

Each application, its stage and the next thing to do on it.

- Search: `next_action`
- Name a row by `next_action`; link it by `id`
- Opens at `/jobs/pipeline`
- Name one by its role (role_id → roles.title). Count them for a job-search goal rather than copying them.

### `job_search.application_events` (Job search)

What happened on each application and when: sent, heard back, rejected, offered.

- Search: `summary`
- Name a row by `summary`; link it by `id`
- Scoped to the person by `user_id`, not user_id

### `job_search.interviews` (Job search)

Interviews, with their prep and what was asked.

- Search: `notes`, `prep_notes`, `questions_asked`
- Name a row by `notes`; link it by `id`
- Opens at `/jobs/interviews`
- Name one by its application’s role (application_id → applications.role_id → roles.title).

### `job_search.companies` (Job search)

Companies they are tracking, with industry, stage and research notes.

- Search: `name`, `industry`, `research`, `hq_location`
- Name a row by `name`; link it by `slug`
- Opens at `/jobs/companies/<slug>`

### `job_search.contacts` (Job search)

People in their network for the search and how they know them.

- Search: `full_name`, `title`, `how_we_connect`, `notes`
- Name a row by `full_name`; link it by `id`
- Opens at `/jobs/contacts/<id>`

### `job_search.contact_touches` (Job search)

Each time they reached out to a contact, and what came back.

- Search: `message`, `response_summary`
- Name a row by `message`; link it by `id`

### `job_search.notes` (Job search)

Notes they wrote on roles, companies and applications.

- Search: `body`
- Name a row by `body`; link it by `id`

### `job_search.evidence_items` (Job search)

Stories of their own work and results, used as evidence in applications.

- Search: `title`, `body`, `context`, `skills`
- Name a row by `title`; link it by `id`
- Opens at `/jobs/answers`

### `job_search.resume_versions` (Job search)

Each version of their résumé, as text.

- Search: `label`, `text_content`, `notes`
- Name a row by `label`; link it by `id`

### `job_search.cover_letters` (Job search)

Cover letters they sent.

- Search: `body`
- Name a row by `body`; link it by `id`

### `job_search.application_answers` (Job search)

Their answers to application questions.

- Search: `answer`
- Name a row by `answer`; link it by `id`

### `job_search.questions` (Job search)

Application questions they have met, with their standing answer.

- Search: `text`, `canonical_answer`
- Name a row by `text`; link it by `id`

### `job_search.reminders` (Job search)

Follow-ups the job search is reminding them of.

- Search: `body`
- Name a row by `body`; link it by `id`
- Opens at `/jobs/today`

### `learn.tracks` (Learn)

Reading tracks, each answering one question.

- Search: `title`, `question`
- Name a row by `title`; link it by `id`
- Opens at `/learn/t/<id>`

### `learn.readings` (Learn)

Things they read or mean to read, with why and their note.

- Search: `title`, `why`, `note`
- Name a row by `title`; link it by `id`
- Opens at `/learn/r/<id>`

### `learn.sources` (Learn)

Books, articles and courses in their library.

- Search: `title`, `author`
- Name a row by `title`; link it by `id`

### `learn.concepts` (Learn)

Ideas they have met, with what they claim about each and how well they know it.

- Search: `name`, `claim`
- Name a row by `name`; link it by `id`
- Opens at `/learn/c/<id>`

### `learn.curriculum_units` (Learn)

Units of a curriculum, each with what it covers and the outcome.

- Search: `title`, `covers`, `outcome`
- Name a row by `title`; link it by `id`

### `learn.quizzes` (Learn)

Quizzes they set themselves, and what each was preparing for.

- Search: `title`, `preparing_for`
- Name a row by `title`; link it by `id`
- Opens at `/learn/quiz/<id>`

### `learn.imports` (Learn)

Lists they pasted in to learn from, as pasted.

- Search: `raw_text`, `source_hint`
- Name a row by `source_hint`; link it by `id`

### `todo.tasks` (Todo)

Tasks they gave themselves, open and done.

- Search: `title`, `body`
- Name a row by `title`; link it by `id`
- Opens at `/todo/all`
- A task that repeats a goal step is theirs to keep; do not propose it again as a step.

### `todo.events` (Todo)

Events they put on their own calendar.

- Search: `title`, `body`, `location`
- Name a row by `title`; link it by `id`
- Opens at `/todo/calendar`

### `news.saved_stories` (News)

Stories from their newsletters they chose to keep.

- Search: `headline`, `summary`, `text`
- Name a row by `headline`; link it by `id`
- Opens at `/news/saved`

### `public.inventory_items` (Shopping)

Things they own, with their notes.

- Search: `name`, `short_name`, `notes`, `search_tags`
- Name a row by `name`; link it by `id`
- Opens at `/shopping/inventory/<id>`

### `public.order_items` (Shopping)

Each thing they bought, from their order emails.

- Search: `name`, `short_name`, `variant`
- Name a row by `name`; link it by `id`
- Scoped to the person through order_id → orders.user_id
- Prices and dates are on the row and its order; sum them for a spending goal rather than copying them.

### `core.conversations` (Learn)

Conversations they had with Dash about a Learn card or a newsletter story, one per thing read.

- Search: `title`
- Name a row by `title`; link it by `id`
- subject_kind says what it is about: 'feed_card' with subject_ref the learn.feed_cards id, or 'news_story'. The words are in core.conversation_turns, joined by conversation_id.

## Mentions (leads only)

### `learn.feed_cards` (Learn)

Cards the daily feed drew for them, with whether they read, saved or passed each.

- Search: `summary`, `takeaway`, `why`, `theme_name`, `aim_name`
- Name a row by `summary`; link it by `id`
- status says what they did with a card; saved and tested cards say more than drawn ones.

### `todo.feed_events` (Todo)

Events from the calendars they subscribe to.

- Search: `title`, `body`, `location`
- Name a row by `title`; link it by `id`
- Opens at `/todo/calendar`

### `news.issues` (News)

Every newsletter issue they receive, with its summary.

- Search: `subject`, `summary`, `text_body`
- Name a row by `subject`; link it by `id`
- Opens at `/news/i/<id>`
- Leads only: an issue mentioning a subject says nothing about what they want.

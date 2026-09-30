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

### `obsidian.note_connections` (Vault)

Each week, notes they wrote recently that come back to an older note of theirs, with a sentence on what they share.

- Search: `sentence`
- Name a row by `sentence`; link it by `id`
- older_note_id and recent_note_ids point at obsidian.notes. week_ending is the day the week was read back from. A row with dismissed_at set is one they hid as not useful.

### `obsidian.maya_threads` (Vault)

The questions they are working through with Maya, one per note, and where they have got to on each.

- Search: `question`, `summary`
- Name a row by `question`; link it by `id`
- Opens at `/vault/maya/<id>`
- note_id points at obsidian.notes. summary is where they have got to, rewritten after each exchange. origin is 'asked' when they asked Maya and 'automatic' when Maya wrote unasked.

### `obsidian.maya_messages` (Vault)

Their exchanges with Maya about their notes.

- Search: `body`
- Name a row by `body`; link it by `id`
- Read their turns (role = 'person') as intent and Maya's (role = 'maya') only as context for them, like core.conversation_turns. thread_id points at maya_threads.

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

### `learn.watch_list` (Learn)

YouTube videos they chose to watch, saved to their playlist, or kept from a channel Dash judged for one of their subjects, with a verdict on each once judged.

- Search: `why`, `summary`
- Name a row by `video_id`; link it by `id`
- item_id is the catalogue_items row of kind video, which has the title and description. verdict is watch, card or skip, with why; watched_at is set when they watched it; left_playlist_at when they took it off the playlist. came_from is playlist, takeout or channel search; a channel search row names the subject it was found for in subject_id.

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
- role 'user' is theirs and 'assistant' is Dash's: read their turns as what they wanted to know, and Dash's only for context. On Dash's answers to an 'ask', citations lists the rows it relied on. conversation_id joins core.conversations, which says what the turn is about.

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

Notes they wrote on roles, companies and applications. On a role these are its comment thread, where author 'claude' marks Dash's replies.

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
- Opens at `/jobs`

### `obsidian.courses` (Vault)

Every course on their academic transcripts: the school, code, title, term, credits and grade, as written.

- Search: `title`, `code`, `school`, `term`
- Name a row by `title`; link it by `id`
- transcript_id points at obsidian.transcripts. year is the year of the term where the transcript gives one. grade is null for a course with no grade, such as transfer credit.

### `obsidian.transcripts` (Vault)

The academic transcripts they have uploaded, one per school record, with the original file kept.

- Search: `school`, `file_name`
- Name a row by `school`; link it by `id`
- The courses on each are in obsidian.courses. The file is in the private vault-transcripts bucket at storage_path.

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

### `learn.plan_pieces` (Learn)

Pieces of about half an hour each unit of a learning goal is split into, with when they passed each.

- Search: `title`
- Name a row by `title`; link it by `id`

### `learn.piece_checks` (Learn)

Questions at the end of each piece of a learning goal's plan, with what they answered and whether it was right.

- Search: `question`, `response`
- Name a row by `question`; link it by `id`

### `learn.review_questions` (Learn)

Review questions on ideas from pieces they passed, asked as each fell due, with what they answered and whether it was right.

- Search: `question`, `response`
- Name a row by `question`; link it by `id`
- concept_id is the idea in learn.concepts; its next due date is review_due_on in learn.concept_state.

### `learn.piece_practice_handins` (Learn)

What they handed in for the practice task in each piece of a learning goal's plan, marked point by point, with whether it passed.

- Search: `answer`
- Name a row by `answer`; link it by `id`
- practice_id is the task in learn.piece_practice, whose piece_id is the piece.

### `learn.plan_project_handins` (Learn)

What they handed in for the final project of a learning goal's plan, marked point by point, with whether it passed.

- Search: `answer`
- Name a row by `answer`; link it by `id`
- project_id is the project in learn.plan_projects, whose subject_id is the goal's track.

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

### `todo.appointments` (Todo)

Appointments and reservations they booked, read from the confirmation emails: doctor, dentist, haircut, a table.

- Search: `title`, `provider`, `location`
- Name a row by `title`; link it by `id`
- Opens at `/todo`
- starts_on is the day in their zone and starts_at the instant when the mail gave a time. status 'cancelled' means a cancellation email came after the booking.

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

### `public.recurring_payments` (Shopping)

Subscriptions and bills they pay regularly, found in their mail, with the latest amount and next date.

- Search: `payee`
- Name a row by `payee`; link it by `id`
- amount_cents is in currency, per period (week, month, quarter, year). status 'cancelled' means a cancellation email came after the last charge; a next_date in the past means a charge that never arrived. status 'ignored' means the person marked it as not a regular payment (a credit card statement, say): it is left out of what they pay each month and off the agenda, so leave it out of spending too.

### `public.recurring_charges` (Shopping)

Each charge, bill, renewal notice or price change read from their mail, one per email.

- Search: `event`
- Name a row by `event`; link it by `id`
- A rise is amount_cents above previous_amount_cents. Read with recurring_payments through payment_id for the payee.

### `core.files` (Files)

Longer pieces written for them and kept as pages: research notes, breakdowns of their data, plans, drafts.

- Search: `title`, `summary`, `body`
- Name a row by `title`; link it by `id`
- Opens at `/goals/files/<id>`
- Skip rows with archived_at set. made_by 'claude' is a run's work, 'you' is theirs. A goal or step links one through goals.links with kind 'file'. Read the file before redoing its work, and revise it rather than writing a second one on the same question. Before revising one, read its thread in core.file_comments (file_id): what they wrote there is what they want changed.

### `core.conversations` (Learn)

Conversations they had with Dash: about a Learn card or a newsletter story, one per thing read, or a question they asked from anywhere in the app.

- Search: `title`
- Name a row by `title`; link it by `id`
- subject_kind says what it is about: 'feed_card' with subject_ref the learn.feed_cards id, 'news_story', or 'ask' for a question asked from anywhere, whose title is the question. The words are in core.conversation_turns, joined by conversation_id.

## Mentions (leads only)

### `learn.phrase_explanations` (Learn)

Phrases they selected on Learn cards to have explained, with the explanation.

- Search: `phrase`, `explanation`
- Name a row by `phrase`; link it by `id`
- card_id is the Learn now card the phrase was on; made_card_id is set when they asked for a card of its own.

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

### `core.observations` (Home)

What Dash noticed each week across their modules, with a number and the timeline rows behind it, and whether they found it useful.

- Search: `sentence`
- Name a row by `sentence`; link it by `id`
- The sentence is Dash's, not theirs: read it as a lead to check against the rows in evidence (core.timeline refs, `schema.table:id`). verdict 'not_useful' means they did not want it; 'useful' that they did. week is the Monday it was written for.

### `core.year_reviews` (Home)

What Dash wrote about each year from their timeline, with the year's counts and spend and the rows behind each paragraph.

- Search: `paragraphs`
- Name a row by `year`; link it by `year`
- Opens at `/timeline/year/<year>`
- The paragraphs are Dash's, not theirs: each is {topic, text, evidence}, with evidence as core.timeline refs (`schema.table:id`). totals holds the counts per kind, spend per currency, each month, the top shops and the goals with steps done. complete is false while the year was still going when it was written; through is how far it read.

### `core.week_reviews` (Home)

What Dash wrote about each week, Sunday to Saturday: the week's counted numbers per module, observations tied to their goals, and one thing to change next week.

- Search: `observations`, `change`
- Name a row by `week`; link it by `week`
- Opens at `/home/week/<week>`
- The observations and the change are Dash's, not theirs: each observation is {text, goal_id, evidence}, with goal_id a goals.goals id or null and evidence as `schema.table:id` refs. facts holds the numbers counted for the week. week is the Sunday it starts on. change_kept says whether the previous week's change happened (null when unknown). source 'plain' means no model wrote it.

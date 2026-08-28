> **Note.** This is the job search workspace's original specification, carried
> over when it was merged into this repository. It describes the app as a
> standalone deployment; read paths in it as prefixed with `/jobs`, and its
> schema as `job_search` rather than `public`. See [SETUP.md](SETUP.md) for how
> the two workspaces share one project.


# MY DESCRIPTION

Same shape as Shopping Manager, but for tracking job applications instead of purchases.

- Reads Gmail for anything related to my job search: application confirmations, rejections, interview invites, recruiter outreach.
- I can also enter a job description myself and set the role up that way. If an email for that role arrives later, it links itself to the application automatically.
- It helps me answer application questions and write cover letters. Ideally I paste the application link and it figures out what questions are being asked. If it cannot, I paste the questions in and it goes from there.
- Roles are linked to companies. They are two separate but related things.
- I can attach other things to a role or a company: people to talk to or message on LinkedIn, notes about the company, whatever else.
- I can leave notes on interviews I had.
- I can mark things as rejected.

### UI / UX

Same design language as Shopping Manager. Clean and modern, light palette, neutrals with subtle pops of color, sans serif, buttons that feel alive without getting in the way.




# AI OUTPUT

## Overview

A pipeline tracker for a job search that maintains itself from your inbox, and a writing tool that drafts application answers from a bank of your own evidence rather than from a blank page.

Two things make it different from Huntr, Teal, and Simplify. Those tools require you to log every application by hand or through a browser extension at the moment you apply, and they treat writing as a separate resume-optimization product. Here, the confirmation email is the log entry: applying creates the record whether or not you remembered to. And the writing side is backed by a persistent, growing store of your actual experience and your previously approved answers, so the fiftieth application costs less effort than the fifth rather than more.

**Positioning:** the MVP is a pipeline tracker that stays current without manual upkeep. The writing layer is Phase 2. The schema below carries every table the writing layer needs, so Phase 2 is feature work with no migration.

**Scope:** this is a personal tool first, with the same multi-user foundation as Shopping Manager, for the same reason. Proper auth and row level security from day one costs about a day and retrofitting them costs a rewrite. If you never let anyone else in, you have lost a day. If you do, everything already works.

### The most useful thing this can do

Answer the question your search actually turns on: where in the funnel are you losing, and does that differ by channel. Applications sent, confirmations received, first human responses, screens, later rounds, offers, broken out by source (cold portal, referral, recruiter inbound, direct outreach) and by stage of rejection. That number is only trustworthy if the data collects itself, which is why ingestion comes before analytics in the build order.

### Non-goals

Listing these because Cursor will otherwise invent them.

- No auto-apply. Never fills out and submits an application form on your behalf. It drafts, you paste.
- No job board or aggregation. It does not go find roles for you.
- No scraping of anything behind a login, and no LinkedIn scraping. Contacts are entered manually or pasted.
- No resume builder or ATS keyword scoring. Resume versions are stored and referenced, not generated.
- No recruiter-side features. One candidate's view of one search.
- No calendar write access in v1. Read is a Phase 3 consideration and it is a separate Google grant with its own consent flow.
- No comp database or market data.

---

## What carries over from ShoppingManager

This is why the build is short. Roughly 40% of Shopping Manager transfers with the domain nouns swapped, and the parts that transfer are the parts that took the longest to get right the first time.

**Copy nearly verbatim:**

| Thing | Change needed |
|---|---|
| Supabase Auth wiring, `@supabase/ssr`, middleware session refresh, route protection | None |
| `profiles` table and its insert trigger | Different app-level columns |
| RLS policy template and the cross-user isolation test | Point the test's table list at the new schema |
| `lib/db/admin.ts` service-role boundary and the lint rule enforcing it | None |
| Gmail OAuth flow, token encryption, `invalid_grant` reauth path, revoke-on-disconnect | None |
| `email_accounts`, `ingested_messages`, `sync_jobs` tables | `ingested_messages.classification` enum changes |
| `lib/email/providers/` interface, Gmail list and history-based incremental sync | Different `q` query |
| Inngest backfill fan-out, per-message steps, idempotency via unique constraints | None |
| Review queue pattern | Different fields on the review row |
| Delete-all-data cascade with token revocation | New table list |
| Design system, shell, nav, empty states, Tailwind and shadcn setup | New accent, new sections |

**Adapt:**

- Two-tier classification survives, but Tier A is materially weaker here. See the ingestion section, because that difference drives several decisions.
- Structured extraction against a Zod schema survives. The guardrails are different, because there is no arithmetic check to lean on.
- Reconciliation becomes linking, and it is harder than order matching.

**Genuinely new:**

- The company / role / application entity split and its state machine
- Linking inbound mail to an existing application, with a confidence model
- Job description and application-question ingestion from URLs
- The evidence bank, question bank, and grounded generation
- Funnel analytics

**Decision on repository structure.** Separate repo, separate Supabase project, separate Vercel project. Do not fork and strip. The temptation is to keep one codebase because the ingestion layer is shared, but the schemas share no tables, and a shared repo means every change to one app risks the other. Copy the files you want. If the email provider layer diverges usefully in both, extract it to a package later, when you know what the shared interface actually is.

**Decision on Google Cloud.** Also a separate project, with its own consent screen and its own OAuth clients. The 100-user unverified cap is per consent screen, and more importantly the two apps request Gmail access for visibly different reasons. A privacy policy and consent screen that describes both is worse at explaining either. Reuse the domain by putting this app on a subdomain, since domain verification in Search Console covers subdomains.

---

## Auth and access

Identical to Shopping Manager. Read that document's Auth and access section as the specification and change nothing except names. Summarized here so this document stands alone.

- Supabase Auth for identity, email/password plus Google sign-in.
- **Sign in with Google and read my Gmail are two separate grants, two separate OAuth clients, two separate consent moments.** Sign-in scopes are non-sensitive. `gmail.readonly` is Restricted and carries the unverified-app warning and the 100-user lifetime cap. Bundling them shows the scary screen to people who have not yet decided to trust the app.
- **Set the OAuth app's publishing status to In production immediately.** In Testing status, Google revokes refresh tokens every 7 days and your sync dies weekly for reasons that look like a bug in your code.
- RLS enabled on every table holding user data. Child tables reach the user through their parent with an `exists` subquery, and the foreign key gets an index.
- The cross-user isolation test, written as a loop over the table list, exists before any feature code.
- Service-role queries in Inngest jobs filter by `user_id` explicitly even though nothing forces them to.

One addition specific to this app. The Gmail query here is broader and less well-bounded than the commerce one, which means the pre-consent explanation screen matters more. It should say plainly: read-only, scoped to a search query about recruiting mail, message bodies are never stored, and subjects and senders are retained only for messages that turn out to be relevant.

**Effort:** roughly half a day, since it is a port rather than a build.

---

## Data model

Postgres via Supabase. All tables have `id uuid pk default gen_random_uuid()`, `created_at timestamptz default now()`, `updated_at timestamptz`. Every user-owned table has `user_id uuid references auth.users not null` with an RLS policy of `user_id = auth.uid()`.

### The three-level split, and why

You asked for companies and roles as separate but related things. That is right, and there is a third level underneath it.

- **`companies`** is the organization. Stable across your whole search. Notes, contacts, and your read on the place live here and stay useful even when a specific posting closes.
- **`roles`** is a specific posting. Title, JD, link, comp band, location, ATS. Facts about the job as advertised, which do not change based on how your pursuit is going.
- **`applications`** is your pursuit of a role. Status, dates, which resume you sent, which answers you gave, how it ended.

The case for splitting `applications` off `roles` rather than putting status directly on the role: re-applying to the same company in a later cycle is normal, and roles get reposted. When that happens you want the previous attempt's interview notes and rejection stage preserved as history rather than overwritten, and you want inbound email dated after the second attempt to link to the second attempt. One row per pursuit gives you that for free. It also makes "roles I saved but never applied to" a natural state rather than a status value that distorts every funnel calculation.

The cost is one more join and the risk of the UI feeling bureaucratic. Neutralize that in the interface: creating a role creates its application in the same action unless you explicitly save it as a lead, and every list view shows the joined object. You should never see the word "application" as distinct from "role" unless you have two of them.

### `profiles`
| column | type | notes |
|---|---|---|
| id | uuid | pk, references `auth.users(id)` on delete cascade |
| display_name, avatar_url | text | |
| timezone | text | interview times and "this week" depend on it |
| target_titles | text[] | seeds relevance scoring in ingestion |
| search_started_on | date | anchors all funnel time series |
| weekly_application_goal | int | nullable, unused until Phase 2 |
| writing_style_notes | text | free text, injected into every generation prompt |
| banned_constructions | text[] | seeded with em dashes. See Answer generation |
| onboarding_completed_at | timestamptz | |

### `companies`
| column | type | notes |
|---|---|---|
| user_id | uuid | |
| name | text | |
| slug | text | unique per user |
| domains | text[] | `["ramp.com","ramp.co"]`, used for email linking |
| ats_type | enum | `greenhouse`, `lever`, `ashby`, `workday`, `icims`, `smartrecruiters`, `workable`, `taleo`, `rippling`, `wellfound`, `other`, `unknown` |
| ats_board_token | text | the board slug, so JD and question fetching works for later roles at the same company |
| careers_url, website, linkedin_url | text | |
| logo_url | text | favicon fallback |
| industry, stage, headcount_band, hq_location | text | all nullable, all free text. Do not build a taxonomy |
| priority | enum | `target`, `interested`, `backup`, `passed` |
| research | text | markdown. The one long-form field, for what you know about the place |
| status | enum | derived: `no_activity`, `active`, `closed_out` |

`domains` is what lets a message from a recruiter's personal work address find its company. Populate it from the careers URL on create and let it be edited.

### `roles`
| column | type | notes |
|---|---|---|
| user_id, company_id | uuid | |
| title | text | |
| jd_url | text | |
| jd_text | text | full posting text, stored. This is the one large text field worth keeping |
| jd_fetched_at | timestamptz | null when pasted by hand |
| jd_hash | text | sha1 of normalized `jd_text`, dedupes reposts |
| ats_job_id | text | for refetching questions and detecting closure |
| seniority | text | free text, from the posting |
| location, work_mode | text, enum | `onsite`, `hybrid`, `remote` |
| comp_min_cents, comp_max_cents, comp_source | int, enum | `posted`, `recruiter`, `estimate` |
| posting_status | enum | `open`, `closed`, `unknown`. A closed posting with a live application is normal |
| source | enum | `portal`, `linkedin`, `referral`, `recruiter_inbound`, `job_board`, `direct_outreach`, `other` |
| first_seen_at | timestamptz | |

`jd_text` is deliberately retained in full, unlike email bodies. It is public information you fetched from a public page, it is the input to requirement extraction and every draft you generate, and refetching it later often fails because the posting is gone. This distinction should be stated in the privacy copy so it does not read as inconsistent.

### `applications`
| column | type | notes |
|---|---|---|
| user_id, role_id | uuid | |
| attempt | int | default 1, incremented for a second pursuit of the same role |
| status | enum | **derived, not hand-written.** See the state machine |
| status_manual_override | enum | nullable. When set, wins over derivation. Cleared by any new linked event |
| submitted_at | timestamptz | |
| source | enum | copied from role at creation, editable. Drives the by-channel funnel |
| referral_contact_id | uuid | nullable |
| resume_version_id | uuid | |
| cover_letter_id | uuid | nullable |
| created_by | enum | `manual`, `email_inferred`. See linking |
| confirmation_received_at | timestamptz | from the auto-ack email |
| first_human_response_at | timestamptz | the single most diagnostic timestamp in the app |
| closed_at | timestamptz | |
| outcome | enum | nullable: `rejected`, `withdrawn`, `ghosted`, `offer_declined`, `offer_accepted`, `role_closed` |
| rejection_stage | enum | nullable: `pre_screen`, `resume_review`, `recruiter_screen`, `hiring_manager`, `technical`, `onsite`, `final`, `offer_stage`, `unknown` |
| excitement | int | 1 to 5, your own rating. Sorts the pipeline by what you actually want |
| next_action, next_action_due | text, date | |

Unique on `(role_id, attempt)`.

**`rejection_stage` is the highest-value column in the schema.** Rejection at resume review and rejection after a final round are opposite diagnoses that lead to opposite responses, and without this field every rejection looks the same in aggregate. Infer it from the status at the moment the rejection email lands, and let it be corrected by hand.

### `application_events`
The timeline. Append only. Every status change, every linked email, every manual note that moves the process.

| column | type | notes |
|---|---|---|
| user_id, application_id | uuid | |
| kind | enum | `submitted`, `confirmation`, `recruiter_reply`, `screen_scheduled`, `assessment_sent`, `assessment_submitted`, `interview_scheduled`, `interview_completed`, `offer`, `rejection`, `withdrawal`, `follow_up_sent`, `note` |
| occurred_at | timestamptz | |
| source | enum | `email`, `manual`, `system` |
| ingested_message_id | uuid | nullable |
| summary | text | one line, generated for email events |
| payload | jsonb | extracted structured detail, schema per kind |

Status is derived from this table. Nothing writes `applications.status` directly except the one function that reads these events.

### `interviews`
| column | type | notes |
|---|---|---|
| user_id, application_id | uuid | |
| round | int | |
| kind | enum | `recruiter_screen`, `hiring_manager`, `technical`, `case`, `panel`, `onsite`, `final`, `informal` |
| scheduled_at, duration_minutes | timestamptz, int | |
| format | enum | `phone`, `video`, `onsite` |
| status | enum | `scheduled`, `completed`, `cancelled`, `rescheduled` |
| prep_notes | text | written before |
| debrief | text | written after. Prompt for it the same evening |
| went_well, went_poorly | text | separate fields, because one blob gets written as a paragraph and never reread |
| questions_asked | text[] | feeds the question bank |

`interview_participants` joins interviews to contacts, with a `role` field (`interviewer`, `coordinator`, `observer`).

### `contacts`
People at companies, or people generally.

| column | type | notes |
|---|---|---|
| user_id | uuid | |
| company_id | uuid | nullable, since some people are not attached to a target |
| full_name, title | text | |
| linkedin_url, email | text | |
| relationship | enum | `cold`, `alum`, `second_degree`, `former_colleague`, `friend`, `recruiter`, `interviewer` |
| how_we_connect | text | the specific tie, if any |
| status | enum | `to_contact`, `contacted`, `responded`, `met`, `dormant` |
| notes | text | |

**Store the minimum about other people.** Name, title, public professional URL, work email. No personal phone numbers, no personal addresses, nothing scraped. This is other people's data sitting in your database, it has no product value beyond contacting them, and it is the part of this app most worth being careful with.

### `contact_touches`
The outreach log, and the reason it exists: response rate by message type is knowable only if you record the sends.

`contact_id`, `application_id` nullable, `channel` (`linkedin_dm`, `linkedin_connect`, `email`, `intro`, `event`, `other`), `direction` (`outbound`, `inbound`), `sent_at`, `message` text, `responded_at` nullable, `response_summary`.

### `notes`
One table, attachable to anything, with integrity preserved.

`user_id`, `body` text, `pinned` bool, plus nullable `company_id`, `role_id`, `application_id`, `contact_id`, `interview_id`, and a check constraint asserting exactly one of them is set:

```sql
check (num_nonnulls(company_id, role_id, application_id, contact_id, interview_id) = 1)
```

A polymorphic `entity_type` plus `entity_id` pair is the obvious alternative and it is worse: no foreign keys, no cascade on delete, and RLS policies that cannot express the parent check. Five nullable columns and one constraint costs nothing and keeps the database able to enforce its own invariants.

### `attachments`
`user_id`, same five nullable parent columns and the same check, plus `storage_path`, `filename`, `mime_type`, `size_bytes`. Supabase Storage. For JD PDFs, take-home prompts, offer letters.

### `resume_versions`
`user_id`, `label` (your existing lettering scheme works), `storage_path`, `text_content` extracted for grounding, `is_default` bool, `notes`. Applications reference one. This is how you find out which version correlates with getting past resume review.

### `evidence_items`
The bank the writing layer draws on. Populated once, edited occasionally, used constantly.

| column | type | notes |
|---|---|---|
| user_id | uuid | |
| title | text | short handle, "rebuilt the close process" |
| body | text | the full story, in your own words, STAR-ish but not forced |
| context | text | where and when it happened |
| skills | text[] | tags: `financial_modeling`, `stakeholder_management`, `automation` |
| metrics | text | the quantified outcome, if there is one |
| strength | int | 1 to 5, how strong the story actually is |
| used_count | int | incremented on use, so drafts can rotate rather than repeat |

**Seed this before building the generation feature.** Twenty to thirty entries. The quality ceiling of every draft the app produces is set here, and no prompt engineering compensates for an empty bank.

### `questions`
The question bank. Deduped across applications by fingerprint.

| column | type | notes |
|---|---|---|
| user_id | uuid | |
| text | text | as asked, first time seen |
| fingerprint | text | see below |
| kind | enum | `motivation`, `fit`, `behavioral`, `technical`, `logistics`, `demographic`, `other` |
| canonical_answer | text | your approved reusable version |
| canonical_answer_updated_at | timestamptz | |
| times_seen | int | |

```
normalize(q) = lowercase, strip punctuation, collapse whitespace,
               remove ["please","briefly","in your own words","tell us",
                       "describe","approximately","words or less"]
fingerprint  = sha1(normalize(q))
```

Exact fingerprint matching catches boilerplate. It will not catch "Why do you want to work here?" versus "What draws you to our mission?", which is why the lookup runs fingerprint first and then falls back to embedding similarity over `questions.text`, threshold around 0.85, surfacing near matches as suggestions rather than auto-filling.

### `application_answers`
The per-application instance. `application_id`, `question_id`, `answer` text, `status` (`draft`, `approved`, `submitted`), `generated_from_question_id` nullable, `word_limit` int nullable, `evidence_item_ids` uuid[].

That last column is the grounding record. See Answer generation.

### `cover_letters`
`user_id`, `application_id`, `body`, `status`, `evidence_item_ids` uuid[], `public_slug` text nullable, `public_expires_at`. The slug supports the shareable version in Phase 2.

### `email_accounts`, `ingested_messages`, `sync_jobs`
Lifted from Shopping Manager unchanged except the classification enum. `ingested_messages` gains `resulting_application_id`, `link_confidence numeric`, and `link_method text`.

The subject retention rule carries over and matters more here: when classification is `not_relevant`, store only `provider_message_id`, `received_at`, and the classification. Null the subject and sender. That row exists solely to skip the message on the next sync.

### `reminders`
`user_id`, nullable `application_id` / `contact_id`, `kind` (`follow_up`, `prep`, `thank_you`, `deadline`, `custom`), `due_at`, `completed_at`, `body`. Generated by rules and creatable by hand.

---

## Status and how the funnel is calculated

The analog of Shopping Manager's money module. Every number in the app comes from here. Define it once, implement it once in `lib/pipeline.ts`, test it against a fixture.

### The state machine

```
lead ──> drafting ──> submitted ──> acknowledged ──> in_process ──> final_round ──> offer
  │          │             │              │               │              │            │
  └──────────┴─────────────┴──────────────┴───────────────┴──────────────┴────────────┘
                                    │
                         rejected / withdrawn / ghosted / role_closed
```

- `lead`: role saved, not applied.
- `drafting`: you are working on it. Distinguishing this from `lead` is what makes the pipeline board useful on a Monday morning.
- `submitted`: sent, no confirmation yet.
- `acknowledged`: an automated confirmation arrived. Not progress, but it proves the application landed somewhere real.
- `in_process`: any human response or scheduled conversation.
- `final_round`, `offer`: self-explanatory.
- Terminal: `rejected`, `withdrawn`, `ghosted`, `role_closed`.

**Rules that are easy to get wrong and should be written down:**

1. **Status is derived from `application_events`, never written directly.** One function owns it. This is the same discipline as derived order status in Shopping Manager and it exists for the same reason: two code paths writing a status field always disagree eventually.

2. **`ghosted` is derived, never set by hand.** An application is ghosted when its last event is older than a threshold (default 30 days, configurable) and it has no terminal outcome. It is a view over the data, not a state you enter. The moment you make it manual, nobody maintains it, and the funnel silently treats abandoned pursuits as live ones.

3. **Backward transitions require an explicit reopen.** A `rejected` application does not return to `in_process` because a stray email arrived. If a linked event would move status backward, write the event, leave the status, and flag it for review. Recruiters do send follow-ups after rejections and mailing lists do reactivate, and silently un-rejecting things is how the pipeline board becomes untrustworthy.

4. **`first_human_response_at` excludes automated mail.** The confirmation from `no-reply@greenhouse.io` is not a human response. Classification must distinguish `confirmation` from `recruiter_reply`, and this timestamp reads only the latter. Conflating them makes the response rate look four times better than it is, which defeats the purpose of measuring it.

### Metrics, defined

```
applications_sent(period)   = count(applications where submitted_at in period)
confirmation_rate(period)   = count(confirmation_received_at not null) / applications_sent
response_rate(period)       = count(first_human_response_at not null) / applications_sent
screen_rate(period)         = count(reached in_process or later) / applications_sent
advance_rate(stage)         = count(reached stage+1) / count(reached stage)
ghost_rate(period)          = count(outcome = 'ghosted') / applications_sent
median_days_to_response     = median(first_human_response_at - submitted_at)
```

**Cohort by submission date, not by outcome date.** Applications sent in June are the June cohort forever, and their response rate updates as responses arrive. The alternative, counting responses in the month they land, produces a number that moves for reasons unrelated to what you did that month.

**Exclude cohorts younger than the response window from rate calculations, or label them clearly.** Last week's applications have not had time to respond, and including them drags every rate toward zero and makes recent effort look like failure. Show them separately as "too early to tell."

**Every rate is also computed grouped by `source`.** The whole diagnostic value is in the comparison between channels, and a single blended number hides it.

**Test this.** One fixture: twelve applications across three sources and three months, with a mix of confirmations, one automated follow-up that must not count as a human response, one rejection after a final round, one application that goes quiet and crosses the ghost threshold mid-fixture, and one re-application to a role already rejected once. Assert every metric above against hand-computed values. This single test protects every number the product is judged on.

---

## Email ingestion and linking

The hardest part of the project, as it was last time, but hard in a different place. Extraction is easier here. Linking is much harder.

### Why the Shopping Manager approach does not transfer directly

In the commerce app, sender domain identifies the merchant, and that single fact carries the whole Tier A classifier. **Here it does not.** Recruiting mail overwhelmingly arrives from ATS infrastructure domains, so a message from `no-reply@greenhouse.io` tells you the ATS and nothing about the company. The company name lives in the subject line, the body, the reply-to, or a per-customer subdomain, and which one varies by vendor and by configuration.

Three consequences:

- Tier A splits into two questions. Which ATS sent this, which is deterministic and easy. Which company and role does it concern, which is not.
- The `reply-to` header is more informative than `from` and must be captured.
- Thread continuity becomes the strongest linking signal available, because it is exact.

### The ATS sender table

Seed this. It is the cheapest accuracy in the project.

| ATS | Sender domains |
|---|---|
| Greenhouse | `greenhouse.io`, `us.greenhouse-mail.io`, `my.greenhouse.io` |
| Lever | `hire.lever.co`, `lever.co` |
| Ashby | `ashbyhq.com` |
| Workday | `myworkday.com`, `myworkdayjobs.com` |
| iCIMS | `icims.com` |
| SmartRecruiters | `smartrecruiters.com` |
| Workable | `workable.com`, `workablemail.com` |
| Taleo / Oracle | `taleo.net`, `oraclecloud.com` |
| Jobvite | `jobvite.com` |
| BambooHR | `bamboohr.com` |
| Breezy | `breezy.hr` |
| Rippling | `rippling.com` |
| Wellfound | `wellfound.com`, `angel.co` |
| LinkedIn | `linkedin.com` (Easy Apply confirmations) |
| Indeed | `indeed.com` |
| Scheduling | `calendly.com`, `goodtime.io`, `modernloop.com`, `prelude.co`, `hi.rippling.com` |

Scheduling tools are listed because an interview invite frequently arrives from the scheduler rather than the ATS, and treating those as unknown senders loses the most time-sensitive class of message in the app.

### Pipeline

**Stage 0, connect.** Identical to Shopping Manager. `gmail.readonly`, encrypted refresh token, provider interface.

**Stage 1, candidate search.** Server-side narrowing via the Gmail `q` parameter:

```
newer_than:180d AND (
  from:(greenhouse.io OR lever.co OR ashbyhq.com OR myworkday.com OR icims.com
    OR smartrecruiters.com OR workable.com OR taleo.net OR jobvite.com
    OR breezy.hr OR rippling.com OR wellfound.com OR calendly.com)
  OR subject:("your application" OR "application received" OR "thank you for applying"
    OR "application to" OR "we received your application" OR "interview"
    OR "next steps" OR "your candidacy" OR "moving forward" OR "the role"
    OR "opportunity at" OR "recruiter" OR "phone screen" OR "take-home")
)
```

Do not exclude `category:promotions`, for the same reason as last time: legitimate mail lands there and a missed rejection is invisible.

**A second query is required for direct outreach**, which is the class this app most wants to catch and the class keyword search handles worst. Recruiter emails from a company address with a subject like "quick question" match nothing above. Two mitigations, both cheap: include `newer_than:180d AND from:(<every domain in companies.domains>)` as a second query, refreshed as companies are added, and let the review queue accept a manually forwarded message. Accept that coverage here is partial and say so in the UI rather than implying it is complete.

**Stage 2, classify.** Two tiers, cheap first.

- Tier A resolves the ATS from the sender domain and, when the vendor puts it there reliably, the company from a subject pattern. Free, and it correctly labels most of the automated volume.
- Tier B sends subject, sender, reply-to, and the first ~2000 characters of plaintext body to a small model and returns a label plus extracted company name, role title, and any dates mentioned.

Classification enum: `application_confirmation`, `rejection`, `recruiter_outreach`, `recruiter_reply`, `interview_invite`, `scheduling`, `assessment`, `offer`, `networking`, `job_alert`, `not_relevant`.

**`job_alert` is its own label on purpose.** Job boards generate enormous volume that matches every keyword above and means nothing. Labeling it explicitly keeps it out of the review queue instead of drowning it.

**Rejections deserve specific prompt attention.** They are the most consequential classification and the most euphemistic text in the corpus. "We have decided to move forward with other candidates," "we are pausing the search," "we will keep your resume on file," and "we have filled the position" are all rejections and none of them contain the word. Build the fixture set for this class first and make it the largest.

**Stage 3, extract.** Structured output against a Zod schema: company name, role title, ATS job id if present, event kind, any dates or times mentioned with timezone, interviewer names, and whether a candidate action is required.

**Stage 4, link.** The hard part. Score candidate applications and pick a winner.

Signals, in descending precision:

1. **Thread id already linked.** Exact. If any message in this thread is linked to an application, this one is too, full stop. Cheap and correct, and it should be checked before anything else.
2. **ATS job id in the body or a URL** matching `roles.ats_job_id`. Exact.
3. **Sender or reply-to domain** in `companies.domains`. Strong, narrows to a company.
4. **Company name string match** against `companies.name` and aliases, normalized. Strong.
5. **Role title similarity** against roles at the matched company, trigram over normalized titles. Disambiguates when there are several.
6. **Date plausibility.** The message must postdate `submitted_at`. This is a filter, not a score: a message predating submission cannot belong to that application.
7. **Recency.** When two attempts at the same role are both plausible, the more recent open one wins.

Combine into a confidence score. Then:

- **≥ 0.85 with exactly one candidate: auto-link.** Write the event, update status through the derivation function.
- **0.5 to 0.85, or a tie: review queue,** showing the top candidates with a one-click link.
- **< 0.5 with a recognizable company: create a `lead`,** not an application. Inbound recruiter mail about a role you never applied to is genuinely new information and should land in the pipeline as a lead with the company pre-filled.
- **No company resolvable: hold in review** with the subject line for context.

**Never auto-create an application from an ambiguous match.** A wrongly created duplicate corrupts the funnel silently, and a funnel you do not trust is a funnel you stop opening. Missing a link is recoverable in ten seconds from the review queue. This is the linking analog of the arithmetic gate in the commerce app: when in doubt, hold rather than write.

**One exception, and it is the feature that makes the app worth building.** An `application_confirmation` from a known ATS, naming a company that exists in your database, dated within the last few days, with no matching application, creates one with `created_by = 'email_inferred'` and `needs_review = true`. This is the case where you applied through a portal and never logged it, which is most of the time. It appears in the pipeline immediately and asks you to confirm the details rather than asking you to remember the application existed.

**Stage 5, retain nothing.** Structured result and the `ingested_messages` row only. No bodies, anywhere, including logs and provider-side retention.

### The verification gate

Because there is no arithmetic check available, the deterministic gates are:

- The referenced company must exist or be creatable from a resolvable domain
- The message must postdate the application's `submitted_at`
- The implied status transition must be legal in the state machine, or the event is written without moving status and flagged
- Any extracted datetime must carry a timezone or be rejected, since an interview time off by three hours is worse than no interview time

Self-reported model confidence is logged, used to sort the review queue worst-first, and never allowed to override any of the above.

### Incremental sync

Gmail `historyId` as cursor, `users.history.list` for deltas, poll every 15 minutes. Same as before. Consider a tighter interval only for accounts with an interview scheduled in the next 48 hours, since scheduling mail is the one class where 15 minutes of latency has a real cost.

### Testing

A fixtures directory of real recruiting emails, bodies as `.txt`, expected JSON beside each. Weight the set toward rejections and toward direct recruiter outreach, since those are the two classes where errors cost the most. Twenty-five fixtures across at least eight ATS vendors will catch nearly every regression. Your own inbox from the last year is the corpus, and it is better material than anything you could synthesize.

---

## Job description and application question ingestion

You asked to paste a link and have the app know both what the job is and what questions the application asks. Those are two different problems with very different success rates, and the plan should be honest about which is which.

### Fetching the job description

Tiered, best first, always with a manual fallback.

**Tier 1, known ATS public APIs.** No authentication, clean JSON, high reliability.

- Greenhouse: `https://boards-api.greenhouse.io/v1/boards/{board_token}/jobs/{job_id}` returns the posting.
- Lever: `https://api.lever.co/v0/postings/{company}?mode=json` returns published postings.
- Ashby: `https://api.ashbyhq.com/posting-api/job-board/{board_name}` returns published postings, with `includeCompensation=true` for pay data.
- Workable, Recruitee, and Personio expose similar public feeds if you meet them.

Detect the vendor from the URL, extract the board token and job id, call the API. Store `ats_board_token` on the company so later roles at the same company skip detection.

**Tier 2, generic fetch.** Fetch the page, strip HTML, run a readability extraction, then look for `schema.org/JobPosting` JSON-LD, which many career pages emit and which gives you title, location, employment type, and description as structured data for free.

**Tier 3, paste.** A textarea. Always available, never removed, and the fallback whenever the tiers above fail.

**What will not work, stated plainly so nobody spends a day on it.** LinkedIn job pages block automated fetching. Workday, Taleo, and iCIMS render through session-bound JavaScript and are hostile to fetching. For those, Tier 3 is the answer, and pasting a JD takes about eight seconds.

### Fetching the application questions

Lower success rate, because the questions live behind the Apply button rather than on the posting page.

**Greenhouse is the good case and it genuinely works.** Adding `?questions=true` to the job endpoint returns the full list of application form fields, typed, with required flags, which is exactly what you want. Lever and Ashby expose form structure through their public surfaces to varying degrees; verify each against current documentation before building, and treat what you find as a bonus rather than the plan. Workday and iCIMS will not give you this without a session.

**So the general solution is a bookmarklet, and it should be in the MVP.**

Forty lines of JavaScript. You are already logged in and looking at the application form. The bookmarklet walks the DOM, collects every `label`, `legend`, and `aria-label` paired with its input, filters out obvious non-questions (name, email, resume upload, EEO blocks), and POSTs the list to your app with the page URL. The app matches the URL to a role and creates `application_answers` rows for anything new.

This works on every ATS, including the hostile ones, because it runs in your browser inside your session. It requires one click at the moment you are already on the page. A browser extension in Phase 2 does the same thing with better ergonomics and a save-this-role button, but the bookmarklet gets you the capability in an afternoon.

**And the paste box stays.** Paste a block of questions, one per line or numbered, and the app splits and fingerprints them. This is the path that always works and it should be given equal visual weight rather than buried as a fallback.

---

## Answer generation and the evidence bank

The writing layer. The design principle is that it never invents anything about you.

### Grounding is the gate

Every generated answer is produced from, and cites, specific `evidence_items`. The generation call receives the question, the JD text, your style notes, your banned constructions, your canonical answer if one exists, and the top evidence items retrieved by embedding similarity against the question and the JD requirements.

The output schema requires, alongside the answer text, an array of the evidence item ids the answer draws on, and a list of any factual claims not supported by a retrieved item. That second array is the gate. If it is non-empty, the answer is shown with those claims highlighted and a warning, rather than presented as ready.

This is the analog of the reconciliation check in Shopping Manager. It is not perfect, since a model asked to self-report unsupported claims will miss some. It is still the difference between a tool that drafts from your material and a tool that writes confident sentences about a person who does not exist. Cover letters that overstate are worse than no cover letter, because you have to catch every one before sending and eventually you will not.

### Requirement mapping

For any role with `jd_text`, extract the requirements as a list. For each, retrieve your best-matching evidence and score the match: strong, partial, or gap. Render as a table.

This is useful three separate ways from one extraction. It tells you before applying whether you are a plausible fit or wasting an hour. It gives every generated answer its skeleton. And it makes the gaps explicit, which is what you address directly rather than hoping goes unnoticed.

Store the extraction on the role so it is computed once.

### Voice

Two mechanisms, both boring and both effective.

`profiles.writing_style_notes` is free text injected into every generation prompt. Write it once by describing how you want to sound, and revise it whenever a draft comes back wrong.

`profiles.banned_constructions` is a hard post-processing check, seeded with em dashes. Generated text is scanned before display and violations are stripped or flagged. A prompt instruction alone is not reliable enough for something you will notice in every single draft, and a deterministic check costs nothing.

Add to the seed list whatever else you find yourself deleting: "I'm excited to," "passionate about," "leverage," "deep dive," "at the intersection of." One list, edited over time, applied everywhere.

### The reuse loop

This is what compounds and it is the reason the question bank exists.

1. A question arrives, by API, bookmarklet, or paste.
2. Fingerprint lookup. Exact hit, offer the canonical answer. Near hit by embedding, offer it as a starting point and say which question it came from.
3. No hit, generate from evidence.
4. You edit. The edited version is saved as the application answer.
5. When you approve an answer for a question with no canonical version, offer to promote it: "make this your default answer for this question?"

After twenty applications the common questions are answered and the work per application drops to tailoring. That is the whole point, and it is why answers are stored at two levels rather than one.

### Cover letters

Same machinery, longer output, plus a structure derived from the requirement map: the two or three strongest matches become the body paragraphs. Store per application. Track which resume version accompanied it.

---

## Features

### Phase 1, MVP

**Auth and onboarding.** Sign up, then a separate step to connect Gmail with the explanation screen. Skippable. Then a short setup: target titles, search start date, upload a resume, and add three to five companies so linking has something to match against on the first backfill.

**Pipeline board.** Kanban by status, cards showing company, title, days since last activity, next action, excitement. Drag to change status, which writes a manual override event. Filters in the left rail: source, priority, excitement, stale-only.

**Roles table.** The same data as a sortable table, because a board is bad above about forty items and you will pass forty items. Columns are configurable, sorted by last activity by default.

**Role detail.** JD, requirement map, application status and timeline, answers, cover letter, interviews, notes, attachments, linked emails. The page you actually live in.

**Company detail.** Research notes, all roles at that company across time, contacts, all touches, all linked email. The reason companies are a separate entity is that this page stays valuable after a specific role closes.

**Contacts and outreach.** List, detail, touch log with response tracking. Message drafting for outreach is Phase 2, but recording sends is MVP, because the response rate is only computable if the sends are recorded from the start.

**Interviews.** Scheduled and past. Prep notes before, debrief after. A prompt to write the debrief that evening while it is fresh, since a debrief written three days later is worth very little.

**Email ingestion and the review queue.** Everything above. The review queue is not optional polish. It is what keeps the pipeline trustworthy.

**Question and answer capture.** Bookmarklet, paste box, and Greenhouse API where available. Question bank with canonical answers. Generation is Phase 2, but capture and manual answering are MVP, so the bank has content by the time generation exists.

**Analytics.** The metrics from `lib/pipeline.ts`. Funnel by stage, everything grouped by source, time to first response, rejection stage distribution, activity over time. One page, no configuration.

**Settings.** Profile, timezone, style notes, banned constructions, connected accounts, ghost threshold, resume versions, evidence bank editor, delete all data.

### Phase 2, the writing layer

- Answer generation with evidence grounding and the unsupported-claim gate
- Cover letter generation
- Requirement mapping rendered on the role page
- Canonical answer promotion flow
- Outreach message drafting from company research plus contact context
- **The shareable application page.** A public URL per application, unguessable slug, expiring, rendering the requirement map with your evidence beside each line plus a written statement of interest. Include the link in applications. It is a work sample and a cover letter in one, and it costs nothing once the requirement map exists.
- Follow-up reminders on rules: no response after N days, thank-you note after an interview, deadline approaching
- Browser extension replacing the bookmarklet, with save-this-role

### Phase 3, later

- Google Calendar read, to place interviews automatically. Separate grant, separate consent, real scope creep, worth it only if the app is otherwise load-bearing
- Outlook support behind the existing provider interface
- Interview question bank across companies, so past debriefs surface as prep for the next round
- Resume version performance analysis, once there is enough volume for the comparison to mean anything
- Mobile PWA, primarily for debriefs written on the way out of an interview
- Portfolio mode: a public page of your own projects, linked from the shareable application pages

---

## Architecture

**Stack.** Identical to Shopping Manager. Next.js 15 App Router, TypeScript, Vercel, Supabase with Drizzle, Inngest, Tailwind and shadcn/ui, Recharts, Zod at every boundary, Anthropic SDK behind a thin interface.

Two additions: `pgvector` for embeddings over questions, evidence, and JD requirements, and a readability library for Tier 2 JD extraction.

```
app/
  (auth)/        login, signup, reset, callback
  (app)/pipeline | roles | companies | contacts | interviews | answers | analytics | review | settings
  onboarding/
  api/
    auth/gmail/  authorize + callback
    capture/     bookmarklet POST endpoint
  p/[slug]/      public shareable application page (Phase 2)
middleware.ts
lib/
  db/            schema.ts, migrations, queries
  db/admin.ts    service-role client, importable ONLY from inngest/
  auth/
  email/
    providers/   gmail.ts, outlook.ts
    classify.ts
    extract.ts
    link.ts      the confidence model
    fixtures/
  ats/
    detect.ts    URL -> vendor + board token + job id
    greenhouse.ts, lever.ts, ashby.ts, generic.ts
  jd/
    fetch.ts, requirements.ts
  generate/
    answer.ts, cover-letter.ts, outreach.ts, grounding.ts, style.ts
  pipeline.ts    status derivation + ALL funnel math
  fingerprint.ts question fingerprints
inngest/
  backfill.ts, incremental-sync.ts, reminders.ts, ghost-sweep.ts
public/
  bookmarklet.js
```

**Rules for Cursor**

- Application status is derived from `application_events` by one function in `lib/pipeline.ts`. Nothing else writes it. `ghosted` is derived, never stored as a manual state.
- All funnel math lives in `lib/pipeline.ts`. Never computed inline in a component.
- Linking never auto-creates an application except from a confirmation email matching a known company, and that row is always flagged for review.
- Every generated answer carries the evidence item ids it used. Generation with an empty evidence set is an error, not an empty-context fallback.
- All LLM output parses through a Zod schema before touching the database, and never gates on self-reported confidence alone.
- ATS-specific code lives behind the interface in `lib/ats/`. Nothing outside that directory knows Greenhouse exists.
- Email provider code lives behind `lib/email/providers/`. Nothing outside it imports the Gmail SDK.
- Never trust a `user_id` from a request body. Derive it from the session. This includes the bookmarklet endpoint, which authenticates by session cookie, not by a token in the URL.
- Store other people's data minimally. Name, title, public professional URL, work email. Nothing else.

**Security**

Same requirements as Shopping Manager, and treat them as build requirements rather than later hardening.

- OAuth refresh tokens encrypted at rest
- Never log email bodies, tokens, or generated content. Scrub them from error reporting, which captures request payloads by default
- Subjects and senders retained only for messages that became events
- Provider-side LLM retention disabled where the API allows it
- Delete-all-data revokes the Google token, cascades every row, deletes storage objects, removes the `auth.users` record
- Public shareable pages use unguessable slugs, carry `noindex`, and expire by default at 90 days
- RLS on every table, proven by the isolation test

---

## UI / UX

Same design language as Shopping Manager so the two feel like a set, with one deliberate difference so they are never confused at a glance.

**Color.** Same neutral base: background `#FAFAF8`, surface `#FFFFFF`, border `#E8E6E1`, text `#1A1A18` and `#6B6B66`. **Change the primary from the `#6A82FB` blue to a deeper indigo or teal**, and keep orange for deadlines and pink for nothing here. Status colors carry real meaning on this board, so fix them early and use them nowhere else: gray for lead and drafting, blue for submitted and acknowledged, amber for in process, purple for final round, green for offer, muted red for rejected, faded gray for ghosted.

**Layout.** Same shell. Product name top left, avatar top right, horizontal nav across the top: Pipeline, Roles, Companies, Contacts, Answers, Analytics, Review. Left rail for contextual filters. Max width around 1400px, and let the roles table go wider.

**Density.** Higher than Shopping Manager. That app was browsing a small number of pretty objects. This one is scanning forty rows for what needs attention today. Smaller type in tables, tighter rows, tabular figures everywhere.

**Buttons and motion.** Same as before: 150ms ease-out, subtle card lift on hover, 0.98 press scale, skeletons rather than spinners, `prefers-reduced-motion` respected. Drag on the kanban board needs to feel good, since it is the most-used interaction in the app.

**Typography.** Inter at 14px base, tabular figures in every table and metric.

**Empty states.** Every section starts empty. Each should say what fills it and offer the action. The pipeline's empty state should offer both "add a role" and "connect Gmail and let it find them."

**One screen worth designing carefully:** the review queue. It is the app's maintenance cost, and how fast a linking decision can be made determines whether you keep using it. Target: subject line, extracted summary, top three candidate applications with the match reason shown, one click each, keyboard navigable.

---

## MVP acceptance criteria

Done means all of these are true.

1. A user can sign up and separately connect a Gmail account.
2. **Two users cannot see each other's data in any table, proven by an automated test looping over every table.**
3. A refresh token still works on day 30 without reauthorization, confirming production publishing status.
4. Backfill imports 180 days of recruiting mail with visible progress and does not time out.
5. Emails from at least eight ATS vendors classify correctly against the fixtures suite.
6. Rejection recall is measured on a real inbox and is at least 90%, with euphemistic phrasings represented in the fixtures.
7. An application created manually from a pasted JD is auto-linked by a later email from that company with no manual step.
8. A confirmation email for an application that was never logged creates one, flagged for review, correctly attributed to its company.
9. No email ever auto-creates a duplicate application for a role that already has an open one.
10. A rejection email sets status, `closed_at`, `outcome`, and infers `rejection_stage` from the status it was in.
11. An email arriving after a rejection does not silently reopen the application.
12. `first_human_response_at` is not set by automated confirmations, verified by fixture.
13. **The funnel fixture passes:** twelve applications, three sources, three months, including an automated follow-up, a ghost crossing the threshold mid-fixture, and a re-application, with every metric matching hand-computed values.
14. Ghosted status is derived and updates without any manual action.
15. A Greenhouse job URL produces both the JD and the application questions with one paste.
16. A LinkedIn or Workday URL fails gracefully to the paste box, with a message explaining why.
17. The bookmarklet captures questions from an application form on at least three different ATS vendors.
18. A question seen a second time surfaces its canonical answer.
19. Contacts, notes, and attachments can be attached to a company, a role, an application, a contact, or an interview, and the check constraint rejects anything attached to two.
20. Incremental sync picks up a new email within 15 minutes without duplicating anything.
21. Re-running any sync produces zero duplicate rows or events.
22. Deleting an account leaves zero rows anywhere, including storage objects.
23. A user can use the app fully without ever connecting an inbox.
24. No `not_relevant` message has a stored subject or sender.

---

## What you have to do yourself

Much less than last time, because Tier 0 and Tier 1 are already done for the other project and the accounts carry over.

### Tier 0, before you start. About 10 minutes.

The Supabase, Vercel, Anthropic, and GitHub accounts already exist. What is new:

```
npx supabase projects create application-manager --org-id <yours> --db-password <generated> --region us-east-1
npx supabase link --project-ref <ref>
```

Have the agent do that, along with the Vercel project, environment variables, migrations, and type generation. The only manual step is creating the GitHub repo, and `gh repo create` handles that too.

### Tier 1, before build step 4 (auth). About 15 minutes.

New Google Cloud project, consent screen, one OAuth client for sign-in, client id and secret into the Supabase dashboard. Same steps as before, and you have done them once. Skippable if you ship email/password first.

### Tier 2, before build step 9 (Gmail). About 45 minutes.

Faster than last time because the domain is bought and verified.

1. Point a subdomain at the new Vercel project.
2. Confirm Search Console domain verification covers the subdomain. It should, since verification is domain-wide.
3. Publish homepage, privacy policy, and terms at that subdomain. Have the agent write all three against the actual retention behavior in this document, not a template. **The privacy policy differs meaningfully from the other app's**, because this one retains full job description text and stores information about third parties. Say both things explicitly.
4. Second OAuth client for the Gmail grant. Redirect URI `https://<subdomain>/api/auth/gmail/callback`.
5. Add `gmail.readonly`. It will be marked Restricted.
6. **Set publishing status to In production.**
7. Paste the two Gmail client values into `.env.local` and have the agent push them to Vercel.

### Tier 3, only past 100 users

Brand verification then CASA Tier 2. Not relevant for a personal tool. If this ever goes public it is the same staircase as before, and the escape hatch through an email API aggregator remains available precisely because provider code sits behind an interface.

### Environment variables

Same table as Shopping Manager. New project values throughout. You paste three: `ANTHROPIC_API_KEY`, `GOOGLE_GMAIL_CLIENT_ID`, `GOOGLE_GMAIL_CLIENT_SECRET`.

### Running cost

Effectively zero on free tiers. Supabase free projects pause after a week of inactivity, which is a reason to combine this with the other project on one Pro plan if both become daily tools. LLM cost is lower than the commerce app: fewer messages, and most of the token spend is generation you trigger deliberately rather than bulk classification.

---

## Suggested build order

A phase at a time, in this order. Steps 1 through 5 are mostly porting.

0. **Google Cloud project, by hand.** Consent screen, sign-in client. Gmail client can wait until step 9. Set publishing status to In production the moment the Gmail client exists.
1. Copy the app shell, auth, middleware, design system, and `lib/db/admin.ts` boundary from ShoppingManager. Strip everything commerce.
2. Schema and migrations. All tables, RLS on every one, the `notes` and `attachments` check constraints written by hand.
3. **The cross-user isolation test**, before any feature code.
4. `lib/pipeline.ts`: the state machine, status derivation, all funnel math, and the twelve-application fixture. Pure functions, no database, no UI. Get the numbers right before anything depends on them.
5. Companies, roles, applications CRUD. Manual entry only. Pipeline board and roles table on top of it.
6. Contacts, notes, attachments, interviews. This completes the manual-use version of the app, and at this point it is already usable daily, which matters because you can start entering real data while the rest is built.
7. JD ingestion: ATS detection, the three fetch tiers, requirement extraction.
8. **Email classification and linking as pure functions with the fixtures suite.** No database, no OAuth. Build the fixture corpus from your own inbox first. This is the step that determines whether the product works, and debugging it alongside an OAuth flow is miserable.
9. Gmail OAuth, token encryption, connection management, reauth path.
10. Inngest backfill wiring stages 1 through 5 together, then incremental sync.
11. Review queue.
12. Bookmarklet and the capture endpoint. Question bank with manual answers.
13. Analytics page on top of `lib/pipeline.ts`.
14. Reminders and the ghost sweep job.
15. Account deletion with revocation and full cascade.
16. Evidence bank editor, and seed it with twenty to thirty entries by hand.
17. Phase 2 generation.

Three ordering notes worth respecting. Step 4 before any UI, for the same reason money math came early last time: every screen reads those numbers and they are cheap to test in isolation and expensive to correct once six components compute them inline. Step 6 before step 8, because manual use generates the real pipeline data that linking needs to match against, and testing linking against an empty database proves nothing. Step 16 before step 17, because generation quality is bounded by the evidence bank, and building generation against an empty bank produces a demo that impresses and a tool that does not work.

---

## Open questions

- Backfill window. 180 days is a guess and probably wrong in one direction: an active search generates most of its useful mail in the last 90 days, and going back further mostly imports noise. Consider 90 as the default with an option to extend.
- Whether `applications` genuinely earns its separation from `roles`. It is the right model, but if after a month you have zero rows with `attempt > 1`, collapsing them would simplify a lot of code. Worth revisiting rather than defending.
- The ghost threshold. 30 days is conventional. It varies enormously by company size, and a threshold that adapts to observed response times per company would be better and is not worth building until there is data.
- How to handle a role you find through outreach where no formal application exists. Currently a `lead` that never becomes an application, which makes the funnel denominator ambiguous. Decide whether conversations without applications belong in the same funnel at all.
- Whether recruiter inbound should create a company automatically. It is convenient and it fills the companies table with places you have no interest in. Probably yes, with a `priority = 'passed'` default and easy dismissal.
- Embedding threshold of 0.85 for near-match questions is a guess. Tune against real data and measure false positives, since a wrong canonical answer suggestion is more annoying than a missed one.
- Whether the shareable application page helps or reads as strange. Untested, and it depends heavily on execution quality. Build it, use it on five applications, and decide from the responses rather than from the idea.
- Whether to track comp offered and negotiated. Useful, sensitive, and the answer probably differs between the personal version and any shared version.
- Whether the second Gmail query over `companies.domains` is worth the extra API volume, or whether manual forwarding covers direct outreach adequately. Measure recall on a real inbox before committing.

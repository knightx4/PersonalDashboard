---
name: company-research
description: Prepare research on one company the person wants to work at, the reading they would otherwise do in four or five hours, and write it into job_search.company_research for the Research section on the company's Perspective tab. Read the company's own materials, filings, news, talks and podcasts, job postings, and the person's own mail and notes about it; write a cited write-up with a link on every claim and a list of every page read; suggest answers to the Perspective questions. Use when the goals routine is fired with a brief that starts "Follow .claude/skills/company-research/SKILL.md" and names "Company research <id>", or the user says "research <company>".
---

# Preparing research on a company

The person keeps a short list of companies they most want to work at (marked
Target in Jobs). For each one they write their own view on the company's
Perspective tab: what the company does, why now, the problem they would solve
there, why them, what they do not know yet, and their next move
(`lib/jobs/companies/perspective.ts`). Your job is the reading underneath
that view, the kind of reading they would otherwise spend four or five hours
on, written up so they can check every claim and go to the raw material
themselves.

**You change rows, not code.** Do not commit or push. Do not send email,
post, or contact anyone. Do not delete anything.

In anything the person reads, the assistant is **Dash**. Never write
"Claude" in the write-up.

## How you read and write

Through the **Supabase** connector (`mcp__Supabase__execute_sql`, loaded
with ToolSearch), project `asjztutnqxbecruvyrbj`. Filter every read and every
write by the `user_id` in your brief. You are writing as the service role, so
row level security does not stop you touching another account's rows; the
filter is the only thing that does.

For the web: WebSearch and WebFetch. For YouTube talks and podcasts with a
video: the **Transcript API** connector (`mcp__Transcript_API__*`). For the
person's mail: the **Gmail** connector (`mcp__Gmail__search_threads`,
`get_thread`), read only. For their notes: the **Dash** connector's `recall`
and `vault_notes` when it is there; otherwise `obsidian.notes` through SQL.
Load each with ToolSearch before its first call. A connector that is not
there is a gap to name in the write-up, not a reason to stop.

## 1. Read the brief and the row

The brief comes through the goals routine, Dash's general routine, and is:

```
Follow .claude/skills/company-research/SKILL.md
Company research <research id>
user_id <uuid>
company <name> (<slug>)
first run | refresh of <previous research id>
```

```sql
select r.id, r.status, r.company_id, c.name, c.slug, c.website, c.careers_url,
       c.linkedin_url, c.domains, c.industry, c.stage, c.hq_location, c.research,
       c.ats_type, c.ats_board_token,
       c.perspective_business, c.perspective_why_now, c.perspective_problem,
       c.perspective_why_me, c.perspective_unknowns, c.perspective_next_move
from job_search.company_research r
join job_search.companies c on c.id = r.company_id
where r.id = '<research id>' and r.user_id = '<user_id>';
```

If the row is missing, or its status is `ready` or `failed`, stop: it has
been handled. Otherwise mark it started:

```sql
update job_search.company_research
set status = 'researching', started_at = now()
where id = '<research id>' and user_id = '<user_id>';
```

Then read what the person already has on the company, which tells you what
they care about and what not to repeat:

```sql
-- what they want from a job, newest first
select body, created_at from job_search.thoughts
where user_id = '<user_id>' order by created_at desc limit 5;

-- their roles and applications here
select r.title, r.location, r.jd_text, a.status, a.submitted_at
from job_search.roles r left join job_search.applications a on a.role_id = r.id
where r.company_id = '<company_id>' and r.user_id = '<user_id>';

-- people they know there, and notes
select full_name, title, relationship, how_we_connect from job_search.contacts
where company_id = '<company_id>' and user_id = '<user_id>';
select body, created_at from job_search.notes
where company_id = '<company_id>' and user_id = '<user_id>';

-- their evidence bank, for "why you"
select title, body, context, metrics from job_search.evidence_items
where user_id = '<user_id>' limit 40;
```

Check a column against `job_search` before relying on it; a query that
fails on a column name is fixed and sent again, not abandoned.

On a refresh, read the previous run too (`summary`, `sections`, `sources`,
`finished_at`). Your job then is what changed since it finished: new
funding, people, products, postings, news. Carry forward what still holds,
with its sources, and correct what no longer does.

## 2. Read

Work through every area below. Spend the time: aim for 40 or more pages read
across the areas, and at least 25 sources in the final list. Follow leads.
A podcast that names the new CFO is a reason to search for the CFO.

1. **Their own materials.** Homepage, product and pricing pages, docs,
   customers and case studies, blog and engineering blog, changelog,
   newsroom. The about and leadership pages.
2. **Money.** Funding rounds with dates, amounts, lead investors and
   valuations where reported. Revenue, customer counts or growth figures
   they or reliable press have published. For a public company, or one that
   has filed to list: the latest 10-K or S-1 and recent 10-Qs on SEC EDGAR
   (`https://www.sec.gov/cgi-bin/browse-edgar?company=<name>&type=10-K`),
   and the last earnings call. Say when a figure is an estimate and whose.
3. **Leadership and finance.** Founders and executives, with how long each
   has been there. Who runs finance (CFO, VP Finance, controller), when they
   joined and where from. Board members and investors with board seats.
4. **What they say out loud.** Founder and executive podcasts, conference
   talks, interviews, long posts. Use the Transcript API for YouTube and
   quote the passages that say something about strategy, priorities or how
   they run the company, with the time in the link (`&t=1080s`).
5. **The outside view.** News from the last 12 months, competitors and how
   the company differs from them, analyst or investor write-ups, notable
   criticism, lawsuits, layoffs.
6. **Job postings.** Their open roles, from their board (`ats_type` and
   `ats_board_token` name it: Greenhouse at
   `https://boards.greenhouse.io/<token>`, Lever at
   `https://jobs.lever.co/<token>`, Ashby at
   `https://jobs.ashbyhq.com/<token>`) or `careers_url`. What the finance,
   strategy and operations postings say about what is being built, the
   tools named, and who the roles report to.
7. **The person's own history with them.** Gmail threads from the company's
   domains or naming it (`from:(<domain>) OR "<name>"`), their vault notes,
   and the rows read in step 1. Link a mail thread as
   `https://mail.google.com/mail/u/0/#all/<thread id>`.

Never guess a fact you could not find. If LinkedIn, a review site or a
paywall blocks a page, say what you could not see.

## 3. Write

Write in plain, direct sentences, to `docs/WRITING-GUIDE.md`: no slogans, no
"not X, it's Y", no em dashes for rhythm, no promotional tone. Say who said
what and when. Mark an estimate as one, and name a disagreement between
sources instead of picking one silently.

**Every claim carries an inline markdown link to the page it came from**:
`They raised a $45M Series C led by Index in March 2025
([TechCrunch](https://...)).` A paragraph with no link is a paragraph the
person cannot check, so it does not go in. The links in the text are part of
the write-up; the source list below is every page you read, whether or not
the text quotes it.

**summary** (markdown, 4 to 6 sentences): who they are, where they are now,
and the one or two things most worth knowing for this person's search.

**sections**, in this order, each `{ "key", "title", "body" }`, the body in
markdown with short paragraphs or bullets. Leave a section out only when
nothing was found, and say so in `gaps`.

| key | title |
|---|---|
| `whats_new` | What's new since <date of the previous run> (refresh only, first) |
| `business` | Business and how they make money |
| `customers` | Customers and market |
| `competitors` | Competitors |
| `money` | Funding and financials |
| `leadership` | Leadership and the finance team |
| `recent` | What has changed in the last 12 months |
| `strategy` | Strategy and big bets, in their own words |
| `culture` | How they describe working there |
| `postings` | What their open roles say |
| `risks` | Risks and open questions |
| `questions` | Questions worth asking them |
| `fit` | Where you fit |
| `history` | Your history with them |
| `gaps` | What Dash could not find |

`questions`: 8 to 12 specific questions this research makes worth asking in
an interview or a coffee chat, each tied to something found.
`fit`: where this person's background (the evidence bank and their career
goals) meets the problems the research found, written to them as "you".

**sources**: every page you read, each
`{ "url", "title", "kind", "publisher", "published_on", "note" }`. `kind`
is one of `company`, `filing`, `talk`, `news`, `analysis`, `posting`,
`mail`, `other`. `published_on` is `YYYY-MM-DD` or null. `note` is one line
on what the page is useful for, or a time stamp to jump to, or null.

**drafts**: a suggested answer for each Perspective question, keyed
`business`, `whyNow`, `problem`, `whyMe`, `unknowns`, `nextMove`, written
in the first person as the person would put it, two to four sentences each.
They are offered beside a blank question with a button to use them; the
person's own answers are never overwritten.

## 4. Save

Write the run in one update, the jsonb dollar-quoted so quotes and
apostrophes in the text need no escaping. If the statement is too large for
one call, write `sections` and `summary` first and `sources` and `drafts` in
a second update, and only then set the status.

```sql
select core.dash_before('job_search.company_research:<research id>');
update job_search.company_research
set summary = $t$...$t$,
    sections = $j$[ ... ]$j$::jsonb,
    sources = $j$[ ... ]$j$::jsonb,
    drafts = $j${ ... }$j$::jsonb,
    status = 'ready', finished_at = now(), error = null
where id = '<research id>' and user_id = '<user_id>';
select core.record_dash_action('<user_id>', 'job_search.company_research:<research id>',
  'update', 'company_research',
  $s$Dash prepared research on <company>: <n> sources.$s$);
```

Read it back: the status is `ready`, `jsonb_array_length(sources)` is what
you wrote, and every section has a body.

If the run cannot finish (no sources found for a company that cannot be
identified, a connector failure that leaves nothing), mark it failed with a
sentence the person can act on:

```sql
update job_search.company_research
set status = 'failed', finished_at = now(),
    error = $e$Dash could not tell which company this is: two firms share the name. Add its website on the About tab and start it again.$e$
where id = '<research id>' and user_id = '<user_id>';
```

The page checks every minute while a run is going, so the write-up appears
there once the status is `ready`.

---
name: cover-letter
description: Write a cover letter for a role in the job search, from the person's evidence bank, resume, writing rules and past letters, and put it in the Career/Cover Letters folder in their Google Drive. Also records the letter on the application in job_search.cover_letters, fills in the job description if the role has none, and sets the application's next step. Use when the user says "write a cover letter for X", "the X role needs a cover letter", or asks what else a role needs before they apply.
---

# Writing a cover letter

A letter is only as good as the specific things in it. Everything below exists
so that each paragraph rests on a story the person actually told, matched to a
line of the job description, in their voice.

The first letter written this way was Hebbia's, on 27 September 2026. Its
source text is on the application's `cover_letters` row; read it before
writing a new one to see what the finished thing looks like.

## 1. Find the role

```sql
select r.id role_id, r.title, r.jd_url, r.jd_text is not null has_jd, r.location,
       c.id company_id, c.name, a.id application_id, a.status, a.cover_letter_id,
       a.submitted_at, a.created_at
  from job_search.roles r
  join job_search.companies c on c.id = r.company_id
  left join job_search.applications a on a.role_id = r.id
 where c.name ilike '%<company>%';
```

A company often has more than one role. Pick the open one the person means
(usually the newest `lead`), and note any earlier application to the same
company: its status belongs in your report, not in the letter.

## 2. Gather what the letter can draw on

Read all of these before writing a word.

- **The job description.** `roles.jd_text`, or fetch `jd_url`. Job boards that
  mirror a posting (Index Ventures, Built In) usually show the full text when
  the ATS page itself renders nothing. Keep the requirement and bonus lines; the
  letter is organized around them.
- **The evidence bank.** `select id, title, body, context, metrics, strength,
  used_count from job_search.evidence_items where user_id = '<user>'`. These
  are the person's own stories. Every claim in the letter comes from here, the
  resume, or their notes. Invent nothing, round nothing up, and keep their
  hedges ("roughly $10B", "more than five").
- **The resume.** `job_search.resume_versions.text_content`.
- **The writing rules.** `job_search.profiles.writing_style_notes` and
  `banned_constructions`. As of writing: direct, American spelling, and never
  an em dash, "I am excited to", "passionate about", "leverage", "deep dive" or
  "at the intersection of". Then apply [docs/WRITING-GUIDE.md](../../../docs/WRITING-GUIDE.md).
- **What they want.** The latest rows in `job_search.thoughts`. A closing line
  that uses their real reason for the role reads better than praise for the
  company.
- **Past letters.** The Drive folder Career/Cover Letters, id
  `1_IslF7ZxvkYrYi5L1qnSs-s3Pq64Ewvy`. There is a second, empty folder of the
  same name under another Career folder; do not use it. Read the two or three
  most recent letters with `read_file_content` for voice, the current mailing
  address and the sign-off. The Keystone and Brex letters set the current
  format.
- **Contacts and mail.** `job_search.contacts` for the company, and a Gmail
  search on the company name, for a referral or a conversation worth naming.

## 3. Write it

The format of the recent letters:

1. Date, company name, "Dear Hiring Team:".
2. An opening paragraph: the exact role title, CPA and Yale MBA (May 2026),
   the EY and startup experience in one sentence, what the role asks for in the
   posting's own terms, and "my experience maps to three of the role's core
   requirements."
3. Three bulleted paragraphs, each starting with a bold lead phrase naming a
   requirement, then two or three evidence items that prove it, with their
   numbers.
4. A closing paragraph with the person's real reason for wanting the role,
   then "I would welcome the chance to discuss the role in an interview. Thank
   you for your time and consideration."
5. "Sincerely,", the name, and the contact line.

It must fit on one page: about 540 words in the body at 11pt. Cut the weakest
sentence rather than shrinking the type.

Before rendering, reread the draft against the banned list and the writing
guide's four failure modes. The ones that creep into cover letters are
"not X, but Y" contrasts, praise the company never earned ("innovative",
"cutting-edge"), and a closing that restates the opening.

## 4. Render it

Write the letter as a source file in the scratchpad, in the format
[scripts/cover-letter.ts](../../../scripts/cover-letter.ts) documents, then:

```
npx tsx scripts/cover-letter.ts <scratchpad>/<company>.txt <scratchpad>/out
```

It writes `<Name> Cover Letter - <Company>.html` and `.pdf` and prints the
page count. If it says two pages, cut and run it again. Then read the PDF to
check how it looks.

## 5. Put it in Drive

Upload the HTML as a Google Doc into the Cover Letters folder:

- `create_file` with `parentId` `1_IslF7ZxvkYrYi5L1qnSs-s3Pq64Ewvy`,
  `contentMimeType` `text/html`, `textContent` the HTML file's contents, and
  title `Selvey Knight Cover Letter - <Company>` (the folder's naming).
- Read it back with `read_file_content` to confirm the text landed.

Do not try to upload the .pdf or a .docx through `base64Content`. The file has
to pass through the conversation as a base64 string, long runs of `A` get
miscounted, and the upload arrives corrupted. The Google Doc downloads as
either format from File > Download. Hand the person the PDF with
`SendUserFile` instead.

## 6. Record it in the tracker

In one statement:

- insert a `job_search.cover_letters` row for the application: `body` the
  letter as plain text, `status` `draft`, `evidence_item_ids` the evidence the
  letter used;
- set `applications.cover_letter_id` to it, `resume_version_id` if empty, and
  `next_action` / `next_action_due` to the submission step (where to apply,
  what to attach, a date two days out);
- add one to `used_count` on each evidence item used, so the next letter can
  prefer stories that have not been told yet.

If the role had no job description, write the one you fetched into `jd_text`
with `jd_source = 'manual'`, and fill `work_mode`, the posted pay in
`comp_min_cents` / `comp_max_cents` with `comp_source = 'posted'`, and
`posting_status = 'open'`. Correct the company's `domains`, `website`,
`careers_url` and `ats_type` if they are wrong or missing. `domains` decides
which emails match the company, so a job board's domain there is a bug.

Mark the letter `submitted` only when the person says they sent it.

## 7. Report

Give the person the Drive link, the three requirements the letter argues and
which stories it uses, anything you left out and why, and what is left for them
to do: apply, attach, and anyone worth contacting first. Name any earlier
application to the same company and how it ended.

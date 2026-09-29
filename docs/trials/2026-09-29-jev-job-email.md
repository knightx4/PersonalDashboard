# Trial: Jev against the stored job-email labels

Run 2026-09-29 on production, for plan #1165 under feature #1161. Jev
(`jev-1.13.0`, TypeSafe's classifier) was asked to label 690 job emails from the
plan owner's mailbox that the inbox had already labelled. Every call returned an
answer, and none failed. The run recorded 690 calls, 856,979 input tokens and
$0.036 of spend under `classify-job-email`.

**Recommendation: roll out job-email triage on Jev, with Jev deciding at 0.8
and above and Haiku below. Expect better rejection handling, not savings.** On
the mail Haiku labelled, Jev's confident answers are at least as right as
Haiku's. Jev also caught six rejections that the pipeline had filed as
acknowledgements, which is the most expensive mistake the pipeline can make.
It will save close to nothing: Haiku still has to read every actionable email to
pull out the company, dates and interviewers, and Jev can only give the label.
There are two conditions, both set out under "What the rollout needs" below.
First, reword the `interview_invite` and `scheduling` options and re-check them
before switching. Second, send `recruiter_reply`, `offer` and `other` to Haiku
whatever Jev's confidence.

## How it was run

The job is `inngest/jobs/cron/jev-trial.ts`, behind `/api/cron/jev-trial`. The
ledger never stores an email's body, so the job fetched each body from Gmail
again. It then asked Jev the question in `lib/jobs/email/jev-question.ts`: the
eleven classifications, each with a one-line meaning, plus `other`. Jev saw the
same text Haiku reads: sender, reply-to, subject and the first 6,000 characters
of the body. Tier A was run on the same body, so each answer records whether the
rules or Haiku settled the stored label. Results are in
`job_search.jev_trial_answers`, trial `job-email-2026-09`.

The sample was every message with a job label, every not-relevant message Haiku
had read or the person had dismissed, and 60 other not-relevant messages picked
by a fixed hash. The first test call also sent five messages from a second
account; those rows are left out of every number here.

**The stored label is not ground truth.** It is Tier A's label where the rules
were sure and Haiku's otherwise. The only labels the person set by hand are 11
"not a real pursuit" dismissals, covered below. I did not read the bodies. I
judged the disagreements from the subject, the sender, what the linked
application went on to do, and the one-line summary Haiku wrote when it read the
message (`application_events.summary`).

## Agreement per label

Grouped by the stored label. "Sure" means Jev's confidence was 0.8 or more, so
in the rollout Jev's answer would stand without asking Haiku.

| Stored label | Messages | Jev agrees | Under 0.8 | Sure | Sure and agrees |
| --- | ---: | ---: | ---: | ---: | ---: |
| application_confirmation | 259 | 232 (90%) | 27 | 232 | 223 (96%) |
| rejection | 99 | 93 (94%) | 3 | 96 | 92 (96%) |
| not_relevant | 92 | 56 (61%) | 28 | 64 | 50 (78%) |
| interview_invite | 85 | 33 (39%) | 26 | 59 | 24 (41%) |
| assessment | 55 | 31 (56%) | 32 | 23 | 18 (78%) |
| job_alert | 45 | 43 (96%) | 11 | 34 | 34 (100%) |
| scheduling | 35 | 30 (86%) | 5 | 30 | 26 (87%) |
| recruiter_reply | 12 | 3 (25%) | 5 | 7 | 2 (29%) |
| recruiter_outreach | 8 | 4 (50%) | 3 | 5 | 4 (80%) |
| **All** | **690** | **525 (76%)** | **140 (20%)** | **550** | **473 (86%)** |

Split by who settled the stored label:

| Settled by | Messages | Jev agrees | Sure | Sure and agrees |
| --- | ---: | ---: | ---: | ---: |
| The rules (Tier A was sure) | 536 | 440 (82%) | 465 | 413 (89%) |
| Haiku | 154 | 85 (55%) | 85 | 60 (71%) |

The Haiku row is the comparison that matters for #1166. Tier A's confident
label wins over any model in `reconcileClassification`, so in the rollout Jev
replaces Haiku only where Haiku's label is the one used. The exception is the
rejection override, covered below.

Jev's own labels: it said `other` 6 times and `networking` 3 times, never with
confidence 0.8 or more. It said `offer` once, at 0.98, on a message that is now
stored as not relevant.

## Is Jev as right as Haiku where Haiku decided?

Of Haiku's 154 messages, Jev was sure on 85 and agreed on 60 of those. Here is
the judgement on the other 25:

- **4 Jev right.** These are invitations to book a time: "Axial Interview
  Availability", "Next steps - Triomics" and "ReSpark | Intro chat…" (Haiku's
  summary: "offering three time slots"), plus an Axial calendar invitation.
  Haiku stored `scheduling`. Jev said `interview_invite`, which is what its
  options define an invitation to book as.
- **7 split by the option wording.** These are interview confirmations: four
  from Campfire, and one each from Galaxy, Adonis and Array. Jev said
  `scheduling` and Haiku said `interview_invite`. The meaning Jev was given for
  `scheduling` includes "confirming… the time of an interview already agreed",
  so Jev followed its question. The pipeline's own convention is the other way
  round (see "What the rollout needs").
- **1 Jev wrong.** "Your Event ID for All Jobs at Array US Inc" comes from
  Criteria, an assessment vendor. Haiku said `assessment`, which is correct.
  Jev said `application_confirmation` at 0.84.
- **13 cannot be checked.** All are stored as not relevant and their subjects
  have been scrubbed. Five were dismissed by hand as not a real pursuit. Each of
  the other eight was rewritten hours or days after it was first labelled, which
  fits a dismissal from the review queue, but the ledger cannot say. On these,
  Jev gave a job label: `recruiter_outreach` or `recruiter_reply` on five,
  `scheduling` on two and `offer` on one.

Leave out the 13 that cannot be checked and count the 7 wording splits as
neither right nor wrong. That leaves 65 messages where one label is clearly
right. Jev is right on 64 and Haiku on 61. Jev does not lose to Haiku on job
email.

The 13 are the main risk left. If Haiku had labelled them not relevant, Jev's
confident job labels would have put them into the pipeline. If they are
dismissals, both models called them job mail before the person said otherwise.

## The disagreements, grouped

All 77 disagreements where Jev was sure, across both groups. The full list of
165, including the ones under 0.8, is at the end.

1. **Interview confirmations and reminders labelled `scheduling` (38).** Stored
   as `interview_invite` (32), `application_confirmation` (3: two "Array
   Interview Confirmation" and one "Galaxy In-Person Interview Confirmation")
   or `recruiter_reply` (3). For the three stored as acknowledgements, the
   stored label is plainly wrong. The rest come down to the wording question.
2. **Invitations to book labelled `interview_invite` (5).** The four above,
   plus "Galaxy Interview Availability Request", which was stored as
   `assessment`. Jev is right.
3. **Rejections the pipeline filed as something else (7).** Six were stored as
   `application_confirmation` and Jev said `rejection` at 1.00: two CFGI
   messages, Anthropic, Diageo, Finch and DualEntry. The seventh, Nearwater
   Capital ("Following up your application"), was stored as
   `recruiter_outreach`. For six of the seven, Haiku's own summary says
   rejection: "position has been filled", "Diageo rejected your application…",
   "Application rejection for Finance role at Finch". The seventh, one of the
   CFGI messages, has a summary that only repeats the subject. Six of these
   applications still show as ghosted instead of rejected. **Jev is right on at
   least six.** In the rollout, `reconcileClassification` would turn a Jev
   `rejection` over a Tier A `application_confirmation` into a rejection, so
   the six filed as acknowledgements would have been caught. Nearwater would
   not: the override only covers Tier A's `application_confirmation`.
4. **Tier A rejections Jev reads as acknowledgements (4).** These are Cohere,
   Spotify, Alvarez & Marsal and Kalshi. Haiku's summary calls Cohere and
   Kalshi application confirmations ("…with overview of interview process").
   The Spotify and Alvarez & Marsal summaries only repeat the subject. Jev is
   probably right on two, and two are undetermined. In the rollout, Tier A's
   rejection still stands on all four. **Separate from this feature, Tier A
   looks to be marking some acknowledgements as rejections, and these
   applications show as rejected.**
5. **Other acknowledgements (4).** "Thank you for applying to MrBeast", stored
   as `assessment`, and "Thank you for your interest in Galvanize", stored as
   `interview_invite`. Haiku's summaries call both application confirmations,
   so Jev is right. Canonical's acknowledgement, stored as `assessment`, is
   undetermined: that application logged five assessment emails, so the
   acknowledgement may well have carried the written test. The Criteria "Event
   ID" message is the one Jev got wrong.
6. **One-offs (5).** "Canonical written Interview reminder" (Jev: `assessment`,
   fair for a written test) and four undetermined:
   - "Re: Array - Next Steps!" (Jev: `recruiter_reply`);
   - "Re: Campfire - Next steps | … Case study" (Jev: `recruiter_reply`);
   - "Re: Owning a new product line at Trayd" (Jev: `recruiter_outreach`);
   - "Re: Justworks | Update regarding your application", from a gmail.com
     address (Jev: `rejection` at 0.83).
7. **Scrubbed not-relevant mail (14).** The 13 above, plus one message Tier A
   dropped on its envelope that no model ever read. Jev said `assessment` on it
   at 0.90, but in the rollout Jev would never see it.

Across all 77: Jev is right on 19 where the stored label is wrong, the wording
splits 35, Jev is wrong on 1, 8 are undetermined, and 14 cannot be checked.

## The 11 hand dismissals

Every one of the 11 messages the person dismissed as "not a real pursuit" got a
job label from Jev, 5 of them with confidence 0.8 or more. The summary scores
the stored label 11 of 11 and Jev 0 of 11, but that is an artifact: the
dismissal overwrote the label with `not_relevant`. Each of those messages had
created a pursuit, so the automatic label (Tier A's or Haiku's) was also a job
label before the person stepped in. The dismissals tell the two models apart on
nothing. What they show is that neither model can tell a real application email
the person does not want tracked from one they do. That is the person's
judgement, not the email's kind.

## What it saves

Almost nothing. Haiku read 557 of this account's messages (those with a stored
confidence). 525 of them ended with an actionable label, and Haiku must still
read those to extract the company, role, dates and interviewers, which Jev does
not return. Only the 32 that ended as not relevant (6%) could skip Haiku, and
only when Jev is sure. `classify-job-email` has recorded 352 Haiku calls since
24 September, costing $0.832 (about $0.0024 each). A 6% cut of that is well
under a dollar a month at the feature's $8 estimate. Jev's own calls, about
$0.00005 each, take back part of that. Speed does not improve either, because
the Haiku call still runs on every actionable email. Jev's speed was not
measured in this run.

The case for rolling out is accuracy: the six rejections caught, and a
calibrated confidence on each label. That is consistent with the feature's own
framing, "worth building for speed and calibrated confidence more than money",
though the speed part does not hold for job email.

## What the rollout needs (#1166)

- **Reword `interview_invite` and `scheduling` to the pipeline's convention,
  then re-check.** The stored labels treat a booked interview (invitation with a
  time, confirmation, reminder, calendar invite) as `interview_invite` and
  finding a time (availability, slots, booking links) as `scheduling`. The
  options Jev was given say nearly the opposite. The difference matters:
  `interview_invite` moves an application to its interview stage, while
  `scheduling` only moves it to `in_process` (`lib/jobs/pipeline.ts`). Reword
  the two meanings in `lib/jobs/email/jev-question.ts` to match. Then re-run the
  trial on the messages stored as either label (about 120) under a new trial
  name, before switching. The route cannot yet take a trial name or a label
  filter, so add both.
- **Always send `recruiter_reply`, `offer` and `other` to Haiku.** Jev
  said `recruiter_reply` 22 times, with an average confidence of 0.61, and only
  2 of the 7 confident answers on stored replies agreed. That label feeds the
  response rate (`first_human_response_at`). `offer` is rare and costly to get
  wrong, and `other` has no classification to store.
- **Keep 0.8 as the floor for the rest.** Among Jev's confident answers, the
  one clear error is the Criteria message. Nothing here argues for a different
  floor.
- **Keep Haiku's extraction on actionable mail.** Jev replaces Haiku's label,
  not the call.

## All disagreements

Stored label, Jev's label, Jev's confidence, who settled the stored label, the
subject (scrubbed where the envelope was cleared), and the first eight
characters of the message id.

| Stored | Jev | Confidence | Settled by | Subject | Message |
| --- | --- | ---: | --- | --- | --- |
| application_confirmation | assessment | 0.52 | rules | Complete your interview to stay in consideration | d5b1a836 |
| application_confirmation | assessment | 0.47 | rules | Complete your interview to stay in consideration | 25723674 |
| application_confirmation | assessment | 0.46 | rules | Complete your interview to stay in consideration | f517fd0a |
| application_confirmation | interview_invite | 0.78 | rules | Still interested in moving forward? | c0ff3ca9 |
| application_confirmation | interview_invite | 0.78 | rules | Still interested in moving forward? | 73d28a99 |
| application_confirmation | interview_invite | 0.52 | rules | Complete your interview to stay in consideration | 8141dbfe |
| application_confirmation | interview_invite | 0.51 | rules | Complete your interview to stay in consideration | 45ff2576 |
| application_confirmation | interview_invite | 0.49 | rules | Complete your interview to stay in consideration | 73ade9b5 |
| application_confirmation | interview_invite | 0.47 | rules | Complete your interview to stay in consideration | 0821b9b2 |
| application_confirmation | interview_invite | 0.47 | rules | Complete your interview to stay in consideration | 91c97c9d |
| application_confirmation | other | 0.42 | Haiku | Please complete your application - PEPI: Associate - Commercial Due Diligence in | 7ce2a6d6 |
| application_confirmation | recruiter_reply | 0.78 | rules | Incomplete Application | d9666d26 |
| application_confirmation | recruiter_reply | 0.56 | rules | Finance Associate - David Protein | 5091a10c |
| application_confirmation | recruiter_reply | 0.56 | rules | Finance Associate - David Protein | 34f50cf2 |
| application_confirmation | recruiter_reply | 0.45 | rules | Altis x {{Candidate's First Name}} | 89c42886 |
| application_confirmation | recruiter_reply | 0.33 | Haiku | Complete your application for Manager - Audit, Finance SME position | 170c2ec7 |
| application_confirmation | recruiter_reply | 0.32 | rules | Selvey Knight & Bending Spoons—Submit your application | a92f24ef |
| application_confirmation | rejection | 1.00 | rules | Thank you for your interest in CFGI, Selvey | 706a67f1 |
| application_confirmation | rejection | 1.00 | rules | Anthropic Application for Finance & Strategy, Deal Desk - Americas | f0e28b13 |
| application_confirmation | rejection | 1.00 | rules | Your application to Diageo. | d50cdff7 |
| application_confirmation | rejection | 1.00 | rules | An update from Finch | 26b07fee |
| application_confirmation | rejection | 1.00 | rules | Thank you for your interest in CFGI, Selvey | 8753a126 |
| application_confirmation | rejection | 1.00 | rules | DualEntry - Update on Your Application | 222feb76 |
| application_confirmation | scheduling | 0.96 | rules | Array Interview Confirmation: Selvey Knight for FP&A Analyst | e4a4a522 |
| application_confirmation | scheduling | 0.96 | rules | Galaxy In-Person Interview Confirmation / Assoc/VP, Assistant Controller | b46f8ac1 |
| application_confirmation | scheduling | 0.84 | rules | Array Interview Confirmation: Selvey Knight for FP&A Analyst | 85a225ad |
| application_confirmation | scheduling | 0.68 | rules | Re: Revin - Strategy & Operations Manager - Next Steps | a301bf31 |
| assessment | application_confirmation | 1.00 | rules | Thank you for applying to MrBeast | 18525be6 |
| assessment | application_confirmation | 0.91 | rules | Thank you for applying to Canonical | db00e92d |
| assessment | application_confirmation | 0.84 | Haiku | Your Event ID for All Jobs at Array US Inc | ecd54ebc |
| assessment | application_confirmation | 0.30 | rules | Automatic reply: [EXT]Re: Update on your application with McKinsey & Company | 1278864b |
| assessment | interview_invite | 0.92 | rules | Galaxy Interview Availability Request | 979e3c91 |
| assessment | interview_invite | 0.77 | Haiku | Still interested in moving forward? | e321965b |
| assessment | interview_invite | 0.74 | Haiku | Still interested in moving forward? | d5d925d9 |
| assessment | interview_invite | 0.74 | Haiku | Still interested in moving forward? | 6d906134 |
| assessment | interview_invite | 0.74 | Haiku | Still interested in moving forward? | 8fcb8634 |
| assessment | interview_invite | 0.74 | Haiku | Still interested in moving forward? | da3c1d7b |
| assessment | interview_invite | 0.73 | Haiku | Still interested in moving forward? | cc60fe0d |
| assessment | interview_invite | 0.56 | Haiku | Your micro1 interview is pending | 0906b8ed |
| assessment | interview_invite | 0.54 | Haiku | Your micro1 interview is pending | 2b53c9c3 |
| assessment | interview_invite | 0.47 | Haiku | Your micro1 interview is pending | 278ee76a |
| assessment | interview_invite | 0.46 | Haiku | Your micro1 interview is pending | 295e2f91 |
| assessment | interview_invite | 0.45 | Haiku | Your micro1 interview is pending | 09cd4e3b |
| assessment | interview_invite | 0.44 | Haiku | Verify your email to start your interview | 42bf43af |
| assessment | not_relevant | 0.52 | Haiku | Track Your micro1 Screening Status in KarmaCheck | 581a0556 |
| assessment | other | 0.35 | Haiku | micro1 Independent Contractor Background Verification by KarmaCheck | 9b89fa2f |
| assessment | recruiter_reply | 0.82 | rules | Re: Campfire - Next steps / Implementation Manager - Case study | 00f26501 |
| assessment | recruiter_reply | 0.58 | rules | RE: [EXT]Re: Galaxy / Assistant Controller Assessment | e688edfd |
| assessment | scheduling | 0.74 | rules | Re: Galaxy Interview Availability Request | 2944391a |
| assessment | scheduling | 0.62 | rules | Re: Porter - Take Home Assessment | 6248858f |
| assessment | scheduling | 0.45 | rules | Re: Porter - Take Home Assessment | a9d64cc0 |
| interview_invite | application_confirmation | 0.99 | rules | Thank you for your interest in Galvanize | 2051f167 |
| interview_invite | assessment | 0.88 | rules | Canonical written Interview reminder - Financial Analyst | c6c7db2a |
| interview_invite | recruiter_reply | 0.85 | rules | Re: Array - Next Steps! | b01872f8 |
| interview_invite | recruiter_reply | 0.53 | rules | Re: Array - Next Steps! | 75229861 |
| interview_invite | recruiter_reply | 0.31 | rules | Re: Interview Request with Wealth.com | b1816a3f |
| interview_invite | recruiter_reply | 0.21 | Haiku | Re: Array Interview Confirmation: Selvey Knight for FP&A Analyst | 7f24d6a7 |
| interview_invite | scheduling | 0.98 | Haiku | Interview Confirmation- Interview/ Campfire | 9cf1ea1a |
| interview_invite | scheduling | 0.98 | Haiku | Interview Confirmation- Onsite Interview/ Campfire | d54f1357 |
| interview_invite | scheduling | 0.98 | Haiku | Interview Confirmation- Interview/ Campfire | e77717f9 |
| interview_invite | scheduling | 0.98 | Haiku | Galaxy Virtual Interview Confirmation / Assoc/VP, Assistant Controller | 5b97dbac |
| interview_invite | scheduling | 0.97 | Haiku | Interview Confirmation- Onsite Interview/ Campfire | 9a83ee83 |
| interview_invite | scheduling | 0.97 | rules | Re: Next steps - Triomics | 987b3ee6 |
| interview_invite | scheduling | 0.97 | Haiku | Adonis / Hiring Manager Conversation Confirmation | e0a612f4 |
| interview_invite | scheduling | 0.96 | rules | EliseAI Interview Confirmation | c3f56a98 |
| interview_invite | scheduling | 0.96 | rules | Re: Axial Interview Availability | 02475e4d |
| interview_invite | scheduling | 0.96 | rules | Selvey Knight / Your Interview with IonQ | 6e486114 |
| interview_invite | scheduling | 0.96 | rules | Re: EliseAI Practical Interview Request | 5fb4753d |
| interview_invite | scheduling | 0.95 | rules | Re: EliseAI Interview Request | 68f210d7 |
| interview_invite | scheduling | 0.94 | rules | EliseAI Interview Confirmation | 40a8935c |
| interview_invite | scheduling | 0.94 | rules | Your interview availability with IonQ was submitted | d804bdf1 |
| interview_invite | scheduling | 0.94 | rules | EliseAI Interview Confirmation | d9898f58 |
| interview_invite | scheduling | 0.94 | rules | Reminder: Your Upcoming Interview with White Circle | 515b13ab |
| interview_invite | scheduling | 0.93 | rules | Reminder: Your Upcoming Interview with EliseAI | 41731e15 |
| interview_invite | scheduling | 0.92 | rules | Reminder: Your Upcoming Interview with EliseAI | a1906296 |
| interview_invite | scheduling | 0.91 | rules | EliseAI Interview Confirmation | b591b5b5 |
| interview_invite | scheduling | 0.91 | rules | Reminder: You have an upcoming interview with IonQ | 739f1c0a |
| interview_invite | scheduling | 0.90 | rules | Reminder: Your Upcoming Interview with EliseAI | 87c27fd9 |
| interview_invite | scheduling | 0.88 | rules | Reminder: Your Upcoming Interview with EliseAI | 49eb2cf6 |
| interview_invite | scheduling | 0.87 | rules | Reminder: Your Upcoming Interview with Mercor | 8ab131db |
| interview_invite | scheduling | 0.86 | rules | Reminder: Your Upcoming Interview with Triomics | ebb85cf5 |
| interview_invite | scheduling | 0.85 | rules | Updated invitation: Interview with Campfire @ Wed Jul 22, 2026 1pm - 1:30pm (EDT | 60eb1706 |
| interview_invite | scheduling | 0.84 | rules | Reminder: Your Upcoming Interview with Campfire | 5d745da2 |
| interview_invite | scheduling | 0.83 | rules | Reminder: Your Upcoming Interview with Triomics | 4c6a639d |
| interview_invite | scheduling | 0.82 | Haiku | Re: Array - Next Steps! | 2d4a4dec |
| interview_invite | scheduling | 0.81 | rules | Reminder: Your Upcoming Interview with Adonis | 54ea3e72 |
| interview_invite | scheduling | 0.81 | rules | Reminder: Your Upcoming Interview with Adonis | 7cb1cb4a |
| interview_invite | scheduling | 0.81 | rules | Reminder: Your Upcoming Interview with Campfire | bbd3733a |
| interview_invite | scheduling | 0.80 | rules | Reminder: Your Upcoming Interview with Campfire | a8e1a7e0 |
| interview_invite | scheduling | 0.79 | rules | Re: EliseAI Interview Request | 033383d8 |
| interview_invite | scheduling | 0.78 | Haiku | Re: You're invited to an interview at Array, Selvey! | bd1a23ec |
| interview_invite | scheduling | 0.76 | Haiku | Interview Confirmation - Selvey Knight | b1832413 |
| interview_invite | scheduling | 0.74 | rules | Reminder: Your Upcoming Interview with Wealth.com | 024584c4 |
| interview_invite | scheduling | 0.73 | Haiku | The Siegfried Group - Zoom Confirmation | cd14d055 |
| interview_invite | scheduling | 0.72 | Haiku | The Siegfried Group - Zoom Confirmation | f876c989 |
| interview_invite | scheduling | 0.70 | rules | Re: You're invited to an interview at Array, Selvey! | b2aa0331 |
| interview_invite | scheduling | 0.66 | rules | Updated invitation: Interview with Campfire @ Fri Jul 24, 2026 1:30pm - 3:30pm ( | b45f576d |
| interview_invite | scheduling | 0.62 | rules | Invitation: Interview with Campfire @ Wed Jul 22, 2026 4:30pm - 5pm (EDT) (selve | bed9420d |
| interview_invite | scheduling | 0.57 | rules | Invitation: Interview with Campfire @ Mon Jul 27, 2026 1:30pm - 2pm (EDT) (selve | b1a24f3a |
| interview_invite | scheduling | 0.52 | rules | Invitation: Interview with Campfire @ Fri Jul 24, 2026 1:30pm - 3:30pm (EDT) (se | f7326ea6 |
| interview_invite | scheduling | 0.50 | Haiku | Re: EliseAI Onsite Interview Request | d31cfbd5 |
| interview_invite | scheduling | 0.48 | rules | Invitation: Interview with Campfire @ Mon Jul 20, 2026 12:30pm - 1pm (CDT) (selv | 91faa3b2 |
| interview_invite | scheduling | 0.40 | Haiku | Re: Galaxy In-Person Interview Confirmation / Assoc/VP, Assistant Controller | 8e42a243 |
| job_alert | other | 0.61 | rules | An update from Wells Group of New York, Alloy and 1 others | 6f99ae49 |
| job_alert | other | 0.41 | rules | Selvey, people are looking at your Wellfound Profile | c6548731 |
| not_relevant | application_confirmation | 0.81 | Haiku, dismissed by hand | (scrubbed) | 4d621acb |
| not_relevant | application_confirmation | 0.78 | Haiku, dismissed by hand | (scrubbed) | 641f4fca |
| not_relevant | application_confirmation | 0.29 | Haiku | Confirm your identity for job Financial Planning & Analysis Associate: Quantitat | cdf71edb |
| not_relevant | assessment | 0.91 | Haiku, dismissed by hand | (scrubbed) | 49834be3 |
| not_relevant | assessment | 0.90 | rules | (scrubbed) | 73562533 |
| not_relevant | assessment | 0.89 | Haiku, dismissed by hand | (scrubbed) | 428ba4f7 |
| not_relevant | assessment | 0.59 | Haiku | (scrubbed) | c103bcf3 |
| not_relevant | assessment | 0.49 | Haiku, dismissed by hand | (scrubbed) | 2ea53cc4 |
| not_relevant | assessment | 0.43 | rules | (scrubbed) | b72b26ed |
| not_relevant | assessment | 0.32 | Haiku, dismissed by hand | (scrubbed) | 34428553 |
| not_relevant | interview_invite | 0.92 | Haiku, dismissed by hand | (scrubbed) | 334aebae |
| not_relevant | interview_invite | 0.40 | Haiku | (scrubbed) | b4398832 |
| not_relevant | job_alert | 0.79 | rules | (scrubbed) | 0682e324 |
| not_relevant | job_alert | 0.64 | rules | (scrubbed) | e9b0f659 |
| not_relevant | networking | 0.53 | Haiku | (scrubbed) | faa95e39 |
| not_relevant | networking | 0.42 | Haiku | (scrubbed) | f5b398ea |
| not_relevant | offer | 0.98 | Haiku | (scrubbed) | 1244378c |
| not_relevant | other | 0.68 | Haiku | (scrubbed) | 457d716f |
| not_relevant | other | 0.42 | Haiku, dismissed by hand | (scrubbed) | e66671e5 |
| not_relevant | recruiter_outreach | 1.00 | Haiku, dismissed by hand | (scrubbed) | bc68b970 |
| not_relevant | recruiter_outreach | 1.00 | Haiku, dismissed by hand | (scrubbed) | dd0b06b6 |
| not_relevant | recruiter_outreach | 1.00 | Haiku | (scrubbed) | 8612a592 |
| not_relevant | recruiter_outreach | 0.98 | Haiku | (scrubbed) | f9e2589e |
| not_relevant | recruiter_outreach | 0.75 | Haiku, dismissed by hand | (scrubbed) | 7c56fa44 |
| not_relevant | recruiter_outreach | 0.57 | Haiku | (scrubbed) | 6f6ef984 |
| not_relevant | recruiter_reply | 0.99 | Haiku | (scrubbed) | 2d1ff979 |
| not_relevant | recruiter_reply | 0.86 | Haiku | (scrubbed) | a5f30c1d |
| not_relevant | recruiter_reply | 0.45 | Haiku | (scrubbed) | de8ba7e7 |
| not_relevant | recruiter_reply | 0.41 | Haiku | (scrubbed) | e187c452 |
| not_relevant | scheduling | 0.98 | Haiku | (scrubbed) | 27c0fa19 |
| not_relevant | scheduling | 0.90 | Haiku | (scrubbed) | 514b5e54 |
| not_relevant | scheduling | 0.79 | rules | (scrubbed) | e98a7b94 |
| not_relevant | scheduling | 0.77 | Haiku | (scrubbed) | 6d8b919f |
| not_relevant | scheduling | 0.73 | Haiku | (scrubbed) | 9e2e194e |
| not_relevant | scheduling | 0.66 | Haiku | (scrubbed) | 095e35c8 |
| not_relevant | scheduling | 0.36 | Haiku | (scrubbed) | 8b044f1a |
| recruiter_outreach | recruiter_reply | 0.63 | rules | Message replied: Exciting opportunity at Basis | d51828aa |
| recruiter_outreach | recruiter_reply | 0.60 | rules | Your Application for Private Equity Investment Associate(337983BR) | e874378f |
| recruiter_outreach | rejection | 1.00 | rules | Nearwater Capital / Following up your application | 2c5037bc |
| recruiter_outreach | scheduling | 0.56 | rules | Message replied: Exciting opportunity at Basis | cae24dce |
| recruiter_reply | networking | 0.31 | Haiku | Example Excel Analysis | 92627031 |
| recruiter_reply | recruiter_outreach | 0.98 | rules | Re: Owning a new product line at Trayd (NYC) | 68e1cb2c |
| recruiter_reply | recruiter_outreach | 0.54 | rules | Re: Owning a new product line at Trayd (NYC) | 632d9293 |
| recruiter_reply | rejection | 0.83 | rules | Re: Justworks / Update regarding your application | 2d8aa122 |
| recruiter_reply | scheduling | 0.93 | rules | Re: ReSpark / Intro chat on the Business Operations and Strategic Finance role | 631a901b |
| recruiter_reply | scheduling | 0.92 | rules | Re: ReSpark / Intro chat on the Business Operations and Strategic Finance role | 589023fd |
| recruiter_reply | scheduling | 0.90 | rules | Re: Interview Confirmation- Onsite Interview/ Campfire | 068152c3 |
| recruiter_reply | scheduling | 0.56 | Haiku | Re: Interview Request with Wealth.com | f182857e |
| recruiter_reply | scheduling | 0.41 | Haiku | Re: Array - Next Steps! | 93cdbeea |
| rejection | application_confirmation | 1.00 | rules | Thanks for applying to Cohere! | 6c8a6d8c |
| rejection | application_confirmation | 1.00 | rules | Your application for PEPI: Associate - Commercial Due Diligence at Alvarez and M | 4991a350 |
| rejection | application_confirmation | 1.00 | rules | Thanks for your application to Spotify! | 3488d5ea |
| rejection | application_confirmation | 0.92 | rules | Thank you for your interest in Kalshi | 3bae1afd |
| rejection | not_relevant | 0.62 | rules | Security code for your application to Careers at KKR | 73c19297 |
| rejection | recruiter_reply | 0.78 | rules | Update on your application(s) with Link Logistics | 3706a662 |
| scheduling | interview_invite | 0.95 | Haiku | Axial Interview Availability | 481a6aed |
| scheduling | interview_invite | 0.90 | Haiku | Next steps - Triomics | 405d1cbf |
| scheduling | interview_invite | 0.87 | Haiku | ReSpark / Intro chat on the Business Operations and Strategic Finance role | 25695518 |
| scheduling | interview_invite | 0.82 | Haiku | Invitation from an unknown sender: Axial Introductory Interview - Selvey Knight | 482644b8 |
| scheduling | interview_invite | 0.59 | rules | Invitation: Covet Health / FP&A Associate Role - Selvey Knight @ Fri Sep 4, 2026 | 46ad3333 |

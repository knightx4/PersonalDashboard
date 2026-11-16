# Learn: course digests

This spec turns a long lecture series into a short set of lessons fitted to one person. Each idea in the series gets the cheapest treatment that still teaches it at the level that person needs. Some ideas get the exact clip. Some get one sentence. Some get a worked example written out. The rest are skipped, with a reason.

It was written after building one digest by hand: MIT 18.S096 *Topics in Mathematics with Applications in Finance* (Fall 2013, 24 lectures), plus four 2024 18.642 guest lectures. That was 28 videos, about 37 hours. The result is the doc "MIT Quantitative Finance, Condensed" in Claude Docs, and it is the reference output for this spec. The section "What building the first one taught" records what that run showed. It is the most important part of this document.

Read before building: LEARN-SOURCES-SPEC (the catalogue, segments, courses), LEARN-LEVELS-SPEC (topics, the ten levels, lenses, the fringe), LEARN-GRAPH-SPEC, LEARN-SPEC (tracks and readings) and WRITING-GUIDE. This spec adds to those. It should need very few new tables. Where it names a table, check the schema first and prefer what exists.

---

## The theory

A professor teaches the whole subject to a whole room. Neither the breadth nor the repetition is chosen for any one person. For a given person with a given goal, most of a course is one of three things:

- already known;
- needed only at "aware" depth, where one sentence does the job;
- not needed at all.

A small part needs the full treatment, and inside an 80-minute lecture that part is usually a 3-to-15-minute span.

So an AI is not a better teacher than the professor in general. It can be a more efficient one for a specific purpose. It knows the purpose, so it can ask of every idea: how important is this to the goal, how foundational is it, and what is the cheapest form that teaches it to the level needed? The professor's sequence and explanations stay. What changes is the selection, the depth and the format.

The first digest put numbers on this. The 3-hour path was 177 minutes out of about 2,220, or 8% of runtime. Five lectures earned a full watch, eight had must-watch stretches, fourteen were skim-at-timestamps, and one was a full skip. That profile came from the learner's background: a CPA and MBA who already knows OLS, Markowitz and accounting. The same course digested for a math PhD with no finance background would come out very differently, and it should.

---

## Where this sits in Learn

A digest is not a new kind of thing. It is a way of filling structures Learn already has:

| Digest part | Existing structure |
| --- | --- |
| The series and its videos | a `catalogue_items` row of kind `course`, with its lectures under `catalogue_course_items` in published order |
| A clip (one idea's best span) | a `catalogue_segments` row with `t_start_seconds` and `t_end_seconds`. These are concept-bounded spans chosen by a model that read the transcript, not sliding windows |
| A clip teaching an idea | a `catalogue_links` row from the segment to a topic cell, with basis `verified`, because a model read the text and argued for it |
| The time-boxed path | a `track` whose `readings` are the clips in order, each with `t_start_seconds`, `t_end_seconds` and a `why` |
| A per-video verdict | the watch list's existing piles: `watch`, `card`, `skip` |
| What the learner already knows | `cell_evidence`, `learning_covered`, and the lens targets for the goal |

Choosing what goes in a digest is **rooting** in the LEARN-SOURCES-SPEC sense: a model choosing for the whole of the person, not retrieval for one claim. It should be told who the person is and what they hold, in prose and capped, as rooting already does.

What may be new, so check the schema first:

- **A digest row** that holds the course-level synthesis for one person and one goal: the dependency map, the tensions, the ten ideas, the errors list. These are per-person because the ratings depend on the person. The concept map and the errors list are largely not per-person, and could be shared on the course item.
- **A treatment field** on whatever joins a clip or idea to a person's digest: `clip`, `card`, `worked`, `skip`, plus a reason.

---

## The treatment rule

Every idea in the series gets exactly one treatment.

| Treatment | When | What the learner gets |
| --- | --- | --- |
| **Clip** | The idea matters to the goal at level 3 or above, and the lecture's explanation is the best available form of it. That usually means a practitioner's story, a live worked example, or a framing you won't find in a textbook. | The exact span with start and end, one sentence saying why to watch it, and the number or example to listen for |
| **Worked** | The idea matters at level 3 to 5, but the lecture is slow or wanders, and a written mechanism with real numbers teaches it faster | The mechanism stepped through with numbers, each step checkable. Lecture numbers and illustrative numbers are kept apart and labelled. Then the clip as optional |
| **Card** | Needed only at level 1 or 2, already known, or a prerequisite the learner has | One sentence of definition plus the one number or example that makes it stick, and a link to the timestamp for anyone who wants more |
| **Skip** | Not needed for the goal, or taught better elsewhere | A one-line reason. The skip stays visible so the learner can overrule it, and their move is kept as their own verdict, as the watch list already does |

The questions that decide it, in order:

1. **Goal fit.** What level does the learner's lens target for this topic? If the target is 1 or 2, it's a card at most.
2. **Already held.** If `cell_evidence` or a declaration shows the level is already met, it's a card or a skip.
3. **Foundational.** How many later ideas in the dependency map rest on this one? A high fan-out lifts the treatment one step.
4. **Uniqueness.** Is this explanation available only here? Practitioner stories, real trades and real numbers are: the Trafigura contango trade, the $50M CVA quiz, Berkshire's puts. Textbook derivations usually are not.
5. **Minutes per idea.** If the span is long relative to what it teaches, use worked or card instead of clip.

How treatments map to the ten levels:

- A card reaches level 1 or 2.
- A clip or worked example reaches levels 3 to 5.
- Practitioner clips carry levels 6 to 9: limits, judging output, and practitioner moves such as hedging PC1 to trade PC2.
- The course's internal disagreements are level 10 material, the live disputes.
- The errors found in the lectures are level 7 material: knowing where the method breaks.

Questions written for a digest should follow the formats in LEARN-LEVELS-SPEC: explain for levels 1 to 3, a case to work for levels 4 to 6, defend for level 10.

---

## The pipeline

Six stages. Each one writes durable output before the next starts.

### 1. Choose the series

Offer two to four candidate series for the learner's goal, each with one line on fit, recency and length. Let the person pick. Mixing is allowed and often right: an older full course as the core, plus a few recent lectures for what changed. 2013 18.S096 plus 2024 18.642 lectures 9, 18, 20 and 23 was the first case.

### 2. Inventory

List every video with its title, length, speaker and id. Store each as a catalogue item with `duration_seconds`. Get speakers from the course metadata as well as the tape, because some lectures never name the speaker. Expect gaps in numbering: the 2013 playlist has no L04 or L22.

### 3. Ingest every transcript to storage

Fetch every transcript in full, not a sample. Write each one to storage the moment it arrives, as two things:

- the raw text;
- a compact form grouped into paragraphs of about 45 seconds, each starting `[m:ss|seconds]`.

The compact form cut size by about 20% and made accurate timestamps cheap to quote. Check that the number of stored transcripts equals the inventory count before moving on.

### 4. One notes file per lecture

Read each compact transcript whole and write one notes file. It holds:

- the URL, length and speaker;
- timestamped segments, marking the key ones;
- the concepts, each with its single best timestamp;
- every concrete number and worked example, verbatim;
- tensions with other lectures;
- errors spotted;
- a draft rating with timestamp ranges.

In the first run these came to 2 to 6 KB per lecture, about 120 KB in total from about 1.5 MB of transcript. The notes are the durable intermediate. Everything later reads the notes, not the transcripts.

### 5. Cross-lecture synthesis

This runs only once all the notes exist, because the most valuable parts only appear across lectures:

- **Concept map**, in clusters, each concept with its plain explanation, mechanism, numbers and best clips.
- **Dependencies.** Draw them. In the first run they formed two tracks, measuring risk and pricing by replication, with shared roots. These are proposals for `cell_links`, weak evidence, and go through the usual approval.
- **Tensions.** Where lecturers contradict each other, where framing changes between years, and what is left unresolved.
- **Ratings and treatments** per the rule above.
- **About ten ideas** that change how a smart non-specialist thinks, each with its specific example or number.
- **A time-boxed path**, in dependency order, with start and end for each clip, minutes and a running total, fitted to a budget the person gives (3 hours by default).
- **Errors and caveats.**

### 6. Verify

Before showing anything:

- **Arithmetic.** Recompute every number the digest states, the lectures' numbers included.
- **Links.** Build every link from a code-to-video-id map with code. Check every `t` is inside its video's duration. Check every clip's end is after its start and inside the video.
- **Path.** Check the minutes column sums to the stated total and the running column is consistent.
- **Style.** Check against the writing guide. Banned punctuation is checked by code (no em dashes).
- **Provenance.** No URL that wasn't returned by a tool or built from a known id.

---

## The plan

Decided by the owner on 16 November 2026, after using the first three
digests. They had a path of clips, a list of lessons and a dependency map as
three tabs, and the owner found three views of one course confusing. What
they asked for: "linear structured lessons" that follow the map "one by one",
branching where the course forks, with "everything necessary" in each step:
"some clips, some explanatory commentary and text lessons, diagrams, guest
lecture snippets, and even chunks of readings where applicable".

So a digest has one plan, and it replaces the path, the lessons and the map.

- A **stage** is a run of steps. It names the stages it comes after. The
  first stage is the ground everything else rests on. Stages that come after
  the same stage are branches: the page sets them side by side and the
  learner takes whichever they want first. The 18.S096 plan opens on linear
  algebra and probability and then forks.
- A **step** is one sitting on one idea. It is a list of blocks in the order
  to take them: `text` (commentary or a worked mechanism), `clip` (played in
  the page), `figure` (a drawing in the page's colours), `reading` (a text
  that belongs here, with the author's paragraphs only where it is openly
  licensed) and `check` (a question with its full answer).
- What the old lesson carried is still there. The point and the mechanism
  are text blocks, the tension is commentary in the step it bears on, and a
  lower-priority idea is a short text block in the step it belongs to.
- The course keeps two more tabs: the big ideas, and every lecture with its
  verdict, each playing in the page. A timestamp anywhere opens its lecture
  there at that moment. The lecturers' errors sit folded under the lectures.

### The map

The owner opened the first plan on a tablet the same day and said it read
like an internal tool: an opening paragraph of stage codes, a weak start
button, a list where they had asked for a map, and a count of every step in
every branch. They asked for "a real map which is interactive and works
intuitively". What changed:

- The Lessons tab is a map of the course. Each stage is a place on it, set
  under the stages it comes after with a line from each, so a fork reads as
  a fork. A ring round a place fills as its steps are done, and a finished
  place is filled in. The place that holds the next step says "Start here"
  or "Continue".
- Pressing a place opens that stage beside the map, or under it where the
  page is narrow: what it gets you, how far through it you are, one button
  for its next step, and its steps. The map opens on the stage that holds
  the next step, so the button to press is on screen without choosing.
- A stage carries `short`, its name on the map. A step carries `gain`, one
  sentence on what you can do after it, shown under its title on the map
  and at the head of its own page.
- Nothing the reader sees names a stage or a step by its key, and no step is
  shorter than four minutes; `checkDigest` refuses both.
- A step's page ends in one press that marks it done and goes on. At the end
  of a stage that press is a choice between the stages that follow, each
  with what it gets you.

Where each stage sits is `mapLayout` in `lib/learn/courses/plan.ts`; the map
is `app/learn/courses/[id]/plan-map.tsx`.

The shape and its checks are `Plan`, `Stage`, `Step` and `Block` in
`lib/learn/courses/digest.ts`; which step comes next and what a finished
stage opens are in `lib/learn/courses/plan.ts`.

The two sections below describe the first shape and are kept for the
reasoning. Where they disagree with this one, this one holds.

## Lesson shape

A lesson is one concept cluster, rendered in this order:

1. **The point**, in one sentence with its number.
2. **The mechanism**, with real numbers. Lecture figures are cited to their timestamp. Illustrative figures are marked "illustrative".
3. **The clip or clips**, each with start, end and what to listen for.
4. **The check.** One question at the level the learner's lens targets, in the format LEARN-LEVELS-SPEC assigns to that level.
5. **The tension**, if one exists: who disagrees, and where it lands.
6. **Cards** for the cluster's lower-priority ideas, one sentence each.

Course-level pages: the video list, the dependency map, the ratings table, the ten ideas, the path, and the errors. The Claude Docs reference output has all six. Copy its structure.

---

## What building the first one taught

These come from doing it once, end to end. Each should change how the build works.

1. **Work from storage, never from context.** 37 hours of transcript is about 1.5 million characters. The session ran out of context partway through and was summarized. Everything survived only because the notes files existed. The pipeline has to be restartable from stored notes at any stage.
2. **Transcript fetches come back in two shapes.** Large results arrived as persisted files. Small ones arrived inline and had to be written explicitly. Three of 28 raw transcripts (L01, L19, L21) were never saved for this reason, though their notes were written. Write every result to storage immediately, whatever shape it arrives in, and count files against the inventory.
3. **One lecture's output came back in a different structure** (a dict rather than a list), and the cleaning script failed. The ingest step needs to accept every shape the transcript tool returns.
4. **Timestamps belong in the compact text.** `[m:ss|seconds]` on every paragraph meant each timestamp in the notes could be quoted exactly. Seconds are needed for links. Minutes are needed for people.
5. **Generate links from ids. Never hand-type them.** The digest has 276 timestamp links, all built by a script from `[[L07 21:49]]`-style tokens, and all checked against duration. One URL (a playlist link) was nearly written from memory and had to be removed. Never emit a URL that no tool returned and no known id builds.
6. **Lecturers make mistakes, so treat their numbers as claims.** About a dozen were found:
    - wrong tail odds: "3σ once per 10,000" should be about 1 in 740;
    - a wrong AR(1) variance formula on a slide;
    - a garbled Kelly criterion;
    - a gradient-descent example whose function didn't match its answer;
    - a slide that contradicts the lecturer's own model (Italy's USD vs EUR spreads);
    - several misspeaks.

   Recompute everything. Auto-captioned lectures (L11) garble numbers more, so check those against context.
7. **The best span is short and buried.** The concept clips that made the path ran 3 to 27 minutes, most of them 5 to 16, inside lectures of 50 to 107 minutes. Finding the span is the work, which is exactly why LEARN-SOURCES-SPEC makes the segment the unit.
8. **Practitioners carry most of the value for an experienced learner.** All five full-watch lectures were by practitioners or had a practitioner frame. Most math-review lectures came out skim or skip for this learner. That is a fact about the learner, not about the lectures, so ratings must be computed from the learner's profile and evidence, never stored as properties of the video.
9. **The best material needs every lecture done first.** Contradictions between lecturers, the shift in framing from 2013 to 2024, and the dependency structure are invisible lecture by lecture. Examples: normal tails vs t tails, PCA vs smoothness priors, "we make no predictions" vs selling the gap between implied and historical odds. Keep the cross-lecture pass as its own stage.
10. **Mark what is illustrative.** Worked examples need numbers the lecture didn't give, such as GARCH parameters, a butterfly's call prices, or a CVA exposure. Labelling them "illustrative" kept the lecture's numbers trustworthy.
11. **Ask the learner to choose the series, then don't ask again.** Offering options first, comparing 2013 vs 2024, and settling on "2013 plus four 2024 lectures" was worth one exchange. After that the run went through without questions.
12. **Cost is in reading, not in writing.** Fetching and reading the transcripts dominated. Synthesis from 120 KB of notes was cheap. So: store the notes on the course item and reuse them. A second learner digesting the same course should pay only for the per-person synthesis stage, not ingest and notes again. This matches the rule in LEARN-SOURCES-SPEC to run for one thing when asked and store the result.
13. **Speaker names aren't always on the tape.** L13's speaker never says his name. Course metadata (OCW) supplied it.
14. **Time-sensitive facts age.** The lectures' market figures are dated: 2013 yields, Kalshi's 2024 volume, BridgeBio's market cap. Flag them as of the lecture date.
15. **Dependencies order the path better than the syllabus.** The path ran risk, then compression, then pricing, then credit, cutting across lecture order. The syllabus is still a useful prior for proposing links, as LEARN-SOURCES-SPEC says.

---

## Rules

**D1.** Every stated number in a digest is either cited to a lecture timestamp or labelled illustrative. Checked by: audit.

**D2.** Every link is built from a stored video id, and its `t` lies within the video's duration. Checked by: test.

**D3.** Ratings and treatments are computed per person and goal, and never stored on the shared course item. Checked by: audit.

**D4.** A digest's notes, concept map and errors are built from every lecture in the chosen set, never a sample. Checked by: count of notes against the inventory.

**D5.** Nothing a digest produces writes `cell_evidence`. Only answered checks do, as in R1 of LEARN-LEVELS-SPEC. Checked by: audit.

---

## Build order

1. Ingest for one course: inventory, transcripts to storage in both forms, a count check. Use the MIT set as the fixture, since its notes exist (see below).
2. The notes stage, with a stored notes file per lecture on the course item.
3. The synthesis stage, producing the six course-level pages for one person and goal.
4. The treatment rule wired to lens targets and `cell_evidence`, with the watch-list piles reflecting it.
5. Clips as segments and links, and the path as a track with timestamped readings.
6. Lesson pages and checks.
7. Verification as code: arithmetic recompute, link and duration checks, path totals, style.

## Open questions

- Should the shared course item hold the concept map and errors, with only ratings, treatments and path per person? This is the cheapest option, but a concept map written for one learner's goal may leave out ideas another needs.
- Worked examples need illustrative numbers. Should they be generated per learner, or once per course?
- How far below the lens target does a skip reach? A level-1 card for everything skipped costs little and keeps the map honest.

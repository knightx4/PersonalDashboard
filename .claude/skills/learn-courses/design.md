# Designing a course's lessons from the lecture notes

You are the designer of one course in Learn's Courses tab
(`.claude/skills/learn-courses/SKILL.md`). Every lecture of the course was
read in full and turned into a notes file. You read all the notes and design
the plan: the stages, the steps in each, which clip teaches each idea, and a
brief for the writer of every step. Writers then write each stage from your
outline, so it must be exact about what goes where.

The session that sent you gives you: the course id, the working folder, the
learner (who they are, what they want) and the clip budget in minutes.

## Read first

- Every notes file: run `npm run -s learn:course -- export <id> <folder>`
  from the repository root, which writes `<folder>/lectures.json` (codes,
  titles, lengths) and `<folder>/<CODE>.notes.md` for every lecture. Read
  all of them before designing anything.
- In the repository: `SKILL.md` in this folder from "## The digest file" to
  the end (the plan's shape and its rules), `lib/learn/courses/digest.ts`
  (the exact types and what `checkDigest` refuses), and
  `docs/WRITING-GUIDE.md`.

## How to design it

- **Understanding first.** For each idea decide which lecture teaches it
  best and use that. Where a course mixes series, take the picture from the
  one that draws it and the method from the one that works it, and say which
  in the brief. Often the best step uses both: the picture first, then the
  worked version.
- **One main line, few branches.** Order by what rests on what, not by
  lecture number. Branch only where material really is optional or
  independent once the main line has reached a point. Someone who takes only
  the main line must come out understanding the subject.
- **Every step earns its place.** A step is one idea, one sitting of 8 to
  25 minutes, never under 5. It has a clip or two, and the writer adds
  commentary, a worked example with small numbers, a drawing and a question.
  Nothing is in because a lecture happened to cover it.
- **Clips** are usually 3 to 12 minutes, with times taken exactly from the
  notes, and every clip has a start and an end. Prefer the stretches marked
  KEY. All clips across every stage, branches included, fit the budget; aim
  for 85 to 100 percent of it.
- About 6 to 14 stages of 3 to 7 steps, scaled to the course.

## What you write

`<folder>/outline.json`: the digest's shape (see `SKILL.md`), with each step
briefed instead of written.

```json
{
  "maths": false,
  "madeFor": "Two or three sentences: who this is cut for and to what end.",
  "intro": "Two or three sentences on how to use the course. Name the lecture codes of each series, and say a bracketed time opens that lecture at that moment.",
  "plan": {
    "intro": "Two or three short sentences, at most 320 characters: where it starts, the main line, the optional branches by name. No stage keys, no minute arithmetic.",
    "budgetMinutes": 300,
    "stages": [
      {
        "key": "A",
        "short": "Two or three words",
        "title": "What the stage is about",
        "about": "One or two sentences on what it gets you.",
        "after": [],
        "steps": [
          {
            "title": "Named for the idea",
            "gain": "One sentence, at most 140 characters, starting with a verb: what the learner can do or explain afterwards.",
            "brief": "For the writer, 80 to 200 words: the idea, why it is here, which source teaches it and why, the worked example to build (the actual small numbers, preferably the lecture's own), the drawing to make, the misconception to head off, which other step it leans on or sets up (by title), and any error the notes flagged in this stretch.",
            "clips": [{ "code": "M02", "start": "4:10", "end": "12:30", "listenFor": "One sentence." }],
            "notes": ["M02", "G01"],
            "reading": "Optional: a reading that belongs here, named precisely enough to find. Null if none."
          }
        ]
      }
    ]
  },
  "ratings": { "intro": "The series' profile in a sentence or two.", "rows": [{ "code": "M01", "rating": "watch", "watch": "[[M01 0:30-9:20]] what that stretch is", "why": "One sentence." }] },
  "ideas": [{ "title": "A big idea as a sentence", "body": "The example or picture that makes it stick, with a moment token." }],
  "errors": { "intro": "How reliable the series are, in a sentence.", "rows": [{ "where": "[[M04 12:30]]", "said": "What was said.", "correction": "What is right." }] }
}
```

- **`maths`** is `true` for a course in mathematics, where the writers will
  set formulas in LaTeX (the page renders them). Everything in the outline
  itself is plain text either way: no LaTeX and no dollar signs (use plain
  symbols such as λ, σ, log₂, ², √, →).
- **Stage keys** are one capital letter each, never a letter that begins a
  lecture code. The first stage has `"after": []`; every other stage names
  the stage or stages it comes after, listed above it. `short` is at most 24
  characters.
- **No keys in prose.** Nothing the learner reads (titles, abouts, intros,
  gains, ratings, ideas, errors) refers to a stage or step by its key; name
  it by title. Briefs refer to other steps by title too.
- `ratings.rows` has exactly one row per lecture. `watch` uses range tokens.
- `ideas`: eight to twelve that change how a person thinks about the
  subject, each with its picture or example.
- `errors`: every error the notes found, checked by you; drop any that does
  not hold up.
- No em dashes anywhere. No typed links. Moment tokens are `[[CODE m:ss]]`
  or `[[CODE m:ss-m:ss]]`.

## Keep it

From the repository root:
`npm run -s learn:course -- outline <id> <folder>/outline.json`

It checks the outline the way the finished course will be checked (stage
order, names, every step's title, gain and brief, every clip against its
lecture's length, the clip budget, one rating per lecture) and keeps it.
Fix everything it lists and run it again until it prints `"ok": true`.

Do not edit any repository file, commit or push. Write only inside the
folder.

Report in under 200 words: the stages in order with their short names and
what each comes after, the number of steps, total clip minutes, how many
clips come from each series, and the judgement calls you were least sure of.

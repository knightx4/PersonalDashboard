# Learn: the areas

A fixed two-level list of fields of study, ten domains and 47 fields, that every
subject and every vault theme is placed in. It gives the Know page something to
count against, so it can show where you are strong, where you are weak, and
which fields you have not touched.

It sits above the learn graph described in [LEARN-GRAPH-SPEC.md](LEARN-GRAPH-SPEC.md)
and beside the vault map in [KNOWLEDGE-SPEC.md](KNOWLEDGE-SPEC.md). It changes
neither.

Written to [WRITING-GUIDE.md](WRITING-GUIDE.md).

---

## Why the graph cannot do this alone

The learn graph starts empty and grows a goal at a time. That makes it good at
one question and unable to answer another.

It can say what you know inside a subject you started, down to the claim, with
the date you last answered. It cannot say anything about a field you never
started, because that field has no concepts in the graph. A screen built from
the graph alone can show that economics is strong. It cannot show that
chemistry is empty, because chemistry is not in the graph at all.

Showing a gap needs a fixed list of what exists. The areas are that list.

## Two fixed levels, and everything below them loose

The top two levels are fixed and change only by migration. Everything below a
field is the learn graph, which stays as loose as LEARN-MAP-SPEC wants it: nodes
and edges discovered from what you set out to learn, expected to churn.

LEARN-MAP-SPEC warns against a rigid taxonomy that ends up describing itself
instead of the person. The areas avoid that by staying shallow. A field such as
Economics is broad enough that anything you study in it fits without forcing,
and nothing below the field is ever filed into a slot.

Two levels, because one is too coarse for the dashboard. "Strong in social
sciences" hides whether that means economics or law. A third level would start
making the calls the learn graph exists to make.

## Where the list came from

The starting point was the section structure of Wikipedia's
[Level 3 vital articles](https://en.wikipedia.org/wiki/Wikipedia:Vital_articles/Level_3),
the thousand articles its editors consider most important. It covers every
field and has been argued over for years.

Its sections divide knowledge four different ways at the same level, which is
why they cannot be used as they are:

| Division | Level 3 sections |
|---|---|
| Field of study | Mathematics, Science, Health, medicine and disease, Technology, Society and social sciences, Arts, Philosophy and religion |
| Kind of thing | People, Geography |
| Time | History |
| Area of daily life | Everyday life |

A person can be filed under People or under the field they worked in, and both
are defensible, so the categories overlap. The areas use one axis, field of
study, roughly what a university department teaches. The changes from Level 3:

- **People** is removed. A subject or theme about a person is placed in the
  field of their work: Keynes in Economics, Newton in Physics.
- **Geography** is split. Physical geography (continents, oceans, rivers) goes to
  Earth sciences. Countries and cities are placed by what the writing about them
  covers: their history in an era, their government in Politics. Writing about a
  place in general goes to Human geography.
- **History** stays, holding events, states, wars and eras. The history of a
  particular field belongs to that field.
- **Everyday life** is removed. Sport goes to Sport and games, food to Food and
  cuisine or to Public health, family to Sociology and anthropology.
- **Science** is split into Physical sciences and Life sciences, which are
  different departments with little shared teaching. **Health, medicine and
  disease** becomes Health and medicine, and the healthy body moves to Life
  sciences, because it is studied separately from disease.
- **Language and literature** is its own domain. Level 3 spreads it across Arts
  and Society.

## The list

The authoritative copy is the database, seeded by
`supabase/migrations-learn/0027_areas.sql` and revised by `0030_area_rules.sql`,
where each field also carries a scope sentence. This is the same list for
reading.

| Domain | Fields |
|---|---|
| 1. Mathematics and logic | Logic, foundations and discrete mathematics · Algebra and number theory · Geometry and topology · Analysis and calculus · Probability and statistics |
| 2. Physical sciences | Physics · Chemistry · Astronomy and space science · Earth sciences |
| 3. Life sciences | Molecular and cell biology · Organisms and evolution · Anatomy and physiology · Ecology and environment |
| 4. Health and medicine | Disease · Treatment and medical practice · Mental health · Public health, nutrition and fitness |
| 5. Technology and engineering | Computing · Electrical engineering and communications · Mechanical engineering, construction and materials · Energy · Transport · Agriculture and food production |
| 6. Social sciences | Psychology · Economics, business and finance · Politics and government · Law, crime and justice · Sociology and anthropology · Human geography |
| 7. History | Prehistory and the ancient world (to about 500 CE) · Medieval and early modern (500 to 1800) · The modern era (1800 to 1945) · The contemporary era (1945 to now) · World and regional history (anything spanning more than one era) |
| 8. Philosophy and religion | Metaphysics, epistemology and philosophy of mind · Ethics and aesthetics · Political and social philosophy · Religion and mythology |
| 9. Language and literature | Linguistics and languages · Literature · Media and journalism |
| 10. Arts and culture | Visual arts and design · Music · Performing arts and film · Architecture · Sport and games · Food and cuisine |

## Boundary rules

The fields are exclusive only if every overlap has a rule. These are the ones a
placement pass will meet most often. Each is also written into the scope of the
field on the receiving side, so the model placing a subject reads the rule
directly.

| Overlap | Rule |
|---|---|
| The history of a field, and History | The history of economics goes to Economics. History holds events, states, wars and eras. |
| Formal logic, and philosophy | All formal logic goes to Logic, foundations and discrete mathematics. |
| Political philosophy, and Politics | What government ought to be goes to Political and social philosophy. How it actually works goes to Politics and government. |
| Psychology, and Mental health | How the mind works goes to Psychology. Disorders and their treatment go to Mental health. |
| Physiology, and disease | The healthy body goes to Anatomy and physiology. Disease goes to Health and medicine. |
| Climate, and ecology | Physical climate goes to Earth sciences. Its effects on living things go to Ecology and environment. |
| Spaceflight, and astronomy | Spacecraft go to Transport. What is out there goes to Astronomy. |
| Architecture, and construction | Design and style go to Architecture. How buildings are built goes to Mechanical engineering, construction and materials. |
| Plays, and performance | The text goes to Literature. Staging goes to Performing arts and film. |
| Food | Growing it goes to Agriculture. Eating well goes to Public health, nutrition and fitness. Cooking and cuisine go to Food and cuisine. |
| Weapons, and war | Weapons go to Mechanical engineering, construction and materials. Wars go to History. |
| Chemistry of living things | Biochemistry goes to Molecular and cell biology. |
| Econometrics | Goes to Economics, not Probability and statistics. |
| Continents, and natural features | Continents and world regions go to Human geography. Seas, rivers, lakes, mountains and deserts go to Earth sciences. |
| Ideologies, and states | An ideology as a body of ideas goes to Political and social philosophy. States, parties and elections go to Politics. |
| Foods, and farming | A food or drink as eaten goes to Food and cuisine. Growing or raising it goes to Agriculture. |
| Domesticated, and wild species | Crops and livestock go to Agriculture. Wild species go to Organisms and evolution. |
| The mind, and relationships | The individual mind goes to Psychology. Relationships, family and life stages go to Sociology and anthropology. |
| Materials, and substances | A material as made and used goes to Mechanical engineering, construction and materials. Substances and reactions go to Chemistry. |
| Leaders and events, and Politics | Historical leaders and events go to the era they happened in. |
| A span across an era boundary | An empire, war or movement goes to the era it began in. One spanning more than one era as a whole goes to World and regional history. |

When a subject meets an overlap with no rule here, the placement pass records
that as a finding, and the rule is added to this table and to the field's scope
in a migration.

## Placement

Two things get placed, each in exactly one field, or, when it covers a whole
domain, in that domain.

**Umbrella placements.** Some subjects are the whole of a domain rather than
a part of it: Technology, The arts, Philosophy. Forcing one into a field
misfiles it, so it is placed at the domain instead. The check placed eighteen
of the thousand Level 3 articles this way. Three of those (Science, History of
science, Nature) span more than one domain and were placed at Physical
sciences only as the least bad choice. A subject like that is left unplaced,
because there is nothing above a domain to put it in.

**Subjects.** `learn.subjects` gains a nullable `field_id` and a nullable
`domain_id`, at most one of them set. A subject is placed
when it is created, by one short model call given the subject's name, its note
and every field's scope. The call returns a field and a sentence of basis. A
subject narrower than a field, such as Keynesian economics, is placed in the
field that contains it. A subject that straddles two fields is placed in the
one where most of its concepts would be taught, and the concepts that belong
elsewhere are what `concept_subjects` already exists for.

**Themes.** Learn never writes to the vault map, so a theme's placement lives in
Learn: a `learn.theme_fields` table holding the account, the theme, the field
or domain, and a basis. It points at `obsidian.themes` the way `quiz_sources` points at
`obsidian.notes`, with an ownership check on insert. Themes are placed by the
same call after each vault sweep, and only themes with no placement are sent.

Both placements can be moved by hand from the Know page, and a moved placement
records that you moved it so the pass never overwrites it.

At about a tenth of a cent per call, placing every subject and theme costs
under a dollar at the size the vault map is now.

## The dashboard

The Know page gains a view of the grid: one row per domain, and one cell per
field inside it. Each cell shows two signals side by side.

| Signal | Read from | Shown as |
|---|---|---|
| Interest | The `strength` of the themes placed in the field | A shade, and the names of the strongest two themes |
| Tested knowledge | Concept states in subjects placed in the field | Settled out of total, and the date of the last answer |

Together they sort each field into one of four kinds:

- **Interest and tested knowledge.** The fields you are strong in.
- **Interest with little tested.** You write about it and have not been asked
  about it. This is the most useful cell on the page, because it is where your
  notes may make you feel you know more than you have shown.
- **Tested and shaky.** Known gaps, which `/learn/next` already works through.
- **Neither.** Drawn faded. Visible, and not flagged as a problem.

Two rules carry over from the specs this sits under.

**Interest never adds to strength.** The two signals stay in separate columns
and are never combined into one score. KNOWLEDGE-SPEC removed the idea that
writing about something counts as knowing it, and a combined score would bring
it back.

**Every count shows its size and its date.** "14 of 20 settled, last answered
in March" and never a bare 70%. The progress bar in LEARN-GRAPH-SPEC refuses to
claim more precision than the answers support, and the grid follows it.

Domain totals are the sums of their fields, plus whatever was placed at the
domain itself. That works because every placement names exactly one of a
field or a domain, so nothing is counted twice. An umbrella placement shows on
the domain's row and in none of its cells.

## What to do next

`/learn/next` gains a fourth kind of row: **a field you write about and have
never been tested in.** A field qualifies when the themes placed in it are
among your strongest and no subject placed in it has a single answered
question. The row offers what the page already offers when it is empty, naming
a goal, scoped to that field. It says why it is there in one line, like every
other row.

The fourth kind takes its turn with the other three, as the existing rows do.
Its own order is by interest, strongest first.

## Schema

`0027_areas.sql` creates the grid and seeds it, and `0030_area_rules.sql` adds
World and regional history and the boundary rules from the check. Placement is
the next migration.

| Table | Holds |
|---|---|
| `area_domains` | The ten domains: slug, name, scope, display position |
| `area_fields` | The 47 fields: domain, slug, name, scope, position within the domain |

Both tables carry no `user_id`. Signed-in accounts can read them and cannot
write them, which is the catalogue's shape for shared reference data. A field
that one account could rename would stop being fixed, and being fixed is the
reason the grid exists. Two tables, where one self-referencing table would also
work, because a plain foreign key from field to domain makes a third level
impossible to add by accident.

`slug` is the stable handle. A later migration may reword a name or a scope
without breaking anything that points at a field.

## Checking the list is exclusive and complete

The list was drafted from Level 3's structure, without placing its thousand
articles. Before placements accumulate, a script should place every Level 3
article into one field, or mark it as a person, place or work and place it by
what it is known for.

- An article the model cannot place shows a field is missing.
- An article it places in two fields with equal confidence shows a boundary rule
  is missing.
- A field that receives almost nothing is a candidate to merge.

Findings become a migration that edits the grid. It is cheaper to run now than
after subjects and themes point at the fields, because moving a field then
means placing everything in it again.

It runs in the app, because the app can reach `en.wikipedia.org`.
`/api/cron/area-check` loads the Level 3 list into `learn.area_check_articles`
on its first call and places unplaced articles until its time is up on every
call, so it is called until it reports nothing remaining. It has no schedule:
it is fired by hand through `pg_net` with the vault's `app_origin` and
`cron_secret`, the pair the map sweep's tick already uses. Placement is one
Opus call per forty articles, about twenty-five calls for the whole page,
recorded as `check-areas` in the spend ledger.

Each finding is a query over that table: `confidence = 'none'` for a missing
field, `confidence = 'close'` for a missing boundary rule, and a count by
`field_id` for fields that receive almost nothing.

## What the check found

It ran twice on 22 September 2026, both times over all 1,001 articles on the
Level 3 page.

| | First run, grid from 0027 | Second run, after 0030 |
|---|---|---|
| One field clearly fits | 620 | 725 |
| A second field fits nearly as well | 358 | 267 |
| No field fits | 23 | 9 |
| Cost | $2.14, 26 calls | $0.95, 10 calls (the 381 not clear the first time) |

The first run's 23 unplaceable articles fell into three groups, and 0030 answers
each:

- **Histories that span every era**, such as the histories of Europe, Africa,
  Asia and the Americas, and Human history. The four era fields cannot hold any
  of them whole. 0030 adds World and regional history, which settles the
  era-or-region question in the open questions below: eras for anything inside
  one, and one field for anything across several.
- **Umbrellas over a whole domain**, such as Technology, The arts and Western
  philosophy. 0030 lets these be placed at the domain.
- **Small gaps**: libraries, instruments, clothing, calendars, old age. Each is
  now named in an existing field's scope.

The eight pairs the model most often could not choose between each got a rule
(the last eight rows of the boundary table), and every one shrank. The largest
went from 16 to 8 (continents and natural features) and from 13 to 8
(ideologies and states).

Most of the 267 close calls left are articles that really do belong to two
fields: Gauss to algebra and to analysis, Marie Curie to chemistry and to
physics, Photosynthesis to cell biology and to physiology. A boundary rule
cannot settle those, and does not need to. A subject is placed in one field,
and the concepts in it that belong to the other are what `concept_subjects`
exists for.

The nine articles still unplaced are the three that span more than one domain
(Science, History of science, Nature), which the umbrella rule above leaves
unplaced, and six cross-cutting ideas that no fixed grid will hold
cleanly: Research, Information, Communication, Eastern philosophy, Famine, and
the Red Cross. They are recorded rather than fixed.

Two fields remain thin, Probability and statistics and Architecture, with two
articles each. Both are kept. Level 3 gives 190 of its 1,001 articles to History and
Geography, so a thin field here says more about the list than about the field.

## Build order

1. ✅ **The grid.** `0027_areas.sql`: two tables, seeded, read-only to accounts.
2. ✅ **The check against Level 3.** `0028_area_check.sql` and
   `/api/cron/area-check`, which place the thousand articles and leave the three
   kinds of finding above in a table. Any changes to the grid land as a
   migration.
3. **Placement.** `subjects.field_id`, `theme_fields`, the placement call, and
   moving a placement by hand.
4. **The grid on the Know page.** The two signals per field and the four kinds.
5. **The fourth row on `/learn/next`.**

## Open questions

- **History by era or by region.** Settled by the check: eras for anything
  inside one, World and regional history for anything across several. What
  remains is that "medieval" means different centuries in China and in Europe,
  which the era boundaries at 500 and 1800 do not attempt to fix.
- **Sport and food under Arts and culture.** Neither fits anywhere else, and a
  domain for everyday life would bring back the axis this list removes.
- **Media and journalism under Language and literature.** It could sit in
  Sociology and anthropology. It is here because journalism is mostly practised
  as writing.
- **What counts as "among your strongest" for the fourth row.** A fixed share of
  total theme strength, or the top few fields. Wants settling against the real
  vault map once themes are placed.

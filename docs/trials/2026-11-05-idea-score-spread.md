# Vault idea scores: spread and repeat (5 November 2026)

Plan #2947.4. Thirty map ideas were sorted and scored twice by Jev with
`scoreIdea` (lib/vault/map/idea-score.ts, rubric `idea-score-2026-11-v1`,
model `jev-1.13.0`), to see whether the scores spread out and hold still
before they reach the Map. Nothing was written to the database.

Novelty was judged against the ten-level rubric #2947.2 wrote from the
step's description. The 4 November trial's own 1-to-5 wording was never
saved, so the two are not the same rubric.

## The sample

The trial's list of 30 was not saved either. This sample is drawn the way the
step describes, by `md5(id || 'score30')`, over the held positions of kind
`position` (1,166 rows, the "about 1,200" the feature names). Its #17 is a
story motif, #13 and #19 read as product requirements and #26 as rubric text,
which fits what the trial found at those numbers, so it is very likely the
same 30.

```sql
with sample as (
  select p.id, p.statement, p.basis,
         row_number() over (order by md5(p.id::text || 'score30')) as n
  from obsidian.positions p
  where p.user_id = :owner and p.kind = 'position' and p.stance = 'held'
  order by md5(p.id::text || 'score30')
  limit 30
)
select s.n, s.id, s.statement, s.basis,
  (select json_agg(json_build_object('quote', ps.quote, 'note',
            json_build_object('title', nt.title, 'path', nt.path, 'voice', nt.voice))
          order by ps.created_at)
   from obsidian.position_sources ps
   join obsidian.notes nt on nt.id = ps.note_id and nt.user_id = :owner
   where ps.position_id = s.id and ps.user_id = :owner) as sources
from sample s order by s.n
```

Run it with `npx tsx scripts/sql.ts --file`, save the output, and pass it to
`npx tsx --conditions react-server scripts/idea-score-check.ts <sample.json> <rules.json>`.

## Results

| # | type, run 1 / run 2 | usefulness | novelty |
| ---: | --- | --- | --- |
| 1 | own idea | 36, 36 | 7, 8 |
| 2 | design | 46, 47 | 17, 18 |
| 3 | own idea | 8, 7 | 3, 3 |
| 4 | design | 33, 34 | 14, 15 |
| 5 | own idea | 40, 40 | 20, 18 |
| 6 | own idea | 29, 28 | 6, 6 |
| 7 | own idea | 19, 19 | 8, 8 |
| 8 | someone else's | | |
| 9 | someone else's | | |
| 10 | design / own idea | 51, 50 | 17, 17 |
| 11 | requirement | | |
| 12 | own idea | 23, 24 | 23, 24 |
| 13 | design | 30, 31 | 17, 17 |
| 14 | own idea | 43, 43 | 6, 6 |
| 15 | design | 46, 47 | 25, 25 |
| 16 | own idea | 14, 13 | 28, 28 |
| 17 | own idea / design | 25, 25 | 28, 28 |
| 18 | own idea | 57, 57 | 17, 17 |
| 19 | design | 28, 29 | 16, 15 |
| 20 | design | 63, 63 | 27, 26 |
| 21 | own idea | 42, 43 | 16, 16 |
| 22 | someone else's | | |
| 23 | someone else's | | |
| 24 | own idea | 48, 48 | 12, 13 |
| 25 | design | 55, 55 | 15, 15 |
| 26 | requirement | | |
| 27 | own idea | 13, 12 | 3, 3 |
| 28 | own idea | 28, 28 | 20, 20 |
| 29 | requirement | | |
| 30 | own idea | 17, 16 | 6, 6 |

**Spread.** 23 of the 30 were scored in both runs. Usefulness ran from 8 to
63 (7 to 63 in the second run); by bands of 20 it was 5, 8, 9, 1 and 0.
Novelty ran from 3 to 28 in both runs, 25 points of the range; by bands of 20
it was 16, 7, 0, 0, 0 in the first run and 17, 6, 0, 0, 0 in the second.
Jev's likeliest novelty level was 0 to 3 for every idea, and no idea put
more than 7% on level 6 or above.

**Repeat.** All 23 ideas were within 5 points on both scores; the largest
difference was 1 on usefulness and 2 on novelty. The type was the same in
both runs for 28 of 30. #10 and #17 moved between own idea and design, which
are both scored, so no score was lost.

**Types.** The gate dropped seven ideas: #8, #9, #22 and #23 as someone
else's idea, and #11, #26 and #29 as requirements. Of the seven the trial
said were not the person's own ideas, it dropped only #26. It kept #17 (a
story motif: the five types have no place for fiction), #13 and #19 (sorted
as designs rather than requirements), #21 (from a job application, whose
passage is held back by voice, so Jev saw only the one-line summary), and
#18 and #25.

**Cost.** 60 requests took 118,284 input and 5,504 output tokens, about 2,000
a request.

## Verdict

Repeat passes. Novelty fails: it uses 25 points of the range where the check
asked for 50, so the ten levels and the note's passage did not spread it out.
The type gate fails too, dropping one of the trial's seven. The question of
what to do about novelty is #2947's decision, and the Map list waits on it.

## Re-check after the type question changed (plan #2947.7)

Rubric `idea-score-2026-11-v2`. The type options now say that a story's
characters, motifs and worlds are descriptions, that a product's or role's
"should" and "must" lines are requirements (a general claim with "should" in
it stays the writer's own idea), and that a project design is a design of a
place, institution or rules, not an app feature. An idea with sources, none of
which may be sent, is stored as `others_idea` with no scores and no request.
The same 30 ideas, scored twice (`jev-1.13.0`):

- Of the trial's seven: #13 and #19 now requirement, #17 description, #21 and
  #26 withheld or others_idea, so five are dropped. #18 (large votes made hard
  by design) and #25 (a gradient from public squares to hidden side streets)
  are sorted as project designs in both runs and keep their scores; each is the
  writer's design of a governance or a place, and the question was not bent to
  drop them.
- Scored in both runs: 10 of 30 (11 in run 2, where #5 moved from requirement
  to own idea). Usefulness 7 to 62, novelty 3 to 28, all within 2 points
  across runs. Same type in both runs: 29 of 30.
- Six more ideas, all from application notes, were stored without a request
  (#7, #12, #24, #27, #28, #30), and requirement took #2, #4, #11, #29 and in
  run 1 #5. Fewer ideas keep a score than before (10 against 23), which
  matters for novelty's spread: it is still 3 to 28.

## Re-check with the paragraph around each quote (plan #2947.8)

Rubric `idea-score-2026-11-v3`, model `jev-1.13.0`. The person answered A on
#2947.6: keep the ten novelty levels and their wording, and give Jev more of
the note. Each passage now carries the quoted sentence and, beside it, the
paragraph around the quote in the note as it stands, widened to its
neighbours in the same section up to 1,500 characters (`paragraphAround`).
All three questions read it. Secret, audience-only and journal notes are
still never sent, and a paragraph that looks like it holds a key is held
back with its quote.

The sample is the same 30, drawn by the query above with one change: each
note in `sources` also carries `'body', nt.body`, so the paragraph can be
cut from it. Of the 36 sources, 35 quotes were still in their note; #13's
note has changed since its quote was taken, so it sent the quote alone.
24 passages were sent in all, 23 of them with a paragraph, 174 to 1,500
characters long (median 921).

| # | type, run 1 / run 2 | usefulness | novelty |
| ---: | --- | --- | --- |
| 1 | own idea | 42, 42 | 11, 11 |
| 2 | requirement | | |
| 3 | description | | |
| 4 | requirement | | |
| 5 | own idea | 44, 45 | 26, 27 |
| 6 | own idea | 33, 33 | 8, 7 |
| 7 | withheld | | |
| 8 | someone else's | | |
| 9 | own idea | 50, 50 | 12, 13 |
| 10 | own idea | 54, 54 | 24, 23 |
| 11 | requirement | | |
| 12 | withheld | | |
| 13 | requirement | | |
| 14 | own idea | 46, 45 | 11, 11 |
| 15 | design | 47, 46 | 26, 26 |
| 16 | description | | |
| 17 | own idea / description | 26, - | 34, - |
| 18 | someone else's | | |
| 19 | requirement | | |
| 20 | design / own idea | 60, 61 | 30, 30 |
| 21 | withheld | | |
| 22 | someone else's | | |
| 23 | someone else's | | |
| 24 | withheld | | |
| 25 | design | 56, 58 | 27, 26 |
| 26 | withheld | | |
| 27 | withheld | | |
| 28 | withheld | | |
| 29 | requirement | | |
| 30 | withheld | | |

"Withheld" is an idea none of whose passages may be sent, stored as someone
else's idea with no request.

**Spread.** Novelty ran from 8 to 34 in the first run (10 ideas scored) and
7 to 30 in the second (9), 26 and 23 points of the range; by bands of 20 it
was 4, 6, 0, 0, 0 and 4, 5, 0, 0, 0. Jev's likeliest novelty level was 0 to 3
for every idea, as before, and no idea put more than 3% on level 6 or above.
The most any idea put on level 4 or above was 32% (#17). Usefulness ran from
26 to 61.

**Repeat.** All 9 ideas scored in both runs were within 2 points on both
scores. The type was the same in both runs for 28 of 30: #17 moved from own
idea to description, so it lost its scores in run 2, and #20 moved between
design and own idea, which are both scored.

**Types.** The paragraph moved some types against v2: #3 and #16 went from
own idea to description, #18 from design to someone else's idea, and #9 from
someone else's idea to own idea. Ten ideas keep a score, as in v2.

**Cost.** 44 requests (16 of the 60 were withheld and not sent) took 106,092
input and 4,033 output tokens, about 2,400 input tokens a request against
about 2,000 with the quote alone. At Jev's $0.042 a million input tokens the
two runs cost under half a cent.

### Verdict

Novelty still fails. With the paragraph it spans 26 points (8 to 34), against
25 (3 to 28) from the quote alone and the 50 the check asked for. The whole
range moved up about 5 points; it did not open out. Repeat still passes.

Widening further or rewriting the novelty levels is not done here. #2947.6
named its option B as the fallback, and that changes what novelty means, so
it goes back to the person as a new question.

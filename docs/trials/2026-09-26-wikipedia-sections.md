# Trial: Wikipedia sections against one subject's claims

Run 2026-09-26 by a session working from the live catalogue, for plan #760.
The question was whether a whole Wikipedia section is the right amount of text
to match against one claim. This note is written from that session's report,
which is the Claude comment on #760 dated 26 September.

**The run did not match the step as written, in three ways.**

- **The judge was not Haiku.** Claude Code sessions have no
  `ANTHROPIC_API_KEY`, so the session read each candidate section itself
  against the judge's own prompt. This tests whether a section holds the
  teaching a claim needs. It is not evidence of how Haiku rules on the same
  sections.
- **The subjects were not Thermodynamics.** That subject and its claims had
  been deleted by then, and no subject in the account had fifteen claims. The
  run used two: Tell (archaeology) and Reciprocity (social psychology), with
  25 claims between them. The done-when asks for one subject. The figures
  below are for the two together, because the report did not split them.
- **Nothing was recorded in #766's table.** `learn.catalogue_judgements`,
  `learn.catalogue_links` and `concepts.catalogue_searched_at` were left
  untouched, because rows there would say Haiku made calls it did not make.
  The counts below come from the session's report, not from a query.

---

## Setup

Neither subject's article had vectors, so the session embedded its 30
sections with Voyage `voyage-4-lite` as documents (6,733 tokens) and the 25
claims as queries (742 tokens). Those vectors were not saved, and the spend
was not written to `core.model_spend`. Every section at similarity 0.5 or
above became a candidate, as in the app. Candidates were also drawn from the
2,137 sections already embedded in the catalogue, using the claims' stored
vectors.

## Results

| | |
| --- | --- |
| claims | 25 |
| claims with at least one candidate | 21 |
| candidate sections judged | 72 |
| accepted | 22 (31%) |
| accepted from the claim's own article | 22 of 54 |
| accepted from any other article | 0 of 18 |
| claims left with an accepted section | 13 of 25 |

Acceptance by section length:

| section length | accepted |
| --- | --- |
| under 300 characters | 0 of 13 |
| 300 to 700 | 5 of 17 (29%) |
| 700 to 1,200 | 5 of 15 (33%) |
| 1,200 to 1,800 | 3 of 15 (20%) |
| 1,800 to 3,000 | 9 of 12 (75%) |

The top row of length is less than it looks: 8 of its 9 acceptances are one
section, Reciprocity's "Positive and negative reciprocity" (2,669 characters).

## What the numbers show

**Short sections score high and are never accepted.** Urban sprawl's
"Characteristics" section is 150 characters, one sentence introducing a list.
It scored 0.50 to 0.62 against 11 of the 13 Tell claims, higher than the Tell
article's own sections for several of them. "See also" and "External links"
sections behaved the same way.

**Long sections hold the teaching but score under the floor.** For 11 claims,
a section that teaches the claim scored under 0.5 and was never judged. The
Tell lead (1,049 characters) says in one sentence that Alexander's conquest
ended the tells; the five claims about the conquest reach it at
0.33 to 0.42. "Positive and negative reciprocity" covers free samples, tips
and retaliation in law, and still scores 0.44 to 0.48 against the three claims
on those topics. The sentence a claim needs is diluted by the rest of a
section about several things. Only one claim, tell height as a measure of a
site's duration, had no section anywhere that teaches it.

Both kinds of miss happen at retrieval, before the judge reads anything.

## Conclusion

**Keep the section as the unit a link points at and the judge reads. Cut
articles differently for retrieval.**

- Embed paragraph passages of about 300 to 800 characters, each mapped back to
  its section, and match claims against those. A candidate passage brings its
  whole section to the judge.
- Do not embed sections under about 300 characters, or sections headed "See
  also", "External links" and the like.

Plan steps #1131 (stop matching stubs and link lists), #1132 (match against
paragraphs inside sections) and #1133 (cut paragraphs for the articles already
pulled in) were written from this.

---

## What this does not tell you

- **Whether Haiku's verdicts match.** This is the open question. The first
  real presses of the read button will record Haiku's verdicts in
  `learn.catalogue_judgements`, and comparing them with the 22 of 72 here will
  show whether the judge in the app is stricter, looser or the same.
- **Whether the pattern holds per subject.** Two subjects were pooled, and
  one Reciprocity section carries most of the long-section acceptances.
- **Whether passages fix the misses.** The 11 claims whose teaching section
  scored under the floor are the test for #1132: after it, each should reach
  its section through a passage.

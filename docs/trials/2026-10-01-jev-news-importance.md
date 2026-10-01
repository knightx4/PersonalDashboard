# Trial: should Jev rate how important a news story is

Run 2026-10-01 on the plan owner's newsletters, for plan #1170, before moving
story importance off Haiku. Jev (`jev-1.13.0`) was asked the importance
question about every story Haiku had already rated, 828 stories from 110
newsletters, and nothing was written. Every call answered. The 828 calls read
508,877 input tokens, about two cents.

**Result: Jev rates importance better than Haiku, but the 0.8 confidence floor
would keep two thirds of stories on Haiku.** Where the two disagree by two
points or more, Jev is right in most cases. It also does what the question
asks and ignores where the newsletter put the story, which Haiku does not.
Its answers on a five-level scale are rarely confident, though: only 264 of
the 828 clear 0.8. To move importance onto Jev, the floor for this question
has to come down.

## How it was run

`scripts/importance-jev-trial.ts` reads a file of stories and asks Jev what
the hourly catch-up would ask, using `lib/news/issues/importance-jev.ts`: the
same question, the same state (topic, headline and summary) and the same
mapping from Jev's level to a rating of 1 to 5. It compares the answer with
the rating Haiku stored.

The export, in four pages of about 200:

```sql
with all_s as (
  select i.id issue, (s.ord-1)::int pos, s.v->>'topic' topic,
         s.v->>'headline' headline, s.v->>'summary' summary,
         (s.v->>'importance')::int haiku
  from news.issues i, jsonb_array_elements(i.stories) with ordinality s(v, ord)
  where jsonb_typeof(i.stories) = 'array' and s.v->>'importance' is not null)
select json_agg(json_build_object('i', left(issue::text, 8), 'p', pos, 't', topic,
                                  'h', headline, 's', summary, 'r', haiku))
from (select * from all_s
      order by (haiku = 5) desc, md5(issue::text || pos::text || 'imp-trial')
      offset 0 limit 200) x;
```

There is no reference labelling. I read every story where the two were two or
more points apart, and every story either one rated 5, and judged which rating
fits the rubric.

## How the ratings compare

Haiku's rating down, Jev's across, all 828 stories:

| Haiku |   1 |   2 |   3 |   4 |   5 |
| ----: | --: | --: | --: | --: | --: |
|     1 |  37 |  40 |  12 |   0 |   0 |
|     2 |   5 |  57 | 187 |  22 |   0 |
|     3 |   0 |   9 | 197 |  84 |   0 |
|     4 |   0 |   5 |  71 |  89 |   7 |
|     5 |   0 |   0 |   4 |   1 |   1 |

381 are the same, 785 are within one point, and 43 are two or more apart. The
correlation between Haiku's rating and Jev's probability-weighted score is
0.70.

Jev gives a 3 to 471 stories (57%), against Haiku's 290 (35%). It spreads
ratings less: a standard deviation of 0.78 against Haiku's 0.94.

## Where the newsletter put the story

| Mean rating | Lead story | The rest |
| ----------- | ---------: | -------: |
| Haiku       |       3.41 |     2.57 |
| Jev         |       3.06 |     3.01 |

Haiku rates a story almost a point higher when it leads its newsletter. Jev
rates them the same. The question tells both to judge the event and not its
placement. Haiku rates the whole newsletter in one call and sees the order, so
the lead gets a boost that Quick read then counts a second time.

## Where they disagree

**Haiku's six 5s.** Jev agrees on one, the Supreme Court's 7-2 ruling on mail
voting. Three of the other five are lead stories that analyse the midterms
("Republicans pulled under by 'red undertow'", "Trump's wage-and-cost blues
threaten midterm prospects"). They are commentary on polling, not events, and
Jev's 3 fits the rubric better. The remaining two are events: a DOJ warning to
prosecutors, which Jev rates 4, and the White House barring three news
outlets, which Jev rates 3 and which deserves at least a 4.

**Jev's eight 5s**, most only a point above Haiku. Four are the US withdrawal from Iraq, as reported by
different newsletters, and Haiku gives every one a 4. The end of a 22-year
military presence is front-page news, so Jev's 5 fits. Two are the
mail-voting ruling, which Haiku rated 5 in one newsletter and 4 in another.
The last two are Netanyahu's speech at the UN and a global bond selloff that
pushed Treasury yields above 5%.

**Haiku 4, Jev 2 (five stories).** All five are essays: a Bulwark column, Jim
VandeHei's letter to his children, two pieces on AI and concentrated power,
and a proposal for AI governance. None reports an event. Jev is right.

**Haiku 2, Jev 4 (22 stories).** Most are real news that sat low in a long
newsletter: the Senate voting down an Iran war powers resolution, the FTC
probing AI labs, the NRC approving a small modular reactor, the Senate
passing a college NIL bill, the administration appealing a deportation ruling
to the Supreme Court, and Saudi Arabia shooting down six Houthi missiles. Jev
is right on most of them. It is wrong on one: "How Federal Reserve rate hikes
affect the economy" is an explainer, and Haiku's 2 fits.

**Haiku 1, Jev 3 (12 stories).** Here Haiku is right more often. Two
celebrity memoirs (Bob Chapek's, Charles Spencer's), a George Lucas museum
opening and the MLB wild card round are light items. Jev's 3 is too high for
them, though a 3 sits near the middle and costs them little in the ranking.
The Mamdani and Trump meetings and the Burundi deportation agreement are
closer calls.

Of the 43 stories two or more points apart, Jev is the better judge of about three in four.

## How sure Jev is

| Confidence at or above | Stories (of 828) |
| ---------------------: | ---------------: |
|                    0.5 |              812 |
|                    0.6 |              733 |
|                    0.7 |              522 |
|                    0.8 |              264 |
|                    0.9 |               49 |

`decideWithJev` keeps an answer at 0.8 or above and sends the rest to Haiku.
On a five-level score, confidence is spread across neighbouring levels, so it
runs lower than on a yes/no question. At 0.8, 564 stories would still be rated
by Haiku, in the catch-up call that reads only the headline and summary. Of
the 264 that clear 0.8, 141 match Haiku and only 6 are two or more apart.

## What to change

1. Stop the digest call from rating stories, so every new story goes through
   the Jev step in `importance.ts`.
2. Lower the floor for this question to 0.5 (812 of 828 stories), or accept
   any answer Jev gives and use Haiku only when the call fails. A wrong
   ranking costs much less than a misrouted email, and Jev's score already
   weighs its uncertainty.
3. With Jev using 3 more often, importance will move stories less, and
   freshness and coverage will carry more of Quick read's order. Check how the
   first week looks before retuning `IMPORTANCE_STEP`.

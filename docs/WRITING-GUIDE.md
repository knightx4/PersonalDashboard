# Professional writing guide

The standard every document in `docs/` is written to, and the standard a session
should apply to anything it writes here: specs, commit messages, plan detail,
comments on the dev pages, and replies from Dash.

It started as a rubric for spotting AI slop after the fact. It is more useful
applied while writing, which is what it is for here.

## Reward

- Direct, precise language that communicates ideas without unnecessary
  complexity.
- Natural phrasing and appropriate terminology for the audience.
- Concise writing that preserves meaning and avoids redundancy.

## Penalize

- Confusing, awkward, vague, or unnecessarily elaborate language.
- Generic or repetitive AI-generated filler, empty slogans, and self-referential
  text.
- Overuse of jargon, large words, formulaic phrasing, or excessive punctuation
  when simpler language would work.

## Failure modes

Treat all of these as contextual signals, not forbidden tokens. Penalize a
pattern when it is conspicuous, repeated, unearned, or harmful to the writing;
do not reject an otherwise strong piece because of one isolated phrase or
punctuation mark.

## 1. Formulaic, slogan-like or figurative language

**Flag when:** the underlying claim is understandable, but it is packaged as a
stock formula, slogan, staged cadence, canned emotional phrase, or strained
metaphor, instead of clear analysis. This includes repeated colons, semicolons,
or em dashes used to manufacture rhythm or emphasis rather than clarify meaning.

Examples of bad writing:

- **Inflated contrast:** "This isn't just a calendar - it's a gateway to a more
  intentional life." Or "Data access is not a background detail. It's the heart
  of the user experience."
- **Overuse of odd words that don't make sense:** "Proceed only when five
  readiness gates are green" to refer to criteria for a diligence deck.
- **Overusing parallelism and semicolons:** "The old request drew a boundary
  around hotspots; the new request removes that map layer." Or "Early
  restrictions were zone-based; the late-December version removes the map as the
  control surface." The second is also unclear about what "control surface"
  means.
- **Unnecessary em dashes:** "Purpose: isolate what changed – and what
  deliberately stayed in place – under Osaka Prefecture's Red Stage emergency
  response." Don't use repeated punchy contrast or interruption built from em
  dashes if plain sentences would read better.
- **Stock formula:** "The tool not only saves time, but also transforms how
  teams collaborate." Or "faster, smarter, and more intuitive."
- **Slogan-like transition or fragment:** "From paper-bound practicals to a
  shared digital workspace." Or "One team. One vision. Limitless possibilities."
  Or "Win the close. Keep the evidence." Or "Pipeline is flat. Spend isn't." Or
  "EBITDA is not cash. Bridge it." Or "this is not just another X. The better
  framing is Y." Or "It's not X it's Y."
- **Overusing colons:** "Universities: reinforce guidance. Students: reduce
  social activity. Everyone: keep the year end quieter."
- **Staged cadence or punctuation:** "Different sectors, same behavioral logic:
  reduce optional contact where consequences are highest."
- **Canned empathy:** "I completely understand how frustrating and overwhelming
  this situation must feel."
- **Synthetic balance without a real tradeoff:** "While remote work offers
  flexibility, it also presents unique challenges."
- **Mannered parallelism or punctuation:** "The problem is clear: priorities are
  shifting; timelines are slipping; confidence is fading — and the moment for
  action is now."
- **Inflated significance:** turning mundane facts into claims about legacy,
  identity, broader trends, pivotal moments, or an "evolving landscape."
- **Promotional or travel-guide tone:** unrequested salesy praise,
  destination-copy atmosphere, or reflexive adjectives such as "vibrant,"
  "rich," "renowned," "groundbreaking," or "nestled."
- **Vague authorities and synthetic consensus:** unsupported appeals such as
  "experts argue," "observers note," "scholars say," or "several sources
  suggest."
- **Canned endings:** generic "challenges," "legacy," or "future outlook"
  conclusions that do not arise naturally from the content.
- **Repeated rhetorical triads:** habitual sets of three adjectives, abstract
  nouns, clauses, or examples that make the prose feel manufactured.
- **Overlong parallel enumerations:** piling up rhythmic catalogues of
  who/what/where clauses, examples, or abstract nouns to simulate exhaustiveness
  or momentum after the point is clear. Penalize conspicuous accumulations
  unless the task genuinely needs the list.
- **Repeated negative parallelism:** "not X, but Y," "not only X, but also Y,"
  "not just X, but Y," or "no X, no Y, just Z."
- **Dense clusters of AI-associated vocabulary:** "delve," "pivotal," "robust,"
  "tapestry," "underscore," "showcase," "foster," "intricate," "landscape,"
  "testament," "vibrant."
- **Mechanical bold-label bullet lists:** repeated bullets of the form
  `**Label:** explanation` when that structure is not useful or requested.

**Do not flag:** a construction that states concrete distinctions, gives a clear
warning, or quotes an identified source. Example: "The bug is in the parser, not
the tokenizer." Do not flag parallel structure or punctuation that clearly
separates a real list, contrast, or logical relationship. Example: "The red
light means stop, and the green light means go."

## 2. Vague, inflated, or unsupported substance

**Flag when:** the reader cannot tell what changed, why the benefit follows,
what evidence supports the claim, or what reason drove the decision. The
specific rationale cannot be recovered because evidence, causality, actors, or
observable meaning are missing.

Examples of bad writing:

- **Empty abstraction:** "This unlocks value, fosters alignment, and drives
  meaningful impact." Or "Labor costs push it; few have it; so it grows faster."
  Or "Breadth plus intelligence, not the original module, is where growth now
  comes from."
- **Unclear meaning:** "Everyday computer work gets the same agentic loop."
  What does this mean? What is this agentic loop?
- **Tacked-on benefit:** "The interface centralizes key information, ensuring a
  seamless user experience."
- **Inflated significance or unnamed authority:** "This represents a profound
  shift." Or "Research consistently shows that this approach improves outcomes,"
  without sources.
- **Informal language:** "Data Center is doing the heavy lifting" is incoherent
  next to "Most revenue growth comes from data centers." "The next guide resets
  the bar higher" should probably be "Q2 projected revenue is $91B."
- **Process instead of reason:** "After several rounds of cross-functional
  review, we aligned on the next phase."
- **Oversimplification that loses the meaning:** turning "Where to draw the line
  on speed investments" into "Where to draw the line," or "When faster shipping
  drives growth rather than simply increasing costs" into "When faster shipping
  drives growth."

**Do not flag:** claims supported by a concrete result, source, constraint, or
approval requirement. Examples: "The change removes one approval step." "The 12
June accessibility audit found 14 missing labels." "Legal and Security must
approve the exception before release."

**Revision move:** name the observable change, source, deciding constraint, or
actual tradeoff.

## 3. Wordy, jargon-filled, or indirect language

**Flag when:** the sentence can be shorter and clearer without losing necessary
meaning or a real qualification. The rationale is clear but the wording is
unnecessarily long, indirect, compressed, bureaucratic, jargon-heavy, or hedged.

Examples of bad writing:

- **Corporate or bureaucratic phrasing:** "Stakeholders should be informed of
  the operational implications associated with this transition."
- **Overcomplicated sentence structure:** "The clean end state is therefore not
  'CCA replaces every product.' It is: shared primitives provide durable
  identity and lifecycle; CCA provides portable agent execution; each surface
  becomes an orientation onto that shared graph." Rewrite as: "CCA provides a
  portable agent execution capability that every surface can reuse, alongside
  shared identity and lifecycle primitives."
- **Compressed abstraction:** "The practical event ceiling remains anchored to
  both a headcount cap and a percentage cap."
- **Indirect comparison:** "The update reads as a broader continuation of
  requests rather than a list of named restricted zones."
- **Overly hedging:** "It may potentially be worth considering whether the team
  could possibly delay the launch."
- **Unnecessary verbosity:** "At this point in time, it would be advisable for
  the team to begin the process of reviewing the draft."
- **Unexplained jargon:** "The workflow operationalizes a cross-functional
  enablement layer for downstream value realization." Similarly, instead of
  "Restrained color vs. visual noise: a simple navy-and-gray palette feels calm
  and credible," write "We moved to a simpler color palette: navy and gray, no
  loud colors."
- "Prioritize promise-date clarity and reliability before network acceleration:
  customers rank on-time delivery above sheer speed" should be "Prioritize
  dependable two-to-three day delivery and accurate promise dates."

**Do not flag:** accurate technical terms, legal conditions, or explained
uncertainty. Examples: "The API returns 429 when the client exceeds the rate
limit." "The estimate is preliminary because two regions have not reported."
"The vendor may terminate only after giving 30 days' written notice."

**Revision move:** use concrete subjects and verbs. Keep the shortest accurate
wording and only the uncertainty markers that correspond to real unknowns.

## 4. Unnecessary framing, repetition, or structure

**Flag when:** setup, repetition, or formatting delays the point or makes the
document harder to scan.

Examples of bad writing:

- **Generic scene-setting:** "In today's fast-paced digital landscape, effective
  communication is more important than ever."
- **Restating the request:** "When it comes to improving employee onboarding,
  there are several strategies to consider."
- **Meta-announcement:** "Below is a polished and comprehensive rewrite tailored
  to your needs."
- **Redundant conclusion:** "In conclusion, adopting these strategies can help
  organizations achieve their goals."
- **Excessive structure:** a two-sentence answer split across six headings and
  twelve bullets.

**Do not flag:** framing that narrows scope, corrects the request, explains an
omission, or helps readers navigate reference material. Examples: "This memo
covers the two launch decisions due Friday." "Each API endpoint uses Request,
Response, and Errors headings for lookup."

**Revision move:** start with the answer or decision. Delete generic setup and
repeated recaps. Use the lightest structure that helps the reader act or find
information.

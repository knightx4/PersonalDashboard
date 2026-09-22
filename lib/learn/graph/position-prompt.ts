/**
 * What counts as a position, said once.
 *
 * Every call that pulls ideas out of text has to agree on what an idea is. The
 * five that write Learn chains (a typed goal, a pasted briefing, a note written
 * after reading, prior knowledge somebody declared, the floor under a missed
 * claim) each used to carry their own "claims, not headings" paragraph, and the
 * vault map's extraction adds four kinds, six edge types and a quote rule on
 * top. Written out per call, those drift apart: one prompt tightens the bar and
 * the others keep the old one. So the definition lives here, and every
 * extraction call quotes it rather than restating it.
 *
 * `NODE_RULE` is the part all of them share. `POSITION_RULE` is what a vault
 * map extraction includes: the node test plus the kinds, the edges and the
 * quote rule, which only make sense against a note's own text. The enums below
 * match `obsidian.position_kind` and `obsidian.edge_type` in
 * supabase/migrations-vault/0002_vault_map.sql, and position-prompt.test.ts
 * fails if they stop matching.
 *
 * The wording of the tests and the kinds is docs/KNOWLEDGE-SPEC.md, "Positions
 * -- what you said about it", "Every position traces to a verified quote" and
 * "Edges". Change it there and here together.
 */

/**
 * The node test. Shared by every call that proposes a node, in Learn and in
 * the vault map alike.
 *
 * The second test does real work: a fact about a tool passes the first and
 * nobody would argue with it, and a bar that admits those admits thousands.
 */
export const NODE_RULE = `CLAIMS, NOT HEADINGS. Every node is one thing a person can be right or wrong
about, stated in a sentence or two.

  Heading, useless: "The Phillips curve."
  Claim, usable: "Inflation and unemployment trade off in the short run because
  wage expectations adjust more slowly than prices, and the trade-off
  disappears once expectations catch up."

A node has to pass two tests. Could you write a question that somebody who
holds it answers differently from somebody who does not? And would being wrong
about it cost anything? "NPV gives an amount and IRR gives a rate" passes the
first and fails the second: it is true, nobody argues with it, and nothing
rests on it. If either test fails, do not return it. A chapter title, a topic
the text only mentions and a loose fact all fail.`;

/** The four kinds, as `obsidian.position_kind` spells them. */
export const POSITION_KINDS = ['claim', 'position', 'distinction', 'frame'] as const;
export type PositionKind = (typeof POSITION_KINDS)[number];

export const POSITION_KIND_RULE = `FOUR KINDS. Every position says which of these it is.

  "claim": something true or false about how the world works.
    "Elasticity of supply decides who bears a tax."
  "position": something that should or should not be done.
    "Single-stair buildings should be legal to six storeys."
  "distinction": two things worth telling apart.
    "Revealed preference versus stated preference."
  "frame": a lens the writer applies to new situations.
    "Start from the base rate before the particulars."

Pick the one that says how you would test somebody on it. A "should" is a
position even when it is argued from evidence.`;

/** The same field in every tool schema that reports a position. */
export const POSITION_KIND_TOOL_FIELD = {
  type: 'string',
  enum: [...POSITION_KINDS],
} as const;

/**
 * The six relations a session may write, as `obsidian.edge_type` spells them.
 * The enum also holds `mentions`, a legacy value closed to new writes, which is
 * why this list is not read from the database type.
 */
export const MAP_EDGE_TYPES = [
  'requires',
  'supports',
  'qualifies',
  'contradicts',
  'example_of',
  'same_as',
] as const;
export type MapEdgeType = (typeof MAP_EDGE_TYPES)[number];

export const MAP_EDGE_RULE = `EDGES BETWEEN POSITIONS. Join two positions only where the text connects them,
with one of six types and one line saying what the relation actually is. The
edge runs from A to B.

  "requires": you cannot understand B at all without A. Rare. Most edges that
    feel like this are "supports".
  "supports": B is true partly because A is.
  "qualifies": A bounds or conditions B.
  "contradicts": A and B cannot both stand.
  "example_of": A is a concrete case of the more abstract B.
  "same_as": A and B are one idea under two names.

No edge is better than a guessed one.`;

/** The same field in every tool schema that reports an edge between positions. */
export const MAP_EDGE_TOOL_FIELD = {
  type: 'string',
  enum: [...MAP_EDGE_TYPES],
} as const;

/**
 * The quote rule. A quote that is not in the text was invented, and the caller
 * checks every one against the note body and refuses the candidate when it is
 * missing, so asking for it copied exactly is what keeps good candidates from
 * being thrown away over a tidied comma.
 */
export const QUOTE_RULE = `EVERY POSITION CARRIES ITS SENTENCE. Quote the sentence in the text that
supports it, copied exactly: the same words, spelling, punctuation and typos,
with nothing added, joined or paraphrased. It is checked against the text
character for character, and a position whose quote is not there is thrown
away. If no single sentence in the text supports it, do not return it.`;

/** The whole definition, for a call that extracts positions from a note. */
export const POSITION_RULE = [NODE_RULE, POSITION_KIND_RULE, MAP_EDGE_RULE, QUOTE_RULE].join(
  '\n\n',
);

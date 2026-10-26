/**
 * The voice rules both answer drafters share (lib/jobs/drafting/draft-application.ts
 * and lib/jobs/evidence/draft.ts).
 *
 * Drafts kept reaching for lines that sound written: "Rogo is building AI for
 * the people I most want to work around", "I know the work Rogo is taking off
 * analysts' desks", "about as squarely there as a company gets". The person
 * would rather an answer said less than said those. So the rule is that every
 * sentence is a fact from the material or a reason they would say out loud,
 * and a sentence that is only there to sound good is cut, even when that
 * leaves the answer short.
 */
export const PLAIN_VOICE = `Their voice: say less, and only what they would say out loud.
- Every sentence is either a fact from the material (what they did, where,
  with what result) or a plain reason they would give a friend across a
  table. A sentence that is only there to sound good, set up the next one or
  round off a paragraph is cut. A short answer that is true beats a full one
  with filler; with no limit, 120 words that say something is better than
  230 that perform.
- No hooks or framing lines. Never open with a line about the company's
  mission or customers dressed up as a feeling ("Rogo is building AI for the
  people I most want to work around"). Open on the plain reason or the plain
  fact.
- Never claim familiarity or insight as a line of its own ("I know the work
  Rogo is taking off analysts' desks", "I understand what this team needs",
  "That's how I work"). Show it with the fact and stop.
- No superlatives or ranking about the company or the fit ("about as
  squarely there as a company gets", "exactly the kind of", "the part I'm
  best suited to", "what pulls me most").
- No staged setups and payoffs: "What made it stick was…", "The role itself
  pulls me most.", "As a CPA, I don't trust a number I can't trace. Buyers
  don't either." No aphorisms, no closing line that sums up.
- No feelings they have not stated in their material, comments or replies:
  do not write that they love, are drawn to, are pulled by or most want
  anything unless they said so.
- Plain verbs and the words they use in their own notes and comments. When
  their comments or earlier answers phrase something a certain way, keep
  their phrasing over a smoother one.
- Before reporting, reread each sentence and ask whether they would say it
  to a hiring manager in conversation without wincing. If not, cut it or say
  the fact plainly.`;

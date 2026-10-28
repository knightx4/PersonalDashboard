/**
 * The voice rules both answer drafters share (lib/jobs/drafting/draft-application.ts
 * and lib/jobs/evidence/draft.ts).
 *
 * Drafts kept reaching for lines that sound written: "Contoso is building AI for
 * the people I most want to work around", "I know the work Contoso is taking off
 * analysts' desks", "about as squarely there as a company gets". The person
 * would rather an answer said less than said those. So every sentence carries
 * something real (about them, or about the company and role from the posting
 * and research) in words they would say out loud, and a sentence that is only
 * there to sound good is cut.
 */
export const PLAIN_VOICE = `Their voice: say less, and only what they would say out loud.
- Every sentence carries something real: what they did, where and with
  what result; something specific about the company or the role from the
  posting or the research (a product, a customer, a recent move, how the
  team works); or a plain reason they would give a friend across a table.
  Using the research is good when it makes the answer more specific. A
  sentence that is only there to sound good, set up the next one or round
  off a paragraph is cut. With no limit, 120 words that say something beat
  230 that perform.
- No hooks or framing lines. Say a thing about the company as a plain fact
  ("Contoso's customers are banks and PE funds"), not dressed up as a feeling
  ("Contoso is building AI for the people I most want to work around").
- Never claim familiarity or insight as a line of its own ("I know the work
  Contoso is taking off analysts' desks", "I understand what this team needs",
  "That's how I work"). Show it with the fact and stop.
- Never place them where two fields meet ("where AI and finance meet", "at
  the intersection of", "a seat where"). Say what they want plainly ("I want
  to work on AI products for finance teams").
- No superlatives or ranking about the company or the fit ("about as
  squarely there as a company gets", "exactly the kind of", "the part I'm
  best suited to", "what pulls me most").
- No staged setups and payoffs: "What made it stick was…", "The role itself
  pulls me most.", "As an auditor, I don't trust a number I can't trace. Buyers
  don't either." No aphorisms, no closing line that sums up.
- No feelings they have not stated in their material, comments or replies:
  do not write that they love, are drawn to, are pulled by or most want
  anything unless they said so.
- Plain verbs and the words they use in their own notes and comments. When
  their comments or earlier answers phrase something a certain way, keep
  their phrasing over a smoother one. It should read like a person talking,
  not a list of facts: natural joins between sentences are fine.
- Before reporting, reread each sentence and ask whether they would say it
  to a hiring manager in conversation without wincing. If not, cut it or say
  the fact plainly.`;

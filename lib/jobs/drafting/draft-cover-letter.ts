/**
 * A cover letter, drafted from everything on file (plan #2135.1).
 *
 * One model call over what gather() collects for the application, the
 * answers already on it and where the person matches the role best. The
 * letter lands beside the editor, not in it: it is kept in
 * job_search.application_drafts (kind cover_letter) so a reload does not
 * lose it, and only the person's Insert and Save put anything in
 * applications.cover_letter. That is the single-answer drafter's rule
 * (lib/jobs/evidence/draft.ts), whose voice and no-invented-facts rules this
 * follows.
 *
 * The letter follows one template (docs/JOB-SEARCH-SPEC.md, Cover letters),
 * from the person's application writing guide (./application-guide.ts): the
 * role, their credentials and why this kind of role; their main employer's
 * deals and results; their education or second experience; a short close.
 * AI gets one sentence near the end unless the posting is about AI
 * (aiWeight), when the third paragraph may be about building with AI.
 *
 * The model can ask the person things back. Their replies are stored on the
 * same row and sent with the next call, so pressing Redraft uses them.
 */
import 'server-only';

import Anthropic from '@anthropic-ai/sdk';
import { usageFrom, type SpendSink } from '@/lib/core/spend/pricing';
import { MODELS } from '@/lib/core/models';
import type { AppSupabaseClient } from '@/lib/jobs/db/schema-name';
import { THINKING_ROOM, forceTool, toolBlockIn, whyNoReport } from '@/lib/learn/graph/tool-call';
import {
  coverLetterView,
  mergeAsks,
  parseCoverLetterPayload,
  renderLetterRequest,
  storedLetter,
  MAX_ASKS,
  type CoverLetterDraftView,
  type CoverLetterResult,
  type LetterRequest,
} from './draft-cover-letter-payload';
import { gather, vaultPassages, type GatherDeps } from './gather';
import { APPLICATION_GUIDE } from './application-guide';
import { renderMaterial } from './render';
import { LETTER_KEY, loadDrafts, saveDrafts, saveReplies } from './store';

/**
 * Asked of their vault for what they have noticed building with AI: a letter
 * to a role about AI draws its AI paragraph from these, and the role's own
 * vault passages rarely reach them.
 */
const AI_NOTES_QUESTION = 'What I have noticed and learned building things with AI, agents and automation';

/** Writing a letter in someone's voice from their own material. Judgment. */
const MODEL = MODELS.jobsCoverLetterDraft;
const TOOL_NAME = 'report_cover_letter';

const SYSTEM = `You write a cover letter for one person applying for one role,
in their voice. They will read it, edit it and send it themselves.

You are given everything they have on file for this application: the role,
the posting, what they found out about the company, their own view of it
from its Perspective tab, cover letters they wrote to it before, research
prepared on it, their evidence bank, their résumé, answers they have sent
before, their thinking about the search, their notes and how they write. After that come the answers already on this
application, where they match the role best, their notes on building with AI,
their comments on the letter, anything they told you when you asked, and your
previous draft if there is one.

Their comments on the letter are what they want it to say, in their own rough
words: make the points they make, in their voice, and follow any instruction
about length, angle or what to leave out. What a comment says about them,
their views or their interests is theirs to claim, and is not an unsupported
claim.

The letter follows their application writing guide below. The request says
how much this role is about AI; follow it. Every letter follows this
template: four paragraphs, about 230 to 300 words, after "Dear [team] Hiring
Team:" (or the person their material says they are writing to).

1. The opening, two or three plain sentences.
   a. The role, and their location preference when the posting asks for
      one or their material states one.
   b. Who they are, with credentials from the résumé: professional
      credentials, degrees and their most senior title and how long they
      held the work. When their writing-style notes hold a standard
      introduction line, use it as written.
   c. Why this kind of role, in one sentence: a preference stated plainly,
      from their own reasons (the Perspective tab, their earlier letters to
      this company, their thinking about the search, their comments or
      replies). Use an earlier letter's reason, not its sentences; earlier
      letters predate this template. No contrast, no flourish, no claim
      about how much they want the job.
   When their material gives no reason for this role, write a neutral line
   about what the posting says the role does, claiming no motive for them,
   and ask them why this role in asks.
   Nothing about the company beyond its name, its team and what the posting
   says it and the role do. An opening of the right shape, for an invented
   applicant:

   "I am applying for the Finance Manager role at Northwind, based in
   Denver. I am a CPA with an MBA from Michigan and four years at Deloitte,
   where I was promoted to Senior. I would like to move into a finance role
   where I help decide what the business does next."
2. Their main employer: what they worked on (the kind of clients and the
   areas), then the deals and results the résumé names, specifically (the
   transactions, what they did on them, a tool they built and its result),
   then in one sentence what that work taught them that this role needs.
   Use their standard evidence lines for that employer as written, choosing
   the two or three that fit this role best. A client story, when one fits,
   is one or two sentences and collaborative.
3. Their education or second experience: what the degree added, then the
   evidence (honours, teaching roles, an advisory role, a relevant
   project), again from their standard lines where they have them. When the
   role is not about AI, this is where one sentence about using AI tools may
   go, near the end of the paragraph.
4. A short close in two sentences, the same in every letter apart from the
   role's name. First, they would welcome the chance to talk about the role.
   Then thanks for the reader's time and for considering their application.
   Nothing else: no new topic, no question, no summary of the letter. Then
   "Sincerely," on its own line, a blank line, and their full name. A close
   they approved:

   "I would welcome the chance to talk about the Finance Manager role
   and how I could contribute to the team. Thank you for your time
   and for considering my application."

When AI is central to the role, paragraph 3 may be about building with AI
instead: one thing the posting says about AI or how the work gets done, what
building with AI has shown them (from their notes on building with AI), and
one thing they built, named in passing. Otherwise AI is one sentence at most,
and never a suggestion that the team should be using AI.

${APPLICATION_GUIDE}

What the letter never does:
- Tell a long story. A deal, a result or a client story is one or two
  sentences, in the words of their standard lines where they have them.
- Analyse the company's business for them, guess at its problems, or say
  what the team's work "really" is.
- Set up a point with a colon, or use stock lines such as "most companies
  skip", "the question I keep coming back to", "the part I'd most want to
  own", "the kind of work I want to spend my time on" or "I'd bring X to Y".
- Say how much they want the job, that they are excited or passionate, or
  call the role an opportunity.
- Contradict the answers already on this application: the same facts, dates,
  reasons and motivations.
- Invent facts about them. A number, a scale, a timeline, a job title, an
  employer, a result, a thing they built or a view about AI comes from their
  material or is not stated. If you do state something about them their
  material does not carry, report it verbatim in unsupported_claims. What you
  say about the role from the posting is not a claim about them.
- Use any construction their style list says never to use.

Report through ${TOOL_NAME}:
- letter: the letter itself, the greeting, plain paragraphs and the sign-off.
  No subject line, no date, no address block.
- evidence_item_ids: every evidence bank item the letter draws on, copied
  exactly from its "id:" line. Empty when it draws on none.
- unsupported_claims: as above.
- asks: up to ${MAX_ASKS} short questions for them whose answers would make the
  letter better, such as why they want this role when their material gives
  no reason (always ask this one then), their location preference when the
  posting asks for one and their material does not say, an observation
  about building with AI when AI is central to the role and their notes hold
  none that fits, or who they are writing to. Ask only what their material and earlier
  replies do not already answer. Empty when nothing is missing.`;

export type LetterOptions = {
  apiKey: string;
  /** Overridable for tests. */
  client?: Anthropic;
  /** What the call cost; record it as 'draft-cover-letter'. */
  onSpend?: SpendSink;
};

/** One model call: the letter, what it cites, what it could not ground, what it asks. */
export async function writeCoverLetter(
  options: LetterOptions,
  request: LetterRequest,
): Promise<CoverLetterResult> {
  const client = options.client ?? new Anthropic({ apiKey: options.apiKey });
  const { material } = request;

  let response;
  try {
    response = await client.messages.create({
      model: MODEL,
      max_tokens: 4096 + THINKING_ROOM,
      // The gathered material is the same for every redraft of this
      // application, so it is cached; what changes between redrafts (the
      // replies and the previous letter) goes in the message after it.
      system: [
        { type: 'text', text: SYSTEM },
        { type: 'text', text: renderMaterial(material), cache_control: { type: 'ephemeral' } },
      ],
      tools: [
        {
          name: TOOL_NAME,
          description: 'Report the cover letter, what it cites, what it could not ground and what to ask them.',
          input_schema: {
            type: 'object',
            properties: {
              letter: { type: 'string' },
              evidence_item_ids: { type: 'array', items: { type: 'string' } },
              unsupported_claims: { type: 'array', items: { type: 'string' } },
              asks: { type: 'array', items: { type: 'string' } },
            },
            required: ['letter', 'evidence_item_ids', 'unsupported_claims', 'asks'],
          },
        },
      ],
      tool_choice: forceTool(TOOL_NAME, MODEL),
      messages: [{ role: 'user', content: `${renderLetterRequest(request)}\n\nCall ${TOOL_NAME}.` }],
    });
  } catch (error) {
    if (error instanceof Anthropic.RateLimitError) {
      return { ok: false, error: 'Drafting is rate-limited right now.' };
    }
    if (error instanceof Anthropic.APIError) {
      return { ok: false, error: `Draft failed (${error.status}).` };
    }
    return { ok: false, error: error instanceof Error ? error.message : 'Draft failed.' };
  }
  options.onSpend?.({ model: MODEL, usage: usageFrom(response.usage) });

  const report = toolBlockIn(response, TOOL_NAME);
  if (!report || report.type !== 'tool_use') {
    return { ok: false, error: whyNoReport(response) };
  }

  return parseCoverLetterPayload(
    report.input,
    material.evidence.items.map((item) => item.id),
    material.style.banned,
  );
}

export type CoverLetterDeps = GatherDeps &
  LetterOptions & {
    /** Ids for new asks; random uuids when absent. */
    newId?: () => string;
  };

export type CoverLetterInput = {
  userId: string;
  applicationId: string;
  /** Replies to earlier asks, by ask id, saved before drafting so this call uses them. */
  replies?: Record<string, string>;
};

export type DraftCoverLetterResult =
  | { ok: true; draft: CoverLetterDraftView }
  | { ok: false; error: string };

/**
 * Gather, draft and keep: the whole of a Draft or Redraft press. Replies
 * given are stored first, so a failed call does not lose them. The row is
 * written only when a letter came back.
 */
export async function draftAndSaveCoverLetter(
  deps: CoverLetterDeps,
  input: CoverLetterInput,
): Promise<DraftCoverLetterResult> {
  const { userId, applicationId } = input;
  // The store reads and writes the one table through `from`, which is all the jobs client is typed to.
  const store = deps.jobs as unknown as AppSupabaseClient;

  // gather() checks the application is theirs before anything is written.
  const gathered = await gather(deps, { userId, applicationId });
  if (!gathered.ok) return { ok: false, error: gathered.error };
  const { material } = gathered;

  if (input.replies && Object.keys(input.replies).length > 0) {
    const saved = await saveReplies(store, applicationId, 'cover_letter', input.replies);
    if (saved.error) return { ok: false, error: saved.error };
  }

  const { drafts: previous, error: loadError } = await loadDrafts(store, applicationId, 'cover_letter');
  if (loadError) return { ok: false, error: loadError };
  const earlierAsks = previous?.asks ?? [];
  const aiNotes = await vaultPassages(deps, userId, AI_NOTES_QUESTION);

  const result = await writeCoverLetter(deps, {
    material,
    previousLetter: previous?.drafts[LETTER_KEY]?.answer ?? null,
    asks: earlierAsks,
    aiNotes: aiNotes.passages,
  });
  if (!result.ok) return result;

  const asks = mergeAsks(earlierAsks, result.draft.asks, deps.newId ?? (() => crypto.randomUUID()));
  const row = storedLetter(result.draft, asks);
  const { error: saveError } = await saveDrafts(store, userId, applicationId, 'cover_letter', row);
  if (saveError) return { ok: false, error: saveError };

  const view = coverLetterView(row, material.style.banned);
  if (!view) return { ok: false, error: 'The letter could not be kept.' };
  return { ok: true, draft: view };
}

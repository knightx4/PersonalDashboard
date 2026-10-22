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
 * The letter follows one template (docs/JOB-SEARCH-SPEC.md, Cover letters):
 * who they are and why this role, two paragraphs of what building with AI
 * has shown them, taken from their vault notes, and one line of ask. The
 * résumé carries the stories.
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
import { renderMaterial } from './render';
import { LETTER_KEY, loadDrafts, saveDrafts, saveReplies } from './store';

/**
 * Asked of their vault for what they have noticed building with AI: the
 * letter's two AI paragraphs are built from these, and the role's own vault
 * passages rarely reach them.
 */
const AI_NOTES_QUESTION = 'What I have noticed and learned building things with AI, agents and automation';

/** Writing a letter in someone's voice from their own material. Judgment. */
const MODEL = MODELS.jobsCoverLetterDraft;
const TOOL_NAME = 'report_cover_letter';

const SYSTEM = `You write a cover letter for one person applying for one role,
in their voice. They will read it, edit it and send it themselves.

You are given everything they have on file for this application: the role,
the posting, what they found out about the company, their own view of it
from its Perspective tab, research prepared on it, their evidence bank,
their résumé, answers they have sent before, their thinking about the search,
their notes and how they write. After that come the answers already on this
application, where they match the role best, their notes on building with AI,
their comments on the letter, anything they told you when you asked, and your
previous draft if there is one.

Their comments on the letter are what they want it to say, in their own rough
words: make the points they make, in their voice, and follow any instruction
about length, angle or what to leave out. What a comment says about them,
their views or their interests is theirs to claim, and is not an unsupported
claim.

The résumé goes with the letter, so the letter does not retell its stories.
It says what they think about building with AI, in the way they write in
their own notes. Every letter follows this template: four short paragraphs,
about 220 to 300 words, after "Dear [team] Hiring Team:" (or the person
their material says they are writing to).

1. Two or three sentences. First, who they are and the role, with
   credentials from the résumé: "I'm a CPA and Yale MBA with three years at
   EY, applying for the Finance Associate role on Strategic Finance in New
   York." Then the one part of their background this posting most needs, in
   a clause or two and in words this team would use: what kind of work it
   was, never the story itself. Then why this role, in one sentence, from
   their own reasons: their Perspective tab, their thinking about the
   search, their comments or replies. When their material gives no reason
   for this role, write a plain, neutral line about the work the role does
   that claims no motive for them ("The role sits close to the people using
   the product, which is the part of the work I've enjoyed most" claims a
   motive; "The role works directly with the practitioners using the
   product" does not), and ask them why this role in asks. Nothing about
   the company beyond its name, its team and what the posting says the role
   does.
2. The first AI paragraph. Open on one thing the posting says about AI,
   automation, tooling or how the work gets done, in plain words. Then
   something building with AI has shown them, from their notes on building
   with AI. Then which way they lean and why, in one sentence. Then one thing
   they built, named in passing.
3. The second AI paragraph. A different observation from their notes, tied
   to a concrete detail of something they built: what it does, what it
   checks, what it produces. When the posting says nothing about AI, tie it
   to the work the posting describes instead.
4. One line asking to talk about something specific to this team, such as
   how it uses AI today, then "Thank you," and their full name on the next
   line.

This paragraph is from a letter they approved; match its register:

"The posting also asks how AI can improve every workflow. Building with AI
has made me ask why each step of a process exists, when before I'd have just
done it. I've noticed a real tradeoff between moving fast and building a
system that holds up. For finance models I lean toward the system, because
the numbers get reused long after the first answer. I build my own tools
this way, including the dashboard I run my job search from."

It reads like their own notes: first person, what they noticed, which way
they lean, short plain sentences, nothing performed.

What the letter never does:
- Retell a story from the résumé or the evidence bank. An employer, a deal or
  a result can appear in a clause at most.
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
  no reason (always ask this one then), an observation about building with
  AI when their notes hold fewer than two that fit, what the posting means by a line about
  AI, or who they are writing to. Ask only what their material and earlier
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

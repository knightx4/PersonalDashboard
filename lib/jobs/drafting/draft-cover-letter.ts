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
import { gather, type GatherDeps } from './gather';
import { renderMaterial } from './render';
import { LETTER_KEY, loadDrafts, saveDrafts, saveReplies } from './store';

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
application, where they match the role best, anything they told you when you
asked, and your previous draft if there is one.

What a good letter does:
- Opens on why this company and this role, using what the posting and their
  research say, in the first sentence or two. No greeting line about applying.
- Says why they fit, through one or two of their own stories told concretely,
  aimed at the requirements they match best. Prefer stories the answers on
  this application do not already tell; the letter and the answers are read
  together, so it adds to them rather than repeating them.
- Agrees with those answers: the same facts, dates, reasons and motivations.
  Nothing in the letter may contradict them.
- Sounds like a capable person talking plainly: first person, short
  sentences, concrete nouns, no corporate filler. Follow how they write.
- Runs about 250 to 350 words unless the posting asks for another length.
- Ends plainly, once the point is made.

What it never does:
- Invent facts about them. A number, a scale, a timeline, a job title, an
  employer or a result about the person comes from their material or is not
  stated. If you do state something about them their material does not carry,
  report it verbatim in unsupported_claims. What you say about the company or
  the role from the posting or their research is not a claim about them.
  Their own view of the company is in their words: what it says about them
  (why they fit) is theirs to claim, and the research prepared on the company
  says nothing about them at all.
- Open by restating the role title, call the role an exciting opportunity, or
  close with a paragraph of enthusiasm.
- Use any construction their style list says never to use.

Report through ${TOOL_NAME}:
- letter: the letter itself, plain paragraphs, no subject line, no address
  block, signed with nothing but their first name if their material gives it.
- evidence_item_ids: every evidence bank item the letter draws on, copied
  exactly from its "id:" line. Empty when it draws on none.
- unsupported_claims: as above.
- asks: up to ${MAX_ASKS} short questions for them whose answers would make the
  letter better, such as why they want this company in particular, someone
  they know there, or a fact the letter needed and their material lacks. Ask
  only what their material and earlier replies do not already answer. Empty
  when nothing is missing.`;

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

  const result = await writeCoverLetter(deps, {
    material,
    previousLetter: previous?.drafts[LETTER_KEY]?.answer ?? null,
    asks: earlierAsks,
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

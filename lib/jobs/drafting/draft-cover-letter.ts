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
 * who they are and why this role, two middle paragraphs, and a conventional
 * close. How many of the middle paragraphs are about building with AI depends
 * on how much the posting is about AI (aiWeight): both, one, or none. The
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

The résumé goes with the letter, so the letter does not retell its stories.
It says what they think, in the way they write in their own notes: about
building with AI when the role is about AI, and about the work itself when it
is not. The request says how much this role is about AI; follow it. Every letter follows this template: four short paragraphs,
about 220 to 300 words, after "Dear [team] Hiring Team:" (or the person
their material says they are writing to).

1. Two or three plain sentences, nothing performed.
   a. Who they are and the role, with credentials from the résumé: "I'm a
      CPA and MBA with three years in audit, applying for the Finance
      Manager role at Northwind in Denver."
   b. The part of their background this posting most needs, as the kind of
      work and where it was: the clients, the industry, what they focused
      on. Never a specific deal, number, result or story; the résumé
      carries those. Describe past work by what it was about, never by a
      role that sounds like looking backward (checking, reviewing or
      auditing numbers after the fact), so it does not read as if they
      cannot do work that looks ahead.
   c. Why this role, in one sentence: a preference stated plainly, backed by
      something they have done when their material has it. Take it from
      their own reasons: the Perspective tab, their earlier letters to this
      company, their thinking about the search, their comments or replies.
      Use an earlier letter's reason, not its sentences; earlier letters
      predate this template. No contrast, no flourish, no claim about how
      much they want the job.
   When their material gives no reason for this role, write a neutral line
   about what the posting says the role does, claiming no motive for them
   ("The role works directly with the practitioners using the product"),
   and ask them why this role in asks.
   Nothing about the company beyond its name, its team and what the posting
   says it and the role do. An opening of the right shape, for an
   invented applicant:

   "I'm a CPA and MBA with three years in audit, applying for the Finance
   Manager role at Northwind in Denver. In audit I worked mostly on
   regional manufacturers, and in my MBA I focused on corporate finance.
   I care about how small suppliers stay afloat, enough to volunteer with a
   local business association on my own time, so I'd like to do this work
   for a company whose customers are independent suppliers."
2. When the role is about AI or mentions it, the AI paragraph. Open on one
   thing the posting says about AI, automation, tooling or how the work gets
   done, in plain words. Then something building with AI has shown them,
   from their notes on building with AI. Then which way they lean and why,
   in one sentence. Then one thing they built, named in passing.
   When the posting does not mention AI, a paragraph about the work instead.
   Open on one thing the posting says the role does, in plain words. Then
   something doing that kind of work has shown them, from their notes, their
   thinking about the search or their comments. Then which way they lean and
   why, in one sentence.
3. When AI is central to the role, the second AI paragraph: a different
   observation from their notes on building with AI, tied to a concrete
   detail of something they built (what it does, what it checks, what it
   produces).
   Otherwise, a second paragraph about the work: another part of what the
   posting describes, and how they approach that kind of work, from their
   material. A tool they built may appear here in one clause when it does
   that kind of work; the paragraph is not about AI.
   Never pad a paragraph with AI the role does not ask about, and never
   suggest the team should be using AI.
4. A conventional close in two sentences, the same in every letter apart
   from the role's name. First the next step: they would welcome the chance
   to talk about the role and how they could contribute, with no new topic
   or question for the team. Then thanks for the reader's time and for
   considering their application. Then "Sincerely," on its own line, a
   blank line, and their full name. A close they approved:

   "I would welcome the chance to talk about the Finance Manager role
   and how I could contribute to the team. Thank you for your time
   and for considering my application."

This AI paragraph, from an invented applicant's letter, shows the register;
match it in whichever paragraphs you write:

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
  AI when AI is central to the role and their notes hold fewer than two that
  fit, what they have noticed doing the work when the role is not about AI
  and their material holds nothing that fits, what the posting means by a line about
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
      // The API says why it refused a request; keep that, or a 400 cannot be traced.
      const detail = (error.error as { error?: { message?: string } } | undefined)?.error?.message;
      console.error('draft cover letter', error.status, detail ?? error.message);
      return { ok: false, error: detail ? `Draft failed (${error.status}): ${detail}` : `Draft failed (${error.status}).` };
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

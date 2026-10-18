/**
 * Every answer on an application, drafted together (plan #2130.3).
 *
 * The single-question drafter (lib/jobs/evidence/draft.ts) sees one question
 * and a shortlist of the bank. This one sees everything gather() collected
 * and every question at once, so it can spread different stories across the
 * answers and ask the person for what the material does not hold. The voice
 * and the rule against inventing facts are draft.ts's, carried over.
 *
 * The gathered material is the cached system block: it is the same for every
 * run on an application, so a redraft after answering Dash's questions reads
 * it from the cache and only the questions and the replies are new. The
 * model reports through one tool call; each answer's length is then checked
 * in code, and any answer over its limit gets one corrective turn in the same
 * conversation before it is flagged.
 *
 * runApplicationDraft is the whole path the server action takes: gather,
 * draft, merge with what was stored, save. It takes its clients, so a test can
 * run it on a fixture.
 */
import 'server-only';

import Anthropic from '@anthropic-ai/sdk';
import type { MemoryRpcClient, QuestionEmbedder } from '@/lib/memory/search';
import { MODELS } from '@/lib/core/models';
import { usageFrom, type SpendSink } from '@/lib/core/spend/pricing';
import type { AppSupabaseClient } from '@/lib/jobs/db/schema-name';
import { THINKING_ROOM, forceTool, toolBlockIn, whyNoReport } from '@/lib/learn/graph/tool-call';
import {
  APPLICATION_DRAFT_TOOL,
  mergeApplicationDrafts,
  parseApplicationDraftPayload,
  questionsToDraft,
  renderDraftRequest,
  renderRetryRequest,
  type DraftAsk,
  type DraftedAnswer,
} from './draft-application-payload';
import { gather, type JobsClient } from './gather';
import { overLimit, type AnswerLimit } from './limits';
import { renderMaterial } from './render';
import { loadDrafts, saveDrafts, saveReplies, type ApplicationDrafts, type StoredAsk } from './store';
import type { GatheredMaterial } from './types';

/** Writing several answers in someone's voice from all their material. Judgment. */
const MODEL = MODELS.jobsApplicationDraft;

/** Room for the report around the answers themselves: ids, citations, asks. */
const REPORT_ROOM = 4_000;
const MAX_TOKENS_CAP = 64_000;
/** A corrective turn is sent only with at least this long left before the deadline. */
const RETRY_NEEDS_MS = 45_000;

const SYSTEM = `You draft the answers to the questions on one job application,
for one person, in their voice. They will read each draft, change what they
want, and paste it into the form themselves.

Below is everything on file about them and the role: the role and its
posting, what they found out about the company, their own view of it from
its Perspective tab, research prepared on it, their evidence bank (stories
and results they wrote, each with an id), their résumé, answers they approved
or sent before, what they have been thinking about the search, passages from
their notes, and how they write. The message lists the questions to answer
now, each with its answer id, kind, limit, current answer and default answer;
then the questions already answered on this application; then what they told
you when you asked them before.

What a good answer does:
- Answers the question that was asked, in its first sentence. A "why us"
  question says why this company and why this role, using what the posting
  and their research say, and why they fit, using their own stories. A
  behavioural question tells one story properly, not four listed.
- Sounds like a capable person talking plainly: first person, short
  sentences, concrete nouns, no corporate filler. Down to earth and to the
  point. Follow how they write.
- Uses their evidence where it carries the point: a real result, a real
  situation, their own words and numbers. Pick the one or two items that fit
  best and leave the rest. The material is there to draw on, not a limit on
  what the answer may say about the company or the role.
- Tells a different story from the other answers. Spread their stories across
  the application so no two answers lean on the same item, unless one item is
  plainly the only fit for both. The answers already given on this
  application count.
- Builds on what they already wrote. A current answer or a default answer is
  theirs: tailor and improve it for this role rather than throw it away.
- Fits its limit. Stay under the limit given, aiming for about nine tenths of
  it. A word limit counts words. A character limit counts every character,
  spaces and punctuation included, so 280 characters is two or three short
  sentences. With no limit, write what the question needs, usually under 250
  words.

Before you write each answer, work out how to approach that question, and
write the answer from that. These considerations are shown to the person
beside the answer, so write them to them, one short plain sentence each, two
to four per answer:
- What the question is really testing, and what a strong answer leads with.
- Which of their stories or results fits best and why, or what angle on the
  company or role from the posting and their research to take.
- Any limit, and what that means for how much fits.
- Anything the question asks for that the material and their replies do not
  hold (a headcount, a date, a reason only they know): say what to add, and
  leave it out of the answer rather than guess it.

What it never does:
- Invent facts about them. A number, a scale, a timeline, a job title, an
  employer or a result about the person comes from the material or from their
  replies, or is not stated. Where the question needs one neither carries,
  that answer's considerations say so. What you say about the company or the
  role from the posting or their research is not a claim about them.
  Their own view of the company is in their words: what it says about them
  (why they fit) is theirs to claim, and the research prepared on the company
  says nothing about them at all.
- Open by restating the question, call the role an exciting opportunity, or
  close with a paragraph of enthusiasm.
- Use anything on their "never use" list.

Their replies to your earlier questions are facts about them, as good as the
evidence bank. Use them where they fit.

Asking them: where the material is too thin to answer a question well (no
story that fits, a fact only they know such as why they are leaving, a
preference, a number), still write the best draft you can from what there is,
and add a short question to asks, tied to that answer's id. Ask only what
would change the answer: at most two for one answer, and none where the
material is enough. Use a null answer_id for a question about the whole
application. Never ask what they have already told you, or anything listed as
asked and not yet answered. Write each as one plain sentence to them ("What
made you leave Brex?").

Report through ${APPLICATION_DRAFT_TOOL}:
- answers: one entry for every answer id under "The questions to answer now":
  - answer_id: copied exactly.
  - considerations: as above.
  - answer: the answer itself, following its considerations. Plain prose, no
    headings, no bullet list unless the question asks for one.
  - evidence_item_ids: every evidence item the answer draws on, ids copied
    exactly. Empty when it draws on none.
- asks: your questions for them, each with answer_id (or null) and question.
  Empty when you have none.`;

const TOOL: Anthropic.Tool = {
  name: APPLICATION_DRAFT_TOOL,
  description:
    'Report a draft for every answer id asked for, each with how to approach it and what it cites, and any questions for the person.',
  input_schema: {
    type: 'object',
    properties: {
      answers: {
        type: 'array',
        items: {
          type: 'object',
          // Considerations before the answer, so they are written first.
          properties: {
            answer_id: { type: 'string' },
            considerations: { type: 'array', items: { type: 'string' } },
            answer: { type: 'string' },
            evidence_item_ids: { type: 'array', items: { type: 'string' } },
          },
          required: ['answer_id', 'considerations', 'answer', 'evidence_item_ids'],
        },
      },
      asks: {
        type: 'array',
        items: {
          type: 'object',
          properties: {
            answer_id: { type: ['string', 'null'] },
            question: { type: 'string' },
          },
          required: ['answer_id', 'question'],
        },
      },
    },
    required: ['answers', 'asks'],
  },
};

export type ApplicationDraftOptions = {
  apiKey: string;
  /** Overridable for tests. */
  client?: Anthropic;
  /** What each call cost; record it as 'draft-application'. */
  onSpend?: SpendSink;
  /** Epoch ms by which the run must be done; the retry is skipped when it is near. */
  deadline?: number;
};

export type ApplicationDraftInput = {
  material: GatheredMaterial;
  /** The answers to draft. Absent or empty: every question with no answer. */
  answerIds?: readonly string[];
  /** The asks stored so far, with any replies. */
  asks?: readonly StoredAsk[];
};

export type ApplicationDraftResult =
  | {
      ok: true;
      answers: DraftedAnswer[];
      asks: DraftAsk[];
      /** Asked for and not drafted. */
      missing: string[];
      /** Still over their limit after the corrective turn. */
      flagged: string[];
      /** Model calls made: 1, or 2 with a corrective turn. */
      calls: number;
    }
  | { ok: false; error: string };

/** Output tokens to allow for one answer, from its limit. */
function tokensFor(limit: AnswerLimit | null): number {
  if (!limit) return 1_000;
  return limit.unit === 'words' ? Math.ceil(limit.count * 1.6) + 100 : Math.ceil(limit.count / 3) + 100;
}

type Call = { ok: true; message: Anthropic.Message } | { ok: false; error: string };

export async function draftApplicationAnswers(
  options: ApplicationDraftOptions,
  input: ApplicationDraftInput,
): Promise<ApplicationDraftResult> {
  const { material } = input;
  const chosen = questionsToDraft(material.questions, input.answerIds);
  if (!chosen.ok) return chosen;
  const selected = chosen.selected;
  const selectedIds = selected.map((q) => q.answerId);
  const wholeApplication = !input.answerIds || input.answerIds.length === 0;

  const client = options.client ?? new Anthropic({ apiKey: options.apiKey });
  const limits: Record<string, AnswerLimit | null> = Object.fromEntries(
    material.questions.map((q) => [q.answerId, q.limit]),
  );
  const asks = input.asks ?? [];
  const context = {
    known: material.questions.map((q) => q.answerId),
    offeredEvidenceIds: material.evidence.items.map((item) => item.id),
    banned: material.style.banned,
    limits,
    askedBefore: asks.map((ask) => ask.question),
  };
  const maxTokens = Math.min(
    MAX_TOKENS_CAP,
    REPORT_ROOM + THINKING_ROOM + selected.reduce((sum, q) => sum + tokensFor(q.limit), 0),
  );
  const system: Anthropic.TextBlockParam[] = [
    { type: 'text', text: SYSTEM },
    // The material is identical on every run for this application; the
    // questions and replies go in the message, after the cached prefix.
    { type: 'text', text: renderMaterial(material), cache_control: { type: 'ephemeral' } },
  ];

  async function call(messages: Anthropic.MessageParam[]): Promise<Call> {
    const left = options.deadline ? options.deadline - Date.now() : null;
    try {
      const message = await client.messages
        .stream(
          {
            model: MODEL,
            max_tokens: maxTokens,
            system,
            tools: [TOOL],
            tool_choice: forceTool(APPLICATION_DRAFT_TOOL, MODEL),
            messages,
          },
          left !== null ? { timeout: Math.max(10_000, left), maxRetries: 0 } : undefined,
        )
        .finalMessage();
      options.onSpend?.({ model: MODEL, usage: usageFrom(message.usage) });
      return { ok: true, message };
    } catch (error) {
      if (error instanceof Anthropic.RateLimitError) {
        return { ok: false, error: 'Drafting is rate-limited right now.' };
      }
      if (error instanceof Anthropic.APIError) {
        return { ok: false, error: `Draft failed (${error.status}).` };
      }
      return { ok: false, error: error instanceof Error ? error.message : 'Draft failed.' };
    }
  }

  const messages: Anthropic.MessageParam[] = [
    { role: 'user', content: renderDraftRequest({ selected, others: material.questions.filter((q) => !selectedIds.includes(q.answerId)), asks, wholeApplication }) },
  ];
  const first = await call(messages);
  if (!first.ok) return first;
  if ((first.message.stop_reason as string) === 'refusal') {
    return { ok: false, error: 'Dash could not draft these answers.' };
  }
  const report = toolBlockIn(first.message, APPLICATION_DRAFT_TOOL);
  if (!report || report.type !== 'tool_use') {
    console.error('draft application:', whyNoReport(first.message));
    return { ok: false, error: 'No drafts came back.' };
  }
  const parsed = parseApplicationDraftPayload(report.input, { ...context, requested: selectedIds });
  if (!parsed.ok) return parsed;

  const answers = parsed.payload.answers;
  const over = answers.filter((answer) => answer.overLimit);
  let calls = 1;

  const timeLeft = options.deadline ? options.deadline - Date.now() : Infinity;
  if (over.length > 0 && timeLeft >= RETRY_NEEDS_MS) {
    messages.push(
      { role: 'assistant', content: first.message.content as Anthropic.ContentBlockParam[] },
      {
        role: 'user',
        content: [{ type: 'tool_result', tool_use_id: report.id, content: renderRetryRequest(over, limits) }],
      },
    );
    const second = await call(messages);
    calls = 2;
    const retried = second.ok ? toolBlockIn(second.message, APPLICATION_DRAFT_TOOL) : null;
    if (retried && retried.type === 'tool_use') {
      const shortened = parseApplicationDraftPayload(retried.input, {
        ...context,
        requested: over.map((answer) => answer.answerId),
      });
      if (shortened.ok) {
        for (const answer of shortened.payload.answers) {
          const at = answers.findIndex((a) => a.answerId === answer.answerId);
          if (at < 0) continue;
          // Keep whichever is closer to fitting: a retry that came back longer is no help.
          const before = answers[at].overLimit;
          if (!answer.overLimit || (before && answer.overLimit.count < before.count)) answers[at] = answer;
        }
      }
    } else if (second.ok) {
      console.error('draft application retry:', whyNoReport(second.message));
    } else {
      console.error('draft application retry:', second.error);
    }
  }

  // Measured again here so the flag always matches the text kept.
  const final = answers.map((answer) => {
    const copy: DraftedAnswer = { ...answer };
    const overrun = overLimit(answer.text, limits[answer.answerId]);
    if (overrun) copy.overLimit = overrun;
    else delete copy.overLimit;
    return copy;
  });

  return {
    ok: true,
    answers: final,
    asks: parsed.payload.asks,
    missing: parsed.payload.missing,
    flagged: final.filter((answer) => answer.overLimit).map((answer) => answer.answerId),
    calls,
  };
}

export type RunApplicationDraftDeps = {
  /** The person's job_search client. */
  jobs: AppSupabaseClient;
  /** The person's core client, for vault passages. */
  core?: MemoryRpcClient | null;
  embed?: QuestionEmbedder;
  /** [] when the vault workspace is off. */
  vaultSources?: readonly string[];
  /** Ids for new asks; random UUIDs when absent. */
  newId?: () => string;
} & ApplicationDraftOptions;

export type RunApplicationDraftInput = {
  userId: string;
  applicationId: string;
  /** The answers to draft. Absent or empty: every question with no answer. */
  answerIds?: readonly string[];
  /** Replies to stored asks, by ask id, saved before drafting so the draft uses them. */
  replies?: Readonly<Record<string, string>>;
};

export type RunApplicationDraftResult =
  | {
      ok: true;
      /** The stored draft after this run: every draft and ask, earlier ones included. */
      drafts: ApplicationDrafts;
      /** Answer ids drafted by this run. */
      drafted: string[];
      /** Answer ids whose draft is still over its limit. */
      flagged: string[];
      /** Answer ids asked for that came back with no draft. */
      missing: string[];
    }
  | { ok: false; error: string };

/** Gather, draft, merge with the stored draft, save. */
export async function runApplicationDraft(
  deps: RunApplicationDraftDeps,
  input: RunApplicationDraftInput,
): Promise<RunApplicationDraftResult> {
  const { jobs } = deps;
  const { userId, applicationId } = input;

  const gathered = await gather(
    { jobs: jobs as unknown as JobsClient, core: deps.core, embed: deps.embed, onSpend: deps.onSpend, vaultSources: deps.vaultSources },
    { userId, applicationId },
  );
  if (!gathered.ok) return gathered;

  if (input.replies && Object.keys(input.replies).length > 0) {
    const saved = await saveReplies(jobs, applicationId, 'answers', { ...input.replies });
    if (saved.error) return { ok: false, error: saved.error };
  }

  const loaded = await loadDrafts(jobs, applicationId, 'answers');
  if (loaded.error) return { ok: false, error: loaded.error };

  const drafted = await draftApplicationAnswers(
    { apiKey: deps.apiKey, client: deps.client, onSpend: deps.onSpend, deadline: deps.deadline },
    { material: gathered.material, answerIds: input.answerIds, asks: loaded.drafts?.asks ?? [] },
  );
  if (!drafted.ok) return drafted;

  const merged = mergeApplicationDrafts(
    loaded.drafts,
    { answers: drafted.answers, asks: drafted.asks, wholeApplication: !input.answerIds || input.answerIds.length === 0 },
    deps.newId ?? (() => crypto.randomUUID()),
  );
  const saved = await saveDrafts(jobs, userId, applicationId, 'answers', merged);
  if (saved.error) return { ok: false, error: saved.error };

  return {
    ok: true,
    drafts: { applicationId, kind: 'answers', ...merged, updatedAt: new Date().toISOString() },
    drafted: drafted.answers.map((answer) => answer.answerId),
    flagged: drafted.flagged,
    missing: drafted.missing,
  };
}

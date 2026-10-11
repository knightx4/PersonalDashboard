import type Anthropic from '@anthropic-ai/sdk';
import type { SpendSink } from '@/lib/core/spend/pricing';
import { interviewExchanges, type SpecInterview } from '@/lib/specs/interviews';
import type { DraftSection, DraftTarget } from '@/lib/specs/interview-draft';
import { backgroundText, type InterviewBackground } from './interview';
import { runDash, type DashVoice } from './loop';
import { DASH_MODELS } from './models';

/**
 * Dash drafting a vision and a spec from an interview's answers (plan #1640,
 * feature #1637). The questions are lib/dash/interview.ts; this is the one
 * call made when they end.
 *
 * A voice on the shared loop with no lookups and its own ending,
 * `write_drafts`, whose fields are the two drafts: the whole vision as it
 * would read, and the spec as sections and rules. The model never writes a
 * diff. lib/specs/interview-draft.ts turns the sections and rules into one,
 * placed against the spec as it stands, because a model gets the lines of a
 * diff right far more often than it gets the line numbers right.
 *
 * Never throws: a failed call comes back as `failed` with a sentence.
 */

export const WRITE_DRAFTS_TOOL = 'write_drafts';

/** The most lines the sections' bodies are asked to run to between them. */
export const SECTION_LINES = 30;
/** The most rules a draft is asked for. */
export const MAX_RULES = 5;

/** Caps the database holds, applied before writing so a long draft is cut, not refused. */
const SUMMARY_MAX = 4000;
const VISION_MAX = 8000;
const TITLE_MAX = 120;

function writeDraftsTool(candidates: readonly DraftTarget[]): Anthropic.Tool {
  const properties: Record<string, unknown> = {
    summary: {
      type: 'string',
      description:
        'Three to six sentences saying what they told you about the workspace, in plain words, for finding the interview again later.',
    },
    vision: {
      type: 'string',
      description:
        'The whole vision as it would read after they accept it: what the workspace is for, in their voice, a short paragraph or two.',
    },
    vision_why: {
      type: 'string',
      description: 'One or two sentences naming the answers the vision rests on.',
    },
    title: {
      type: 'string',
      description: 'What the spec change makes true, in about eight words.',
    },
    why: {
      type: 'string',
      description: 'Two to four sentences quoting their answers, in quotation marks, as the reason for the spec.',
    },
    sections: {
      type: 'array',
      description: `The spec's sections, each a heading and its markdown body, ${SECTION_LINES} lines between them at most. No Rules section here.`,
      items: {
        type: 'object',
        properties: {
          heading: { type: 'string', description: 'A few words, no hashes.' },
          body: { type: 'string', description: 'Markdown: short paragraphs or a list. No headings.' },
        },
        required: ['heading', 'body'],
        additionalProperties: false,
      },
    },
    rules: {
      type: 'array',
      description: `One to ${MAX_RULES} rules, each one sentence saying what is always true of the workspace.`,
      items: { type: 'string' },
    },
  };
  const required = ['summary', 'vision', 'vision_why', 'title', 'why', 'sections', 'rules'];
  if (candidates.length > 1) {
    properties.spec = {
      type: 'string',
      enum: candidates.map((candidate) => candidate.slug),
      description: 'Which of its specs the sections and rules are added to.',
    };
    required.push('spec');
  }
  return {
    name: WRITE_DRAFTS_TOOL,
    description: 'Write the vision and the spec. It ends your turn.',
    input_schema: { type: 'object', properties, required, additionalProperties: false } as Anthropic.Tool.InputSchema,
  };
}

export const DRAFT_RULES = `You are Dash, the assistant inside somebody's personal dashboard. You have
just interviewed them about one workspace of the app, or about the app as a
whole. Now you draft two things from what they said, for them to accept or
turn down. Nothing changes until they do.

THE VISION says what the workspace is for. Write the whole of it as it would
read once accepted: a short paragraph or two in their voice, using their own
words where they said it well. If a vision is already written, keep its
sentences where the answers do not contradict them and extend it. If an edit
proposed by the weekly review is waiting, fold in what still holds of it.

THE SPEC says how the workspace works: what is in it, what they do there and
how often, the routines it supports, where its things live today, and what
annoys them now. Write it as a few sections, each a heading and a short body,
and then its rules. Each rule is one sentence about what is always true of
the workspace, something a later reader could check the app against. Rest
everything on what they said or on what is already written; do not invent
features they did not ask for.

When the workspace already has a spec, add only what the interview tells you
that the spec does not already say. Do not repeat it.

The spec change has a limit of 60 changed lines in all, blank lines and
headings included, so keep the sections' bodies to about ${SECTION_LINES} lines
between them and give at most ${MAX_RULES} rules.

Quote their answers, in quotation marks, as the why. Write plainly: short
sentences, no dashes as punctuation, no slogans, no "not X but Y".`;

/** How Dash speaks when it drafts. */
export function draftVoice(candidates: readonly DraftTarget[], model: string = DASH_MODELS.interviewDraft): DashVoice {
  return { model, system: DRAFT_RULES, tools: [], finish: writeDraftsTool(candidates), maxTokens: 4000 };
}

/** The one message the model is sent. */
export function draftBrief(input: {
  interview: Pick<SpecInterview, 'module' | 'turns'>;
  background: InterviewBackground;
  candidates: readonly DraftTarget[];
  /** The text of an edit the weekly review proposed that is still waiting, if any. */
  pendingVision: string | null;
  /** Said when an earlier draft did not fit, so this one does. */
  retry?: string | null;
}): string {
  const { interview, background, candidates } = input;
  const subject =
    interview.module === 'app' ? 'the app as a whole' : `the ${background.label} workspace (${interview.module})`;
  const exchanges = interviewExchanges(interview.turns).filter((exchange) => exchange.answer);
  const answers = exchanges
    .map((exchange, i) => `Q${i + 1}: ${exchange.question.body.trim()}\nA${i + 1}: ${exchange.answer?.body.trim()}`)
    .join('\n\n');

  const where =
    candidates.length === 0
      ? 'It has no spec of its own yet, so the spec you write is a new one.'
      : candidates.length === 1
        ? `Your sections and rules are added to the end of its spec "${candidates[0].title}".`
        : `Your sections and rules are added to one of its specs. Pick the one they fit best: ${candidates
            .map((candidate) => `${candidate.slug} ("${candidate.title}")`)
            .join(', ')}.`;

  const parts = [
    `You interviewed them about ${subject}.`,
    `WHAT IS ALREADY WRITTEN ABOUT IT\n\n${backgroundText(background)}`,
  ];
  if (input.pendingVision?.trim()) {
    parts.push(`AN EDIT TO THE VISION THE WEEKLY REVIEW PROPOSED, STILL WAITING\n\n${input.pendingVision.trim()}`);
  }
  parts.push(`THE INTERVIEW\n\n${answers}`, where);
  if (input.retry) parts.push(input.retry);
  parts.push(`Write both through ${WRITE_DRAFTS_TOOL}.`);
  return parts.join('\n\n');
}

/** The two drafts as they come back, checked and cut to what the tables hold. */
export type InterviewDrafts = {
  summary: string;
  vision: string;
  visionWhy: string;
  /** The spec chosen among the candidates; null when there was no choice. */
  spec: string | null;
  title: string;
  why: string;
  sections: DraftSection[];
  rules: string[];
};

export type InterviewDraftResult = { kind: 'drafted'; drafts: InterviewDrafts } | { kind: 'failed'; detail: string };

const text = (value: unknown): string => (typeof value === 'string' ? value.trim() : '');
const cut = (value: string, max: number): string => (value.length <= max ? value : value.slice(0, max).trimEnd());

/** The tool call's input as drafts, or why it cannot be used. */
export function readDrafts(report: unknown, candidates: readonly DraftTarget[]): InterviewDraftResult {
  const input = (report ?? {}) as Record<string, unknown>;
  const sections = (Array.isArray(input.sections) ? input.sections : [])
    .map((section) => {
      const s = (section ?? {}) as Record<string, unknown>;
      return { heading: text(s.heading), body: text(s.body) };
    })
    .filter((section) => section.heading !== '' && section.body !== '');
  const rules = (Array.isArray(input.rules) ? input.rules : []).map(text).filter((rule) => rule !== '').slice(0, MAX_RULES);
  const drafts: InterviewDrafts = {
    summary: cut(text(input.summary), SUMMARY_MAX),
    vision: cut(text(input.vision), VISION_MAX),
    visionWhy: text(input.vision_why),
    spec: null,
    title: cut(text(input.title).replace(/\s+/g, ' '), TITLE_MAX),
    why: text(input.why),
    sections,
    rules,
  };
  const chosen = text(input.spec);
  if (candidates.length > 1) {
    drafts.spec = candidates.some((candidate) => candidate.slug === chosen) ? chosen : candidates[0].slug;
  } else if (candidates.length === 1) {
    drafts.spec = candidates[0].slug;
  }

  if (!drafts.vision) return { kind: 'failed', detail: 'Dash did not write a vision.' };
  if (!drafts.title || !drafts.why || sections.length === 0) {
    return { kind: 'failed', detail: 'Dash did not write the spec.' };
  }
  if (rules.length === 0) return { kind: 'failed', detail: 'Dash wrote the spec without any rules.' };
  if (!drafts.summary) drafts.summary = drafts.vision.slice(0, SUMMARY_MAX);
  return { kind: 'drafted', drafts };
}

/** The vision and spec drafted from an interview. Never throws. */
export async function draftFromInterview(input: {
  interview: SpecInterview;
  background: InterviewBackground;
  candidates: readonly DraftTarget[];
  pendingVision: string | null;
  retry?: string | null;
  /** YYYY-MM-DD in the person's timezone. */
  today: string;
  anthropicApiKey: string;
  client?: Anthropic;
  onSpend?: SpendSink;
  model?: string;
}): Promise<InterviewDraftResult> {
  if (interviewExchanges(input.interview.turns).every((exchange) => !exchange.answer)) {
    return { kind: 'failed', detail: 'There are no answers to draft from yet.' };
  }
  const answer = await runDash({
    voice: draftVoice(input.candidates, input.model),
    context: { surface: 'thread', subject: null, page: null },
    turns: [{ role: 'user', body: draftBrief(input) }],
    today: input.today,
    execute: async () => ({ ok: false, error: `There are no lookups here. Write the drafts through ${WRITE_DRAFTS_TOOL}.` }),
    anthropicApiKey: input.anthropicApiKey,
    client: input.client,
    onSpend: input.onSpend,
  });
  if (!answer.ok) return { kind: 'failed', detail: answer.detail };
  return readDrafts(answer.report, input.candidates);
}

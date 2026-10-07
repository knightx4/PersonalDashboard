import type Anthropic from '@anthropic-ai/sdk';
import type { SpendSink } from '@/lib/core/spend/pricing';
import { interviewExchanges, nextMove, questionsAsked, type SpecInterview } from '@/lib/specs/interviews';
import { runDash, type DashVoice } from './loop';
import { DASH_MODELS } from './models';

/**
 * Dash interviewing the person about a workspace, or the app as a whole, so
 * that a first vision and spec can be drafted from the answers (plan #1639,
 * feature #1637). The interview itself is stored by lib/specs/interviews.ts;
 * this decides what Dash asks next.
 *
 * It is a voice on the shared loop (lib/dash/loop.ts) with no lookup tools
 * and its own ending, `ask_question`, whose one field is the question. What
 * Dash may read about the workspace (its vision, its specs, the notes filed
 * on its pages, how often its pages are opened) is gathered before the call
 * and written into the one message the model is sent, with the interview so
 * far beneath it. Gathering it in code rather than through lookups keeps the
 * call to one round and means the first question always has it.
 *
 * Three rules are held here and not left to the model:
 * - Nothing is asked unless it is Dash's move (nextMove 'ask'), so the
 *   questions stop once the limit is reached, twelve unless the interview was
 *   started with another, or once a draft has been asked for.
 * - A turn is one question: whatever the model writes after its first
 *   question mark is cut (singleQuestion).
 * - An answer that only asks for the draft ("draft it now") is read as that
 *   request rather than kept as an answer (asksForDraft).
 */

/** The tool that ends Dash's turn: the question, and nothing else. */
export const ASK_QUESTION_TOOL = 'ask_question';

const ASK_QUESTION: Anthropic.Tool = {
  name: ASK_QUESTION_TOOL,
  description: 'Ask the person your next question. It ends your turn.',
  input_schema: {
    type: 'object',
    properties: {
      question: {
        type: 'string',
        description: 'One question, under about 30 words, ending in a question mark.',
      },
    },
    required: ['question'],
    additionalProperties: false,
  },
};

/** The most words a question should run to; the rules say "about" this. */
export const QUESTION_WORDS = 30;

export const INTERVIEW_RULES = `You are Dash, the assistant inside somebody's personal dashboard. You are
interviewing them about one workspace of the app, or about the app as a
whole, so that a first vision and a first spec can be drafted from what they
tell you. A vision says what the workspace is for. A spec says how it works:
what is in it, what they do there, and the rules it keeps.

The message gives you what is already written about it (its vision, its
specs, notes they filed on its pages, and how often they open it) and the
interview so far.

ONE QUESTION A TURN. Ask exactly one question, under about ${QUESTION_WORDS} words,
through the ask_question tool. No preamble, no summary of their last answer,
no list, and never two questions joined by "and" or "or also".

BUILD ON WHAT YOU CAN SEE. Your first question starts from what is written:
name something the vision, a spec or a note says, and ask about what it
leaves open. When nothing is written, ask what the workspace is for. After
that, each question follows from their last answer: ask about something it
named, or move to a topic not yet covered when the answer has settled one.

NEVER ASK WHAT YOU ALREADY KNOW. If the vision, a spec, a note or an earlier
answer already says it, do not ask it again, even in other words.

COVER THESE, in whatever order the answers lead:
- what the workspace is for
- what they do there, and how often
- the routines it should support
- where the things it holds live today: other apps, email, paper
- what annoys them about it now

The interview has a fixed number of questions, and the message says how many
are left. With few left, ask about the topic least covered.

Write as you would speak to them on their phone: plain words, no dashes as
punctuation, and do not open by praising or agreeing with their answer.`;

/** How Dash speaks in an interview. */
export function interviewVoice(model: string = DASH_MODELS.interview): DashVoice {
  return { model, system: INTERVIEW_RULES, tools: [], finish: ASK_QUESTION, maxTokens: 400 };
}

/** A note filed on one of the workspace's pages, as the brief lists it. */
export type InterviewNote = { kind: string; body: string; pagePath: string | null; createdAt: string };

/** What is already written about the workspace, read before each question. */
export type InterviewBackground = {
  /** "Job search", or "the app as a whole". */
  label: string;
  vision: string | null;
  /** Each spec's title and its text, or its blurb when the text is not sent. */
  specs: { title: string; text: string }[];
  /** Recent notes filed on its pages, newest first. */
  notes: InterviewNote[];
  /**
   * Page opens over the last `days`, or null when they could not be read.
   * `recorded` is false when no opens have been recorded at all, which is not
   * the same as none.
   */
  opens: { days: number; opens: number; pages: number; recorded: boolean } | null;
};

/** The most characters of any one spec sent, and of all of them together. */
export const SPEC_CHARS = 8_000;
export const SPECS_CHARS = 24_000;
/** The most characters of one note sent. */
const NOTE_CHARS = 400;

function clip(text: string, max: number): string {
  const trimmed = text.trim();
  return trimmed.length <= max ? trimmed : `${trimmed.slice(0, max).trimEnd()} [cut short]`;
}

function backgroundText(background: InterviewBackground): string {
  const parts: string[] = [];
  parts.push(
    background.vision?.trim()
      ? `Its vision, as they wrote it:\n${clip(background.vision, SPEC_CHARS)}`
      : 'It has no vision written yet.',
  );

  if (background.specs.length === 0) {
    parts.push('It has no spec yet.');
  } else {
    let left = SPECS_CHARS;
    const specs = background.specs.map((spec) => {
      const text = clip(spec.text, Math.max(0, Math.min(SPEC_CHARS, left)));
      left -= text.length;
      return `## ${spec.title}\n${text || '(not sent: the specs above used the room)'}`;
    });
    parts.push(`Its specs:\n\n${specs.join('\n\n')}`);
  }

  if (background.notes.length === 0) {
    parts.push('No notes have been filed on its pages lately.');
  } else {
    const notes = background.notes.map(
      (note) =>
        `- ${note.kind}, ${note.createdAt.slice(0, 10)}${note.pagePath ? `, on ${note.pagePath}` : ''}: ` +
        clip(note.body.replace(/\s+/g, ' '), NOTE_CHARS),
    );
    parts.push(`Notes they filed on its pages lately, newest first:\n${notes.join('\n')}`);
  }

  const opens = background.opens;
  if (opens === null) parts.push('How often they open it could not be read.');
  else if (!opens.recorded) parts.push('No page opens have been recorded yet, so how often they use it is not known.');
  else if (opens.opens === 0) parts.push(`They have not opened its pages in the last ${opens.days} days.`);
  else {
    parts.push(
      `They opened its pages ${opens.opens} ${opens.opens === 1 ? 'time' : 'times'} in the last ${opens.days} days, ` +
        `across ${opens.pages} ${opens.pages === 1 ? 'page' : 'pages'}.`,
    );
  }
  return parts.join('\n\n');
}

/**
 * The one message the model is sent: what is written about the workspace,
 * how many questions are left, and the interview so far.
 */
export function interviewBrief(
  interview: Pick<SpecInterview, 'module' | 'questionLimit' | 'turns'>,
  background: InterviewBackground,
): string {
  const asked = questionsAsked(interview);
  const left = interview.questionLimit - asked;
  const exchanges = interviewExchanges(interview.turns);
  const subject =
    interview.module === 'app' ? 'the app as a whole' : `the ${background.label} workspace (${interview.module})`;

  const sofar =
    exchanges.length === 0
      ? 'Nothing has been asked yet. Ask the first question.'
      : exchanges
          .map(
            (exchange, i) =>
              `Q${i + 1}: ${exchange.question.body.trim()}\nA${i + 1}: ${exchange.answer?.body.trim() || '(no answer)'}`,
          )
          .join('\n\n');

  const count =
    left <= 1
      ? `This is question ${asked + 1}, the last you can ask.`
      : `This is question ${asked + 1} of at most ${interview.questionLimit}.`;

  return [
    `You are interviewing them about ${subject}.`,
    `WHAT IS ALREADY WRITTEN ABOUT IT\n\n${backgroundText(background)}`,
    `THE INTERVIEW SO FAR\n\n${sofar}`,
    `${count} Ask it through ${ASK_QUESTION_TOOL}.`,
  ].join('\n\n');
}

/**
 * The question as it is kept: whitespace and any list marker or quotes taken
 * off, and cut after its first question mark, so a turn never carries two.
 * Null when there is no question in it.
 */
export function singleQuestion(text: string): string | null {
  const flat = text
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/^(?:[-*•]|\d+[.)]|Q\d+:)\s*/i, '')
    .replace(/^["'“‘]+|["'”’]+$/g, '')
    .trim();
  const end = flat.indexOf('?');
  if (end < 0) return null;
  const question = flat.slice(0, end + 1).trim();
  return question.length > 1 ? question : null;
}

/**
 * Whether an answer only asks Dash to stop asking and draft: "draft it now",
 * "that's enough", "stop". An answer that says anything more is an answer.
 */
export function asksForDraft(body: string): boolean {
  const said = body
    .toLowerCase()
    .replace(/[’']/g, '')
    .replace(/[^a-z ]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  return /^(?:(?:please |ok |okay )?(?:go ahead and )?(?:draft|write)(?: it| them| the (?:spec|vision|drafts?))?(?: now)?(?: please)?|thats (?:enough|all)|enough|stop(?: asking)?|im done|no more questions)$/.test(
    said,
  );
}

/** What asking for the next question came to. */
export type InterviewQuestion =
  | { kind: 'question'; question: string; number: number }
  /** Not Dash's move: the person's ('answer'), time to draft ('draft'), or finished (null). */
  | { kind: 'stop'; move: 'answer' | 'draft' | null }
  | { kind: 'failed'; detail: string };

/**
 * Dash's next question in an open interview, or why there is none. Calls the
 * model only when it is Dash's move. Never throws.
 */
export async function nextInterviewQuestion(input: {
  interview: SpecInterview;
  background: InterviewBackground;
  /** YYYY-MM-DD in the person's timezone. */
  today: string;
  anthropicApiKey: string;
  client?: Anthropic;
  onSpend?: SpendSink;
  model?: string;
}): Promise<InterviewQuestion> {
  const move = nextMove(input.interview);
  if (move !== 'ask') return { kind: 'stop', move };

  const answer = await runDash({
    voice: interviewVoice(input.model),
    context: { surface: 'thread', subject: null, page: null },
    turns: [{ role: 'user', body: interviewBrief(input.interview, input.background) }],
    today: input.today,
    // No lookups are offered; a made-up call is refused.
    execute: async () => ({ ok: false, error: 'There are no lookups here. Ask your question.' }),
    anthropicApiKey: input.anthropicApiKey,
    client: input.client,
    onSpend: input.onSpend,
  });
  if (!answer.ok) return { kind: 'failed', detail: answer.detail };

  const report = answer.report as { question?: unknown } | undefined;
  const raw = typeof report?.question === 'string' ? report.question : answer.body;
  const question = singleQuestion(raw);
  if (!question) return { kind: 'failed', detail: 'Dash did not come back with a question.' };
  return { kind: 'question', question, number: questionsAsked(input.interview) + 1 };
}

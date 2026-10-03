/**
 * The model call behind the capture box (plan #929), on Dash's shared loop
 * (plan #1478; docs/CORE-AND-DASH-SPEC.md, Part 6): one sentence read
 * against your open goals and steps, filed through the five capture moves.
 *
 * Haiku, with the five moves and nothing to look up, because the box has to
 * answer in seconds. Each move is a write tool in lib/dash's registry
 * (lib/dash/capture-tools.ts); the loop hands each call here, and here it is
 * handed to fileCapture, which checks every ref against what was shown
 * before anything is written (lib/goals/capture.ts) and says back what it
 * filed or why not.
 */
import 'server-only';

import type Anthropic from '@anthropic-ai/sdk';
import type { SpendSink } from '@/lib/core/spend/pricing';
import type { AskToolResult } from '@/lib/ask/db';
import { runDash, type DashVoice, type DashWriter } from '@/lib/dash/loop';
import { DASH_MODELS } from '@/lib/dash/models';
import { captureDashTools } from '@/lib/dash/registry';
import { describeFiled, moveOfTool, type AskResult, type FiledMove } from '@/lib/goals/capture';

export const CAPTURE_MODEL = DASH_MODELS.capture;

const SYSTEM = `You file a sentence the owner of a personal goals tracker wrote
about something that happened. You are given their open goals, each with a ref
like g1, and the open steps under each goal, each with a ref like s4, then the
sentence. A step may have a line in brackets under it with its done-when, its
total and how much is logged so far, and what Dash prepared for it.

Decide what the sentence means for those goals, and file it with the five
move tools: file_close (the whole of a step is finished), file_count
(occurrences of a rhythm), file_progress (part of the work, done without
finishing it), file_reading (the current value of a goal's number) and
file_add (a follow-up step, or work done that no step covers). Each tool says
when it applies. Make every move in one go, together with the answer tool,
whose answer is one short sentence saying what you filed; the person sees the
moves, not the answer. If a move comes back refused, correct it once or leave
it out.

Rules:

- One sentence can touch several goals. File against each that it plainly
  concerns, and against none that it does not.
- Prefer a move on an existing step over adding a new one.
- A sentence reporting part of a step's work (some of the bags, one of
  several rooms, two chapters of a book) is progress on that step, never a
  close. Close a step only when the sentence says the whole step is finished.
  When unsure, log progress: the step stays open and nothing is lost.
- Work already done on something no step covers is one file_add carrying the
  progress: "moved two bags to the office" with only a "Living room" step is
  an add under it titled Move the bags to the office, text moved two bags,
  quantity 2, unit bags.
- Never invent refs. If nothing fits, make no move and only answer: the
  sentence is kept either way.
- Titles and progress text are short and plain, with no quotation marks around them.`;

/** How Dash speaks in the capture box: Haiku, the filing rules, the five moves. */
export const CAPTURE_VOICE: DashVoice = {
  model: CAPTURE_MODEL,
  system: SYSTEM,
  tools: captureDashTools(),
};

const NOTHING_TO_LOOK_UP = 'There is nothing to look up here. File the sentence with the move tools, then answer.';

export type CaptureModelOptions = {
  apiKey: string;
  /** The capture the sentence was kept as: what the conversation hangs from. */
  captureId: string;
  /** YYYY-MM-DD in the person's timezone. */
  today: string;
  /** Overridable for tests. */
  client?: Anthropic;
  /** What the calls cost; recorded as 'file-capture'. */
  onSpend?: SpendSink;
};

/** What the model is told about a move once fileCapture has filed it or refused it. */
function told(outcome: FiledMove): AskToolResult {
  if (!outcome.ok) return { ok: false, error: outcome.error };
  return { ok: true, rows: [], note: `Filed: ${describeFiled(outcome.entry)}. It is listed under the sentence with an Undo.` };
}

/**
 * Run the sentence through the shared loop with surface capture. Each move
 * the model makes goes to `file`; what comes back is whether the loop
 * finished, since what was filed is already in hand.
 */
export async function askCaptureModel(
  options: CaptureModelOptions,
  message: string,
  file: (move: unknown) => Promise<FiledMove>,
): Promise<AskResult> {
  const write: DashWriter = async (tool, args) => {
    const type = moveOfTool(tool.name);
    if (!type) return { ok: false, error: 'That is not one of the five moves.' };
    const fields = args && typeof args === 'object' ? (args as Record<string, unknown>) : {};
    return told(await file({ ...fields, type }));
  };
  const answer = await runDash({
    voice: CAPTURE_VOICE,
    context: { surface: 'capture', subject: { ref: `goals.captures:${options.captureId}` }, page: null },
    turns: [{ role: 'user', body: message }],
    today: options.today,
    execute: async () => ({ ok: false, error: NOTHING_TO_LOOK_UP }),
    write,
    anthropicApiKey: options.apiKey,
    client: options.client,
    onSpend: options.onSpend,
  });
  if (!answer.ok) {
    console.error('capture filing failed', answer.detail);
    return { ok: false, error: 'Filing failed.' };
  }
  return { ok: true };
}

import 'server-only';

import Anthropic from '@anthropic-ai/sdk';
import { MODELS } from '@/lib/core/models';
import { usageFrom, type SpendSink } from '@/lib/core/spend/pricing';
import { forceTool, whyNoReport } from '@/lib/learn/graph/tool-call';
import { GOAL_KINDS, readKinds, type GoalToClassify, type KindAnswer } from '@/lib/learn/goal-kind';

/**
 * Sorting learning goals into kinds (plan #2247.2).
 *
 * One Haiku call carries every goal not yet sorted, each as its name and its
 * line, and answers with one of six kinds and a sentence of why. Haiku rather
 * than Jev: it runs once per goal, needs a reason, and two of the six kinds
 * are the rarer labels the Jev trial found weak.
 */

export const GOAL_KIND_MODEL = MODELS.learnGoalKind;

/** Goals in one call; more are sorted by the next. */
export const GOALS_PER_CALL = 20;

const TOOL_NAME = 'report_goal_kinds';

export type ClassifyResult = { ok: true; answers: KindAnswer[] } | { ok: false; detail: string };

const SYSTEM = `You sort one person's learning goals into kinds, so the right sources are
looked up for each. Each goal comes as a name and a line saying what they want
to know. Pick the ONE kind that fits best:

- academic_course: a subject universities teach as a course, with a syllabus
  that runs week by week. "Corporate finance", "Organic chemistry".
- research_subfield: a specialist area whose structure lives in papers, review
  articles and lecture notes rather than in an undergraduate course. "Quantum
  thermodynamics", "Mechanistic interpretability".
- narrow_question: a question or theme narrower than any one course, answered by
  reading across several. "How French thinking shaped the American Revolution".
- institution: how a particular body works: a central bank, a court, a
  regulator, a legislature. "How the Federal Reserve sets rates".
- practical_skill: something learned by doing, taught by extension services,
  trade bodies and certifications rather than universities. "Beekeeping",
  "Financial modeling in Excel", "Sourdough".
- broad_field: a wide area covered at survey depth, with no single course to
  match. "The financial services industry", "Modern Chinese history".

When two fit, take the one whose sources would give the better structure: a
subject with a real course syllabus is academic_course even if it is also a
skill; a skill nobody teaches in a university is practical_skill.

"reason" is one sentence under 25 words saying why, in plain words, so the
person can see it and change it.

Report every goal through ${TOOL_NAME}, by its number.`;

/** The user message for one call. Exported for the test. */
export function describeGoals(goals: readonly GoalToClassify[]): string {
  const lines = goals.map((goal, i) => {
    const about = goal.about?.trim();
    return `Goal ${i + 1}: ${goal.name.trim()}${about ? `. ${about}` : ''}`;
  });
  return [...lines, '', `Call ${TOOL_NAME} with a kind and a reason for each of the ${goals.length} goals.`].join('\n');
}

/** Sort up to GOALS_PER_CALL goals in one call. */
export async function classifyGoals(input: {
  goals: readonly GoalToClassify[];
  anthropicApiKey: string;
  client?: Anthropic;
  onSpend?: SpendSink;
}): Promise<ClassifyResult> {
  const goals = input.goals.slice(0, GOALS_PER_CALL);
  if (goals.length === 0) return { ok: true, answers: [] };
  const client = input.client ?? new Anthropic({ apiKey: input.anthropicApiKey });

  let response;
  try {
    response = await client.messages.create({
      model: GOAL_KIND_MODEL,
      max_tokens: 2048,
      system: SYSTEM,
      tools: [
        {
          name: TOOL_NAME,
          description: 'Report the kind of each goal, by its number, with a one-sentence reason.',
          input_schema: {
            type: 'object',
            properties: {
              kinds: {
                type: 'array',
                items: {
                  type: 'object',
                  properties: {
                    goal: { type: 'integer' },
                    kind: { type: 'string', enum: [...GOAL_KINDS] },
                    reason: { type: 'string' },
                  },
                  required: ['goal', 'kind', 'reason'],
                },
              },
            },
            required: ['kinds'],
          },
        },
      ],
      tool_choice: forceTool(TOOL_NAME, GOAL_KIND_MODEL),
      messages: [{ role: 'user', content: describeGoals(goals) }],
    });
  } catch (error) {
    if (error instanceof Anthropic.RateLimitError) return { ok: false, detail: 'Rate limited.' };
    return { ok: false, detail: error instanceof Error ? error.message : 'The classifying call failed.' };
  }

  // Before the reply is read: a malformed report still cost what it cost.
  input.onSpend?.({ model: GOAL_KIND_MODEL, usage: usageFrom(response.usage) });

  const block = response.content.find((part) => part.type === 'tool_use' && part.name === TOOL_NAME);
  if (!block || block.type !== 'tool_use') return { ok: false, detail: whyNoReport(response) };
  return { ok: true, answers: readKinds(block.input, goals.length) };
}

import 'server-only';

import Anthropic from '@anthropic-ai/sdk';
import { readReport, reportRequest } from '@/lib/core/model-call';
import { MODELS } from '@/lib/core/models';
import { usageFrom, type SpendSink } from '@/lib/core/spend/pricing';
import { runDash, type DashAnswer, type DashExecutor } from '@/lib/dash/loop';
import { dashToolsOf } from '@/lib/dash/registry';
import { CHART_TOOL } from '@/lib/talk/chart';
import { ATTACH_SAVED_TOOL } from '@/lib/talk/attached';
import { PEOPLE_WEB_RULES, peopleServerTools } from '@/lib/you/people-actions';
import type { TalkTurn } from '@/lib/talk/talk';
import {
  advisorSystem,
  MEMORY_TOOL,
  MEMORY_TOOL_NAME,
  memoriesFrom,
  memoryPrompt,
  memorySystem,
  type AdvisorMemory,
  type MemoryKind,
  type TalkContext,
} from '@/lib/you/advisor-talk';

/**
 * The two calls of a talk with one advisor (plan #2581.6).
 *
 * answerAsAdvisor is the advisor's reply, on Ask Dash's loop with every
 * lookup Ask has but the chart, so they can read the person's rows and cite
 * them; nothing is written, proposed or handed off. rememberExchange is one
 * Haiku call afterwards that reads the exchange and writes what the advisor
 * should remember. Both report their spend to `onSpend`; the caller records
 * it, under 'talk-to-advisor' and 'remember-advisor-talk'.
 *
 * Neither reads or writes a row, so the Talk tab's action, the Dash check
 * (inngest/core/dash-quality.ts) and the connector can each bind their own
 * lookups and keep what they need to.
 */

export const ADVISOR_TALK_MODEL = MODELS.youAdvisorTalk;
export const ADVISOR_MEMORY_MODEL = MODELS.youAdvisorMemory;

/** The thread a talk hangs from, as a ref (lib/core/refs.ts). */
export function chatRef(chatId: string): string {
  return `you.advisor_chats:${chatId}`;
}

/** The advisor's reply to the last of the turns, which is the person's. Never throws. */
export async function answerAsAdvisor(input: {
  context: TalkContext;
  turns: readonly Pick<TalkTurn, 'role' | 'body'>[];
  /** YYYY-MM-DD in the person's timezone. */
  today: string;
  execute: DashExecutor;
  anthropicApiKey: string;
  client?: Anthropic;
  onSpend?: SpendSink;
  chatId?: string | null;
  signal?: AbortSignal;
}): Promise<DashAnswer> {
  return runDash({
    voice: {
      model: ADVISOR_TALK_MODEL,
      system: `${advisorSystem(input.context)}\n\n${PEOPLE_WEB_RULES}`,
      // Not the chart or a saved page's card: they are drawn only under an Ask answer (plans #1655, #3050.4).
      tools: dashToolsOf('lookup').filter((tool) => tool.name !== CHART_TOOL && tool.name !== ATTACH_SAVED_TOOL),
      // The web, as every person on People has it (plan #2861).
      serverTools: peopleServerTools(ADVISOR_TALK_MODEL),
    },
    context: {
      surface: 'thread',
      subject: input.chatId ? { ref: chatRef(input.chatId), title: input.context.advisor.name } : null,
      page: null,
    },
    turns: input.turns,
    today: input.today,
    execute: input.execute,
    anthropicApiKey: input.anthropicApiKey,
    client: input.client,
    onSpend: input.onSpend,
    signal: input.signal,
  });
}

/**
 * What the advisor should remember from one exchange, and which earlier
 * memories it retires. A call that fails or answers in the wrong shape
 * remembers nothing; the talk itself is already kept.
 */
export async function rememberExchange(input: {
  advisorName: string;
  memory: readonly AdvisorMemory[];
  person: string;
  advisor: string;
  anthropicApiKey: string;
  client?: Pick<Anthropic, 'messages'>;
  onSpend?: SpendSink;
}): Promise<{ remember: { kind: MemoryKind; text: string }[]; retire: string[] }> {
  const client = input.client ?? new Anthropic({ apiKey: input.anthropicApiKey });
  try {
    const reply = await client.messages.create({
      model: ADVISOR_MEMORY_MODEL,
      max_tokens: 1000,
      system: memorySystem(input.advisorName),
      ...reportRequest(MEMORY_TOOL, ADVISOR_MEMORY_MODEL),
      messages: [
        {
          role: 'user',
          content: memoryPrompt({
            memory: input.memory,
            person: input.person,
            advisor: input.advisor,
            advisorName: input.advisorName,
          }),
        },
      ],
    });
    input.onSpend?.({ model: ADVISOR_MEMORY_MODEL, usage: usageFrom(reply.usage) });
    const block = readReport(reply, MEMORY_TOOL_NAME, ADVISOR_MEMORY_MODEL);
    if (!block.ok) return { remember: [], retire: [] };
    return memoriesFrom(block.value, input.memory);
  } catch (error) {
    console.error('advisor memory pass failed', error);
    return { remember: [], retire: [] };
  }
}

import { vi } from 'vitest';
import type Anthropic from '@anthropic-ai/sdk';
import type { ThreadDash } from '@/lib/dash/thread';

/**
 * A model client for Dash's shared loop (lib/dash/loop.ts) that answers with
 * each scripted reply in turn and keeps what it was sent, for the threads'
 * tests (plan #1465).
 */

const USAGE = { input_tokens: 10, output_tokens: 10, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 };

/** One model reply calling one tool. */
export function toolCall(id: string, name: string, input: unknown) {
  return { content: [{ type: 'tool_use', id, name, input }], stop_reason: 'tool_use', usage: USAGE };
}

/** The reply that ends a turn with `answer`. */
export function answerCall(answer: string) {
  return toolCall(`answer-${answer.length}`, 'answer', { answer, cited: [] });
}

export type SentRequest = {
  model: string;
  tools: { name: string }[];
  messages: { role: string; content: unknown }[];
};

export function scriptedModel(replies: unknown[]): { client: Anthropic; sent: SentRequest[] } {
  const sent: SentRequest[] = [];
  const client = {
    messages: {
      create: async (params: SentRequest) => {
        sent.push(structuredClone(params));
        return replies[Math.min(sent.length - 1, replies.length - 1)];
      },
    },
  } as unknown as Anthropic;
  return { client, sent };
}

/** The text of every tool result sent back to the model, in order. */
export function toolResults(sent: readonly SentRequest[]): string[] {
  const last = sent[sent.length - 1];
  if (!last) return [];
  return last.messages.flatMap((message) =>
    Array.isArray(message.content)
      ? (message.content as { type: string; content?: unknown }[])
          .filter((block) => block.type === 'tool_result')
          .map((block) => String(block.content))
      : [],
  );
}

/**
 * A ThreadDash whose lookups find nothing and whose registry writes run with
 * only the thread's own acts bound: enough for a thread's own tools.
 */
export function stubThreadDash(): ThreadDash {
  return {
    today: '2026-10-03',
    execute: vi.fn(async () => ({ ok: true as const, rows: [] })),
    apply: (tool, args, seen, acts) =>
      tool.apply(
        {
          userId: 'u',
          today: '2026-10-03',
          timezone: 'UTC',
          enabledModules: [],
          db: async () => {
            throw new Error('no database in this stub');
          },
          searchSources: [],
          seen,
          goals: async () => {
            throw new Error('no database in this stub');
          },
          createTask: async () => ({ id: null, error: 'no database in this stub' }),
          thread: acts,
        },
        args,
      ),
    saveChange: vi.fn(async () => undefined),
  };
}

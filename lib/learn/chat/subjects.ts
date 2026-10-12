import 'server-only';

import Anthropic from '@anthropic-ai/sdk';
import { z } from 'zod';
import { MODELS } from '@/lib/core/models';
import { usageFrom, type SpendSink } from '@/lib/core/spend/pricing';
import type { LearnSupabaseClient } from '@/lib/learn/db/schema-name';
import { forceTool } from '@/lib/learn/graph/tool-call';

/**
 * Turning the subject names a chat gives into the person's own subjects (plan
 * #1809).
 *
 * Claude names the subjects a reading list or a conversation belongs to, in
 * its own words: "AI agents", "evals". The person may already have "Agentic
 * AI Systems", and a second subject for the same thing splits its readings
 * and its graph in two, which subjects_user_name_uq exists to stop. So a name
 * that matches an existing subject case-insensitively is that subject, and
 * the rest go to one Haiku call that is shown every subject the person has
 * and says which, if any, each name is the same subject as. A name it does
 * not match becomes a new subject, which the hourly sweep then places in an
 * area (inngest/learn/subject-placement.ts).
 *
 * With no API key, or when the call fails, the unmatched names become new
 * subjects. A duplicate is visible and can be merged; a reading list that
 * failed to save because a model was down is lost.
 *
 * Reads and writes go through the service-role learn client the connector
 * hands in, so every query names the person.
 */

const MODEL = MODELS.learnChatSubjects;
const TOOL_NAME = 'report_matches';

/** The most subjects one chat write relates to. */
export const MAX_CHAT_SUBJECTS = 3;

/** subjects.name is unbounded in the schema; a chat's name is a few words. */
const NAME_MAX = 120;

export type ChatSubject = { id: string; name: string; created: boolean };

type SubjectRow = { id: string; name: string };

/** The names as given, trimmed, deduped case-insensitively, at most three. */
export function cleanSubjectNames(names: readonly unknown[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const raw of names) {
    if (typeof raw !== 'string') continue;
    const name = raw.trim().replace(/\s+/g, ' ').slice(0, NAME_MAX);
    if (!name || seen.has(name.toLowerCase())) continue;
    seen.add(name.toLowerCase());
    out.push(name);
    if (out.length === MAX_CHAT_SUBJECTS) break;
  }
  return out;
}

const matchSchema = z.object({
  matches: z.array(z.object({ name: z.string(), subject: z.string().nullable() })),
});

const SYSTEM = `You match subject names from a conversation to a person's existing
learning subjects.

For each name you are given, return the existing subject that is the same
subject: the same field of study under a different wording, a plural, an
abbreviation, or a name that is plainly the same thing ("AI agents" and
"Agentic AI Systems"). Return null when no existing subject is the same thing.

A broader or narrower subject is not the same subject. "Machine learning" is
not "Agentic AI Systems", and "Evals" is not "Machine learning". When in
doubt, return null: a new subject costs nothing, and filing something under
the wrong one hides it.

Copy the existing subject's name exactly as listed. Report through ${TOOL_NAME}.`;

const TOOL: Anthropic.Tool = {
  name: TOOL_NAME,
  description: 'Report, for each name, the existing subject it is the same as, or null.',
  input_schema: {
    type: 'object',
    properties: {
      matches: {
        type: 'array',
        items: {
          type: 'object',
          properties: {
            name: { type: 'string', description: 'The name you were given, as given.' },
            subject: { type: ['string', 'null'], description: 'The existing subject, copied exactly, or null.' },
          },
          required: ['name', 'subject'],
        },
      },
    },
    required: ['matches'],
  },
};

/** Which existing subject each unmatched name is, by one model call. Never throws. */
async function matchByModel(
  names: string[],
  existing: SubjectRow[],
  options: { anthropicApiKey: string | undefined; onSpend?: SpendSink; client?: Anthropic },
): Promise<Map<string, SubjectRow>> {
  const found = new Map<string, SubjectRow>();
  if (names.length === 0 || existing.length === 0 || !options.anthropicApiKey) return found;

  const byName = new Map(existing.map((row) => [row.name.toLowerCase(), row]));
  try {
    const client = options.client ?? new Anthropic({ apiKey: options.anthropicApiKey });
    const response = await client.messages.create({
      model: MODEL,
      max_tokens: 1_000,
      system: SYSTEM,
      tools: [TOOL],
      tool_choice: forceTool(TOOL_NAME, MODEL),
      messages: [
        {
          role: 'user',
          content: `Existing subjects:\n${existing.map((row) => `- ${row.name}`).join('\n')}\n\nNames to match:\n${names.map((name) => `- ${name}`).join('\n')}`,
        },
      ],
    });
    options.onSpend?.({ model: MODEL, usage: usageFrom(response.usage) });

    const block = response.content.find((part) => part.type === 'tool_use' && part.name === TOOL_NAME);
    if (!block || block.type !== 'tool_use') return found;
    const parsed = matchSchema.safeParse(block.input);
    if (!parsed.success) return found;

    const wanted = new Map(names.map((name) => [name.toLowerCase(), name]));
    for (const match of parsed.data.matches) {
      const name = wanted.get(match.name.trim().toLowerCase());
      const subject = match.subject ? byName.get(match.subject.trim().toLowerCase()) : undefined;
      if (name && subject) found.set(name, subject);
    }
  } catch (error) {
    console.error('[learn chat subjects]', error instanceof Error ? error.message : error);
  }
  return found;
}

async function createSubject(
  learn: LearnSupabaseClient,
  userId: string,
  name: string,
  note: string | null,
): Promise<SubjectRow> {
  const { data, error } = await learn
    .from('subjects')
    .insert({ user_id: userId, name, note })
    .select('id, name')
    .single();
  if (data) return data as SubjectRow;

  // Made by another write a moment ago: subjects_user_name_uq let that one in.
  if (error?.code === '23505') {
    const { data: raced } = await learn
      .from('subjects')
      .select('id, name')
      .eq('user_id', userId)
      .ilike('name', name.replace(/[\\%_]/g, (c) => `\\${c}`))
      .limit(1)
      .maybeSingle();
    if (raced) return raced as SubjectRow;
  }
  throw new Error(`Saving the subject "${name}" failed: ${error?.message ?? 'no row'}`);
}

/**
 * The person's subjects for the names given, matched or made. `note` is
 * written on a subject this makes, as the line placement reads.
 */
export async function resolveChatSubjects(
  learn: LearnSupabaseClient,
  userId: string,
  names: readonly string[],
  options: { note?: string | null; anthropicApiKey: string | undefined; onSpend?: SpendSink; client?: Anthropic },
): Promise<ChatSubject[]> {
  if (names.length === 0) return [];

  const { data, error } = await learn.from('subjects').select('id, name').eq('user_id', userId).limit(2000);
  if (error) throw new Error(`Reading your subjects failed: ${error.message}`);
  const existing = (data ?? []) as SubjectRow[];
  const byName = new Map(existing.map((row) => [row.name.toLowerCase(), row]));

  const exact = new Map<string, SubjectRow>();
  const rest: string[] = [];
  for (const name of names) {
    const row = byName.get(name.toLowerCase());
    if (row) exact.set(name, row);
    else rest.push(name);
  }
  const matched = await matchByModel(rest, existing, options);

  const out: ChatSubject[] = [];
  const ids = new Set<string>();
  for (const name of names) {
    const known = exact.get(name) ?? matched.get(name);
    const row = known ?? (await createSubject(learn, userId, name, options.note?.trim().slice(0, 500) || null));
    if (ids.has(row.id)) continue;
    ids.add(row.id);
    out.push({ id: row.id, name: row.name, created: !known });
  }
  return out;
}

import Anthropic from '@anthropic-ai/sdk';
import { MODELS } from '@/lib/core/models';
import { usageFrom, type SpendSink } from '@/lib/core/spend/pricing';
import { THINKING_ROOM, forceTool, toolBlockIn, whyNoReport } from '@/lib/learn/graph/tool-call';
import type { YouSupabaseClient } from '@/lib/you/db/schema-name';
import { advisorKey, placeholderQuestion } from '@/lib/you/board-advisors';
import { mentorColour } from '@/lib/you/chat-threads-model';
import { memoryOf, type CouncilMemory } from '@/lib/you/council-model';
import {
  ASK_MAX,
  briefOf,
  DRAFT_RULES,
  DRAFT_TOOL,
  draftedCard,
  draftPrompt,
  versionOf,
  VERSIONS_SHOWN,
  type CleanPerson,
  type PersonBrief,
  type PersonCard,
} from '@/lib/you/people-cards-model';

export * from '@/lib/you/people-cards-model';

/**
 * The reads and writes behind adding and editing a person in Chat (plan
 * #2748.11). Every query names the person as well as relying on row level
 * security.
 *
 * Who wrote the current card is kept in persona_brief as `card_by` (you or
 * dash) and `card_ask` (the sentence a redraft was asked with), so the card
 * a save replaces goes into you.advisor_persona_versions saying who wrote
 * it. A card nobody has saved through the form was written by Dash when it
 * built the mentor, so it goes in as Dash's.
 */

const MODEL = MODELS.personaDraft;
const str = (value: unknown): string => (typeof value === 'string' ? value.trim() : '');

const CARD_COLUMNS = 'id, key, name, kind, focus, colour, persona, persona_brief, made_by_you, joins_meetings';

/** One person's form, their earlier cards and what they remember, or null when they are not on the council. */
export async function loadPersonCard(client: YouSupabaseClient, userId: string, key: string): Promise<PersonCard | null> {
  const found = await client.from('board_advisors').select(CARD_COLUMNS).eq('user_id', userId).eq('key', key).eq('active', true).maybeSingle();
  if (found.error) throw new Error(`Reading them failed: ${found.error.message}`);
  const row = found.data as Record<string, unknown> | null;
  if (!row || typeof row.id !== 'string') return null;
  const [versions, memory] = await Promise.all([
    client
      .from('advisor_persona_versions')
      .select('id, persona, made_by, ask, created_at')
      .eq('user_id', userId)
      .eq('advisor_id', row.id)
      .order('created_at', { ascending: false })
      .limit(VERSIONS_SHOWN),
    client
      .from('advisor_memory')
      .select('id, kind, text, due_on, done_at, created_at')
      .eq('user_id', userId)
      .eq('advisor_id', row.id)
      .is('retired_at', null)
      .order('created_at', { ascending: false })
      .limit(60),
  ]);
  if (versions.error) throw new Error(`Reading their earlier cards failed: ${versions.error.message}`);
  if (memory.error) throw new Error(`Reading what they remember failed: ${memory.error.message}`);
  return {
    id: row.id,
    key: str(row.key),
    name: str(row.name),
    colour: mentorColour(str(row.key), str(row.colour) || null),
    kind: row.kind === 'seat' ? 'seat' : 'guest',
    madeByYou: row.made_by_you === true,
    brief: briefOf(row.persona_brief, str(row.focus) || null),
    persona: str(row.persona),
    joinsMeetings: row.joins_meetings !== false,
    versions: (versions.data ?? []).flatMap((v) => versionOf(v as Record<string, unknown>) ?? []),
    memory: (memory.data ?? []).flatMap((m) => memoryOf(m as Record<string, unknown>) ?? []) as CouncilMemory[],
  };
}

/** Who wrote the card being saved: Dash when it is Dash's draft as drafted, with the sentence asked. */
export type CardAuthor = { by: 'you' | 'dash'; ask: string | null };

function storedBrief(brief: PersonBrief, author: CardAuthor): Record<string, string> {
  const { who: _who, ...rest } = brief;
  void _who;
  const out: Record<string, string> = { ...rest, card_by: author.by };
  const ask = author.ask?.trim().slice(0, ASK_MAX);
  if (ask) out.card_ask = ask;
  return out;
}

/** Add someone new to Chat: in Chat only until they join meetings from their page. Returns their key. */
export async function addPerson(client: YouSupabaseClient, userId: string, person: CleanPerson, author: CardAuthor): Promise<string> {
  const taken = await client.from('board_advisors').select('key').eq('user_id', userId);
  if (taken.error) throw new Error(`Reading your people failed: ${taken.error.message}`);
  const key = advisorKey(person.name, (taken.data ?? []).map((r) => str((r as { key?: unknown }).key)));
  const { error } = await client.from('board_advisors').insert({
    user_id: userId,
    key,
    name: person.name,
    kind: 'guest',
    question: placeholderQuestion(person.name),
    focus: person.brief.who || null,
    colour: person.colour,
    persona: person.persona,
    persona_brief: storedBrief(person.brief, author),
    made_by_you: true,
    joins_meetings: person.joinsMeetings,
    added_by: 'person',
  });
  if (error) throw new Error(`Adding ${person.name} failed: ${error.message}`);
  return key;
}

/**
 * Save an edit. When the card changes, the one it replaces is kept in
 * you.advisor_persona_versions first, so it can be brought back.
 */
export async function savePerson(
  client: YouSupabaseClient,
  userId: string,
  advisorId: string,
  person: CleanPerson,
  author: CardAuthor,
): Promise<string> {
  const found = await client
    .from('board_advisors')
    .select('id, key, persona, persona_brief')
    .eq('user_id', userId)
    .eq('id', advisorId)
    .maybeSingle();
  if (found.error) throw new Error(`Reading them failed: ${found.error.message}`);
  const row = found.data as Record<string, unknown> | null;
  if (!row) throw new Error('They are not on your council.');
  const before = str(row.persona);
  if (before && before !== person.persona) {
    const was = (row.persona_brief ?? {}) as Record<string, unknown>;
    const { error } = await client.from('advisor_persona_versions').insert({
      user_id: userId,
      advisor_id: advisorId,
      persona: before,
      made_by: was.card_by === 'you' ? 'you' : 'dash',
      ask: str(was.card_ask) || null,
    });
    if (error) throw new Error(`Keeping their earlier card failed: ${error.message}`);
  }
  const keepAuthor = before === person.persona ? authorOf(row.persona_brief) : author;
  const { error } = await client
    .from('board_advisors')
    .update({
      name: person.name,
      focus: person.brief.who || null,
      colour: person.colour,
      persona: person.persona,
      persona_brief: storedBrief(person.brief, keepAuthor),
      joins_meetings: person.joinsMeetings,
    })
    .eq('user_id', userId)
    .eq('id', advisorId);
  if (error) throw new Error(`Saving ${person.name} failed: ${error.message}`);
  return str(row.key);
}

function authorOf(brief: unknown): CardAuthor {
  const b = (brief ?? {}) as Record<string, unknown>;
  return { by: b.card_by === 'you' ? 'you' : 'dash', ask: str(b.card_ask) || null };
}

/** Correct a line of what they remember. */
export async function correctMemory(client: YouSupabaseClient, userId: string, id: string, text: string): Promise<void> {
  const { error } = await client.from('advisor_memory').update({ text }).eq('user_id', userId).eq('id', id).is('retired_at', null);
  if (error) throw new Error(`Correcting that failed: ${error.message}`);
}

/**
 * Dash drafting a card from the form, or redrafting the current one from a
 * sentence. One call; what it cost goes to `onSpend`.
 */
export async function draftPersona(
  input: { name: string; brief: PersonBrief; current?: string | null; ask?: string | null },
  options: { apiKey: string; onSpend?: SpendSink; client?: Anthropic },
): Promise<{ ok: true; card: string } | { ok: false; error: string }> {
  const client = options.client ?? new Anthropic({ apiKey: options.apiKey });
  let response;
  try {
    response = await client.messages.create({
      model: MODEL,
      max_tokens: 1_500 + THINKING_ROOM,
      system: DRAFT_RULES,
      tools: [
        {
          name: DRAFT_TOOL,
          description: 'Report the persona card.',
          input_schema: { type: 'object', properties: { card: { type: 'string' } }, required: ['card'] },
        },
      ],
      tool_choice: forceTool(DRAFT_TOOL, MODEL),
      messages: [{ role: 'user', content: draftPrompt(input) }],
    });
  } catch (error) {
    if (error instanceof Anthropic.RateLimitError) return { ok: false, error: 'Dash is busy and could not draft the card.' };
    if (error instanceof Anthropic.APIError) return { ok: false, error: 'Dash could not draft the card just now.' };
    return { ok: false, error: 'Dash could not draft the card just now.' };
  }
  options.onSpend?.({ model: MODEL, usage: usageFrom(response.usage) });
  const report = toolBlockIn(response, DRAFT_TOOL);
  if (!report || report.type !== 'tool_use') return { ok: false, error: whyNoReport(response) };
  const card = draftedCard(report.input);
  return card ? { ok: true, card } : { ok: false, error: 'Dash wrote no card.' };
}

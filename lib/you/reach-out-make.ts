import Anthropic from '@anthropic-ai/sdk';
import { MODELS } from '@/lib/core/models';
import { usageFrom, type SpendSink } from '@/lib/core/spend/pricing';
import { THINKING_ROOM } from '@/lib/learn/graph/tool-call';
import type { YouSupabaseClient } from '@/lib/you/db/schema-name';
import {
  REACH_OUT_FORMS,
  REACH_OUT_LIMITS,
  REACH_OUT_MODES,
  parseReachOutRule,
  type ReachOutRule,
  type ReachOutWatch,
} from '@/lib/you/reach-out-rule';

/**
 * Turning what you wrote about a person on People into the rule the daily
 * round follows, and the sentence the Set up card says back (plan #2931.2).
 *
 * One Sonnet call with structured output (output_config.format), so the reply
 * is the rule's JSON and cannot come back as prose or as a tool it chose not
 * to call (feature #2937). The reply is then checked in code: every table must
 * be one Dash can watch (REACH_OUT_TABLES), and the rule must pass
 * parseReachOutRule, the TypeScript mirror of you.reach_out_rule_valid. A
 * reply that fails is refused with the reason, and saveReachOut keeps the
 * brief with that reason so nothing they wrote is lost.
 */

const MODEL = MODELS.reachOutRule;

/**
 * The tables a rule may watch, each with what a text about it would say.
 * The daily round (#2931.5) reads rows from these and nothing else, so a
 * table goes here only when the round knows how to name its rows. Every
 * entry is in the sources catalogue (reach-out-make.test.ts checks).
 */
export const REACH_OUT_TABLES = [
  { table: 'job_search.suggestions', holds: 'Job leads and people Dash found for you, with a fit score for each role.' },
  { table: 'job_search.roles', holds: 'Roles you saved, with the fit score Dash gave each.' },
  { table: 'job_search.applications', holds: 'Your applications and where each one stands.' },
  {
    table: 'job_search.application_events',
    holds: 'Changes to an application: a rejection, a reply, an interview booked.',
  },
  { table: 'job_search.contacts', holds: 'People in your contacts, with when you last wrote to each.' },
  { table: 'you.insights', holds: 'Insights Dash wrote about you.' },
  { table: 'obsidian.notes', holds: 'Notes in your vault, new and changed.' },
  { table: 'learn.readings', holds: 'Readings in Learn, and when you finished each.' },
  { table: 'goals.items', holds: 'Your goals and their steps, with when each step is due.' },
  {
    table: 'public.plan_items',
    holds: 'The build plan: steps shipped, steps waiting on you, and what is in progress.',
  },
  { table: 'public.ideas', holds: 'Ideas for the app, including ones a session filed.' },
] as const;

export type ReachOutTable = (typeof REACH_OUT_TABLES)[number]['table'];

const WATCHABLE = new Set<string>(REACH_OUT_TABLES.map((t) => t.table));

/** The reply's shape, as sent in output_config.format. The checks it cannot state are in readReachOutReply. */
export const REACH_OUT_REPLY_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['watches', 'cannot_watch', 'understood'],
  properties: {
    watches: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['key', 'about', 'tables', 'mode', 'every_days', 'repeat_after_days', 'form'],
        properties: {
          key: { type: 'string', description: 'Short snake_case name, unique in the rule.' },
          about: { type: 'string', description: 'What it watches, in plain words.' },
          tables: { type: 'array', items: { type: 'string', enum: REACH_OUT_TABLES.map((t) => t.table) } },
          mode: { type: 'string', enum: [...REACH_OUT_MODES] },
          every_days: { type: 'integer' },
          repeat_after_days: { anyOf: [{ type: 'integer' }, { type: 'null' }] },
          form: { anyOf: [{ type: 'string', enum: [...REACH_OUT_FORMS] }, { type: 'null' }] },
        },
      },
    },
    cannot_watch: { type: 'array', items: { type: 'string' } },
    understood: { type: 'string' },
  },
} as const;

export const REACH_OUT_RULES = `The person keeps a list of people who text them, each with a persona. For
one of those people they wrote, in their own words, what that person should
text them about and how often. Turn it into a rule.

A rule is a list of watches. Each watch reads one or more of these tables and
nothing else:

${REACH_OUT_TABLES.map((t) => `- ${t.table}: ${t.holds}`).join('\n')}

For each watch give:
- key: a short snake_case name, unique in the rule.
- about: what it watches, in a few plain words, as the person would say it.
- tables: the tables above that hold it.
- mode: "each" for a text as each new row appears ("tell me when"), "roundup"
  for one text about the rows since the last ("a weekly round-up", "sum up",
  "highlights"), "pick" for one row now and then ("name one person").
- every_days: how often, in days, from 1 to 90. "As it appears" or "tell me
  when" is 1. "Weekly" is 7, "every two weeks" or "about once a fortnight" is
  14, "monthly" is 30. When they give no cadence, use 7.
- repeat_after_days: days before the same row may be named again. Null when
  they say never the same one twice, or when a row can only be news once (a
  new lead, a status change, a step shipped). Otherwise 60 for a person to
  contact, 30 for advice drawn from insights or notes, and 7 for something
  still waiting on them, which should be named again while it waits.
- form: "list" for a round-up of several items, "bubbles" for advice or a
  pick, which read better as two or three short texts; null for "each".

Use at most ${REACH_OUT_LIMITS.watches} watches. Split an ask into two watches when the parts differ in
mode or cadence.

cannot_watch: each thing they asked for that none of the tables holds, in a
few of their own words. Leave nothing they asked for out of both lists.

understood: one or two sentences, addressed to them as "you", saying what this
person will text about and how often, as a friend would repeat it back. Name
the person. Do not mention what cannot be watched; the app says that itself.
No more than 400 characters.`;

export function reachOutPrompt(input: { name: string; brief: string }): string {
  return `The person on their list is ${input.name}.\n\nWhat they wrote:\n${input.brief}`;
}

export type MadeReachOut = { ok: true; rule: ReachOutRule; summary: string } | { ok: false; error: string };

const str = (value: unknown): string => (typeof value === 'string' ? value.trim() : '');

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** "a, b and c". */
function listed(items: readonly string[]): string {
  if (items.length <= 1) return items.join('');
  return `${items.slice(0, -1).join(', ')} and ${items[items.length - 1]}`;
}

/**
 * The sentence the Set up card shows: what Dash understood, then what it
 * cannot watch, within the column's 600 characters.
 */
export function reachOutSummary(understood: string, cannotWatch: readonly string[]): string {
  const gap = cannotWatch.length ? ` Dash cannot watch ${listed(cannotWatch)}, so they will not text about it.` : '';
  const room = REACH_OUT_LIMITS.summary - gap.length;
  const head = understood.length > room ? `${understood.slice(0, room - 1).trimEnd()}…` : understood;
  return `${head}${gap}`.slice(0, REACH_OUT_LIMITS.summary);
}

/**
 * The model's reply as a rule and its summary, or why it was refused. A watch
 * that names a table Dash cannot watch is moved to cannot_watch rather than
 * failing the rest; a rule left with no watch is refused.
 */
export function readReachOutReply(reply: unknown): MadeReachOut {
  if (!isObject(reply) || !Array.isArray(reply.watches)) {
    return { ok: false, error: 'Dash could not read what you wrote as a rule. Your words are kept; try saying it another way.' };
  }
  const cannot: string[] = Array.isArray(reply.cannot_watch) ? reply.cannot_watch.map(str).filter(Boolean) : [];
  const watches: ReachOutWatch[] = [];
  for (const raw of reply.watches) {
    if (!isObject(raw)) continue;
    const tables = Array.isArray(raw.tables) ? raw.tables.map(str) : [];
    if (!tables.length || !tables.every((t) => WATCHABLE.has(t))) {
      const about = str(raw.about);
      if (about) cannot.push(about);
      continue;
    }
    const watch: ReachOutWatch = {
      key: str(raw.key),
      about: str(raw.about),
      tables: [...new Set(tables)],
      mode: raw.mode as ReachOutWatch['mode'],
      every_days: raw.every_days as number,
      repeat_after_days: (raw.repeat_after_days ?? null) as number | null,
    };
    if (raw.form === 'list' || raw.form === 'bubbles') watch.form = raw.form;
    watches.push(watch);
  }
  const cannotWatch = [...new Set(cannot)]
    .map((c) => c.slice(0, REACH_OUT_LIMITS.cannotWatchLength))
    .slice(0, REACH_OUT_LIMITS.cannotWatch);
  if (!watches.length) {
    return {
      ok: false,
      error: cannotWatch.length
        ? `Dash cannot watch anything you asked for: ${listed(cannotWatch)}.`.slice(0, REACH_OUT_LIMITS.summary)
        : 'Dash found nothing in what you wrote that it could watch. Say what they should text you about.',
    };
  }
  const candidate: Record<string, unknown> = { version: 1, watches };
  if (cannotWatch.length) candidate.cannot_watch = cannotWatch;
  const parsed = parseReachOutRule(candidate);
  if ('error' in parsed) {
    return { ok: false, error: `Dash made a rule it could not keep (${parsed.error}) Your words are kept; try again.` };
  }
  const understood = str(reply.understood);
  if (!understood) return { ok: false, error: 'Dash made a rule but did not say it back. Your words are kept; try again.' };
  return { ok: true, rule: parsed.rule, summary: reachOutSummary(understood, cannotWatch) };
}

type Reply = { content: Array<{ type: string; text?: string }>; stop_reason?: string | null };

/** The JSON in a structured-output reply, or why there is none. */
export function replyJson(response: Reply): { json: unknown } | { error: string } {
  if (response.stop_reason === 'refusal') return { error: 'Dash would not make a rule from that.' };
  if (response.stop_reason === 'max_tokens') return { error: 'Dash ran out of room before it finished the rule. Try a shorter brief.' };
  const text = [...response.content].reverse().find((part) => part.type === 'text' && str(part.text));
  if (!text) return { error: 'Dash wrote no rule. Your words are kept; try again.' };
  try {
    return { json: JSON.parse(text.text as string) };
  } catch {
    return { error: 'Dash could not read what you wrote as a rule. Your words are kept; try saying it another way.' };
  }
}

/**
 * Make the rule for one person from what you wrote. One call; what it cost
 * goes to `onSpend` (operation 'make-reach-out-rule'). Never throws.
 */
export async function makeReachOutRule(
  input: { name: string; brief: string },
  options: { apiKey?: string; client?: Pick<Anthropic, 'messages'>; onSpend?: SpendSink },
): Promise<MadeReachOut> {
  const brief = input.brief.trim();
  if (!brief) return { ok: false, error: 'Write what they should text you about first.' };
  if (brief.length > REACH_OUT_LIMITS.brief) {
    return { ok: false, error: `Keep it under ${REACH_OUT_LIMITS.brief} characters.` };
  }
  const client = options.client ?? new Anthropic({ apiKey: options.apiKey });
  let response;
  try {
    // Widened: the installed SDK's types predate output_config.
    const format = {
      output_config: { effort: 'medium', format: { type: 'json_schema', schema: REACH_OUT_REPLY_SCHEMA } },
    } as unknown as Record<string, never>;
    response = await client.messages.create({
      model: MODEL,
      max_tokens: 2_000 + THINKING_ROOM,
      system: REACH_OUT_RULES,
      messages: [{ role: 'user', content: reachOutPrompt({ name: input.name, brief }) }],
      ...format,
    });
  } catch (error) {
    if (error instanceof Anthropic.RateLimitError) return { ok: false, error: 'Dash is busy. Your words are kept; try again in a minute.' };
    return { ok: false, error: 'Dash could not make the rule just now. Your words are kept; try again.' };
  }
  options.onSpend?.({ model: MODEL, usage: usageFrom(response.usage) });
  const read = replyJson(response as Reply);
  if ('error' in read) return { ok: false, error: read.error };
  return readReachOutReply(read.json);
}

/**
 * Keep the brief and what came of it on the person's row. A rule is saved
 * with its summary and the error cleared; a refusal keeps the brief with the
 * reason and leaves no rule, so the round falls back to its own judgement. An
 * empty brief clears all of it.
 */
export async function saveReachOut(
  client: YouSupabaseClient,
  userId: string,
  advisorId: string,
  brief: string,
  made: MadeReachOut | null,
): Promise<void> {
  const words = brief.trim();
  const patch = !words
    ? { reach_out_brief: null, reach_out_rule: null, reach_out_summary: null, reach_out_error: null, reach_out_set_at: null }
    : made?.ok
      ? {
          reach_out_brief: words,
          reach_out_rule: made.rule,
          reach_out_summary: made.summary,
          reach_out_error: null,
          reach_out_set_at: new Date().toISOString(),
        }
      : {
          reach_out_brief: words,
          reach_out_rule: null,
          reach_out_summary: null,
          reach_out_error: (made?.error ?? 'Dash has not made a rule from this yet.').slice(0, REACH_OUT_LIMITS.summary),
          reach_out_set_at: new Date().toISOString(),
        };
  const { error } = await client.from('board_advisors').update(patch).eq('user_id', userId).eq('id', advisorId);
  if (error) throw new Error(`Saving what they text you about failed: ${error.message}`);
}

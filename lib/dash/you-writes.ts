import type Anthropic from '@anthropic-ai/sdk';
import { isUuid, type AskRow, type SchemaClient } from '@/lib/ask/db';
import type { YouChangeInput, YouChangeKind } from '@/lib/ask/you-changes';
import { toRef } from '@/lib/core/refs';
import {
  checkPlace,
  draftOf,
  placeFromRow,
  placeHref,
  placeSpan,
  type PlaceDraft,
  type PlaceRow,
} from '@/lib/you/places';
import type { DashWriteContext, DashWriteResult, DashWriteTool } from './registry';

/**
 * The You changes an agent makes when asked (plan #1991.5):
 *
 *   add_place     a place they have lived, with rough dates.
 *   change_place  one of those places changed: its name, where it is, the
 *                 dates or the note.
 *
 * Each is one row, inserted or updated, so the one undo rule in
 * lib/core/dash-actions.ts puts it back from the values kept. Removing a
 * place is the person's: Dash never deletes.
 *
 * Both Ask and the connector run them, as Todo's (lib/dash/todo-writes.ts):
 * Ask on the person's own you client, the connector on a service-role one
 * for the verified person, so every read and write names the user id itself.
 * The checks are the form's (checkPlace in lib/you/places.ts), so Dash and
 * the page refuse the same things in the same words.
 */

export type YouWriteEnv = { userId: string; you: SchemaClient };

export type YouMade = {
  kind: YouChangeKind;
  input: YouChangeInput;
  subjectRef: string;
  op: 'insert' | 'update';
  before: Record<string, unknown> | null;
  after: Record<string, unknown>;
  summary: string;
  row: AskRow;
};

export type YouWrite = {
  name: YouChangeKind;
  /** Without the line each surface adds on where the change shows. */
  description: string;
  input_schema: Anthropic.Tool['input_schema'];
  run: (env: YouWriteEnv, args: Args) => Promise<YouMade>;
};

/** A refusal the model reads and says in words. */
export class YouRefused extends Error {}

type Args = Record<string, unknown>;
type Row = Record<string, unknown>;

const PLACE_PATHS = ['/you/places', '/home'];

/** The draft's fields and the tool's argument names, which follow the columns. */
const ARG_OF: Record<keyof PlaceDraft, string> = {
  name: 'name',
  city: 'city',
  region: 'region',
  country: 'country',
  movedIn: 'moved_in',
  movedOut: 'moved_out',
  note: 'note',
};

function textArg(args: Args, key: string): string | undefined {
  const value = args[key];
  if (value === undefined || value === null) return undefined;
  if (typeof value !== 'string') throw new YouRefused(`${key} must be text.`);
  return value;
}

/** The first thing checkPlace refused, named by the tool's argument. */
function refusal(errors: Partial<Record<keyof PlaceDraft, string>>): YouRefused {
  const [field, message] = Object.entries(errors)[0] as [keyof PlaceDraft, string];
  return new YouRefused(`${ARG_OF[field]}: ${message}`);
}

function made(kind: YouChangeKind, verb: string, after: Row, before: Row | null, rest: string): YouMade {
  const place = placeFromRow(after as unknown as PlaceRow);
  const href = placeHref(place.id);
  return {
    kind,
    input: { verb, what: place.name, rest, href, where: 'Open the place', paths: [...PLACE_PATHS, href] },
    subjectRef: toRef('you.places', place.id),
    op: before ? 'update' : 'insert',
    before,
    after,
    summary: `Dash ${verb.toLowerCase()} "${place.name}"${rest}.`,
    row: {
      table: 'you.places',
      ref: place.id,
      title: place.name,
      href,
      detail: { moved_in: place.movedIn, moved_out: place.movedOut ?? 'still there' },
    },
  };
}

async function addPlace(env: YouWriteEnv, args: Args): Promise<YouMade> {
  const draft = draftOf(null);
  for (const [field, key] of Object.entries(ARG_OF) as [keyof PlaceDraft, string][]) {
    draft[field] = textArg(args, key) ?? '';
  }
  const checked = checkPlace(draft);
  if (!checked.ok) throw refusal(checked.errors);

  const { data, error } = await env.you
    .from('places')
    .insert({ ...checked.row, user_id: env.userId })
    .select('*')
    .single();
  if (error || !data) throw new Error(`Adding the place failed: ${error?.message ?? 'no row'}`);
  const after = data as Row;
  return made('add_place', 'Added the place', after, null, `, lived in ${placeSpan(placeFromRow(after as unknown as PlaceRow))}`);
}

async function changePlace(env: YouWriteEnv, args: Args): Promise<YouMade> {
  const id = textArg(args, 'place_ref')?.trim() ?? '';
  if (!id) throw new YouRefused('place_ref is missing: give the place’s ref from a lookup.');
  if (!isUuid(id)) throw new YouRefused('place_ref must be a place’s ref, as a lookup returned it.');

  const { data: found, error: readError } = await env.you
    .from('places')
    .select('*')
    .eq('id', id)
    .eq('user_id', env.userId)
    .maybeSingle();
  if (readError) throw new Error(`Reading the place failed: ${readError.message}`);
  if (!found) throw new YouRefused('There is no place of theirs with that ref. Look it up first.');
  const before = found as Row;

  // Start from the place as it is, so a field left out keeps its value.
  const draft = draftOf(placeFromRow(before as unknown as PlaceRow));
  const changed: string[] = [];
  for (const [field, key] of Object.entries(ARG_OF) as [keyof PlaceDraft, string][]) {
    const value = textArg(args, key);
    if (value === undefined) continue;
    draft[field] = value;
    changed.push(key.replace('_', ' '));
  }
  if (changed.length === 0) throw new YouRefused('Say what to change: name, city, region, country, moved_in, moved_out or note.');

  const checked = checkPlace(draft);
  if (!checked.ok) throw refusal(checked.errors);

  const { data, error } = await env.you
    .from('places')
    .update(checked.row)
    .eq('id', id)
    .eq('user_id', env.userId)
    .select('*')
    .single();
  if (error || !data) throw new Error(`Changing the place failed: ${error?.message ?? 'no row'}`);
  return made('change_place', 'Changed the place', data as Row, before, `: ${changed.join(', ')}`);
}

const DATE_HINT = "A year (2019) or a month and year (2019-03, or 'March 2019').";

const FIELDS = {
  name: { type: 'string', description: 'What they call it: the street, the house, or just the city.' },
  city: { type: 'string' },
  region: { type: 'string', description: 'The state, county or province.' },
  country: { type: 'string' },
  moved_in: { type: 'string', description: `When they moved in. ${DATE_HINT}` },
  moved_out: {
    type: 'string',
    description: `When they moved out. ${DATE_HINT} Empty or left out: they live there now.`,
  },
  note: { type: 'string', description: 'Anything else they said about it.' },
} as const;

export const YOU_WRITES: readonly YouWrite[] = [
  {
    name: 'add_place',
    description:
      'Add a place the person has lived to You\'s Places tab, when they tell you ("I lived in Leeds from 2015 to 2019"). A year is enough for the dates; leave moved_out out for where they live now.',
    input_schema: {
      type: 'object',
      properties: FIELDS,
      required: ['name', 'moved_in'],
      additionalProperties: false,
    },
    run: addPlace,
  },
  {
    name: 'change_place',
    description:
      'Change one of the places the person has lived, when they ask: its name, where it is, when they moved in or out, or the note. Name it by the you.places ref list_rows returned. Send only what changes; an empty moved_out means they live there now.',
    input_schema: {
      type: 'object',
      properties: {
        place_ref: { type: 'string', description: 'The you.places ref a lookup returned for the place.' },
        ...FIELDS,
      },
      required: ['place_ref'],
      additionalProperties: false,
    },
    run: changePlace,
  },
];

/** Runs one You write. Never throws: a refusal or a failure is the sentence the model reads. */
export async function runYouWrite(
  write: YouWrite,
  env: YouWriteEnv,
  input: unknown,
): Promise<YouMade | { ok: false; error: string }> {
  const args = input && typeof input === 'object' ? (input as Args) : {};
  try {
    return await write.run(env, args);
  } catch (error) {
    if (error instanceof YouRefused) return { ok: false, error: error.message };
    console.error(`you write ${write.name} failed`, error);
    return { ok: false, error: 'That change could not be made. Tell them nothing was changed.' };
  }
}

const ASK_NOTE =
  'It is done: it shows under your answer with an Undo. Say in your answer what you did, and cite the row this returned.';

/** The You writes as Ask's write tools, run on the person's own you client. */
export const YOU_WRITE_TOOLS: readonly DashWriteTool<DashWriteResult>[] = YOU_WRITES.map((write) => ({
  name: write.name,
  kind: 'write' as const,
  definition: { name: write.name, description: `${write.description} ${ASK_NOTE}`, input_schema: write.input_schema },
  apply: async (ctx: DashWriteContext, input: unknown): Promise<DashWriteResult> => {
    if (!ctx.enabledModules.includes('you')) {
      return { ok: false, error: 'The You workspace is switched off, so nothing can be changed there.' };
    }
    const env = { userId: ctx.userId, you: await ctx.db('you') };
    const result = await runYouWrite(write, env, input);
    if ('ok' in result) return result;
    return { ok: true, ...result, input: result.input as unknown as Record<string, unknown>, undo: null };
  },
}));

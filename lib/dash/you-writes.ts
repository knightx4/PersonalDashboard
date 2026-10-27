import { sameAs, noButton, type DashWriteRuns } from './runs';
import type Anthropic from '@anthropic-ai/sdk';
import { isUuid, type AskRow, type SchemaClient } from '@/lib/ask/db';
import type { YouChangeInput, YouChangeKind } from '@/lib/ask/you-changes';
import { toRef } from '@/lib/core/refs';
import { EDUCATION_HREF } from '@/lib/you/education';
import { jobDates, jobHref, parseJob, type Job } from '@/lib/you/work-history';
import type { YouSupabaseClient } from '@/lib/you/db/schema-name';
import { insertPlace, updatePlace } from '@/lib/you/places-store';
import { saveJob as writeJob } from '@/lib/you/work-history-store';
import { getDetails, saveDetails } from '@/lib/you/details-store';
import { ABOUT_ME_MAX, ABOUT_ME_WHY_MAX } from '@/lib/you/claude-chats';
import {
  checkCustomFields,
  CUSTOM_FIELDS_MAX,
  CUSTOM_LABEL_MAX,
  CUSTOM_VALUE_MAX,
  type CustomField,
} from '@/lib/you/details';
import {
  checkPlace,
  draftOf,
  placeFromRow,
  placeHref,
  placeSpan,
  type PlaceDraft,
  type PlaceRow,
} from '@/lib/you/places';
import { putQuestionToBoard } from '@/lib/you/board-ask';
import { CONTEXT_MAX, LEAN_MAX, OPTION_MAX, OPTIONS_MAX, QUESTION_MAX } from '@/lib/you/board-questions';
import type { DashWriteContext, DashWriteResult, DashWriteTool } from './registry';

/**
 * The You changes an agent makes when asked (plan #1991.5):
 *
 *   add_place     a place they have lived, with rough dates.
 *   change_place  one of those places changed: its name, where it is, the
 *                 dates or the note.
 *   set_detail    one of the fields they named themselves on Details, set by
 *                 its label, created when none has that label (plan #2531.3).
 *                 Never touches the six fixed details (plan #2124.3) and never
 *                 removes a field.
 *   save_about_me something they said about themselves in a chat with
 *                 Claude, in their words, with why it was saved
 *                 (you.claude_chats, you 0019), for the insights runs.
 *   ask_board     a question put to the board with its options, context and
 *                 the person's lean (plan #2561.10): queued for the Sunday
 *                 meeting, or a meeting convened about it now when they said
 *                 so. Through the Ask the board button's own function.
 *   save_job      a job on Work & school added, or one corrected by its ref
 *                 (plan #1991.4.1). Either way the row is marked as theirs,
 *                 as the page's form does, so a later read of the résumé
 *                 leaves it alone.
 *
 * Each is one row, inserted or updated, so the one undo rule in
 * lib/core/dash-actions.ts puts it back from the values kept. Removing a
 * place is the person's: Dash never deletes.
 *
 * Both Ask and the connector run them, as Todo's (lib/dash/todo-writes.ts):
 * Ask on the person's own you client, the connector on a service-role one
 * for the verified person, so every read and write names the user id itself.
 * The checks are the form's (checkPlace in lib/you/places.ts, parseJob in
 * lib/you/work-history.ts), so Dash and
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
  /** The buttons it does the same as, or why none does (./runs.ts). */
  runs: DashWriteRuns;
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

  const after = await insertPlace(env.you as YouSupabaseClient, env.userId, checked.row);
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

  const data = await updatePlace(env.you as YouSupabaseClient, env.userId, id, checked.row);
  if (!data) throw new YouRefused('That place is not there any more. Nothing was changed.');
  return made('change_place', 'Changed the place', data, before, `: ${changed.join(', ')}`);
}

const JOB_PATHS = [EDUCATION_HREF, '/home'];

/** The job fields, which are also the tool's argument names. */
const JOB_FIELDS = ['employer', 'title', 'place', 'started', 'ended', 'note'] as const;

function madeJob(after: Row, before: Row | null, verb: string, rest: string): YouMade {
  const job = after as unknown as Job;
  const href = jobHref(job.id);
  return {
    kind: 'save_job',
    input: { verb, what: job.employer, rest, href, where: 'Open the job', paths: [...JOB_PATHS, href] },
    subjectRef: toRef('you.work_history', job.id),
    op: before ? 'update' : 'insert',
    before,
    after,
    summary: `Dash ${verb.toLowerCase()} "${job.employer}"${rest}.`,
    row: {
      table: 'you.work_history',
      ref: job.id,
      title: job.employer,
      href,
      detail: { title: job.title, dates: jobDates(job) },
    },
  };
}

async function saveJob(env: YouWriteEnv, args: Args): Promise<YouMade> {
  const ref = textArg(args, 'job_ref')?.trim() ?? '';
  if (ref && !isUuid(ref)) throw new YouRefused('job_ref must be a job’s ref, as a lookup returned it.');

  let before: Row | null = null;
  if (ref) {
    const { data: found, error: readError } = await env.you
      .from('work_history')
      .select('*')
      .eq('id', ref)
      .eq('user_id', env.userId)
      .maybeSingle();
    if (readError) throw new Error(`Reading the job failed: ${readError.message}`);
    if (!found) throw new YouRefused('There is no job of theirs with that ref. Look it up first.');
    before = found as Row;
  }

  // A correction starts from the job as it is, so a field left out keeps its value.
  const values: Record<string, string> = {};
  const changed: string[] = [];
  for (const field of JOB_FIELDS) {
    const given = textArg(args, field);
    if (given !== undefined) changed.push(field);
    values[field] = given ?? (before ? String(before[field] ?? '') : '');
  }
  if (before && changed.length === 0) {
    throw new YouRefused('Say what to change: employer, title, place, started, ended or note.');
  }
  const checked = parseJob((field) => values[field] ?? '');
  if (!checked.ok) throw new YouRefused(`${checked.field}: ${checked.error}`);

  const data = await writeJob(env.you, env.userId, before ? ref : null, checked.job);
  if (!data) throw new YouRefused('That job is not there any more. Nothing was changed.');
  if (before) return madeJob(data, before, 'Changed the job at', `: ${changed.join(', ')}`);
  const dates = jobDates(data as unknown as Job);
  return madeJob(data, null, 'Added the job at', dates ? `, ${dates}` : '');
}

const DETAILS_PATHS = ['/you/details', '/home'];

/** Why a detail change has no Undo: their details are one row with no id to restore it by. */
const DETAIL_NO_UNDO =
  'Your details are one row, so Dash cannot put one field back by itself. Change the field on the Details tab, or ask Dash to set it again.';

async function setDetail(env: YouWriteEnv, args: Args): Promise<YouMade> {
  const label = textArg(args, 'label')?.trim() ?? '';
  const value = textArg(args, 'value')?.trim();
  if (!label) throw new YouRefused('label is missing: give the name of the field.');
  if (value === undefined) {
    throw new YouRefused('value is missing: give what the field should say, or an empty value to clear it.');
  }
  if (label.length > CUSTOM_LABEL_MAX) throw new YouRefused(`label can be at most ${CUSTOM_LABEL_MAX} characters.`);
  if (value.length > CUSTOM_VALUE_MAX) throw new YouRefused(`value can be at most ${CUSTOM_VALUE_MAX} characters.`);

  const client = env.you as YouSupabaseClient;
  const current = await getDetails(client, env.userId);
  const list: CustomField[] = current.custom_fields.map((field) => ({ ...field }));
  const at = list.findIndex((field) => field.label.toLowerCase() === label.toLowerCase());
  const existing = at >= 0 ? list[at] : null;
  if (existing) {
    list[at] = { ...existing, value };
  } else {
    if (list.length >= CUSTOM_FIELDS_MAX) {
      throw new YouRefused(`They already have ${CUSTOM_FIELDS_MAX} fields of their own, which is the most. Nothing was added.`);
    }
    list.push({ id: crypto.randomUUID(), label, value });
  }
  const problem = checkCustomFields(list);
  if (problem) throw new YouRefused(problem);

  const saved = await saveDetails(client, env.userId, { custom_fields: list });
  const name = existing?.label ?? label;
  const verb = existing ? 'Set the field' : 'Added the field';
  const rest = value === '' ? ', now empty' : '';
  return {
    kind: 'set_detail',
    input: { verb, what: name, rest, href: '/you/details', where: 'Open Details', paths: DETAILS_PATHS },
    subjectRef: toRef('you.details', env.userId),
    op: 'update',
    before: { custom_fields: current.custom_fields },
    after: { custom_fields: saved.custom_fields },
    summary: `Dash ${verb.toLowerCase()} "${name}"${rest}.`,
    row: {
      table: 'you.details',
      ref: env.userId,
      title: name,
      href: '/you/details',
      detail: { label: name, value },
    },
  };
}

const INSIGHTS_PATHS = ['/you/insights', '/home'];

/**
 * Something they said about themselves in a chat, kept for the insights runs
 * (you 0019). Their words, close to as they said them; why is the chat's one
 * line on what it shows.
 */
async function saveAboutMe(env: YouWriteEnv, args: Args): Promise<YouMade> {
  const said = (textArg(args, 'text') ?? '').trim();
  const why = (textArg(args, 'why') ?? '').trim();
  if (said.length < 10) throw new YouRefused('text is missing: give what they said, in their words.');
  if (said.length > ABOUT_ME_MAX) throw new YouRefused(`Keep text under ${ABOUT_ME_MAX} characters: the moment, not the conversation.`);
  if (why.length > ABOUT_ME_WHY_MAX) throw new YouRefused(`Keep why under ${ABOUT_ME_WHY_MAX} characters.`);
  const client = env.you as unknown as YouSupabaseClient;
  const { data, error } = await client
    .from('claude_chats')
    .insert({
      user_id: env.userId,
      origin: 'saved',
      said_at: new Date().toISOString(),
      body: said,
      why: why || null,
    })
    .select('id, origin, said_at, body, why')
    .single();
  if (error || !data) throw new Error(error?.message ?? 'no row');
  const row = data as Row;
  const id = String(row.id);
  const line = said.split('\n')[0];
  const short = line.length > 80 ? `${line.slice(0, 79).trimEnd()}…` : line;
  return {
    kind: 'save_about_me',
    input: {
      verb: 'Saved',
      what: short,
      rest: ' for your insights',
      href: '/you/insights',
      where: 'Open Insights',
      paths: INSIGHTS_PATHS,
    },
    subjectRef: toRef('you.claude_chats', id),
    op: 'insert',
    before: null,
    after: row,
    summary: `Dash saved "${short}" for your insights.`,
    row: { table: 'you.claude_chats', ref: id, title: short, href: '/you/insights', detail: { why: why || null } },
  };
}

const BOARD_PATHS = ['/you/board', '/home'];

/** Why a question put to the board has no Undo: Dash never deletes, and a meeting may already hold it. */
const BOARD_NO_UNDO =
  'A question put to the board is on its agenda, and Dash does not delete rows. Open it on the Board tab.';

async function askBoard(env: YouWriteEnv, args: Args): Promise<YouMade> {
  const question = textArg(args, 'question') ?? '';
  const rawOptions = args.options;
  if (rawOptions !== undefined && (!Array.isArray(rawOptions) || rawOptions.some((o) => typeof o !== 'string'))) {
    throw new YouRefused('options must be a list of text, one per option.');
  }
  const when = textArg(args, 'when') ?? 'sunday';
  if (when !== 'now' && when !== 'sunday') throw new YouRefused("when must be 'sunday' or 'now'.");

  const put = await putQuestionToBoard({
    client: env.you as YouSupabaseClient,
    userId: env.userId,
    question: {
      question,
      options: (rawOptions as string[] | undefined) ?? [],
      context: textArg(args, 'context') ?? '',
      lean: textArg(args, 'lean') ?? '',
      advisors: [],
    },
    when,
  });
  if (!put.ok) throw new YouRefused(put.error);

  const { question: row, convened, convening } = put;
  const short = row.question.length > 80 ? `${row.question.slice(0, 79).trimEnd()}…` : row.question;
  const rest = convened
    ? ', and called a meeting on it now'
    : convening
      ? `, queued for the Sunday meeting (a meeting now did not start: ${convening})`
      : ', queued for the Sunday meeting';
  return {
    kind: 'ask_board',
    input: { verb: 'Asked the board', what: short, rest, href: '/you/board', where: 'Open the Board', paths: BOARD_PATHS },
    subjectRef: toRef('you.board_questions', row.id),
    op: 'insert',
    before: null,
    after: { ...row } as unknown as Row,
    summary: `Dash asked the board "${short}"${rest}.`,
    row: {
      table: 'you.board_questions',
      ref: row.id,
      title: short,
      href: '/you/board',
      detail: {
        options: row.options.map((o) => `${o.letter}: ${o.text}`).join(' | ') || 'the board will write them',
        lean: row.lean,
        meeting: convened ? 'called now' : 'next Sunday',
      },
    },
  };
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
    runs: noButton('The places page edits a place that is already there; no page adds one by hand.'),
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
    runs: sameAs(['app/you/places/actions.ts#savePlace', 'lib/you/places-store.ts#updatePlace']),
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
  {
    name: 'save_job',
    runs: sameAs(['app/you/work/job-actions.ts#saveJobAction', 'lib/you/work-history-store.ts#saveJob']),
    description:
      "Add a job to the person's Work & school tab, or correct one, when they tell you (\"I worked at the corner bookshop from 2014 to 2016\"). Leave job_ref out to add a job, which needs an employer; give the you.work_history ref list_rows returned to correct one, sending only what changes. A year is enough for the dates; an empty ended means they work there now. A job you save is theirs, so reading their résumé again will not replace it.",
    input_schema: {
      type: 'object',
      properties: {
        job_ref: {
          type: 'string',
          description: 'The you.work_history ref a lookup returned for the job to correct. Leave out to add a new job.',
        },
        employer: { type: 'string', description: 'Where they worked.' },
        title: { type: 'string', description: 'What they were called there.' },
        place: { type: 'string', description: 'Where the job was, such as a city.' },
        started: { type: 'string', description: `When they started. ${DATE_HINT}` },
        ended: {
          type: 'string',
          description: `When they left. ${DATE_HINT} Empty or left out on a new job: they work there now.`,
        },
        note: { type: 'string', description: 'Anything else they said about it.' },
      },
      additionalProperties: false,
    },
    run: saveJob,
  },
  {
    name: 'save_about_me',
    runs: noButton('What they say about themselves in a chat is saved from the chat; the Insights tab imports a whole export instead.'),
    description:
      "Save something the person said about themselves in this conversation, so Dash's insights about them can read it: how they think or decide, what they want or fear, a decision and the real reason for it, what drains or energises them, something they have changed their mind about. Save it when they ask you to, or when their own instructions ask you to save such moments. Give their words, as close to how they said them as you can, not your summary; and in why, one line on what it shows about them. One moment per call, at most a few in a conversation. Not for facts with a place of their own (a todo, a goal, a job, a detail), which have tools of their own.",
    input_schema: {
      type: 'object',
      properties: {
        text: { type: 'string', description: 'What they said, in their words, close to verbatim.' },
        why: { type: 'string', description: 'One line on what it shows about them.' },
      },
      required: ['text'],
      additionalProperties: false,
    },
    run: saveAboutMe,
  },
  {
    name: 'set_detail',
    runs: noButton('The Details tab saves the whole list of their own fields at once; no button sets one by its name.'),
    description:
      'Set one of the fields the person named themselves on their Details tab, when they ask ("my shirt size is M"). Give the field\'s label and its new value: a field with that label (any capitals) has its value replaced, and none yet is added. An empty value clears it; Dash never removes a field. To read their fields first, call list_rows on you.details and look at custom_fields. This cannot change their phone, LinkedIn, citizenship, race, gender or sexuality, which are theirs to say.',
    input_schema: {
      type: 'object',
      properties: {
        label: { type: 'string', description: 'The field\'s name, as they call it, such as "Shirt size".' },
        value: { type: 'string', description: 'What it should say. Empty to clear it.' },
      },
      required: ['label', 'value'],
      additionalProperties: false,
    },
    run: setDetail,
  },
  {
    name: 'ask_board',
    runs: sameAs(['app/you/board/actions.ts#askBoard', 'lib/you/board-ask.ts#putQuestionToBoard']),
    description: `Put a question to the person's board of advisors (hiring manager, mentor, skeptic, CFO, dreamer, and any guests) on the Board tab, when they say "ask the board whether ...", "put this to the board" or the like. It is queued for the board's next Sunday meeting, and a meeting is called about it right now only when they say so ("ask the board now", "convene the board on this"): pass when 'now' then, never otherwise, since a meeting costs them a long run. Write question as one line from what they said, take options from the conversation (two to ${OPTIONS_MAX}, one line each; leave them out and the board writes them), put the numbers, limits and what success would look like in context, and pass their lean in lean when they gave one (an option's letter, or a line). Do not invent options, numbers or a lean they did not give. Then answer with the question and the link to it on the Board tab. Not for a decision they have already made, or a todo.`,
    input_schema: {
      type: 'object',
      properties: {
        question: { type: 'string', description: `The decision as one line, at most ${QUESTION_MAX} characters.` },
        options: {
          type: 'array',
          items: { type: 'string', description: `One option, at most ${OPTION_MAX} characters.` },
          description: `Two to ${OPTIONS_MAX} options in the order they gave them, lettered A to D. Leave out when they gave none.`,
        },
        context: {
          type: 'string',
          description: `What the board needs to know from the conversation: numbers, limits, deadline, what a good outcome is. At most ${CONTEXT_MAX} characters.`,
        },
        lean: {
          type: 'string',
          description: `Which way they lean, if they said: an option's letter, or a line. At most ${LEAN_MAX} characters.`,
        },
        when: {
          type: 'string',
          enum: ['sunday', 'now'],
          description: "'sunday' (the default) queues it; 'now' convenes a meeting at once, only when they asked for that.",
        },
      },
      required: ['question'],
      additionalProperties: false,
    },
    run: askBoard,
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
  runs: write.runs,
  definition: { name: write.name, description: `${write.description} ${ASK_NOTE}`, input_schema: write.input_schema },
  apply: async (ctx: DashWriteContext, input: unknown): Promise<DashWriteResult> => {
    if (!ctx.enabledModules.includes('you')) {
      return { ok: false, error: 'The You workspace is switched off, so nothing can be changed there.' };
    }
    const env = { userId: ctx.userId, you: await ctx.db('you') };
    const result = await runYouWrite(write, env, input);
    if ('ok' in result) return result;
    return {
      ok: true,
      ...result,
      input: result.input as unknown as Record<string, unknown>,
      undo:
        result.kind === 'set_detail'
          ? { none: DETAIL_NO_UNDO }
          : result.kind === 'ask_board'
            ? { none: BOARD_NO_UNDO }
            : null,
    };
  },
}));

import type Anthropic from '@anthropic-ai/sdk';
import { isUuid, type AskRow } from '@/lib/ask/db';
import type { LearnChangeInput, LearnChangeKind } from '@/lib/ask/learn-changes';
import { toRef } from '@/lib/core/refs';
import type { LearnSupabaseClient } from '@/lib/learn/db/schema-name';
import { rewrittenClaimUpdate } from '@/lib/learn/graph/rewrite-save';
import { isSameClaim, MAX_CLAIM } from '@/lib/learn/graph/rewrite';
import { noteBody } from '@/lib/learn/notes/notes';
import { cleanReadingText, PASTED_LABEL } from '@/lib/learn/tracks/reading-text';
import { settleVideoCards } from '@/lib/learn/youtube/video-card-run';
import { isVerdict, PILE_LABEL, VERDICTS } from '@/lib/learn/youtube/videos';
import type { DashWriteContext, DashWriteResult, DashWriteTool } from './registry';

/**
 * The Learn changes an agent makes when asked (plan #1894.8, feature #1894),
 * beyond the three the connector already had (lib/connector/writes.ts: add to
 * the reading list, log what a chat covered, mark something read).
 *
 *   change_reading     a reading's status, its place on the Read now shelf,
 *                      the note on it, the text Dash reads for it, or the
 *                      link it opens.
 *   add_learn_track    a new reading list, by name.
 *   add_track_reading  something to read, at the end of one of those lists.
 *   reword_concept     an idea's claim in new words, the original kept.
 *   add_concept_note   a note on an idea, or on a Learn now card's idea.
 *   change_video       a video on the watch list marked watched or not, or
 *                      moved to another pile.
 *
 * Each is one row, inserted or updated, so the one undo rule in
 * lib/core/dash-actions.ts puts it back from the values kept (#1894.4: an
 * agent's writes go straight in, each listed on Home with an Undo).
 *
 * Both Ask and the connector run them. Ask runs them as a write tool on the
 * person's own clients and keeps the change with its card; the connector runs
 * them on a service-role client for the verified person and records them with
 * core.record_dash_action. The service role passes no row level security, so
 * every read and write here names the person's user id itself.
 */

/** Who the change is for, and their learn client: all a Learn write needs. */
export type LearnWriteEnv = { userId: string; learn: LearnSupabaseClient };

/** A Learn change as made, before a surface keeps it. */
export type LearnMade = {
  kind: LearnChangeKind;
  input: LearnChangeInput;
  subjectRef: string;
  op: 'insert' | 'update';
  before: Record<string, unknown> | null;
  after: Record<string, unknown>;
  summary: string;
  row: AskRow;
};

export type LearnWrite = {
  name: LearnChangeKind;
  /** Without the line each surface adds on where the change shows. */
  description: string;
  input_schema: Anthropic.Tool['input_schema'];
  run: (env: LearnWriteEnv, args: Args) => Promise<LearnMade>;
};

/** A refusal the model reads and says in words. */
export class LearnRefused extends Error {}

type Args = Record<string, unknown>;
type Row = Record<string, unknown>;

function text(args: Args, key: string): string {
  const value = args[key];
  return typeof value === 'string' ? value.trim() : '';
}

function sent(args: Args, key: string): boolean {
  return key in args && args[key] !== undefined && args[key] !== null;
}

function idOf(args: Args, key: string, what: string): string {
  const id = text(args, key);
  if (!id) throw new LearnRefused(`${key} is missing: give the ${what}'s id from a lookup.`);
  if (!isUuid(id)) throw new LearnRefused(`${key} must be a ${what}'s id, as a lookup returned it.`);
  return id;
}

/** "Thinking, Fast and Slow", cut to a line. */
function named(title: unknown, fallback: string): string {
  const line = typeof title === 'string' ? title.split('\n')[0].trim() : '';
  if (!line) return fallback;
  return line.length > 120 ? `${line.slice(0, 119).trimEnd()}…` : line;
}

function quoted(body: string, max = 80): string {
  const line = body.split('\n')[0].trim();
  return line.length <= max ? line : `${line.slice(0, max - 1).trimEnd()}…`;
}

/** One of the person's rows, whole, or a refusal naming what was not found. */
async function ownRow(env: LearnWriteEnv, table: string, id: string, what: string, column = 'id'): Promise<Row> {
  const { data, error } = await env.learn.from(table).select('*').eq(column, id).eq('user_id', env.userId).maybeSingle();
  if (error) throw new Error(`Reading the ${what} failed: ${error.message}`);
  if (!data) throw new LearnRefused(`There is no ${what} of theirs with that id. Look it up first.`);
  return data as Row;
}

async function updated(env: LearnWriteEnv, table: string, id: string, patch: Row, what: string): Promise<Row> {
  const { data, error } = await env.learn
    .from(table)
    .update(patch)
    .eq('id', id)
    .eq('user_id', env.userId)
    .select('*')
    .single();
  if (error || !data) throw new Error(`Changing the ${what} failed: ${error?.message ?? 'no row'}`);
  return data as Row;
}

async function inserted(env: LearnWriteEnv, table: string, row: Row, what: string): Promise<Row> {
  const { data, error } = await env.learn.from(table).insert(row).select('*').single();
  if (error || !data) throw new Error(`Adding the ${what} failed: ${error?.message ?? 'no row'}`);
  return data as Row;
}

// ---------------------------------------------------------------------------
// change_reading
// ---------------------------------------------------------------------------

const READING_STATUSES = ['queued', 'reading', 'read', 'abandoned'] as const;
type ReadingStatus = (typeof READING_STATUSES)[number];
const STATUS_WORDS: Record<ReadingStatus, string> = {
  queued: 'back on the list to read',
  reading: 'as being read',
  read: 'read',
  abandoned: 'as given up',
};
const READING_NOTE_MAX = 20_000;

/** A link given for a reading: https only, as the columns' check constraints require. */
function httpsLink(value: string): string {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new LearnRefused('link must be a full https address.');
  }
  if (url.protocol !== 'https:') throw new LearnRefused('link must start with https://.');
  return url.toString();
}

/** The person's source for a link, found by its address or added, so the reading points at it. */
async function sourceFor(env: LearnWriteEnv, link: string, title: string): Promise<string> {
  const { data, error } = await env.learn
    .from('sources')
    .select('id')
    .eq('user_id', env.userId)
    .eq('canonical_url', link)
    .limit(1)
    .maybeSingle();
  if (error) throw new Error(`Looking up the source failed: ${error.message}`);
  if (data) return (data as { id: string }).id;
  const source = await inserted(
    env,
    'sources',
    { user_id: env.userId, title, kind: 'page', canonical_url: link, access: 'unknown', access_checked_at: new Date().toISOString() },
    'source',
  );
  return source.id as string;
}

async function changeReading(env: LearnWriteEnv, args: Args): Promise<LearnMade> {
  const id = idOf(args, 'reading_id', 'reading');
  const before = await ownRow(env, 'readings', id, 'reading');
  const title = named(before.title, 'the reading');
  const patch: Row = {};
  const said: string[] = [];

  if (sent(args, 'status')) {
    const status = text(args, 'status') as ReadingStatus;
    if (!READING_STATUSES.includes(status)) throw new LearnRefused(`status must be one of ${READING_STATUSES.join(', ')}.`);
    patch.status = status;
    // Finishing or giving up takes it off the shelf, as the reading page does.
    if (status === 'read' || status === 'abandoned') patch.read_now_at = null;
    said.push(`marked ${STATUS_WORDS[status]}`);
  }
  if (sent(args, 'read_now')) {
    if (typeof args.read_now !== 'boolean') throw new LearnRefused('read_now must be true or false.');
    if (args.read_now && patch.read_now_at === null) {
      throw new LearnRefused('A reading marked read or given up cannot go on the Read now shelf too.');
    }
    patch.read_now_at = args.read_now ? new Date().toISOString() : null;
    said.push(args.read_now ? 'put on the Read now shelf' : 'taken off the Read now shelf');
  }
  if (sent(args, 'note')) {
    if (typeof args.note !== 'string') throw new LearnRefused('note must be text.');
    const note = args.note.trim();
    if (note.length > READING_NOTE_MAX) throw new LearnRefused(`Keep the note under ${READING_NOTE_MAX} characters.`);
    patch.note = note || null;
    said.push(note ? 'its note written' : 'its note cleared');
  }
  if (sent(args, 'text')) {
    if (typeof args.text !== 'string') throw new LearnRefused('text must be the reading\'s text.');
    const cleaned = cleanReadingText(args.text);
    if (!cleaned.ok) throw new LearnRefused(cleaned.error);
    Object.assign(patch, { given_text: cleaned.text, given_text_label: PASTED_LABEL, given_text_at: new Date().toISOString() });
    said.push('its text kept for Dash to read');
  } else if (args.clear_text === true) {
    Object.assign(patch, { given_text: null, given_text_label: null, given_text_at: null });
    said.push('its kept text cleared');
  }
  if (sent(args, 'link')) {
    const link = httpsLink(text(args, 'link'));
    const sourceId = await sourceFor(env, link, title);
    Object.assign(patch, {
      source_id: sourceId,
      open_url: link,
      locator_kind: 'whole',
      locator_label: null,
      page_from: null,
      page_to: null,
      locator_confidence: 'unverified',
      locator_basis: 'Dash attached this link when asked. Nothing has been checked on it yet.',
    });
    said.push('given its link');
  }
  if (said.length === 0) {
    throw new LearnRefused('Say what to change: status, read_now, note, text, clear_text or link.');
  }

  const after = await updated(env, 'readings', id, patch, 'reading');
  const list = said.length === 1 ? said[0] : `${said.slice(0, -1).join(', ')} and ${said[said.length - 1]}`;
  const href = `/learn/r/${id}`;
  return {
    kind: 'change_reading',
    input: { verb: 'Changed', what: title, rest: `: ${list}`, href, where: 'Open the reading', paths: [href, '/learn/lists', '/learn/now'] },
    subjectRef: toRef('learn.readings', id),
    op: 'update',
    before,
    after,
    summary: `Dash changed the reading "${title}": ${list}.`,
    row: { table: 'learn.readings', ref: id, title, href, detail: { status: String(after.status) } },
  };
}

// ---------------------------------------------------------------------------
// add_learn_track, add_track_reading
// ---------------------------------------------------------------------------

async function addLearnTrack(env: LearnWriteEnv, args: Args): Promise<LearnMade> {
  const title = text(args, 'title');
  if (!title) throw new LearnRefused('title is missing: name the reading list.');
  if (title.length > 300) throw new LearnRefused('Keep the name under 300 characters; put the detail in question.');
  const question = text(args, 'question');
  if (question.length > 2000) throw new LearnRefused('Keep the question under 2000 characters.');

  const after = await inserted(env, 'tracks', { user_id: env.userId, title, question: question || null }, 'reading list');
  const id = after.id as string;
  const href = `/learn/t/${id}`;
  return {
    kind: 'add_learn_track',
    input: { verb: 'Started the reading list', what: named(title, title), rest: '', href, where: 'Open the list', paths: ['/learn/lists', href] },
    subjectRef: toRef('learn.tracks', id),
    op: 'insert',
    before: null,
    after,
    summary: `Dash started the reading list "${named(title, title)}".`,
    row: { table: 'learn.tracks', ref: id, title: named(title, title), href },
  };
}

async function addTrackReading(env: LearnWriteEnv, args: Args): Promise<LearnMade> {
  const trackId = idOf(args, 'track_id', 'reading list');
  const track = await ownRow(env, 'tracks', trackId, 'reading list');
  const title = text(args, 'title');
  if (!title) throw new LearnRefused('title is missing: say what to read.');
  if (title.length > 500) throw new LearnRefused('Keep the title under 500 characters; put the detail in why.');
  const why = text(args, 'why');
  if (why.length > 500) throw new LearnRefused('Keep why under 500 characters.');
  const link = sent(args, 'link') ? httpsLink(text(args, 'link')) : null;

  // At the end of the list, as the list page adds one.
  const { data: last, error } = await env.learn
    .from('readings')
    .select('position')
    .eq('track_id', trackId)
    .eq('user_id', env.userId)
    .order('position', { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) throw new Error(`Reading the list failed: ${error.message}`);
  const position = ((last as { position: number } | null)?.position ?? 0) + 10;

  const after = await inserted(
    env,
    'readings',
    {
      user_id: env.userId,
      track_id: trackId,
      source_id: link ? await sourceFor(env, link, title) : null,
      open_url: link,
      title,
      why: why || null,
      position,
      locator_kind: 'whole',
      locator_basis: link
        ? 'Dash added this with the link it was given. Nothing has been checked on it yet.'
        : 'Dash added this when asked. Nothing has been looked up for it.',
      locator_confidence: 'unverified',
    },
    'reading',
  );
  const id = after.id as string;
  const href = `/learn/r/${id}`;
  const list = named(track.title, 'the list');
  return {
    kind: 'add_track_reading',
    input: { verb: 'Added', what: named(title, title), rest: ` to ${list}`, href, where: 'Open the reading', paths: ['/learn/lists', `/learn/t/${trackId}`] },
    subjectRef: toRef('learn.readings', id),
    op: 'insert',
    before: null,
    after,
    summary: `Dash added "${named(title, title)}" to the reading list "${list}".`,
    row: { table: 'learn.readings', ref: id, title: named(title, title), href },
  };
}

// ---------------------------------------------------------------------------
// reword_concept, add_concept_note
// ---------------------------------------------------------------------------

async function rewordConcept(env: LearnWriteEnv, args: Args): Promise<LearnMade> {
  const id = idOf(args, 'concept_id', 'idea');
  const claim = text(args, 'claim');
  if (!claim) throw new LearnRefused('claim is missing: write the idea as a sentence somebody could be wrong about.');
  if (claim.length > MAX_CLAIM) throw new LearnRefused(`Keep the claim under ${MAX_CLAIM} characters.`);
  const before = await ownRow(env, 'concepts', id, 'idea');
  if (isSameClaim(String(before.claim ?? ''), claim)) throw new LearnRefused('The idea already says that. Nothing was changed.');

  const patch = await rewrittenClaimUpdate(
    env.learn,
    env.userId,
    { claim: String(before.claim ?? ''), claimOriginal: (before.claim_original as string | null) ?? null },
    claim,
  );
  const after = await updated(env, 'concepts', id, patch, 'idea');
  const name = named(before.name, 'the idea');
  const href = `/learn/c/${id}`;
  return {
    kind: 'reword_concept',
    input: { verb: 'Reworded', what: name, rest: `: ${quoted(claim)}`, href, where: 'Open the idea', paths: [href] },
    subjectRef: toRef('learn.concepts', id),
    op: 'update',
    before,
    after,
    summary: `Dash reworded the idea "${name}": ${quoted(claim, 160)}`,
    row: { table: 'learn.concepts', ref: id, title: name, href },
  };
}

async function addConceptNote(env: LearnWriteEnv, args: Args): Promise<LearnMade> {
  const parsed = noteBody(args.body);
  if ('error' in parsed) throw new LearnRefused(parsed.error);
  const hasCard = sent(args, 'card_id');
  if (hasCard === sent(args, 'concept_id')) throw new LearnRefused('Give one of concept_id or card_id.');

  let cardId: string | null = null;
  let conceptId: string | null;
  if (hasCard) {
    const card = await ownRow(env, 'feed_cards', idOf(args, 'card_id', 'card'), 'Learn now card');
    cardId = card.id as string;
    conceptId = (card.concept_id as string | null) ?? null;
  } else {
    conceptId = (await ownRow(env, 'concepts', idOf(args, 'concept_id', 'idea'), 'idea')).id as string;
  }
  const concept = conceptId
    ? await env.learn.from('concepts').select('name').eq('id', conceptId).eq('user_id', env.userId).maybeSingle()
    : null;
  const name = named((concept?.data as { name?: string } | null)?.name, 'a Learn card');

  const after = await inserted(
    env,
    'card_notes',
    { user_id: env.userId, card_id: cardId, concept_id: conceptId, body: parsed.body },
    'note',
  );
  const id = after.id as string;
  const href = conceptId ? `/learn/c/${conceptId}` : '/learn/now';
  return {
    kind: 'add_concept_note',
    input: {
      verb: 'Added a note to',
      what: name,
      rest: `: ${quoted(parsed.body)}`,
      href,
      where: conceptId ? 'Open the idea' : 'Open Learn now',
      paths: [href, '/learn/now'],
    },
    subjectRef: toRef('learn.card_notes', id),
    op: 'insert',
    before: null,
    after,
    summary: `Dash added a note to ${conceptId ? `the idea "${name}"` : 'a Learn now card'}: ${quoted(parsed.body, 160)}`,
    row: { table: 'learn.card_notes', ref: id, title: quoted(parsed.body), href },
  };
}

// ---------------------------------------------------------------------------
// change_video
// ---------------------------------------------------------------------------

const VIDEO_ID = /^[A-Za-z0-9_-]{11}$/;

async function changeVideo(env: LearnWriteEnv, args: Args): Promise<LearnMade> {
  const videoId = text(args, 'video_id');
  if (!VIDEO_ID.test(videoId)) throw new LearnRefused('video_id must be the YouTube video id, eleven characters, as a lookup returned it.');
  const before = await ownRow(env, 'watch_list', videoId, 'video on the watch list', 'video_id');
  const stamp = new Date().toISOString();
  const patch: Row = { updated_at: stamp };
  const said: string[] = [];

  if (sent(args, 'watched')) {
    if (typeof args.watched !== 'boolean') throw new LearnRefused('watched must be true or false.');
    patch.watched_at = args.watched ? stamp : null;
    said.push(args.watched ? 'marked watched' : 'marked not watched');
  }
  let moved = false;
  if (sent(args, 'pile')) {
    const pile = text(args, 'pile');
    if (!isVerdict(pile)) throw new LearnRefused(`pile must be one of ${VERDICTS.join(', ')}.`);
    // Kept as the person's verdict, which the judge never overwrites, as the
    // Videos page's own move is: they asked for it.
    Object.assign(patch, { verdict: pile, verdict_by: 'you', judged_at: stamp });
    said.push(`moved to ${PILE_LABEL[pile]}`);
    moved = true;
  }
  if (said.length === 0) throw new LearnRefused('Say what to change: watched or pile.');

  const id = before.id as string;
  const after = await updated(env, 'watch_list', id, patch, 'video');
  // The video's cards follow a move, as on the page; the hourly run settles them if this fails.
  if (moved) {
    await settleVideoCards(env.learn, env.userId).catch((error: unknown) => {
      console.error('[change_video] settling cards', error instanceof Error ? error.message : error);
    });
  }
  const { data: item } = before.item_id
    ? await env.learn.from('catalogue_items').select('title').eq('id', before.item_id as string).maybeSingle()
    : { data: null };
  const title = named((item as { title?: string } | null)?.title, `video ${videoId}`);
  const list = said.join(' and ');
  const href = `/learn/videos/${videoId}`;
  return {
    kind: 'change_video',
    input: { verb: 'Changed', what: title, rest: `: ${list}`, href, where: 'Open the video', paths: ['/learn/videos', href, '/learn/now'] },
    subjectRef: toRef('learn.watch_list', id),
    op: 'update',
    before,
    after,
    summary: `Dash changed the video "${title}": ${list}.`,
    row: { table: 'learn.watch_list', ref: id, title, href },
  };
}

// ---------------------------------------------------------------------------
// The definitions
// ---------------------------------------------------------------------------

const ID = (description: string) => ({ type: 'string', description }) as const;

/** The Learn writes, in the order a surface sends them. */
export const LEARN_WRITES: readonly LearnWrite[] = [
  {
    name: 'change_reading',
    description:
      "Change one reading on the person's Learn lists, when they ask: mark it queued, reading, read or abandoned (given up); put it on the Read now shelf or take it off; write or clear their note on it; keep the text of it for Dash to read (what they pasted, or a PDF's text), or clear that text; or give it the link it opens. Send only what they asked to change.",
    input_schema: {
      type: 'object',
      properties: {
        reading_id: ID('The reading, from reading_list, search or an earlier row.'),
        status: { type: 'string', enum: [...READING_STATUSES] },
        read_now: { type: 'boolean', description: 'True to put it on the Read now shelf, false to take it off.' },
        note: { type: 'string', description: 'Their note on it, replacing the one there. Empty clears it.' },
        text: { type: 'string', description: 'The text of the reading, which Dash reads instead of the link from then on.' },
        clear_text: { type: 'boolean', description: 'True to clear the text kept for it.' },
        link: { type: 'string', description: 'An https link to where it can be read, only one they gave.' },
      },
      required: ['reading_id'],
      additionalProperties: false,
    },
    run: changeReading,
  },
  {
    name: 'add_learn_track',
    description:
      'Start a new, empty reading list in Learn, when they ask for one on a topic. Add what goes on it with add_track_reading.',
    input_schema: {
      type: 'object',
      properties: {
        title: { type: 'string', description: 'The topic, in a few words.' },
        question: { type: 'string', description: 'What they want to understand, in a sentence, when they said.' },
      },
      required: ['title'],
      additionalProperties: false,
    },
    run: addLearnTrack,
  },
  {
    name: 'add_track_reading',
    description:
      'Add one thing to read at the end of one of their Learn reading lists, when they ask. Give the list, the work, why it is worth reading in their words, and a link only if they gave one.',
    input_schema: {
      type: 'object',
      properties: {
        track_id: ID('The reading list, from search or add_learn_track.'),
        title: { type: 'string', description: 'What to read, as they named it.' },
        why: { type: 'string', description: 'Why it is on the list, in a sentence.' },
        link: { type: 'string', description: 'An https link to it, only one they gave.' },
      },
      required: ['track_id', 'title'],
      additionalProperties: false,
    },
    run: addTrackReading,
  },
  {
    name: 'reword_concept',
    description:
      "Put one of the person's Learn ideas in new words, when they ask to reword or correct what it claims. The first wording is kept on the idea.",
    input_schema: {
      type: 'object',
      properties: {
        concept_id: ID('The idea, from list_rows on learn.concepts or an earlier row.'),
        claim: { type: 'string', description: 'The idea as a sentence or two somebody could be wrong about.' },
      },
      required: ['concept_id', 'claim'],
      additionalProperties: false,
    },
    run: rewordConcept,
  },
  {
    name: 'add_concept_note',
    description:
      'Write a note on one of their Learn ideas, or on a Learn now card (kept on the card and its idea), when they ask. Give exactly one of concept_id or card_id.',
    input_schema: {
      type: 'object',
      properties: {
        concept_id: ID('The idea, from list_rows on learn.concepts or an earlier row.'),
        card_id: ID('The card, from list_rows on learn.feed_cards or an earlier row.'),
        body: { type: 'string', description: 'The note, in their words.' },
      },
      required: ['body'],
      additionalProperties: false,
    },
    run: addConceptNote,
  },
  {
    name: 'change_video',
    description:
      "Mark a video on the person's Learn watch list watched or not, or move it to another pile (watch, card or skip) when they disagree with where it was put. Their move is kept as their own verdict.",
    input_schema: {
      type: 'object',
      properties: {
        video_id: { type: 'string', description: 'The YouTube video id, from list_rows on learn.watch_list.' },
        watched: { type: 'boolean' },
        pile: { type: 'string', enum: [...VERDICTS] },
      },
      required: ['video_id'],
      additionalProperties: false,
    },
    run: changeVideo,
  },
];

/** Runs one Learn write. Never throws: a refusal or a failure is the sentence the model reads. */
export async function runLearnWrite(
  write: LearnWrite,
  env: LearnWriteEnv,
  input: unknown,
): Promise<LearnMade | { ok: false; error: string }> {
  const args = input && typeof input === 'object' ? (input as Args) : {};
  try {
    return await write.run(env, args);
  } catch (error) {
    if (error instanceof LearnRefused) return { ok: false, error: error.message };
    console.error(`learn write ${write.name} failed`, error);
    return { ok: false, error: 'That change could not be made. Tell them nothing was changed.' };
  }
}

const ASK_NOTE =
  'It is done: it shows under your answer with an Undo. Say in your answer what you did, and cite the row this returned.';

/** The Learn writes as Ask's write tools, run on the person's own learn client. */
export const LEARN_WRITE_TOOLS: readonly DashWriteTool<DashWriteResult>[] = LEARN_WRITES.map((write) => ({
  name: write.name,
  kind: 'write' as const,
  definition: { name: write.name, description: `${write.description} ${ASK_NOTE}`, input_schema: write.input_schema },
  apply: async (ctx: DashWriteContext, input: unknown): Promise<DashWriteResult> => {
    if (!ctx.enabledModules.includes('learn')) {
      return { ok: false, error: 'The Learn workspace is switched off, so nothing can be changed there.' };
    }
    const env = { userId: ctx.userId, learn: (await ctx.db('learn')) as LearnSupabaseClient };
    const made = await runLearnWrite(write, env, input);
    if ('ok' in made) return made;
    return { ok: true, ...made, input: made.input as unknown as Record<string, unknown>, undo: null };
  },
}));

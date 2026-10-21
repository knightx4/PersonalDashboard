import { sameAs, noButton, type DashWriteRuns } from './runs';
import type Anthropic from '@anthropic-ai/sdk';
import { isUuid, type AskRow, type SchemaClient } from '@/lib/ask/db';
import type { LearnChangeInput, LearnChangeKind } from '@/lib/ask/learn-changes';
import { toRef } from '@/lib/core/refs';
import type { LearnSupabaseClient } from '@/lib/learn/db/schema-name';
import { BRIEF_DEPTHS, readSubQuestions, sameTopic, type BriefDepth } from '@/lib/learn/briefs/model';
import { FINDING_MAX, FINDING_QUOTE_MAX, FINDING_SOURCES_MAX, type FindingSource } from '@/lib/learn/briefs/findings';
import { essayTitle } from '@/lib/learn/essays/model';
import { briefStarter, type BriefStarter } from '@/lib/learn/briefs/start';
import { rewrittenClaimUpdate } from '@/lib/learn/graph/rewrite-save';
import { isSameClaim, MAX_CLAIM } from '@/lib/learn/graph/rewrite';
import { noteBody } from '@/lib/learn/notes/notes';
import { cleanReadingText, PASTED_LABEL } from '@/lib/learn/tracks/reading-text';
import type { ResolvedSource } from '@/lib/learn/import/resolve-payload';
import { insertCardNote, insertConceptNote } from '@/lib/learn/notes/store';
import { findReadingForLink } from '@/lib/learn/tracks/link';
import { addManualReading, attachSourceToReading, createTrack, setReadingNote, setReadingText, setReadNow, upsertSource } from '@/lib/learn/tracks/save';
import { markReadingStatus } from '@/lib/learn/tracks/status';
import { settleVideoCards } from '@/lib/learn/youtube/video-card-run';
import { fileVideo, isVerdict, PILE_LABEL, setWatched, VERDICTS, type Verdict } from '@/lib/learn/youtube/videos';
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
 *   research_topic     a reading list and a research brief on a topic, with
 *                      the run that fills them in started (plan #2023.3).
 *   add_to_brief       a finding, with its sources, added to a brief after
 *                      its run, in learn.brief_findings, which the run never
 *                      writes, so a later run keeps it.
 *   attach_vault_note  a vault note attached to an essay's notes, in
 *                      learn.essay_vault_notes; Update the map reads it.
 *
 * Each is one row, inserted or updated, so the one undo rule in
 * lib/core/dash-actions.ts puts it back from the values kept (#1894.4: an
 * agent's writes go straight in, each listed on Home with an Undo). The
 * exception is research_topic, whose brief the run goes on filling in after
 * the change is kept: its Undo archives the brief and shelves its list
 * (`undo.archive_brief`), as archivesBrief there says.
 *
 * Both Ask and the connector run them. Ask runs them as a write tool on the
 * person's own clients and keeps the change with its card; the connector runs
 * them on a service-role client for the verified person and records them with
 * core.record_dash_action. The service role passes no row level security, so
 * every read and write here names the person's user id itself.
 */

/**
 * Who the change is for, and their learn client: all a Learn write needs.
 * `research` starts a brief's run, for research_topic, and `vault` is their
 * obsidian client, for attach_vault_note to find the note; without one, the
 * tool that needs it is refused.
 */
export type LearnWriteEnv = {
  userId: string;
  learn: LearnSupabaseClient;
  research?: BriefStarter;
  vault?: SchemaClient;
};

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
  /** What undoing needs beyond the row, kept in the record's `undo` column. */
  undo?: Record<string, unknown> | null;
};

export type LearnWrite = {
  name: LearnChangeKind;
  /** The buttons it does the same as, or why none does (./runs.ts). */
  runs: DashWriteRuns;
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

/** A link Dash was given, as a page of unknown access, for upsertSource and attachSourceToReading. */
function givenPage(link: string, title: string, basis: string): ResolvedSource {
  return {
    title,
    author: null,
    kind: 'page',
    year: null,
    canonical_url: link,
    access: 'unknown',
    price_cents: null,
    page_count: null,
    locator_kind: 'whole',
    locator_label: null,
    page_from: null,
    page_to: null,
    locator_basis: basis,
    locator_verified: false,
    why: null,
    not_found: false,
  };
}

async function changeReading(env: LearnWriteEnv, args: Args): Promise<LearnMade> {
  const id = idOf(args, 'reading_id', 'reading');
  const before = await ownRow(env, 'readings', id, 'reading');
  const title = named(before.title, 'the reading');
  // Each change is checked first, then made through the reading page's own
  // write (lib/learn/tracks/save.ts and status.ts), narrowed to the person.
  const writes: (() => Promise<unknown>)[] = [];
  const said: string[] = [];

  let finished = false;
  if (sent(args, 'status')) {
    const status = text(args, 'status') as ReadingStatus;
    if (!READING_STATUSES.includes(status)) throw new LearnRefused(`status must be one of ${READING_STATUSES.join(', ')}.`);
    // Finishing or giving up takes it off the shelf, and finishing records
    // the outcome Learn next orders from, as the reading page does.
    finished = status === 'read' || status === 'abandoned';
    writes.push(() => markReadingStatus(env.learn, env.userId, id, status));
    said.push(`marked ${STATUS_WORDS[status]}`);
  }
  if (sent(args, 'read_now')) {
    if (typeof args.read_now !== 'boolean') throw new LearnRefused('read_now must be true or false.');
    if (args.read_now && finished) {
      throw new LearnRefused('A reading marked read or given up cannot go on the Read now shelf too.');
    }
    const on = args.read_now;
    writes.push(() => setReadNow(env.learn, id, on, env.userId));
    said.push(on ? 'put on the Read now shelf' : 'taken off the Read now shelf');
  }
  if (sent(args, 'note')) {
    if (typeof args.note !== 'string') throw new LearnRefused('note must be text.');
    const note = args.note;
    if (note.length > READING_NOTE_MAX) throw new LearnRefused(`Keep the note under ${READING_NOTE_MAX} characters.`);
    writes.push(() => setReadingNote(env.learn, id, note, env.userId));
    said.push(note.trim() ? 'its note written' : 'its note cleared');
  }
  if (sent(args, 'text')) {
    if (typeof args.text !== 'string') throw new LearnRefused('text must be the reading\'s text.');
    const cleaned = cleanReadingText(args.text);
    if (!cleaned.ok) throw new LearnRefused(cleaned.error);
    writes.push(() => setReadingText(env.learn, id, { text: cleaned.text, label: PASTED_LABEL }, env.userId));
    said.push('its text kept for Dash to read');
  } else if (args.clear_text === true) {
    writes.push(() => setReadingText(env.learn, id, null, env.userId));
    said.push('its kept text cleared');
  }
  if (sent(args, 'link')) {
    const link = httpsLink(text(args, 'link'));
    const page = givenPage(link, title, 'Dash attached this link when asked. Nothing has been checked on it yet.');
    writes.push(() => attachSourceToReading(env.learn, env.userId, id, page));
    said.push('given its link');
  }
  if (said.length === 0) {
    throw new LearnRefused('Say what to change: status, read_now, note, text, clear_text or link.');
  }

  for (const write of writes) await write();
  const after = await ownRow(env, 'readings', id, 'reading');
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

  const id = await createTrack(env.learn, env.userId, { title, question: question || null });
  const after = await ownRow(env, 'tracks', id, 'reading list');
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
  // A link is kept once, as saving one on Reading lists finds the reading already there.
  if (link) {
    const held = await findReadingForLink(env.learn, env.userId, link);
    if (held) throw new LearnRefused(`That link is on their lists already, as "${named(held.title, link)}". Nothing was added.`);
  }

  // At the end of the list, through the write the list page's Add makes.
  const basis = link
    ? 'Dash added this with the link it was given. Nothing has been checked on it yet.'
    : 'Dash added this when asked. Nothing has been looked up for it.';
  const sourceId = link ? await upsertSource(env.learn, env.userId, givenPage(link, title, basis)) : null;
  const id = await addManualReading(env.learn, env.userId, {
    trackId,
    title,
    why: why || null,
    basis,
    link: link && sourceId ? { sourceId, url: link } : null,
  });
  const after = await ownRow(env, 'readings', id, 'reading');
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

  let conceptId: string | null;
  let card: Row | null = null;
  if (hasCard) {
    card = await ownRow(env, 'feed_cards', idOf(args, 'card_id', 'card'), 'Learn now card');
    conceptId = (card.concept_id as string | null) ?? null;
  } else {
    conceptId = (await ownRow(env, 'concepts', idOf(args, 'concept_id', 'idea'), 'idea')).id as string;
  }
  const concept = conceptId
    ? await env.learn.from('concepts').select('name').eq('id', conceptId).eq('user_id', env.userId).maybeSingle()
    : null;
  const name = named((concept?.data as { name?: string } | null)?.name, 'a Learn card');

  // The write the card's and the idea's own Add note make.
  const note = card
    ? await insertCardNote(env.learn, env.userId, card.id as string, parsed.body)
    : await insertConceptNote(env.learn, env.userId, conceptId as string, parsed.body);
  if (!note) throw new LearnRefused('That is not there any more. Nothing was kept.');
  const id = note.id;
  const after = await ownRow(env, 'card_notes', id, 'note');
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
  const now = new Date();
  const said: string[] = [];

  let watched: boolean | null = null;
  if (sent(args, 'watched')) {
    if (typeof args.watched !== 'boolean') throw new LearnRefused('watched must be true or false.');
    watched = args.watched;
    said.push(watched ? 'marked watched' : 'marked not watched');
  }
  let pile: Verdict | null = null;
  if (sent(args, 'pile')) {
    const asked = text(args, 'pile');
    if (!isVerdict(asked)) throw new LearnRefused(`pile must be one of ${VERDICTS.join(', ')}.`);
    pile = asked;
    said.push(`moved to ${PILE_LABEL[pile]}`);
  }
  if (said.length === 0) throw new LearnRefused('Say what to change: watched or pile.');

  // The Videos page's own writes. A move is kept as the person's verdict,
  // which the judge never overwrites, as the page's move is: they asked for it.
  if (watched !== null) await setWatched(env.learn, env.userId, videoId, watched, now);
  if (pile) await fileVideo(env.learn, env.userId, videoId, pile, now);
  const moved = pile !== null;
  const id = before.id as string;
  const after = await ownRow(env, 'watch_list', id, 'video');
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
// research_topic
// ---------------------------------------------------------------------------

const QUESTION_MAX = 500;
const REASON_MAX = 1000;
/** How many open briefs are read to find one on the same topic. */
const OPEN_BRIEFS_READ = 100;

async function researchTopic(env: LearnWriteEnv, args: Args): Promise<LearnMade> {
  const question = text(args, 'topic');
  if (!question) throw new LearnRefused('topic is missing: say what they want to learn, in their words.');
  if (question.length > QUESTION_MAX) throw new LearnRefused(`Keep the topic under ${QUESTION_MAX} characters; put the rest in reason.`);
  const angle = text(args, 'reason');
  if (angle.length > REASON_MAX) throw new LearnRefused(`Keep the reason under ${REASON_MAX} characters.`);
  const depth = (text(args, 'depth') || 'standard') as BriefDepth;
  if (!BRIEF_DEPTHS.includes(depth)) throw new LearnRefused(`depth must be one of ${BRIEF_DEPTHS.join(', ')}.`);
  if (!env.research) throw new LearnRefused('Research cannot be started from here. Tell them nothing was started.');

  // One brief a topic: a request for one already open links to it.
  const { data: open, error } = await env.learn
    .from('briefs')
    .select('id, question, status')
    .eq('user_id', env.userId)
    .is('archived_at', null)
    .order('created_at', { ascending: false })
    .limit(OPEN_BRIEFS_READ);
  if (error) throw new Error(`Reading their briefs failed: ${error.message}`);
  const same = ((open ?? []) as { id: string; question: string; status: string }[]).find((b) => sameTopic(b.question, question));
  if (same) {
    const state = same.status === 'researching' ? 'still being researched' : same.status === 'failed' ? 'stopped with an error, and its page has Try again' : 'ready';
    throw new LearnRefused(
      `They already have a brief on this, "${named(same.question, 'their question')}", ${state}. Nothing new was started. ` +
        `Link them to that one, /learn/b/${same.id}; list_rows on learn.briefs returns it to cite.`,
    );
  }

  const subQuestions = await env.research.frame(question, angle);
  const title = named(question, question);
  const track = await inserted(env, 'tracks', { user_id: env.userId, title: question.slice(0, 300), question }, 'reading list');
  const trackId = track.id as string;
  let after: Row;
  try {
    after = await inserted(
      env,
      'briefs',
      {
        user_id: env.userId,
        track_id: trackId,
        question,
        angle,
        depth,
        sub_questions: subQuestions ?? [],
        status: 'researching',
        stage: subQuestions ? 'searching' : 'framing',
      },
      'brief',
    );
  } catch (failure) {
    // An empty list with no brief is nothing they asked for.
    await env.learn.from('tracks').delete().eq('id', trackId).eq('user_id', env.userId);
    throw failure;
  }
  const id = after.id as string;
  env.research.start(id);

  const href = `/learn/b/${id}`;
  return {
    kind: 'research_topic',
    input: { verb: 'Started researching', what: title, rest: '', href, where: 'Open the brief', paths: [href, '/learn/lists', `/learn/t/${trackId}`] },
    subjectRef: toRef('learn.briefs', id),
    op: 'insert',
    before: null,
    after,
    summary: `Dash started researching "${title}".`,
    row: {
      table: 'learn.briefs',
      ref: id,
      title,
      href,
      detail: {
        status: 'researching',
        // One line each; none while the run is still choosing them.
        sub_questions: (subQuestions ?? []).map((q, i) => `${i + 1}. ${q.text}`).join('\n') || null,
        reading_list: `/learn/t/${trackId}`,
      },
    },
    undo: { archive_brief: true },
  };
}

// ---------------------------------------------------------------------------
// add_to_brief
// ---------------------------------------------------------------------------

/** The sources given with a finding, each with a title and an https link, or a refusal. */
function findingSources(raw: unknown): FindingSource[] {
  if (raw === undefined || raw === null) return [];
  if (!Array.isArray(raw)) throw new LearnRefused('sources must be a list of { title, url, quote }.');
  if (raw.length > FINDING_SOURCES_MAX) throw new LearnRefused(`Give at most ${FINDING_SOURCES_MAX} sources with one finding.`);
  return raw.map((item, i) => {
    const source = item && typeof item === 'object' ? (item as Args) : {};
    const title = text(source, 'title');
    if (!title) throw new LearnRefused(`Source ${i + 1} has no title: name the page or document.`);
    if (title.length > 300) throw new LearnRefused(`Keep source ${i + 1}'s title under 300 characters.`);
    const url = httpsLink(text(source, 'url'));
    const quote = text(source, 'quote');
    if (quote.length > FINDING_QUOTE_MAX) throw new LearnRefused(`Keep source ${i + 1}'s quote under ${FINDING_QUOTE_MAX} characters.`);
    return { title, url, quote };
  });
}

async function addToBrief(env: LearnWriteEnv, args: Args): Promise<LearnMade> {
  const briefId = idOf(args, 'brief_id', 'brief');
  const body = text(args, 'finding');
  if (!body) throw new LearnRefused('finding is missing: say what was found, in a few sentences.');
  if (body.length > FINDING_MAX) throw new LearnRefused(`Keep the finding under ${FINDING_MAX} characters; split it into two.`);
  const sources = findingSources(args.sources);
  const brief = await ownRow(env, 'briefs', briefId, 'brief');
  if (brief.archived_at) throw new LearnRefused('That brief is archived. Nothing was added.');

  const subQuestions = readSubQuestions(brief.sub_questions);
  let subQuestionId: string | null = null;
  let under = '';
  if (sent(args, 'sub_question')) {
    const n = args.sub_question;
    if (typeof n !== 'number' || !Number.isInteger(n) || n < 1 || n > subQuestions.length) {
      throw new LearnRefused(
        subQuestions.length
          ? `sub_question must be a number from 1 to ${subQuestions.length}, as the brief numbers them, or left out.`
          : 'This brief has no sub-questions yet. Leave sub_question out.',
      );
    }
    subQuestionId = subQuestions[n - 1].id;
    under = ` under "${quoted(subQuestions[n - 1].text)}"`;
  }

  const after = await inserted(
    env,
    'brief_findings',
    { user_id: env.userId, brief_id: briefId, sub_question_id: subQuestionId, body, sources },
    'finding',
  );
  const id = after.id as string;
  const title = named(brief.question, 'the brief');
  const href = `/learn/b/${briefId}`;
  const cited = sources.length === 0 ? '' : sources.length === 1 ? ', with one source' : `, with ${sources.length} sources`;
  return {
    kind: 'add_to_brief',
    input: { verb: 'Added a finding to', what: title, rest: `${under}${cited}: ${quoted(body)}`, href, where: 'Open the brief', paths: [href] },
    subjectRef: toRef('learn.brief_findings', id),
    op: 'insert',
    before: null,
    after,
    summary: `Dash added a finding to the brief "${title}"${under}${cited}: ${quoted(body, 160)}`,
    row: { table: 'learn.brief_findings', ref: id, title: quoted(body), href, detail: { brief: title, sources: sources.length } },
  };
}

// ---------------------------------------------------------------------------
// attach_vault_note
// ---------------------------------------------------------------------------

const WHY_MAX = 500;

async function attachVaultNote(env: LearnWriteEnv, args: Args): Promise<LearnMade> {
  const essayId = idOf(args, 'essay_id', 'essay');
  const ref = text(args, 'note');
  if (!ref) throw new LearnRefused('note is missing: give the note\'s ref (its path) as vault_notes, search or recall returned it.');
  const why = text(args, 'why');
  if (why.length > WHY_MAX) throw new LearnRefused(`Keep why under ${WHY_MAX} characters.`);
  if (!env.vault) throw new LearnRefused('Vault notes cannot be reached from here. Tell them nothing was attached.');

  const essay = await ownRow(env, 'essays', essayId, 'essay');
  const lookup = env.vault.from('notes').select('id, path, title').eq('user_id', env.userId).is('deleted_at', null);
  const { data: note, error } = await (isUuid(ref) ? lookup.eq('id', ref) : lookup.eq('path', ref.replace(/^\/+/, ''))).maybeSingle();
  if (error) throw new Error(`Reading the vault note failed: ${error.message}`);
  if (!note) throw new LearnRefused('There is no vault note of theirs at that ref. Find it with vault_notes or search first.');
  const { id: noteId, path, title: noteTitle } = note as { id: string; path: string; title: string };
  if (essay.note_id === noteId) throw new LearnRefused('That note is the essay itself. Nothing was attached.');

  const { data: already, error: alreadyError } = await env.learn
    .from('essay_vault_notes')
    .select('id')
    .eq('essay_id', essayId)
    .eq('note_id', noteId)
    .eq('user_id', env.userId)
    .maybeSingle();
  if (alreadyError) throw new Error(`Reading the essay's attached notes failed: ${alreadyError.message}`);
  if (already) throw new LearnRefused('That note is already attached to this essay. Nothing was changed.');

  const after = await inserted(
    env,
    'essay_vault_notes',
    { user_id: env.userId, essay_id: essayId, note_id: noteId, why },
    'attached note',
  );
  const id = after.id as string;
  const name = named(noteTitle || path, path);
  const essayName = named(essayTitle(String(essay.draft_body ?? ''), String(essay.path ?? '')), 'the essay');
  const href = `/learn/e/${essayId}`;
  return {
    kind: 'attach_vault_note',
    input: { verb: 'Attached', what: name, rest: ` to the notes of ${essayName}`, href, where: 'Open the essay', paths: [href] },
    subjectRef: toRef('learn.essay_vault_notes', id),
    op: 'insert',
    before: null,
    after,
    summary: `Dash attached the vault note "${name}" to the notes of the essay "${essayName}".`,
    row: { table: 'learn.essay_vault_notes', ref: id, title: name, href, detail: { essay: essayName, path } },
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
    runs: sameAs(
      ['app/learn/r/[id]/actions.ts#attachSource', 'lib/learn/tracks/save.ts#attachSourceToReading'],
      ['app/learn/r/[id]/actions.ts#updateStatus', 'lib/learn/tracks/status.ts#markReadingStatus'],
      ['app/learn/r/[id]/actions.ts#toggleReadNow', 'lib/learn/tracks/save.ts#setReadNow'],
      ['app/learn/r/[id]/actions.ts#updateNote', 'lib/learn/tracks/save.ts#setReadingNote'],
      ['app/learn/r/[id]/actions.ts#saveReadingText', 'lib/learn/tracks/save.ts#setReadingText'],
      ['app/learn/r/[id]/actions.ts#saveReadingPdf', 'lib/learn/tracks/save.ts#setReadingText'],
      ['app/learn/r/[id]/actions.ts#clearReadingText', 'lib/learn/tracks/save.ts#setReadingText'],
    ),
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
    runs: sameAs(['app/learn/lists/actions.ts#startTrack', 'lib/learn/tracks/save.ts#createTrack']),
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
    runs: sameAs(
      ['app/learn/save/actions.ts#saveReadingLink', 'lib/learn/tracks/save.ts#addManualReading'],
      ['app/learn/t/[id]/actions.ts#addToTrack', 'lib/learn/tracks/save.ts#addManualReading'],
    ),
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
    runs: sameAs(['app/learn/c/[id]/actions.ts#rewriteClaim', 'lib/learn/graph/rewrite-save.ts#rewrittenClaimUpdate']),
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
    runs: sameAs(
      ['app/learn/c/[id]/actions.ts#addConceptNote', 'lib/learn/notes/store.ts#insertConceptNote'],
      ['app/learn/now/actions.ts#addCardNote', 'lib/learn/notes/store.ts#insertCardNote'],
    ),
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
    runs: sameAs(
      ['app/learn/videos/actions.ts#setWatchedAction', 'lib/learn/youtube/videos.ts#setWatched'],
      ['app/learn/videos/actions.ts#moveVideoAction', 'lib/learn/youtube/video-card-run.ts#settleVideoCards'],
    ),
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
  {
    name: 'research_topic',
    runs: noButton('No page starts research from a sentence: the Learn pages propose a brief from a goal, which the person approves.'),
    description:
      'Research a topic they say they want to learn about ("I want to learn how SOX controls apply to AI", "look into X for me"): ' +
      'Dash makes a reading list and a brief, splits the question into three to five sub-questions, and spends the next few minutes ' +
      'searching the web and reading sources to answer each one with quotes. ' +
      'First look for why they want it with recall (their job search, notes and goals). If the reason is still unclear, ask them one ' +
      'question about why, and never a second. Then call this without asking them to confirm: the request is the go-ahead. ' +
      'Pass the topic as they put it, the reason in a sentence (empty only when they would not say), and depth only when they asked ' +
      'for a quick look or a deep one. In your answer, list the sub-questions this returns (an empty list means they are still being ' +
      'chosen) and link the brief, which fills in over a few minutes. If they already have an open brief on the topic, this starts ' +
      'nothing and says which one: link that.',
    input_schema: {
      type: 'object',
      properties: {
        topic: { type: 'string', description: 'What they want to learn, in their words, as a question or a topic.' },
        reason: { type: 'string', description: 'Why they want it, from what they said or what recall found, in a sentence.' },
        depth: { type: 'string', enum: [...BRIEF_DEPTHS], description: 'How much to search. standard unless they asked.' },
      },
      required: ['topic'],
      additionalProperties: false,
    },
    run: researchTopic,
  },
  {
    name: 'add_to_brief',
    runs: noButton('No page adds a finding to a research brief: the brief\'s own run writes its findings.'),
    description:
      'Add a finding to one of their research briefs, when they ask to add what a conversation found to their research ' +
      '("add this to my brief on X", "put these sources in my research"). Give the brief, the finding in a few sentences of ' +
      'your own, the sub-question it answers by its number on the brief (leave it out when it answers none), and each source ' +
      'it rests on with its title, its https link and the words quoted from it, exactly as the page has them. ' +
      'Only sources you actually read: never a link you did not open. A later run of the brief keeps it. ' +
      'To put a source on the brief\'s reading list too, add it with add_track_reading; to copy the finding into a vault ' +
      'note as well, use edit_vault_note or write_vault_note.',
    input_schema: {
      type: 'object',
      properties: {
        brief_id: ID('The brief, from list_rows on learn.briefs, search or an earlier row.'),
        finding: { type: 'string', description: 'What was found, in a few sentences.' },
        sub_question: { type: 'integer', description: 'The sub-question it answers, numbered from 1 as the brief shows them. Leave out when it answers none.' },
        sources: {
          type: 'array',
          description: 'What the finding rests on.',
          items: {
            type: 'object',
            properties: {
              title: { type: 'string', description: 'The page or document, as it names itself.' },
              url: { type: 'string', description: 'Its https link.' },
              quote: { type: 'string', description: 'The words the finding rests on, exactly as the page has them.' },
            },
            required: ['title', 'url'],
            additionalProperties: false,
          },
        },
      },
      required: ['brief_id', 'finding'],
      additionalProperties: false,
    },
    run: addToBrief,
  },
  {
    name: 'attach_vault_note',
    runs: noButton('The essay\'s Notes tab can only take a vault note off (detachVaultNote); attaching one is Dash\'s alone.'),
    description:
      "Attach one of their vault notes to the notes of one of their Learn essays, when they ask (\"attach my Walzer note to " +
      'the essay", "use this note for my essay"). The note is listed on the essay\'s Notes tab and Dash reads it with their ' +
      'notes when they press Update the map. Nothing is copied into the notes. Give the essay and the note by the ref ' +
      'vault_notes, search or recall returned for it.',
    input_schema: {
      type: 'object',
      properties: {
        essay_id: ID('The essay, from list_rows on learn.essays, search or an earlier row.'),
        note: { type: 'string', description: "The vault note's ref, its path, as vault_notes, search or recall returned it." },
        why: { type: 'string', description: 'What it brings to the essay, in a sentence, when they said.' },
      },
      required: ['essay_id', 'note'],
      additionalProperties: false,
    },
    run: attachVaultNote,
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
  runs: write.runs,
  definition: { name: write.name, description: `${write.description} ${ASK_NOTE}`, input_schema: write.input_schema },
  apply: async (ctx: DashWriteContext, input: unknown): Promise<DashWriteResult> => {
    if (!ctx.enabledModules.includes('learn')) {
      return { ok: false, error: 'The Learn workspace is switched off, so nothing can be changed there.' };
    }
    const learn = (await ctx.db('learn')) as LearnSupabaseClient;
    const vault = write.name === 'attach_vault_note' && ctx.enabledModules.includes('vault') ? await ctx.db('obsidian') : undefined;
    const env: LearnWriteEnv = { userId: ctx.userId, learn, research: briefStarter({ learn, userId: ctx.userId }), vault };
    const made = await runLearnWrite(write, env, input);
    if ('ok' in made) return made;
    return { ok: true, ...made, input: made.input as unknown as Record<string, unknown>, undo: made.undo ?? null };
  },
}));

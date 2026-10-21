import { sameAs, type DashWriteRuns } from './runs';
import type Anthropic from '@anthropic-ai/sdk';
import { isUuid, type AskRow, type SchemaClient } from '@/lib/ask/db';
import type { NewsChangeInput, NewsChangeKind } from '@/lib/ask/news-changes';
import { toRef } from '@/lib/core/refs';
import type { ModuleId } from '@/lib/modules';
import type { LearnSupabaseClient } from '@/lib/learn/db/schema-name';
import { queueNewsStory } from '@/lib/learn/tracks/news';
import type { NewsSupabaseClient } from '@/lib/news/db/schema-name';
import { stopRunningWatch } from '@/lib/core/watches';
import { markUnread } from '@/lib/news/issues/read';
import { findSavedStory, removeSavedStoryById, resaveStoryById, saveStory, type SavedStoryRef } from '@/lib/news/saved/stories';
import { findOpenStoryTasks, makeStoryTask } from '@/lib/todo/links/story';
import type { TodoSupabaseClient } from '@/lib/todo/db/schema-name';
import type { DashWriteContext, DashWriteResult, DashWriteTool } from './registry';

/**
 * The News changes an agent makes when asked, and stopping a price watch
 * (plan #1894.9.4, feature #1894):
 *
 *   mark_issue_unread     a newsletter put back in the unread list.
 *   save_story            a story saved to the Saved list, or taken off it.
 *   send_story_to_learn   a story put on the From News reading list.
 *   make_todo_from_story  a todo titled with a story's headline, pointing at it.
 *   stop_watch            a price watch Dash is running, stopped.
 *
 * Each names one row as its subject, inserted, updated or removed, so the one
 * undo rule in lib/core/dash-actions.ts puts it back from the values kept
 * (#1894.4: an agent's writes go straight in, each listed on Home with an
 * Undo). Sending a story to Learn or making a todo from it saves the story
 * first, as the buttons do; the reading or the todo is the row the Undo takes
 * away, and the story stays on Saved.
 *
 * Both Ask and the connector run them, as Todo's (lib/dash/todo-writes.ts):
 * Ask on the person's own clients, the connector on service-role ones for the
 * verified person. The service role passes no row level security, and the
 * page's own helpers read a newsletter or a saved story by its id alone, so
 * every ref is checked against the person's user id here before one is used.
 */

export type NewsWriteEnv = {
  userId: string;
  news: SchemaClient;
  learn: SchemaClient;
  todo: SchemaClient;
  core: SchemaClient;
};

/** A News change as made, before a surface keeps it. */
export type NewsMade = {
  kind: NewsChangeKind;
  input: NewsChangeInput;
  subjectRef: string;
  op: 'insert' | 'update' | 'delete';
  before: Record<string, unknown> | null;
  after: Record<string, unknown> | null;
  summary: string;
  row: AskRow;
};

export type NewsWrite = {
  name: NewsChangeKind;
  /** The buttons it does the same as, or why none does (./runs.ts). */
  runs: DashWriteRuns;
  /** The workspaces that must be switched on for the change. */
  modules: readonly ModuleId[];
  /** Without the line each surface adds on where the change shows. */
  description: string;
  input_schema: Anthropic.Tool['input_schema'];
  run: (env: NewsWriteEnv, args: Args) => Promise<NewsMade>;
};

/** A refusal the model reads and says in words. */
export class NewsRefused extends Error {}

type Args = Record<string, unknown>;
type Row = Record<string, unknown>;

function text(args: Args, key: string): string {
  const value = args[key];
  return typeof value === 'string' ? value.trim() : '';
}

function idOf(args: Args, key: string, what: string): string {
  const id = text(args, key);
  if (!id) throw new NewsRefused(`${key} is missing: give the ${what}'s ref from a lookup.`);
  if (!isUuid(id)) throw new NewsRefused(`${key} must be a ${what}'s ref, as a lookup returned it.`);
  return id;
}

/** A headline cut to a line for a sentence. */
function named(title: unknown, fallback: string): string {
  const line = typeof title === 'string' ? title.split('\n')[0].trim() : '';
  if (!line) return fallback;
  return line.length > 120 ? `${line.slice(0, 119).trimEnd()}…` : line;
}

async function ownRow(client: SchemaClient, table: string, id: string, userId: string, what: string): Promise<Row> {
  const { data, error } = await client.from(table).select('*').eq('id', id).eq('user_id', userId).maybeSingle();
  if (error) throw new Error(`Reading the ${what} failed: ${error.message}`);
  if (!data) throw new NewsRefused(`There is no ${what} of theirs with that ref. Look it up first.`);
  return data as Row;
}

const issueHref = (id: string) => `/news/i/${id}`;
const SAVED_HREF = '/news/saved';

// ---------------------------------------------------------------------------
// mark_issue_unread
// ---------------------------------------------------------------------------

async function markIssueUnread(env: NewsWriteEnv, args: Args): Promise<NewsMade> {
  const id = idOf(args, 'issue_ref', 'newsletter issue');
  const before = await ownRow(env.news, 'issues', id, env.userId, 'newsletter issue');
  if (before.read_at === null || before.read_at === undefined) throw new NewsRefused('That newsletter is unread already.');
  // The issue page's own write, by id alone: whose issue it is was checked just above.
  await markUnread(asNews(env), id);
  const data = await ownRow(env.news, 'issues', id, env.userId, 'newsletter issue');

  const title = named(before.subject ?? before.title, 'the newsletter');
  const href = issueHref(id);
  return {
    kind: 'mark_issue_unread',
    input: { verb: 'Marked', what: title, rest: ' unread', href, where: 'Open in News', paths: ['/news', '/news/all', '/home'] },
    subjectRef: toRef('news.issues', id),
    op: 'update',
    before,
    after: data as Row,
    summary: `Dash marked the newsletter "${title}" unread.`,
    row: { table: 'news.issues', ref: id, title, href },
  };
}

// ---------------------------------------------------------------------------
// The story a change names
// ---------------------------------------------------------------------------

/** Which story: by its newsletter and headline, or by its row on Saved. */
type StoryTarget = { issueId: string; headline: string } | { savedStoryId: string };

function storyTarget(args: Args): StoryTarget {
  if (text(args, 'saved_story_ref')) return { savedStoryId: idOf(args, 'saved_story_ref', 'saved story') };
  const headline = text(args, 'headline');
  if (!headline) throw new NewsRefused('Name the story: issue_ref and headline, or saved_story_ref for one already on Saved.');
  return { issueId: idOf(args, 'issue_ref', 'newsletter issue'), headline };
}

const asNews = (env: NewsWriteEnv) => env.news as NewsSupabaseClient;

/**
 * The saved row for a story, saving it first when it is named by its
 * newsletter. Whether the person owns the newsletter or the saved row is
 * checked before the page's helpers, which read by id alone, are used.
 */
async function savedFor(env: NewsWriteEnv, target: StoryTarget): Promise<{ story: SavedStoryRef; wasSaved: boolean }> {
  if ('savedStoryId' in target) {
    const own = await ownRow(env.news, 'saved_stories', target.savedStoryId, env.userId, 'saved story');
    const story = await resaveStoryById(asNews(env), own.id as string);
    if (!story) throw new NewsRefused('That story could not be found.');
    return { story, wasSaved: own.unsaved_at === null || own.unsaved_at === undefined };
  }
  await ownRow(env.news, 'issues', target.issueId, env.userId, 'newsletter issue');
  const prior = await findSavedStory(asNews(env), target);
  const found = await saveStory(asNews(env), { userId: env.userId, ...target });
  if (!found) throw new NewsRefused('That story is not in the newsletter. Check the headline against the issue.');
  const story = await findSavedStory(asNews(env), target);
  if (!story) throw new NewsRefused('That story could not be found.');
  const wasSaved = prior !== null && (await isListed(env, prior.id));
  return { story, wasSaved };
}

async function isListed(env: NewsWriteEnv, id: string): Promise<boolean> {
  const { data } = await env.news.from('saved_stories').select('unsaved_at').eq('id', id).eq('user_id', env.userId).maybeSingle();
  return !!data && (data as Row).unsaved_at == null;
}

// ---------------------------------------------------------------------------
// save_story
// ---------------------------------------------------------------------------

async function saveStoryTool(env: NewsWriteEnv, args: Args): Promise<NewsMade> {
  if (typeof args.saved !== 'boolean') throw new NewsRefused('saved must be true to save the story or false to take it off Saved.');
  const target = storyTarget(args);

  if (args.saved) {
    // The row as it stood: absent, or kept but unsaved, and the save puts it on the list.
    let priorRow: Row | null = null;
    if ('savedStoryId' in target) {
      priorRow = await ownRow(env.news, 'saved_stories', target.savedStoryId, env.userId, 'saved story');
    } else {
      await ownRow(env.news, 'issues', target.issueId, env.userId, 'newsletter issue');
      const { data } = await env.news
        .from('saved_stories')
        .select('*')
        .eq('issue_id', target.issueId)
        .eq('headline', target.headline)
        .eq('user_id', env.userId)
        .maybeSingle();
      priorRow = (data as Row | null) ?? null;
    }
    if (priorRow && priorRow.unsaved_at == null) throw new NewsRefused('That story is saved already.');
    const { story } = await savedFor(env, target);
    const { data: after, error } = await env.news.from('saved_stories').select('*').eq('id', story.id).eq('user_id', env.userId).single();
    if (error || !after) throw new Error(`Reading the saved story failed: ${error?.message ?? 'no row'}`);
    const title = named(story.headline, 'the story');
    return {
      kind: 'save_story',
      input: { verb: 'Saved', what: title, rest: ' to Saved', href: SAVED_HREF, where: 'Open Saved', paths: ['/news', '/news/saved'] },
      subjectRef: toRef('news.saved_stories', story.id),
      op: priorRow ? 'update' : 'insert',
      before: priorRow,
      after: after as Row,
      summary: `Dash saved the story "${title}" to Saved.`,
      row: { table: 'news.saved_stories', ref: story.id, title, href: SAVED_HREF },
    };
  }

  // Unsaving: news.unsave_story deletes the row, or keeps it unsaved when a reading or a todo points at it.
  let before: Row;
  if ('savedStoryId' in target) {
    before = await ownRow(env.news, 'saved_stories', target.savedStoryId, env.userId, 'saved story');
  } else {
    await ownRow(env.news, 'issues', target.issueId, env.userId, 'newsletter issue');
    const { data, error } = await env.news
      .from('saved_stories')
      .select('*')
      .eq('issue_id', target.issueId)
      .eq('headline', target.headline)
      .eq('user_id', env.userId)
      .maybeSingle();
    if (error) throw new Error(`Reading the saved story failed: ${error.message}`);
    if (!data) throw new NewsRefused('That story is not saved.');
    before = data as Row;
  }
  if (before.unsaved_at != null) throw new NewsRefused('That story is not saved.');
  const id = before.id as string;
  await removeSavedStoryById(asNews(env), id);
  const { data: kept } = await env.news.from('saved_stories').select('*').eq('id', id).eq('user_id', env.userId).maybeSingle();

  const title = named(before.headline, 'the story');
  return {
    kind: 'save_story',
    input: { verb: 'Took', what: title, rest: ' off Saved', href: SAVED_HREF, where: 'Open Saved', paths: ['/news', '/news/saved'] },
    subjectRef: toRef('news.saved_stories', id),
    op: kept ? 'update' : 'delete',
    before,
    after: (kept as Row | null) ?? null,
    summary: `Dash took the story "${title}" off Saved.`,
    row: { table: 'news.saved_stories', ref: id, title, href: SAVED_HREF },
  };
}

// ---------------------------------------------------------------------------
// send_story_to_learn
// ---------------------------------------------------------------------------

async function sendStoryToLearn(env: NewsWriteEnv, args: Args): Promise<NewsMade> {
  const { story } = await savedFor(env, storyTarget(args));
  const queued = await queueNewsStory(env.learn as LearnSupabaseClient, env.userId, {
    id: story.id,
    headline: story.headline,
    link: story.link,
    senderName: story.senderName,
  });
  const title = named(story.headline, 'the story');
  if (!queued.created) throw new NewsRefused(`"${title}" is on the Learn reading queue already.`);
  const after = await ownRow(env.learn, 'readings', queued.readingId, env.userId, 'reading');
  const href = `/learn/r/${queued.readingId}`;
  return {
    kind: 'send_story_to_learn',
    input: { verb: 'Sent', what: title, rest: ' to Learn', href, where: 'Open in Learn', paths: ['/news', '/news/saved', '/learn/lists', '/learn/now'] },
    subjectRef: toRef('learn.readings', queued.readingId),
    op: 'insert',
    before: null,
    after,
    summary: `Dash sent the story "${title}" to the From News list in Learn. It is on Saved too.`,
    row: { table: 'learn.readings', ref: queued.readingId, title, href },
  };
}

// ---------------------------------------------------------------------------
// make_todo_from_story
// ---------------------------------------------------------------------------

async function makeTodoFromStory(env: NewsWriteEnv, args: Args): Promise<NewsMade> {
  const { story } = await savedFor(env, storyTarget(args));
  const title = named(story.headline, 'the story');
  const existing = (await findOpenStoryTasks(env.todo as TodoSupabaseClient, [story.id])).get(story.id);
  if (existing) throw new NewsRefused(`"${title}" is an open todo already.`);

  // The button's own write: the todo and its link, and a refused link drops
  // the todo. It has no due date, so the zone it is read in never matters.
  const { taskId } = await makeStoryTask(env.todo as TodoSupabaseClient, env.userId, story, 'UTC');
  const task = await ownRow(env.todo, 'tasks', taskId, env.userId, 'todo');

  const href = `/todo/all?status=all&focus=${taskId}`;
  return {
    kind: 'make_todo_from_story',
    input: { verb: 'Made', what: title, rest: ' a todo', href, where: 'Open in Todo', paths: ['/news', '/news/saved', '/todo', '/todo/all', '/home'] },
    subjectRef: toRef('todo.tasks', taskId),
    op: 'insert',
    before: null,
    after: task as Row,
    summary: `Dash made a todo from the story "${title}". It is on Saved too.`,
    row: { table: 'todo.tasks', ref: taskId, title, href },
  };
}

// ---------------------------------------------------------------------------
// stop_watch
// ---------------------------------------------------------------------------

async function stopWatch(env: NewsWriteEnv, args: Args): Promise<NewsMade> {
  const id = idOf(args, 'watch_ref', 'watch');
  const before = await ownRow(env.core, 'watches', id, env.userId, 'watch');
  if (before.status !== 'running') throw new NewsRefused('That watch is not running any more.');
  const { row: data, error } = await stopRunningWatch(env.core, env.userId, id);
  if (error) throw new Error(`Stopping the watch failed: ${error}`);
  if (!data) throw new NewsRefused('That watch is not running any more.');

  const title = named(before.title, 'the watch');
  return {
    kind: 'stop_watch',
    input: { verb: 'Stopped', what: title, rest: ' (a price watch)', href: '/home', where: 'Open Home', paths: ['/home'] },
    subjectRef: toRef('core.watches', id),
    op: 'update',
    before,
    after: data as Row,
    summary: `Dash stopped the price watch "${title}".`,
    row: { table: 'core.watches', ref: id, title, href: '/home' },
  };
}

// ---------------------------------------------------------------------------
// The tools
// ---------------------------------------------------------------------------

const ISSUE_REF = { type: 'string', description: "The news.issues ref a lookup returned for the newsletter." } as const;

const STORY_PROPERTIES = {
  issue_ref: { ...ISSUE_REF, description: 'The news.issues ref of the newsletter the story is in. Give it with headline.' },
  headline: { type: 'string', description: "The story's headline exactly as the newsletter printed it." },
  saved_story_ref: {
    type: 'string',
    description: 'Instead of issue_ref and headline: the news.saved_stories ref of a story already on Saved.',
  },
} as const;

export const NEWS_WRITES: readonly NewsWrite[] = [
  {
    name: 'mark_issue_unread',
    runs: sameAs(['app/news/i/[id]/actions.ts#markIssueUnread', 'lib/news/issues/read.ts#markUnread']),
    modules: ['news'],
    description:
      'Put one newsletter back in the unread list, when they ask. Name it by the news.issues ref a lookup returned.',
    input_schema: {
      type: 'object',
      properties: { issue_ref: ISSUE_REF },
      required: ['issue_ref'],
      additionalProperties: false,
    },
    run: markIssueUnread,
  },
  {
    name: 'save_story',
    runs: sameAs(
      ['app/news/i/[id]/actions.ts#setStorySaved', 'lib/news/saved/stories.ts#saveStory'],
      ['app/news/saved/actions.ts#removeSaved', 'lib/news/saved/stories.ts#removeSavedStoryById'],
    ),
    modules: ['news'],
    description:
      'Save a story from a newsletter to the Saved list, or take one off it, when they ask. saved true saves; false takes it off. Name the story by issue_ref and headline, or by saved_story_ref when it is on Saved already.',
    input_schema: {
      type: 'object',
      properties: { ...STORY_PROPERTIES, saved: { type: 'boolean', description: 'True to save the story, false to take it off Saved.' } },
      required: ['saved'],
      additionalProperties: false,
    },
    run: saveStoryTool,
  },
  {
    name: 'send_story_to_learn',
    runs: sameAs(['app/news/i/[id]/actions.ts#sendStoryToLearn', 'lib/learn/tracks/news.ts#queueNewsStory']),
    modules: ['news', 'learn'],
    description:
      "Put a newsletter story on Learn's From News reading list, when they ask. The story is saved first and stays on Saved. A story already on the queue is refused. Name it by issue_ref and headline, or by saved_story_ref.",
    input_schema: { type: 'object', properties: { ...STORY_PROPERTIES }, additionalProperties: false },
    run: sendStoryToLearn,
  },
  {
    name: 'make_todo_from_story',
    runs: sameAs(['app/news/i/[id]/actions.ts#makeTodoFromStory', 'lib/todo/links/story.ts#makeStoryTask']),
    modules: ['news', 'todo'],
    description:
      'Make a todo titled with a newsletter story\'s headline that opens the story, when they ask. The story is saved first and stays on Saved. A story that has an open todo already is refused. Name it by issue_ref and headline, or by saved_story_ref.',
    input_schema: { type: 'object', properties: { ...STORY_PROPERTIES }, additionalProperties: false },
    run: makeTodoFromStory,
  },
  {
    name: 'stop_watch',
    runs: sameAs(['app/home/actions.ts#stopWatch', 'lib/core/watches.ts#stopRunningWatch']),
    modules: [],
    description:
      "Stop a price watch that is running, when they ask. Name it by the core.watches ref a lookup returned. A stopped watch does not start again; starting a new one is a proposal they confirm.",
    input_schema: {
      type: 'object',
      properties: { watch_ref: { type: 'string', description: 'The core.watches ref a lookup returned for the watch.' } },
      required: ['watch_ref'],
      additionalProperties: false,
    },
    run: stopWatch,
  },
];

/** Runs one News write. Never throws: a refusal or a failure is the sentence the model reads. */
export async function runNewsWrite(
  write: NewsWrite,
  env: NewsWriteEnv,
  input: unknown,
): Promise<NewsMade | { ok: false; error: string }> {
  const args = input && typeof input === 'object' ? (input as Args) : {};
  try {
    return await write.run(env, args);
  } catch (error) {
    if (error instanceof NewsRefused) return { ok: false, error: error.message };
    console.error(`news write ${write.name} failed`, error);
    return { ok: false, error: 'That change could not be made. Tell them nothing was changed.' };
  }
}

/** The first workspace the change needs that the person has switched off, or null. */
export function switchedOff(write: NewsWrite, enabled: readonly string[]): ModuleId | null {
  return write.modules.find((module) => !enabled.includes(module)) ?? null;
}

const ASK_NOTE =
  'It is done: it shows under your answer with an Undo. Say in your answer what you did, and cite the row this returned.';

/** The News writes as Ask's write tools, run on the person's own clients. */
export const NEWS_WRITE_TOOLS: readonly DashWriteTool<DashWriteResult>[] = NEWS_WRITES.map((write) => ({
  name: write.name,
  kind: 'write' as const,
  runs: write.runs,
  definition: { name: write.name, description: `${write.description} ${ASK_NOTE}`, input_schema: write.input_schema },
  apply: async (ctx: DashWriteContext, input: unknown): Promise<DashWriteResult> => {
    const off = switchedOff(write, ctx.enabledModules);
    if (off) return { ok: false, error: `The ${off} workspace is switched off, so nothing can be changed there.` };
    const env: NewsWriteEnv = {
      userId: ctx.userId,
      news: await ctx.db('news'),
      learn: await ctx.db('learn'),
      todo: await ctx.db('todo'),
      core: await ctx.db('core'),
    };
    const made = await runNewsWrite(write, env, input);
    if ('ok' in made) return made;
    return { ok: true, ...made, input: made.input as unknown as Record<string, unknown>, undo: null };
  },
}));

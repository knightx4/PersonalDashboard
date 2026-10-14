/**
 * Making what capture was given (plan #1581, plan #1950.1): each kind through
 * the writer its workspace already has, and each todo, job note or vault
 * note recorded in core.dash_actions with surface 'capture' so Undo, in the
 * box, in the toast and on Home, takes it back by the generic rule. A goal
 * update goes through Goals' own filing, which records each line it files
 * itself (plan #1569). A note for the vault is committed to the notes
 * repository and stored (plan #1582).
 *
 * Two callers reach the same makers. The one box files each part Dash's sort
 * found (fileCaptureParts, by Dash); an Add button aimed at a kind makes one
 * row from what the person typed (makeCapture, by the person). The record
 * says which, so Home's list of what Dash did leaves the person's own out.
 *
 * The writers are passed in, so this is tested without a session; the server
 * actions in app/capture-actions.ts bind them to the signed-in person.
 */

import type { DashActionEntry } from '@/lib/core/dash-actions';
import { refHref } from '@/lib/core/refs';
import { kindForPlace, type CaptureKindId } from '@/lib/capture/actions';
import { capturePartLabel, filedDestination, type FiledCapture } from '@/lib/capture/place';
import { roleName, type CapturePart, type CaptureSortRole } from '@/lib/capture/sort';
import type { CaptureDay } from '@/lib/capture/todo';
import type { FiledEntry } from '@/lib/goals/capture';
import { findLink } from '@/lib/learn/tracks/link-meta';
import { quizFromText, topicFromText, type QuizFromText, type TopicFromText } from '@/lib/capture/learn-text';
import { roleFromText, type RoleFromText } from '@/lib/capture/role';

/** What each writer reports: the row it wrote, or the sentence saying why not. */
export type CaptureWriters = {
  /** addTask: a todo, for today unless a day is given. */
  todo: (text: string, day?: CaptureDay) => Promise<{ id?: string; error?: string }>;
  /** fileGoalCapture: the sentence filed against their goals. */
  goals: (text: string) => Promise<{ captureId?: string; filed?: FiledEntry[]; error?: string }>;
  /** The add_role_note write, on a role of theirs. */
  jobs: (
    roleId: string,
    text: string,
  ) => Promise<{ ok: true; subjectRef: string } | { ok: false; error: string }>;
  /** createCapturedNote: a new note in the vault's Inbox, committed and stored. */
  vault: (
    text: string,
  ) => Promise<{ ok: true; noteId: string; title: string; blobSha: string } | { ok: false; error: string }>;
  /**
   * Shopping's order, item and saved thing (plan #1950.3.1). Absent where
   * only the sort files, such as the shortcuts' capture-token route, since
   * the sort never files these.
   */
  shopping?: ShoppingWriters;
  /** recordDashAction, bound to the person. */
  record: (entry: DashActionEntry) => Promise<string | null>;
  // Jobs and Learn (plan #1950.4), made only from an Add button. Optional, so
  // a caller that files only what the sort chose (the shortcuts' route) does
  // not bind them; a kind whose writer is absent says it cannot be added there.
  /** writeJobLead: the company, the role and an application as a lead. */
  role?: (input: RoleFromText) => Promise<{ ok: true; roleId: string; title: string } | { ok: false; error: string }>;
  /** saveLink: a link on Saved links, or the reading it is already. */
  reading?: (url: string) => Promise<LearnReadingWritten>;
  /** createTrack, with the readings pasted under the name. */
  topic?: (input: TopicFromText) => Promise<LearnTopicWritten>;
  /** createQuiz over pasted material and named notes. */
  quiz?: (input: QuizFromText) => Promise<LearnQuizWritten>;
  /**
   * Record the files sent with the capture against one row it filed (plan
   * #1714), and say how many there are. Absent when nothing was sent, as from
   * the shortcuts' capture-token route, which stays text-only.
   */
  attach?: (ref: string) => Promise<number>;
};

/** What a Shopping writer reports: the row it made and what to call it, or why not. */
export type ShoppingMade = { ok: true; id: string; title: string } | { ok: false; error: string };

export type ShoppingWriters = {
  /** An order from a sentence, read by the model when there is one. */
  order: (text: string, emailId?: string) => Promise<ShoppingMade>;
  /** Something owned: a book from an ISBN, anything else by its name. */
  item: (text: string) => Promise<ShoppingMade>;
  /** A saved thing from the link in what was typed. */
  saved: (text: string) => Promise<ShoppingMade>;
};
export type LearnReadingWritten =
  | { ok: true; readingId: string; title: string; created: boolean }
  | { ok: false; error: string };
export type LearnTopicWritten = { ok: true; trackId: string; readings: number } | { ok: false; error: string };
export type LearnQuizWritten = { ok: true; quizId: string; title: string } | { ok: false; error: string };

export type CaptureFiled = {
  filed: FiledCapture[];
  /** Why a part was not filed, one sentence each. */
  errors: string[];
};

/** The first words of what was filed, for the record's sentence. */
function quoted(text: string): string {
  const flat = text.replace(/\s+/g, ' ').trim();
  return flat.length <= 80 ? flat : `${flat.slice(0, 79).trimEnd()}…`;
}

/**
 * The rows of Goals a capture's lines touched, which its files go on: the
 * step a line closed, counted, added or logged progress on, and the goal for
 * a reading or an old note. Each row once.
 */
export function goalRefs(entries: readonly FiledEntry[]): string[] {
  const ids = entries.map((entry) => {
    switch (entry.kind) {
      case 'close':
      case 'count':
      case 'add':
        return entry.step_id;
      case 'progress':
        return entry.item_id;
      case 'reading':
      case 'note':
        return entry.goal_id;
      default:
        return null;
    }
  });
  return [...new Set(ids.filter((id): id is string => Boolean(id)))].map((id) => `goals.items:${id}`);
}

/**
 * Put the capture's files on each row one part filed. A row that cannot take
 * them leaves the row filed and says so; the count is of the files the first
 * row now holds, for the box's line.
 */
async function attachTo(
  writers: CaptureWriters,
  refs: readonly string[],
  errors: string[],
): Promise<number | undefined> {
  if (!writers.attach || refs.length === 0) return undefined;
  let count: number | undefined;
  for (const ref of refs) {
    try {
      const held = await writers.attach(ref);
      count ??= held;
    } catch (error) {
      console.error('capture: recording the files failed', ref, error);
      errors.push('It was filed, but the files could not be kept with it.');
      return count;
    }
  }
  return count || undefined;
}

/**
 * Who made it. `dash`: the one box, where Dash's sort chose the kind. `you`:
 * an Add button aimed at the kind, where the person chose it.
 */
export type MadeBy = 'dash' | 'you';

/** What a kind is made from: the title, and at most one more thing. */
export type MakeInput = {
  text: string;
  /** A todo's day. Today when absent. */
  day?: CaptureDay;
  /** The role a note on a job goes on. */
  role?: CaptureSortRole | null;
  /** The waiting email an order is made from, when it is (plan #1950.3.3). */
  emailId?: string;
};

export type MakeResult = { ok: true; filed: FiledCapture } | { ok: false; error: string };

type Maker = (input: MakeInput, writers: CaptureWriters, by: MadeBy, errors: string[]) => Promise<MakeResult>;

/**
 * The record's `undo` for a row the person aimed: marked, so Home's "What
 * Dash did today" leaves it out, and still undone by the generic rule.
 */
function aimedUndo(by: MadeBy, undo?: Record<string, unknown>): Record<string, unknown> | undefined {
  if (by === 'dash') return undo;
  return { ...(undo ?? {}), aimed: true };
}

/**
 * A Shopping kind's make: the writer, then the record, then where it went.
 * Each row opens on its own page, where its details are put right.
 */
function shoppingMaker(spec: {
  writer: keyof ShoppingWriters;
  table: 'orders' | 'inventory_items' | 'saved_items';
  kind: string;
  list: string;
  section: string;
  said: (title: string) => string;
}): Maker {
  return async ({ text, emailId }, writers, by, errors) => {
    if (!writers.shopping) return { ok: false, error: CANNOT_HERE };
    const write: (text: string, emailId?: string) => Promise<ShoppingMade> = writers.shopping[spec.writer];
    const result = await write(text, emailId);
    if (!result.ok) return { ok: false, error: result.error };
    const subjectRef = `public.${spec.table}:${result.id}`;
    const files = await attachTo(writers, [subjectRef], errors);
    const actionId = await writers.record({
      surface: 'capture',
      kind: spec.kind,
      subjectRef,
      op: 'insert',
      summary: `${by === 'dash' ? 'Dash' : 'You'} ${spec.said(quoted(result.title))}`,
      undo: aimedUndo(by),
    });
    return {
      ok: true,
      filed: {
        ...(files ? { files } : {}),
        place: null,
        text,
        where: `Shopping · ${spec.list}`,
        href: spec.section,
        actionId,
        goals: null,
        undoneAt: null,
        ref: subjectRef,
        page: `${spec.section}/${result.id}`,
      },
    };
  };
}

/**
 * Each kind's make: write the row, record it, and say where it went, the
 * row's ref and the page it opens on. A Record, so a kind added to
 * CAPTURE_KINDS does not compile until it says how it is made.
 */
export const CAPTURE_MAKERS: Readonly<Record<CaptureKindId, Maker>> = {
  todo: async ({ text, day }, writers, by, errors) => {
    // No day from the sort: each writer's own today, which the shortcuts'
    // route works out in the account's zone.
    const result = await (day === undefined ? writers.todo(text) : writers.todo(text, day));
    if (result.error || !result.id) return { ok: false, error: result.error ?? 'The todo could not be added.' };
    const where = filedDestination('todo', { day: day ?? 'today' });
    const subjectRef = `todo.tasks:${result.id}`;
    const files = await attachTo(writers, [subjectRef], errors);
    const actionId = await writers.record({
      surface: 'capture',
      kind: 'add_todo',
      subjectRef,
      op: 'insert',
      summary:
        by === 'dash'
          ? `Dash added the todo "${quoted(text)}" from capture.`
          : `You added the todo "${quoted(text)}".`,
      undo: aimedUndo(by),
    });
    return {
      ok: true,
      filed: {
        ...(files ? { files } : {}),
        place: 'todo',
        text,
        where: where?.name ?? 'Todo',
        href: where?.href ?? '/todo',
        actionId,
        goals: null,
        undoneAt: null,
        ref: subjectRef,
        page: refHref(subjectRef),
      },
    };
  },

  'goal-update': async ({ text }, writers, _by, errors) => {
    const result = await writers.goals(text);
    if (result.error || !result.captureId) {
      return { ok: false, error: result.error ?? 'Nothing was filed against your goals.' };
    }
    const entries = result.filed ?? [];
    const where = filedDestination('goals', { entries });
    const files = await attachTo(writers, goalRefs(entries), errors);
    return {
      ok: true,
      filed: {
        ...(files ? { files } : {}),
        place: 'goals',
        text,
        where: where?.name ?? 'Goals',
        href: where?.href ?? '/goals',
        actionId: null,
        goals: { captureId: result.captureId, entries },
        undoneAt: null,
        ref: `goals.captures:${result.captureId}`,
        page: null,
      },
    };
  },

  'job-note': async ({ text, role }, writers, by, errors) => {
    if (!role) {
      return { ok: false, error: 'Dash could not tell which job this is about. Name the company and try again.' };
    }
    const result = await writers.jobs(role.id, text);
    if (!result.ok) return { ok: false, error: result.error };
    const where = filedDestination('jobs', { role });
    const files = await attachTo(writers, [result.subjectRef], errors);
    const actionId = await writers.record({
      surface: 'capture',
      kind: 'add_role_note',
      subjectRef: result.subjectRef,
      op: 'insert',
      summary:
        by === 'dash'
          ? `Dash added a note to the role ${roleName(role)} from capture.`
          : `You added a note to the role ${roleName(role)}.`,
      undo: aimedUndo(by),
    });
    return {
      ok: true,
      filed: {
        ...(files ? { files } : {}),
        place: 'jobs',
        text,
        where: where?.name ?? 'Job search',
        href: where?.href ?? '/jobs',
        actionId,
        goals: null,
        undoneAt: null,
        ref: result.subjectRef,
        // The note lives in the role's thread, so the role is its page.
        page: `/jobs/roles/${role.id}`,
      },
    };
  },

  'vault-note': async ({ text }, writers, by, errors) => {
    const result = await writers.vault(text);
    if (!result.ok) return { ok: false, error: result.error };
    const where = filedDestination('vault', {});
    const subjectRef = `obsidian.notes:${result.noteId}`;
    const files = await attachTo(writers, [subjectRef], errors);
    // Undo removes the file from the repository as well as the row, so it
    // is capture's own (lib/capture/vault.ts), told apart by the blob SHA
    // the note was written at.
    const actionId = await writers.record({
      surface: 'capture',
      kind: 'add_vault_note',
      subjectRef,
      op: 'insert',
      summary:
        by === 'dash'
          ? `Dash added the note "${quoted(result.title)}" to your vault's Inbox from capture.`
          : `You added the note "${quoted(result.title)}" to your vault's Inbox.`,
      undo: aimedUndo(by, { vault_blob_sha: result.blobSha }),
    });
    return {
      ok: true,
      filed: {
        ...(files ? { files } : {}),
        place: 'vault',
        text,
        where: where?.name ?? 'Vault',
        href: where?.href ?? '/vault',
        actionId,
        goals: null,
        undoneAt: null,
        ref: subjectRef,
        page: refHref(subjectRef),
      },
    };
  },

  order: shoppingMaker({
    writer: 'order',
    table: 'orders',
    kind: 'add_order',
    list: 'Orders',
    section: '/shopping/orders',
    said: (title) => `added the order "${title}".`,
  }),

  'inventory-item': shoppingMaker({
    writer: 'item',
    table: 'inventory_items',
    kind: 'add_inventory_item',
    list: 'Inventory',
    section: '/shopping/inventory',
    said: (title) => `added "${title}" to your inventory.`,
  }),

  'saved-item': shoppingMaker({
    writer: 'saved',
    table: 'saved_items',
    kind: 'add_saved_item',
    list: 'Saved',
    section: '/shopping/saved',
    said: (title) => `saved "${title}".`,
  }),
  // Jobs and Learn (plan #1950.4): one row each, made only from an Add button.

  'job-role': async ({ text }, writers, by) => {
    if (!writers.role) return { ok: false, error: CANNOT_HERE };
    const named = roleFromText(text);
    if ('error' in named) return { ok: false, error: named.error };
    const result = await writers.role(named);
    if (!result.ok) return { ok: false, error: result.error };
    const subjectRef = `job_search.roles:${result.roleId}`;
    const actionId = await writers.record({
      surface: 'capture',
      kind: 'add_job_lead',
      subjectRef,
      op: 'insert',
      summary: by === 'dash' ? `Dash saved ${result.title} to your leads.` : `You saved ${result.title} to your leads.`,
      undo: aimedUndo(by),
    });
    return {
      ok: true,
      filed: made(text, 'jobs', 'Job search · Leads', '/jobs/pipeline', actionId, subjectRef, `/jobs/roles/${result.roleId}`),
    };
  },

  'learn-reading': async ({ text }, writers, by, errors) => {
    if (!writers.reading) return { ok: false, error: CANNOT_HERE };
    const url = findLink(text);
    if (!url) return { ok: false, error: 'Paste a link that starts with http:// or https://.' };
    const result = await writers.reading(url);
    if (!result.ok) return { ok: false, error: result.error };
    const subjectRef = `learn.readings:${result.readingId}`;
    // A link saved before is opened where it is, with nothing recorded: an
    // Undo on it would take away a reading this press did not make.
    const actionId = result.created
      ? await writers.record({
          surface: 'capture',
          kind: 'add_reading',
          subjectRef,
          op: 'insert',
          summary:
            by === 'dash'
              ? `Dash saved "${quoted(result.title)}" to Saved links.`
              : `You saved "${quoted(result.title)}" to Saved links.`,
          undo: aimedUndo(by),
        })
      : null;
    if (!result.created) errors.push(`"${quoted(result.title)}" was on your reading lists already.`);
    return {
      ok: true,
      filed: made(text, null, 'Learn · Saved links', '/learn/lists', actionId, subjectRef, `/learn/r/${result.readingId}`),
    };
  },

  'learn-topic': async ({ text }, writers, by) => {
    if (!writers.topic) return { ok: false, error: CANNOT_HERE };
    const topic = topicFromText(text);
    if ('error' in topic) return { ok: false, error: topic.error };
    const result = await writers.topic(topic);
    if (!result.ok) return { ok: false, error: result.error };
    const subjectRef = `learn.tracks:${result.trackId}`;
    const count = result.readings === 0 ? '' : ` with ${result.readings} ${result.readings === 1 ? 'reading' : 'readings'}`;
    const actionId = await writers.record({
      surface: 'capture',
      kind: 'add_learn_track',
      subjectRef,
      op: 'insert',
      summary:
        by === 'dash'
          ? `Dash started the topic "${quoted(topic.title)}"${count}.`
          : `You started the topic "${quoted(topic.title)}"${count}.`,
      undo: aimedUndo(by),
    });
    return {
      ok: true,
      filed: made(topic.title, null, 'Learn · Reading lists', '/learn/lists', actionId, subjectRef, `/learn/t/${result.trackId}`),
    };
  },

  'learn-quiz': async ({ text }, writers, by) => {
    if (!writers.quiz) return { ok: false, error: CANNOT_HERE };
    const quiz = quizFromText(text);
    if ('error' in quiz) return { ok: false, error: quiz.error };
    const result = await writers.quiz(quiz);
    if (!result.ok) return { ok: false, error: result.error };
    const subjectRef = `learn.quizzes:${result.quizId}`;
    const actionId = await writers.record({
      surface: 'capture',
      kind: 'add_quiz',
      subjectRef,
      op: 'insert',
      summary:
        by === 'dash' ? `Dash started the quiz "${quoted(result.title)}".` : `You started the quiz "${quoted(result.title)}".`,
      undo: aimedUndo(by),
    });
    return {
      ok: true,
      filed: made(text, null, 'Learn · Quizzes', '/learn/know', actionId, subjectRef, `/learn/quiz/${result.quizId}`),
    };
  },
};

/** What a kind says when its writer is not bound where it was asked for. */
const CANNOT_HERE = 'That cannot be added from here. Open its list and press Add there.';

/** A row an Add button made, as the panel and the toast read it. */
function made(
  text: string,
  place: FiledCapture['place'],
  where: string,
  href: string,
  actionId: string | null,
  ref: string,
  page: string,
): FiledCapture {
  return { place, text, where, href, actionId, goals: null, undoneAt: null, ref, page };
}

/**
 * Make one row of a kind the person aimed capture at. A failure is the
 * sentence saying why; a file that could not be kept with the row is said in
 * `errors` and the row stands.
 */
export async function makeCaptureKind(
  kind: CaptureKindId,
  input: MakeInput,
  writers: CaptureWriters,
): Promise<MakeResult & { errors: string[] }> {
  const text = input.text.trim();
  if (!text) return { ok: false, error: 'Type something first.', errors: [] };
  const errors: string[] = [];
  const made = await CAPTURE_MAKERS[kind]({ ...input, text }, writers, 'you', errors);
  return { ...made, errors };
}

/** File each part in turn. A part that fails is said in `errors` and the rest still go. */
export async function fileCaptureParts(
  parts: readonly CapturePart[],
  writers: CaptureWriters,
): Promise<CaptureFiled> {
  const filed: FiledCapture[] = [];
  const errors: string[] = [];

  for (const part of parts) {
    const text = part.text.trim();
    if (!text) continue;
    let make: Maker;
    try {
      make = CAPTURE_MAKERS[kindForPlace(part.place).id];
    } catch {
      errors.push(`${capturePartLabel(part)} is not something capture can do yet.`);
      continue;
    }
    const made = await make({ text, role: part.role }, writers, 'dash', errors);
    if (made.ok) filed.push(made.filed);
    else errors.push(made.error);
  }

  return { filed, errors };
}

import type { ModuleId } from '@/lib/modules';
import type { DashChange, DashChangeInput, MadeDashChange } from './changes';
import type { TalkTurn } from './talk';

/**
 * Saving one of Dash's answers somewhere else (plan #1899.7): as a todo, or
 * as a quick note in the vault's Inbox. The press under the answer is the
 * person's own, so nothing is proposed: the row is written at once and kept
 * in core.dash_actions under that answer, as Dash's own changes are, so it
 * shows as the same card with the same Undo (lib/ask/changes.ts).
 *
 * The writes and the record are handed in, so this is tested without a
 * database; lib/talk/ask-request.ts binds them to the signed-in person.
 */

export type SaveAnswerTo = 'todo' | 'vault';

/** Longest todo title made from an answer: a line on the list, not the answer. */
export const TODO_TITLE_MAX = 120;

/** Longest note saved from an answer, the quick note box's own limit. */
export const NOTE_MAX = 4000;

/** Longest note title made from the question. */
const NOTE_TITLE_MAX = 80;

/** One line of markdown as plain words: no heading marks, bullets, emphasis or link targets. */
export function plainLine(line: string): string {
  return line
    .replace(/^\s{0,3}(#{1,6}\s+|>\s?|[-*+]\s+|\d+[.)]\s+)/, '')
    .replace(/!?\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/(\*\*|__|\*|_|`)/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

/** Cut to `max` characters at a word, with an ellipsis when anything was cut. */
function cut(text: string, max: number): string {
  if (text.length <= max) return text;
  const head = text.slice(0, max - 1);
  const space = head.lastIndexOf(' ');
  return `${(space > max / 2 ? head.slice(0, space) : head).replace(/[\s,;:.]+$/, '')}…`;
}

/**
 * The todo an answer makes: its first sentence, as plain words, short enough
 * to read as a line on the list. The whole answer stays in the chat, which
 * the card links back from.
 */
export function answerTodoTitle(body: string): string {
  const line = body
    .split('\n')
    .map(plainLine)
    .find((l) => l.length > 0);
  if (!line) return '';
  const sentence = line.match(/^.+?[.!?](?=\s|$)/)?.[0] ?? line;
  return cut(sentence, TODO_TITLE_MAX);
}

/** The note's title: the question it answered, as plain words; none when there is no question. */
export function answerNoteTitle(question: string | null): string | undefined {
  const line = question
    ?.split('\n')
    .map(plainLine)
    .find((l) => l.length > 0);
  return line ? cut(line.replace(/[\\/:*?"<>|#^[\]]/g, ''), NOTE_TITLE_MAX) || undefined : undefined;
}

/** The answer a turn id names in a conversation, and the question asked before it. */
export function findAnswer(
  turns: readonly TalkTurn[],
  turnId: string,
): { answer: TalkTurn; question: string | null } | null {
  const index = turns.findIndex((turn) => turn.id === turnId);
  if (index < 0 || turns[index].role !== 'assistant') return null;
  const asked = turns
    .slice(0, index)
    .reverse()
    .find((turn) => turn.role === 'user');
  return { answer: turns[index], question: asked?.body ?? null };
}

/** What writing a todo hands back: writeChange in lib/ask/changes.ts. */
export type TodoWritten =
  | {
      ok: true;
      subjectRef: string;
      op: 'insert' | 'update';
      before: Record<string, unknown> | null;
      after: Record<string, unknown> | null;
      undo: Record<string, unknown> | null;
    }
  | { ok: false; error: string };

/** What filing a note hands back: fileVaultNote in lib/capture/vault.ts. */
export type NoteFiled =
  | { ok: true; noteId: string; path: string; title: string; blobSha: string }
  | { ok: false; error: string };

export type SaveAnswerDeps = {
  enabledModules: readonly ModuleId[];
  /** The conversation's turns, read as the person: empty when it is not theirs. */
  turns: (conversationId: string) => Promise<TalkTurn[]>;
  writeTodo: (input: DashChangeInput['add_todo']) => Promise<TodoWritten>;
  fileNote: (text: string, title?: string) => Promise<NoteFiled>;
  /** The written row's values, for the record; null when it could not be read. */
  readRow: (ref: string) => Promise<Record<string, unknown> | null>;
  /** Keeps the change as done in the conversation (insertMadeChange). */
  keep: (conversationId: string, made: MadeDashChange) => Promise<DashChange>;
  /** Ties it to the answer, so it draws under that answer (attachProposals). */
  attach: (changeId: string, turnId: string) => Promise<void>;
};

export type SaveAnswerOutcome = { ok: true; change: DashChange } | { ok: false; error: string };

const GONE = 'That answer is not there any more.';

/**
 * Write the answer `turnId` in conversation `conversationId` as a todo or a
 * vault note, and keep it as a change under that answer. Never throws for a
 * refusal; a failed read or write of the record throws.
 */
export async function saveAnswer(
  deps: SaveAnswerDeps,
  conversationId: string,
  turnId: string,
  to: SaveAnswerTo,
): Promise<SaveAnswerOutcome> {
  const found = findAnswer(await deps.turns(conversationId), turnId);
  if (!found) return { ok: false, error: GONE };
  const { answer, question } = found;

  let made: MadeDashChange;
  if (to === 'todo') {
    if (!deps.enabledModules.includes('todo')) {
      return { ok: false, error: 'The Todo workspace is switched off, so there is nowhere to put it.' };
    }
    const title = answerTodoTitle(answer.body);
    if (!title) return { ok: false, error: 'That answer has no words to make a todo from.' };
    const input: DashChangeInput['add_todo'] = { title, body: null, dueOn: null, dueTime: null, pinned: false };
    const written = await deps.writeTodo(input);
    if (!written.ok) return written;
    made = {
      kind: 'add_todo',
      input,
      subjectRef: written.subjectRef,
      op: 'insert',
      before: null,
      after: written.after,
      summary: `You made the todo "${title}" from an answer of Dash's.`,
      undo: written.undo,
    };
  } else {
    if (!deps.enabledModules.includes('vault')) {
      return { ok: false, error: 'The Vault workspace is switched off, so there is nowhere to put it.' };
    }
    const body = answer.body.trim();
    if (body.length > NOTE_MAX) {
      return { ok: false, error: `That answer is longer than a quick note can hold (${NOTE_MAX} characters). Copy it instead.` };
    }
    const filed = await deps.fileNote(body, answerNoteTitle(question));
    if (!filed.ok) return filed;
    const subjectRef = `obsidian.notes:${filed.noteId}`;
    made = {
      kind: 'add_quick_note',
      input: { noteId: filed.noteId, title: filed.title, path: filed.path, body },
      subjectRef,
      op: 'insert',
      before: null,
      after: await deps.readRow(subjectRef),
      summary: `You saved an answer of Dash's as the note "${filed.title}" in your vault's Inbox.`,
      undo: { vault_blob_sha: filed.blobSha },
    };
  }

  const kept = await deps.keep(conversationId, made);
  await deps.attach(kept.id, answer.id);
  return { ok: true, change: { ...kept, turnId: answer.id } };
}

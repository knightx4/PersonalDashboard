import { describe, expect, it, vi } from 'vitest';
import type { DashChange, MadeDashChange } from './changes';
import type { TalkTurn } from './talk';
import {
  answerNoteTitle,
  answerTodoTitle,
  findAnswer,
  NOTE_MAX,
  saveAnswer,
  TODO_TITLE_MAX,
  type SaveAnswerDeps,
} from './save-answer';

/** Saving one of Dash's answers as a todo or a vault note (plan #1899.7). */

const turns: TalkTurn[] = [
  { id: 'q1', role: 'user', body: 'What did I spend on **eBay** flips?', createdAt: '2026-10-14T09:00:00Z' },
  {
    id: 'a1',
    role: 'assistant',
    body: '## Spend\n\nYou spent **$412.60** on [eBay](/shopping) flips. Two are unsold.',
    createdAt: '2026-10-14T09:00:01Z',
  },
];

function deps(over: Partial<SaveAnswerDeps> = {}) {
  const kept: MadeDashChange[] = [];
  const attached: [string, string][] = [];
  const base: SaveAnswerDeps = {
    enabledModules: ['todo', 'vault'],
    turns: async () => turns,
    writeTodo: vi.fn(async () => ({
      ok: true as const,
      subjectRef: 'todo.tasks:t1',
      op: 'insert' as const,
      before: null,
      after: { id: 't1' },
      undo: null,
    })),
    fileNote: vi.fn(async (_text: string, title?: string) => ({
      ok: true as const,
      noteId: 'n1',
      path: `Inbox/${title}.md`,
      title: title ?? 'Note',
      blobSha: 'b1',
    })),
    readRow: async () => ({ id: 'n1' }),
    keep: async (conversationId, made) => {
      kept.push(made);
      return { ...made, id: 'c1', conversationId, turnId: null, status: 'done' } as unknown as DashChange;
    },
    attach: async (id, turnId) => {
      attached.push([id, turnId]);
    },
    ...over,
  };
  return { deps: base, kept, attached };
}

describe('answerTodoTitle', () => {
  it('takes the first sentence as plain words', () => {
    expect(answerTodoTitle(turns[1].body)).toBe('Spend');
    expect(answerTodoTitle('You spent **$412.60** on [eBay](/x) flips. Two are unsold.')).toBe(
      'You spent $412.60 on eBay flips.',
    );
  });

  it('cuts a long line at a word', () => {
    const title = answerTodoTitle('word '.repeat(60));
    expect(title.length).toBeLessThanOrEqual(TODO_TITLE_MAX);
    expect(title.endsWith('…')).toBe(true);
  });

  it('is empty for an answer with no words', () => {
    expect(answerTodoTitle('\n\n  ')).toBe('');
  });
});

describe('answerNoteTitle', () => {
  it('is the question as plain words, without characters a file name cannot hold', () => {
    expect(answerNoteTitle('What is **x/y**?')).toBe('What is xy');
    expect(answerNoteTitle(null)).toBeUndefined();
  });
});

describe('findAnswer', () => {
  it('finds an answer and the question before it', () => {
    expect(findAnswer(turns, 'a1')?.question).toBe(turns[0].body);
  });

  it('finds nothing for a question or an unknown id', () => {
    expect(findAnswer(turns, 'q1')).toBeNull();
    expect(findAnswer(turns, 'nope')).toBeNull();
  });
});

describe('saveAnswer', () => {
  it('writes a todo and keeps it as a done change tied to the answer', async () => {
    const { deps: d, kept, attached } = deps();
    const outcome = await saveAnswer(d, 'conv', 'a1', 'todo');
    expect(outcome.ok).toBe(true);
    expect(d.writeTodo).toHaveBeenCalledWith({ title: 'Spend', body: null, dueOn: null, dueTime: null, pinned: false });
    expect(kept[0]).toMatchObject({ kind: 'add_todo', subjectRef: 'todo.tasks:t1', op: 'insert' });
    expect(attached).toEqual([['c1', 'a1']]);
    if (outcome.ok) expect(outcome.change.turnId).toBe('a1');
  });

  it('files a note titled by the question, keeping the blob for Undo', async () => {
    const { deps: d, kept } = deps();
    const outcome = await saveAnswer(d, 'conv', 'a1', 'vault');
    expect(outcome.ok).toBe(true);
    expect(d.fileNote).toHaveBeenCalledWith(turns[1].body, 'What did I spend on eBay flips');
    expect(kept[0]).toMatchObject({
      kind: 'add_quick_note',
      subjectRef: 'obsidian.notes:n1',
      undo: { vault_blob_sha: 'b1' },
    });
  });

  it('refuses an answer that is not in the conversation', async () => {
    const { deps: d, kept } = deps({ turns: async () => [] });
    expect(await saveAnswer(d, 'conv', 'a1', 'todo')).toEqual({ ok: false, error: 'That answer is not there any more.' });
    expect(kept).toHaveLength(0);
  });

  it('refuses when the workspace is off, writing nothing', async () => {
    const { deps: d } = deps({ enabledModules: ['todo'] });
    const outcome = await saveAnswer(d, 'conv', 'a1', 'vault');
    expect(outcome.ok).toBe(false);
    expect(d.fileNote).not.toHaveBeenCalled();
  });

  it('refuses an answer too long for a note', async () => {
    const long = [turns[0], { ...turns[1], body: 'x'.repeat(NOTE_MAX + 1) }];
    const { deps: d } = deps({ turns: async () => long });
    expect((await saveAnswer(d, 'conv', 'a1', 'vault')).ok).toBe(false);
  });

  it('passes on why the vault would not take it', async () => {
    const { deps: d, kept } = deps({ fileNote: async () => ({ ok: false, error: 'Connect your vault first.' }) });
    expect(await saveAnswer(d, 'conv', 'a1', 'vault')).toEqual({ ok: false, error: 'Connect your vault first.' });
    expect(kept).toHaveLength(0);
  });
});

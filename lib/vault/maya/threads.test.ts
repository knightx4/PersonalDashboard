import { describe, expect, it } from 'vitest';
import { storeThought, type MayaThreadStore, type ThoughtToStore, type ThreadRow } from './threads';

/** An in-memory store with the table's one-thread-per-note rule. */
function memoryStore(options: { raceOnInsert?: boolean } = {}) {
  const threads = new Map<string, ThreadRow>();
  const messages: { threadId: string; thought: ThoughtToStore }[] = [];
  let touched = 0;
  let next = 1;
  const store: MayaThreadStore = {
    async findThread(noteId) {
      return threads.get(noteId) ?? null;
    },
    async insertThread({ noteId, question }) {
      if (options.raceOnInsert) {
        // Another request opened it between the look and this insert.
        threads.set(noteId, { id: 'theirs', question: 'Opened elsewhere' });
        return null;
      }
      if (threads.has(noteId)) return null;
      const row = { id: `t${next++}`, question };
      threads.set(noteId, row);
      return row;
    },
    async touchThread() {
      touched += 1;
    },
    async insertThought(threadId, thought) {
      messages.push({ threadId, thought });
    },
  };
  return { store, threads, messages, touched: () => touched };
}

function thought(
  question: string,
  points: unknown[] = [{ kind: 'point', rank: 1 }],
): ThoughtToStore {
  return {
    question,
    body: points.length ? '1. A claim' : '',
    points,
    noteBlobSha: 'sha1',
    model: 'claude-opus-5',
  };
}

describe('storeThought', () => {
  it('opens a thread with the thought question on the first ask', async () => {
    const memory = memoryStore();
    const stored = await storeThought(memory.store, {
      noteId: 'n1',
      origin: 'asked',
      thought: thought('Is remote work worth the isolation?'),
    });
    expect(stored).toEqual({
      threadId: 't1',
      question: 'Is remote work worth the isolation?',
      opened: true,
    });
    expect(memory.messages).toHaveLength(1);
    expect(memory.messages[0].threadId).toBe('t1');
  });

  it('adds a later thought to the same thread and keeps the question', async () => {
    const memory = memoryStore();
    await storeThought(memory.store, {
      noteId: 'n1',
      origin: 'asked',
      thought: thought('First question'),
    });
    memory.threads.get('n1')!.question = 'The question as the person rewrote it';

    const stored = await storeThought(memory.store, {
      noteId: 'n1',
      origin: 'asked',
      thought: thought('A different question'),
    });
    expect(stored).toEqual({
      threadId: 't1',
      question: 'The question as the person rewrote it',
      opened: false,
    });
    expect(memory.threads.size).toBe(1);
    expect(memory.messages.map((m) => m.threadId)).toEqual(['t1', 't1']);
    expect(memory.touched()).toBe(1);
  });

  it('stores an empty thought as it is', async () => {
    const memory = memoryStore();
    await storeThought(memory.store, { noteId: 'n1', origin: 'asked', thought: thought('Q', []) });
    expect(memory.messages[0].thought.points).toEqual([]);
    expect(memory.messages[0].thought.body).toBe('');
  });

  it('uses the thread another request opened first', async () => {
    const memory = memoryStore({ raceOnInsert: true });
    const stored = await storeThought(memory.store, {
      noteId: 'n1',
      origin: 'asked',
      thought: thought('Mine'),
    });
    expect(stored).toEqual({ threadId: 'theirs', question: 'Opened elsewhere', opened: false });
    expect(memory.messages[0].threadId).toBe('theirs');
  });
});

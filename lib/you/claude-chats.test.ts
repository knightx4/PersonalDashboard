import { describe, expect, it } from 'vitest';
import { strToU8, zipSync } from 'fflate';
import { BATCH_ROWS, chatBatches, linesFromConversations, readClaudeExport, type ChatLine } from './claude-chats';

const conversations = [
  {
    uuid: 'c1',
    name: 'Thinking about contract work',
    created_at: '2026-10-01T09:00:00Z',
    chat_messages: [
      { uuid: 'm1', sender: 'human', text: 'I think I only finish things when someone is waiting.', created_at: '2026-10-01T09:00:00Z' },
      { uuid: 'm2', sender: 'assistant', text: 'That is a common pattern.', created_at: '2026-10-01T09:00:05Z' },
      { uuid: 'm3', sender: 'human', text: '', content: [{ type: 'text', text: 'From the parts.' }], created_at: '2026-10-01T09:01:00Z' },
      { uuid: 'm4', sender: 'human', text: '   ', created_at: '2026-10-01T09:02:00Z' },
    ],
  },
  { uuid: 'c2', name: '', chat_messages: 'not a list' },
];

describe('linesFromConversations', () => {
  it('keeps only their own messages with text, never the replies', () => {
    expect(linesFromConversations(conversations)).toEqual([
      {
        messageId: 'm1',
        conversationId: 'c1',
        conversationTitle: 'Thinking about contract work',
        saidAt: '2026-10-01T09:00:00Z',
        body: 'I think I only finish things when someone is waiting.',
      },
      {
        messageId: 'm3',
        conversationId: 'c1',
        conversationTitle: 'Thinking about contract work',
        saidAt: '2026-10-01T09:01:00Z',
        body: 'From the parts.',
      },
    ]);
  });

  it('refuses a file that is not a list of conversations', () => {
    expect(() => linesFromConversations({ conversations: [] })).toThrow(/not a Claude export/);
  });
});

describe('readClaudeExport', () => {
  it('reads conversations.json from inside the zip, wherever it sits', () => {
    const zip = zipSync({
      'data/users.json': strToU8('[]'),
      'data/conversations.json': strToU8(JSON.stringify(conversations)),
    });
    expect(readClaudeExport(zip).map((line) => line.messageId)).toEqual(['m1', 'm3']);
  });

  it('reads conversations.json given on its own', () => {
    expect(readClaudeExport(strToU8(JSON.stringify(conversations)))).toHaveLength(2);
  });

  it('says so when the zip has no conversations', () => {
    expect(() => readClaudeExport(zipSync({ 'users.json': strToU8('[]') }))).toThrow(/no conversations.json/);
  });
});

describe('chatBatches', () => {
  const line = (i: number, body = 'x'): ChatLine => ({
    messageId: `m${i}`,
    conversationId: null,
    conversationTitle: null,
    saidAt: '2026-10-01T09:00:00Z',
    body,
  });

  it('splits by count', () => {
    const batches = chatBatches(Array.from({ length: BATCH_ROWS + 1 }, (_, i) => line(i)));
    expect(batches.map((b) => b.length)).toEqual([BATCH_ROWS, 1]);
  });

  it('splits long messages so a batch stays small', () => {
    const batches = chatBatches(Array.from({ length: 30 }, (_, i) => line(i, 'y'.repeat(20_000))));
    expect(batches.length).toBeGreaterThan(1);
    expect(batches.flat()).toHaveLength(30);
  });
});

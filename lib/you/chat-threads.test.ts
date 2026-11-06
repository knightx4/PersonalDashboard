import { describe, expect, it } from 'vitest';
import type { YouSupabaseClient } from '@/lib/you/db/schema-name';
import { countUnreadChats } from '@/lib/you/chat-threads';

/** A client answering each table with fixed rows, whatever the filters. */
function fakeClient(tables: Record<string, unknown[]>): YouSupabaseClient {
  return {
    from(table: string) {
      const chain: Record<string, unknown> = {};
      for (const name of ['select', 'eq', 'is', 'order', 'limit']) chain[name] = () => chain;
      chain.then = (resolve: (v: unknown) => void) => resolve({ data: tables[table] ?? [], error: null });
      return chain;
    },
  } as unknown as YouSupabaseClient;
}

describe('countUnreadChats (note b31eae56)', () => {
  const chats = [
    { id: 'c-ada', kind: 'person', advisor_id: 'ada', last_read_at: '2026-11-05T10:00:00Z', last_message_at: '2026-11-05T12:00:00Z' },
    { id: 'g-1', kind: 'group', advisor_id: null, last_read_at: null, last_message_at: '2026-11-05T11:00:00Z' },
    { id: 'c-ben', kind: 'person', advisor_id: 'ben', last_read_at: '2026-11-05T09:00:00Z', last_message_at: '2026-11-05T08:00:00Z' },
    { id: 'c-ada-old', kind: 'person', advisor_id: 'ada', last_read_at: null, last_message_at: '2026-10-01T08:00:00Z' },
  ];

  it('counts each listed chat with a bot message newer than it was opened, once', async () => {
    const messages = [
      { chat_id: 'c-ada', created_at: '2026-11-05T12:00:00Z' },
      { chat_id: 'c-ada', created_at: '2026-11-05T11:00:00Z' },
      { chat_id: 'g-1', created_at: '2026-11-05T11:00:00Z' },
      // Older than the chat was last opened: read.
      { chat_id: 'c-ben', created_at: '2026-11-05T08:00:00Z' },
      // A bot's older chat, which the list does not show.
      { chat_id: 'c-ada-old', created_at: '2026-10-01T08:00:00Z' },
    ];
    expect(await countUnreadChats(fakeClient({ advisor_chats: chats, advisor_messages: messages }), 'u1')).toBe(2);
  });

  it('is zero when every message has been read', async () => {
    expect(await countUnreadChats(fakeClient({ advisor_chats: chats, advisor_messages: [] }), 'u1')).toBe(0);
  });
});

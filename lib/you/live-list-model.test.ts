import { describe, expect, it } from 'vitest';
import type { PersonRow } from '@/lib/you/chat-threads-model';
import type { GroupRow } from '@/lib/you/group-chats-model';
import { NO_PATCHES, outcomeOf, patchGroups, patchRows } from '@/lib/you/live-list-model';

const person: PersonRow = {
  id: 'a1',
  key: 'builder',
  name: 'Builder',
  about: '',
  colour: 'blue',
  canTalk: true,
  chatId: 'c1',
  last: { text: 'Done', role: 'advisor', at: '2026-11-06T00:45:15.230Z' },
  unread: true,
  typingUntil: null,
  lastReadAt: '2026-11-06T00:40:00.000Z',
  replyFailed: null,
};

const group: GroupRow = {
  kind: 'group',
  id: 'g1',
  title: 'Ada, Bo',
  name: null,
  members: [{ id: 'a2', key: 'ada', name: 'Ada', colour: 'red', typingUntil: null }],
  last: { text: 'Hi', role: 'advisor', speaker: 'a2', at: '2026-11-06T00:45:00.000Z' },
  unread: true,
};

const drawn = { rows: [person], groups: [group] };

describe('outcomeOf', () => {
  it('patches a typing lease renewal in place instead of redrawing the page', () => {
    const out = outcomeOf(
      { table: 'advisor_chats', eventType: 'UPDATE', new: { id: 'c1', typing_until: '2026-11-06T00:46:00.000Z', reply_status: 'waiting' } },
      drawn,
      NO_PATCHES,
    );
    expect(out.kind).toBe('patch');
    if (out.kind !== 'patch') return;
    expect(patchRows([person], out.patches)[0].typingUntil).toBe('2026-11-06T00:46:00.000Z');
  });

  it('patches a thread being read, and clears its unread dot', () => {
    const out = outcomeOf(
      { table: 'advisor_chats', eventType: 'UPDATE', new: { id: 'c1', last_read_at: '2026-11-06T00:50:00+00:00' } },
      drawn,
      NO_PATCHES,
    );
    if (out.kind !== 'patch') throw new Error('expected a patch');
    expect(patchRows([person], out.patches)[0].unread).toBe(false);
  });

  it('keeps the dot when the read is older than the last message', () => {
    const out = outcomeOf(
      { table: 'advisor_chats', eventType: 'UPDATE', new: { id: 'c1', last_read_at: '2026-11-06T00:41:00Z' } },
      drawn,
      NO_PATCHES,
    );
    if (out.kind !== 'patch') throw new Error('expected a patch');
    expect(patchRows([person], out.patches)[0].unread).toBe(true);
  });

  it('carries a failed reply into the row', () => {
    const out = outcomeOf(
      { table: 'advisor_chats', eventType: 'UPDATE', new: { id: 'c1', reply_status: 'failed', reply_error: 'No.' } },
      drawn,
      NO_PATCHES,
    );
    if (out.kind !== 'patch') throw new Error('expected a patch');
    expect(patchRows([person], out.patches)[0].replyFailed).toBe('No.');
  });

  it('ignores typing renewals on a chat the list does not draw', () => {
    expect(
      outcomeOf({ table: 'advisor_chats', eventType: 'UPDATE', new: { id: 'c9', typing_until: '2026-11-06T00:46:00Z' } }, drawn, NO_PATCHES).kind,
    ).toBe('ignore');
  });

  it('redraws for a new message, a new chat and a renamed group', () => {
    expect(outcomeOf({ table: 'advisor_messages', eventType: 'INSERT', new: { chat_id: 'c1' } }, drawn, NO_PATCHES).kind).toBe('refresh');
    expect(outcomeOf({ table: 'advisor_chats', eventType: 'INSERT', new: { id: 'c9' } }, drawn, NO_PATCHES).kind).toBe('refresh');
    expect(outcomeOf({ table: 'advisor_chats', eventType: 'UPDATE', new: { id: 'g1', title: 'Team' } }, drawn, NO_PATCHES).kind).toBe('refresh');
  });

  it('ignores a message being marked read or delivered', () => {
    expect(outcomeOf({ table: 'advisor_messages', eventType: 'UPDATE', new: { chat_id: 'c1' } }, drawn, NO_PATCHES).kind).toBe('ignore');
  });

  it('patches a group bot typing, and redraws when a bot joins or leaves', () => {
    const typing = outcomeOf(
      { table: 'advisor_chat_members', eventType: 'UPDATE', new: { chat_id: 'g1', advisor_id: 'a2', typing_until: '2026-11-06T00:46:00Z', left_at: null } },
      drawn,
      NO_PATCHES,
    );
    if (typing.kind !== 'patch') throw new Error('expected a patch');
    expect(patchGroups([group], typing.patches)[0].members[0].typingUntil).toBe('2026-11-06T00:46:00Z');

    const left = outcomeOf(
      { table: 'advisor_chat_members', eventType: 'UPDATE', new: { chat_id: 'g1', advisor_id: 'a2', left_at: '2026-11-06T00:46:00Z' } },
      drawn,
      NO_PATCHES,
    );
    expect(left.kind).toBe('refresh');
    const joined = outcomeOf(
      { table: 'advisor_chat_members', eventType: 'UPDATE', new: { chat_id: 'g1', advisor_id: 'a3', left_at: null } },
      drawn,
      NO_PATCHES,
    );
    expect(joined.kind).toBe('refresh');
  });
});

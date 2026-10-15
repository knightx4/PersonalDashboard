/**
 * A thread waiting on a hand-off checks back every twenty seconds. A check
 * that lands while a question is being answered must not draw that question
 * a second time (note f94be0c9).
 */
import { describe, expect, it } from 'vitest';
import { withIncoming } from '@/components/thread/thread';
import type { TalkTurn } from '@/lib/talk/talk';

function turn(id: string, role: TalkTurn['role'], body: string, at: string): TalkTurn {
  return { id, role, body, createdAt: `2026-10-14T16:${at}.000Z` } as TalkTurn;
}

const q1 = turn('q1', 'user', 'i want a post for any module', '23:00');
const a1 = turn('a1', 'assistant', 'Only one module has no post.', '23:14');

describe('turns read back while a hand-off is open', () => {
  it('leaves out the pending question as kept, and its answer', () => {
    const own = [q1, a1, turn('pending', 'user', 'thats not true', '23:41')];
    const incoming = [q1, a1, turn('q2', 'user', 'thats not true', '23:40'), turn('a2', 'assistant', 'You were right.', '23:57')];
    expect(withIncoming(own, incoming).map((t) => t.id)).toEqual(['q1', 'a1', 'pending']);
  });

  it('still slots in a hand-off reply written before the question', () => {
    const own = [q1, a1, turn('pending', 'user', 'make one', '24:30')];
    const incoming = [q1, a1, turn('h', 'assistant', 'Done: I drafted one post.', '24:10'), turn('q3', 'user', 'make one', '24:28')];
    expect(withIncoming(own, incoming).map((t) => t.id)).toEqual(['q1', 'a1', 'h', 'pending']);
  });

  it('adds what is new once nothing is pending', () => {
    const incoming = [q1, a1, turn('h', 'assistant', 'Done.', '24:52')];
    expect(withIncoming([q1, a1], incoming).map((t) => t.id)).toEqual(['q1', 'a1', 'h']);
  });
});

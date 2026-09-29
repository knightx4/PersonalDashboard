import { describe, expect, it } from 'vitest';
import { fileReplyTasks } from './linker';
import { replyTaskBody, replyTaskTitle, skipReason, type ReplyCandidate } from './task';

function candidate(overrides: Partial<ReplyCandidate> = {}): ReplyCandidate {
  return {
    message_id: 'm1',
    account_email: 'me@example.com',
    thread_id: '19ed6ac2eb7106f4',
    received_at: '2026-09-28T10:00:00Z',
    from_address: 'Jane Doe <jane@example.com>',
    reply_to_address: null,
    subject: 'Re: Lunch next week?',
    ...overrides,
  };
}

describe('the reply task', () => {
  it('names who wrote and what about, and links the thread', () => {
    expect(replyTaskTitle(candidate())).toBe('Reply to Jane Doe: Lunch next week?');
    expect(replyTaskTitle(candidate({ from_address: 'jane@example.com', subject: null }))).toBe(
      'Reply to jane@example.com',
    );
    const body = replyTaskBody(candidate());
    expect(body).toContain('Dash sorted this email');
    expect(body).toContain('https://mail.google.com/mail/?authuser=me%40example.com#all/19ed6ac2eb7106f4');
  });

  it('skips automated senders and the person\'s own mail', () => {
    expect(skipReason(candidate())).toBeNull();
    expect(skipReason(candidate({ from_address: 'Acme <no-reply@acme.com>' }))).toBe('automated');
    expect(skipReason(candidate({ from_address: 'notifications@github.com' }))).toBe('automated');
    expect(skipReason(candidate({ from_address: 'Me <ME@example.com>' }))).toBe('own');
  });
});

describe('filing reply tasks', () => {
  /** The two functions, with the thread key the migration enforces. */
  function fakeTodo(candidates: ReplyCandidate[]) {
    const judged = new Set<string>();
    const tasks: { title: string | null }[] = [];
    const todo = {
      async rpc(name: string, args: Record<string, unknown>) {
        if (name === 'reply_candidates') {
          return { data: candidates.filter((c) => !judged.has(c.thread_id)), error: null };
        }
        const c = candidates.find((x) => x.message_id === args.p_message_id)!;
        if (judged.has(c.thread_id)) return { data: null, error: null };
        judged.add(c.thread_id);
        if (args.p_title === null) return { data: null, error: null };
        tasks.push({ title: args.p_title as string });
        return { data: `task-${tasks.length}`, error: null };
      },
    };
    return { todo: todo as never, tasks };
  }

  it('files a needs-reply email once, however often the sync runs', async () => {
    const { todo, tasks } = fakeTodo([
      candidate(),
      candidate({ message_id: 'm2', thread_id: 't2', from_address: 'noreply@shop.com' }),
    ]);
    expect(await fileReplyTasks(todo, { userId: 'u' })).toEqual({ filed: 1, skipped: 1 });
    expect(await fileReplyTasks(todo, { userId: 'u' })).toEqual({ filed: 0, skipped: 0 });
    expect(tasks).toEqual([{ title: 'Reply to Jane Doe: Lunch next week?' }]);
  });
});

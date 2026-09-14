import { describe, expect, it } from 'vitest';
import { conversationsFrom } from '@/lib/comments/recent';

function comment(fields: Record<string, unknown>): Record<string, unknown> {
  return { id: 'c1', author: 'me', body: 'Something', created_at: '2026-09-13T09:00:00Z', ...fields };
}

describe('conversationsFrom', () => {
  it('gathers the comments on one row into a single conversation', () => {
    const [conversation] = conversationsFrom([
      comment({
        id: 'c2',
        author: 'claude',
        body: 'Because of the cascade.',
        created_at: '2026-09-13T10:00:00Z',
        plan_item_id: 'p1',
        step: { number: 412, title: 'Say who a comment reached' },
      }),
      comment({
        id: 'c1',
        body: 'Why two columns here?',
        plan_item_id: 'p1',
        step: { number: 412, title: 'Say who a comment reached' },
      }),
    ]);

    expect(conversation).toMatchObject({
      target: 'step',
      rowId: 'p1',
      about: '#412 Say who a comment reached',
      href: '/dev/plan',
      lastAt: '2026-09-13T10:00:00Z',
      lastAuthor: 'claude',
    });
    expect(conversation.thread.map((message) => message.id)).toEqual(['c1', 'c2']);
  });

  it('puts the most recently active conversation first', () => {
    const conversations = conversationsFrom([
      comment({ id: 'a', idea_id: 'i1', idea: { body: 'Older' }, created_at: '2026-09-11T09:00:00Z' }),
      comment({ id: 'b', raised_item_id: 'r1', raise: { title: 'Newer' }, created_at: '2026-09-13T09:00:00Z' }),
      comment({
        id: 'c',
        feedback_item_id: 'f1',
        note: { kind: 'bug', body: 'Middle' },
        created_at: '2026-09-12T09:00:00Z',
      }),
    ]);

    expect(conversations.map((conversation) => conversation.about)).toEqual(['Newer', 'Middle', 'Older']);
    expect(conversations.map((conversation) => conversation.href)).toEqual([
      '/dev/raised',
      '/dev/bugs',
      '/dev/ideas',
    ]);
  });

  it('says when Dash wrote the last message', () => {
    const [conversation] = conversationsFrom([
      comment({ id: 'c1', idea_id: 'i1', idea: { body: 'Ask Dash' }, created_at: '2026-09-13T09:00:00Z' }),
      comment({
        id: 'c2',
        author: 'claude',
        idea_id: 'i1',
        idea: { body: 'Ask Dash' },
        created_at: '2026-09-13T09:05:00Z',
      }),
    ]);

    expect(conversation.lastAuthor).toBe('claude');
    expect(conversation.lastAt).toBe('2026-09-13T09:05:00Z');
  });

  it('names a row whose title cannot be read after its kind', () => {
    const conversations = conversationsFrom([
      comment({ id: 'c1', plan_item_id: 'p1', step: null }),
      comment({ id: 'c2', raised_item_id: 'r1', raise: { title: '   ' } }),
      comment({ id: 'c3', feedback_item_id: 'f1', note: { kind: 'feature', body: '' } }),
    ]);

    expect(conversations.map((conversation) => conversation.about).sort()).toEqual([
      'A feature request',
      'A plan step',
      'A raise',
    ]);
  });

  it('keeps a step with a number but no title', () => {
    const [conversation] = conversationsFrom([
      comment({ plan_item_id: 'p1', step: { number: 412, title: null } }),
    ]);

    expect(conversation.about).toBe('#412');
  });

  it('reads a long body down to its first line', () => {
    const [conversation] = conversationsFrom([
      comment({ idea_id: 'i1', idea: { body: 'Let the bell carry replies\n\nAnd the rest of it.' } }),
    ]);

    expect(conversation.about).toBe('Let the bell carry replies');
  });

  it('is empty for an account that has said nothing', () => {
    expect(conversationsFrom([])).toEqual([]);
  });

  it('ignores a comment that points at no row', () => {
    expect(conversationsFrom([comment({ id: 'c1' })])).toEqual([]);
  });
});

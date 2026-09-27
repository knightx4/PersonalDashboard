import { describe, expect, it } from 'vitest';
import { askTitle, MAX_ASK_TITLE, MAX_TURN, toModelMessages, toTalkTurn, turnBody } from './talk';

describe('turnBody', () => {
  it('trims what was written', () => {
    expect(turnBody('  why a tree search?  ')).toEqual({ body: 'why a tree search?' });
  });

  it('refuses nothing and too much', () => {
    expect(turnBody('   ')).toHaveProperty('error');
    expect(turnBody('x'.repeat(MAX_TURN + 1))).toHaveProperty('error');
    expect(turnBody('x'.repeat(MAX_TURN))).toEqual({ body: 'x'.repeat(MAX_TURN) });
  });
});

describe('toTalkTurn', () => {
  it('reads a row, and treats an unknown role as the person', () => {
    expect(toTalkTurn({ id: 't1', role: 'assistant', body: 'Because.', created_at: '2026-09-26T10:00:00Z' })).toEqual({
      id: 't1',
      role: 'assistant',
      body: 'Because.',
      createdAt: '2026-09-26T10:00:00Z',
    });
    expect(toTalkTurn({ id: 't2', role: 'odd', body: 'Hm', created_at: 'x' }).role).toBe('user');
  });

  it('carries what Dash looked up and cited, and leaves both off when there is none', () => {
    const citation = { table: 'todo.tasks', ref: 'k1', title: 'Call Acme', href: '/todo?task=k1' };
    const turn = toTalkTurn({
      id: 't3',
      role: 'assistant',
      body: 'One.',
      created_at: 'x',
      tool_calls: [{ name: 'search', input: {}, result: [] }],
      citations: [citation],
    });
    expect(turn.citations).toEqual([citation]);
    expect(turn.toolCalls).toHaveLength(1);
    const plain = toTalkTurn({ id: 't4', role: 'assistant', body: 'Hi', created_at: 'x', tool_calls: null, citations: [] });
    expect(plain).not.toHaveProperty('toolCalls');
    expect(plain).not.toHaveProperty('citations');
  });
});

describe('askTitle', () => {
  it('puts the question on one line', () => {
    expect(askTitle('  Which companies\n\nhave gone quiet?  ')).toBe('Which companies have gone quiet?');
  });

  it('cuts a long question at a word', () => {
    const title = askTitle('word '.repeat(60));
    expect(title.length).toBeLessThanOrEqual(MAX_ASK_TITLE);
    expect(title.endsWith('word…')).toBe(true);
  });
});

describe('toModelMessages', () => {
  it('passes an alternating thread through as it is', () => {
    expect(
      toModelMessages([
        { role: 'user', body: 'Why?' },
        { role: 'assistant', body: 'Because.' },
        { role: 'user', body: 'And then?' },
      ]),
    ).toEqual([
      { role: 'user', content: 'Why?' },
      { role: 'assistant', content: 'Because.' },
      { role: 'user', content: 'And then?' },
    ]);
  });

  it('joins two turns of the person left by a reply that failed', () => {
    expect(
      toModelMessages([
        { role: 'user', body: 'Why?' },
        { role: 'user', body: 'Still wondering.' },
      ]),
    ).toEqual([{ role: 'user', content: 'Why?\n\nStill wondering.' }]);
  });

  it('puts what Dash opened with ahead of the first turn of the person', () => {
    const messages = toModelMessages([
      { role: 'assistant', body: 'Explain tree search.' },
      { role: 'user', body: 'It looks ahead.' },
    ]);
    expect(messages).toHaveLength(1);
    expect(messages[0].role).toBe('user');
    expect(messages[0].content).toContain('Explain tree search.');
    expect(messages[0].content).toContain('It looks ahead.');
  });

  it('drops empty turns and gives nothing for a thread with no turn of the person', () => {
    expect(toModelMessages([{ role: 'user', body: '  ' }])).toEqual([]);
    expect(toModelMessages([{ role: 'assistant', body: 'Hello' }])).toEqual([]);
  });
});

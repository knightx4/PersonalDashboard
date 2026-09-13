import { describe, expect, it } from 'vitest';
import { askMessage, ideaContext, raiseContext, threadText } from './context';
import type { DevComment } from './load';
import type { IdeaRow } from '@/lib/ideas/load';
import type { RaisedRow } from '@/lib/raised/load';

function idea(overrides: Partial<IdeaRow> = {}): IdeaRow {
  return {
    id: 'i1',
    body: 'A weekly digest of what changed.',
    module: 'dev',
    createdAt: '2026-09-01T00:00:00Z',
    planItem: null,
    source: 'me',
    from: null,
    dismissedAt: null,
    thread: [],
    ...overrides,
  };
}

function raise(overrides: Partial<RaisedRow> = {}): RaisedRow {
  return {
    id: 'r1',
    title: 'main was merged with a failing typecheck',
    detail: 'Two pushes landed while the gate was off.',
    ask: 'Should the merge run tsc first?',
    consequence: null,
    module: 'dev',
    source: 'plan #20',
    status: 'open',
    createdAt: '2026-09-01T00:00:00Z',
    answeredAt: null,
    thread: [],
    ...overrides,
  };
}

function comment(author: DevComment['author'], body: string): DevComment {
  return { id: `c-${body}`, author, body, createdAt: '2026-09-01T00:00:00Z' };
}

describe('ideaContext', () => {
  it('says what the idea is and where it belongs', () => {
    const text = ideaContext(idea());
    expect(text).toContain('A weekly digest of what changed.');
    expect(text).toContain('Module: Dev');
    expect(text).toContain('Not shaped into a plan feature yet.');
  });

  it('names the feature a suggestion came out of', () => {
    const text = ideaContext(
      idea({ source: 'claude', from: { number: 338, title: 'Talk back to Claude inside the app' } }),
    );
    expect(text).toContain('a session, as a suggestion');
    expect(text).toContain('#338 Talk back to Claude inside the app');
  });

  it('says where a shaped idea went', () => {
    const text = ideaContext(
      idea({ planItem: { id: 'p1', number: 12, title: 'The digest', status: 'not_started' } }),
    );
    expect(text).toContain('In the plan as #12 The digest');
  });
});

describe('raiseContext', () => {
  it('carries the ask and the evidence', () => {
    const text = raiseContext(raise());
    expect(text).toContain('Should the merge run tsc first?');
    expect(text).toContain('Two pushes landed while the gate was off.');
    expect(text).toContain('Raised by: plan #20');
  });

  it('leaves out what a raise does not have', () => {
    const text = raiseContext(raise({ ask: null, detail: null, source: null }));
    expect(text).not.toContain('What it asks for');
    expect(text).not.toContain('The evidence');
    expect(text).not.toContain('Raised by');
  });
});

describe('threadText', () => {
  it('is empty when nothing has been said', () => {
    expect(threadText([])).toBe('');
  });

  it('names who wrote each one, oldest first', () => {
    const text = threadText([comment('me', 'Why B?'), comment('claude', 'It keeps the nesting.')]);
    expect(text.indexOf('The person: Why B?')).toBeLessThan(text.indexOf('Claude: It keeps'));
  });
});

describe('askMessage', () => {
  it('puts the question last, under its own heading', () => {
    const message = askMessage({
      context: ideaContext(idea()),
      thread: [comment('me', 'Earlier note.')],
      question: 'What would this cost?',
    });
    expect(message.indexOf('A weekly digest')).toBeLessThan(message.indexOf('Earlier note.'));
    expect(message.indexOf('Earlier note.')).toBeLessThan(message.indexOf('## The question'));
    expect(message.trimEnd().endsWith('What would this cost?')).toBe(true);
  });

  it('leaves the history out when there is none', () => {
    const message = askMessage({ context: 'x', thread: [], question: 'y' });
    expect(message).not.toContain('Said so far');
  });
});

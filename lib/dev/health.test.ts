import { describe, expect, it } from 'vitest';
import type { DevComment } from '@/lib/comments/load';
import {
  feedbackHealth,
  findingHealth,
  ideaHealth,
  lastWordIsYours,
  raisedHealth,
} from '@/lib/dev/health';

function said(...authors: DevComment['author'][]): DevComment[] {
  return authors.map((author, index) => ({
    id: String(index),
    author,
    body: 'something',
    createdAt: `2026-09-1${index}T00:00:00Z`,
  }));
}

describe('feedbackHealth', () => {
  it('reads a blocked note with nothing said back as waiting on you', () => {
    expect(feedbackHealth({ status: 'blocked', thread: [] })).toBe('waiting');
    expect(feedbackHealth({ status: 'blocked', thread: said('me', 'claude') })).toBe('waiting');
  });

  it('reads a blocked note you have replied to as answered', () => {
    // The status column does not move when you type, so this is the only thing
    // that tells "I asked you" from "you told me".
    expect(feedbackHealth({ status: 'blocked', thread: said('claude', 'me') })).toBe('answered');
  });

  it('leaves the rest of the queue where its column puts it', () => {
    expect(feedbackHealth({ status: 'open', thread: [] })).toBe('ready');
    expect(feedbackHealth({ status: 'planned', thread: [] })).toBe('planned');
    expect(feedbackHealth({ status: 'in_progress', thread: [] })).toBe('working');
    expect(feedbackHealth({ status: 'done', thread: [] })).toBe('done');
    expect(feedbackHealth({ status: 'declined', thread: [] })).toBe('dropped');
  });

  it('does not read a reply on a note nobody is blocked on', () => {
    expect(feedbackHealth({ status: 'open', thread: said('claude', 'me') })).toBe('ready');
  });
});

describe('lastWordIsYours', () => {
  it('is false on a thread nobody has written in', () => {
    expect(lastWordIsYours([])).toBe(false);
  });

  it('reads the last comment and not any of the ones before it', () => {
    expect(lastWordIsYours(said('me', 'claude', 'me'))).toBe(true);
    expect(lastWordIsYours(said('me', 'me', 'claude'))).toBe(false);
  });
});

describe('raisedHealth', () => {
  it('splits an answered raise on whether anything came of it', () => {
    expect(raisedHealth({ status: 'answered', outcome: null })).toBe('unfinished');
    expect(raisedHealth({ status: 'answered', outcome: 'Filed as an idea.' })).toBe('answered');
  });

  // Replying is not being finished, so the two are different words on the row.
  it('reads a closed raise apart from an answered one', () => {
    expect(raisedHealth({ status: 'closed', outcome: 'Filed as an idea.' })).toBe('closed');
  });

  it('reads an open raise as waiting and a turned-down one as dropped', () => {
    expect(raisedHealth({ status: 'open', outcome: null })).toBe('waiting');
    // A dismissal is allowed to record nothing. Putting one aside is the answer.
    expect(raisedHealth({ status: 'dismissed', outcome: null })).toBe('dropped');
  });
});

describe('findingHealth', () => {
  it('reads a candidate as waiting on you and a confirmed one as ready', () => {
    expect(findingHealth({ status: 'open' })).toBe('waiting');
    expect(findingHealth({ status: 'confirmed' })).toBe('ready');
    expect(findingHealth({ status: 'dismissed' })).toBe('dropped');
  });
});

describe('ideaHealth', () => {
  const plan = (status: string) => ({ id: 'p', number: 12, title: 'A feature', status });

  it('reads an unshaped idea as one nothing has happened to', () => {
    expect(ideaHealth({ dismissedAt: null, planItem: null })).toBe('open');
  });

  it('splits a shaped idea on what the plan row became', () => {
    expect(ideaHealth({ dismissedAt: null, planItem: plan('proposed') })).toBe('waiting');
    expect(ideaHealth({ dismissedAt: null, planItem: plan('not_started') })).toBe('shaped');
    expect(ideaHealth({ dismissedAt: null, planItem: plan('in_progress') })).toBe('shaped');
    expect(ideaHealth({ dismissedAt: null, planItem: plan('done') })).toBe('done');
  });

  it('puts a dismissal ahead of everything else, because it is out of the list', () => {
    expect(ideaHealth({ dismissedAt: '2026-09-16', planItem: plan('proposed') })).toBe('dropped');
  });
});

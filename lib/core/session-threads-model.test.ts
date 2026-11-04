import { describe, expect, it } from 'vitest';
import {
  attachmentName,
  awaitingReply,
  claudeSessionUrl,
  newSessionThreadHref,
  openSessionRef,
  sessionMessageOf,
  sessionThreadPath,
  threadTitleFrom,
  threadTurns,
  workingLine,
  type SessionMessage,
} from './session-threads-model';

function msg(fields: Partial<SessionMessage> & Pick<SessionMessage, 'id' | 'author' | 'createdAt'>): SessionMessage {
  return {
    kind: 'text',
    body: 'words',
    options: null,
    artifactUrl: null,
    attachment: null,
    answer: null,
    answeredAt: null,
    ...fields,
  };
}

describe('session thread addresses', () => {
  it('opens a thread on the Dash tab and starts one on a project', () => {
    expect(sessionThreadPath('abc')).toBe('/chat/dash/session/abc');
    expect(newSessionThreadHref()).toBe('/chat/dash/session/new');
    expect(newSessionThreadHref('jam-app')).toBe('/chat/dash/session/new?project=jam-app');
    expect(openSessionRef('/chat/dash/session/abc')).toBe('abc');
    expect(openSessionRef('/chat/dash/1234')).toBeNull();
  });

  it('links a session to Claude only with a plain session id', () => {
    expect(claudeSessionUrl('cse_01ABC')).toBe('https://claude.ai/code/cse_01ABC');
    expect(claudeSessionUrl(null)).toBeNull();
    expect(claudeSessionUrl('../x')).toBeNull();
  });
});

describe('threadTitleFrom', () => {
  it('takes the first line, cut at eighty characters', () => {
    expect(threadTitleFrom('\n  Fix the login page  \nmore')).toBe('Fix the login page');
    expect(threadTitleFrom('x'.repeat(100))).toHaveLength(80);
    expect(threadTitleFrom('   ')).toBe('A conversation with a session');
  });
});

describe('the working line', () => {
  const asked = msg({ id: '1', author: 'person', createdAt: '2026-11-04T10:00:00Z' });

  it('says what the session last reported since your message', () => {
    const old = msg({ id: '0', author: 'session', kind: 'status', body: 'Earlier', createdAt: '2026-11-04T09:00:00Z' });
    const now = msg({ id: '2', author: 'session', kind: 'status', body: 'Reading the tests', createdAt: '2026-11-04T10:01:00Z' });
    expect(workingLine('working', [old, asked, now])).toBe('Reading the tests');
    expect(workingLine('working', [old, asked], 'From the progress row')).toBe('From the progress row');
  });

  it('says a queued thread is waiting for a session', () => {
    expect(workingLine('queued', [asked])).toBe('Waiting for a session to pick this up');
  });

  it('is gone once the session has replied, or while it waits on you', () => {
    const reply = msg({ id: '2', author: 'session', createdAt: '2026-11-04T10:02:00Z' });
    expect(workingLine('idle', [asked, reply])).toBeNull();
    expect(workingLine('waiting', [asked])).toBeNull();
    expect(workingLine('ended', [asked])).toBeNull();
  });

  it('leaves status lines out of the turns', () => {
    const status = msg({ id: '2', author: 'session', kind: 'status', createdAt: '2026-11-04T10:01:00Z' });
    expect(threadTurns([asked, status]).map((m) => m.id)).toEqual(['1']);
    expect(awaitingReply([asked, status])).toBe(true);
  });
});

describe('sessionMessageOf', () => {
  it('reads a question with its options and a file by its name', () => {
    const row = {
      id: 'q',
      author: 'session',
      kind: 'question',
      body: 'Which?',
      options: ['A', ' B ', 3],
      created_at: '2026-11-04T10:00:00Z',
      attachment_path: 'u/0e7f3a6c-1111-4222-8333-444455556666-plan.pdf',
    };
    const m = sessionMessageOf(row);
    expect(m?.options).toEqual(['A', 'B']);
    expect(m?.attachment).toEqual({ name: 'plan.pdf', href: null });
    expect(attachmentName('u/0e7f3a6c-1111-4222-8333-444455556666-a.png')).toBe('a.png');
  });

  it('refuses a row that is not a message', () => {
    expect(sessionMessageOf({ id: 'x', author: 'bot', kind: 'text', created_at: 'now' })).toBeNull();
  });
});

import { describe, expect, it } from 'vitest';
import { SESSION_MESSAGE_MAX } from '@/lib/core/session-threads-model';
import { SESSION_OFFER, chatAsMessage, offersSession, suggestProject } from './chat-to-session';
import { ASK_VOICE } from '@/lib/dash/ask';

const projects = [
  { id: 'website', label: 'Personal website' },
  { id: 'budget', label: 'Budget app' },
];

describe('chatAsMessage', () => {
  it('writes the turns oldest first under who said them, without the offer', () => {
    const text = chatAsMessage([
      { role: 'user', body: 'Add a dark mode to the site' },
      { role: 'assistant', body: `That needs a code change. ${SESSION_OFFER}` },
    ]);
    expect(text).toContain('Me: Add a dark mode to the site\n\nDash: That needs a code change.');
    expect(text).not.toContain(SESSION_OFFER);
  });

  it('is empty for a chat with no words', () => {
    expect(chatAsMessage([{ role: 'user', body: '  ' }])).toBe('');
  });

  it('keeps the newest turns when the chat is too long', () => {
    const long = 'x'.repeat(30_000);
    const text = chatAsMessage([
      { role: 'user', body: `first ${long}` },
      { role: 'assistant', body: `second ${long}` },
      { role: 'user', body: 'last question' },
    ]);
    expect(text.length).toBeLessThanOrEqual(SESSION_MESSAGE_MAX);
    expect(text).toContain('last question');
    expect(text).not.toContain('first');
    expect(text).toContain('left out');
  });
});

describe('suggestProject', () => {
  it('picks the project the chat names most', () => {
    const turns = [{ body: 'Fix the budget app, the Budget app header is wrong, and the personal website too' }];
    expect(suggestProject(turns, projects)).toBe('budget');
  });

  it('matches whole words only and falls back to this app', () => {
    expect(suggestProject([{ body: 'my websites and budgets' }], projects)).toBeNull();
    expect(suggestProject([], projects)).toBeNull();
  });

  it('breaks a tie towards the one named last', () => {
    expect(suggestProject([{ body: 'website first, then budget' }], projects)).toBe('budget');
  });
});

describe('the offer', () => {
  it('is spotted in an answer', () => {
    expect(offersSession(`Needs code. ${SESSION_OFFER}`)).toBe(true);
    expect(offersSession('Here you go.')).toBe(false);
  });

  it('is in the rules Dash answers by, word for word', () => {
    expect(ASK_VOICE.system).toContain(`word for word: ${SESSION_OFFER}`);
  });
});

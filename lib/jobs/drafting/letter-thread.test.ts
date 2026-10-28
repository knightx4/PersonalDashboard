import { describe, expect, it } from 'vitest';
import { letterReply } from './letter-thread';

const draft = {
  letter: 'Dear Northwind Hiring Team:\n\nI am a CPA.\n\nSincerely,\n\nAlex Doe',
  words: 9,
  evidenceItemIds: [],
  unsupportedClaims: [],
  bannedFound: [],
  asks: [],
};

describe('letterReply', () => {
  it('is the letter, with where to find it', () => {
    const reply = letterReply(draft);
    expect(reply).toContain('beside the letter');
    expect(reply).toContain('Dear Northwind Hiring Team:\n\nI am a CPA.');
    expect(reply).not.toContain('Nothing on file');
  });

  it('names what is banned, unbacked and still unanswered', () => {
    const reply = letterReply({
      ...draft,
      bannedFound: ['where X and Y meet'],
      unsupportedClaims: ['ten years in audit'],
      asks: [
        { id: 'a', answer_id: null, question: 'Why this role?', reply: null },
        { id: 'b', answer_id: null, question: 'Who to address?', reply: 'The CFO' },
      ],
    });
    expect(reply).toContain('"where X and Y meet"');
    expect(reply).toContain('- ten years in audit');
    expect(reply).toContain('- Why this role?');
    expect(reply).not.toContain('Who to address?');
  });
});

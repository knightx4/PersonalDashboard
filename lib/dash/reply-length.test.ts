import { describe, expect, it } from 'vitest';
import { ASK_VOICE } from './ask';
import { THREAD_RULES } from './thread';

describe('how long Dash replies', () => {
  it.each([
    ['a thread', THREAD_RULES],
    ['Ask Dash', ASK_VOICE.system],
  ])('%s matches the length to the comment', (_name, rules) => {
    expect(rules).toMatch(/one\s+short\s+sentence/);
    expect(rules).toMatch(/"looks\s+good"/);
    expect(rules).not.toContain('two to five');
    expect(rules).not.toContain('a few sentences');
  });

  it('lets a thread mark a comment seen in place of a short reply, and never Ask Dash (plan #1649)', () => {
    expect(THREAD_RULES).toMatch(/or\s+no\s+reply\s+at\s+all:\s+call\s+acknowledge\s+instead/);
    expect(ASK_VOICE.system).not.toContain('acknowledge');
  });

  it('keeps reporting changes in words, and citing rows', () => {
    expect(THREAD_RULES).toContain('a change you made is said in words');
    expect(THREAD_RULES).toContain('cited');
    expect(ASK_VOICE.system).toContain('A change you made is always said in words');
    expect(ASK_VOICE.system).toContain('cited by the table and ref');
  });
});

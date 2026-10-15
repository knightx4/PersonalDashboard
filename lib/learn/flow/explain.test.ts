import { describe, expect, it } from 'vitest';
import { explainedHeading, explainPrompt, followedUpHeading, PROMPT_CHECKS } from './explain';

describe('explainPrompt', () => {
  it('asks for the idea explained, with an example, when it has no checks', () => {
    expect(explainPrompt('  Runway  ')).toBe(
      'Explain this idea to a friend in a few sentences: Runway. Say what it means, why it holds, and give an example of your own.',
    );
  });

  it('names the checks as what a full answer also does, for breadth', () => {
    expect(
      explainPrompt('Runway', [
        'Says what happens to runway when burn rises.',
        'Works out runway from cash and net burn',
      ]),
    ).toBe(
      'Explain this idea to a friend in a few sentences: Runway. Say what it means, why it holds, and give an example of your own. ' +
        'A full answer also says what happens to runway when burn rises and works out runway from cash and net burn.',
    );
  });

  it(`names ${PROMPT_CHECKS} checks at most, keeps an acronym's capitals and skips blanks`, () => {
    const prompt = explainPrompt('ARR', ['ARR excludes one-off fees.', ' ', 'Says a.', 'Says b.', 'Says c.']);
    expect(prompt).toContain('A full answer also ARR excludes one-off fees, says a and says b.');
    expect(prompt).not.toContain('says c');
  });
});

describe('headings', () => {
  it('say whether the explanation and the follow-up held', () => {
    expect(explainedHeading({ holds: true })).toBe('That holds.');
    expect(explainedHeading({ holds: false })).toBe('Not quite.');
    expect(explainedHeading({ holds: false, dontKnow: true })).toBe('Counted as a miss.');
    expect(followedUpHeading({ holds: true })).toBe('The follow-up holds too.');
    expect(followedUpHeading({ holds: false })).toBe('The follow-up did not hold.');
  });
});

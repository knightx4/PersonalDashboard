import { describe, expect, it } from 'vitest';
import { optionAnswer, planOptions } from './options';

describe('planOptions', () => {
  // The two shapes the plan has actually used, taken from real decisions.
  it('reads the (a) form', () => {
    const detail = [
      'Every answer is new information, but not every answer is worth a run.',
      '',
      '(a) ALWAYS. Answering fires a re-shape, no choice. Truest to the idea.',
      '',
      '(b) A CHECKBOX ON THE ANSWER FORM, DEFAULT OFF. You decide per answer.',
      '',
      '(c) OFF BY DEFAULT, PLUS A BUTTON ON THE FEATURE. Answer as many as you like.',
    ].join('\n');

    expect(planOptions(detail)).toEqual([
      { letter: 'a', label: 'ALWAYS' },
      { letter: 'b', label: 'A CHECKBOX ON THE ANSWER FORM, DEFAULT OFF' },
      { letter: 'c', label: 'OFF BY DEFAULT, PLUS A BUTTON ON THE FEATURE' },
    ]);
  });

  it('reads the "A — " form', () => {
    const detail = [
      'The transport half is small; the OAuth half is the whole week.',
      '',
      'A — Be an OAuth server, for claude.ai custom connectors. A connector needs it.',
      '',
      'B — Take a pasted token, for the CLI. Cheaper by a week.',
    ].join('\n');

    expect(planOptions(detail)).toEqual([
      { letter: 'A', label: 'Be an OAuth server, for claude.ai custom connectors' },
      { letter: 'B', label: 'Take a pasted token, for the CLI' },
    ]);
  });

  // What most of the plan's decisions are actually written with: a double
  // dash where an em dash was meant. Taken from #208, whose opening paragraph
  // also starts with a bare "A" and must stay prose.
  it('reads the "A -- " form, and leaves the paragraph above it alone', () => {
    const detail = [
      'A standard calendar app lets you say "every Tuesday". Personal admin is full of that.',
      '',
      'A -- No repeats. Each event is one event, typed once.',
      '',
      'B -- One repeat rule per event: every day, every week or every month.',
    ].join('\n');

    expect(planOptions(detail)).toEqual([
      { letter: 'A', label: 'No repeats' },
      { letter: 'B', label: 'One repeat rule per event: every day, every week or every month' },
    ]);
  });

  // Two dashes are a typed em dash; three are a rule, and a rule after a
  // letter is a typo rather than a choice.
  it('stops at two dashes', () => {
    expect(planOptions('A --- First\nB --- Second')).toEqual([]);
  });

  it('accepts "A)" and "A." and a tight list', () => {
    expect(planOptions('A) One thing\nB. Another thing')).toEqual([
      { letter: 'A', label: 'One thing' },
      { letter: 'B', label: 'Another thing' },
    ]);
  });

  // The reason a separator is required. This paragraph opens a real decision
  // in the plan and is prose, not option A.
  it('does not read an unlabelled paragraph as an option', () => {
    const detail = [
      'A fired session, like the ideas page shape button. It reads the files.',
      '',
      'You, from the page. It shows the shots side by side and you file what you see.',
    ].join('\n');

    expect(planOptions(detail)).toEqual([]);
  });

  it('needs at least two, in order, from the top of the alphabet', () => {
    expect(planOptions('A — The only one on offer')).toEqual([]);
    expect(planOptions('A — First\nC — Third')).toEqual([]);
    expect(planOptions('B — Second\nC — Third')).toEqual([]);
  });

  it('finds nothing in an empty or absent detail', () => {
    expect(planOptions(null)).toEqual([]);
    expect(planOptions('')).toEqual([]);
    expect(planOptions('Just a question, with no options written down.')).toEqual([]);
  });

  it('trims a long label at a word, with an ellipsis', () => {
    const long = `A — ${'word '.repeat(40)}\nB — Short one`;
    const [first] = planOptions(long);
    expect(first.label.length).toBeLessThanOrEqual(121);
    expect(first.label.endsWith('…')).toBe(true);
    expect(first.label).not.toContain(' …');
  });
});

describe('optionAnswer', () => {
  it('records the letter and what it stood for', () => {
    expect(optionAnswer({ letter: 'b', label: 'A CHECKBOX' })).toBe('b — A CHECKBOX');
  });
});

describe('the forms the plan actually contains', () => {
  it('reads the lettered decisions the routine writes', () => {
    // The exact shape of plan #129, which worked, and of #84 and #86 after
    // they were backfilled into it. A regression here is the option buttons
    // silently disappearing again.
    const detail = [
      'There are three real answers.',
      '',
      'A — feedback_items, the notes queue. It already has triage and priorities.',
      '',
      'B — ideas. The right register for "could be better".',
      '',
      'C — Their own table, alongside the review record. It costs a migration.',
      '',
      'I would file to feedback_items at priority 3, and let the routine work them.',
    ].join('\n');

    expect(planOptions(detail).map((option) => option.letter)).toEqual(['A', 'B', 'C']);
  });

  it('does not mistake the recommendation for a fourth option', () => {
    // "I would build the third: …" opens a paragraph and is prose. So did
    // every option in #84 and #86 before they were lettered, which is exactly
    // why nothing may be inferred from an unlabelled paragraph.
    const detail = 'A — One thing.\n\nB — Another thing.\n\nI would build B, for the reason above.';
    expect(planOptions(detail)).toHaveLength(2);
  });
});

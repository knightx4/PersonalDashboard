import { describe, expect, it } from 'vitest';
import { checkBrain, readBrain } from '@/lib/you/board-brain';

const ROSTER = ['hiring_manager', 'mentor', 'skeptic', 'cfo', 'dreamer', 'buffett', 'seneca'];
const link = (n: number) => `https://example.org/source-${n}`;

/** A version 2 brain that passes every check; tests break one part at a time. */
function goodBrain(): Record<string, unknown> {
  return {
    version: 2,
    assessment: { name: 'Twenty-year hold', text: 'Whether you understand it well enough to keep it for twenty years.' },
    evidence: ['The last three years of numbers.', 'Who you would work for.'],
    questions: ['Would you be glad to own this if the market shut for ten years?', 'What is it worth?', 'Where is the moat?'],
    rules: Array.from({ length: 8 }, (_, i) => `Rule ${i + 1} in his own words. (${1980 + i} letter)`),
    frameworks: [
      { name: 'Circle of competence', text: 'Know its edge.' },
      { name: 'Margin of safety', text: 'Leave room.' },
      { name: 'Mr. Market', text: 'Use his moods.' },
    ],
    positions: ['risk', 'money', 'time', 'people'].map((topic) => ({ topic, text: `On ${topic}.` })),
    contrarian: [
      { common: 'Diversify widely.', text: 'Concentrate on what you know.' },
      { common: 'Volatility is risk.', text: 'Risk is permanent loss.' },
    ],
    disagreements: [
      { advisor: 'cfo', text: 'Would hold more cash than the CFO asks for.' },
      { advisor: 'seneca', text: 'Thinks money well kept buys freedom.' },
    ],
    stories: [1965, 1988, 2008].map((year, i) => ({ date: String(year), text: `What happened in ${year}.`, source: link(i) })),
    never: ['Borrow to buy.', 'Time the market.', 'Buy what you cannot explain.'],
    voice: 'Folksy, short sentences, jokes at his own expense.',
    sources: Array.from({ length: 10 }, (_, i) => ({ label: `Source ${i}`, link: link(i) })),
  };
}

describe('checkBrain', () => {
  it('passes a brain that meets every count', () => {
    expect(checkBrain(goodBrain(), { key: 'buffett', roster: ROSTER })).toEqual([]);
  });

  it('names each part out of range', () => {
    const b = goodBrain();
    b.rules = (b.rules as string[]).slice(0, 6);
    b.never = [];
    b.version = 1;
    const problems = checkBrain(b, { key: 'buffett', roster: ROSTER });
    expect(problems).toContain('rules has 6; it needs 8.');
    expect(problems).toContain('never has 0; it needs 3 to 5.');
    expect(problems).toContain('version is not 2.');
  });

  it('wants a source in brackets at the end of each rule', () => {
    const b = goodBrain();
    (b.rules as string[])[2] = 'Be patient.';
    expect(checkBrain(b, { key: 'buffett', roster: ROSTER })).toEqual(['rule 3 does not end with its source in brackets.']);
  });

  it('holds a story to a date and a listed source', () => {
    const b = goodBrain();
    (b.stories as Record<string, unknown>[])[0] = { text: 'Undated.', source: 'https://elsewhere.org' };
    expect(checkBrain(b, { key: 'buffett', roster: ROSTER })).toEqual([
      'story 1 has no date.',
      "story 1's source is not in sources.",
    ]);
  });

  it('only lets disagreements name other advisors on the board, a seat among them for a guest', () => {
    const b = goodBrain();
    b.disagreements = [
      { advisor: 'buffett', text: 'With himself.' },
      { advisor: 'munger', text: 'Not on this board.' },
    ];
    expect(checkBrain(b, { key: 'buffett', roster: ROSTER })).toEqual([
      'disagreement 1 is with this advisor itself.',
      'disagreement 2 names munger, who is not on the board.',
      'no disagreement is with a seat; a guest needs at least one.',
    ]);
  });

  it('wants ten distinct web links', () => {
    const b = goodBrain();
    const sources = b.sources as { label: string; link: string }[];
    sources[9] = { label: 'Twice', link: sources[8].link };
    sources[7] = { label: 'A note', link: '/vault/n/Me/Dreams.md' };
    expect(checkBrain(b, { key: 'buffett', roster: ROSTER })).toEqual([
      'source 8 (A note) has no usable link.',
      `source ${sources[8].link} is listed twice.`,
    ]);
  });

  it('lets the dreamer cite notes, and wants four of them', () => {
    const b = goodBrain();
    b.disagreements = [
      { advisor: 'cfo', text: 'Money.' },
      { advisor: 'skeptic', text: 'Hope.' },
    ];
    const sources = b.sources as { label: string; link: string }[];
    sources[9] = { label: 'Dreams', link: '/vault/n/Me/Dreams.md' };
    expect(checkBrain(b, { key: 'dreamer', roster: ROSTER })).toEqual(['the dreamer cites 1 notes; it needs at least 4.']);
    for (const i of [6, 7, 8]) sources[i] = { label: `Note ${i}`, link: `/vault/n/Ideas/${i}.md` };
    expect(checkBrain(b, { key: 'dreamer', roster: ROSTER })).toEqual([]);
  });

  it('does not ask a seat to disagree with a seat', () => {
    const b = goodBrain();
    b.disagreements = [
      { advisor: 'buffett', text: 'On cash.' },
      { advisor: 'seneca', text: 'On wealth.' },
    ];
    expect(checkBrain(b, { key: 'cfo', roster: ROSTER })).toEqual([]);
  });
});

describe('readBrain', () => {
  it('reads a version 1 brain with the new parts empty', () => {
    const brain = readBrain({
      rules: ['One. (a)'],
      voice: 'Plain.',
      sources: [{ label: 'A', link: 'https://a.org' }],
      stories: [{ text: 'Then.', source: 'https://a.org' }],
    });
    expect(brain).toMatchObject({ version: 1, assessment: null, never: [], rules: ['One. (a)'] });
    expect(brain?.stories[0]).toEqual({ date: null, text: 'Then.', source: 'https://a.org' });
  });

  it('reads a failed build as no brain', () => {
    expect(readBrain({ error: 'Too few sources.' })).toBeNull();
    expect(readBrain(null)).toBeNull();
  });
});

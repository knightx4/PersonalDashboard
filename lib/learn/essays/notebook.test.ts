import { describe, expect, it } from 'vitest';
import { yourWords } from './authorship';
import { answerBlock, assembleDraft, notesOf, readMapReply, seedNotes, sourceBlock } from './notebook';
import { EMPTY_PLAN, withPoint } from './plan';

const NOTES = `Prefer preventative controls wherever possible. Detective fills in the holes in the swiss cheese layout.

Ai is like a mix between a preparer / person and a system, so some controls are ITGCs and some are review.

But there should still be some level of human in the loop to ensure there isnt just a loop going around.`;

const brief = { question: 'Q?', claim: '', reader: '', origin: '', change: '', pinned: [] };

describe('reading the map Dash made of the notes', () => {
  const reply = `Here it is:
\`\`\`json
{
  "claims": ["Ai is like a mix between a preparer / person and a system", "AI is basically a person"],
  "clusters": [
    {"label": "AI as preparer and system", "quotes": ["Ai is like a mix between a preparer / person and a system"], "support": "thin", "gap": "No example from a close."},
    {"label": "Preventive first", "quotes": ["Prefer preventative controls wherever possible.", "Prefer preventive controls always"], "support": "ok", "gap": "ignored"},
    {"label": "Invented", "quotes": ["Nothing like this is in the notes at all"], "support": "none", "gap": "x"}
  ],
  "tensions": [{"a": "Prefer preventative controls wherever possible.", "b": "there should still be some level of human in the loop", "note": "Automation against review."}],
  "questions": ["Which control in a close is the person half? And which the system?", "What decides which controls get a human?"],
  "ordered": true
}
\`\`\``;

  it('keeps only passages that are in the notes word for word, and drops clusters left with none', () => {
    const map = readMapReply(reply, NOTES, '2026-10-15T20:00:00Z')!;
    expect(map.claims).toEqual(['Ai is like a mix between a preparer / person and a system']);
    expect(map.clusters.map((c) => [c.label, c.quotes.length, c.gap])).toEqual([
      ['AI as preparer and system', 1, 'No example from a close.'],
      ['Preventive first', 1, ''],
    ]);
    expect(map.tensions).toHaveLength(1);
  });

  it('keeps single questions only', () => {
    expect(readMapReply(reply, NOTES, 'now')!.questions).toEqual(['What decides which controls get a human?']);
  });

  it('gives up on a reply with no usable cluster', () => {
    expect(readMapReply('{"clusters": []}', NOTES, 'now')).toBeNull();
    expect(readMapReply('not json', NOTES, 'now')).toBeNull();
  });
});

describe('assembling a draft from the notes', () => {
  const map = readMapReply(
    JSON.stringify({
      claims: ['Ai is like a mix between a preparer / person and a system'],
      clusters: [
        { label: 'AI as preparer and system', quotes: ['Ai is like a mix between a preparer / person and a system, so some controls are ITGCs and some are review.'], support: 'ok' },
        { label: 'Keep a human in the loop', quotes: ['there should still be some level of human in the loop'], support: 'none', gap: 'Nothing says when a human is worth it.' },
      ],
      tensions: [],
      questions: [],
      ordered: true,
    }),
    NOTES,
    'now',
  )!;

  it('lays out the person’s passages under Dash’s headings, with the gap marked', () => {
    const { text } = assembleDraft(map, 'Controls for AI', 'model');
    expect(text).toBe(
      [
        '# Controls for AI',
        '',
        'Ai is like a mix between a preparer / person and a system',
        '',
        '## AI as preparer and system',
        '',
        'Ai is like a mix between a preparer / person and a system, so some controls are ITGCs and some are review.',
        '',
        '## Keep a human in the loop',
        '',
        'there should still be some level of human in the loop',
        '',
        '[Gap: Nothing says when a human is worth it.]',
        '',
      ].join('\n'),
    );
  });

  it('marks only the headings and gap lines as Dash’s', () => {
    const { text, marks } = assembleDraft(map, 'Controls for AI', 'model');
    expect(marks.map((m) => text.slice(m.from, m.to))).toEqual([
      'AI as preparer and system',
      'Keep a human in the loop',
      '[Gap: Nothing says when a human is worth it.]',
    ]);
    expect(yourWords(text, marks).percent).toBeGreaterThan(70);
  });
});

describe('the notes an essay starts with', () => {
  it('collects what was written in the old stages, so nothing is lost', () => {
    const plan = withPoint({ ...EMPTY_PLAN }, 'Prefer preventative controls.');
    const seeded = seedNotes({ ...brief, claim: 'A lot transfers.' }, plan);
    expect(seeded).toContain('## What I think\n\nA lot transfers.');
    expect(seeded).toContain('- Prefer preventative controls.');
  });

  it('uses the saved notes once there are any', () => {
    expect(notesOf(brief, { ...EMPTY_PLAN, notes: 'Mine.' })).toBe('Mine.');
  });

  it('adds answers and sources as blocks for the end of the notes', () => {
    expect(answerBlock('Why?', ' Because. ')).toBe('\n\n## Dash asked: Why?\n\nBecause.\n');
    expect(sourceBlock({ quote: 'a "b"', sourceTitle: 'T', domain: 'd.org', url: 'https://d.org' })).toBe(
      '\n\n> “a ”b””\n> T · https://d.org\n',
    );
  });
});

import { describe, expect, it } from 'vitest';
import {
  bodyAt,
  checkById,
  checkCalls,
  checkUnits,
  essayParagraphs,
  freshFindings,
  newStatuses,
  nextRung,
  notesToOpen,
  readFinding,
  stoppedChecks,
  type NoteState,
} from './checks';
import { writingGuideFindings } from './checks-local';

const DOC = `# Why money is the odd good out

Money keeps its value because everyone expects everyone else to accept it. That expectation is the whole of its worth.

Short line.

Gold was money for centuries, yet nobody eats gold. A good that is valued only for being passed on behaves unlike any other.

So money is a promise, and promises can be broken by anyone who stops believing them.`;

describe('essayParagraphs', () => {
  it('leaves out headings and lines too short to argue anything', () => {
    const paragraphs = essayParagraphs(DOC);
    expect(paragraphs.map((p) => p.text.slice(0, 10))).toEqual(['Money keep', 'Gold was m', 'So money i']);
    for (const p of paragraphs) expect(DOC.slice(p.from, p.to)).toBe(p.text);
  });
});

describe('checkUnits and checkCalls', () => {
  it('reads each paragraph, the last, or the whole essay, by the check', () => {
    expect(checkUnits(checkById('counterpoint')!, DOC)).toHaveLength(3);
    expect(checkUnits(checkById('earned_ending')!, DOC)[0]?.text.startsWith('So money')).toBe(true);
    expect(checkUnits(checkById('the_claim')!, DOC)).toEqual([null]);
    expect(checkCalls(checkById('counterpoint')!, 3)).toBe(3);
    expect(checkCalls(checkById('so_what')!, 3)).toBe(1);
    expect(checkCalls(checkById('writing_guide')!, 3)).toBe(0);
    expect(checkCalls(checkById('counterpoint')!, 0)).toBe(0);
  });
});

describe('readFinding', () => {
  const unit = essayParagraphs(DOC)[1];
  const reply = (finding: unknown) => JSON.stringify({ finding });
  const found = {
    quote: 'nobody eats gold',
    question: 'What would someone who disagrees say here?',
    hint: 'Gold has industrial uses; the paragraph treats it as having none.',
    directions: 'Narrow the claim, or say why those uses do not explain its price.',
    why: 'Counterpoint looks for the strongest objection the essay does not answer.',
  };

  it('anchors the finding on its quote in the paragraph, with the ladder in order', () => {
    const finding = readFinding(reply(found), DOC, unit)!;
    expect(finding.anchor.quote).toBe('nobody eats gold');
    expect(finding.anchor.offset).toBe(DOC.indexOf('nobody eats gold'));
    expect(finding.ladder).toEqual([found.question, found.hint, found.directions]);
    expect(finding.rung).toBe(1);
  });

  it('falls back to the first sentence when the quote is not in the paragraph', () => {
    const finding = readFinding(reply({ ...found, quote: 'something it never said at all' }), DOC, unit)!;
    expect(finding.anchor.quote).toBe('Gold was money for centuries, yet nobody eats gold.');
  });

  it('drops a whole-essay finding it cannot place, and reads none as none', () => {
    expect(readFinding(reply({ ...found, quote: 'something it never said at all' }), DOC, null)).toBeNull();
    expect(readFinding('{"finding": null}', DOC, unit)).toBeNull();
    expect(readFinding('not json', DOC, unit)).toBeNull();
  });

  it('links the note Already Said names', () => {
    const finding = readFinding(reply({ ...found, note: 1 }), DOC, unit, [
      { path: 'Economics/Money.md', title: 'Money', text: '...' },
    ])!;
    expect(finding.ladder[1]).toContain('See [Money](/vault/n/Economics/Money.md).');
  });
});

describe('the ladder', () => {
  it('climbs one rung at a time to 3, after which the next is a suggested wording', () => {
    expect(nextRung(0)).toBe(1);
    expect(nextRung(2)).toBe(3);
    expect(nextRung(3)).toBeNull();
    expect(bodyAt(['q', 'h', 'd'], 0)).toBe('');
    expect(bodyAt(['q', 'h', 'd'], 2)).toBe('h');
    expect(bodyAt(['q', 'h', 'd'], 4)).toBe('d');
  });
});

const note = (over: Partial<NoteState>): NoteState => ({
  id: 'n',
  checkName: 'counterpoint',
  status: 'open',
  quote: 'q',
  createdAt: '2026-10-12T10:00:00Z',
  ...over,
});

describe('three open at most, and a check dismissed twice stops', () => {
  it('opens new notes while there is room and holds the rest', () => {
    expect(newStatuses(1, 4)).toEqual(['open', 'open', 'waiting', 'waiting']);
    expect(newStatuses(3, 1)).toEqual(['waiting']);
  });

  it('opens the oldest waiting notes once some close', () => {
    const notes = [
      note({ id: 'a' }),
      note({ id: 'w2', status: 'waiting', createdAt: '2026-10-12T10:02:00Z' }),
      note({ id: 'w1', status: 'waiting', createdAt: '2026-10-12T10:01:00Z' }),
      note({ id: 'w3', status: 'waiting', createdAt: '2026-10-12T10:03:00Z' }),
    ];
    expect(notesToOpen(notes)).toEqual(['w1', 'w2']);
  });

  it('stops a check after two dismissals in the essay', () => {
    expect(stoppedChecks([note({ status: 'dismissed' })]).size).toBe(0);
    expect([...stoppedChecks([note({ status: 'dismissed' }), note({ status: 'dismissed' })])]).toEqual([
      'counterpoint',
    ]);
  });

  it('does not raise the same place twice for a check', () => {
    const finding = (quote: string) => ({
      anchor: { quote, prefix: '', suffix: '', offset: 0 },
      ladder: ['q', 'h', 'd'] as [string, string, string],
      why: 'w',
      rung: 1,
    });
    const fresh = freshFindings(
      'counterpoint',
      [finding('old'), finding('new'), finding('new')],
      [note({ quote: 'old', status: 'dismissed' })],
    );
    expect(fresh.map((f) => f.anchor.quote)).toEqual(['new']);
  });
});

describe('writingGuideFindings', () => {
  it('marks the sentence the rules match, as a marker with a ladder', () => {
    const doc = `# Money: a short history

Money is not just a tool, it's a promise everyone keeps. Prices follow from that promise.`;
    const found = writingGuideFindings(doc);
    expect(found.map((f) => f.anchor.quote)).toEqual([
      'Money: a short history',
      "Money is not just a tool, it's a promise everyone keeps.",
    ]);
    expect(found.every((f) => f.rung === 0 && f.ladder.every(Boolean))).toBe(true);
  });
});

import { describe, expect, it } from 'vitest';
import { claimNote, claimsText, essayEvidence, logEntry, MAX_CLAIMS, readClaims } from './finish';

describe('claimsText', () => {
  it('leaves out footnote definitions and markers, which are other people’s words', () => {
    const draft =
      '# Money\n\nMoney is odd.[^1] It does not wear out.\n\n[^1]: [The myth](https://example.org/x#:~:text=odd) · example.org\n';
    expect(claimsText(draft)).toBe('# Money\n\nMoney is odd. It does not wear out.');
  });
});

describe('readClaims', () => {
  const reply = JSON.stringify({
    claims: [
      { name: 'Money is a shared expectation', claim: 'It holds value because  everyone expects it to.' },
      { name: 'money is a shared expectation', claim: 'A repeat.' },
      { name: '', claim: 'No name.' },
      { name: 'No claim', claim: '' },
      { name: '# Scarcity is not enough', claim: 'Gold is scarce; agreement makes it money.' },
    ],
  });

  it('keeps entries with a name and a claim, once each, with spaces closed up', () => {
    expect(readClaims(reply)).toEqual([
      { name: 'Money is a shared expectation', claim: 'It holds value because everyone expects it to.' },
      { name: 'Scarcity is not enough', claim: 'Gold is scarce; agreement makes it money.' },
    ]);
  });

  it('reads a reply in a code fence, or a bare array', () => {
    expect(readClaims('```json\n' + reply + '\n```')).toHaveLength(2);
    expect(readClaims('[{"name":"A","claim":"b"}]')).toEqual([{ name: 'A', claim: 'b' }]);
  });

  it('returns nothing for a reply that is not the shape', () => {
    expect(readClaims('Here are the claims: ...')).toEqual([]);
    expect(readClaims('{"claims": "none"}')).toEqual([]);
  });

  it('keeps at most the limit', () => {
    const many = Array.from({ length: 20 }, (_, i) => ({ name: `Claim ${i}`, claim: `Says ${i}.` }));
    expect(readClaims(JSON.stringify(many))).toHaveLength(MAX_CLAIMS);
  });
});

describe('claimNote', () => {
  it('is a heading, the claim and a link back to the essay', () => {
    expect(claimNote({ name: 'Money is a shared expectation', claim: 'It holds value.' }, 'Why money is [odd]')).toBe(
      '# Money is a shared expectation\n\nIt holds value.\n\nArgued in [[Why money is odd]].\n',
    );
  });
});

describe('logEntry', () => {
  it('names the essay as the topic and the claims in the summary', () => {
    const entry = logEntry({
      title: 'Why money is the odd good out',
      claim: 'Money holds value because we expect it to.',
      claims: [
        { name: 'A', claim: 'First.' },
        { name: 'B', claim: 'Second.' },
      ],
    });
    expect(entry.topic).toBe('Why money is the odd good out');
    expect(entry.summary).toBe(
      'Wrote an essay arguing: Money holds value because we expect it to. It makes 2 claims: First. Second.',
    );
  });

  it('stays inside the log’s limits', () => {
    const long = 'x'.repeat(5_000);
    const entry = logEntry({ title: long, claim: long, claims: [{ name: 'A', claim: long }] });
    expect(entry.topic.length).toBeLessThanOrEqual(200);
    expect(entry.summary.length).toBeLessThanOrEqual(4_000);
  });
});

describe('essayEvidence', () => {
  it('links to the essay and lists the points, within the bank’s limits', () => {
    const item = essayEvidence({
      id: 'abc',
      title: 'Why money is the odd good out',
      claim: 'Money holds value because we expect it to.',
      claims: [{ name: 'Shared expectation', claim: 'Everyone expects others to accept it.' }],
      finishedOn: '2026-10-12',
    });
    expect(item.title).toBe('Essay: Why money is the odd good out');
    expect(item.body).toContain('I wrote an essay arguing that money holds value because we expect it to.');
    expect(item.body).toContain('- Shared expectation: Everyone expects others to accept it.');
    expect(item.body).toContain('/learn/e/abc');
    expect(item.context).toBe('An essay I finished on 2026-10-12.');
    const long = essayEvidence({ id: 'a', title: 'x'.repeat(400), claim: '', claims: [], finishedOn: 'd' });
    expect(long.title.length).toBeLessThanOrEqual(160);
  });
});

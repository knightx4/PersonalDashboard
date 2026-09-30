import { describe, expect, it } from 'vitest';
import { shownBrief, storedPicks } from './shown';

const pick = (n: number, href = `/jobs/${n}`) => ({
  key: `interview:${n}`,
  kind: 'interview',
  title: `Interview ${n}`,
  reason: `At ${n}:00 today.`,
  href,
});

describe('storedPicks', () => {
  it('reads null and non-arrays as an older row', () => {
    expect(storedPicks(null)).toBeNull();
    expect(storedPicks({})).toBeNull();
  });

  it('keeps well-formed picks in order, at most three', () => {
    expect(storedPicks([pick(1), pick(2), pick(3), pick(4)])?.map((p) => p.key)).toEqual([
      'interview:1',
      'interview:2',
      'interview:3',
    ]);
  });

  it('leaves out a pick that does not link inside the app', () => {
    const kept = storedPicks([
      pick(1, 'https://example.com'),
      pick(2, '//example.com'),
      pick(3, 'javascript:alert(1)'),
      pick(4),
      { title: 'No href' },
    ]);
    expect(kept?.map((p) => p.href)).toEqual(['/jobs/4']);
  });
});

describe('shownBrief', () => {
  it('is null before the run writes the day', () => {
    expect(shownBrief(null)).toBeNull();
  });

  it('shows the picks when there are any', () => {
    expect(shownBrief({ body: 'b', picks: [pick(1)] })).toEqual({
      kind: 'picks',
      picks: [pick(1)],
    });
  });

  it('says nothing stands out when nothing qualified', () => {
    expect(shownBrief({ body: 'Nothing booked…', picks: [] })).toEqual({ kind: 'none' });
  });

  it('shows an older row by its body', () => {
    expect(shownBrief({ body: ' A paragraph. ', picks: null })).toEqual({
      kind: 'body',
      body: 'A paragraph.',
    });
    expect(shownBrief({ body: '', picks: null })).toBeNull();
  });

  it('falls back to the body when every stored pick is unreadable', () => {
    expect(shownBrief({ body: 'Body.', picks: [{ title: 'x' }] })).toEqual({
      kind: 'body',
      body: 'Body.',
    });
  });
});

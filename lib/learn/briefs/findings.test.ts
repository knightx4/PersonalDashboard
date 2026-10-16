import { describe, expect, it } from 'vitest';
import { groupFindings, readFindingSources, type BriefFinding } from './findings';

const finding = (id: string, subQuestionId: string | null): BriefFinding => ({
  id,
  subQuestionId,
  body: `Finding ${id}`,
  sources: [],
  createdAt: '2026-10-16T00:00:00Z',
});

describe('brief findings', () => {
  it('sit under the sub-question they answer, and the rest under Added findings', () => {
    const { bySub, other } = groupFindings([finding('a', 'q1'), finding('b', null), finding('c', 'q1'), finding('d', 'gone')], ['q1', 'q2']);
    expect(bySub.get('q1')?.map((f) => f.id)).toEqual(['a', 'c']);
    expect(bySub.has('q2')).toBe(false);
    // A sub-question a later run dropped sends its findings to the rest.
    expect(other.map((f) => f.id)).toEqual(['b', 'd']);
  });

  it('keeps only sources with a title and an https link', () => {
    expect(
      readFindingSources([
        { title: 'AS 2201', url: 'https://pcaobus.org/as2201', quote: ' The auditor should test. ' },
        { title: 'No link' },
        { title: 'Plain', url: 'http://example.com' },
        'junk',
      ]),
    ).toEqual([{ title: 'AS 2201', url: 'https://pcaobus.org/as2201', quote: 'The auditor should test.' }]);
  });
});

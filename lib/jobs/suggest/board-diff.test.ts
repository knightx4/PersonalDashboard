import { describe, expect, it } from 'vitest';
import { diffBoard, newOnBoardLine, newOnPortfolioLine, pickDue, postingKey, readCutoff } from './board-diff';

const post = (url: string, title = 'Strategy Associate') => ({ title, url, location: null });

describe('postingKey', () => {
  it('drops the fragment, the trailing slash and the host case, and keeps the query', () => {
    expect(postingKey('https://Jobs.Lever.co/clay/abc/#apply')).toBe('https://jobs.lever.co/clay/abc');
    expect(postingKey('https://boards.greenhouse.io/x?gh_jid=12')).toBe('https://boards.greenhouse.io/x?gh_jid=12');
  });

  it('keeps an unparseable link as it is', () => {
    expect(postingKey(' not a link ')).toBe('not a link');
  });
});

describe('diffBoard', () => {
  it('records everything on a first read as offered, so none of it is suggested', () => {
    const diff = diffBoard([], [post('https://a.co/1'), post('https://a.co/2')], true);
    expect(diff.added.map((p) => p.offered)).toEqual([true, true]);
    expect(diff.gone).toEqual([]);
  });

  it('tells new, still up and taken down apart on a later read', () => {
    const stored = [
      { postingKey: 'https://a.co/1', goneAt: null },
      { postingKey: 'https://a.co/2', goneAt: null },
      { postingKey: 'https://a.co/3', goneAt: '2026-10-20T00:00:00Z' },
    ];
    const diff = diffBoard(stored, [post('https://a.co/1/'), post('https://a.co/4'), post('https://a.co/4#x')], false);
    expect(diff.added.map((p) => [p.postingKey, p.offered])).toEqual([['https://a.co/4', false]]);
    expect(diff.seen).toEqual(['https://a.co/1']);
    expect(diff.gone).toEqual(['https://a.co/2']);
  });

  it('sees a posting that came back as seen, not new', () => {
    const diff = diffBoard([{ postingKey: 'https://a.co/3', goneAt: '2026-10-20T00:00:00Z' }], [post('https://a.co/3')], false);
    expect(diff.added).toEqual([]);
    expect(diff.seen).toEqual(['https://a.co/3']);
  });

  it('skips a posting with no title or link', () => {
    expect(diffBoard([], [{ title: '', url: 'https://a.co/1', location: null }], false).added).toEqual([]);
  });
});

describe('timing', () => {
  const now = new Date('2026-10-25T12:00:00Z');

  it('reads a board again twenty hours after its last try', () => {
    expect(readCutoff(now)).toBe('2026-10-24T16:00:00.000Z');
  });

  it('picks at most once in twenty hours', () => {
    expect(pickDue(null, now)).toBe(true);
    expect(pickDue('2026-10-25T00:00:00Z', now)).toBe(false);
    expect(pickDue('2026-10-24T15:00:00Z', now)).toBe(true);
  });
});

describe('newOnBoardLine', () => {
  it('says when the posting appeared, in the person\'s time zone', () => {
    expect(newOnBoardLine('Clay', '2026-10-24T09:00:00Z')).toBe("New on Clay's board, first seen 24 Oct");
    expect(newOnBoardLine('Clay', '2026-10-24T23:30:00Z', 'Europe/London')).toBe("New on Clay's board, first seen 25 Oct");
    expect(newOnBoardLine('Clay', '2026-10-24T09:00:00Z', 'Not/AZone')).toBe("New on Clay's board, first seen 24 Oct");
  });
});

describe('newOnPortfolioLine', () => {
  it('names the investor whose board it was on', () => {
    expect(newOnPortfolioLine('RRE Ventures', '2026-10-24T09:00:00Z')).toBe("New on RRE Ventures' portfolio board, first seen 24 Oct");
    expect(newOnPortfolioLine('Antler', '2026-10-24T23:30:00Z', 'Europe/London')).toBe("New on Antler's portfolio board, first seen 25 Oct");
  });
});

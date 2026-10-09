import { describe, expect, it } from 'vitest';
import { isPictureId, pictureHref, picturesByItem } from './pictures';

const ID = '3f2a8c1e-4b5d-4e6f-8a9b-0c1d2e3f4a5b';

describe('plan pictures', () => {
  it('groups pictures by their row, in position order and then by age', () => {
    const grouped = picturesByItem([
      { id: 'c', item_id: 'x', caption: 'C', position: 1, created_at: '2026-10-08T10:00:00Z' },
      { id: 'a', item_id: 'x', caption: 'A', position: 0, created_at: '2026-10-08T12:00:00Z' },
      { id: 'b', item_id: 'x', caption: 'B', position: 0, created_at: '2026-10-08T13:00:00Z' },
      { id: 'd', item_id: 'y', caption: 'D', position: 0, created_at: '2026-10-08T10:00:00Z' },
    ]);
    expect(grouped.x.map((p) => p.caption)).toEqual(['A', 'B', 'C']);
    expect(grouped.y).toEqual([{ id: 'd', caption: 'D', src: pictureHref('d') }]);
  });

  it('loads a picture from its own route', () => {
    expect(pictureHref(ID)).toBe(`/dev/plan/picture?id=${ID}`);
  });

  it('asks the database only about an id shaped like one', () => {
    expect(isPictureId(ID)).toBe(true);
    expect(isPictureId('../etc')).toBe(false);
    expect(isPictureId('')).toBe(false);
  });
});

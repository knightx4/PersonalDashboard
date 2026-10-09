import { describe, expect, it } from 'vitest';
import { countSubjectClips } from './subject-counts';

describe('countSubjectClips', () => {
  it('counts each source and what has not played, leaving out clips marked not interested', () => {
    expect(
      countSubjectClips([
        { came_from: 'playlist', shown_at: null, not_interested_at: null },
        { came_from: 'playlist', shown_at: '2026-10-01T10:00:00Z', not_interested_at: null },
        { came_from: 'channel', shown_at: null, not_interested_at: null },
        { came_from: 'channel', shown_at: null, not_interested_at: '2026-10-02T10:00:00Z' },
      ]),
    ).toEqual({ watchLater: 2, channels: 1, unplayed: 2 });
  });

  it('is all zeros for a subject with no clips', () => {
    expect(countSubjectClips([])).toEqual({ watchLater: 0, channels: 0, unplayed: 0 });
  });
});

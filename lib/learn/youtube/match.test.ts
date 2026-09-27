import { describe, expect, it } from 'vitest';
import { METADATA_SLICE_MS, metadataEmbedDeadline } from '@/lib/learn/youtube/match';

describe('metadataEmbedDeadline', () => {
  const started = 1_000_000;

  it('runs to the fixed point when listing finishes early', () => {
    expect(metadataEmbedDeadline(started, 175_000, started + 80_000)).toBe(started + 175_000);
  });

  it('keeps its full slice when listing runs to its deadline or past it', () => {
    const now = started + 125_000;
    expect(metadataEmbedDeadline(started, 175_000, now)).toBe(now + METADATA_SLICE_MS);
    expect(METADATA_SLICE_MS).toBeGreaterThanOrEqual(60_000);
  });
});

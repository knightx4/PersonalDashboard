import { describe, expect, it } from 'vitest';
import { MAX_SUGGESTIONS, parseSuggestionPayload, trackKey } from './payload';

const track = (name: string, extra: Record<string, unknown> = {}) => ({
  name,
  about: 'What it covers.',
  depth: 'solid',
  why: 'The roles you want ask for it.',
  ...extra,
});

describe('parseSuggestionPayload', () => {
  it('reads well-formed suggestions', () => {
    const result = parseSuggestionPayload({ tracks: [track('SQL for analytics')] });
    expect(result).toEqual({
      ok: true,
      suggestions: [
        {
          name: 'SQL for analytics',
          about: 'What it covers.',
          depth: 'solid',
          why: 'The roles you want ask for it.',
        },
      ],
    });
  });

  it('drops suggestions without a name or a reason', () => {
    const result = parseSuggestionPayload({
      tracks: [track(''), { name: 'Statistics', depth: 'deep' }, track('Product sense')],
    });
    expect(result.ok && result.suggestions.map((s) => s.name)).toEqual(['Product sense']);
  });

  it('reads an unknown depth as familiar and an empty line as none', () => {
    const result = parseSuggestionPayload({ tracks: [track('Negotiation', { depth: 'expert', about: ' ' })] });
    expect(result.ok && result.suggestions[0]).toMatchObject({ depth: 'familiar', about: null });
  });

  it('drops repeats and names already taken, ignoring case and spacing', () => {
    const result = parseSuggestionPayload(
      { tracks: [track('Machine  learning'), track('machine learning'), track('Public speaking')] },
      new Set([trackKey('PUBLIC SPEAKING')]),
    );
    expect(result.ok && result.suggestions.map((s) => s.name)).toEqual(['Machine learning']);
  });

  it(`keeps at most ${MAX_SUGGESTIONS}`, () => {
    const tracks = Array.from({ length: 8 }, (_, i) => track(`Track ${i}`));
    const result = parseSuggestionPayload({ tracks });
    expect(result.ok && result.suggestions).toHaveLength(MAX_SUGGESTIONS);
  });

  it('treats no_data as an empty list and a missing list as an error', () => {
    expect(parseSuggestionPayload({ no_data: true })).toEqual({ ok: true, suggestions: [] });
    expect(parseSuggestionPayload({}).ok).toBe(false);
    expect(parseSuggestionPayload(null).ok).toBe(false);
  });
});

import { describe, expect, it, vi } from 'vitest';
import {
  checkWriting,
  ruleScores,
  WRITING_PATTERN_IDS,
  writingNote,
  writingState,
  writingWarning,
  type WritingPattern,
} from './check';

/** A stubbed Jev that answers every question with the given probability. */
function jev(probabilities: Partial<Record<WritingPattern, number>>, fallback = 0.05) {
  return vi.fn(async (_url: string, init: RequestInit) => {
    const body = JSON.parse(String(init.body)) as { questions: Record<string, unknown> };
    const answers: Record<string, unknown> = {};
    for (const id of Object.keys(body.questions)) {
      answers[id] = { type: 'noul', noul: probabilities[id as WritingPattern] ?? fallback };
    }
    return new Response(
      JSON.stringify({ model: 'jev-1.13.0', answers, usage: { input_tokens: 800, output_tokens: 36 } }),
      { status: 200 },
    );
  }) as unknown as typeof fetch & { mock: { calls: [string, RequestInit][] } };
}

const CLEAN = {
  title: 'Add a share page',
  detail: 'A read-only page at /share/<token> that shows one list without signing in.',
};

function flagged(text: Parameters<typeof ruleScores>[0]): WritingPattern[] {
  return ruleScores(text)
    .filter((s) => s.score === 1)
    .map((s) => s.pattern);
}

describe('the rules', () => {
  it('find the guide’s own examples', () => {
    expect(flagged({ detail: "The page is not a settings screen, it's the heart of the app." })).toEqual([
      'inflated_contrast',
    ]);
    expect(flagged({ detail: "This isn't just a calendar - it's a gateway." })).toContain('inflated_contrast');
    expect(flagged({ detail: 'It not only saves time, but also transforms how teams work.' })).toEqual([
      'stock_formula',
    ]);
    expect(flagged({ detail: 'The button moves — and the label changes — so it reads better.' })).toEqual([
      'em_dashes',
    ]);
    expect(flagged({ title: 'Sharing: a new way to show lists' })).toEqual(['colon_title']);
  });

  it('pass plain text, a real distinction and a quoted example', () => {
    expect(flagged(CLEAN)).toEqual([]);
    expect(flagged({ detail: 'The bug is in the parser, not the tokenizer.' })).toEqual([]);
    expect(flagged({ detail: 'Adding a row that contains "not X, it\'s Y" prints a warning.' })).toEqual([]);
    expect(flagged({ detail: 'One dash — here is fine.' })).toEqual([]);
  });
});

describe('checkWriting', () => {
  it('asks all six questions in one call and takes Jev’s probabilities', async () => {
    const fetch = jev({ slogan: 0.98 });
    const spend = vi.fn();
    const result = await checkWriting({ text: CLEAN, apiKey: 'k', fetch, onSpend: spend });
    expect(fetch).toHaveBeenCalledTimes(1);
    const sent = JSON.parse(String(fetch.mock.calls[0][1].body));
    expect(Object.keys(sent.questions).sort()).toEqual([...WRITING_PATTERN_IDS].sort());
    expect(sent.state).toEqual(writingState(CLEAN));
    expect(spend).toHaveBeenCalledTimes(1);
    expect(result.scores.find((s) => s.pattern === 'slogan')).toEqual({
      pattern: 'slogan',
      score: 0.98,
      by: 'jev',
    });
    expect(writingWarning(result)).toBe('Writing check: slogan (0.98). See docs/WRITING-GUIDE.md.');
    expect(writingNote(result, '2026-09-29')).toBe('Writing check 2026-09-29: slogan (0.98).');
  });

  it('prints nothing for clean text', async () => {
    const result = await checkWriting({ text: CLEAN, apiKey: 'k', fetch: jev({}) });
    expect(writingWarning(result)).toBeNull();
    expect(writingNote(result, '2026-09-29')).toBeNull();
  });

  it('warns without a note between the two thresholds', async () => {
    const result = await checkWriting({ text: CLEAN, apiKey: 'k', fetch: jev({ restating: 0.93 }) });
    expect(writingWarning(result)).toContain('restating the request (0.93)');
    expect(writingNote(result, '2026-09-29')).toBeNull();
  });

  it('keeps a rule’s match when Jev is unsure', async () => {
    const text = { title: 'Add a share page', detail: "It is not a settings page, it's the heart of it." };
    const result = await checkWriting({ text, apiKey: 'k', fetch: jev({ inflated_contrast: 0.4 }) });
    expect(writingWarning(result)).toBe(
      'Writing check: inflated contrast (rule). See docs/WRITING-GUIDE.md.',
    );
  });

  it('sends nothing for an account that has not turned Jev on, and still runs the rules', async () => {
    const fetch = jev({});
    const text = { detail: "It is not a settings page, it's the heart of it." };
    const result = await checkWriting({ text, enabled: false, apiKey: 'k', fetch });
    expect(fetch).not.toHaveBeenCalled();
    expect(result.jevFailure).toBe('not-enabled');
    expect(writingWarning(result)).toContain('inflated contrast');
  });

  it('falls back to the rules when Jev fails', async () => {
    const down = vi.fn(async () => new Response('down', { status: 529 })) as unknown as typeof fetch;
    const result = await checkWriting({ text: CLEAN, apiKey: 'k', fetch: down });
    expect(result.jevFailure).toBe('overloaded');
    expect(writingWarning(result)).toBeNull();
  });

  it('makes no call for empty text', async () => {
    const fetch = jev({});
    await checkWriting({ text: { title: ' ', detail: null }, apiKey: 'k', fetch });
    expect(fetch).not.toHaveBeenCalled();
  });
});

/**
 * The map's note classifier with Jev in front (plan #1168). Jev is a stubbed
 * fetch and Haiku a stubbed function; nothing reaches TypeSafe or Anthropic.
 */
import { describe, expect, it, vi } from 'vitest';
import { EMPTY_USAGE, type SpendReport } from '@/lib/core/spend/pricing';
import { classifyForMap, type MapHaiku, type MapHaikuAnswer } from './classify';
import { MAP_CLASS_OPTIONS, mapClassState } from './jev-question';
import { notReadDetail } from './rules';

const BODY =
  'Surface parking is among the worst things to happen to cities. Cities should be built for people, not cars, even at some cost to efficiency.';

/** Jev answers the class question with `choice` and the evidence question with `evidence`. */
function jevSays(choice: string, confidence: number, evidence = 0.1) {
  return vi.fn(async (_url: unknown, init?: RequestInit) => {
    const sent = JSON.parse(String(init?.body)) as { questions: { answer: { type: string } } };
    const answer =
      sent.questions.answer.type === 'noul'
        ? { type: 'noul', noul: evidence }
        : { type: 'choice', choice, confidence, probabilities: { [choice]: confidence } };
    return new Response(
      JSON.stringify({ model: 'jev-1.13.0', answers: { answer }, usage: { input_tokens: 300, output_tokens: 0 } }),
    );
  }) as unknown as typeof fetch;
}

const jevDown = vi.fn(async () => new Response('overloaded', { status: 529 })) as unknown as typeof fetch;

function haikuSays(answer: MapHaikuAnswer | null) {
  return vi.fn<MapHaiku>(async ({ onSpend }) => {
    onSpend?.({ model: 'claude-haiku-4-5', usage: { ...EMPTY_USAGE, inputTokens: 500, outputTokens: 40 } });
    return answer;
  });
}

const operational: MapHaikuAnswer = { class: 'operational', is_evidence: false, reason: 'A packing list.' };

async function classify(opts: { jev?: typeof fetch; haiku: MapHaiku; enabled?: boolean; spend?: SpendReport[] }) {
  return classifyForMap({
    title: 'Parking',
    body: BODY,
    anthropicApiKey: 'test',
    haiku: opts.haiku,
    jevEnabled: opts.enabled ?? true,
    jevApiKey: 'ts-test',
    jevFetch: opts.jev,
    onSpend: (report) => opts.spend?.push(report),
  });
}

describe('classifyForMap on Jev', () => {
  it('keeps a sure Jev class, asks Jev for the evidence flag, and writes no reason', async () => {
    const haiku = haikuSays(operational);
    const jev = jevSays('knowledge', 0.93, 0.85);
    const spend: SpendReport[] = [];
    const verdict = await classify({ jev, haiku, spend });

    expect(verdict).toEqual({ noteClass: 'knowledge', isEvidence: true, reason: null, confidence: 0.93 });
    expect(haiku).not.toHaveBeenCalled();
    expect(jev).toHaveBeenCalledTimes(2);
    expect(spend.map((r) => r.model)).toEqual(['jev-1.13.0', 'jev-1.13.0']);
  });

  it('uses Haiku’s class and reason when Jev is under 0.8', async () => {
    const haiku = haikuSays(operational);
    const jev = jevSays('knowledge', 0.62);
    const verdict = await classify({ jev, haiku });

    expect(verdict).toEqual({ noteClass: 'operational', isEvidence: false, reason: 'A packing list.' });
    expect(haiku).toHaveBeenCalledTimes(1);
    // The evidence question is not asked once Haiku has the note.
    expect(jev).toHaveBeenCalledTimes(1);
  });

  it('uses Haiku when the Jev call fails', async () => {
    const spend: SpendReport[] = [];
    const verdict = await classify({ jev: jevDown, haiku: haikuSays(operational), spend });
    expect(verdict.reason).toBe('A packing list.');
    expect(spend.map((r) => r.model)).toEqual(['claude-haiku-4-5']);
  });

  it('uses Haiku when Jev is sure of the class but the evidence call fails', async () => {
    let calls = 0;
    const jev = vi.fn(async (url: unknown, init?: RequestInit) => {
      calls += 1;
      if (calls === 2) return new Response('overloaded', { status: 529 });
      return jevSays('mixed', 0.9)(url as string, init);
    }) as unknown as typeof fetch;
    const verdict = await classify({ jev, haiku: haikuSays(operational) });
    expect(verdict).toEqual({ noteClass: 'operational', isEvidence: false, reason: 'A packing list.' });
  });

  it('never calls Jev for an account that has not opted in', async () => {
    const jev = jevSays('knowledge', 0.99);
    const verdict = await classify({ jev, haiku: haikuSays(operational), enabled: false });
    expect(verdict.noteClass).toBe('operational');
    expect(jev).not.toHaveBeenCalled();
  });

  it('reads an unreadable Haiku answer as operational, as before', async () => {
    const verdict = await classify({ jev: jevSays('knowledge', 0.5), haiku: haikuSays(null) });
    expect(verdict).toEqual({ noteClass: 'operational', isEvidence: false, reason: 'Could not be classified.' });
  });

  it('answers a short note without asking either model', async () => {
    const jev = jevSays('knowledge', 0.99);
    const haiku = haikuSays(operational);
    const verdict = await classifyForMap({
      title: 'Stub',
      body: 'Too short.',
      anthropicApiKey: 'test',
      haiku,
      jevEnabled: true,
      jevFetch: jev,
    });
    expect(verdict.reason).toBe('Too short to be stating anything.');
    expect(jev).not.toHaveBeenCalled();
    expect(haiku).not.toHaveBeenCalled();
  });
});

describe('the Jev question', () => {
  it('offers the three classes the map routes on, and sends no path', () => {
    expect(Object.keys(MAP_CLASS_OPTIONS)).toEqual(['knowledge', 'mixed', 'operational']);
    expect(mapClassState({ title: 'Parking', body: `  ${BODY}  ` })).toEqual({ title: 'Parking', text: BODY });
  });
});

describe('notReadDetail', () => {
  it('uses Haiku’s reason when there is one, and says how sure Jev was when not', () => {
    expect(notReadDetail({ noteClass: 'operational', isEvidence: false, reason: 'A packing list.' })).toBe(
      'Not read: A packing list.',
    );
    expect(notReadDetail({ noteClass: 'operational', isEvidence: false, reason: null, confidence: 0.914 })).toBe(
      'Not read: judged a record with nothing argued (91% sure).',
    );
  });
});

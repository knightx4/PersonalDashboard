import { describe, expect, it } from 'vitest';
import { ideaRowFrom } from '@/lib/ideas/load';
import type { Triage } from '@/lib/feedback/triage';
import {
  IDEA_SCORE_QUESTION,
  NO_VISION,
  NOT_TRIAGED,
  ideaScoreState,
  ideaScoreView,
  isSureScore,
  readIdeaScore,
  scaleIdeaScore,
  scoreFrom,
  visionForIdea,
} from '@/lib/ideas/score';
import { scoreIdea } from '@/lib/ideas/score-ask';

const row = (score: unknown) => ({
  id: 'i1',
  body: 'an idea',
  module: 'dev',
  created_at: '2026-09-30T09:00:00Z',
  source: 'me',
  dismissed_at: null,
  plan_item: null,
  from_plan_item: null,
  score,
});

describe('an idea score', () => {
  it('reads back a stored score', () => {
    const stored = { value: 72.5, confidence: 0.91, at: '2026-09-30T09:00:01Z' };
    expect(scoreFrom(stored)).toEqual(stored);
    expect(ideaRowFrom(row(stored)).score).toEqual(stored);
  });

  it('reads as null when the idea has none', () => {
    expect(ideaRowFrom(row(null)).score).toBeNull();
    expect(ideaRowFrom(row(undefined)).score).toBeNull();
  });

  it('reads a value that is not this shape as null', () => {
    expect(scoreFrom({ value: 140, confidence: 0.9, at: 'x' })).toBeNull();
    expect(scoreFrom({ value: '50', confidence: 0.9, at: 'x' })).toBeNull();
    expect(scoreFrom({ value: 50, at: 'x' })).toBeNull();
    expect(scoreFrom({ value: 50, confidence: 0.9 })).toBeNull();
    expect(scoreFrom('50')).toBeNull();
  });

  it('is unsure under 0.8', () => {
    expect(isSureScore({ value: 50, confidence: 0.8, at: 'x' })).toBe(true);
    expect(isSureScore({ value: 50, confidence: 0.79, at: 'x' })).toBe(false);
    expect(isSureScore(null)).toBe(false);
  });
});

describe('the score question', () => {
  it('has five levels and scales them to 0 to 100', () => {
    expect(IDEA_SCORE_QUESTION.levels).toHaveLength(5);
    expect(scaleIdeaScore(0)).toBe(0);
    expect(scaleIdeaScore(1)).toBe(25);
    expect(scaleIdeaScore(2)).toBe(50);
    expect(scaleIdeaScore(4)).toBe(100);
    expect(scaleIdeaScore(2.9)).toBe(73);
  });

  it('clamps what falls outside the levels', () => {
    expect(scaleIdeaScore(-1)).toBe(0);
    expect(scaleIdeaScore(7)).toBe(100);
    expect(scaleIdeaScore(Number.NaN)).toBe(0);
  });

  it('reads an answer into what is stored, and a failure into nothing', () => {
    const at = new Date('2026-09-30T10:00:00Z');
    const answer = { type: 'score' as const, score: 3, level: 3, confidence: 0.91234, probabilities: [] };
    expect(readIdeaScore({ ok: true, answer, model: 'jev-1.13.0' }, at)).toEqual({
      value: 75,
      confidence: 0.912,
      at: '2026-09-30T10:00:00.000Z',
    });
    expect(readIdeaScore({ ok: false, reason: 'timeout', detail: '' })).toBeNull();
  });
});

describe('what Jev reads about an idea', () => {
  const visions = { learn: { body: 'Learn is for learning.' }, app: { body: 'One place to run my life.' } };

  it('reads a workspace idea against that workspace\'s vision', () => {
    expect(visionForIdea(visions, 'learn')).toBe('Learn is for learning.');
    expect(ideaScoreState({ body: ' Quiz me daily. ', module: 'learn', vision: 'Learn is for learning.', triage: null })).toEqual({
      idea: 'Quiz me daily.',
      workspace: 'Learn: Questions until you stop, and what to read',
      vision: 'Learn is for learning.',
      triage: NOT_TRIAGED,
    });
  });

  it('reads an app-wide idea against the app\'s vision', () => {
    expect(visionForIdea(visions, null)).toBe('One place to run my life.');
    expect(ideaScoreState({ body: 'x', module: null, vision: 'One place to run my life.', triage: null }).workspace).toBe(
      'The app as a whole',
    );
  });

  it('says so when the workspace has no vision, rather than using the app\'s', () => {
    expect(visionForIdea(visions, 'news')).toBeNull();
    expect(ideaScoreState({ body: 'x', module: 'news', vision: null, triage: null }).vision).toBe(NO_VISION);
  });

  it('says how it was triaged, marking what Jev was unsure of', () => {
    const triage: Triage = {
      at: '2026-09-30T09:00:00Z',
      kind: { value: 'feature', confidence: 0.95 },
      module: { value: 'news', confidence: 0.6 },
      priority: { value: 3, confidence: 0.9 },
      duplicate: { value: null, confidence: 0.9 },
    };
    expect(ideaScoreState({ body: 'x', module: 'news', vision: null, triage }).triage).toBe(
      'Triaged as about News (unsure), priority someday.',
    );
  });
});

describe('an idea score as shown', () => {
  it('is the number when Jev is sure, marked unsure under 0.8, and unscored when there is none', () => {
    expect(ideaScoreView({ value: 72, confidence: 0.85, at: 'x' })).toEqual({
      text: '72',
      title: "Jev's score: 72 out of 100",
      state: 'sure',
    });
    expect(ideaScoreView({ value: 72, confidence: 0.64, at: 'x' })).toEqual({
      text: '72?',
      title: "Jev's score: 72 out of 100, unsure (confidence 0.64)",
      state: 'unsure',
    });
    expect(ideaScoreView(null)).toEqual({
      text: 'Unscored',
      title: 'Jev has not scored this idea yet',
      state: 'unscored',
    });
  });
});

describe('asking Jev', () => {
  const reply = (body: unknown, status = 200) =>
    (async () => new Response(JSON.stringify(body), { status })) as unknown as typeof fetch;

  it('sends the state and question and returns the scaled score with spend', async () => {
    const spend: unknown[] = [];
    let sent: Record<string, unknown> = {};
    const fetchImpl = (async (_url: string, init: RequestInit) => {
      sent = JSON.parse(String(init.body));
      return new Response(
        JSON.stringify({
          model: 'jev-1.13.0',
          answers: { answer: { score: 2, confidence: 0.83, probabilities: {} } },
          usage: { input_tokens: 600, output_tokens: 17 },
        }),
      );
    }) as unknown as typeof fetch;
    const result = await scoreIdea({
      body: 'Quiz me daily.',
      module: 'learn',
      vision: 'Learn is for learning.',
      triage: null,
      apiKey: 'test',
      fetch: fetchImpl,
      onSpend: (report) => spend.push(report),
    });
    expect(result.ok && result.score.value).toBe(50);
    expect(result.ok && result.score.confidence).toBe(0.83);
    expect((sent.state as Record<string, string>).vision).toBe('Learn is for learning.');
    expect(spend).toHaveLength(1);
  });

  it('comes back as the failure when Jev fails, so nothing is stored', async () => {
    const result = await scoreIdea({
      body: 'x',
      module: null,
      vision: null,
      triage: null,
      apiKey: 'test',
      fetch: reply({ error: 'overloaded' }, 529),
    });
    expect(result).toMatchObject({ ok: false, reason: 'overloaded' });
  });
});

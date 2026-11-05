import { describe, expect, it, vi } from 'vitest';
import type { SpendReport } from '@/lib/core/spend/pricing';
import { jevRequestBodyAll } from '@/lib/jev/client';
import {
  IDEA_SCORE_QUESTIONS,
  IDEA_SCORE_RUBRIC_VERSION,
  IDEA_TYPES,
  ideaInputHash,
  ideaScoreState,
  scoreIdea,
  scoreOutOf100,
  type IdeaSource,
  type IdeaToScore,
} from './idea-score';

/**
 * Sorting and scoring an idea with Jev (plan #2947.2), against stubbed
 * TypeSafe responses. Nothing here reaches TypeSafe.
 */

function source(quote: string, note: Partial<IdeaSource['note']> = {}): IdeaSource {
  return { quote, note: { title: 'On walkable towns', path: 'Ideas/On walkable towns.md', voice: 'private', ...note } };
}

const IDEA: IdeaToScore = {
  statement: 'Walkable towns need fewer shops, not more.',
  basis: 'Read in the section "Shops".',
  sources: [source('A walkable town needs fewer shops, so each one gets the footfall to survive.')],
};

function levels(weights: Record<number, number>): number[] {
  return Array.from({ length: 10 }, (_, level) => weights[level] ?? 0);
}

function respond(body: unknown, status = 200) {
  return vi.fn(async () => new Response(JSON.stringify(body), { status })) as unknown as typeof fetch & {
    mock: { calls: [string, RequestInit][] };
  };
}

function answersBody(type: string, usefulness: number[] | null, novelty: number[] | null) {
  const score = (probabilities: number[]) => ({
    type: 'score',
    score: probabilities.reduce((sum, p, level) => sum + p * level, 0),
    probabilities: Object.fromEntries(probabilities.map((p, level) => [String(level), p])),
    confidence: 0.7,
  });
  const answers: Record<string, unknown> = {
    type: {
      type: 'choice',
      choice: type,
      probabilities: Object.fromEntries(IDEA_TYPES.map((t) => [t, t === type ? 0.9 : 0.025])),
      confidence: 0.85,
    },
  };
  if (usefulness) answers.usefulness = score(usefulness);
  if (novelty) answers.novelty = score(novelty);
  return { model: 'jev-1.13.0', answers, usage: { input_tokens: 1_200, output_tokens: 30 } };
}

describe('the score out of 100', () => {
  it('is 100 with all the weight on level 9', () => {
    expect(scoreOutOf100({ score: 9, probabilities: levels({ 9: 1 }) })).toBe(100);
  });

  it('is 50 with half the weight on level 4 and half on level 5', () => {
    expect(scoreOutOf100({ score: 4.5, probabilities: levels({ 4: 0.5, 5: 0.5 }) })).toBe(50);
  });

  it('is 0 with all the weight on level 0', () => {
    expect(scoreOutOf100({ score: 0, probabilities: levels({ 0: 1 }) })).toBe(0);
  });

  it('normalises probabilities that do not sum to one', () => {
    expect(scoreOutOf100({ score: 9, probabilities: levels({ 9: 0.5 }) })).toBe(100);
  });

  it("uses Jev's weighted score when no probabilities came back", () => {
    expect(scoreOutOf100({ score: 5.76, probabilities: levels({}) })).toBe(64);
  });
});

describe('the questions', () => {
  it('asks two score questions of ten levels, each level with an example', () => {
    for (const question of [IDEA_SCORE_QUESTIONS.usefulness, IDEA_SCORE_QUESTIONS.novelty]) {
      expect(question.levels).toHaveLength(10);
      question.levels.forEach((level, index) => {
        expect(level.startsWith(`Level ${index}.`)).toBe(true);
        expect(level).toContain('Example:');
      });
    }
  });

  it('offers the five idea types', () => {
    expect(Object.keys(IDEA_SCORE_QUESTIONS.type.options)).toEqual([...IDEA_TYPES]);
  });

  it('sends all three in one request about one state', () => {
    const { state } = ideaScoreState(IDEA);
    const body = jevRequestBodyAll(state, IDEA_SCORE_QUESTIONS);
    expect(Object.keys(body.questions as object)).toEqual(['type', 'usefulness', 'novelty']);
  });
});

describe('what Jev reads', () => {
  it('is the statement, the basis and the passages by note title, never the path', () => {
    const { state } = ideaScoreState(IDEA);
    expect(state).toEqual({
      idea: IDEA.statement,
      basis: IDEA.basis,
      passages: [{ note: 'On walkable towns', text: IDEA.sources[0].quote }],
    });
    expect(JSON.stringify(state)).not.toContain('Ideas/');
  });

  it('never carries a passage from a secret, audience, journal or left-out note', () => {
    const idea: IdeaToScore = {
      ...IDEA,
      sources: [
        source('The vault password is hunter2.', { title: 'Passwords', voice: 'secret' }),
        source('I argue towns should grow.', { title: 'MBA essay', voice: 'audience' }),
        source('Today I felt the town was too quiet.', { title: 'Tuesday', path: 'Journal/Tuesday.md' }),
        source('Halvorsen should hire me.', { title: 'Cover letter', path: 'Career/Letter.md' }),
        source('Use sk-ant-abc to call it.', { title: 'Setup' }),
      ],
    };
    const { state } = ideaScoreState(idea, { journalFolders: ['Journal'], excludedFolders: ['Career'] });
    expect(state.passages).toEqual([]);
    const sent = JSON.stringify(state);
    for (const word of ['hunter2', 'grow', 'quiet', 'Halvorsen', 'sk-ant']) expect(sent).not.toContain(word);
  });

  it('keeps at most three passages, in the same order whatever order they came in', () => {
    const sources = ['d', 'b', 'a', 'c'].map((letter) => source(`Passage ${letter}.`, { title: `Note ${letter}` }));
    const forward = ideaScoreState({ ...IDEA, sources });
    const backward = ideaScoreState({ ...IDEA, sources: [...sources].reverse() });
    expect(forward.state.passages.map((p) => p.note)).toEqual(['Note a', 'Note b', 'Note c']);
    expect(backward.inputHash).toBe(forward.inputHash);
  });

  it('drops a repeated passage', () => {
    const { state } = ideaScoreState({ ...IDEA, sources: [IDEA.sources[0], IDEA.sources[0]] });
    expect(state.passages).toHaveLength(1);
  });
});

describe('the input hash', () => {
  it('is the same for the same idea and changes when the statement or a quote does', () => {
    const { inputHash } = ideaScoreState(IDEA);
    expect(inputHash).toMatch(/^[0-9a-f]{64}$/);
    expect(ideaScoreState(IDEA).inputHash).toBe(inputHash);
    expect(ideaScoreState({ ...IDEA, statement: 'Walkable towns need more shops.' }).inputHash).not.toBe(inputHash);
    expect(ideaScoreState({ ...IDEA, sources: [source('Something else.')] }).inputHash).not.toBe(inputHash);
  });

  it('does not change when a passage Jev never reads is added', () => {
    const { inputHash } = ideaScoreState(IDEA);
    const withSecret = { ...IDEA, sources: [...IDEA.sources, source('pin 1234', { voice: 'secret' })] };
    expect(ideaScoreState(withSecret).inputHash).toBe(inputHash);
  });

  it('is the hash of the state that was sent', () => {
    const { state, inputHash } = ideaScoreState(IDEA);
    expect(ideaInputHash(state)).toBe(inputHash);
  });
});

describe('scoring an idea', () => {
  it("returns the type and both scores with Jev's confidence for the writer's own idea", async () => {
    const fetch = respond(answersBody('own_idea', levels({ 6: 1 }), levels({ 4: 0.5, 5: 0.5 })));
    const spend: SpendReport[] = [];
    const result = await scoreIdea({ idea: IDEA, apiKey: 'k', fetch, onSpend: (r) => spend.push(r) });
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(result).toMatchObject({
      ok: true,
      score: {
        ideaType: 'own_idea',
        typeConfidence: 0.85,
        usefulness: 67,
        usefulnessConfidence: 0.7,
        novelty: 50,
        noveltyConfidence: 0.7,
        model: 'jev-1.13.0',
        rubricVersion: IDEA_SCORE_RUBRIC_VERSION,
        inputHash: ideaScoreState(IDEA).inputHash,
      },
    });
    if (result.ok) expect(result.score.noveltyLevels).toEqual(levels({ 4: 0.5, 5: 0.5 }));
    expect(spend).toHaveLength(1);

    const sent = JSON.parse(String(fetch.mock.calls[0][1].body));
    expect(sent.state).toEqual(ideaScoreState(IDEA).state);
  });

  it('scores a design too', async () => {
    const fetch = respond(answersBody('project_design', levels({ 3: 1 }), levels({ 8: 1 })));
    const result = await scoreIdea({ idea: IDEA, apiKey: 'k', fetch });
    expect(result).toMatchObject({ ok: true, score: { ideaType: 'project_design', usefulness: 33, novelty: 89 } });
  });

  it.each(['requirement', 'others_idea', 'description'])('keeps a %s with its type and no scores', async (type) => {
    const fetch = respond(answersBody(type, levels({ 9: 1 }), levels({ 9: 1 })));
    const result = await scoreIdea({ idea: IDEA, apiKey: 'k', fetch });
    expect(result).toMatchObject({
      ok: true,
      score: {
        ideaType: type,
        usefulness: null,
        usefulnessConfidence: null,
        usefulnessLevels: null,
        novelty: null,
        noveltyConfidence: null,
        noveltyLevels: null,
      },
    });
  });

  it('does not need readable scores for a type that is not scored', async () => {
    const fetch = respond(answersBody('requirement', null, null));
    const result = await scoreIdea({ idea: IDEA, apiKey: 'k', fetch });
    expect(result).toMatchObject({ ok: true, score: { ideaType: 'requirement', novelty: null } });
  });

  it("stores an idea whose every passage is withheld as not the writer's own, without asking Jev", async () => {
    const fetch = respond({});
    const idea = { ...IDEA, sources: [source('Frame the analog.', { voice: 'audience' })] };
    const result = await scoreIdea({ idea, apiKey: 'k', fetch });
    expect(result).toMatchObject({
      ok: true,
      score: { ideaType: 'others_idea', usefulness: null, novelty: null, model: 'not-asked' },
    });
    expect(fetch).not.toHaveBeenCalled();
  });

  it('still asks about an idea with no sources at all', async () => {
    const fetch = respond(answersBody('own_idea', levels({ 3: 1 }), levels({ 2: 1 })));
    const result = await scoreIdea({ idea: { ...IDEA, sources: [] }, apiKey: 'k', fetch });
    expect(result).toMatchObject({ ok: true, score: { ideaType: 'own_idea' } });
  });

  it('names story notes and product requirements in the type options', () => {
    const { description, requirement } = IDEA_SCORE_QUESTIONS.type.options;
    expect(description).toMatch(/story/);
    expect(requirement).toMatch(/should/);
  });

  it("fails an own idea whose score could not be read, so it is asked again", async () => {
    const fetch = respond(answersBody('own_idea', levels({ 5: 1 }), null));
    const result = await scoreIdea({ idea: IDEA, apiKey: 'k', fetch });
    expect(result).toMatchObject({ ok: false, reason: 'malformed' });
  });

  it('hands back a rate limit as it came, for the caller to pause on', async () => {
    const fetch = respond({ error: 'slow down' }, 429);
    const result = await scoreIdea({ idea: IDEA, apiKey: 'k', fetch });
    expect(result).toMatchObject({ ok: false, reason: 'rate-limited' });
  });

  it('asks nothing without a key', async () => {
    vi.stubEnv('TYPESAFE_API_KEY', '');
    const fetch = respond({});
    const result = await scoreIdea({ idea: IDEA, apiKey: '', fetch });
    expect(result).toMatchObject({ ok: false, reason: 'no-key' });
    expect(fetch).not.toHaveBeenCalled();
    vi.unstubAllEnvs();
  });
});

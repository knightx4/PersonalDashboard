import { describe, expect, it } from 'vitest';
import { besideLine, nextTopicsForAim, rankNextTopics, type NextTopicRow } from './next-topics';

function row(
  topic: string,
  beside: string,
  similarity: number,
  aim: { id: string; closeness: number } | null = null,
): NextTopicRow {
  return {
    topic_id: `t-${topic}`,
    title: topic,
    beside_id: `b-${beside}`,
    beside_title: beside,
    similarity,
    aim_id: aim?.id ?? null,
    aim_name: aim ? `Goal ${aim.id}` : null,
    aim_closeness: aim?.closeness ?? null,
  };
}

describe('rankNextTopics', () => {
  it('ranks by closeness to a goal before nearness to what you know', () => {
    const ranked = rankNextTopics([
      row('Commerce', 'Business', 0.93, { id: 'a', closeness: 0.6 }),
      row('World economy', 'Macroeconomics', 0.75, { id: 'a', closeness: 0.8 }),
    ]);
    expect(ranked.map((t) => t.title)).toEqual(['World economy', 'Commerce']);
  });

  it('puts topics no goal ranks after those a goal does', () => {
    const ranked = rankNextTopics([
      row('Commerce', 'Business', 0.95),
      row('World economy', 'Macroeconomics', 0.7, { id: 'a', closeness: 0.3 }),
    ]);
    expect(ranked.map((t) => t.title)).toEqual(['World economy', 'Commerce']);
    expect(ranked[1]!.aim).toBeNull();
  });

  it('keeps the nearest known topic when a topic is reached from several', () => {
    const ranked = rankNextTopics([
      row('Market (economics)', 'Market failure', 0.78, { id: 'a', closeness: 0.7 }),
      row('Market (economics)', 'Supply and demand', 0.83, { id: 'a', closeness: 0.7 }),
      row('Market (economics)', 'Profit (economics)', 0.8, { id: 'a', closeness: 0.7 }),
    ]);
    expect(ranked).toHaveLength(1);
    expect(ranked[0]!.beside.title).toBe('Supply and demand');
  });

  it('drops a topic that is not next to anything you know', () => {
    expect(rankNextTopics([row('School', 'Private equity', 0.41, { id: 'a', closeness: 0.9 })])).toEqual([]);
  });

  it('lets no one known topic fill the list', () => {
    const ranked = rankNextTopics(
      [
        row('A1', 'Macroeconomics', 0.9, { id: 'a', closeness: 0.9 }),
        row('A2', 'Macroeconomics', 0.9, { id: 'a', closeness: 0.89 }),
        row('A3', 'Macroeconomics', 0.9, { id: 'a', closeness: 0.88 }),
        row('B1', 'Business', 0.9, { id: 'a', closeness: 0.5 }),
      ],
      { limit: 3 },
    );
    expect(ranked.map((t) => t.title)).toEqual(['A1', 'A2', 'B1']);
  });

  it('splits the list by goal', () => {
    const ranked = rankNextTopics([
      row('Commerce', 'Business', 0.9, { id: 'a', closeness: 0.7 }),
      row('Software', 'Computer', 0.9, { id: 'b', closeness: 0.6 }),
    ]);
    expect(nextTopicsForAim(ranked, 'b').map((t) => t.title)).toEqual(['Software']);
  });
});

describe('besideLine', () => {
  it('names the known topic', () => {
    expect(besideLine(' Macroeconomics ')).toBe('Next to Macroeconomics, which you know.');
  });
});

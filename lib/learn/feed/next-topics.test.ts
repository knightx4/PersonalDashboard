import { describe, expect, it } from 'vitest';
import type { NextTopic } from '@/lib/learn/map/next-topics';
import { drawNextTopics, nextTopicPicks } from './next-topics';
import { whyLine } from './write-card';

function topic(title: string, beside: string): NextTopic {
  return {
    id: `t-${title}`,
    title,
    beside: { id: `b-${beside}`, title: beside },
    similarity: 0.8,
    aim: { id: 'aim-1', name: 'Financial services industry landscape', closeness: 0.7 },
  };
}

describe('nextTopicPicks', () => {
  it('takes the best topics from their lead, each naming what it sits beside', () => {
    const picks = nextTopicPicks([topic('World economy', 'Macroeconomics'), topic('Commerce', 'Business'), topic('Capital (economics)', 'Profit (economics)')], []);
    expect(picks.map((p) => [p.article, p.section, p.beside])).toEqual([
      ['World economy', null, 'Macroeconomics'],
      ['Commerce', null, 'Business'],
    ]);
    expect(picks[0]!.basis).toContain('Next to Macroeconomics, which you know.');
  });

  it('passes over a topic already on a card', () => {
    const picks = nextTopicPicks([topic('World economy', 'Macroeconomics'), topic('Commerce', 'Business')], ['world economy']);
    expect(picks.map((p) => p.article)).toEqual(['Commerce']);
  });

  it('says so when every topic is already had', () => {
    expect(drawNextTopics([topic('Commerce', 'Business')], ['Commerce']).ok).toBe(false);
  });
});

describe('whyLine for a next topic', () => {
  it('says which known topic the card sits beside, and the goal', () => {
    expect(
      whyLine({
        reason: 'goal',
        themeName: null,
        aimName: 'Financial services industry landscape',
        field: null,
        gap: null,
        besideTopic: 'Macroeconomics',
      }),
    ).toBe('Next to Macroeconomics, which you know. For your goal: Financial services industry landscape.');
  });

  it('keeps the goal line for any other goal card', () => {
    expect(whyLine({ reason: 'goal', themeName: null, aimName: 'Level 3', field: null, gap: null })).toBe(
      'For your goal: Level 3.',
    );
  });
});

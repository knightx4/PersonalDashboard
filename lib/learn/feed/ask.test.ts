import { describe, expect, it } from 'vitest';
import { cardMaterial } from './ask';
import type { FeedCardRow } from './card';

const section: FeedCardRow = {
  id: 'c1',
  reason: 'interest',
  status: 'ready',
  idea_name: 'Monte Carlo tree search',
  summary: 'AlphaGo searched a tree of moves guided by two networks.',
  why: 'You read about games.',
  takeaway: 'Search where the networks point, not everywhere.',
  context: 'Go has too many positions to try them all.',
  example: 'Pruning the moves a policy network rates badly.',
  item: { title: 'AlphaGo', canonical_url: 'https://en.wikipedia.org/wiki/AlphaGo', licence: null },
  segment: { heading: 'Algorithm', text: 'The search expands promising nodes.', section_anchor: null },
};

describe('cardMaterial', () => {
  it('gives a section card its own text and the passage it came from', () => {
    const material = cardMaterial(section);
    expect(material?.title).toBe('Monte Carlo tree search');
    expect(material?.text).toContain('Takeaway: Search where the networks point');
    expect(material?.text).toContain('Example: Pruning');
    expect(material?.text).toContain('(AlphaGo: Algorithm)');
    expect(material?.text).toContain('The search expands promising nodes.');
  });

  it('gives a lesson the section it cites, or none', () => {
    const lesson: FeedCardRow = {
      ...section,
      reason: 'lesson',
      item: null,
      segment: null,
      source_item: section.item,
      source_segment: section.segment,
    };
    expect(cardMaterial(lesson)?.text).toContain('The search expands promising nodes.');
    const bare = cardMaterial({ ...lesson, source_item: null });
    expect(bare?.text).toContain('Summary:');
    expect(bare?.text).not.toContain('passage');
  });

  it('has nothing for a unit check or a queued reading', () => {
    expect(cardMaterial({ ...section, reason: 'unit_check' })).toBeNull();
    expect(cardMaterial({ ...section, reason: 'queued' })).toBeNull();
    expect(cardMaterial({ ...section, segment: null })).toBeNull();
  });
});

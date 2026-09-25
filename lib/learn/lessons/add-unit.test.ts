import { describe, expect, it } from 'vitest';
import { nextUnitPrompt } from '@/lib/learn/graph/curriculum';
import type { Concept, Graph, KnowledgeState } from '@/lib/learn/graph/model';
import { shownInTrack } from './add-unit';

/**
 * Writing a track's next unit (plan #969): what the person has shown is read
 * off the graph, and the call is given it beside the units so far.
 */

function graphOf(states: Record<string, KnowledgeState>): Graph {
  return {
    concepts: Object.entries(states).map(([name, state]) => ({ id: name, name, state }) as unknown as Concept),
    edges: [],
    mentions: [],
  };
}

describe('what the person has shown in a track', () => {
  it('counts known and sharp as known, and shaky as kept to work on', () => {
    expect(
      shownInTrack(graphOf({ Supply: 'known', Demand: 'sharp', Elasticity: 'shaky', Tax: 'unknown', Rent: 'misconception' })),
    ).toEqual({ known: ['Demand', 'Supply'], workingOn: ['Elasticity'] });
  });
});

describe('the next unit prompt', () => {
  it('names the units so far in order, and each list of ideas', () => {
    const prompt = nextUnitPrompt({
      subject: 'Economics',
      units: [
        { title: 'Supply and demand', covers: 'Curves.', outcome: 'Read a market.' },
        { title: 'Elasticity', covers: '', outcome: '' },
      ],
      known: ['Supply'],
      workingOn: [],
      tooHard: ['Tax incidence'],
    });
    expect(prompt).toContain('1. Supply and demand. Covers: Curves. Outcome: Read a market.');
    expect(prompt).toContain('2. Elasticity\n');
    expect(prompt).toContain('Ideas they know:\n- Supply');
    expect(prompt).toContain('Ideas they asked to keep working on: none yet.');
    expect(prompt).toContain('Lessons they rated too hard:\n- Tax incidence');
  });

  it('says when the track has no units yet, and cuts a long list', () => {
    const prompt = nextUnitPrompt({
      subject: 'Economics',
      units: [],
      known: Array.from({ length: 45 }, (_, i) => `Idea ${i}`),
      workingOn: [],
      tooHard: [],
    });
    expect(prompt).toContain('The track has no units yet, so this is its first.');
    expect(prompt).toContain('- and 5 more');
    expect(prompt).not.toContain('Idea 44');
  });
});

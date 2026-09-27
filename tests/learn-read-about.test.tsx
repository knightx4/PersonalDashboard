/**
 * When "Find something to read for this" is drawn.
 *
 * A claim's own page offers it on every claim, whatever state the claim is in
 * (#1070); a subject's chain offers it only beside claims marked shaky or
 * wrong, so a long graph does not grow a button on every node. The action is
 * stubbed: what is checked here is only whether the form is drawn.
 */
import { describe, expect, it, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { KNOWLEDGE_STATES, type Concept, type KnowledgeState } from '@/lib/learn/graph/model';

vi.mock('@/app/learn/s/[id]/actions', () => ({ readAboutConcept: async () => {} }));

const { ReadAbout } = await import('@/app/learn/s/[id]/read-about');

const SUBJECT = '00000000-0000-4000-8000-000000000001';

function concept(state: KnowledgeState): Concept {
  return { id: '00000000-0000-4000-8000-000000000002', state } as Concept;
}

const LABEL = 'Find something to read for this';

describe('the read button on a claim', () => {
  it.each(KNOWLEDGE_STATES)('shows on the claim page for a claim that is %s', (state) => {
    const html = renderToStaticMarkup(
      <ReadAbout concept={concept(state)} subjectId={SUBJECT} anyState />,
    );
    expect(html).toContain(LABEL);
  });

  it.each(KNOWLEDGE_STATES)('on a subject chain, a claim that is %s', (state) => {
    const html = renderToStaticMarkup(<ReadAbout concept={concept(state)} subjectId={SUBJECT} />);
    const gated = state === 'shaky' || state === 'misconception';
    expect(html.includes(LABEL)).toBe(gated);
  });
});

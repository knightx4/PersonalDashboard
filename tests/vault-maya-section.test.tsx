/**
 * Maya on a note's page (plan #1285): the press before a thread exists, and
 * the link and the thought after.
 *
 * The runner has no DOM, so what is pinned is the markup.
 */
import { describe, expect, it, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';

vi.mock('@/app/vault/n/[...path]/actions', () => ({ askMaya: async () => ({}) }));

const { MayaSection } = await import('@/app/vault/n/[...path]/maya-section');
const { MAYA_NOTHING_TO_ADD } = await import('@/components/vault/maya-points');

const POINT = {
  kind: 'point' as const,
  rank: 1,
  claim: 'The commute costs more than the house saves.',
  argument: 'Your notes price the hours at nothing.',
  notes: [
    {
      noteId: 'n2',
      title: 'Time budget',
      quote: 'Ten hours a week in the car.',
      point: 'You counted it.',
    },
  ],
  sources: [
    {
      author: 'Robert Putnam',
      work: 'Bowling Alone',
      gist: 'Commuting eats civic life.',
      exactText: null,
    },
  ],
};

function thread(points: (typeof POINT)[], noteBlobSha = 'sha1') {
  return {
    id: 'thread-1',
    question: 'Is the commute worth the house?',
    latest: { points, synthesis: null, noteBlobSha, createdAt: '2026-09-30T10:00:00Z' },
    notePaths: { n2: 'Life/Time budget.md' },
  };
}

describe('MayaSection', () => {
  it('offers the press before any thread exists', () => {
    const html = renderToStaticMarkup(
      <MayaSection notePath="Ideas/Commute.md" noteBlobSha="sha1" thread={null} />,
    );
    expect(html).toContain('>Ask Maya<');
    expect(html).not.toContain('In Maya:');
  });

  it('links to the thread and shows the thought once one exists', () => {
    const html = renderToStaticMarkup(
      <MayaSection notePath="Ideas/Commute.md" noteBlobSha="sha1" thread={thread([POINT])} />,
    );
    expect(html).toContain('href="/vault/maya/thread-1"');
    expect(html).toContain('In Maya: Is the commute worth the house?');
    expect(html).toContain('The commute costs more than the house saves.');
    expect(html).toContain('href="/vault/n/Life/Time%20budget.md"');
    expect(html).toContain('<cite>Bowling Alone</cite>');
    expect(html).not.toContain('Ask Maya');
  });

  it('says plainly when Maya had nothing to add', () => {
    const html = renderToStaticMarkup(
      <MayaSection notePath="Ideas/Commute.md" noteBlobSha="sha1" thread={thread([])} />,
    );
    expect(html).toContain(MAYA_NOTHING_TO_ADD);
    expect(html).toContain('nothing to add');
  });

  it('offers to ask again once the note has changed', () => {
    const html = renderToStaticMarkup(
      <MayaSection
        notePath="Ideas/Commute.md"
        noteBlobSha="sha2"
        thread={thread([POINT], 'sha1')}
      />,
    );
    expect(html).toContain('The note has changed since Maya read it.');
    expect(html).toContain('Ask Maya again');
  });
});

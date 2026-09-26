/**
 * "You wrote about this" (plan #1113): drawn with notes, absent without.
 *
 * The runner has no DOM, so what is pinned is the markup: each note is a link
 * to its page, and an empty list or a missing one draws nothing at all, which
 * is the half of the done-when a reader cannot see.
 */
import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { RelatedNotes } from '@/components/vault/related-notes';

const notes = [
  { noteId: 'a', title: 'On energy', href: '/vault/n/Ideas/On%20energy.md' },
  { noteId: 'b', title: 'Affordable housing', href: '/vault/n/Housing.md' },
];

describe('RelatedNotes', () => {
  it('names each note as a link to its page', () => {
    const html = renderToStaticMarkup(<RelatedNotes notes={notes} />);
    expect(html).toContain('You wrote about this');
    expect(html).toContain('href="/vault/n/Ideas/On%20energy.md"');
    expect(html).toContain('>On energy<');
    expect(html).toContain('href="/vault/n/Housing.md"');
  });

  it('draws nothing when no note is close enough', () => {
    expect(renderToStaticMarkup(<RelatedNotes notes={[]} />)).toBe('');
    expect(renderToStaticMarkup(<RelatedNotes notes={null} />)).toBe('');
    expect(renderToStaticMarkup(<RelatedNotes notes={undefined} />)).toBe('');
  });

  it('draws nothing while a promise is pending, rather than a placeholder', () => {
    const pending = new Promise<typeof notes>(() => {});
    expect(renderToStaticMarkup(<RelatedNotes notes={pending} />)).not.toContain(
      'You wrote about this',
    );
  });
});

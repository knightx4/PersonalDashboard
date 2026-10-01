/**
 * Folding the note list away on a laptop (#1380).
 *
 * The runner has no DOM, so nothing can be pressed here. What is pinned is the
 * page at rest: the column drawn from `lg` up and named by both buttons, the
 * fold button beside the search box saying the list is shown, no unfold button
 * until something is folded, and neither button drawn below `lg`.
 */
import { describe, expect, it, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';

vi.mock('next/navigation', () => ({
  usePathname: () => '/vault/n/Money/Rent.md',
  useRouter: () => ({ push: () => {}, replace: () => {}, refresh: () => {} }),
  useSearchParams: () => new URLSearchParams(),
}));

const { NoteListFold, NoteListColumn, FoldNoteListButton, UnfoldNoteListButton, NOTE_LIST_ID } =
  await import('@/components/vault/note-list-fold');
const { VaultPanel } = await import('@/components/vault/vault-panel');

const GROUPS = [
  {
    folder: 'Money',
    notes: [
      {
        id: 'Money/Rent.md',
        path: 'Money/Rent.md',
        title: 'Rent',
        folder: 'Money',
        gitUpdatedAt: null,
        excerpt: '',
      },
    ],
  },
];

const html = renderToStaticMarkup(
  <NoteListFold>
    <NoteListColumn>
      <VaultPanel
        groups={GROUPS}
        currentPath="Money/Rent.md"
        search=""
        beside={<FoldNoteListButton />}
      />
    </NoteListColumn>
    <article>
      <UnfoldNoteListButton />
    </article>
  </NoteListFold>,
);

describe('the note list at rest', () => {
  it('is shown from lg up, under the id both buttons name', () => {
    expect(html).toContain(`<aside id="${NOTE_LIST_ID}"`);
    expect(html).toMatch(/<aside[^>]*class="[^"]*lg:block/);
    expect(html).toContain('data-folded="false"');
  });

  it('carries a fold button that says the list is shown', () => {
    expect(html).toContain('Hide the note list');
    expect(html).toContain('aria-expanded="true"');
    expect(html).toContain(`aria-controls="${NOTE_LIST_ID}"`);
  });

  it('draws the fold button only from lg up', () => {
    expect(html).toMatch(/<button[^>]*class="[^"]*\bhidden\b[^"]*lg:flex/);
  });

  it('has no unfold button until the list is folded', () => {
    expect(html).not.toContain('Show the note list');
  });

  it('keeps the search box in the column', () => {
    expect(html).toContain('Search your notes');
  });
});

describe('the controls outside their provider', () => {
  it('say what is missing rather than drawing a button that does nothing', () => {
    expect(() => renderToStaticMarkup(<FoldNoteListButton />)).toThrow(/NoteListFold/);
  });
});

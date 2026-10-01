/**
 * Folding the note list away on a laptop (#1380).
 *
 * The runner has no DOM, so nothing can be pressed here and no script runs.
 * What is pinned is the page as the server draws it, which is also the page
 * without JavaScript: the column shown from `lg` up under the id both buttons
 * name, unfolded whatever this browser stored (#1381), and no fold control at
 * all, since without the script it could not work.
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
  <NoteListFold notePath="Money/Rent.md">
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

  it('draws no fold button until the script has run', () => {
    expect(html).not.toContain('Hide the note list');
    expect(html).not.toContain(`aria-controls="${NOTE_LIST_ID}"`);
  });

  it('has no unfold button until the list is folded', () => {
    expect(html).not.toContain('Show the note list');
  });

  it('is drawn unfolded even where this browser stored a fold', () => {
    (globalThis as { window?: unknown }).window = {
      localStorage: { getItem: () => 'true', setItem: () => {} },
    };
    try {
      const stored = renderToStaticMarkup(
        <NoteListFold notePath="Money/Rent.md">
          <NoteListColumn>list</NoteListColumn>
          <UnfoldNoteListButton />
        </NoteListFold>,
      );
      expect(stored).toContain('data-folded="false"');
      expect(stored).toMatch(/<aside[^>]*class="[^"]*lg:block/);
      expect(stored).not.toContain('Show the note list');
    } finally {
      delete (globalThis as { window?: unknown }).window;
    }
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

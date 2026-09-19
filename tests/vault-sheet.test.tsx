/**
 * The vault over the note, below laptop width (#577).
 *
 * The runner has no DOM, so a sheet cannot be opened here and what is worth
 * pinning is what survives that: the trigger a note carries at rest, and the
 * rule that decides when the sheet gets out of the way. That rule is the part
 * that is easy to get wrong -- "close on any link" is the obvious spelling and
 * it closes the sheet when you clear the search inside it, which is the one
 * moment the reader has just asked to see more of the vault.
 */
import { describe, expect, it, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';

vi.mock('next/navigation', () => ({
  usePathname: () => '/vault/n/Money/Rent.md',
  useRouter: () => ({ push: () => {}, replace: () => {}, refresh: () => {} }),
  useSearchParams: () => new URLSearchParams(),
}));

const { VaultSheet, leavesThisNote } = await import('@/components/vault/vault-sheet');
const { VaultPanel } = await import('@/components/vault/vault-panel');

function note(path: string, title: string) {
  return {
    id: path,
    path,
    title,
    folder: path.includes('/') ? path.slice(0, path.lastIndexOf('/')) : '',
    gitUpdatedAt: null,
    excerpt: 'the first line of the body',
  };
}

const GROUPS = [
  { folder: '', notes: [note('Inbox.md', 'Inbox')] },
  { folder: 'Money', notes: [note('Money/Rent.md', 'Rent')] },
];

describe('the sheet at rest', () => {
  const html = renderToStaticMarkup(
    <VaultSheet groups={GROUPS} currentPath="Money/Rent.md" search="" />,
  );

  it('is a button on the note and nothing else, so a shut sheet costs nothing', () => {
    expect(html).toContain('Browse the vault');
    expect(html).toContain('aria-expanded="false"');
    // No panel, no scrim, and no second copy of the vault in the markup.
    expect(html).not.toContain('Vault root');
    expect(html).not.toContain('Close the vault');
  });

  it('stands down at the width the column takes over', () => {
    expect(html).toContain('lg:hidden');
  });
});

/**
 * The panel is the column's, unchanged -- that is the whole reason it is one
 * component. What matters is that the sheet cannot get a different one.
 */
describe('the panel both widths share', () => {
  function render(search: string, groups = GROUPS) {
    return renderToStaticMarkup(
      <VaultPanel groups={groups} currentPath="Money/Rent.md" search={search} />,
    );
  }

  it('carries the search box above the tree', () => {
    const html = render('');
    expect(html).toContain('Search your notes');
    expect(html).toContain('<details');
  });

  it('folds without JavaScript, the same as the column', () => {
    expect(render('')).not.toContain('onclick');
  });

  it('opens every folder once a search has narrowed it', () => {
    const open = render('rent')
      .split('<details')
      .slice(1)
      .map((body) => /^[^>]*\sopen(=|\s|>)/.test(body));
    expect(open).toEqual([true, true]);
  });

  it('says nothing matched instead of drawing an empty tree', () => {
    const html = render('risotto', []);
    expect(html).toContain('Nothing matched');
    expect(html).not.toContain('<details');
  });
});

describe('what closes the sheet', () => {
  const here = '/vault/n/Money/Rent.md';

  it('closes when another note is opened from it', () => {
    expect(leavesThisNote('/vault/n/Recipes/Soup.md', here)).toBe(true);
  });

  it('stays open when the cross clears the search', () => {
    expect(leavesThisNote(here, here)).toBe(false);
  });

  it('stays open while the search is only being changed', () => {
    expect(leavesThisNote(`${here}?q=soup`, here)).toBe(false);
  });

  it('ignores a link with no href at all', () => {
    expect(leavesThisNote(null, here)).toBe(false);
  });
});

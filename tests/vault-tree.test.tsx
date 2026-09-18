/**
 * The vault beside an open note.
 *
 * Three things are worth pinning, because all three are what #557's answer
 * actually asked for and none of them is obvious from the markup:
 *
 *  - every folder in the vault is there, not just the one you are reading in;
 *  - exactly one of them is open, and it is the one holding the note;
 *  - the folds are `<details>`, so they work on a page whose JavaScript has
 *    not arrived -- which is the whole reason this is not a `useState`.
 */
import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { VaultTree, type VaultFolderGroup } from '@/components/vault/vault-tree';

function note(path: string, title: string, excerpt = 'the first line of the body') {
  return {
    id: path,
    path,
    title,
    folder: path.includes('/') ? path.slice(0, path.lastIndexOf('/')) : '',
    gitUpdatedAt: null,
    excerpt,
  };
}

const GROUPS: VaultFolderGroup[] = [
  { folder: '', notes: [note('Inbox.md', 'Inbox')] },
  { folder: 'Money', notes: [note('Money/Rent.md', 'Rent'), note('Money/Tax.md', 'Tax')] },
  { folder: 'Recipes', notes: [note('Recipes/Soup.md', 'Soup')] },
];

/** One entry per `<details>`, in the order they render. */
function folders(html: string): Array<{ open: boolean; body: string }> {
  return html
    .split('<details')
    .slice(1)
    .map((body) => ({ open: /^[^>]*\sopen(=|\s|>)/.test(body), body }));
}

function render(currentPath: string): string {
  return renderToStaticMarkup(<VaultTree groups={GROUPS} currentPath={currentPath} />);
}

describe('the vault column', () => {
  it('lists every folder, however deep in the vault the note is', () => {
    const html = render('Money/Rent.md');
    expect(folders(html)).toHaveLength(3);
    expect(html).toContain('Vault root');
    expect(html).toContain('Money');
    expect(html).toContain('Recipes');
  });

  it('opens the folder the note is in and shuts the rest', () => {
    const open = folders(render('Money/Rent.md'));
    expect(open.map((folder) => folder.open)).toEqual([false, true, false]);
    // The open one is the one holding the note, not merely the second one.
    expect(open[1].body).toContain('Money');
  });

  it('counts the folder you are not in, so shut is still a choice', () => {
    const html = render('Money/Rent.md');
    expect(folders(html)[2].body).toContain('>1<');
  });

  it('treats a note at the vault root as its own folder', () => {
    expect(folders(render('Inbox.md')).map((folder) => folder.open)).toEqual([true, false, false]);
  });

  it('marks the note being read and nothing else', () => {
    const html = render('Money/Rent.md');
    const marked = html.match(/<a[^>]*aria-current="page"[^>]*>[^<]*/g) ?? [];
    expect(marked).toHaveLength(1);
    expect(marked[0]).toContain('Rent');
    expect(marked[0]).toContain('/vault/n/Money/Rent.md');
  });

  it('links every other note, so the next one is one click away', () => {
    const html = render('Money/Rent.md');
    expect(html).toContain('href="/vault/n/Recipes/Soup.md"');
    expect(html).toContain('href="/vault/n/Inbox.md"');
  });

  it('folds without JavaScript', () => {
    const html = render('Money/Rent.md');
    expect(html).toContain('<summary');
    expect(html).not.toContain('onclick');
  });

  it('carries titles and not the excerpts the note list shows', () => {
    expect(render('Money/Rent.md')).not.toContain('the first line of the body');
  });
});

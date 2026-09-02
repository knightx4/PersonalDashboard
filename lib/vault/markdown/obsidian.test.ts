import { describe, expect, it } from 'vitest';
import {
  buildLinkIndex,
  isAttachmentEmbed,
  parseWikiLink,
  toStandardMarkdown,
  wikiLinksIn,
} from '@/lib/vault/markdown/obsidian';

const index = buildLinkIndex([
  { path: 'Money/Rent.md', title: 'Rent' },
  { path: 'Daily/2024-01-01.md', title: '2024-01-01' },
  { path: 'Archive/Money/Rent.md', title: 'Rent' },
  { path: 'A Note With Spaces.md', title: 'A Note With Spaces' },
]);

const rewrite = (source: string) =>
  toStandardMarkdown(source, { index, hrefFor: (path) => `/vault/n/${path}` });

describe('parseWikiLink', () => {
  it('reads a plain link', () => {
    expect(parseWikiLink('Rent', false)).toEqual({
      target: 'Rent',
      label: 'Rent',
      anchor: null,
      embed: false,
    });
  });

  it('reads an alias', () => {
    expect(parseWikiLink('Rent|what I pay', false)).toMatchObject({
      target: 'Rent',
      label: 'what I pay',
    });
  });

  it('reads a heading anchor', () => {
    expect(parseWikiLink('Rent#The increase', false)).toMatchObject({
      target: 'Rent',
      anchor: 'The increase',
    });
  });

  it('reads both at once', () => {
    expect(parseWikiLink('Rent#Increase|the rise', false)).toMatchObject({
      target: 'Rent',
      anchor: 'Increase',
      label: 'the rise',
    });
  });

  it('handles a same-note heading link', () => {
    expect(parseWikiLink('#Later', false)).toMatchObject({ target: '', label: 'Later' });
  });
});

describe('buildLinkIndex', () => {
  it('resolves by basename, which is how people actually write links', () => {
    expect(rewrite('See [[Rent]].')).toBe('See [Rent](/vault/n/Money/Rent.md).');
  });

  it('prefers the shortest path when a basename is ambiguous', () => {
    // Money/Rent.md and Archive/Money/Rent.md both match. Picking the shorter
    // is the same answer Obsidian gives in the common case and a stable one
    // in the rest -- what matters is that it does not flip between renders.
    expect(rewrite('[[Rent]]')).toContain('/vault/n/Money/Rent.md');
  });

  it('accepts a full path, which is what a pasted link looks like', () => {
    expect(rewrite('[[Archive/Money/Rent]]')).toBe(
      '[Archive/Money/Rent](/vault/n/Archive/Money/Rent.md)',
    );
  });

  it('is case-insensitive', () => {
    expect(rewrite('[[rent]]')).toContain('/vault/n/Money/Rent.md');
  });

  it('handles spaces in note names', () => {
    expect(rewrite('[[A Note With Spaces]]')).toContain('/vault/n/A Note With Spaces.md');
  });
});

describe('unresolved links', () => {
  it('renders as plain text, not as a dead link', () => {
    // A link to a note that does not exist yet is how Obsidian is meant to be
    // used. It must not look like a rendering failure.
    expect(rewrite('See [[Not Written Yet]].')).toBe('See Not Written Yet.');
  });

  it('shows the alias rather than the missing target', () => {
    expect(rewrite('[[Missing|the thing I meant]]')).toBe('the thing I meant');
  });

  it('escapes a label that would otherwise become markdown', () => {
    // An unresolved link is emitted as bare text, so a stray bracket in the
    // alias would be read as markdown by the renderer that runs next.
    expect(rewrite('[[Missing|weird [ bracket]]')).toBe('weird \\[ bracket');
  });

  it('leaves a malformed wikilink alone rather than half-rewriting it', () => {
    // `]` cannot appear inside a wikilink, so this is not one.
    expect(rewrite('[[Missing|see [1](x)]]')).toBe('[[Missing|see [1](x)]]');
  });
});

describe('embeds', () => {
  it('says an attachment was not synced instead of rendering a broken image', () => {
    // The bytes were never fetched, by design. A broken image icon would
    // suggest a bug; this states the actual situation.
    expect(rewrite('![[holiday.png]]')).toBe('*(attachment not synced: holiday.png)*');
  });

  it('does the same for a PDF', () => {
    expect(rewrite('![[lease.pdf]]')).toContain('attachment not synced');
  });

  it('renders a note embed as a link rather than inlining it', () => {
    // Transclusion is a recursion problem and a viewer does not need it.
    expect(rewrite('![[Rent]]')).toBe('[Rent](/vault/n/Money/Rent.md)');
  });

  it('treats an extensionless embed as a note', () => {
    expect(isAttachmentEmbed(parseWikiLink('Rent', true))).toBe(false);
    expect(isAttachmentEmbed(parseWikiLink('holiday.png', true))).toBe(true);
  });
});

describe('resolved links', () => {
  it('escapes an alias that would break the generated link', () => {
    // The output is `[label](href)`, so parentheses in the label have to be
    // escaped or the href ends early and the rest leaks into the page.
    expect(rewrite('[[Rent|cost (monthly)]]')).toBe(
      '[cost \\(monthly\\)](/vault/n/Money/Rent.md)',
    );
  });
});

describe('anchors', () => {
  it('slugifies a heading into a fragment', () => {
    expect(rewrite('[[Rent#The Increase]]')).toBe(
      '[Rent#The Increase](/vault/n/Money/Rent.md#the-increase)',
    );
  });
});

describe('comments and callouts', () => {
  it('strips Obsidian comments entirely', () => {
    expect(rewrite('Before %%a private aside%% after.')).toBe('Before  after.');
  });

  it('strips a multi-line comment', () => {
    expect(rewrite('A\n%%\nhidden\nlines\n%%\nB')).toBe('A\n\nB');
  });

  it('turns a callout into a blockquote with its title', () => {
    expect(rewrite('> [!warning] Do not do this\n> body')).toBe(
      '> **Do not do this**\n> body',
    );
  });

  it('uses the callout type when it has no title', () => {
    expect(rewrite('> [!note]\n> body')).toBe('> **Note**\n> body');
  });

  it('keeps a foldable callout marker out of the output', () => {
    expect(rewrite('> [!tip]- Collapsed\n> body')).toBe('> **Collapsed**\n> body');
  });

  it('does not mistake a link inside a comment for a real one', () => {
    expect(wikiLinksIn('%%[[Rent]]%%')).toEqual([]);
  });
});

describe('wikiLinksIn', () => {
  it('finds every link, embeds included', () => {
    const links = wikiLinksIn('[[Rent]] and ![[chart.png]] and [[Daily/2024-01-01|today]]');
    expect(links.map((l) => l.target)).toEqual(['Rent', 'chart.png', 'Daily/2024-01-01']);
    expect(links[1].embed).toBe(true);
  });
});

describe('ordinary markdown', () => {
  it('is left alone', () => {
    const source = '# Heading\n\n- [x] done\n- [ ] not\n\n[a link](https://example.com)\n\n| a | b |\n|---|---|\n| 1 | 2 |';
    expect(rewrite(source)).toBe(source);
  });

  it('does not touch a single-bracket reference', () => {
    expect(rewrite('An [ordinary][ref] link.')).toBe('An [ordinary][ref] link.');
  });
});

import { describe, expect, it } from 'vitest';
import { essayNoteText, newEssayFrontmatter, rewriteEssayFile } from './note';
import { essaySnapshot, linksToEssay, publicLinks, unlinkEssay } from './publish';

const fm = { ...newEssayFrontmatter({ title: 'Money', slug: 'money', description: 'Why money is odd.', today: '2026-10-12' }), stage: 'seedling' as const };

const draft = [
  '# Money',
  '',
  'Walzer argues in [[Walzer - Spheres of Justice ch4]] that money is odd.[^1]',
  'See also [[Fairness essay|my essay on fairness]] and ![[diagram.png]].',
  'A [relative link](Notes/Private.md) and an ![image](attachments/x.png).',
  '%% a note to self %%',
  '',
  '[^1]: [Spheres of Justice](https://example.org/walzer#:~:text=money%20is) · example.org',
].join('\n');

const file = essayNoteText(fm, draft, {
  marks: [{ author: 'dash', from: 9, to: 20, name: 'Dash' }],
  self: 'Selvey',
});

describe('essaySnapshot (plan #1863.11, R4)', () => {
  const published = new Map([['fairness essay', 'fairness']]);
  const snapshot = essaySnapshot(file, { path: 'Essays/Money.md', today: '2026-10-13', published });

  it('starts from a note that has an authorship block', () => {
    expect(file).toContain('Annotations:');
  });

  it('removes the authorship block and the frontmatter', () => {
    expect(snapshot.body).not.toContain('Annotations:');
    expect(snapshot.body).not.toMatch(/^[@&*]/m);
    expect(snapshot.body).not.toContain('slug:');
  });

  it('removes the title line, which the site shows from its own field', () => {
    expect(snapshot.body.startsWith('Walzer argues')).toBe(true);
    expect(snapshot.title).toBe('Money');
  });

  it('turns a wikilink to a private note into its text', () => {
    expect(snapshot.body).toContain('Walzer argues in Walzer - Spheres of Justice ch4 that');
    expect(snapshot.body).not.toContain('[[');
  });

  it('links a wikilink to another published essay at its address', () => {
    expect(snapshot.body).toContain('[my essay on fairness](/writing/fairness)');
  });

  it('drops embeds, private links and images, and Obsidian comments', () => {
    expect(snapshot.body).not.toContain('diagram.png');
    expect(snapshot.body).toContain('A relative link and an .');
    expect(snapshot.body).not.toContain('Private.md');
    expect(snapshot.body).not.toContain('note to self');
  });

  it('keeps the footnotes with their web links', () => {
    expect(snapshot.body).toContain('money is odd.[^1]');
    expect(snapshot.body).toContain(
      '[^1]: [Spheres of Justice](https://example.org/walzer#:~:text=money%20is) · example.org',
    );
  });

  it('takes the fields the site shows from the frontmatter', () => {
    expect(snapshot).toMatchObject({ description: 'Why money is odd.', stage: 'seedling', confidence: null, tags: [] });
  });
});

describe('publicLinks', () => {
  it('reads a wikilink with a heading by its note name', () => {
    expect(publicLinks('[[Fairness essay#Part two]]', new Map([['fairness essay', 'fairness']]))).toBe(
      '[Fairness essay](/writing/fairness)',
    );
    expect(publicLinks('[[Private#Part two]]', new Map())).toBe('Private');
  });

  it('keeps web and mail links', () => {
    const text = '[a](https://a.example) [b](mailto:b@example.org) [c](#top)';
    expect(publicLinks(text, new Map())).toBe(text);
  });
});

describe('unlinkEssay', () => {
  it('turns the links to an unpublished essay back into text and leaves the rest', () => {
    const body = 'See [fairness](/writing/fairness) and [money](/writing/money).';
    expect(linksToEssay(body, 'fairness')).toBe(true);
    expect(unlinkEssay(body, 'fairness')).toBe('See fairness and [money](/writing/money).');
    expect(linksToEssay(body, 'other')).toBe(false);
  });
});

describe('rewriteEssayFile with published', () => {
  const raw = essayNoteText(fm, 'Some words.');

  it('marks the note published and sets the first date', () => {
    const next = rewriteEssayFile(raw, 'Some words.', { title: 'Money', published: '2026-10-13' }, fm);
    expect(next).toContain('publish: true');
    expect(next).toMatch(/^published: 2026-10-13$/m);
  });

  it('keeps a first date already there', () => {
    const once = rewriteEssayFile(raw, 'Some words.', { title: 'Money', published: '2026-10-13' }, fm);
    const again = rewriteEssayFile(once, 'Some words.', { title: 'Money', published: '2026-11-01' }, fm);
    expect(again).toMatch(/^published: 2026-10-13$/m);
  });
});

import { describe, expect, it } from 'vitest';
import { parseLevel3, wikitextFrom } from '@/lib/learn/areas/level3';

/**
 * The page is hand-edited, so these hold the parse to the shapes it actually
 * uses: counts in headings, icon templates before the link, piped links, and
 * links into other namespaces that are not articles.
 */
const PAGE = `{{Wikipedia:Vital articles/Header}}
Intro text with a [[Wikipedia:Vital articles|link]] that is not an article.

== People (100 articles) ==
=== Writers and journalists (10 articles) ===
# {{Icon|FA}} [[William Shakespeare]]
# {{Icon|GA}} [[Jane_Austen|Austen]] and a second [[Pride and Prejudice]]
=== Scientists ===
# [[Isaac Newton]]
# [[File:Newton.jpg]] [[Charles Darwin]]

== History (80 articles) ==
# [[History]]
* [[william Shakespeare]]
=== Ancient history ===
#[[Ancient Egypt#Old Kingdom|Egypt]]
`;

describe('parseLevel3', () => {
  const articles = parseLevel3(PAGE);

  it('reads the first article link on each list line, under its headings', () => {
    expect(articles).toEqual([
      { title: 'William Shakespeare', section: 'People > Writers and journalists' },
      { title: 'Jane Austen', section: 'People > Writers and journalists' },
      { title: 'Isaac Newton', section: 'People > Scientists' },
      { title: 'Charles Darwin', section: 'People > Scientists' },
      { title: 'History', section: 'History' },
      { title: 'Ancient Egypt', section: 'History > Ancient history' },
    ]);
  });

  it('closes a subsection when a higher heading opens', () => {
    const history = articles.find((a) => a.title === 'History');
    expect(history?.section).toBe('History');
  });

  it('keeps an article once, however it is capitalised the second time', () => {
    expect(articles.filter((a) => a.title === 'William Shakespeare')).toHaveLength(1);
  });

  it('ignores everything above the first section heading', () => {
    expect(articles.some((a) => a.title.startsWith('Wikipedia'))).toBe(false);
  });
});

describe('wikitextFrom', () => {
  it('reads the wikitext out of the parse answer', () => {
    expect(wikitextFrom(JSON.stringify({ parse: { wikitext: '== A ==' } }))).toBe('== A ==');
  });

  it('says null rather than guessing when it is missing or not JSON', () => {
    expect(wikitextFrom(JSON.stringify({ error: { code: 'missingtitle' } }))).toBeNull();
    expect(wikitextFrom('<html>')).toBeNull();
  });
});

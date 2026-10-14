import { describe, expect, it } from 'vitest';
import {
  cleanAliases,
  parseLevel4Index,
  parseLevel4Section,
  parseRedirects,
  rawPageUrl,
  redirectsUrl,
  resolveTitle,
  statedTotal,
  transcludedPages,
} from '@/lib/learn/areas/level4';

const INDEX = `{{Wikipedia:Vital articles/Level/Nav bar}}
[[Wikipedia:Vital articles/Level/3|Level 3]] (1,000 articles) < [[Wikipedia:Vital articles/Level/4|Level 4]]
| [[Wikipedia:Vital articles/Level 4/People|People]] || 1,928 || 1,925
| [[Wikipedia:Vital articles/Level 4/Philosophy and religion|Philosophy and religion]] || 443 || 450
| [[Wikipedia:Vital articles/Level 4/People/Writers|Writers]] || 1 || 1
| [[Wikipedia:Vital articles/Level 4/People|People again]]
[[Category:Wikipedia level-4 vital articles|*]]`;

const SECTION = `<noinclude>{{Wikipedia:Vital articles/Level/Nav bar/4}}
Total 3 articles.
# [[Not an article]] above every heading
</noinclude>
=People=
{{Vital article count|3}}
==Writers==
===Ancient===
# {{Icon|C}} [[Homer]]<!--born-->
# {{Icon|B}} [[sappho|Sappho of Lesbos]]
===Modern===
# {{Icon|GA}} [[Homer]]
# {{Icon|FA}} [[Wikipedia:Not one]] [[Jane_Austen]]
{{Wikipedia:Vital articles/Level 4/People/Sports figures}}
{{:Wikipedia:Vital articles/Level 4/People/Miscellaneous}}`;

describe('the Level 4 index', () => {
  it('names each section page once, with its label, and skips subpages and other levels', () => {
    expect(parseLevel4Index(INDEX)).toEqual([
      { page: 'Wikipedia:Vital articles/Level 4/People', name: 'People' },
      { page: 'Wikipedia:Vital articles/Level 4/Philosophy and religion', name: 'Philosophy and religion' },
    ]);
  });
});

describe('a Level 4 section page', () => {
  it('reads each article once under the section name and its headings', () => {
    expect(parseLevel4Section(SECTION, 'People')).toEqual([
      { title: 'Homer', section: 'People > Writers > Ancient' },
      { title: 'Sappho', section: 'People > Writers > Ancient' },
      { title: 'Jane Austen', section: 'People > Writers > Modern' },
    ]);
  });

  it('finds the subpages it pulls in, and not the navigation templates', () => {
    expect(transcludedPages(SECTION)).toEqual([
      'Wikipedia:Vital articles/Level 4/People/Sports figures',
      'Wikipedia:Vital articles/Level 4/People/Miscellaneous',
    ]);
  });

  it('reads the total the page states', () => {
    expect(statedTotal('Total 1,926 articles.')).toBe(1926);
    expect(statedTotal('no total here')).toBeNull();
  });
});

describe('other names', () => {
  it('keeps real other names and drops section redirects and spelling variants', () => {
    expect(
      cleanAliases('Leveraged buyout', [
        { title: 'LBO' },
        { title: 'Leveraged buy-out' },
        { title: 'Leveraged Buyout' },
        { title: 'Bootstrap transaction' },
        { title: 'LBO valuation', fragment: 'Valuation' },
        { title: 'lbo' },
        { title: 'Leveraged buyout/Introduction' },
        { title: 'ISO 4217:LBO' },
        { title: 'Buyouts: leveraged' },
      ]),
    ).toEqual(['LBO', 'Buyouts: leveraged', 'Bootstrap transaction']);
  });

  it('reads an answer, its renames and where it continues', () => {
    const answer = parseRedirects(
      JSON.stringify({
        continue: { rdcontinue: '58834|1212796' },
        query: {
          normalized: [{ from: 'Leveraged_buyout', to: 'Leveraged buyout' }],
          redirects: [{ from: 'Old name', to: 'Sarcomere' }],
          pages: [
            { title: 'Leveraged buyout', redirects: [{ title: 'LBO' }, { title: 'Buyout#Leveraged', fragment: 'Leveraged' }] },
            { title: 'Sarcomere' },
          ],
        },
      }),
    );
    expect(answer).not.toBeNull();
    expect(answer!.next).toBe('58834|1212796');
    expect(answer!.byTitle.get('Leveraged buyout')).toEqual([
      { title: 'LBO' },
      { title: 'Buyout#Leveraged', fragment: 'Leveraged' },
    ]);
    expect(answer!.byTitle.get('Sarcomere')).toEqual([]);
    expect(resolveTitle('Old name', answer!.renamed)).toBe('Sarcomere');
    expect(resolveTitle('Leveraged_buyout', answer!.renamed)).toBe('Leveraged buyout');
  });

  it('refuses an error or something that is not JSON', () => {
    expect(parseRedirects('You are making too many requests')).toBeNull();
    expect(parseRedirects(JSON.stringify({ error: { code: 'maxlag' } }))).toBeNull();
  });
});

describe('the addresses', () => {
  it('asks for raw wikitext and for redirects politely', () => {
    expect(rawPageUrl('Wikipedia:Vital articles/Level 4/People')).toBe(
      'https://en.wikipedia.org/w/index.php?title=Wikipedia%3AVital_articles%2FLevel_4%2FPeople&action=raw',
    );
    const url = new URL(redirectsUrl(['A', 'B'], '1|2'));
    expect(url.searchParams.get('titles')).toBe('A|B');
    expect(url.searchParams.get('rdcontinue')).toBe('1|2');
    expect(url.searchParams.get('maxlag')).toBe('5');
    expect(url.searchParams.get('rdnamespace')).toBe('0');
  });
});

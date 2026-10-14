import { describe, expect, it } from 'vitest';
import { fetchAliases, fetchLevel4 } from '@/lib/learn/areas/topic-import';

const SECTIONS = [
  'People',
  'History',
  'Geography',
  'Arts',
  'Philosophy and religion',
  'Everyday life',
  'Society and social sciences',
  'Biology and health sciences',
  'Physical sciences',
  'Technology',
  'Mathematics',
];

const index = SECTIONS.map((name) => `| [[Wikipedia:Vital articles/Level 4/${name}|${name}]] || 900`).join('\n');

function sectionPage(name: string, count: number, extra = ''): string {
  const lines = Array.from({ length: count }, (_, i) => `# [[${name} topic ${i}]]`);
  return `Total ${count} articles.\n=${name}=\n==General==\n${lines.join('\n')}\n${extra}`;
}

function getter(pages: Record<string, string>) {
  const asked: string[] = [];
  const get = async (url: string) => {
    asked.push(url);
    const title = new URL(url).searchParams.get('title')?.replace(/_/g, ' ') ?? '';
    const page = pages[title];
    if (page === undefined) throw new Error(`no fixture for ${title}`);
    return page;
  };
  return { get, asked };
}

describe('fetchLevel4', () => {
  it('reads every section and the subpages one pulls in, each article once', async () => {
    const pages: Record<string, string> = { 'Wikipedia:Vital articles/Level 4': index };
    for (const name of SECTIONS) pages[`Wikipedia:Vital articles/Level 4/${name}`] = sectionPage(name, 850);
    // People keeps half its list on a subpage, and repeats one article there.
    pages['Wikipedia:Vital articles/Level 4/People'] = `Total 900 articles.\n=People=\n==Writers==\n# [[Homer]]\n{{Wikipedia:Vital articles/Level 4/People/Writers}}`;
    pages['Wikipedia:Vital articles/Level 4/People/Writers'] =
      `==Writers==\n# [[Homer]]\n${Array.from({ length: 899 }, (_, i) => `# [[Writer ${i}]]`).join('\n')}`;

    const { get } = getter(pages);
    const articles = await fetchLevel4(get);
    expect(articles).toHaveLength(10 * 850 + 900);
    expect(articles.filter((a) => a.title === 'Homer')).toEqual([{ title: 'Homer', section: 'People > Writers' }]);
    expect(articles).toContainEqual({ title: 'Writer 0', section: 'People > Writers' });
  });

  it('refuses a section that parses far short of the total it states', async () => {
    const pages: Record<string, string> = { 'Wikipedia:Vital articles/Level 4': index };
    for (const name of SECTIONS) pages[`Wikipedia:Vital articles/Level 4/${name}`] = sectionPage(name, 900);
    pages['Wikipedia:Vital articles/Level 4/Arts'] = sectionPage('Arts', 10).replace('Total 10', 'Total 700');
    const { get } = getter(pages);
    await expect(fetchLevel4(get)).rejects.toThrow(/Arts parsed to 10/);
  });

  it('refuses an index that does not name eleven sections', async () => {
    const { get } = getter({ 'Wikipedia:Vital articles/Level 4': '[[Wikipedia:Vital articles/Level 4/People|People]]' });
    await expect(fetchLevel4(get)).rejects.toThrow(/named 1 sections/);
  });
});

describe('fetchAliases', () => {
  it('follows the continuation and maps each title as given to its names', async () => {
    const answers = [
      {
        continue: { rdcontinue: 'next' },
        query: {
          redirects: [{ from: 'Buyout with leverage', to: 'Leveraged buyout' }],
          pages: [{ title: 'Leveraged buyout', redirects: [{ title: 'LBO' }] }, { title: 'Sarcomere' }],
        },
      },
      {
        query: {
          pages: [
            { title: 'Leveraged buyout', redirects: [{ title: 'Bootstrap transaction' }] },
            { title: 'Sarcomere', redirects: [{ title: 'Sarcomeres' }, { title: 'Z line', fragment: 'Z' }] },
          ],
        },
      },
    ];
    const asked: string[] = [];
    const get = async (url: string) => {
      asked.push(url);
      return JSON.stringify(answers[asked.length - 1]);
    };

    const names = await fetchAliases(get, ['Buyout with leverage', 'Sarcomere']);
    expect(asked).toHaveLength(2);
    expect(new URL(asked[1]).searchParams.get('rdcontinue')).toBe('next');
    // Listed under an old name: the article's own title is one of its names.
    expect(names.get('Buyout with leverage')).toEqual(['LBO', 'Leveraged buyout', 'Bootstrap transaction']);
    expect(names.get('Sarcomere')).toEqual(['Sarcomeres']);
  });

  it('fails on an answer that is not one rather than storing nothing', async () => {
    await expect(fetchAliases(async () => 'Too many requests', ['A'])).rejects.toThrow(/not one/);
  });
});

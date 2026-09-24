import { describe, expect, it } from 'vitest';
import {
  alreadyReceived,
  groupPicks,
  indexSenders,
  readPicks,
  topicsFor,
  MAX_PER_TOPIC,
  type NewsletterPick,
} from './picks';

const pick = (over: Partial<NewsletterPick> = {}): NewsletterPick => ({
  name: 'Quanta Weekly',
  publisher: 'Quanta Magazine',
  topic: 'Science',
  reason: 'A weekly round of maths and physics stories.',
  link: 'https://www.quantamagazine.org/newsletter/',
  ...over,
});

describe('topics a list is made for', () => {
  it('leaves out Other, and Local unless a place is set', () => {
    expect(topicsFor(null)).not.toContain('Other');
    expect(topicsFor(null)).not.toContain('Local');
    expect(topicsFor('Leeds')).toContain('Local');
    expect(topicsFor('Leeds')).toHaveLength(12);
  });
});

describe('reading picks', () => {
  it('drops a pick with no link, a link that is not http(s), or no reason', () => {
    const picks = readPicks([
      pick({ name: 'No link', link: '' }),
      { ...pick({ name: 'Missing link' }), link: undefined },
      pick({ name: 'Script', link: 'javascript:alert(1)' }),
      pick({ name: 'No reason', reason: ' ' }),
      pick(),
    ]);
    expect(picks.map((p) => p.name)).toEqual(['Quanta Weekly']);
  });

  it('drops a topic that is not asked for, and reads a listed one in any case', () => {
    const picks = readPicks(
      [
        pick({ name: 'A', topic: 'other' as never, link: 'https://a.example/' }),
        pick({ name: 'B', topic: 'Local', link: 'https://b.example/' }),
        pick({ name: 'C', topic: 'Gardening' as never, link: 'https://c.example/' }),
        pick({ name: 'D', topic: ' science ' as never, link: 'https://d.example/' }),
      ],
      topicsFor(null),
    );
    expect(picks.map((p) => [p.name, p.topic])).toEqual([['D', 'Science']]);
  });

  it('keeps at most four a topic and no repeats, in topic order', () => {
    const many = Array.from({ length: 6 }, (_, i) =>
      pick({ name: `Science ${i}`, link: `https://s${i}.example/` }),
    );
    const picks = readPicks([
      pick({ name: 'Brief', topic: 'Politics', link: 'https://p.example/' }),
      ...many,
      pick({ name: 'Science 0', link: 'https://other.example/' }),
    ]);
    expect(picks.filter((p) => p.topic === 'Science')).toHaveLength(MAX_PER_TOPIC);
    expect(picks[0].topic).toBe('Politics');
  });

  it('fills a missing publisher with the name', () => {
    const [read] = readPicks([{ ...pick(), publisher: undefined }]);
    expect(read.publisher).toBe('Quanta Weekly');
  });

  it('reads anything but an array as no picks', () => {
    expect(readPicks(null)).toEqual([]);
    expect(readPicks({ picks: [pick()] })).toEqual([]);
  });

  it('groups picks by topic in the order of the topic list', () => {
    const groups = groupPicks([
      pick({ name: 'S', topic: 'Science' }),
      pick({ name: 'P', topic: 'Politics' }),
      pick({ name: 'S2', topic: 'Science' }),
    ]);
    expect(groups.map((g) => [g.topic, g.picks.map((p) => p.name)])).toEqual([
      ['Politics', ['P']],
      ['Science', ['S', 'S2']],
    ]);
  });
});

describe('a newsletter you already receive', () => {
  const index = indexSenders([
    { email: 'newsletters@email.quantamagazine.org', name: null },
    { email: 'moneystuff@substack.com', name: 'Money Stuff from Bloomberg Opinion' },
    { email: 'hello@news.bbc.co.uk', name: 'The Daily Brief' },
  ]);

  it('is matched by the domain it comes from', () => {
    expect(alreadyReceived(pick(), index)).toBe(true);
    expect(alreadyReceived(pick({ link: 'https://www.bbc.co.uk/newsletters' }), index)).toBe(true);
  });

  it('is matched on a shared host by its own name there, not the host', () => {
    expect(alreadyReceived(pick({ link: 'https://moneystuff.substack.com/' }), index)).toBe(true);
    expect(
      alreadyReceived(pick({ name: 'Other', link: 'https://someoneelse.substack.com/' }), index),
    ).toBe(false);
  });

  it('is matched by name, as whole words inside a longer sender name', () => {
    expect(alreadyReceived(pick({ name: 'Daily Brief', link: 'https://x.example/' }), index)).toBe(
      true,
    );
    expect(alreadyReceived(pick({ name: 'Money Stuff', link: 'https://y.example/' }), index)).toBe(
      true,
    );
    expect(alreadyReceived(pick({ name: 'Money', link: 'https://z.example/' }), index)).toBe(false);
  });
});

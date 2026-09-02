import { describe, expect, it } from 'vitest';
import type { Requirement } from '../jd/requirements';
import { MAX_SHORTLIST, scoreItem, shortlistEvidence, tokenize, type ShortlistItem } from './shortlist';

function item(overrides: Partial<ShortlistItem> & { id: string }): ShortlistItem {
  return {
    title: '',
    body: '',
    context: null,
    metrics: null,
    skills: [],
    strength: 3,
    ...overrides,
  };
}

const must = (text: string): Requirement => ({ text, kind: 'must_have' });

describe('tokenize', () => {
  it('drops the words every JD and every story share', () => {
    expect([...tokenize('Ability to work with the team')]).toEqual([]);
  });

  it('folds plurals onto the singular', () => {
    expect([...tokenize('stakeholders')]).toEqual([...tokenize('stakeholder')]);
    expect([...tokenize('dependencies')]).toEqual(['dependency']);
  });

  it('keeps the tokens a technical requirement turns on', () => {
    expect([...tokenize('SQL and C++ modelling')]).toContain('sql');
    expect([...tokenize('SQL and C++ modelling')]).toContain('c++');
  });
});

describe('scoreItem', () => {
  it('ranks a tag above a title mention above a body mention', () => {
    const tagged = item({ id: 'a', skills: ['forecasting'] });
    const titled = item({ id: 'b', title: 'Forecasting rebuild' });
    const buried = item({ id: 'c', body: 'Somewhere in here I did forecasting work.' });

    const requirement = 'Forecasting';
    expect(scoreItem(requirement, tagged)).toBeGreaterThan(scoreItem(requirement, titled));
    expect(scoreItem(requirement, titled)).toBeGreaterThan(scoreItem(requirement, buried));
  });

  it('does not let strength outrank relevance', () => {
    const relevant = item({ id: 'a', title: 'Forecasting rebuild', strength: 1 });
    const impressive = item({ id: 'b', title: 'Sold the company', strength: 5 });
    expect(scoreItem('Forecasting', relevant)).toBeGreaterThan(scoreItem('Forecasting', impressive));
  });

  it('breaks a tie on strength', () => {
    const weak = item({ id: 'a', title: 'Forecasting rebuild', strength: 2 });
    const strong = item({ id: 'b', title: 'Forecasting rebuild', strength: 5 });
    expect(scoreItem('Forecasting', strong)).toBeGreaterThan(scoreItem('Forecasting', weak));
  });

  it('scores nothing for a requirement with no content words', () => {
    expect(scoreItem('Ability to work with the team', item({ id: 'a', title: 'Anything' }))).toBe(0);
  });
});

describe('shortlistEvidence', () => {
  it('keeps the item that answers a line nothing else touches', () => {
    const bank = [
      item({ id: 'niche', title: 'German localisation', skills: ['localization'] }),
      ...Array.from({ length: 10 }, (_, i) =>
        item({ id: `sql-${i}`, title: 'SQL reporting', skills: ['sql'] }),
      ),
    ];
    const shortlist = shortlistEvidence([must('SQL'), must('German localisation')], bank);
    expect(shortlist.map((entry) => entry.id)).toContain('niche');
  });

  it('orders by how many lines an item answers', () => {
    const broad = item({ id: 'broad', skills: ['sql', 'forecasting'] });
    const narrow = item({ id: 'narrow', skills: ['sql'] });
    const shortlist = shortlistEvidence([must('SQL'), must('Forecasting')], [narrow, broad]);
    expect(shortlist[0].id).toBe('broad');
  });

  it('caps the union so the call stays bounded', () => {
    const bank = Array.from({ length: 200 }, (_, i) =>
      item({ id: `e-${i}`, title: `SQL reporting ${i}`, skills: ['sql'] }),
    );
    const requirements = Array.from({ length: 30 }, (_, i) => must(`SQL pipeline ${i}`));
    expect(shortlistEvidence(requirements, bank).length).toBeLessThanOrEqual(MAX_SHORTLIST);
  });

  it('falls back to the strongest items when nothing matches lexically', () => {
    const bank = [
      item({ id: 'weak', title: 'Ran the offsite', strength: 1 }),
      item({ id: 'strong', title: 'Rebuilt the close', strength: 5 }),
    ];
    const shortlist = shortlistEvidence([must('Kubernetes administration')], bank);
    expect(shortlist[0].id).toBe('strong');
    expect(shortlist).toHaveLength(2);
  });

  it('is empty when there is no bank or no requirements', () => {
    expect(shortlistEvidence([must('SQL')], [])).toEqual([]);
    expect(shortlistEvidence([], [item({ id: 'a', title: 'SQL' })])).toEqual([]);
  });
});

import { describe, expect, it } from 'vitest';
import { parseNote } from '@/lib/vault/markdown/note';
import {
  buildEssayFrontmatter,
  atLeastStage,
  essayDay,
  essayNoteBody,
  essayNoteText,
  essaySlug,
  newEssayFrontmatter,
  readEssayFrontmatter,
  rewriteEssayFile,
  uniqueSlug,
} from './note';

const FM = newEssayFrontmatter({
  title: 'Why money is the odd good out',
  slug: 'money-odd-good-out',
  description: 'Money holds its value only because\nit can become every other good.',
  today: '2026-10-12',
});

const DRAFT = '# Why money is the odd good out\n\nEvery good you buy wears out.';

describe('buildEssayFrontmatter', () => {
  it('writes the fields the spec lists, in its order', () => {
    expect(buildEssayFrontmatter(FM)).toBe(
      [
        '---',
        'title: "Why money is the odd good out"',
        'type: essay',
        'stage: draft',
        'publish: false',
        'slug: money-odd-good-out',
        'description: "Money holds its value only because it can become every other good."',
        'created: 2026-10-12',
        'updated: 2026-10-12',
        'published:',
        'tags: []',
        'sources: []',
        '---',
        '',
      ].join('\n'),
    );
  });

  it('quotes wikilinks and awkward titles so the YAML stays valid', () => {
    const fm = {
      ...FM,
      title: 'Rent: "fair" or #not?',
      confidence: 'likely' as const,
      tags: ['economics'],
      sources: ['[[Walzer - Spheres of Justice ch4]]', 'https://example.com/a'],
      published: '2026-10-20',
    };
    const parsed = parseNote(essayNoteText(fm, DRAFT), 'Essays/x.md');
    expect(readEssayFrontmatter(parsed.frontmatter, { title: 'x', today: '2026-10-12' })).toEqual(fm);
  });
});

describe('essayNoteText', () => {
  it('reads back as an essay with the body the editor holds', () => {
    const parsed = parseNote(essayNoteText(FM, DRAFT), 'Essays/Why money is the odd good out.md');
    expect(parsed.title).toBe('Why money is the odd good out');
    expect(parsed.body).toBe(`${DRAFT}\n`);
    expect(readEssayFrontmatter(parsed.frontmatter, { title: 'x', today: '2026-10-12' })).toEqual(FM);
  });
});

describe('essayNoteBody', () => {
  it('drops leading blank lines and trailing space, ending in one newline', () => {
    expect(essayNoteBody('\n\n# T\n\nText  \n\n')).toBe('# T\n\nText\n');
    expect(essayNoteBody('  \n \n')).toBe('');
  });
});

describe('rewriteEssayFile', () => {
  it('rewrites only title and updated, keeping every other line', () => {
    const raw = essayNoteText({ ...FM, tags: ['economics'], confidence: 'possible' }, DRAFT).replace(
      'tags: ["economics"]',
      'tags:\n  - economics\n  - money',
    );
    const next = rewriteEssayFile(raw, '# Money, again\n\nNew text.', { title: 'Money, again', updated: '2026-10-14' }, FM);
    expect(next).toContain('title: "Money, again"\n');
    expect(next).toContain('updated: 2026-10-14\n');
    expect(next).toContain('created: 2026-10-12\n');
    expect(next).toContain('tags:\n  - economics\n  - money\n');
    expect(next).toContain('confidence: possible\n');
    expect(next.endsWith('---\n\n# Money, again\n\nNew text.\n')).toBe(true);
    const parsed = parseNote(next, 'Essays/x.md');
    expect(parsed.frontmatter.type).toBe('essay');
    expect(parsed.body).toBe('# Money, again\n\nNew text.\n');
  });

  it('adds title and updated when the block lacks them', () => {
    const next = rewriteEssayFile('---\ntype: essay\n---\nOld', 'New', { title: 'T', updated: '2026-10-14' }, FM);
    expect(next).toBe('---\ntype: essay\ntitle: "T"\nupdated: 2026-10-14\n---\n\nNew\n');
  });

  it('gives a file with no frontmatter a fresh block', () => {
    const next = rewriteEssayFile('Just text', 'New', { title: 'T', updated: '2026-10-14' }, FM);
    const fm = readEssayFrontmatter(parseNote(next, 'Essays/T.md').frontmatter, { title: 'x', today: 'x' });
    expect(fm).toMatchObject({ title: 'T', updated: '2026-10-14', created: '2026-10-12', slug: 'money-odd-good-out' });
  });

  it('keeps CRLF line endings', () => {
    const raw = essayNoteText(FM, DRAFT).replace(/\n/g, '\r\n');
    const next = rewriteEssayFile(raw, 'New', { title: 'T', updated: '2026-10-14' }, FM);
    expect(next.replace(/\r\n/g, '')).not.toContain('\n');
  });
});

describe('the stage Finish sets (plan #1873)', () => {
  it('never lowers a stage', () => {
    expect(atLeastStage('draft', 'seedling')).toBe('seedling');
    expect(atLeastStage('budding', 'seedling')).toBe('budding');
    expect(atLeastStage(undefined, 'seedling')).toBe('seedling');
    expect(atLeastStage('mulch', 'seedling')).toBe('seedling');
  });

  it('raises a draft note to seedling and keeps a later stage', () => {
    const raw = essayNoteText(FM, DRAFT);
    const raised = rewriteEssayFile(raw, DRAFT, { title: FM.title, stage: 'seedling' }, FM);
    expect(raised).toContain('stage: seedling\n');
    expect(rewriteEssayFile(raised, DRAFT, { title: FM.title, stage: 'seedling' }, FM)).toBe(raised);
    const budding = raw.replace('stage: draft', 'stage: budding');
    expect(rewriteEssayFile(budding, DRAFT, { title: FM.title, stage: 'seedling' }, FM)).toContain('stage: budding\n');
  });

  it('gives a file with no frontmatter the stage', () => {
    const next = rewriteEssayFile('Just text', 'New', { title: 'T', stage: 'seedling' }, FM);
    expect(next).toContain('stage: seedling\n');
  });
});

describe('readEssayFrontmatter', () => {
  it('is null for a note that is not an essay', () => {
    expect(readEssayFrontmatter({ type: 'note' }, { title: 'x', today: '2026-10-12' })).toBeNull();
  });

  it('fills what is missing or malformed with a new essay’s defaults', () => {
    expect(
      readEssayFrontmatter(
        { type: 'essay', stage: 'ripe', created: new Date('2026-09-01'), tags: 'economics', confidence: 'sure' },
        { title: 'Fallback', today: '2026-10-12' },
      ),
    ).toEqual({
      title: 'Fallback',
      type: 'essay',
      stage: 'draft',
      publish: false,
      slug: '',
      description: '',
      created: '2026-09-01',
      updated: '2026-09-01',
      published: null,
      tags: ['economics'],
      confidence: null,
      sources: [],
    });
  });
});

describe('essaySlug', () => {
  it('drops small words, as the spec’s example does', () => {
    expect(essaySlug('Why money is the odd good out')).toBe('money-odd-good-out');
  });

  it('folds accents and apostrophes and cuts at a word', () => {
    expect(essaySlug('Café owners’ pricing')).toBe('cafe-owners-pricing');
    const long = essaySlug('Elasticity explains why petrol taxes raise money and restaurant taxes raise complaints');
    expect(long.length).toBeLessThanOrEqual(60);
    expect(long.endsWith('-')).toBe(false);
  });

  it('keeps the small words when they are all there is, and falls back to essay', () => {
    expect(essaySlug('What is it?')).toBe('what-is-it');
    expect(essaySlug('???')).toBe('essay');
  });

  it('numbers a slug the person already has', () => {
    expect(uniqueSlug('money', new Set())).toBe('money');
    expect(uniqueSlug('money', new Set(['money', 'money-2']))).toBe('money-3');
  });
});

describe('essayDay', () => {
  it('is the date in the time zone given, and UTC for one it does not know', () => {
    const late = new Date('2026-10-12T23:30:00Z');
    expect(essayDay(late, 'Europe/London')).toBe('2026-10-13');
    expect(essayDay(late, 'Not/AZone')).toBe('2026-10-12');
    expect(essayDay(late, null)).toBe('2026-10-12');
  });
});

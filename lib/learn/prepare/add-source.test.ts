import { describe, expect, it } from 'vitest';
import { addedLine, ocwCourseUrl, readerFor, readSourceAsk, webDocument, webExternalId, webSections } from './add-source';

describe('readSourceAsk', () => {
  it('reads an address, adding https and dropping the fragment', () => {
    expect(readSourceAsk('https://oyc.yale.edu/history/hist-116#top')).toEqual({ kind: 'url', url: 'https://oyc.yale.edu/history/hist-116' });
    expect(readSourceAsk('http://example.org/a')).toEqual({ kind: 'url', url: 'https://example.org/a' });
    expect(readSourceAsk('ocw.mit.edu/courses/x')).toEqual({ kind: 'url', url: 'https://ocw.mit.edu/courses/x' });
  });

  it('reads anything with a space, or no host, as a phrase', () => {
    expect(readSourceAsk('  bee   biology ')).toEqual({ kind: 'phrase', phrase: 'bee biology' });
    expect(readSourceAsk('beekeeping')).toEqual({ kind: 'phrase', phrase: 'beekeeping' });
  });

  it('refuses an empty box', () => {
    expect(readSourceAsk('   ').kind).toBe('error');
  });
});

describe('readerFor', () => {
  const none = { yale: () => false, openstax: () => false, arxiv: () => false, explainer: () => false, practical: () => false };

  it('sends an OCW course page to the OCW reader, trimmed to the course', () => {
    expect(readerFor('https://ocw.mit.edu/courses/15-401-finance-fall-2008/pages/syllabus/', none)).toBe('ocw');
    expect(ocwCourseUrl('https://ocw.mit.edu/courses/15-401-finance-fall-2008/pages/syllabus/')).toBe(
      'https://ocw.mit.edu/courses/15-401-finance-fall-2008/',
    );
  });

  it('uses a known reader before the plain page reader', () => {
    expect(readerFor('https://arxiv.org/abs/2301.00001', { ...none, arxiv: () => true })).toBe('arxiv');
    expect(readerFor('https://example.org/guide', none)).toBe('web');
  });
});

const PAGE = `<html><head><title>Site | Guide</title></head><body>
<nav><h2>Menu</h2><h2>Shop</h2></nav>
<main><h1>A guide to hives</h1>
<h2>1. Choosing a hive</h2><h3>Langstroth</h3><h3>Top bar</h3>
<p>Text &amp; more.</p>
<h2>Inspections</h2><h3>Brood</h3>
<h2>Inspections</h2>
</main><footer><h2>Contact</h2></footer></body></html>`;

describe('webSections', () => {
  it('reads the h2s inside main as sections with their h3s, ignoring the nav and footer', () => {
    const page = webSections(PAGE);
    expect(page.title).toBe('A guide to hives');
    expect(page.sections).toEqual([
      { heading: '1. Choosing a hive', topics: ['Langstroth', 'Top bar'] },
      { heading: 'Inspections', topics: ['Brood'] },
    ]);
    expect(page.text).toContain('Text & more.');
  });

  it('falls back to h3s when the page has fewer than two h2s', () => {
    const page = webSections('<h1>T</h1><h2>Only</h2><h3>One</h3><h4>a</h4><h3>Two</h3>');
    expect(page.sections.map((s) => s.heading)).toEqual(['One', 'Two']);
    expect(page.sections[0].topics).toEqual(['a']);
  });
});

describe('webDocument', () => {
  it('keeps the page as an outline only, keyed on its address', () => {
    const doc = webDocument('https://www.example.org/hives/', PAGE);
    expect(doc.ok).toBe(true);
    if (!doc.ok) return;
    expect(doc.document).toMatchObject({
      providerSlug: 'web',
      externalId: 'www.example.org/hives',
      licenceMode: 'structure_only',
      title: 'A guide to hives',
      institution: 'example.org',
    });
    expect(doc.document.units).toHaveLength(2);
  });

  it('refuses a page with no sections', () => {
    expect(webDocument('https://example.org/', '<h1>Hi</h1><p>Text</p>').ok).toBe(false);
  });

  it('keys one page once whatever its fragment', () => {
    expect(webExternalId('https://example.org/a/?q=1#x')).toBe('example.org/a/?q=1');
  });
});

describe('addedLine', () => {
  it('says what was stored, its licence and whether its weeks joined', () => {
    expect(addedLine({ title: 'Guide', licence: 'Outline only', units: 1, weeksJoined: true, unchanged: false })).toBe(
      'Guide is in the bank, 1 unit, outline only. Its weeks joined the matched weeks.',
    );
  });
});

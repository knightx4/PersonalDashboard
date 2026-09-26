import { describe, expect, it } from 'vitest';
import {
  articleRequestUrl,
  imageFromPage,
  imagesRequestUrl,
  parseArticleResponse,
  parseImagesResponse,
  sectionsFromExtract,
} from './wikipedia';

/**
 * Splitting an article, and the answers that are not an article.
 *
 * The extracts below are the shape `prop=extracts&explaintext=1` returns: the
 * lead with no heading, then `== Heading ==` lines with the body under each.
 * The cases that matter are the ones that would otherwise be found in
 * production -- a section the extract leaves empty, which cannot be stored
 * because a segment's text is `not null`, and two sections with the same
 * heading, which have to end up with different anchors or the second one is
 * unaddressable.
 */

function extract(...lines: string[]): string {
  return lines.join('\n');
}

const MARGINAL_UTILITY = extract(
  'Marginal utility is the change in utility from consuming one more unit.',
  '',
  '',
  '== History ==',
  '',
  'Gossen stated the law in 1854, twenty years before anyone read him.',
  '',
  '',
  '=== The marginal revolution ===',
  '',
  'Jevons, Menger and Walras arrived at it separately in the 1870s.',
  '',
  '',
  '== Diminishing marginal utility ==',
  '',
  'Each further unit is worth less than the one before it.',
  '',
  '',
  '== References ==',
  '',
  '',
  '== External links ==',
  '',
);

describe('sectionsFromExtract', () => {
  it('makes the lead section 0, with no anchor', () => {
    const [lead] = sectionsFromExtract(MARGINAL_UTILITY);
    expect(lead.ordinal).toBe(0);
    expect(lead.anchor).toBeNull();
    expect(lead.heading).toBeNull();
    expect(lead.text).toBe(
      'Marginal utility is the change in utility from consuming one more unit.',
    );
  });

  it('gives every headed section its anchor, its heading and its text', () => {
    const sections = sectionsFromExtract(MARGINAL_UTILITY);
    expect(sections.slice(1).map((s) => [s.anchor, s.heading])).toEqual([
      ['History', 'History'],
      ['The_marginal_revolution', 'The marginal revolution'],
      ['Diminishing_marginal_utility', 'Diminishing marginal utility'],
    ]);
    expect(sections[1].text).toBe(
      'Gossen stated the law in 1854, twenty years before anyone read him.',
    );
  });

  it('treats a subsection as a section of its own', () => {
    const sections = sectionsFromExtract(MARGINAL_UTILITY);
    const subsection = sections.find((s) => s.heading === 'The marginal revolution');
    expect(subsection?.text).toBe(
      'Jevons, Menger and Walras arrived at it separately in the 1870s.',
    );
  });

  it('drops a section the extract left empty', () => {
    const headings = sectionsFromExtract(MARGINAL_UTILITY).map((s) => s.heading);
    expect(headings).not.toContain('References');
    expect(headings).not.toContain('External links');
  });

  it('numbers what survives from 0 with no gaps', () => {
    const sections = sectionsFromExtract(MARGINAL_UTILITY);
    expect(sections.map((s) => s.ordinal)).toEqual([0, 1, 2, 3]);
  });

  it('numbers a repeated heading so the second one is still addressable', () => {
    const sections = sectionsFromExtract(
      extract('Lead.', '== Notes ==', 'First.', '== Notes ==', 'Second.'),
    );
    expect(sections.map((s) => s.anchor)).toEqual([null, 'Notes', 'Notes_2']);
  });

  it('leaves punctuation in a heading alone, as MediaWiki does', () => {
    const [, section] = sectionsFromExtract(
      extract('Lead.', "== Marshall's scissors & Jevons ==", 'Body.'),
    );
    expect(section.anchor).toBe("Marshall's_scissors_&_Jevons");
  });

  it('returns nothing for an extract with no text', () => {
    expect(sectionsFromExtract('')).toEqual([]);
  });
});

describe('articleRequestUrl', () => {
  it('asks for plain text with its headings still marked up', () => {
    const url = new URL(articleRequestUrl('Marginal utility'));
    expect(url.origin + url.pathname).toBe('https://en.wikipedia.org/w/api.php');
    expect(url.searchParams.get('titles')).toBe('Marginal utility');
    expect(url.searchParams.get('explaintext')).toBe('1');
    expect(url.searchParams.get('exsectionformat')).toBe('wiki');
    expect(url.searchParams.get('redirects')).toBe('1');
  });

  it('asks for the free lead image in the same request', () => {
    const url = new URL(articleRequestUrl('Marginal utility'));
    expect(url.searchParams.get('prop')).toBe('extracts|info|pageimages');
    expect(url.searchParams.get('piprop')).toBe('thumbnail|name');
    expect(url.searchParams.get('pilicense')).toBe('free');
  });
});

const THUMB =
  'https://thumb.wikimedia.org/wikipedia/commons/thumb/8/8c/Supply-demand-equilibrium.svg/960px-Supply-demand-equilibrium.svg.png';

describe('the lead image', () => {
  it('keeps a Wikimedia thumbnail without the tracking parameters', () => {
    expect(
      imageFromPage({
        thumbnail: { source: `${THUMB}?utm_source=en.wikipedia.org&utm_campaign=api` },
        pageimage: 'Supply-demand-equilibrium.svg',
      }),
    ).toEqual({ url: THUMB, file: 'Supply-demand-equilibrium.svg' });
  });

  it('refuses an image from anywhere else, or with no file name', () => {
    expect(imageFromPage({ thumbnail: { source: 'https://evil.example/x.png' }, pageimage: 'x.png' })).toBeNull();
    expect(imageFromPage({ thumbnail: { source: 'http://upload.wikimedia.org/x.png' }, pageimage: 'x.png' })).toBeNull();
    expect(imageFromPage({ thumbnail: { source: THUMB } })).toBeNull();
    expect(imageFromPage({})).toBeNull();
  });

  it('asks for fifty titles at most in one batch', () => {
    const titles = Array.from({ length: 60 }, (_, n) => `Title ${n}`);
    const url = new URL(imagesRequestUrl(titles));
    expect(url.searchParams.get('titles')?.split('|')).toHaveLength(50);
    expect(url.searchParams.get('prop')).toBe('pageimages');
  });

  it('traces each asked title through normalising and redirects', () => {
    const body = JSON.stringify({
      query: {
        normalized: [{ from: 'supply and demand', to: 'Supply and demand' }],
        redirects: [{ from: 'Demand curve', to: 'Demand curve (economics)' }],
        pages: [
          { title: 'Supply and demand', thumbnail: { source: THUMB }, pageimage: 'S.svg' },
          { title: 'Demand curve (economics)' },
          { title: 'Nope', missing: true },
        ],
      },
    });
    const images = parseImagesResponse(body, ['supply and demand', 'Demand curve', 'Nope', 'Unasked']);
    expect(images?.get('supply and demand')).toEqual({ url: THUMB, file: 'S.svg' });
    expect(images?.get('Demand curve')).toBeNull();
    expect(images?.get('Nope')).toBeNull();
    // Left out of the answer: asked again next time.
    expect(images?.has('Unasked')).toBe(false);
  });

  it('is null for an answer that is not the API', () => {
    expect(parseImagesResponse('<html>', ['A'])).toBeNull();
  });
});

function apiBody(page: Record<string, unknown>): string {
  return JSON.stringify({ batchcomplete: true, query: { pages: [page] } });
}

describe('parseArticleResponse', () => {
  const page = {
    pageid: 18962,
    ns: 0,
    title: 'Marginal utility',
    canonicalurl: 'https://en.wikipedia.org/wiki/Marginal_utility',
    extract: MARGINAL_UTILITY,
  };

  it('reads the title, the canonical url and the sections', () => {
    const result = parseArticleResponse(apiBody(page));
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.title).toBe('Marginal utility');
    expect(result.externalId).toBe('Marginal_utility');
    expect(result.canonicalUrl).toBe('https://en.wikipedia.org/wiki/Marginal_utility');
    expect(result.lengthChars).toBe(MARGINAL_UTILITY.trim().length);
    expect(result.sections).toHaveLength(4);
    expect(result.image).toBeNull();
  });

  it('builds the article url when the API did not give one', () => {
    const result = parseArticleResponse(apiBody({ ...page, canonicalurl: undefined }));
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.canonicalUrl).toBe('https://en.wikipedia.org/wiki/Marginal_utility');
  });

  it('calls a page that does not exist not-found', () => {
    const result = parseArticleResponse(apiBody({ ns: 0, title: 'Marginul utility', missing: true }));
    expect(result).toMatchObject({ ok: false, reason: 'not-found' });
  });

  it('calls an unusable title not-found too', () => {
    const result = parseArticleResponse(apiBody({ title: '<', invalid: true }));
    expect(result).toMatchObject({ ok: false, reason: 'not-found' });
  });

  it('calls a page with no text unreadable', () => {
    const result = parseArticleResponse(apiBody({ ...page, extract: '   ' }));
    expect(result).toMatchObject({ ok: false, reason: 'unreadable' });
  });

  it('passes on an API error in its own words', () => {
    const body = JSON.stringify({ error: { code: 'badvalue', info: 'Unrecognized value' } });
    expect(parseArticleResponse(body)).toMatchObject({
      ok: false,
      reason: 'error',
      detail: 'Unrecognized value',
    });
  });

  it('refuses a body that is not JSON', () => {
    expect(parseArticleResponse('<!doctype html>')).toMatchObject({
      ok: false,
      reason: 'error',
    });
  });
});

import { describe, expect, it } from 'vitest';
import {
  isEmptyResolution,
  resolvedSourceSchema,
  sanitiseResolution,
} from './resolve-payload';

/**
 * The rules the module actually guarantees, tested without a network.
 *
 * Every case here is a resolution the model could plausibly return and the
 * database would happily store. The point of this file is that a plausible
 * wrong answer gets corrected on the way in rather than becoming a link that
 * highlights nothing or a chapter that is not there.
 */

function parse(input: unknown) {
  const safe = resolvedSourceSchema.safeParse(input);
  if (!safe.success) throw new Error(safe.error.issues[0]?.message);
  return safe.data;
}

const HAYEK = {
  title: 'The Use of Knowledge in Society',
  author: 'F. A. Hayek',
  kind: 'article' as const,
  year: 1945,
  canonical_url: 'https://www.econlib.org/library/Essays/hykKnw.html',
  access: 'open' as const,
  locator_kind: 'whole' as const,
  locator_basis: 'Short essay, read it in full.',
  locator_verified: false,
  not_found: false,
};

describe('the schema', () => {
  it('accepts an ordinary resolution', () => {
    expect(parse(HAYEK).title).toBe('The Use of Knowledge in Society');
  });

  it('refuses a locator with no basis', () => {
    // The spec's first rule, enforced before the row reaches the constraint
    // that also enforces it.
    expect(() => parse({ ...HAYEK, locator_basis: '' })).toThrow();
    expect(() => parse({ ...HAYEK, locator_basis: '   ' })).toThrow();
    expect(() => parse({ title: 'A thing' })).toThrow();
  });

  it('refuses a non-https url', () => {
    expect(() => parse({ ...HAYEK, canonical_url: 'http://econlib.org/x' })).toThrow();
    expect(() => parse({ ...HAYEK, canonical_url: 'javascript:alert(1)' })).toThrow();
  });

  it('refuses a url that is not a url', () => {
    expect(() => parse({ ...HAYEK, canonical_url: 'see the library' })).toThrow();
  });

  it('defaults the fields a lazy tool call omits', () => {
    const parsed = parse({ title: 'A thing', locator_basis: 'found it' });
    expect(parsed.kind).toBe('page');
    expect(parsed.access).toBe('unknown');
    expect(parsed.locator_kind).toBe('whole');
    expect(parsed.not_found).toBe(false);
  });
});

describe('sanitiseResolution', () => {
  it('never lets the resolver mark a location verified', () => {
    // Verification is a claim about work that was done, and resolution only
    // searches -- it never holds the document. Only the locate pass, which
    // fetches, may promote a locator. A model that sets this is not lying so
    // much as answering a question it was not in a position to answer.
    const out = sanitiseResolution(parse({ ...HAYEK, locator_verified: true }));
    expect(out.locator_verified).toBe(false);
  });

  it('never lets the resolver claim a passage', () => {
    // `passage` means an anchor phrase was found in a fetched document.
    // Nothing at this stage has fetched anything.
    const out = sanitiseResolution(
      parse({ ...HAYEK, locator_kind: 'passage', locator_basis: 'the key paragraph' }),
    );
    expect(out.locator_kind).toBe('section');
  });

  it('downgrades a claimed passage to pages when it has a page range', () => {
    const out = sanitiseResolution(
      parse({ ...HAYEK, locator_kind: 'passage', page_from: 95, page_to: 128 }),
    );
    expect(out.locator_kind).toBe('pages');
  });

  it('drops a price from something nobody pays for', () => {
    // The column refuses this combination, and reading it back as "$10, free"
    // is worse than not storing it.
    const out = sanitiseResolution(parse({ ...HAYEK, access: 'open', price_cents: 1000 }));
    expect(out.price_cents).toBeNull();
  });

  it('keeps a price on something you do pay for', () => {
    const out = sanitiseResolution(
      parse({ ...HAYEK, access: 'paywalled', price_cents: 1000, title: 'What Is Strategy?' }),
    );
    expect(out.price_cents).toBe(1000);
  });

  it('rights a transposed page range', () => {
    const out = sanitiseResolution(parse({ ...HAYEK, page_from: 128, page_to: 95 }));
    expect(out.page_from).toBe(95);
    expect(out.page_to).toBe(128);
  });

  it('calls a range of pages a pages locator whatever it called itself', () => {
    const out = sanitiseResolution(
      parse({ ...HAYEK, locator_kind: 'whole', page_from: 95, page_to: 128 }),
    );
    expect(out.locator_kind).toBe('pages');
  });

  it('demotes a pages locator that has no pages', () => {
    const out = sanitiseResolution(parse({ ...HAYEK, locator_kind: 'pages' }));
    expect(out.locator_kind).toBe('whole');
  });

  it('leaves a chapter locator alone', () => {
    // The common good answer for a book, and the one thing here that must not
    // be second-guessed.
    const out = sanitiseResolution(
      parse({
        ...HAYEK,
        title: 'Spheres of Justice',
        kind: 'book',
        locator_kind: 'chapter',
        locator_label: 'Ch. 4, "Money and Commodities"',
        locator_basis: "The table of contents on the publisher's page lists this chapter.",
      }),
    );
    expect(out.locator_kind).toBe('chapter');
    expect(out.locator_label).toBe('Ch. 4, "Money and Commodities"');
  });

  it('strips a url and an access claim off a not_found', () => {
    // A model that reports both "I could not find it" and a URL has
    // contradicted itself, and the half to trust is the admission.
    const out = sanitiseResolution(
      parse({
        ...HAYEK,
        not_found: true,
        canonical_url: 'https://example.org/probably-not',
        access: 'open',
      }),
    );
    expect(out.canonical_url).toBeNull();
    expect(out.access).toBe('unknown');
    expect(isEmptyResolution(out)).toBe(true);
  });

  it('does not call a found source empty', () => {
    expect(isEmptyResolution(sanitiseResolution(parse(HAYEK)))).toBe(false);
  });
});

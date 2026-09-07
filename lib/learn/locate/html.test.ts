import { describe, expect, it } from 'vitest';
import {
  buildPdfPageUrl,
  buildTextFragmentUrl,
  containsAnchor,
  normalize,
  toPlainText,
} from './html';

const HAYEK = `<!doctype html>
<html><head><title>The Use of Knowledge in Society</title>
<style>.nav { color: red }</style>
<script>var tracking = "The marvel is that this is fake";</script></head>
<body>
<nav><a href="/">Econlib</a></nav>
<h1>The Use of Knowledge in Society</h1>
<p>The marvel is that in a case like that of a scarcity of one raw
material, without an order being issued, without more than perhaps a
handful of people knowing the cause, tens of thousands of people &hellip;
were made to use the material or its products more sparingly.</p>
<p>I have deliberately used the word &ldquo;marvel&rdquo; to shock the
reader out of the complacency with which we often take the working of
this mechanism for granted.</p>
<footer>&copy; 2026</footer>
</body></html>`;

describe('toPlainText', () => {
  it('keeps the prose', () => {
    const text = toPlainText(HAYEK);
    expect(text).toContain('The marvel is that in a case like that of a scarcity');
    expect(text).toContain('I have deliberately used the word');
  });

  it('drops script and style content entirely', () => {
    // Not cosmetic: a phrase found only inside a <script> would verify a
    // locator that highlights nothing when the reader opens the page.
    const text = toPlainText(HAYEK);
    expect(text).not.toContain('var tracking');
    expect(text).not.toContain('this is fake');
    expect(text).not.toContain('color: red');
  });

  it('decodes the entities a real page is full of', () => {
    const text = toPlainText(HAYEK);
    expect(text).toContain('…');
    expect(text).toContain('“marvel”');
  });

  it('decodes numeric entities, decimal and hex', () => {
    expect(toPlainText('<p>caf&#233; and caf&#xe9;</p>')).toBe('café and café');
  });

  it('leaves an unknown entity alone rather than mangling it', () => {
    expect(toPlainText('<p>&notarealentity; stays</p>')).toContain('&notarealentity;');
  });

  it('breaks blocks into lines instead of running words together', () => {
    // "granted.I have" would be a phrase that exists in our extraction and in
    // no browser's, which is exactly the mismatch that breaks a fragment.
    const text = toPlainText(HAYEK);
    expect(text).not.toMatch(/granted\.I have/);
  });

  it('survives a comment containing markup', () => {
    const text = toPlainText('<p>before</p><!-- <p>hidden</p> --><p>after</p>');
    expect(text).not.toContain('hidden');
    expect(text.split(/\n+/)).toEqual(['before', 'after']);
  });
});

describe('normalize', () => {
  it('flattens the differences a model introduces when it quotes', () => {
    expect(normalize('the  word\n“marvel”')).toBe(normalize('The word "marvel"'));
  });

  it('flattens dash and apostrophe variants', () => {
    expect(normalize('it’s well—known')).toBe(normalize("it's well-known"));
  });
});

describe('containsAnchor', () => {
  const text = toPlainText(HAYEK);

  it('accepts a phrase the document actually contains', () => {
    expect(containsAnchor(text, 'without an order being issued')).toBe(true);
  });

  it('accepts it through curly quotes and reflowed whitespace', () => {
    expect(containsAnchor(text, 'I have deliberately used the word "marvel"')).toBe(true);
  });

  it('rejects a phrase the model invented', () => {
    // The verification that makes a locator `verified`. Without it the module
    // ships links that highlight nothing, which is the failure the whole
    // confidence column exists to prevent.
    expect(containsAnchor(text, 'prices are a valuation device, said Hayek')).toBe(false);
  });

  it('rejects a phrase too short to identify anything', () => {
    // "the" appears everywhere. Matching it would verify nothing and send the
    // reader to the top of the page with a random word lit up.
    expect(containsAnchor(text, 'the')).toBe(false);
    expect(containsAnchor(text, 'marvel')).toBe(false);
  });
});

describe('buildTextFragmentUrl', () => {
  it('encodes a short phrase whole', () => {
    const url = buildTextFragmentUrl('https://example.org/essay', 'without an order');
    expect(url).toBe('https://example.org/essay#:~:text=without%20an%20order');
  });

  it('encodes the characters that are fragment syntax', () => {
    // `-` and `,` separate prefix, start, end and suffix inside the directive,
    // so a phrase containing them has to encode them even though
    // encodeURIComponent does not.
    const url = buildTextFragmentUrl('https://example.org/e', 'well-known, mostly');
    expect(url).toContain('%2D');
    expect(url).toContain('%2C');
    expect(url).not.toMatch(/text=.*[^%]-/);
  });

  it('sends a long passage as its two ends', () => {
    const long =
      'The marvel is that in a case like that of a scarcity of one raw material ' +
      'without an order being issued tens of thousands of people were made to use it sparingly';
    const url = buildTextFragmentUrl('https://example.org/e', long);
    const directive = url.split('#:~:text=')[1];
    const [start, end] = directive.split(',');
    expect(decodeURIComponent(start.replace(/%2D/g, '-'))).toBe('The marvel is that in a');
    expect(decodeURIComponent(end.replace(/%2D/g, '-'))).toBe('were made to use it sparingly');
    expect(directive.split(',')).toHaveLength(2);
  });

  it('replaces a fragment already on the URL', () => {
    // A second locate pass must not stack two directives on one URL.
    const once = buildTextFragmentUrl('https://example.org/e#:~:text=old', 'without an order');
    expect(once).toBe('https://example.org/e#:~:text=without%20an%20order');
  });

  it('keeps the query string, which often is the document', () => {
    const url = buildTextFragmentUrl('https://example.org/view?id=7', 'without an order');
    expect(url).toContain('?id=7');
  });
});

describe('buildPdfPageUrl', () => {
  it('points at a page', () => {
    expect(buildPdfPageUrl('https://example.org/paper.pdf', 12)).toBe(
      'https://example.org/paper.pdf#page=12',
    );
  });

  it('never produces page zero or a fraction', () => {
    expect(buildPdfPageUrl('https://example.org/p.pdf', 0)).toBe('https://example.org/p.pdf#page=1');
    expect(buildPdfPageUrl('https://example.org/p.pdf', 3.7)).toBe(
      'https://example.org/p.pdf#page=3',
    );
  });
});

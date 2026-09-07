import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { FetchResult } from '@/lib/learn/providers/fetch';

/**
 * The locate pass, and the check the module is built around.
 *
 * The case that matters most is the one in the middle: a model returns a
 * beautifully plausible sentence that is not in the document. Shipping it
 * produces a link that scrolls nowhere and highlights nothing, which costs the
 * reader the twenty minutes this module exists to save AND their trust in
 * every other link in the queue. So it is checked, verbatim, and discarded
 * when it fails.
 *
 * Everything else here is a failure mode that must degrade rather than throw:
 * a paywall, a PDF, a page that moved. The worst outcome is always the URL you
 * already had, plus a sentence saying why it could not be narrowed.
 */

const fetchDocument = vi.fn<(url: string) => Promise<FetchResult>>();
vi.mock('@/lib/learn/providers', () => ({ fetchDocument: (url: string) => fetchDocument(url) }));

const { locatePassage } = await import('./locate');

const PAGE = `<html><body>
<h1>The Use of Knowledge in Society</h1>
<p>The peculiar character of the problem of a rational economic order is
determined precisely by the fact that the knowledge of the circumstances of
which we must make use never exists in concentrated or integrated form, but
solely as the dispersed bits of incomplete and frequently contradictory
knowledge which all the separate individuals possess.</p>
<p>The marvel is that in a case like that of a scarcity of one raw material,
without an order being issued, without more than perhaps a handful of people
knowing the cause, tens of thousands of people whose identity could not be
ascertained by months of investigation, were made to use the material or its
products more sparingly.</p>
</body></html>`;

function fetched(overrides: Partial<Extract<FetchResult, { ok: true }>> = {}): FetchResult {
  return {
    ok: true,
    url: 'https://www.econlib.org/library/Essays/hykKnw.html',
    contentType: 'html',
    text: PAGE,
    bytes: null,
    byteLength: PAGE.length,
    ...overrides,
  };
}

/** An Anthropic client that returns one tool call and never touches a network. */
function clientReturning(input: unknown) {
  return {
    messages: {
      create: vi.fn().mockResolvedValue({
        content: [{ type: 'tool_use', name: 'report_passage', input }],
      }),
    },
  } as never;
}

const QUESTION = 'Is a price a valuation device or a coordination device?';

beforeEach(() => {
  fetchDocument.mockReset();
});

describe('when the passage is really there', () => {
  it('verifies it and builds a link that lands on it', async () => {
    fetchDocument.mockResolvedValue(fetched());

    const outcome = await locatePassage({
      url: 'https://www.econlib.org/library/Essays/hykKnw.html',
      question: QUESTION,
      client: clientReturning({
        anchor: 'without an order being issued, without more than perhaps a handful of people',
        label: null,
      }),
    });

    expect(outcome.confidence).toBe('verified');
    expect(outcome.locatorKind).toBe('passage');
    expect(outcome.openUrl).toContain('#:~:text=');
    expect(outcome.textAnchor).toContain('without an order being issued');
    expect(outcome.basis).toMatch(/verbatim/i);
  });

  it('accepts a quote whose punctuation the model normalised', async () => {
    // A model reproducing a phrase straightens curly quotes and reflows
    // whitespace. Neither means it made the passage up, and browsers normalise
    // the same way when matching a fragment.
    fetchDocument.mockResolvedValue(fetched());

    const outcome = await locatePassage({
      url: 'https://example.org/e',
      question: QUESTION,
      client: clientReturning({
        anchor: 'the   dispersed bits of incomplete\nand frequently contradictory knowledge',
      }),
    });

    expect(outcome.confidence).toBe('verified');
  });

  it('keeps a section label when the model found one', async () => {
    fetchDocument.mockResolvedValue(fetched());

    const outcome = await locatePassage({
      url: 'https://example.org/e',
      question: QUESTION,
      client: clientReturning({
        anchor: 'tens of thousands of people whose identity could not be ascertained',
        label: 'The marvel of the price system',
      }),
    });

    expect(outcome.locatorLabel).toBe('The marvel of the price system');
  });
});

describe('when the model invents the passage', () => {
  it('discards it rather than shipping a link to nowhere', async () => {
    fetchDocument.mockResolvedValue(fetched());

    const outcome = await locatePassage({
      url: 'https://www.econlib.org/library/Essays/hykKnw.html',
      question: QUESTION,
      client: clientReturning({
        anchor: 'Hayek concluded that prices are purely a coordination device and never a valuation',
      }),
    });

    expect(outcome.textAnchor).toBeNull();
    expect(outcome.confidence).toBe('unverified');
    expect(outcome.openUrl).not.toContain('#:~:text=');
    expect(outcome.basis).toMatch(/did not appear/i);
  });

  it('will not accept a phrase that only exists in a script tag', async () => {
    // Script content is stripped before matching. A phrase found only there
    // would verify a locator that highlights nothing in the rendered page.
    fetchDocument.mockResolvedValue(
      fetched({
        text: `<html><body><script>var blurb = "prices are a coordination device, not a valuation one";</script>
        <p>${'Real prose about the price system. '.repeat(20)}</p></body></html>`,
      }),
    );

    const outcome = await locatePassage({
      url: 'https://example.org/e',
      question: QUESTION,
      client: clientReturning({
        anchor: 'prices are a coordination device, not a valuation one',
      }),
    });

    expect(outcome.confidence).toBe('unverified');
    expect(outcome.textAnchor).toBeNull();
  });
});

describe('when there is nothing to narrow to', () => {
  it('records that it read the page and found no single passage', async () => {
    fetchDocument.mockResolvedValue(fetched());

    const outcome = await locatePassage({
      url: 'https://example.org/e',
      question: QUESTION,
      client: clientReturning({ anchor: null }),
    });

    // Verified, because the page really was fetched and read. What was
    // established is that it does not need narrowing.
    expect(outcome.confidence).toBe('verified');
    expect(outcome.textAnchor).toBeNull();
    expect(outcome.locatorKind).toBeUndefined();
  });

  it('leaves a short document alone without calling a model at all', async () => {
    fetchDocument.mockResolvedValue(fetched({ text: '<p>Two sentences. That is all.</p>' }));
    const client = clientReturning({ anchor: 'never asked' });

    const outcome = await locatePassage({ url: 'https://example.org/e', question: null, client });

    expect(outcome.textAnchor).toBeNull();
    expect(outcome.basis).toMatch(/short/i);
    expect((client as unknown as { messages: { create: unknown } }).messages.create).not
      .toHaveBeenCalled();
  });
});

describe('when the document cannot be read', () => {
  const cases: Array<[Extract<FetchResult, { ok: false }>['reason'], RegExp]> = [
    ['not-found', /could not be found/i],
    ['unsupported-type', /not a document/i],
    ['too-large', /too large/i],
    ['timeout', /did not respond/i],
    ['blocked', /refused/i],
    ['error', /paywall|login/i],
  ];

  for (const [reason, expected] of cases) {
    it(`degrades to the original URL on ${reason}`, async () => {
      fetchDocument.mockResolvedValue({ ok: false, reason, detail: 'x' });

      const outcome = await locatePassage({
        url: 'https://example.org/paper',
        question: QUESTION,
        client: clientReturning({ anchor: 'never reached' }),
      });

      expect(outcome.openUrl).toBe('https://example.org/paper');
      expect(outcome.confidence).toBe('unverified');
      expect(outcome.basis).toMatch(expected);
    });
  }

  it('says plainly that a PDF is not narrowed yet', async () => {
    // Page-level PDF pointers need a text extraction library. Guessing a page
    // without one would be a confident wrong answer, which is the one thing
    // this module refuses to give.
    fetchDocument.mockResolvedValue(
      fetched({ contentType: 'pdf', text: '', bytes: new Uint8Array([1, 2]) }),
    );

    const outcome = await locatePassage({
      url: 'https://example.org/paper.pdf',
      question: QUESTION,
      client: clientReturning({ anchor: 'never reached' }),
    });

    expect(outcome.basis).toMatch(/PDF/);
    expect(outcome.confidence).toBe('unverified');
    expect(outcome.openUrl).toBe('https://example.org/paper.pdf');
  });

  it('does not throw when the model call itself fails', async () => {
    fetchDocument.mockResolvedValue(fetched());
    const client = {
      messages: { create: vi.fn().mockRejectedValue(new Error('overloaded')) },
    } as never;

    const outcome = await locatePassage({ url: 'https://example.org/e', question: null, client });

    expect(outcome.confidence).toBe('unverified');
    expect(outcome.openUrl).toBe('https://example.org/e');
  });
});

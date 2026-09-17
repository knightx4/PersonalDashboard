/**
 * The link out of a search that matched nothing.
 *
 * The thing worth pinning is what the link drops. Every list used to point at
 * its own bare path, so clearing a search that found nothing also threw away
 * the status, the range and the sort the list was already narrowed by, and you
 * got the whole list back instead of the one you were looking at. The link here
 * takes the query off the URL it is on and leaves the rest where it is.
 */
import { describe, expect, it, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';

const mockUrl = { pathname: '/vault', params: new URLSearchParams() };

vi.mock('next/navigation', () => ({
  usePathname: () => mockUrl.pathname,
  useSearchParams: () => mockUrl.params,
}));

const { SearchEmpty } = await import('@/components/shell/search-empty');

function render(pathname: string, search: string, query: string, paramName?: string): string {
  mockUrl.pathname = pathname;
  mockUrl.params = new URLSearchParams(search);
  return renderToStaticMarkup(<SearchEmpty query={query} paramName={paramName} />);
}

/** The one link the empty state renders. */
function href(markup: string): string {
  const match = markup.match(/href="([^"]*)"/);
  expect(match).not.toBeNull();
  return match![1].replaceAll('&amp;', '&');
}

describe('SearchEmpty', () => {
  it('clears the search and keeps every filter the list had', () => {
    const markup = render('/shopping/orders', 'status=open&q=amazon&sort=newest&tag=blue', 'amazon');
    expect(href(markup)).toBe('/shopping/orders?status=open&sort=newest&tag=blue');
  });

  it('goes back to the bare list when the search was all that was on the URL', () => {
    expect(href(render('/vault', 'q=recipes', 'recipes'))).toBe('/vault');
  });

  it('clears a search a page keeps under another name', () => {
    const markup = render('/dev/changelog', 'q=note&find=old&group=day', 'old', 'find');
    expect(href(markup)).toBe('/dev/changelog?q=note&group=day');
  });

  it('says what was searched for', () => {
    const markup = render('/vault', 'q=risotto', 'risotto');
    expect(markup).toContain('Nothing matched');
    expect(markup).toContain('risotto');
    expect(markup).toContain('Clear the search');
  });

  it('promises to keep the rest only when there is a rest to keep', () => {
    expect(render('/todo/all', 'status=open&q=invoice', 'invoice')).toContain(
      'keeps everything else you had set',
    );
    expect(render('/todo/all', 'q=invoice', 'invoice')).not.toContain(
      'keeps everything else you had set',
    );
  });
});

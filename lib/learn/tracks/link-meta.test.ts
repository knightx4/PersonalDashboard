import { describe, expect, it } from 'vitest';
import { findLink, readLinkMeta, titleFromUrl } from './link-meta';

describe('readLinkMeta', () => {
  it('prefers the Open Graph title and takes the author from the page', () => {
    const html = `<html><head>
      <title>You Need a New CFO | Andreessen Horowitz</title>
      <meta property="og:site_name" content="Andreessen Horowitz" />
      <meta property="og:title" content="You Need a New CFO" />
      <meta name="author" content="David George &amp; Jane Doe" />
    </head></html>`;
    expect(readLinkMeta(html, 'https://a16z.com/you-need-a-new-cfo/')).toEqual({
      title: 'You Need a New CFO',
      author: 'David George & Jane Doe',
    });
  });

  it('falls back to the title tag less the site name, and the site as author', () => {
    const html = `<title>Why Rust &#8211; a field guide | Example Blog</title>
      <meta content="Example Blog" property="og:site_name">`;
    expect(readLinkMeta(html, 'https://example.com/rust')).toEqual({
      title: 'Why Rust – a field guide',
      author: 'Example Blog',
    });
  });

  it('ignores an author that is a profile URL', () => {
    const html = `<meta property="og:title" content="A"><meta property="article:author" content="https://x.com/someone">`;
    expect(readLinkMeta(html, 'https://example.com/a').author).toBeNull();
  });

  it('titles a page that says nothing from its address', () => {
    expect(readLinkMeta('<html></html>', 'https://a16z.com/you-need-a-new-cfo/').title).toBe(
      'You need a new cfo (a16z.com)',
    );
  });
});

describe('titleFromUrl', () => {
  it('uses the host when there is no path', () => {
    expect(titleFromUrl('https://www.example.com/')).toBe('example.com');
  });
});

describe('findLink', () => {
  it('finds a link inside shared text and drops trailing punctuation', () => {
    expect(findLink('', 'You Need a New CFO https://a16z.com/you-need-a-new-cfo/.')).toBe(
      'https://a16z.com/you-need-a-new-cfo/',
    );
  });

  it('prefers the url field and refuses text with no link', () => {
    expect(findLink('https://a.com/x', 'https://b.com/y')).toBe('https://a.com/x');
    expect(findLink('not a link', null)).toBeNull();
  });
});

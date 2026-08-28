import { describe, expect, it } from 'vitest';
import { iconCandidates } from './site-icon';

describe('iconCandidates', () => {
  const html = `
    <html><head>
      <link rel="icon" href="/favicon.ico">
      <link rel="icon" type="image/png" sizes="32x32" href="/icons/32.png">
      <link rel="apple-touch-icon" sizes="180x180" href="/icons/apple.png">
      <meta property="og:image" content="https://cdn.ramp.com/share-card.png">
    </head></html>`;

  it('prefers an apple-touch-icon over a 16px favicon glyph', () => {
    const [best] = iconCandidates(html, 'https://ramp.com/');
    expect(best).toBe('https://ramp.com/icons/apple.png');
  });

  it('resolves relative hrefs against the page', () => {
    expect(iconCandidates(html, 'https://ramp.com/about')).toContain('https://ramp.com/favicon.ico');
  });

  it('ranks og:image last, because it is a share card as often as a logo', () => {
    const candidates = iconCandidates(html, 'https://ramp.com/');
    expect(candidates.at(-1)).toBe('https://cdn.ramp.com/share-card.png');
  });

  it('handles single-quoted and unquoted attributes', () => {
    const messy = `<link rel='apple-touch-icon' href='/a.png'><link rel=icon href=/b.png>`;
    expect(iconCandidates(messy, 'https://ramp.com/')).toEqual([
      'https://ramp.com/a.png',
      'https://ramp.com/b.png',
    ]);
  });

  it('ignores link tags that are not icons', () => {
    const other = `<link rel="stylesheet" href="/app.css"><link rel="canonical" href="/">`;
    expect(iconCandidates(other, 'https://ramp.com/')).toEqual([]);
  });

  it('does not return the same URL twice', () => {
    const duplicated = `<link rel="icon" href="/favicon.ico"><link rel="shortcut icon" href="/favicon.ico">`;
    expect(iconCandidates(duplicated, 'https://ramp.com/')).toEqual([
      'https://ramp.com/favicon.ico',
    ]);
  });

  it('skips an icon that is not fetchable over http', () => {
    // An inline data: favicon would go straight into logo_url and bloat the
    // row; javascript: has no business being there at all.
    const inline = `<link rel="icon" href="data:image/png;base64,iVBORw0KG">
      <link rel="apple-touch-icon" href="javascript:void(0)">`;
    expect(iconCandidates(inline, 'https://ramp.com/')).toEqual([]);
  });

  it('is empty for a page with no head worth reading', () => {
    expect(iconCandidates('<html><body>hi</body></html>', 'https://ramp.com/')).toEqual([]);
  });
});

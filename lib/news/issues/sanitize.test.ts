import { describe, expect, it } from 'vitest';
import { cleanIssueHtml } from './sanitize';

describe('cleanIssueHtml', () => {
  it('takes out a script and everything it says', () => {
    const { html } = cleanIssueHtml('<p>Hello</p><script>alert(document.cookie)</script>');
    expect(html).toContain('Hello');
    expect(html).not.toContain('script');
    expect(html).not.toContain('document.cookie');
  });

  it('takes out event handlers', () => {
    const { html } = cleanIssueHtml(
      '<p onclick="steal()" onmouseover="steal()">Hello</p><img onerror="steal()" src="https://x/a.png">',
    );
    expect(html).not.toContain('onclick');
    expect(html).not.toContain('onmouseover');
    expect(html).not.toContain('onerror');
    expect(html).not.toContain('steal');
  });

  it('takes the address off a javascript: link and leaves the words', () => {
    const { html } = cleanIssueHtml('<a href="javascript:steal()">Read this</a>');
    expect(html).toContain('Read this');
    expect(html).not.toContain('javascript:');
  });

  it('takes out forms, fields and frames', () => {
    const { html } = cleanIssueHtml(
      '<form action="https://evil/steal"><input name="password"><button>Go</button></form>' +
        '<iframe src="https://evil"></iframe><object data="https://evil"></object>' +
        '<embed src="https://evil">',
    );
    expect(html).not.toContain('<form');
    expect(html).not.toContain('<input');
    expect(html).not.toContain('<iframe');
    expect(html).not.toContain('<object');
    expect(html).not.toContain('<embed');
    expect(html).not.toContain('evil');
  });

  it('takes out a stylesheet rather than unwrapping it', () => {
    const { html } = cleanIssueHtml(
      '<style>body { background: url(https://tracker/x.png) }</style><p>Hi</p>',
    );
    expect(html).not.toContain('tracker');
    expect(html).not.toContain('background');
    expect(html).toContain('Hi');
  });

  it('keeps what a newsletter is made of', () => {
    const { html } = cleanIssueHtml(
      '<h1>This week</h1><table bgcolor="#f5f5f5" cellpadding="8" width="600">' +
        '<tr><td align="center" style="color: #c0392b; font-size: 18px">' +
        '<a href="https://example.com/story">The story</a></td></tr></table>',
    );
    expect(html).toContain('<h1>This week</h1>');
    expect(html).toContain('bgcolor="#f5f5f5"');
    expect(html).toContain('cellpadding="8"');
    expect(html).toContain('width="600"');
    expect(html).toContain('align="center"');
    expect(html).toContain('color:#c0392b');
    expect(html).toContain('href="https://example.com/story"');
  });

  it('sends a link out in a tab of its own', () => {
    const { html } = cleanIssueHtml('<a href="https://example.com">Read</a>');
    expect(html).toContain('target="_blank"');
    expect(html).toContain('rel="noopener noreferrer"');
  });

  it('holds a picture back and says how many it held', () => {
    const { html, blockedImages } = cleanIssueHtml(
      '<img src="https://tracker/open.gif" alt="" width="1"><img src="https://cdn/hero.jpg" alt="Hero">',
    );
    expect(blockedImages).toBe(2);
    expect(html).not.toMatch(/(^|\s)src=/);
    expect(html).toContain('data-news-src="https://tracker/open.gif"');
    expect(html).toContain('alt="Hero"');
  });

  it('puts the pictures back when they are asked for', () => {
    const { html, blockedImages, images } = cleanIssueHtml('<img src="https://cdn/hero.jpg">', true);
    expect(blockedImages).toBe(0);
    expect(images).toBe(1);
    expect(html).toContain('src="https://cdn/hero.jpg"');
    expect(html).not.toContain('data-news-src');
  });

  it('drops a set of sizes, which is a set of addresses', () => {
    const { html } = cleanIssueHtml(
      '<img src="https://cdn/a.jpg" srcset="https://cdn/a-2x.jpg 2x">',
      true,
    );
    expect(html).not.toContain('srcset');
    expect(html).not.toContain('a-2x.jpg');
  });

  it('holds back a background picture in an inline style, and keeps the colour beside it', () => {
    const blocked = cleanIssueHtml(
      '<td style="background-image: url(https://tracker/bg.png); color: red">Hi</td>',
    );
    expect(blocked.html).not.toContain('tracker');
    expect(blocked.html).toContain('color:red');

    const shown = cleanIssueHtml(
      '<td style="background-image: url(https://cdn/bg.png); color: red">Hi</td>',
      true,
    );
    expect(shown.html).toContain('url(https://cdn/bg.png)');
  });

  it('never keeps a style that runs something, even with pictures on', () => {
    const { html } = cleanIssueHtml(
      '<div style="width: expression(alert(1)); behavior: url(#evil); color: blue">Hi</div>',
      true,
    );
    expect(html).not.toContain('expression');
    expect(html).not.toContain('behavior');
    expect(html).toContain('color:blue');
  });

  it('drops the old background attribute', () => {
    const { html } = cleanIssueHtml(
      '<table background="https://tracker/bg.png"><tr><td>Hi</td></tr></table>',
    );
    expect(html).not.toContain('tracker');
  });

  it('has nothing to say about an empty body', () => {
    expect(cleanIssueHtml(null)).toEqual({ html: '', blockedImages: 0, images: 0 });
    expect(cleanIssueHtml('   ')).toEqual({ html: '', blockedImages: 0, images: 0 });
  });
});

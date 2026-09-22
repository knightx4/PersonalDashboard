/**
 * A comment, rendered.
 *
 * `lib/comments/refs.test.ts` pins the splitter; this is the other half -- that
 * what the splitter finds actually reaches the markup as a link, and that the
 * three places a `#` must be left alone survive the whole markdown pipeline
 * rather than only the regex. The plugin runs after remark-gfm and after the
 * mention plugin, and the interesting failures are all about node shapes those
 * two leave behind, which a unit test on the regex cannot see.
 */
import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { CommentBody } from '@/components/dev/comment-body';

function render(body: string): string {
  return renderToStaticMarkup(<CommentBody body={body} />);
}

describe('CommentBody', () => {
  it('links a step number to the row on the plan', () => {
    const html = render('Feature #494 has been fired at three times today.');
    expect(html).toContain('href="/dev/plan?view=all#plan-494"');
    expect(html).toContain('>#494</a>');
  });

  // Note cfd2543f: the plan page labels a step by its place in the tree, so
  // the link reads that way too where the page knows it.
  it('reads a step as the outline the plan page shows, and still links its number', () => {
    const html = renderToStaticMarkup(
      <CommentBody
        body="The trial (#760) cannot run."
        titles={{ 760: { title: 'Try Wikipedia sections', outline: '723.20' } }}
      />,
    );
    expect(html).toContain('href="/dev/plan?view=all#plan-760"');
    expect(html).toContain('>#723.20</a>');
    expect(html).toContain('title="#723.20 — Try Wikipedia sections"');
  });

  it('links every number in a run of them', () => {
    const html = render('#500, #501 and #505 all wait on #499.');
    for (const number of [499, 500, 501, 505]) {
      expect(html).toContain(`href="/dev/plan?view=all#plan-${number}"`);
    }
  });

  // The reason the walk skips `inlineCode` and `code`: a comment quoting a
  // number is showing it, not pointing at it.
  it('leaves a number inside code alone', () => {
    const html = render('the literal `#494` stays put');
    expect(html).toContain('<code>#494</code>');
    expect(html).not.toContain('href="/dev/plan?view=all#plan-494"');
  });

  it('leaves a number inside a fenced block alone', () => {
    const html = render('```\nstep #494\n```');
    expect(html).not.toContain('href=');
  });

  // The reason the walk skips `link`: an anchor inside an anchor is not markup.
  it('does not put a link inside a link', () => {
    const html = render('[step #494](https://example.com/x)');
    expect(html).not.toContain('href="/dev/plan?view=all#plan-494"');
    expect(html).toContain('https://example.com/x');
    // One anchor, not two nested.
    expect(html.match(/<a /g)?.length).toBe(1);
  });

  it('still marks a mention, and marks one beside a reference', () => {
    const html = render('@dash what is #494 waiting on?');
    expect(html).toContain('comment-mention');
    expect(html).toContain('href="/dev/plan?view=all#plan-494"');
  });

  it('leaves an ordinary comment untouched', () => {
    expect(render('no numbers here')).toContain('no numbers here');
  });
});

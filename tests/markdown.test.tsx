/**
 * The one markdown renderer (plan #1431), and the surfaces moved onto it that
 * had no render test of their own. The vault note body, the prep note and
 * the comment body keep theirs in vault-note-body, prep-note and comment-body.
 */
import { describe, expect, it, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';

import { Markdown } from '@/components/ui/markdown';
import { FoldingMarkdown } from '@/components/ui/folding-markdown';
import { FileBody } from '@/components/files/file-body';

vi.mock('@/components/dev/comment-thread', () => ({ CommentThread: () => null }));

const { SpecSectionCard } = await import('@/app/dev/specs/[slug]/spec-view');

describe('Markdown', () => {
  it('draws lists, emphasis and tables', () => {
    const html = renderToStaticMarkup(
      <Markdown markdown={'- one\n- **two**\n\n| a | b |\n| - | - |\n| 1 | 2 |'} />,
    );
    expect(html).toContain('<li>one</li>');
    expect(html).toContain('<strong>two</strong>');
    expect(html).toContain('<table>');
  });

  it('opens an off-site link in a new tab and keeps an app link in place', () => {
    const html = renderToStaticMarkup(
      <Markdown markdown={'[site](https://example.com) and [plan](/dev/plan)'} />,
    );
    expect(html).toContain('href="https://example.com" target="_blank" rel="noopener noreferrer"');
    expect(html).toContain('<a href="/dev/plan">plan</a>');
  });

  it('links a bare domain', () => {
    const html = renderToStaticMarkup(<Markdown markdown="Sources: respark.com." />);
    expect(html).toContain('href="https://respark.com"');
  });

  it('leaves a bare domain alone when told to', () => {
    const html = renderToStaticMarkup(<Markdown markdown="respark.com" bareDomains={false} />);
    expect(html).not.toContain('<a');
  });

  it('renders raw HTML as text and an image as its label', () => {
    const html = renderToStaticMarkup(
      <Markdown markdown={'<script>x()</script>\n\n![a chart](https://evil.example/p.png)'} />,
    );
    expect(html).not.toContain('<script');
    expect(html).not.toContain('<img');
    expect(html).toContain('(image: a chart)');
  });

  it('keeps the text of a link the resolver has nowhere to send', () => {
    const html = renderToStaticMarkup(
      <Markdown markdown="[setup](SETUP.md)" resolveHref={() => null} />,
    );
    expect(html).toContain('<span class="text-ink-muted">setup</span>');
    expect(html).not.toContain('<a');
  });

  it('folds at headings only when asked', () => {
    const source = 'intro\n\n## Part\nbody';
    expect(renderToStaticMarkup(<Markdown markdown={source} />)).not.toContain('<details');
    const folded = renderToStaticMarkup(<Markdown markdown={source} fold />);
    expect(folded).toContain('<details');
    expect(folded).toContain('Part');
  });

  it('links step numbers and marks mentions only when asked', () => {
    const plain = renderToStaticMarkup(<Markdown markdown="@dash see #494" />);
    expect(plain).not.toContain('comment-ref');
    expect(plain).not.toContain('comment-mention');

    const marked = renderToStaticMarkup(<Markdown markdown="@dash see #494" mentions planRefs />);
    expect(marked).toContain('comment-mention');
    expect(marked).toContain('#plan-494');
  });
});

describe('the surfaces on it', () => {
  it('FoldingMarkdown folds a heading and links what it names', () => {
    const html = renderToStaticMarkup(
      <FoldingMarkdown markdown={'## History\nFounded at respark.com'} />,
    );
    expect(html).toContain('class="jobs-prose"');
    expect(html).toContain('<details');
    expect(html).toContain('href="https://respark.com"');
  });

  it('FileBody renders a result with its link', () => {
    const html = renderToStaticMarkup(
      <FileBody markdown={'# Result\nSee [the page](https://example.com).'} compact />,
    );
    expect(html).toContain('vault-prose');
    expect(html).toContain('prose-compact');
    expect(html).toContain('<h1>Result</h1>');
    expect(html).toContain('href="https://example.com" target="_blank"');
  });

  it('SpecSectionCard rewrites a link to another spec and unlinks a file with no page', () => {
    const html = renderToStaticMarkup(
      <SpecSectionCard
        section={{
          id: 's1',
          anchor: 'links',
          heading: 'Links',
          body: 'See [the graph](LEARN-GRAPH-SPEC.md) and [setup](SETUP.md).',
          position: 0,
          thread: [],
        }}
      />,
    );
    expect(html).toContain('href="/dev/specs/');
    expect(html).toContain('<span class="text-ink-muted">setup</span>');
  });
});

/**
 * Addresses in plain text open when tapped (plan #1430): LinkedText draws
 * them, RefText links them alongside step numbers, and the click-to-edit read
 * state stops being one big button once there is a link in it to press.
 */
import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { hasLinks, LinkedText } from '@/components/ui/linked-text';
import { RefText } from '@/components/dev/ref-text';
import { CommentBody } from '@/components/dev/comment-body';
import { ProseAtRest } from '@/components/ui/editable-prose';

describe('LinkedText', () => {
  it('links full addresses and bare domains, and keeps the rest as text', () => {
    const html = renderToStaticMarkup(
      <LinkedText text={'See https://example.com/a and ikea.com/us.\nThanks'} />,
    );
    expect(html).toContain('href="https://example.com/a"');
    expect(html).toContain('href="https://ikea.com/us"');
    expect(html).toContain('\nThanks');
  });

  it('links a bare outline as its step, and leaves a list number alone (plan #1931.4)', () => {
    const html = renderToStaticMarkup(<LinkedText text="#3 is done; #1490.11 is next" />);
    expect(html).toContain('href="/dev/plan/1490.11"');
    expect(html).not.toContain('href="/dev/plan/3"');
    const plan = renderToStaticMarkup(<LinkedText text="Waits on #1931" refs="all" />);
    expect(plan).toContain('href="/dev/plan/1931"');
  });

  it('says whether there is anything to link', () => {
    expect(hasLinks('see #1490.11')).toBe(true);
    expect(hasLinks('nothing here')).toBe(false);
    expect(hasLinks('go to transalt.org')).toBe(true);
  });
});

describe("Dash's replies", () => {
  it('link a bare outline and not a list number (plan #1931.4)', () => {
    const html = renderToStaticMarkup(
      <CommentBody body={'Done.\n\n#2 of the three: #1490.11 is next.'} refs="outlines" />,
    );
    expect(html).toMatch(/<a[^>]*href="\/dev\/plan\/1490\.11"[^>]*>#1490\.11/);
    expect(html).not.toContain('href="/dev/plan/2"');
  });
});

describe('RefText', () => {
  it('links both step numbers and addresses', () => {
    const html = renderToStaticMarkup(<RefText text="Built in #12, see https://example.com" />);
    expect(html).toContain('href="https://example.com"');
    expect(html).toMatch(/<a[^>]*comment-ref/);
  });

  it('links a written outline and reads a stored number as its outline', () => {
    const titles = { 1084: { title: 'Name steps', outline: '1073.4' } };
    const html = renderToStaticMarkup(<RefText text="See #1073.4 and #1084" titles={titles} />);
    expect(html.match(/href="\/dev\/plan\/1084"/g)).toHaveLength(2);
    expect(html.match(/>#1073\.4</g)).toHaveLength(2);
    expect(html).toContain('title="#1073.4 — Name steps"');
  });

  it('links an address when there are no step numbers', () => {
    const html = renderToStaticMarkup(<RefText text="see example.com" />);
    expect(html).toContain('href="https://example.com"');
  });
});

describe('ProseAtRest', () => {
  const props = { onEdit: () => {}, title: 'Edit it', empty: 'Nothing yet.' };

  it('is one button while the text has no links', () => {
    const html = renderToStaticMarkup(<ProseAtRest text="Plain words" {...props} />);
    expect(html.startsWith('<button')).toBe(true);
    expect(html).not.toContain('<a ');
  });

  it('keeps links out of the button once the text has one', () => {
    const html = renderToStaticMarkup(<ProseAtRest text="Read example.com first" {...props} />);
    expect(html).toContain('href="https://example.com"');
    expect(html).not.toMatch(/<button[^>]*>(?:(?!<\/button>)[\s\S])*<a /);
  });
});

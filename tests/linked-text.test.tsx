/**
 * Addresses in plain text open when tapped (plan #1430): LinkedText draws
 * them, RefText links them alongside step numbers, and the click-to-edit read
 * state stops being one big button once there is a link in it to press.
 */
import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { hasLinks, LinkedText } from '@/components/ui/linked-text';
import { RefText } from '@/components/dev/ref-text';
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

  it('says whether there is anything to link', () => {
    expect(hasLinks('nothing here')).toBe(false);
    expect(hasLinks('go to transalt.org')).toBe(true);
  });
});

describe('RefText', () => {
  it('links both step numbers and addresses', () => {
    const html = renderToStaticMarkup(<RefText text="Built in #12, see https://example.com" />);
    expect(html).toContain('href="https://example.com"');
    expect(html).toMatch(/<a[^>]*comment-ref/);
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

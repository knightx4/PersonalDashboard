import { describe, expect, it } from 'vitest';
import { specLinkHref } from '@/lib/specs/links';

/**
 * The note that produced this: clicking the link to LEARN-GRAPH-SPEC.md from the
 * map spec gave a 404, because a file path resolved against the page's URL.
 */
describe('specLinkHref', () => {
  it('sends a link to a spec file to that spec page', () => {
    expect(specLinkHref('LEARN-GRAPH-SPEC.md')).toBe('/dev/specs/learn-graph');
    expect(specLinkHref('./WRITING-GUIDE.md')).toBe('/dev/specs/writing');
    expect(specLinkHref('docs/VAULT-SPEC.md')).toBe('/dev/specs/vault');
  });

  it('keeps the fragment, which is the same anchor the section card carries', () => {
    expect(specLinkHref('LEARN-GRAPH-SPEC.md#what-a-node-is')).toBe(
      '/dev/specs/learn-graph#what-a-node-is',
    );
  });

  it('leaves external links, in-page anchors and app routes alone', () => {
    expect(specLinkHref('https://example.com/x')).toBe('https://example.com/x');
    expect(specLinkHref('mailto:someone@example.com')).toBe('mailto:someone@example.com');
    expect(specLinkHref('#why-the-vault-is-the-starting-point')).toBe(
      '#why-the-vault-is-the-starting-point',
    );
    expect(specLinkHref('/dev/plan')).toBe('/dev/plan');
  });

  it('gives no destination for a repository file with no page', () => {
    expect(specLinkHref('SETUP.md')).toBeNull();
    expect(specLinkHref('trials/2026-09-16-map-30-notes.md')).toBeNull();
    expect(specLinkHref('consent-tally.md')).toBeNull();
    expect(specLinkHref(undefined)).toBeNull();
    expect(specLinkHref('')).toBeNull();
  });
});

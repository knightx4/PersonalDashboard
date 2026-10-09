/**
 * A step's changed screens as pictures (plan #1541), rendered: before and
 * after side by side on the plan row, the after alone on a changelog line,
 * and what each says when a picture is missing.
 */
import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { ScreenAfters, ScreenChanges } from '@/components/dev/screen-change';
import type { ScreenChangeView } from '@/lib/plan/screen-change';

const both: ScreenChangeView = {
  surface: 'jobs-contact',
  round: 2,
  verdict: 'pass',
  checkedAt: '2026-10-05T10:40:00Z',
  before: '/dev/ui/shot?path=before',
  after: '/dev/ui/shot?path=after',
};

describe('ScreenChanges', () => {
  it('draws the before and the after of each surface, lazily', () => {
    const html = renderToStaticMarkup(<ScreenChanges changes={[both]} />);
    expect(html).toContain('jobs-contact');
    expect(html).toContain('passed in round 2');
    expect(html).toContain('Before');
    expect(html).toContain('After');
    expect(html).toContain('src="/dev/ui/shot?path=before"');
    expect(html).toContain('src="/dev/ui/shot?path=after"');
    expect(html).toContain('loading="lazy"');
  });

  it('says why a picture is missing', () => {
    const html = renderToStaticMarkup(
      <ScreenChanges changes={[{ ...both, before: null, after: null, verdict: 'accepted', round: 4 }]} />,
    );
    expect(html).toContain('could not upload its pictures');
    expect(html).toContain('accepted by you after round 3');
    expect(html).not.toContain('<img');
  });

  it('marks a new screen, which has an after and no before', () => {
    const html = renderToStaticMarkup(<ScreenChanges changes={[{ ...both, before: null }]} />);
    expect(html).toContain('A new screen');
    expect(html).toContain('src="/dev/ui/shot?path=after"');
  });

  it('draws nothing for a step that changed no screen', () => {
    expect(renderToStaticMarkup(<ScreenChanges changes={[]} />)).toBe('');
  });

  it('puts the footer under each surface, for the press about that screen', () => {
    const html = renderToStaticMarkup(
      <ScreenChanges changes={[both]} footer={(c) => <span>about {c.surface}</span>} />,
    );
    expect(html).toContain('about jobs-contact');
  });
});

describe('ScreenAfters', () => {
  it('shows only the after pictures, and leaves out a surface with none', () => {
    const html = renderToStaticMarkup(
      <ScreenAfters changes={[both, { ...both, surface: 'jobs-contacts', after: null }]} />,
    );
    expect(html).toContain('src="/dev/ui/shot?path=after"');
    expect(html).not.toContain('path=before');
    expect(html).not.toContain('jobs-contacts');
  });
});

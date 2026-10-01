/**
 * The Dash mark (plan #1335): four states, each its own still image, named
 * for a screen reader, and with its motion switched off under reduced motion.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { DASH_STATES, DASH_STATE_LABELS, DashMark } from '@/components/ui/dash-mark';

const render = (props: Parameters<typeof DashMark>[0]) =>
  renderToStaticMarkup(<DashMark {...props} />);

/** The markup with the motion classes taken out: what a still frame shows. */
const still = (html: string) => html.replace(/ class="dash-mark-(orbit|flash)"/g, '');

describe('DashMark', () => {
  it('draws four states that differ with the motion taken away', () => {
    const frames = DASH_STATES.map((state) => {
      const html = render({ state });
      // The SVG body alone, so the label and data attribute do not count.
      return still(html.slice(html.indexOf('<svg')));
    });
    expect(new Set(frames).size).toBe(4);
  });

  it('only animates working and done', () => {
    expect(render({ state: 'working' })).toContain('dash-mark-orbit');
    expect(render({ state: 'done' })).toContain('dash-mark-flash');
    expect(render({ state: 'idle' })).not.toMatch(/dash-mark-(orbit|flash)/);
    expect(render({ state: 'failed' })).not.toMatch(/dash-mark-(orbit|flash)/);
  });

  it('draws failed hollow', () => {
    const html = render({ state: 'failed' });
    expect(html).toContain('stroke="currentColor"');
    expect(html).not.toContain('fill="currentColor" fill-opacity="0.32"');
  });

  it('names itself by state, and says Dash rather than Claude', () => {
    for (const state of DASH_STATES) {
      const html = render({ state });
      expect(html).toContain(`role="img"`);
      expect(html).toContain(`aria-label="${DASH_STATE_LABELS[state]}"`);
      expect(DASH_STATE_LABELS[state]).toMatch(/^Dash/);
    }
    expect(render({ state: 'failed', label: 'Dash failed: timeout' })).toContain(
      'aria-label="Dash failed: timeout"',
    );
  });

  it('hides itself when decorative', () => {
    const html = render({ decorative: true });
    expect(html).not.toContain('role="img"');
    expect(html).not.toContain('aria-label');
    expect(html.slice(0, html.indexOf('>'))).toContain('aria-hidden="true"');
  });

  it('defaults to idle at icon size', () => {
    const html = render({});
    expect(html).toContain('data-dash-state="idle"');
    expect(html).toContain('width="16"');
  });
});

describe('its animations', () => {
  const css = readFileSync(join(process.cwd(), 'app/globals.css'), 'utf8');

  it('are defined as utilities', () => {
    expect(css).toMatch(/@utility dash-mark-orbit \{[^}]*animation: dash-mark-orbit /);
    expect(css).toMatch(/@utility dash-mark-flash \{[^}]*animation: dash-mark-flash 320ms/);
  });

  it('are entered in the reduced-motion block', () => {
    const block = css.slice(css.indexOf('@media (prefers-reduced-motion: reduce)'));
    expect(block).toMatch(/\.dash-mark-orbit,\s*\.dash-mark-flash \{\s*animation: none;/);
  });
});

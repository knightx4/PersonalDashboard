/**
 * The Dash mark (plan #1335): five states and four kinds of work, each its own
 * still image, named for a screen reader, and with its motion switched off
 * under reduced motion.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import {
  DASH_ACTIVITIES,
  DASH_ACTIVITY_LABELS,
  DASH_LOOKS,
  DASH_STATES,
  DASH_STATE_LABELS,
  DashMark,
} from '@/components/ui/dash-mark';

const render = (props: Parameters<typeof DashMark>[0]) =>
  renderToStaticMarkup(<DashMark {...props} />);

/** Every motion utility the mark uses, as named in app/globals.css. */
const MOTIONS = [
  'blink',
  'breathe',
  'snooze',
  'tip',
  'streak',
  'rattle',
  'read',
  'sweep',
  'ping',
  'write',
  'caret',
  'ponder',
  'flash',
  'wave',
] as const;

/**
 * What a still frame shows: the SVG body alone, so the label and data
 * attributes do not count, with the motion classes, their delays and the mask
 * ids taken out.
 */
const still = (html: string) =>
  html
    .slice(html.indexOf('<svg'))
    .replace(/ class="dash-mark-[a-z]+"/g, '')
    .replace(/ style="animation-delay:[^"]*"/g, '')
    .replace(/dash-mark-[^")]*/g, 'MASK');

describe('DashMark', () => {
  it('draws every state and every kind of work differently with the motion taken away', () => {
    const frames = [
      ...DASH_STATES.map((state) => still(render({ state }))),
      ...DASH_ACTIVITIES.map((activity) => still(render({ state: 'working', activity }))),
    ];
    expect(new Set(frames).size).toBe(DASH_STATES.length + DASH_ACTIVITIES.length);
  });

  it('keeps failed still, and moves everything else', () => {
    expect(render({ state: 'working' })).toContain('dash-mark-streak');
    expect(render({ state: 'done' })).toContain('dash-mark-flash');
    expect(render({ state: 'done' })).toContain('dash-mark-wave');
    expect(render({ state: 'idle' })).toContain('dash-mark-blink');
    expect(render({ state: 'failed' })).not.toMatch(/class="dash-mark-/);
  });

  it('shows a kind of work only while working', () => {
    expect(render({ state: 'working', activity: 'reading' })).toContain('dash-mark-read');
    expect(render({ state: 'working', activity: 'searching' })).toContain('dash-mark-ping');
    expect(render({ state: 'working', activity: 'writing' })).toContain('dash-mark-write');
    expect(render({ state: 'working', activity: 'thinking' })).toContain('dash-mark-ponder');
    expect(still(render({ state: 'idle', activity: 'reading' }))).toBe(still(render({ state: 'idle' })));
    expect(render({ state: 'done', activity: 'searching' })).not.toContain('data-dash-activity');
  });

  it('sleeps with its eyes shut until woken', () => {
    const html = render({ state: 'asleep' });
    expect(html).toContain('dash-mark-snooze');
    expect(html).toContain('aria-label="Dash is asleep"');
    expect(still(html)).not.toBe(still(render({ state: 'idle' })));
  });

  it('wears the brand ramp only when asked, and never when failed', () => {
    expect(render({})).not.toContain('linearGradient');
    const brand = render({ tone: 'brand', state: 'working' });
    expect(brand).toContain('<linearGradient');
    expect(brand).toMatch(/fill="url\(#dash-mark-[^)]+-ramp\)"/);
    expect(brand).toContain('data-dash-tone="brand"');
    const failed = render({ tone: 'brand', state: 'failed' });
    expect(failed).not.toContain('linearGradient');
    expect(failed).toContain('stroke="currentColor"');
  });

  it('gives each mark its own mask', () => {
    const html = renderToStaticMarkup(
      <>
        <DashMark />
        <DashMark />
      </>,
    );
    const ids = [...html.matchAll(/<mask id="([^"]+)"/g)].map((m) => m[1]);
    expect(ids).toHaveLength(2);
    expect(new Set(ids).size).toBe(2);
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
    for (const activity of DASH_ACTIVITIES) {
      expect(render({ state: 'working', activity })).toContain(
        `aria-label="${DASH_ACTIVITY_LABELS[activity]}"`,
      );
      expect(DASH_ACTIVITY_LABELS[activity]).toMatch(/^Dash/);
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

describe('its looks', () => {
  const STILL_STATES = ['idle', 'working', 'asleep'] as const;
  const hatMask = (html: string) => html.match(/<mask id="[^"]+-hat"/g) ?? [];

  it('draws nothing extra without a look', () => {
    for (const state of DASH_STATES) {
      const html = render({ state, tone: 'brand', size: 'lg' });
      expect(hatMask(html)).toHaveLength(0);
      expect(html).not.toContain('data-dash-look');
      expect(html).not.toContain('dash-mark-tip');
    }
  });

  it('wears each hat idle, working and asleep, and each reads differently in a still frame', () => {
    for (const state of STILL_STATES) {
      const frames = DASH_LOOKS.map((look) => {
        const html = render({ state, look });
        expect(hatMask(html)).toHaveLength(1);
        expect(html).toContain(`data-dash-look="${look}"`);
        return still(html);
      });
      frames.push(still(render({ state })));
      expect(new Set(frames).size).toBe(DASH_LOOKS.length + 1);
    }
  });

  it('wears the hat while working at any kind of work', () => {
    for (const activity of DASH_ACTIVITIES) {
      expect(hatMask(render({ state: 'working', activity, look: 'cowboy-hat' }))).toHaveLength(1);
    }
  });

  it('leaves the hat off under the flag', () => {
    for (const state of ['done', 'failed'] as const) {
      const html = render({ state, look: 'top-hat' });
      expect(hatMask(html)).toHaveLength(0);
      expect(html).not.toContain('data-dash-look');
    }
  });

  it('tips every hat but the ball cap while asleep', () => {
    expect(render({ state: 'asleep', look: 'top-hat' })).toContain('dash-mark-tip');
    expect(render({ state: 'asleep', look: 'cowboy-hat' })).toContain('dash-mark-tip');
    expect(render({ state: 'asleep', look: 'newsboy-cap' })).toContain('dash-mark-tip');
    expect(render({ state: 'asleep', look: 'ball-cap' })).not.toContain('dash-mark-tip');
    expect(render({ state: 'idle', look: 'top-hat' })).not.toContain('dash-mark-tip');
  });

  it('draws the hat in the colour of its place on the brand ramp', () => {
    const html = render({ state: 'idle', tone: 'brand', look: 'newsboy-cap' });
    expect(html).toMatch(/<g fill="currentColor" mask="url\(#[^)]+-hat\)"/);
  });
});

describe('its animations', () => {
  const css = readFileSync(join(process.cwd(), 'app/globals.css'), 'utf8');

  it('are defined as utilities', () => {
    for (const motion of MOTIONS) {
      expect(css).toMatch(new RegExp(`@utility dash-mark-${motion} \\{[^}]*animation: dash-mark-${motion} `));
    }
    expect(css).toMatch(/@utility dash-mark-flash \{[^}]*animation: dash-mark-flash var\(--motion-move\)/);
  });

  it('are entered in the reduced-motion block', () => {
    const block = css.slice(css.indexOf('@media (prefers-reduced-motion: reduce)'));
    const rule = block.slice(block.indexOf('.dash-mark-'), block.indexOf('}', block.indexOf('.dash-mark-')));
    expect(rule).toContain('animation: none');
    for (const motion of MOTIONS) expect(rule).toContain(`.dash-mark-${motion}`);
  });
});

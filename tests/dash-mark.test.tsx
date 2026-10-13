/**
 * The Dash mark (plan #1335): five states and four kinds of work, each its own
 * still image, named for a screen reader, moving in every state, and with its
 * motion switched off under reduced motion. The runner card's four Dashes each
 * have their own visor and colour.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import {
  DASH_ACTIVITIES,
  DASH_ACTIVITY_LABELS,
  DASH_RUNNERS,
  DASH_STATES,
  DASH_STATE_LABELS,
  DashMark,
} from '@/components/ui/dash-mark';

const render = (props: Parameters<typeof DashMark>[0]) =>
  renderToStaticMarkup(<DashMark {...props} />);

/** Every motion utility the mark uses, as named in app/globals.css. */
const MOTIONS = [
  'blink',
  'glance',
  'glow',
  'ember',
  'snooze',
  'pulse',
  'streak',
  'read',
  'sweep',
  'ping',
  'write',
  'caret',
  'ponder',
  'bob',
  'flicker',
] as const;

/**
 * What a still frame shows: the SVG body alone, so the label and data
 * attributes do not count, with the motion classes, their delays and the ids
 * taken out.
 */
const still = (html: string) =>
  html
    .slice(html.indexOf('<svg'))
    .replace(/ class="dash-mark-[a-z]+"/g, '')
    .replace(/ style="animation-delay:[^"]*"/g, '')
    .replace(/dash-mark-[^")]*/g, 'ID');

/** The outline of the visor: the first path the clip is cut from. */
const visor = (html: string) => html.match(/<clipPath id="[^"]+"><path d="([^"]+)"/)?.[1];

describe('DashMark', () => {
  it('draws every state and every kind of work differently with the motion taken away', () => {
    const frames = [
      ...DASH_STATES.map((state) => still(render({ state }))),
      ...DASH_ACTIVITIES.map((activity) => still(render({ state: 'working', activity }))),
    ];
    expect(new Set(frames).size).toBe(DASH_STATES.length + DASH_ACTIVITIES.length);
  });

  it('moves in every state, resting by default', () => {
    expect(render({})).toContain('data-dash-state="idle"');
    expect(render({ state: 'idle' })).toContain('dash-mark-glow');
    expect(render({ state: 'idle' })).toContain('dash-mark-glance');
    expect(render({ state: 'idle' })).toContain('dash-mark-blink');
    expect(render({ state: 'working' })).toContain('dash-mark-streak');
    expect(render({ state: 'working' })).toContain('dash-mark-pulse');
    expect(render({ state: 'asleep' })).toContain('dash-mark-ember');
    expect(render({ state: 'done' })).toContain('dash-mark-bob');
    expect(render({ state: 'failed' })).toContain('dash-mark-flicker');
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

  it('wears the brand ramp only when asked, and has no core when failed', () => {
    expect(render({})).not.toContain('-core"');
    const brand = render({ tone: 'brand', state: 'working' });
    expect(brand).toMatch(/<linearGradient id="[^"]+-core"/);
    expect(brand).toMatch(/fill="url\(#dash-mark-[^)]+-core\)"/);
    expect(brand).toContain('data-dash-tone="brand"');
    const failed = render({ tone: 'brand', state: 'failed' });
    expect(failed).not.toMatch(/fill="url\(#dash-mark-[^)]+-core\)"/);
    expect(failed).toContain('stroke:currentColor');
  });

  it('gives each mark its own ids', () => {
    const html = renderToStaticMarkup(
      <>
        <DashMark />
        <DashMark />
      </>,
    );
    const ids = [...html.matchAll(/<clipPath id="([^"]+)"/g)].map((m) => m[1]);
    expect(ids).toHaveLength(2);
    expect(new Set(ids).size).toBe(2);
  });

  it('tints its glass and draws its edge only on a light page', () => {
    const html = render({ tone: 'brand' });
    expect(html).toContain('light-dark(color-mix(in srgb');
    expect(html).toContain('light-dark(rgb(255 255 255');
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

describe('the runners', () => {
  it('keeps the capsule for Dash and gives each runner its own visor', () => {
    const shapes = [visor(render({})), ...DASH_RUNNERS.map((runner) => visor(render({ runner })))];
    expect(new Set(shapes).size).toBe(DASH_RUNNERS.length + 1);
  });

  it('wears its own colour in every state, whatever the tone', () => {
    for (const runner of DASH_RUNNERS) {
      for (const state of ['idle', 'working', 'asleep'] as const) {
        const html = render({ state, runner, tone: 'current' });
        expect(html).toContain(`data-dash-runner="${runner}"`);
        expect(html).toMatch(/<linearGradient id="[^"]+-core"/);
        expect(html).not.toContain('data-dash-tone');
      }
    }
  });

  it('moves in every state', () => {
    for (const runner of DASH_RUNNERS) {
      expect(render({ runner, state: 'idle' })).toContain('dash-mark-glow');
      expect(render({ runner, state: 'asleep' })).toContain('dash-mark-ember');
      expect(render({ runner, state: 'working' })).toContain('dash-mark-streak');
    }
  });
});

describe('its animations', () => {
  const css = readFileSync(join(process.cwd(), 'app/globals.css'), 'utf8');

  it('are defined as utilities', () => {
    for (const motion of MOTIONS) {
      expect(css).toMatch(new RegExp(`@utility dash-mark-${motion} \\{[^}]*animation: dash-mark-${motion} `));
    }
  });

  it('are entered in the reduced-motion block', () => {
    const block = css.slice(css.indexOf('@media (prefers-reduced-motion: reduce)'));
    const rule = block.slice(block.indexOf('.dash-mark-'), block.indexOf('}', block.indexOf('.dash-mark-')));
    expect(rule).toContain('animation: none');
    for (const motion of MOTIONS) expect(rule).toContain(`.dash-mark-${motion}`);
  });
});

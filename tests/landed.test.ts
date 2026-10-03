/**
 * Where capture says an item went (plan #1333), checked without a browser:
 * the words, where they are drawn, and that reduced motion keeps the name
 * while dropping the pulse.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { captureAction } from '@/lib/capture/actions';
import { captureDestination, goalsPlaceName, todoDayName } from '@/lib/capture/destination';
import { LANDED_PULSE_MS, settle, namePosition } from '@/components/motion/settle';
import { MOTION_MS } from '@/lib/motion';
import type { FiledEntry } from '@/lib/goals/capture';

const todo = captureAction('todo')!;
const goals = captureAction('goals')!;

const close = (goal_title: string, undone_at: string | null = null): FiledEntry => ({
  kind: 'close',
  step_id: 's',
  title: 't',
  goal_title,
  undone_at,
});

describe('the destination name', () => {
  it('names a todo by its day', () => {
    expect(captureDestination(todo, { day: 'today' })).toEqual({
      module: 'todo',
      href: '/todo',
      name: 'Todo · Today',
    });
    expect(todoDayName('tomorrow')).toBe('Tomorrow');
    expect(todoDayName('2026-10-03')).toBe('3 Oct');
    expect(todoDayName('')).toBe('No day');
  });

  it('names a goal entry by the goal it went to', () => {
    expect(captureDestination(goals, { day: '', entries: [close('Run a half')] })).toEqual({
      module: 'goals',
      href: '/goals',
      name: 'Goals · Run a half',
    });
    expect(goalsPlaceName([close('A'), close('B'), close('A')])).toBe('2 goals');
    expect(goalsPlaceName([close('A', '2026-10-01')])).toBe('Home');
    expect(goalsPlaceName([])).toBe('Home');
  });
});

describe('namePosition', () => {
  const view = { width: 1280, height: 800 };
  const size = { width: 100, height: 24 };
  const box = (left: number, top: number, width: number, height: number) => ({
    left,
    top,
    width,
    height,
    right: left + width,
    bottom: top + height,
  });

  it('goes to the right of a row in the column', () => {
    expect(namePosition(box(8, 100, 200, 32), size, view)).toEqual({ left: 216, top: 104 });
  });

  it('goes above a dock tab, kept on screen', () => {
    const phone = { width: 390, height: 844 };
    expect(namePosition(box(310, 780, 78, 64), size, phone)).toEqual({ left: 282, top: 748 });
  });

  it('goes below when above is off the top', () => {
    const phone = { width: 390, height: 844 };
    expect(namePosition(box(300, 10, 80, 32), size, phone)).toEqual({ left: 282, top: 50 });
  });
});

class StubElement {
  className = '';
  textContent = '';
  offsetWidth = 100;
  offsetHeight = 24;
  style: Record<string, string> = {};
  removed = false;
  attrs: Record<string, string> = {};
  classes = new Set<string>();
  classList = {
    add: (c: string) => this.classes.add(c),
    remove: (c: string) => this.classes.delete(c),
  };
  setAttribute(name: string, value: string) {
    this.attrs[name] = value;
  }
  remove() {
    this.removed = true;
  }
  getBoundingClientRect() {
    return { left: 8, top: 100, width: 200, height: 32, right: 208, bottom: 132 };
  }
}

function stubBrowser(reduced: boolean) {
  const appended: StubElement[] = [];
  vi.stubGlobal('HTMLElement', StubElement);
  vi.stubGlobal('window', {
    innerWidth: 1280,
    innerHeight: 800,
    matchMedia: (query: string) => ({ matches: reduced && query.includes('reduce') }),
  });
  vi.stubGlobal('document', {
    createElement: () => new StubElement(),
    body: { appendChild: (el: StubElement) => appended.push(el) },
  });
  return { appended };
}

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe('settle', () => {
  it('pulses the place and names it beside it', async () => {
    vi.useFakeTimers();
    const { appended } = stubBrowser(false);
    const target = new StubElement();
    settle(target as unknown as Element, 'Todo · Today');
    expect(target.classes.has('landed-pulse')).toBe(true);
    expect(appended).toHaveLength(1);
    expect(appended[0].textContent).toBe('Todo · Today');
    expect(appended[0].attrs.role).toBe('status');
    expect(appended[0].style.left).toBe('216px');
    await vi.advanceTimersByTimeAsync(LANDED_PULSE_MS + 40);
    expect(target.classes.has('landed-pulse')).toBe(false);
  });

  it('keeps the name and drops the pulse under reduced motion', () => {
    vi.useFakeTimers();
    const { appended } = stubBrowser(true);
    const target = new StubElement();
    settle(target as unknown as Element, 'Goals · Home');
    expect(target.classes.size).toBe(0);
    expect(appended.map((el) => el.textContent)).toEqual(['Goals · Home']);
  });

  it('replaces the name on a second filing rather than stacking', () => {
    vi.useFakeTimers();
    const { appended } = stubBrowser(true);
    const target = new StubElement();
    settle(target as unknown as Element, 'Todo · Today');
    settle(target as unknown as Element, 'Todo · Tomorrow');
    expect(appended[0].removed).toBe(true);
    expect(appended[1].removed).toBe(false);
  });
});

describe('the landed-pulse keyframes', () => {
  const css = readFileSync(join(process.cwd(), 'app/globals.css'), 'utf8');

  it('run for LANDED_PULSE_MS, under a second', () => {
    const utility = css.match(/@utility landed-pulse \{[^}]*\}/)?.[0] ?? '';
    expect(utility).toContain('animation: landed-pulse var(--motion-move)');
    expect(LANDED_PULSE_MS).toBe(MOTION_MS.move);
    expect(LANDED_PULSE_MS).toBeLessThan(1000);
  });

  it('are entered in the reduced-motion block', () => {
    const block = css.slice(css.indexOf('@media (prefers-reduced-motion: reduce)'));
    expect(block).toMatch(/\.landed-pulse \{\s*animation: none;/);
  });
});

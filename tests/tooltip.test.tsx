/**
 * When the Tooltip shows and hides. There is no DOM in this suite, so the
 * timing lives in `lib/tooltip-controller.ts` and is driven here with a
 * hand-turned clock; the markup test pins what the component draws around it.
 */
import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { Tooltip } from '@/components/ui/tooltip';
import { createTooltipController, type TooltipTimers } from '@/lib/tooltip-controller';

function setup(delay = 400) {
  let now = 0;
  let next = 1;
  const pending = new Map<number, { at: number; run: () => void }>();
  const timers: TooltipTimers = {
    set: (run, ms) => {
      const id = next++;
      pending.set(id, { at: now + ms, run });
      return id;
    },
    clear: (id) => void pending.delete(id as number),
  };
  const changes: boolean[] = [];
  const controller = createTooltipController({
    delay,
    timers,
    onChange: (open) => changes.push(open),
  });
  const advance = (ms: number) => {
    now += ms;
    for (const [id, t] of [...pending]) {
      if (t.at <= now) {
        pending.delete(id);
        t.run();
      }
    }
  };
  return { controller, changes, advance };
}

describe('tooltip controller', () => {
  it('opens only after the delay', () => {
    const { controller, changes, advance } = setup();
    controller.ask();
    advance(399);
    expect(controller.isOpen()).toBe(false);
    advance(1);
    expect(controller.isOpen()).toBe(true);
    expect(changes).toEqual([true]);
  });

  it('shows nothing when the pointer leaves before the delay', () => {
    const { controller, changes, advance } = setup();
    controller.ask();
    advance(200);
    controller.hide();
    advance(1000);
    expect(controller.isOpen()).toBe(false);
    expect(changes).toEqual([]);
  });

  it('hides at once on blur, Escape or pointer leave', () => {
    const { controller, changes, advance } = setup();
    for (let i = 0; i < 3; i++) {
      controller.ask();
      advance(400);
      expect(controller.isOpen()).toBe(true);
      controller.hide();
      expect(controller.isOpen()).toBe(false);
    }
    expect(changes).toEqual([true, false, true, false, true, false]);
  });

  it('does not reopen after Escape until asked again', () => {
    const { controller, advance } = setup();
    controller.ask();
    advance(400);
    controller.hide();
    advance(2000);
    expect(controller.isOpen()).toBe(false);
    controller.ask();
    advance(400);
    expect(controller.isOpen()).toBe(true);
  });

  it('hides a tooltip that started open', () => {
    const changes: boolean[] = [];
    const controller = createTooltipController({
      initiallyOpen: true,
      onChange: (open) => changes.push(open),
    });
    controller.hide();
    expect(changes).toEqual([false]);
  });

  it('counts one ask when hover and focus both arrive', () => {
    const { controller, changes, advance } = setup();
    controller.ask();
    controller.ask();
    advance(400);
    expect(changes).toEqual([true]);
  });
});

describe('Tooltip', () => {
  const markup = (defaultOpen: boolean) =>
    renderToStaticMarkup(
      <Tooltip label="Needs a reply" defaultOpen={defaultOpen}>
        <button type="button" aria-label="Waiting">
          !
        </button>
      </Tooltip>,
    );

  it('draws only the child while closed, with its own label', () => {
    const html = markup(false);
    expect(html).toContain('aria-label="Waiting"');
    expect(html).not.toContain('role="tooltip"');
    expect(html).not.toContain('aria-describedby');
  });

  it('draws the tip on the popover surface and describes the child by it', () => {
    const html = markup(true);
    expect(html).toContain('role="tooltip"');
    expect(html).toContain('popover-panel');
    expect(html).toContain('Needs a reply');
    expect(html).toContain('aria-label="Waiting"');
    const id = /aria-describedby="([^"]+)"/.exec(html)?.[1];
    expect(id).toBeTruthy();
    expect(html).toContain(`id="${id}"`);
  });
});

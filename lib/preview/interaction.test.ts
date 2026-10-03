import { describe, expect, it } from 'vitest';
import {
  FRAME_MS,
  INTERACTIONS_SCRIPT_ID,
  frameTimes,
  inputEvents,
  phaseAt,
  pointerAt,
  readInteractions,
  recordLength,
  stripGrid,
  writeInteractions,
  type Interaction,
} from './interaction';

const swipe: Interaction = {
  kind: 'swipe',
  target: '[data-quick-swipe]',
  direction: 'left',
  shows: 'The card follows the finger left and slides off.',
};
const press: Interaction = { kind: 'press', target: 'button', shows: 'The button dips.' };
const box = { x: 16, y: 100, width: 358, height: 600 };

describe('frameTimes / recordLength', () => {
  it('takes 21 frames, 50ms apart, over a second', () => {
    const times = frameTimes(recordLength(swipe));
    expect(times).toHaveLength(21);
    expect(times[0]).toBe(0);
    expect(times[1]).toBe(FRAME_MS);
    expect(times.at(-1)).toBe(1000);
  });

  it('never records longer than a second', () => {
    expect(recordLength({ ...press, durationMs: 5000 })).toBe(1000);
    expect(recordLength({ ...press, durationMs: 400 })).toBe(400);
  });
});

describe('inputEvents', () => {
  it('leaves the first frame at rest', () => {
    for (const interaction of [swipe, press]) {
      const events = inputEvents(interaction, box, 844);
      expect(Math.min(...events.map((event) => event.at))).toBeGreaterThan(0);
      expect(phaseAt(events, 0)).toBe('at rest');
    }
  });

  it('drags a swipe left past a third of the target, on frame times', () => {
    const events = inputEvents(swipe, box, 844);
    expect(events.every((event) => event.device === 'touch' && event.at % FRAME_MS === 0)).toBe(
      true,
    );
    const down = events[0]!;
    const lastMove = events.filter((event) => event.phase === 'move').at(-1)!;
    expect(down.phase).toBe('down');
    expect(events.at(-1)!.phase).toBe('up');
    expect(down.x - lastMove.x).toBeGreaterThan(box.width / 3);
    // Every point stays on the target.
    for (const event of events) {
      expect(event.x).toBeGreaterThanOrEqual(box.x);
      expect(event.x).toBeLessThanOrEqual(box.x + box.width);
    }
  });

  it('keeps the point on screen when the target runs below the window', () => {
    const tall = { x: 0, y: 200, width: 390, height: 3000 };
    const [down] = inputEvents(swipe, tall, 844);
    expect(down!.y).toBe(522);
  });

  it('plays a press as a mouse press held briefly at the centre', () => {
    const events = inputEvents(press, box, 844);
    expect(events.map((event) => [event.device, event.phase])).toEqual([
      ['mouse', 'down'],
      ['mouse', 'up'],
    ]);
    expect(events[0]!.x).toBe(195);
  });
});

describe('phaseAt / pointerAt', () => {
  const events = inputEvents(swipe, box, 844);

  it('names what the finger is doing at each frame', () => {
    expect(phaseAt(events, 50)).toBe('finger down');
    expect(phaseAt(events, 100)).toBe('dragging');
    expect(phaseAt(events, 1000)).toBe('let go');
    expect(phaseAt(inputEvents(press, box, 844), 50)).toBe('pressed');
  });

  it('places the finger while it is down and nowhere after', () => {
    expect(pointerAt(events, 0)).toBeNull();
    expect(pointerAt(events, 100)).not.toBeNull();
    expect(pointerAt(events, 1000)).toBeNull();
  });
});

describe('stripGrid', () => {
  it('lays a second of frames out in three rows of seven', () => {
    expect(stripGrid(21)).toEqual({ columns: 7, rows: 3 });
    expect(stripGrid(3)).toEqual({ columns: 3, rows: 1 });
  });
});

describe('readInteractions / writeInteractions', () => {
  it('round-trips through the index HTML, even with a closing tag in the text', () => {
    const declared = { 'news-quick-story': { ...swipe, shows: 'a </script> b' } };
    const html = `<div><script type="application/json" id="${INTERACTIONS_SCRIPT_ID}">${writeInteractions(declared)}</script></div>`;
    expect(readInteractions(html)).toEqual(declared);
  });

  it('reads an index with no block as none', () => {
    expect(readInteractions('<ul></ul>')).toEqual({});
  });
});

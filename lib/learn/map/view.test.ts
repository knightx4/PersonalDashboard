import { describe, expect, it } from 'vitest';
import {
  DEFAULT_PARAMS,
  anchorAt,
  domainSlots,
  framePosition,
  labelsThatFit,
  mapHref,
  markOf,
  parseMapParams,
  similarityText,
  type AreaLabel,
} from './view';

describe('the address', () => {
  it('reads the defaults from an empty address', () => {
    expect(parseMapParams({})).toEqual(DEFAULT_PARAMS);
  });

  it('reads each switch, and ignores values it does not know', () => {
    expect(parseMapParams({ layout: 'axes', colour: 'domain', labels: 'on', idea: 'abc' })).toEqual({
      layout: 'axes',
      colour: 'domain',
      labels: true,
      idea: 'abc',
    });
    expect(parseMapParams({ layout: 'spiral', colour: ['domain', 'state'], idea: '  ' })).toEqual({
      ...DEFAULT_PARAMS,
      colour: 'domain',
    });
  });

  it('leaves defaults out of the address and round-trips the rest', () => {
    expect(mapHref(DEFAULT_PARAMS)).toBe('/learn/know/space');
    const href = mapHref(DEFAULT_PARAMS, { layout: 'axes', labels: true, idea: 'x1' });
    expect(href).toBe('/learn/know/space?layout=axes&labels=on&idea=x1');
    const search = Object.fromEntries(new URL(href, 'http://h').searchParams);
    expect(parseMapParams(search)).toEqual({ ...DEFAULT_PARAMS, layout: 'axes', labels: true, idea: 'x1' });
  });

  it('closes an idea by setting it to null', () => {
    expect(mapHref({ ...DEFAULT_PARAMS, idea: 'x1' }, { idea: null })).toBe('/learn/know/space');
  });
});

describe('placing on the frame', () => {
  it('maps the corners inside the inset, with y pointing up', () => {
    expect(framePosition({ x: -1, y: 1 })).toEqual({ left: 4, top: 4 });
    expect(framePosition({ x: 1, y: -1 })).toEqual({ left: 96, top: 96 });
    expect(framePosition({ x: 0, y: 0 })).toEqual({ left: 50, top: 50 });
  });

  it('holds a point outside the square at its edge', () => {
    expect(framePosition({ x: 1.4, y: -2 })).toEqual({ left: 96, top: 96 });
  });

  it('hangs labels inwards near the edges', () => {
    expect(anchorAt(10)).toBe('start');
    expect(anchorAt(50)).toBe('middle');
    expect(anchorAt(90)).toBe('end');
  });
});

describe('marks', () => {
  it('names six states as the four the screen says', () => {
    expect(markOf('sharp')).toBe('known');
    expect(markOf('known')).toBe('known');
    expect(markOf('recognised')).toBe('getting-there');
    expect(markOf('shaky')).toBe('getting-there');
    expect(markOf('misconception')).toBe('mixed-up');
    expect(markOf('unknown')).toBe('unseen');
  });

  it('gives the three colours to the domains with most ideas, and none to an empty one', () => {
    const slots = domainSlots([
      { id: 'a', name: 'Arts', ideaCount: 4 },
      { id: 'h', name: 'History', ideaCount: 39 },
      { id: 's', name: 'Social sciences', ideaCount: 273 },
      { id: 't', name: 'Technology', ideaCount: 4 },
      { id: 'm', name: 'Maths', ideaCount: 0 },
    ]);
    expect([...slots]).toEqual([
      ['s', 0],
      ['h', 1],
      ['a', 2],
    ]);
  });

  it('writes a similarity to two places', () => {
    expect(similarityText(0.8649)).toBe('0.86');
  });
});

describe('labels', () => {
  const label = (id: string, left: number, top: number, priority: number, text = 'Economics'): AreaLabel => ({
    id,
    text,
    kind: 'field',
    left,
    top,
    priority,
  });

  it('keeps the higher priority of two that collide', () => {
    const kept = labelsThatFit([label('low', 50, 50, 1), label('high', 51, 50, 9)], 340);
    expect([...kept]).toEqual(['high']);
  });

  it('keeps both when the frame is wide enough to part them', () => {
    const labels = [label('a', 45, 50, 1), label('b', 55, 50, 2)];
    expect(labelsThatFit(labels, 340).size).toBe(1);
    expect(labelsThatFit(labels, 1200).size).toBe(2);
  });
});

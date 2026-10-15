import { describe, expect, it } from 'vitest';
import type { Place } from './places';
import {
  MAP_HEIGHT,
  MAP_WIDTH,
  fitFrame,
  moveInOrder,
  placeDots,
  positionAt,
  projectionOf,
  checkPosition,
  splitByPosition,
  worldFrame,
} from './places-map';
import { drawPlaceMap, drawPlacesMap, drawWorldMap } from './places-map-outlines';

function place(id: string, movedIn: string, movedOut: string | null, at: [number, number] | null): Place {
  return {
    id,
    name: id,
    city: null,
    region: null,
    country: null,
    movedIn,
    movedOut,
    note: null,
    latitude: at ? at[0] : null,
    longitude: at ? at[1] : null,
  };
}

const AUSTIN: [number, number] = [30.27, -97.74];
const HOUSTON: [number, number] = [29.76, -95.37];
const NEW_YORK: [number, number] = [40.71, -74.01];

describe('the places map', () => {
  it('splits places by whether they have a position', () => {
    const { onMap, offMap } = splitByPosition([place('a', '2019', null, AUSTIN), place('b', '2015', '2019', null)]);
    expect(onMap.map((p) => p.id)).toEqual(['a']);
    expect(offMap.map((p) => p.id)).toEqual(['b']);
  });

  it('orders by move-in, oldest first', () => {
    const order = moveInOrder([place('c', '2020', null, null), place('a', '2010', '2015', null), place('b', '2015-03', '2020', null)]);
    expect(order.map((p) => p.id)).toEqual(['a', 'b', 'c']);
  });

  it('fits every position inside the view', () => {
    const frame = fitFrame([
      [AUSTIN[1], AUSTIN[0]],
      [NEW_YORK[1], NEW_YORK[0]],
    ]);
    const projection = projectionOf(frame);
    for (const [lat, lon] of [AUSTIN, NEW_YORK]) {
      const [x, y] = projection([lon, lat])!;
      expect(x).toBeGreaterThan(0);
      expect(x).toBeLessThan(MAP_WIDTH);
      expect(y).toBeGreaterThan(0);
      expect(y).toBeLessThan(MAP_HEIGHT);
    }
  });

  it('turns a point on the drawing back into the position it shows', () => {
    const frame = fitFrame([[AUSTIN[1], AUSTIN[0]]]);
    const [x, y] = projectionOf(frame)([AUSTIN[1], AUSTIN[0]])!;
    const back = positionAt(frame, x, y)!;
    expect(back.latitude).toBeCloseTo(AUSTIN[0], 4);
    expect(back.longitude).toBeCloseTo(AUSTIN[1], 4);
  });

  it('fans places in one city apart and keeps the dots in move-in order', () => {
    const places = [
      place('later', '2018', null, AUSTIN),
      place('first', '2010', '2014', AUSTIN),
      place('away', '2014', '2018', NEW_YORK),
    ];
    const frame = fitFrame(places.map((p) => [p.longitude!, p.latitude!]));
    const dots = placeDots(places, projectionOf(frame));
    expect(dots.map((d) => d.id)).toEqual(['first', 'away', 'later']);
    const [first, away, later] = dots;
    expect(Math.hypot(first.x - later.x, first.y - later.y)).toBeGreaterThan(40);
    const [ax, ay] = projectionOf(frame)([NEW_YORK[1], NEW_YORK[0]])!;
    expect(away.x).toBeCloseTo(ax, 0);
    expect(away.y).toBeCloseTo(ay, 0);
    expect(later.current).toBe(true);
    expect(later.label).toBe('later, 2018 to now');
  });

  it('draws outlines, a line and a dot per positioned place', () => {
    const drawing = drawPlacesMap([
      place('austin', '2010', '2014', AUSTIN),
      place('houston', '2014', '2018', HOUSTON),
      place('nyc', '2018', null, NEW_YORK),
      place('nowhere', '2005', '2010', null),
    ])!;
    expect(drawing.dots).toHaveLength(3);
    expect(drawing.land.length).toBeGreaterThan(100);
    expect(drawing.states.length).toBeGreaterThan(100);
    // Through every dot as drawn, oldest move first.
    const [a, h, n] = drawing.dots;
    expect(drawing.route).toBe(`M${a.x},${a.y}L${h.x},${h.y}L${n.x},${n.y}`);
    // Clipped to the view, so a US map does not carry the whole world.
    expect(drawing.land.length + drawing.borders.length + drawing.states.length).toBeLessThan(200_000);
  });

  it('draws nothing when no place has a position', () => {
    expect(drawPlacesMap([place('nowhere', '2005', null, null)])).toBeNull();
  });
});

describe('placing a place by hand (plan #2091.5)', () => {
  it('takes a position in range, rounded, and refuses anything else', () => {
    expect(checkPosition({ latitude: 30.123456, longitude: -97.987654 })).toEqual({
      latitude: 30.1235,
      longitude: -97.9877,
    });
    expect(checkPosition({ latitude: 91, longitude: 0 })).toBeNull();
    expect(checkPosition({ latitude: 0, longitude: -181 })).toBeNull();
    expect(checkPosition({ latitude: '30', longitude: 0 })).toBeNull();
    expect(checkPosition({ latitude: Number.NaN, longitude: 0 })).toBeNull();
    expect(checkPosition(null)).toBeNull();
  });

  it('turns a press on the whole world back into the position it shows', () => {
    const frame = worldFrame();
    const [x, y] = projectionOf(frame)([NEW_YORK[1], NEW_YORK[0]])!;
    expect(x).toBeGreaterThan(0);
    expect(x).toBeLessThan(MAP_WIDTH);
    expect(y).toBeGreaterThan(0);
    expect(y).toBeLessThan(MAP_HEIGHT);
    const back = positionAt(frame, x, y)!;
    expect(back.latitude).toBeCloseTo(NEW_YORK[0], 4);
    expect(back.longitude).toBeCloseTo(NEW_YORK[1], 4);
  });

  it("shows a place's own region with its dot alone", () => {
    const home = place('home', '2018', null, AUSTIN);
    const { drawing } = drawPlaceMap(home, [home, place('away', '2010', '2018', NEW_YORK)]);
    expect(drawing!.dots.map((d) => d.id)).toEqual(['home']);
    expect(drawing!.route).toBe('');
  });

  it('shows the region of the other places for a place with no position, with no dot', () => {
    const lost = place('lost', '2000', '2005', null);
    const { drawing } = drawPlaceMap(lost, [lost, place('austin', '2010', null, AUSTIN)]);
    expect(drawing!.dots).toEqual([]);
    const [x, y] = projectionOf(drawing!.frame)([AUSTIN[1], AUSTIN[0]])!;
    expect(x).toBeCloseTo(MAP_WIDTH / 2, 0);
    expect(y).toBeGreaterThan(0);
    expect(y).toBeLessThan(MAP_HEIGHT);
  });

  it('leaves the map undrawn when nothing has a position, and draws the world on request without state borders', () => {
    const lost = place('lost', '2000', null, null);
    expect(drawPlaceMap(lost, [lost]).drawing).toBeNull();
    const world = drawWorldMap();
    expect(world.dots).toEqual([]);
    expect(world.states).toBe('');
    expect(world.land.length).toBeGreaterThan(1000);
  });
});

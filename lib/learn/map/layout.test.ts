import { describe, expect, it } from 'vitest';
import { cosine, fitToSquare, forceLayout, principalComponents, project, type Link } from './layout';

describe('principalComponents', () => {
  // Spread 2 along x, 1 along y, nothing along z: the variance splits 4 to 1.
  const vectors = [
    [2, 0, 5],
    [-2, 0, 5],
    [0, 1, 5],
    [0, -1, 5],
  ];

  it('finds the axes in order of variance and reports the share each keeps', () => {
    const { projection } = principalComponents(vectors);
    expect(projection.variance[0]).toBeCloseTo(0.8, 6);
    expect(projection.variance[1]).toBeCloseTo(0.2, 6);
    expect(Math.abs(projection.components[0][0]!)).toBeCloseTo(1, 6);
    expect(Math.abs(projection.components[1][1]!)).toBeCloseTo(1, 6);
    expect(projection.mean).toEqual([0, 0, 5]);
  });

  it('turns each component so its entries sum to a positive number', () => {
    const { projection } = principalComponents(vectors);
    for (const component of projection.components) {
      expect(component.reduce((sum, value) => sum + value, 0)).toBeGreaterThan(0);
    }
  });

  it('scales the points into the -1 to 1 square, keeping their shape', () => {
    const { points } = principalComponents(vectors);
    expect(points[0]!.x).toBeCloseTo(1, 6);
    expect(points[1]!.x).toBeCloseTo(-1, 6);
    expect(points[2]!.y).toBeCloseTo(0.5, 6);
    expect(points[3]!.y).toBeCloseTo(-0.5, 6);
  });

  it('gives the same answer every time', () => {
    const wide = Array.from({ length: 30 }, (_, i) => Array.from({ length: 64 }, (_, j) => Math.sin(i * 7 + j * 3)));
    expect(principalComponents(wide)).toEqual(principalComponents(wide));
  });

  it('puts a vector it was worked out from where the map put it', () => {
    const { points, projection } = principalComponents(vectors);
    vectors.forEach((vector, i) => {
      const placed = project(vector, projection);
      expect(placed.x).toBeCloseTo(points[i]!.x, 6);
      expect(placed.y).toBeCloseTo(points[i]!.y, 6);
    });
  });

  it('copes with nothing, one vector and vectors all the same', () => {
    expect(principalComponents([]).points).toEqual([]);
    const one = principalComponents([[1, 2, 3]]);
    expect(one.points).toEqual([{ x: 0, y: 0 }]);
    expect(one.projection.variance).toEqual([0, 0]);
    const same = principalComponents([
      [1, 1],
      [1, 1],
    ]);
    expect(same.points.every((p) => p.x === 0 && p.y === 0)).toBe(true);
  });

  it('refuses vectors of different widths', () => {
    expect(() => principalComponents([[1, 2], [1]])).toThrow(/dimensions/);
  });
});

describe('cosine', () => {
  it('is the cosine of the angle, and zero against a zero vector', () => {
    expect(cosine([1, 0], [0, 1])).toBe(0);
    expect(cosine([1, 1], [2, 2])).toBeCloseTo(1, 12);
    expect(cosine([1, 0], [-1, 0])).toBe(-1);
    expect(cosine([0, 0], [1, 0])).toBe(0);
  });
});

describe('fitToSquare', () => {
  it('centres the bounding box and makes the longer side span -1 to 1', () => {
    const { points, frame } = fitToSquare([
      { x: 10, y: 0 },
      { x: 14, y: 1 },
    ]);
    expect(points).toEqual([
      { x: -1, y: -0.25 },
      { x: 1, y: 0.25 },
    ]);
    expect(frame).toEqual({ cx: 12, cy: 0.5, scale: 0.5 });
  });

  it('puts a single point at the origin', () => {
    expect(fitToSquare([{ x: 3, y: 4 }]).points).toEqual([{ x: 0, y: 0 }]);
  });
});

describe('forceLayout', () => {
  // Two groups of five, linked within each group and not across, started
  // jumbled together.
  const seeds = Array.from({ length: 10 }, (_, i) => ({ x: Math.cos(i * 2.4) * 0.3, y: Math.sin(i * 2.4) * 0.3 }));
  const links: Link[] = [];
  for (const group of [0, 5]) {
    for (let a = group; a < group + 5; a++) {
      for (let b = a + 1; b < group + 5; b++) links.push({ a, b, weight: 0.9 });
    }
  }

  function mean(values: number[]): number {
    return values.reduce((sum, value) => sum + value, 0) / values.length;
  }

  it('pulls linked ideas together and keeps unlinked groups apart', () => {
    const points = forceLayout(seeds, links);
    const distance = (i: number, j: number) => Math.hypot(points[i]!.x - points[j]!.x, points[i]!.y - points[j]!.y);
    const within: number[] = [];
    const across: number[] = [];
    for (let i = 0; i < 10; i++) {
      for (let j = i + 1; j < 10; j++) (i < 5 === j < 5 ? within : across).push(distance(i, j));
    }
    expect(mean(within)).toBeLessThan(mean(across) / 2);
  });

  it('fits the result into the -1 to 1 square and gives the same answer every time', () => {
    const points = forceLayout(seeds, links);
    expect(points.every((p) => Math.abs(p.x) <= 1 + 1e-9 && Math.abs(p.y) <= 1 + 1e-9)).toBe(true);
    expect(Math.max(...points.map((p) => Math.max(Math.abs(p.x), Math.abs(p.y))))).toBeCloseTo(1, 9);
    expect(forceLayout(seeds, links)).toEqual(points);
  });

  it('parts ideas that start in the same place', () => {
    const points = forceLayout(
      [
        { x: 0, y: 0 },
        { x: 0, y: 0 },
        { x: 0, y: 0 },
      ],
      [],
    );
    expect(new Set(points.map((p) => `${p.x.toFixed(6)},${p.y.toFixed(6)}`)).size).toBe(3);
  });

  it('copes with no ideas and with one', () => {
    expect(forceLayout([], [])).toEqual([]);
    expect(forceLayout([{ x: 5, y: 5 }], [])).toEqual([{ x: 0, y: 0 }]);
  });
});

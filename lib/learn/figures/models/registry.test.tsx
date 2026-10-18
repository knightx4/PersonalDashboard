import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { Figure } from '@/components/learn/figure';
import { SURFACE_ROUTES } from '@/lib/preview/routes';
import { explorableKind } from '../kinds/explorable';
import { ExplorableMoved } from '../kinds/explorable-view';
import { readWrittenFigures } from '../registry';
import { EXPLORABLE_MODELS, explorableWriterList } from './registry';
import { equilibrium } from './supply-demand-curves';
import {
  DISTANCE_MAX,
  FARM_RENT,
  cityEdge,
  homeBid,
  officeBid,
  officesEnd,
  rentAt,
} from './bid-rent-curves';
import { OUTPUT_MAX, bestSize, outputAt, peak } from './agglomeration-curves';
import { moveOf, predictMoveForm } from '../questions/predict-move';
import { modelSurface, onScale, startingValues, type ExplorableModel } from './types';

/** Gallery ids read from source, as the figure registry's test reads them. */
const GALLERY = (() => {
  const text = readFileSync(join(process.cwd(), 'app/preview/surfaces.tsx'), 'utf8');
  return new Set(
    [...text.slice(text.indexOf('export const SURFACES')).matchAll(/^ {4}id: '([^']+)'/gm)].map(
      (m) => m[1],
    ),
  );
})();

function draw(
  model: ExplorableModel,
  start: Record<string, number>,
  moved?: Record<string, number>,
): string {
  const figure = (
    <Figure
      figure={{
        kind: 'explorable',
        caption: model.example.caption,
        spec: { model: model.id, start },
      }}
    />
  );
  return renderToStaticMarkup(
    moved ? <ExplorableMoved moved={{ [model.id]: moved }}>{figure}</ExplorableMoved> : figure,
  );
}

describe('the explorable model registry (plan #2321.7)', () => {
  it('names each model once', () => {
    const ids = EXPLORABLE_MODELS.map((model) => model.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  for (const model of EXPLORABLE_MODELS) {
    describe(model.id, () => {
      it('gives every parameter a range, a step and a start on its scale', () => {
        expect(model.params.length).toBeGreaterThan(0);
        expect(new Set(model.params.map((param) => param.id)).size).toBe(model.params.length);
        for (const param of model.params) {
          expect(param.label.trim(), param.id).not.toBe('');
          expect(param.min, param.id).toBeLessThan(param.max);
          expect(param.step, param.id).toBeGreaterThan(0);
          expect(onScale(param, param.start), `${param.id} starts on its scale`).toBe(true);
          expect(
            onScale(param, param.min) && onScale(param, param.max),
            `${param.id} reaches both ends`,
          ).toBe(true);
        }
      });

      it('has an example the kind’s schema parses, moved somewhere on the scale', () => {
        expect(
          explorableKind.schema.safeParse({ model: model.id, start: model.example.start }).success,
        ).toBe(true);
        for (const [id, value] of Object.entries(model.example.moved)) {
          const param = model.params.find((one) => one.id === id);
          expect(param && onScale(param, value), `moved ${id}`).toBe(true);
        }
        expect(model.example.moved).not.toEqual(startingValues(model, model.example.start));
      });

      it('refuses a parameter it does not have, or a value off its scale', () => {
        const [param] = model.params;
        expect(
          explorableKind.schema.safeParse({ model: model.id, start: { nonsense: 1 } }).success,
        ).toBe(false);
        expect(
          explorableKind.schema.safeParse({
            model: model.id,
            start: { [param.id]: param.max + param.step },
          }).success,
        ).toBe(false);
        expect(
          explorableKind.schema.safeParse({
            model: model.id,
            start: { [param.id]: param.min + param.step / 2 },
          }).success,
        ).toBe(false);
      });

      it('has a gallery surface with the piece page as its route', () => {
        expect(
          GALLERY.has(modelSurface(model)),
          `${modelSurface(model)} in app/preview/surfaces.tsx`,
        ).toBe(true);
        expect(SURFACE_ROUTES[modelSurface(model)]).toContain('/learn/s/[id]/p/[piece]');
      });

      it('is listed for the writer under its field with each parameter', () => {
        const list = explorableWriterList();
        expect(list).toContain(`${model.field}:`);
        expect(list).toContain(`"${model.id}"`);
        for (const param of model.params)
          expect(list).toContain(`"${param.id}" from ${param.min} to ${param.max}`);
      });

      it('draws a labelled slider for each parameter, the caption and a table of its numbers', () => {
        const html = draw(model, model.example.start);
        // The figure draws its body twice, once for a laptop and once in the phone's fold.
        const sliders = html.match(/type="range"/g)?.length ?? 0;
        expect(sliders).toBeGreaterThan(0);
        expect(sliders % model.params.length).toBe(0);
        for (const param of model.params) expect(html).toContain(`>${param.label}</label>`);
        expect(html).toContain(
          escape(model.describe(startingValues(model), startingValues(model))),
        );
        expect(html).toContain('<table');
      });

      it('has measures a question can ask about, each moved by its example', () => {
        expect(model.measures.length).toBeGreaterThan(0);
        expect(new Set(model.measures.map((measure) => measure.id)).size).toBe(
          model.measures.length,
        );
        const from = startingValues(model, model.example.start);
        const moved = startingValues(model, model.example.moved);
        for (const measure of model.measures) {
          expect(Number.isFinite(measure.at(from)), measure.id).toBe(true);
          expect(explorableWriterList()).toContain(`"${measure.id}"`);
        }
        expect(model.measures.some((measure) => measure.at(moved) !== measure.at(from))).toBe(true);
      });

      it('poses a which-way question on its example move that grades the right pick as met', () => {
        const form = explorableKind.questions![0];
        const from = startingValues(model, model.example.start);
        const move = Object.fromEntries(
          Object.entries(model.example.moved).filter(([id, value]) => from[id] !== value),
        );
        const posed = model.measures
          .map((measure) =>
            form.pose({
              spec: { model: model.id, start: model.example.start },
              resolved: undefined,
              ask: { move, measure: measure.id, change: 'Something changes in the world.' },
            }),
          )
          .find(Boolean);
        expect(posed).toBeTruthy();
        expect(posed!.spec.still).toBe(true);
        expect(form.grade(posed!.answer, posed!.answer)).toBe('met');
        const html = renderToStaticMarkup(
          <Figure figure={{ kind: 'explorable', caption: 'Still.', spec: posed!.spec }} />,
        );
        expect(html).not.toContain('type="range"');
        expect(html).toContain('<table');
      });

      it('says something new in its caption once the sliders move', () => {
        const from = startingValues(model, model.example.start);
        const moved = startingValues(model, model.example.moved);
        expect(model.describe(moved, from)).not.toBe(model.describe(from, from));
        const html = draw(model, model.example.start, model.example.moved);
        expect(html).toContain(escape(model.describe(moved, from)));
        expect(html).toContain('aria-live="polite"');
      });
    });
  }
});

describe('supply and demand', () => {
  const model = EXPLORABLE_MODELS.find((one) => one.id === 'supply_demand')!;
  const at = (demand: number, supply: number) => ({ demand, supply });

  it('meets at £6 and 40 to start, and stays on the plot at every corner', () => {
    expect(equilibrium(at(0, 0))).toEqual({ price: 6, quantity: 40 });
    for (const demand of [-30, 30])
      for (const supply of [-30, 30]) {
        const meet = equilibrium(at(demand, supply));
        expect(meet.price).toBeGreaterThanOrEqual(3);
        expect(meet.price).toBeLessThanOrEqual(9);
        expect(meet.quantity).toBeGreaterThan(0);
      }
  });

  it('says what moving supply did to the price and quantity', () => {
    expect(model.describe(at(0, -20), at(0, 0))).toBe(
      'Now sellers offer 20 fewer at every price, so the price rises from £6.00 to £7.00 and the quantity bought and sold falls from 40 to 30.',
    );
    expect(model.describe(at(10, 10), at(0, 0))).toBe(
      'Now buyers want 10 more at every price and sellers offer 10 more at every price, so the price stays at £6.00 and the quantity bought and sold rises from 40 to 50.',
    );
    expect(model.readouts(at(0, -20), at(0, 0))).toEqual([
      { label: 'Price', value: '£7.00', was: '£6.00' },
      { label: 'Quantity', value: '30', was: '40' },
    ]);
  });

  it('is kept by the writer only when it names this model', () => {
    const block = {
      kind: 'explorable',
      caption: 'Move supply.',
      spec: { model: 'supply_demand', start: { supply: -10 } },
    };
    expect(readWrittenFigures([block])).toEqual([{ ...block }]);
    expect(readWrittenFigures([{ ...block, spec: { model: 'orbits' } }])).toEqual([]);
  });
});

describe('bid-rent (plan #2321.8)', () => {
  const model = EXPLORABLE_MODELS.find((one) => one.id === 'bid_rent')!;
  const at = (commute: number, income: number, rail: number) => ({ commute, income, rail });
  const start = at(10, 40, 0);

  it('gives the centre to offices, then homes, then farms, and keeps the edge on the plot at every corner', () => {
    expect(officesEnd(start)).toBeCloseTo(3.33, 2);
    expect(cityEdge(start)).toBe(18);
    expect(rentAt(10, start)).toBe(100);
    for (const commute of [6, 14])
      for (const income of [30, 50])
        for (const rail of [0, 20]) {
          const values = at(commute, income, rail);
          expect(officesEnd(values)).toBeGreaterThan(0);
          expect(officesEnd(values)).toBeLessThan(cityEdge(values));
          expect(cityEdge(values)).toBeLessThanOrEqual(DISTANCE_MAX);
          // The lines meet where the land changes hands.
          expect(officeBid(officesEnd(values))).toBeCloseTo(homeBid(officesEnd(values), values), 6);
          expect(homeBid(cityEdge(values), values)).toBeCloseTo(FARM_RENT, 6);
        }
  });

  it('spreads the city when commuting gets cheaper, incomes rise or a line opens', () => {
    expect(cityEdge(at(8, 40, 0))).toBeGreaterThan(cityEdge(start));
    expect(cityEdge(at(10, 45, 0))).toBeGreaterThan(cityEdge(start));
    expect(cityEdge(at(10, 40, 15))).toBe(25.5);
    expect(model.describe(at(10, 40, 15), start)).toBe(
      'Now a rail line runs 15 km out, so the city’s edge moves out from 18 km to 25.5 km and land 10 km out rises from £100 to £150.',
    );
  });
});

describe('agglomeration (plan #2321.8)', () => {
  const model = EXPLORABLE_MODELS.find((one) => one.id === 'agglomeration')!;
  const at = (gain: number, congestion: number) => ({
    sharing: gain,
    matching: gain,
    learning: gain,
    congestion,
  });

  it('peaks at 5 million to start, grows with the gains and shrinks with congestion', () => {
    expect(bestSize(at(3, 4.5))).toBe(5);
    expect(bestSize(at(4, 4.5))).toBeGreaterThan(5);
    expect(bestSize(at(3, 6))).toBeLessThan(5);
    expect(bestSize(at(0, 4.5))).toBe(0);
    expect(peak(at(4, 2)).past).toBe(true);
    for (const gain of [0, 4])
      for (const congestion of [2, 6])
        for (const n of [0, 5, 10]) {
          expect(outputAt(n, at(gain, congestion))).toBeGreaterThanOrEqual(0);
          expect(outputAt(n, at(gain, congestion))).toBeLessThanOrEqual(OUTPUT_MAX);
        }
  });

  it('says what easing congestion does to the best size', () => {
    expect(model.describe(at(3, 3), at(3, 4.5))).toBe(
      'Now congestion costs less, so the best size grows from a city of 5 million to a city of 8 million and output per worker there rises from £86k to £95k.',
    );
  });
});

describe('predict the move (plan #2321.8)', () => {
  const form = predictMoveForm();
  const spec = { model: 'bid_rent', start: {} };

  it('works the answer out from the model and words it for the measure', () => {
    const posed = form.pose({
      spec,
      resolved: undefined,
      ask: {
        move: { rail: 15 },
        measure: 'edge',
        change: 'A new rail line opens, running 15 km out from the centre.',
      },
    })!;
    expect(posed.prompt).toBe(
      'A new rail line opens, running 15 km out from the centre. What happens to the city’s edge?',
    );
    expect(posed.answer).toBe('up');
    expect(posed.choices!.map((choice) => choice.label)).toEqual([
      'It moves out',
      'It moves in',
      'It stays where it is',
    ]);
    expect(posed.spec).toEqual({
      model: 'bid_rent',
      start: { commute: 10, income: 40, rail: 0 },
      still: true,
    });
  });

  it('refuses a move off the scale, an unknown measure, or no move at all', () => {
    const ask = { move: { rail: 15 }, measure: 'edge', change: 'A new rail line opens.' };
    expect(
      form.pose({ spec, resolved: undefined, ask: { ...ask, move: { rail: 12 } } }),
    ).toBeNull();
    expect(
      form.pose({ spec, resolved: undefined, ask: { ...ask, move: { trams: 1 } } }),
    ).toBeNull();
    expect(form.pose({ spec, resolved: undefined, ask: { ...ask, measure: 'smog' } })).toBeNull();
    expect(form.pose({ spec, resolved: undefined, ask: { ...ask, move: { rail: 0 } } })).toBeNull();
  });

  it('calls a tiny change the same and leaves one too small to call unasked', () => {
    expect(moveOf(100, 100.2)).toBe('same');
    expect(moveOf(100, 101)).toBeNull();
    expect(moveOf(100, 90)).toBe('down');
  });
});

function escape(text: string): string {
  return renderToStaticMarkup(<>{text}</>);
}

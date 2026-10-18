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
import { modelSurface, onScale, startingValues, type ExplorableModel } from './types';

/** Gallery ids read from source, as the figure registry's test reads them. */
const GALLERY = (() => {
  const text = readFileSync(join(process.cwd(), 'app/preview/surfaces.tsx'), 'utf8');
  return new Set(
    [...text.slice(text.indexOf('export const SURFACES')).matchAll(/^ {4}id: '([^']+)'/gm)].map((m) => m[1]),
  );
})();

function draw(model: ExplorableModel, start: Record<string, number>, moved?: Record<string, number>): string {
  const figure = <Figure figure={{ kind: 'explorable', caption: model.example.caption, spec: { model: model.id, start } }} />;
  return renderToStaticMarkup(moved ? <ExplorableMoved moved={{ [model.id]: moved }}>{figure}</ExplorableMoved> : figure);
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
          expect(onScale(param, param.min) && onScale(param, param.max), `${param.id} reaches both ends`).toBe(true);
        }
      });

      it('has an example the kind’s schema parses, moved somewhere on the scale', () => {
        expect(explorableKind.schema.safeParse({ model: model.id, start: model.example.start }).success).toBe(true);
        for (const [id, value] of Object.entries(model.example.moved)) {
          const param = model.params.find((one) => one.id === id);
          expect(param && onScale(param, value), `moved ${id}`).toBe(true);
        }
        expect(model.example.moved).not.toEqual(startingValues(model, model.example.start));
      });

      it('refuses a parameter it does not have, or a value off its scale', () => {
        const [param] = model.params;
        expect(explorableKind.schema.safeParse({ model: model.id, start: { nonsense: 1 } }).success).toBe(false);
        expect(explorableKind.schema.safeParse({ model: model.id, start: { [param.id]: param.max + param.step } }).success).toBe(false);
        expect(explorableKind.schema.safeParse({ model: model.id, start: { [param.id]: param.min + param.step / 2 } }).success).toBe(false);
      });

      it('has a gallery surface with the piece page as its route', () => {
        expect(GALLERY.has(modelSurface(model)), `${modelSurface(model)} in app/preview/surfaces.tsx`).toBe(true);
        expect(SURFACE_ROUTES[modelSurface(model)]).toContain('/learn/s/[id]/p/[piece]');
      });

      it('is listed for the writer under its field with each parameter', () => {
        const list = explorableWriterList();
        expect(list).toContain(`${model.field}:`);
        expect(list).toContain(`"${model.id}"`);
        for (const param of model.params) expect(list).toContain(`"${param.id}" from ${param.min} to ${param.max}`);
      });

      it('draws a labelled slider for each parameter, the caption and a table of its numbers', () => {
        const html = draw(model, model.example.start);
        // The figure draws its body twice, once for a laptop and once in the phone's fold.
        const sliders = html.match(/type="range"/g)?.length ?? 0;
        expect(sliders).toBeGreaterThan(0);
        expect(sliders % model.params.length).toBe(0);
        for (const param of model.params) expect(html).toContain(`>${param.label}</label>`);
        expect(html).toContain(escape(model.describe(startingValues(model), startingValues(model))));
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
    const block = { kind: 'explorable', caption: 'Move supply.', spec: { model: 'supply_demand', start: { supply: -10 } } };
    expect(readWrittenFigures([block])).toEqual([{ ...block }]);
    expect(readWrittenFigures([{ ...block, spec: { model: 'orbits' } }])).toEqual([]);
  });
});

function escape(text: string): string {
  return renderToStaticMarkup(<>{text}</>);
}

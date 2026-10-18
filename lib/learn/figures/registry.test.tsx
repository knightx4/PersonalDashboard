import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { Figure } from '@/components/learn/figure';
import { SURFACE_ROUTES } from '@/lib/preview/routes';
import { FIGURE_KINDS, figureWriterLines, readStoredFigures } from './registry';
import { figureSurface } from './types';

/** Gallery ids read from source, since importing the gallery renders half the app. */
const GALLERY = (() => {
  const text = readFileSync(join(process.cwd(), 'app/preview/surfaces.tsx'), 'utf8');
  return new Set(
    [...text.slice(text.indexOf('export const SURFACES')).matchAll(/^ {4}id: '([^']+)'/gm)].map((m) => m[1]),
  );
})();

describe('the figure registry (plan #2321.1)', () => {
  it('names each kind once', () => {
    const ids = FIGURE_KINDS.map((kind) => kind.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  for (const kind of FIGURE_KINDS) {
    describe(kind.id, () => {
      it('parses its own example with its schema', () => {
        expect(kind.schema.safeParse(kind.example.spec).success).toBe(true);
        expect(kind.example.caption.trim()).not.toBe('');
      });

      it('has a gallery surface with the piece page as its route', () => {
        expect(GALLERY.has(figureSurface(kind)), `${figureSurface(kind)} in app/preview/surfaces.tsx`).toBe(true);
        expect(SURFACE_ROUTES[figureSurface(kind)]).toContain('/learn/s/[id]/p/[piece]');
      });

      it('tells the writer its shape', () => {
        expect(kind.writerLine.startsWith(`${kind.id}:`)).toBe(true);
        expect(figureWriterLines()).toContain(kind.writerLine);
      });

      it('draws its example with its caption', () => {
        const html = renderToStaticMarkup(<Figure figure={{ kind: kind.id, ...kind.example }} />);
        if (kind.data === 'none') expect(html).toMatch(/<table|<svg/);
        expect(html).toContain(escape(kind.example.caption));
      });
    });
  }
});

describe('a stored figure', () => {
  it('of a kind the app does not know shows its caption only', () => {
    const html = renderToStaticMarkup(
      <Figure figure={{ kind: 'orbit', caption: 'The planets in order from the sun.', spec: { bodies: 8 } }} />,
    );
    expect(html).toContain('The planets in order from the sun.');
    expect(html).not.toContain('<table');
    expect(html).not.toContain('<details');
  });

  it('whose spec no longer parses shows its caption only', () => {
    const html = renderToStaticMarkup(
      <Figure figure={{ kind: 'table', caption: 'Two prices.', spec: { columns: ['Price'], rows: [] } }} />,
    );
    expect(html).toContain('Two prices.');
    expect(html).not.toContain('<table');
  });

  it('is read from the row, unknown kinds kept and nameless ones left off', () => {
    expect(
      readStoredFigures([
        { kind: 'orbit', caption: ' The  planets. ', spec: null },
        { kind: 'table', caption: '' },
        { caption: 'No kind.' },
        'junk',
      ]),
    ).toEqual([{ kind: 'orbit', caption: 'The planets.', spec: null }]);
    expect(readStoredFigures(null)).toEqual([]);
  });
});

function escape(text: string): string {
  return renderToStaticMarkup(<>{text}</>);
}

import { readFileSync } from 'node:fs';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';

vi.mock('server-only', () => ({}));

import { Figure } from '@/components/learn/figure';
import { offerableFigures, type FigureDocument, type FigureRow } from '@/lib/learn/catalogue/figures';
import { imagesFromPage } from '@/lib/learn/providers/ocw-structure';
import { readWrittenFigures } from '../registry';
import { resolveSourceFigures, sourceFigureKind } from './source-figure';

const COURSE = 'https://ocw.mit.edu/courses/11-001j-introduction-to-urban-design-and-development-spring-2006/';
const row: FigureRow = {
  id: 'f1',
  image_url: `${COURSE}pic.jpg`,
  alt_text: 'A street in Boston.',
  page_url: COURSE,
  licence: 'CC BY-NC-SA 4.0',
};
const doc = (mode: string): FigureDocument => ({
  licence_mode: mode,
  institution: 'MIT',
  course_code: '11.001J',
  term: 'Spring 2006',
  title: 'Urban Design',
});

describe('images found on an OCW page', () => {
  it('keeps the course image with its alt text and leaves site chrome out', () => {
    const html = readFileSync('lib/learn/providers/fixtures/structure/ocw/11-001j-course.html', 'utf8');
    const found = imagesFromPage(html, COURSE, COURSE);
    expect(found.length).toBeGreaterThan(0);
    for (const figure of found) {
      expect(figure.imageUrl.startsWith(COURSE)).toBe(true);
      expect(figure.altText.length).toBeGreaterThan(11);
      expect(figure.licence).toBe('CC BY-NC-SA 4.0');
    }
    expect(found.some((figure) => figure.altText.includes('walking tour of Boston'))).toBe(true);
  });
});

describe('what a lesson may be offered', () => {
  it('offers a show document figures, credited to the course', () => {
    const offered = offerableFigures([row], doc('show'), 'MIT OpenCourseWare');
    expect(offered).toHaveLength(1);
    expect(offered[0].course).toBe('11.001J Urban Design, Spring 2006, MIT OpenCourseWare');
  });
  it('offers a structure_only or never_feed document nothing', () => {
    expect(offerableFigures([row], doc('structure_only'), 'x')).toEqual([]);
    expect(offerableFigures([row], doc('never_feed'), 'x')).toEqual([]);
    expect(offerableFigures([row], null, 'x')).toEqual([]);
  });
});

describe('a source_figure the writer names', () => {
  const offered = offerableFigures([row], doc('show'), 'MIT OpenCourseWare');
  const written = [{ kind: 'source_figure', caption: 'A street.', spec: { figureId: 'f1' } }];

  it('is resolved from the offered list', () => {
    expect(readWrittenFigures(resolveSourceFigures(written, offered))).toHaveLength(1);
  });
  it('is dropped when the id was not offered or nothing was', () => {
    expect(readWrittenFigures(resolveSourceFigures([{ ...written[0], spec: { figureId: 'zz' } }], offered))).toEqual([]);
    expect(readWrittenFigures(resolveSourceFigures(written, []))).toEqual([]);
  });
  it('is not drawn for a spec whose mode is not show', () => {
    const spec = { ...sourceFigureKind.example.spec, mode: 'structure_only' };
    expect(sourceFigureKind.schema.safeParse(spec).success).toBe(false);
    const html = renderToStaticMarkup(<Figure figure={{ kind: 'source_figure', caption: 'Hidden.', spec }} />);
    expect(html).toContain('Hidden.');
    expect(html).not.toContain('<img');
  });
  it('is drawn with its course, licence and a link to the page', () => {
    const html = renderToStaticMarkup(<Figure figure={{ kind: 'source_figure', ...sourceFigureKind.example }} />);
    expect(html).toContain('<img');
    expect(html).toContain('CC BY-NC-SA 4.0');
    expect(html).toContain('See the course page');
  });
});

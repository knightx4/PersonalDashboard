import { z } from 'zod';
import type { OfferedFigure } from '@/lib/learn/catalogue/figures';
import type { FigureKind } from '../types';

/**
 * A figure from a course the preparation stored, shown under its licence
 * (plan #2321.4).
 *
 * The writer names a figure by id, from the list its source search gave it;
 * `resolveSourceFigures` turns that into the stored spec, which carries the
 * image, the credit and the licence mode it was offered under. The schema
 * accepts only mode `show`, so a spec for a structure_only or never_feed
 * document does not parse and the figure draws its caption alone.
 */

const https = z.string().trim().url().max(800).refine((value) => value.startsWith('https://'), 'An https address.');

const sourceFigureSpec = z.object({
  figureId: z.string().trim().min(1).max(64),
  imageUrl: https,
  alt: z.string().trim().min(1).max(300),
  course: z.string().trim().min(1).max(300),
  licence: z.string().trim().min(1).max(80),
  pageUrl: https,
  mode: z.literal('show'),
});

export type SourceFigureSpec = z.infer<typeof sourceFigureSpec>;

export const sourceFigureKind: FigureKind<SourceFigureSpec> = {
  id: 'source_figure',
  label: 'Course figure',
  schema: sourceFigureSpec,
  writerLine:
    'source_figure: a picture from the course the reference section came from, only when the prompt lists "Figures from the course" and one of them shows what the lesson says. spec is {"figureId": "<an id copied from that list>"}. Never invent an id and never use this kind when no list is given; the caption says what the picture shows, in your words.',
  example: {
    caption: 'A walking tour of Boston, the kind of street the lecture reads as a design problem.',
    spec: {
      figureId: 'f0000000-0000-4000-8000-000000000001',
      imageUrl: 'https://ocw.mit.edu/courses/11-001j-introduction-to-urban-design-and-development-spring-2006/68b4bc4de4ed3665710c2b0689bd37c7_11-001js06.jpg',
      alt: 'An image from the walking tour of Boston, part of lecture 2.',
      course: '11.001J Introduction to Urban Design and Development, Spring 2006, MIT OpenCourseWare',
      licence: 'CC BY-NC-SA 4.0',
      pageUrl: 'https://ocw.mit.edu/courses/11-001j-introduction-to-urban-design-and-development-spring-2006/',
      mode: 'show',
    },
  },
  Render: ({ spec }) => (
    <div>
      {/* eslint-disable-next-line @next/next/no-img-element -- a course's own image, from a host Next's loader does not list */}
      <img
        src={spec.imageUrl}
        alt={spec.alt}
        loading="lazy"
        referrerPolicy="no-referrer"
        className="max-h-80 w-auto max-w-full rounded-md"
      />
      <p className="mt-1.5 text-small text-ink-muted">
        {spec.course}. {spec.licence}.{' '}
        <a href={spec.pageUrl} target="_blank" rel="noopener noreferrer" className="underline">
          See the course page
        </a>
      </p>
    </div>
  ),
  data: 'source',
};

/**
 * The writer's figures with each `source_figure` spec replaced by the stored
 * one. A source_figure naming an id that was not offered is dropped, as is
 * every one when nothing was offered, so the writer can only show what its
 * source search gave it. Other kinds pass through.
 */
export function resolveSourceFigures(value: unknown, offered: readonly OfferedFigure[]): unknown {
  if (!Array.isArray(value)) return value;
  const out: unknown[] = [];
  for (const item of value) {
    if (!item || typeof item !== 'object' || (item as { kind?: unknown }).kind !== 'source_figure') {
      out.push(item);
      continue;
    }
    const raw = (item as { spec?: unknown }).spec;
    const id = raw && typeof raw === 'object' ? (raw as { figureId?: unknown }).figureId : null;
    const figure = typeof id === 'string' ? offered.find((candidate) => candidate.id === id.trim()) : undefined;
    if (!figure) continue;
    out.push({
      ...item,
      spec: {
        figureId: figure.id,
        imageUrl: figure.imageUrl,
        alt: figure.altText,
        course: figure.course,
        licence: figure.licence,
        pageUrl: figure.pageUrl,
        mode: 'show',
      },
    });
  }
  return out;
}

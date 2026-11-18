'use client';

import { SectionView } from '@/app/learn/read/[id]/[n]/section-view';
import { SourceView } from '@/app/learn/read/[id]/source-view';
import { IdeasView } from '@/app/learn/read/ideas/ideas-view';
import { ReadView } from '@/app/learn/read/read-view';
import { shelve, type ReaderRow } from '@/lib/learn/reader/shelves';
import { checkSource, type Basis, type PreparedSource } from '@/lib/learn/reader/source';
import type { ReaderSource } from '@/lib/learn/reader/store';
import fixture from './reader-fixture.json';

/**
 * Gallery fixtures for the reader (learn 0195): Learn's front page, a source
 * in layers, a section of real text with a note open on a phrase, a section
 * whose text may not be shown, a source still being prepared, and the ideas
 * met so far. The open source is a cut of A. Mitchell Innes's "What Is
 * Money?" (1913, public domain), so the text on these surfaces is the real
 * one; the other is a summary of a chapter in copyright.
 */

function prepared(input: unknown): PreparedSource {
  const checked = checkSource(input);
  if (!checked.ok)
    throw new Error(`The reader fixture does not check: ${checked.problems.join(' ')}`);
  return checked.source;
}

const INNES = prepared(fixture.open);
const JACOBS = prepared(fixture.copyright);

function source(
  id: string,
  from: PreparedSource | null,
  over: Partial<ReaderSource> & { title: string },
): ReaderSource {
  return {
    id,
    author: from?.author ?? null,
    origin: 'note',
    why: null,
    status: 'ready',
    basis: (from ? (from.rights === 'open' ? 'text' : 'memory') : null) as Basis | null,
    read: [],
    verdict: null,
    parentId: null,
    openedAt: null,
    requestedAt: '2026-11-16T08:00:00Z',
    outline: from
      ? {
          published: from.published,
          minutes: from.minutes,
          idea: from.idea,
          sections: from.sections.map((section) => ({
            title: section.title,
            minutes: section.minutes,
            idea: section.idea,
          })),
        }
      : null,
    prepared: from,
    givenText: false,
    asked: null,
    error: null,
    ...over,
  };
}

const MONEY = source('00000000-0000-4000-8000-00000000d001', INNES, {
  title: INNES.title,
  why: 'Your quick notes of 23 October were heading toward money as credit or obligation.',
  read: [1],
  openedAt: '2026-11-16T09:00:00Z',
});
const CITY = source('00000000-0000-4000-8000-00000000d002', JACOBS, {
  title: JACOBS.title,
  why: 'The strongest version of your note A city is not a computer.',
});
const HAYEK = source('00000000-0000-4000-8000-00000000d003', JACOBS, {
  title: 'The Use of Knowledge in Society',
  author: 'F. A. Hayek',
  origin: 'new',
  why: 'New ground. Nothing in your notes points here yet.',
});
const KEYNES = source('00000000-0000-4000-8000-00000000d004', null, {
  title: 'The strongest case against it (from What Is Money?)',
  origin: 'deeper',
  status: 'preparing',
  asked: 'The strongest case against it',
});

const ROWS: ReaderRow[] = [MONEY, CITY, HAYEK, KEYNES];

export function ReaderHomePreview() {
  return <ReadView shelves={shelve(ROWS)} />;
}

export function ReaderSourcePreview() {
  return <SourceView source={MONEY} />;
}

export function ReaderSectionPreview() {
  return (
    <SectionView source={MONEY} section={INNES.sections[1]} n={2} total={INNES.sections.length} />
  );
}

export function ReaderSummaryPreview() {
  return (
    <SectionView source={CITY} section={JACOBS.sections[0]} n={1} total={JACOBS.sections.length} />
  );
}

export function ReaderCopyrightPreview() {
  return <SourceView source={CITY} />;
}

export function ReaderPreparingPreview() {
  return <SourceView source={KEYNES} />;
}

export function ReaderIdeasPreview() {
  return <IdeasView ideas={shelve(ROWS).ideas} />;
}

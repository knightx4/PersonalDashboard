/**
 * The text of a PowerPoint (.pptx) file, for Dash's summary of a course's
 * slides (plan #2401.4).
 *
 * A .pptx is a zip of XML, as a Word file is (lib/goals/docx.ts, whose zip
 * reader this shares). Each slide is ppt/slides/slideN.xml, with its text in
 * <a:t> runs inside <a:p> paragraphs, and its speaker notes, when it has any,
 * in the notes slide its relationships file points at. The slides are put in
 * the order ppt/presentation.xml lists them, which is the deck's order even
 * after slides were moved; the file numbers are only the fallback.
 *
 * What comes out is the words on each slide and under it. Pictures, charts
 * drawn as pictures and the layout are left behind, so a deck that is mostly
 * diagrams reads thin; the caller says so when there is too little text.
 */

import { decodeEntity, zipEntries } from '@/lib/goals/docx';

const SLIDE = /^ppt\/slides\/slide(\d+)\.xml$/;
const SLIDE_RELS = /^ppt\/slides\/_rels\/slide(\d+)\.xml\.rels$/;
const NOTES = /^ppt\/notesSlides\/notesSlide\d+\.xml$/;
const PRESENTATION = 'ppt/presentation.xml';
const PRESENTATION_RELS = 'ppt/_rels/presentation.xml.rels';

export type PptxSlide = { number: number; text: string; notes: string };

/**
 * The deck's slides in order, each with its text and its speaker notes, or
 * null when the file is not a PowerPoint file this can open.
 */
export function pptxSlides(file: Uint8Array): PptxSlide[] | null {
  const entries = zipEntries(
    file,
    (name) =>
      SLIDE.test(name) ||
      SLIDE_RELS.test(name) ||
      NOTES.test(name) ||
      name === PRESENTATION ||
      name === PRESENTATION_RELS,
  );
  if (!entries) return null;

  // A zip with neither slides nor a presentation is not a deck; a deck with no slides is empty.
  const slidePaths = [...entries.keys()].filter((name) => SLIDE.test(name));
  if (slidePaths.length === 0) return entries.has(PRESENTATION) ? [] : null;

  return slideOrder(entries, slidePaths).map((path, index) => {
    const number = Number(SLIDE.exec(path)?.[1] ?? index + 1);
    const notesPath = notesFor(entries, number);
    return {
      number: index + 1,
      text: drawingText(entries.get(path) ?? ''),
      notes: notesPath ? notesText(entries.get(notesPath) ?? '') : '',
    };
  });
}

/**
 * The deck as one text: a heading line per slide, its words under it, and its
 * notes after "Notes:". Empty slides are left out. Null when the file cannot
 * be opened; an empty string when it opens and holds no words.
 */
export function pptxText(file: Uint8Array): string | null {
  const slides = pptxSlides(file);
  if (!slides) return null;
  return slides
    .filter((slide) => slide.text || slide.notes)
    .map((slide) =>
      [`Slide ${slide.number}`, slide.text, slide.notes ? `Notes: ${slide.notes}` : '']
        .filter(Boolean)
        .join('\n'),
    )
    .join('\n\n')
    .trim();
}

/** The slide paths in the order the presentation lists them; any it does not name follow by number. */
function slideOrder(entries: Map<string, string>, slidePaths: string[]): string[] {
  const byNumber = [...slidePaths].sort(
    (a, b) => Number(SLIDE.exec(a)?.[1] ?? 0) - Number(SLIDE.exec(b)?.[1] ?? 0),
  );
  const presentation = entries.get(PRESENTATION);
  const rels = entries.get(PRESENTATION_RELS);
  if (!presentation || !rels) return byNumber;

  const targets = relationshipTargets(rels, 'ppt/');
  const ordered: string[] = [];
  for (const match of presentation.matchAll(/<p:sldId\b[^>]*\br:id="([^"]+)"/g)) {
    const path = targets.get(match[1]);
    if (path && slidePaths.includes(path) && !ordered.includes(path)) ordered.push(path);
  }
  return [...ordered, ...byNumber.filter((path) => !ordered.includes(path))];
}

/** The notes slide a slide's relationships point at, if it has one. */
function notesFor(entries: Map<string, string>, slideNumber: number): string | null {
  const rels = entries.get(`ppt/slides/_rels/slide${slideNumber}.xml.rels`);
  if (!rels) return null;
  for (const path of relationshipTargets(rels, 'ppt/slides/').values()) {
    if (NOTES.test(path) && entries.has(path)) return path;
  }
  return null;
}

/** A relationships file's ids and the zip paths they point at, resolved from `base`. */
function relationshipTargets(rels: string, base: string): Map<string, string> {
  const targets = new Map<string, string>();
  for (const match of rels.matchAll(/<Relationship\b[^>]*>/g)) {
    const tag = match[0];
    const id = /\bId="([^"]+)"/.exec(tag)?.[1];
    const target = /\bTarget="([^"]+)"/.exec(tag)?.[1];
    if (!id || !target || /\bTargetMode="External"/.test(tag)) continue;
    targets.set(id, resolvePath(base, target));
  }
  return targets;
}

function resolvePath(base: string, target: string): string {
  if (target.startsWith('/')) return target.slice(1);
  const parts = base.split('/').filter(Boolean);
  for (const part of target.split('/')) {
    if (part === '..') parts.pop();
    else if (part !== '.' && part !== '') parts.push(part);
  }
  return parts.join('/');
}

/** The words in a slide's shapes: a line per paragraph, a tab between table cells. */
export function drawingText(xml: string): string {
  const lines: string[] = [];
  // A table row becomes one paragraph, its cells' words a tab apart, so a
  // table still reads as rows.
  const flat = xml.replace(/<a:tr\b[^>]*>([\s\S]*?)<\/a:tr>/g, (_row, cells: string) => {
    const texts = [...cells.matchAll(/<a:tc\b[^>]*>([\s\S]*?)<\/a:tc>/g)].map((cell) =>
      drawingText(cell[1]).replace(/\s+/g, ' '),
    );
    return `<a:p><a:t>${texts.map(escapeXml).join('</a:t><a:tab/><a:t>')}</a:t></a:p>`;
  });
  for (const paragraph of flat.matchAll(/<a:p\b[^>]*>([\s\S]*?)<\/a:p>/g)) {
    const line = paragraph[1]
      .replace(/<a:br\b[^>]*\/>/g, '\n')
      .replace(/<a:tab\b[^>]*\/>/g, '\t')
      .split(/(<a:t(?:\s[^>]*)?>[\s\S]*?<\/a:t>|\n|\t)/)
      .map((part) => {
        const run = /^<a:t(?:\s[^>]*)?>([\s\S]*?)<\/a:t>$/.exec(part);
        if (run) return run[1];
        return part === '\n' || part === '\t' ? part : '';
      })
      .join('')
      .replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, decodeEntity)
      .trim();
    if (line) lines.push(line);
  }
  return lines.join('\n');
}

function escapeXml(text: string): string {
  return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

/**
 * A notes slide's words, without the slide number and the copy of the slide
 * image's placeholder that every notes page carries.
 */
function notesText(xml: string): string {
  const bodies: string[] = [];
  for (const shape of xml.matchAll(/<p:sp\b[\s\S]*?<\/p:sp>/g)) {
    const placeholder = /<p:ph\b[^>]*\btype="([^"]+)"/.exec(shape[0])?.[1];
    if (placeholder && placeholder !== 'body') continue;
    const text = drawingText(shape[0]);
    if (text) bodies.push(text);
  }
  return bodies.join('\n').replace(/\s*\n\s*/g, ' ').trim();
}

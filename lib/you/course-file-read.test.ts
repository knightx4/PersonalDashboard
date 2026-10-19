import { deflateRawSync } from 'node:zlib';
import { describe, expect, it } from 'vitest';
import type { ExtractResult, ExtractSource } from '@/lib/goals/extract-model';
import {
  POINTS_MAX,
  courseFileSource,
  readCourseFile,
  readSummaryAnswer,
  summaryPrompt,
  summaryTool,
} from '@/lib/you/course-file-read';
import { pptxSlides, pptxText } from '@/lib/you/pptx';

/** A zip holding the given entries, deflated, which is all a .pptx is. */
function zip(entries: Record<string, string>): Uint8Array {
  const locals: Buffer[] = [];
  const central: Buffer[] = [];
  let offset = 0;
  for (const [name, text] of Object.entries(entries)) {
    const nameBytes = Buffer.from(name);
    const raw = Buffer.from(text);
    const body = deflateRawSync(raw);
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(8, 8);
    local.writeUInt32LE(body.length, 18);
    local.writeUInt32LE(raw.length, 22);
    local.writeUInt16LE(nameBytes.length, 26);
    locals.push(local, nameBytes, body);
    const entry = Buffer.alloc(46);
    entry.writeUInt32LE(0x02014b50, 0);
    entry.writeUInt16LE(8, 10);
    entry.writeUInt32LE(body.length, 20);
    entry.writeUInt32LE(raw.length, 24);
    entry.writeUInt16LE(nameBytes.length, 28);
    entry.writeUInt32LE(offset, 42);
    central.push(entry, nameBytes);
    offset += 30 + nameBytes.length + body.length;
  }
  const directory = Buffer.concat(central);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(Object.keys(entries).length, 8);
  end.writeUInt16LE(Object.keys(entries).length, 10);
  end.writeUInt32LE(directory.length, 12);
  end.writeUInt32LE(offset, 16);
  return new Uint8Array(Buffer.concat([...locals, directory, end]));
}

const slide = (body: string) =>
  `<?xml version="1.0"?><p:sld xmlns:a="a" xmlns:p="p"><p:cSld><p:spTree>${body}</p:spTree></p:cSld></p:sld>`;
const shape = (...paragraphs: string[]) =>
  `<p:sp><p:txBody>${paragraphs.map((p) => `<a:p><a:r><a:rPr lang="en"/><a:t>${p}</a:t></a:r></a:p>`).join('')}</p:txBody></p:sp>`;

/**
 * A deck of three slides whose files are numbered out of order: the
 * presentation lists slide3.xml first, as it does after a slide is moved.
 * Slide 1 has speaker notes and a table, slide 2 is pictures only.
 */
function deck(): Uint8Array {
  return zip({
    'ppt/presentation.xml':
      '<p:presentation xmlns:p="p" xmlns:r="r"><p:sldIdLst><p:sldId id="258" r:id="rId4"/><p:sldId id="256" r:id="rId2"/><p:sldId id="257" r:id="rId3"/></p:sldIdLst></p:presentation>',
    'ppt/_rels/presentation.xml.rels':
      '<Relationships><Relationship Id="rId2" Type="slide" Target="slides/slide1.xml"/><Relationship Id="rId3" Type="slide" Target="slides/slide2.xml"/><Relationship Id="rId4" Type="slide" Target="/ppt/slides/slide3.xml"/></Relationships>',
    'ppt/slides/slide1.xml': slide(
      shape('Supply &amp; demand', 'Demand curves slope down') +
        '<p:graphicFrame><a:tbl><a:tr><a:tc><a:txBody><a:p><a:r><a:t>Good</a:t></a:r></a:p></a:txBody></a:tc><a:tc><a:txBody><a:p><a:r><a:t>Elasticity</a:t></a:r></a:p></a:txBody></a:tc></a:tr><a:tr><a:tc><a:txBody><a:p><a:r><a:t>Salt</a:t></a:r></a:p></a:txBody></a:tc><a:tc><a:txBody><a:p><a:r><a:t>0.1</a:t></a:r></a:p></a:txBody></a:tc></a:tr></a:tbl></p:graphicFrame>',
    ),
    'ppt/slides/_rels/slide1.xml.rels':
      '<Relationships><Relationship Id="rId1" Type="layout" Target="../slideLayouts/slideLayout2.xml"/><Relationship Id="rId2" Type="notes" Target="../notesSlides/notesSlide1.xml"/></Relationships>',
    'ppt/notesSlides/notesSlide1.xml':
      '<p:notes xmlns:a="a" xmlns:p="p"><p:sp><p:nvSpPr><p:nvPr><p:ph type="sldImg"/></p:nvPr></p:nvSpPr></p:sp><p:sp><p:nvSpPr><p:nvPr><p:ph type="body" idx="1"/></p:nvPr></p:nvSpPr><p:txBody><a:p><a:r><a:t>Recall the ice-cream example.</a:t></a:r></a:p></p:txBody></p:sp><p:sp><p:nvSpPr><p:nvPr><p:ph type="sldNum" idx="5"/></p:nvPr></p:nvSpPr><p:txBody><a:p><a:r><a:t>1</a:t></a:r></a:p></p:txBody></p:sp></p:notes>',
    'ppt/slides/slide2.xml': slide('<p:pic/>'),
    'ppt/slides/slide3.xml': slide(shape('Week 3: Markets', 'Prices carry information &#8212; Hayek')),
  });
}

describe('pptxSlides', () => {
  it('reads the slides in the order the presentation lists them, with their notes', () => {
    const slides = pptxSlides(deck());
    expect(slides).toEqual([
      { number: 1, text: 'Week 3: Markets\nPrices carry information — Hayek', notes: '' },
      {
        number: 2,
        text: 'Supply & demand\nDemand curves slope down\nGood\tElasticity\nSalt\t0.1',
        notes: 'Recall the ice-cream example.',
      },
      { number: 3, text: '', notes: '' },
    ]);
  });

  it('writes the deck as one text and leaves out the empty slide', () => {
    expect(pptxText(deck())).toBe(
      'Slide 1\nWeek 3: Markets\nPrices carry information — Hayek\n\n' +
        'Slide 2\nSupply & demand\nDemand curves slope down\nGood\tElasticity\nSalt\t0.1\nNotes: Recall the ice-cream example.',
    );
  });

  it('falls back to the file numbers when there is no presentation list', () => {
    const slides = pptxSlides(
      zip({
        'ppt/slides/slide10.xml': slide(shape('Ten')),
        'ppt/slides/slide2.xml': slide(shape('Two')),
      }),
    );
    expect(slides?.map((s) => s.text)).toEqual(['Two', 'Ten']);
  });

  it('is null for a file that is not a deck, and empty for a deck with no slides', () => {
    expect(pptxSlides(new TextEncoder().encode('not a zip at all'))).toBeNull();
    expect(pptxSlides(zip({ 'word/document.xml': '<w:document/>' }))).toBeNull();
    expect(pptxText(zip({ 'ppt/presentation.xml': '<p:presentation/>' }))).toBe('');
  });
});

describe('courseFileSource', () => {
  it('sends a deck as its words', () => {
    const source = courseFileSource({ name: 'u/c/x-Lecture_03.pptx', bytes: deck() });
    expect(source.ok && source.source.kind).toBe('text');
  });

  it('says why a deck of pictures cannot be read, and points at a PDF', () => {
    const source = courseFileSource({ name: 'pictures.pptx', bytes: zip({ 'ppt/presentation.xml': '<p/>' }) });
    expect(source).toEqual({ ok: false, error: expect.stringContaining('save the deck as a PDF') });
  });

  it('says a broken deck could not be opened', () => {
    expect(courseFileSource({ name: 'broken.pptx', bytes: new Uint8Array([1, 2, 3]) })).toEqual({
      ok: false,
      error: 'That PowerPoint file could not be opened.',
    });
  });

  it('sends a PDF as itself and a text file as its text, through the goals reader', () => {
    const pdf = courseFileSource({ name: 'reading.pdf', bytes: new Uint8Array([37, 80, 68, 70]) });
    expect(pdf.ok && pdf.source.kind).toBe('pdf');
    const text = courseFileSource({ name: 'notes.txt', bytes: new TextEncoder().encode('  Week 1 notes  ') });
    expect(text).toEqual({ ok: true, source: { kind: 'text', text: 'Week 1 notes' } });
  });
});

describe('readSummaryAnswer', () => {
  it('keeps the summary and at most five distinct points, tidied', () => {
    const read = readSummaryAnswer({
      summary: '  Markets   set prices. ',
      points: ['- One.', 'Two.', 'two.', '', 3, '1. Three.', 'Four.', 'Five.', 'Six.'],
      unreadable: null,
    });
    expect(read).toEqual({ ok: true, summary: 'Markets set prices.', points: ['One.', 'Two.', 'Three.', 'Four.', 'Five.'] });
    expect(read.ok && read.points.length).toBe(POINTS_MAX);
  });

  it('keeps a point that opens with a year', () => {
    const read = readSummaryAnswer({ summary: 'S.', points: ['1990s growth was fast.'], unreadable: null });
    expect(read.ok && read.points).toEqual(['1990s growth was fast.']);
  });

  it('keeps nothing when the file could not be made sense of, and says why', () => {
    expect(readSummaryAnswer({ summary: null, points: [], unreadable: 'the scan is too blurred to read' })).toEqual({
      ok: false,
      error: 'Dash could not make sense of it. The scan is too blurred to read.',
    });
  });

  it('keeps nothing from a summary with no points or an empty answer', () => {
    expect(readSummaryAnswer({ summary: 'Something.', points: [], unreadable: null }).ok).toBe(false);
    expect(readSummaryAnswer(null).ok).toBe(false);
  });
});

describe('readCourseFile', () => {
  it('asks with the course and the file named in the prompt, and reads the answer', async () => {
    const given: Array<{ source: ExtractSource; prompt: string }> = [];
    const read = await readCourseFile(
      { name: 'x.pptx', bytes: deck(), title: 'Lecture 03', kind: 'slides', week: 3, courseTitle: 'Principles of Economics' },
      async (source, prompt): Promise<ExtractResult> => {
        given.push({ source, prompt });
        return { ok: true, input: { summary: 'Prices carry information.', points: ['Prices signal scarcity.'], unreadable: null } };
      },
    );
    expect(read).toEqual({ ok: true, summary: 'Prices carry information.', points: ['Prices signal scarcity.'] });
    expect(given[0].prompt).toContain('"Principles of Economics"');
    expect(given[0].prompt).toContain('slides, from week 3, titled "Lecture 03"');
    expect(given[0].source.kind === 'text' && given[0].source.text).toContain('Notes: Recall the ice-cream example.');
  });

  it('does not ask when the file cannot be put in shape, and passes a failed ask on', async () => {
    let asked = 0;
    const ask = async (): Promise<ExtractResult> => {
      asked += 1;
      return { ok: false, error: 'Reading is rate-limited right now. Try again in a minute.' };
    };
    const about = { title: 'T', kind: 'reading' as const, week: null, courseTitle: 'C' };
    expect((await readCourseFile({ ...about, name: 'a.mp4', bytes: new Uint8Array([1]) }, ask)).ok).toBe(false);
    expect(asked).toBe(0);
    expect(await readCourseFile({ ...about, name: 'a.txt', bytes: new TextEncoder().encode('words') }, ask)).toEqual({
      ok: false,
      error: 'Reading is rate-limited right now. Try again in a minute.',
    });
  });

  it('has a tool that asks for at most five points and a reason when there are none', () => {
    const schema = summaryTool().input_schema as { properties: { points: { maxItems: number } }; required: string[] };
    expect(schema.properties.points.maxItems).toBe(POINTS_MAX);
    expect(schema.required).toEqual(['summary', 'points', 'unreadable']);
    expect(summaryPrompt({ title: 'Syllabus', kind: 'syllabus', week: null, courseTitle: 'C' })).not.toContain('from week');
  });
});

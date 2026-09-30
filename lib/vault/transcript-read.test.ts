import { deflateRawSync } from 'node:zlib';
import type Anthropic from '@anthropic-ai/sdk';
import { describe, expect, it } from 'vitest';
import type { ExtractResult, ExtractSource } from '@/lib/goals/extract-model';
import { askTranscriptModel } from '@/lib/vault/transcript-model';
import {
  COURSES_MAX,
  readTranscript,
  readTranscriptAnswer,
  transcriptTool,
} from '@/lib/vault/transcript-read';

/** A model stub that records what it was given and answers with this tool input. */
function stub(input: unknown) {
  const given: ExtractSource[] = [];
  return {
    given,
    ask: async (source: ExtractSource): Promise<ExtractResult> => {
      given.push(source);
      return { ok: true, input };
    },
  };
}

/** A zip holding the given entries, deflated, which is all a .docx is. */
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

const PASTED = `STATE UNIVERSITY - OFFICIAL TRANSCRIPT
Fall 2018
CS 101  Intro to Programming   4.0  A-
MATH 151 Calculus I            4.0  B+
Spring 2019
CS 201  Data Structures        4.0  A
Transfer credit: Riverside Community College
ENGL 101 Composition           3.0  TR
Term GPA 3.67`;

/** What the model is expected to hand back for PASTED. */
const ANSWER = {
  school: 'State University',
  courses: [
    { school: null, code: 'CS 101', title: 'Intro to Programming', term: 'Fall 2018', year: 2018, credits: 4, grade: 'A-' },
    { school: null, code: 'MATH 151', title: 'Calculus I', term: 'Fall 2018', year: 2018, credits: 4, grade: 'B+' },
    { school: null, code: 'CS 201', title: 'Data Structures', term: 'Spring 2019', year: null, credits: 4, grade: 'A' },
    {
      school: 'Riverside Community College',
      code: 'ENGL 101',
      title: 'Composition',
      term: null,
      year: null,
      credits: 3,
      grade: null,
    },
  ],
  unreadable: null,
};

describe('readTranscript, with the model stubbed', () => {
  it('reads courses across schools and terms, with term and grade as written', async () => {
    const model = stub(ANSWER);
    const result = await readTranscript({ text: PASTED }, model.ask);

    expect(model.given).toEqual([{ kind: 'text', text: PASTED }]);
    expect(result).toEqual({
      ok: true,
      school: 'State University',
      courses: [
        { school: 'State University', code: 'CS 101', title: 'Intro to Programming', term: 'Fall 2018', year: 2018, credits: 4, grade: 'A-', position: 0 },
        { school: 'State University', code: 'MATH 151', title: 'Calculus I', term: 'Fall 2018', year: 2018, credits: 4, grade: 'B+', position: 1 },
        // The year comes from the term when the model leaves it out.
        { school: 'State University', code: 'CS 201', title: 'Data Structures', term: 'Spring 2019', year: 2019, credits: 4, grade: 'A', position: 2 },
        // A transfer credit keeps its own school and has no grade.
        { school: 'Riverside Community College', code: 'ENGL 101', title: 'Composition', term: null, year: null, credits: 3, grade: null, position: 3 },
      ],
    });
  });

  it('sends a PDF as a document and a photo as an image', async () => {
    const pdf = stub(ANSWER);
    await readTranscript({ name: 'u/id-transcript.pdf', bytes: new Uint8Array([37, 80, 68, 70]) }, pdf.ask);
    expect(pdf.given[0]).toEqual({ kind: 'pdf', data: 'JVBERg==' });

    const photo = stub(ANSWER);
    const result = await readTranscript({ name: 'IMG_2231.JPG', bytes: new Uint8Array([255, 216, 255]) }, photo.ask);
    expect(photo.given[0]).toMatchObject({ kind: 'image', mediaType: 'image/jpeg' });
    expect(result.ok).toBe(true);
  });

  it('sends a Word transcript as its text, table rows kept apart', async () => {
    const xml =
      '<w:document><w:body><w:p><w:r><w:t>Lakeside College</w:t></w:r></w:p>' +
      '<w:tbl><w:tr><w:tc><w:p><w:t>BIO 110</w:t></w:p></w:tc><w:tc><w:p><w:t>Biology</w:t></w:p></w:tc>' +
      '<w:tc><w:p><w:t>Autumn 2020</w:t></w:p></w:tc><w:tc><w:p><w:t>P</w:t></w:p></w:tc></w:tr></w:tbl>' +
      '</w:body></w:document>';
    const model = stub({
      school: 'Lakeside College',
      courses: [{ school: null, code: 'BIO 110', title: 'Biology', term: 'Autumn 2020', year: 2020, credits: null, grade: 'P' }],
      unreadable: null,
    });
    const result = await readTranscript(
      { name: 'transcript.docx', bytes: zip({ 'word/document.xml': xml }) },
      model.ask,
    );
    expect(model.given[0].kind).toBe('text');
    expect((model.given[0] as { text: string }).text).toContain('Lakeside College');
    expect((model.given[0] as { text: string }).text).toContain('BIO 110');
    expect(result).toMatchObject({ ok: true, courses: [{ grade: 'P', credits: null, school: 'Lakeside College' }] });
  });

  it('returns a message, not an empty list, when the transcript has no courses', async () => {
    const model = stub({ school: null, courses: [], unreadable: 'the photo is too blurred to read' });
    const result = await readTranscript({ name: 'blurry.png', bytes: new Uint8Array([1, 2, 3]) }, model.ask);
    expect(result).toEqual({
      ok: false,
      error: 'No courses could be read from that. The photo is too blurred to read. Try a clearer copy, or paste the text.',
    });

    const silent = stub({ school: 'State University', courses: [], unreadable: null });
    const second = await readTranscript({ text: 'Dear applicant, thank you.' }, silent.ask);
    expect(second).toEqual({
      ok: false,
      error: 'No courses could be read from that. Try a clearer copy, or paste the text.',
    });
  });

  it('returns a message for an empty or unreadable file without asking the model', async () => {
    const model = stub(ANSWER);
    expect(await readTranscript({ name: 'transcript.pdf', bytes: new Uint8Array() }, model.ask)).toEqual({
      ok: false,
      error: 'That file is empty.',
    });
    expect(await readTranscript({ text: '   ' }, model.ask)).toEqual({ ok: false, error: 'Paste some text first.' });
    expect(await readTranscript({ name: 'scan.heic', bytes: new Uint8Array([1]) }, model.ask)).toMatchObject({
      ok: false,
      error: expect.stringContaining('cannot be read'),
    });
    expect(await readTranscript({ name: 'broken.docx', bytes: new Uint8Array([1, 2, 3]) }, model.ask)).toEqual({
      ok: false,
      error: 'That Word file could not be opened.',
    });
    expect(model.given).toEqual([]);
  });

  it('passes on the reason a model call failed', async () => {
    const result = await readTranscript({ text: PASTED }, async () => ({ ok: false, error: 'Nothing came back.' }));
    expect(result).toEqual({ ok: false, error: 'Nothing came back.' });
  });
});

describe('readTranscriptAnswer', () => {
  it('drops malformed rows, trims text and keeps numbers in range', () => {
    const read = readTranscriptAnswer({
      school: '  Old  College ',
      courses: [
        'not a course',
        { title: '   ' },
        { title: 'Ethics', code: 'n/a', term: 'Winter 1999', credits: '2.5', grade: 85, year: 3000 },
        { title: 'Physics', credits: -1 },
      ],
    });
    expect(read.school).toBe('Old College');
    expect(read.courses).toEqual([
      { school: 'Old College', code: null, title: 'Ethics', term: 'Winter 1999', year: 1999, credits: 2.5, grade: '85', position: 0 },
      { school: 'Old College', code: null, title: 'Physics', term: null, year: null, credits: null, grade: null, position: 1 },
    ]);
  });

  it('reads nothing from an answer that is not an object', () => {
    expect(readTranscriptAnswer(null)).toEqual({ school: null, courses: [], unreadable: null });
  });

  it('keeps at most COURSES_MAX courses', () => {
    const courses = Array.from({ length: COURSES_MAX + 5 }, (_, i) => ({ title: `Course ${i}` }));
    expect(readTranscriptAnswer({ courses }).courses).toHaveLength(COURSES_MAX);
  });

  it('asks for every field on each course', () => {
    const schema = transcriptTool().input_schema as {
      properties: { courses: { items: { required: string[] } } };
    };
    expect(schema.properties.courses.items.required).toEqual([
      'school',
      'code',
      'title',
      'term',
      'year',
      'credits',
      'grade',
    ]);
  });
});

describe('askTranscriptModel', () => {
  function client(response: Record<string, unknown>) {
    const calls: Record<string, unknown>[] = [];
    return {
      calls,
      client: {
        messages: {
          create: async (params: Record<string, unknown>) => {
            calls.push(params);
            return { usage: { input_tokens: 100, output_tokens: 20 }, stop_reason: 'tool_use', ...response };
          },
        },
      } as unknown as Anthropic,
    };
  }

  it('forces the course tool, reports the cost and hands back its input', async () => {
    const fake = client({ content: [{ type: 'tool_use', name: 'list_courses', id: 't', input: ANSWER }] });
    const spent: unknown[] = [];
    const result = await askTranscriptModel(
      { apiKey: 'k', client: fake.client, onSpend: (report) => spent.push(report) },
      { kind: 'image', data: 'AAAA', mediaType: 'image/png' },
    );
    expect(result).toEqual({ ok: true, input: ANSWER });
    expect(spent).toHaveLength(1);
    expect(fake.calls[0]).toMatchObject({ tool_choice: { type: 'tool', name: 'list_courses' } });
    const content = (fake.calls[0].messages as { content: { type: string }[] }[])[0].content;
    expect(content[0]).toMatchObject({ type: 'image', source: { media_type: 'image/png' } });
  });

  it('says so when the answer was cut off', async () => {
    const fake = client({ stop_reason: 'max_tokens', content: [] });
    const spent: unknown[] = [];
    const result = await askTranscriptModel(
      { apiKey: 'k', client: fake.client, onSpend: (report) => spent.push(report) },
      { kind: 'text', text: PASTED },
    );
    expect(result).toMatchObject({ ok: false, error: expect.stringContaining('too long') });
    expect(spent).toHaveLength(1);
  });
});

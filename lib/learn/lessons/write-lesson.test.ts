import { describe, expect, it } from 'vitest';
import type Anthropic from '@anthropic-ai/sdk';
import type { NearbySegment, NearestOutcome } from '@/lib/learn/catalogue/nearest';
import type { LearnSupabaseClient } from '@/lib/learn/db/schema-name';
import {
  LESSON_SOURCE_MIN_SIMILARITY,
  closestFrom,
  findLessonSource,
  type LessonSource,
} from './closest-source';
import {
  MAX_SOURCE_CHARS,
  lessonPrompt,
  readLessonReport,
  writeLesson,
  type LessonToWrite,
} from './write-lesson';

/**
 * Writing the lesson for one concept, and finding the section it is checked
 * against.
 *
 * The model and the catalogue are stubbed. What is tested is what happens to
 * their answers: a contradicting source drops the lesson and is kept, an
 * unrelated one is left off, the title is always the concept's name, and the
 * source search returns null rather than throwing.
 */

const source: LessonSource = {
  segmentId: 'seg-1',
  itemId: 'item-1',
  itemTitle: 'CHIPS and Science Act',
  heading: 'Manufacturing',
  url: 'https://en.wikipedia.org/wiki/CHIPS_and_Science_Act',
  sectionAnchor: 'Manufacturing',
  text: 'Most shortages in 2021 were of mature-node chips made on older lines.',
  similarity: 0.6,
};

const lesson: LessonToWrite = {
  concept: {
    name: 'Old chip lines are fragile',
    claim: 'Fully depreciated chip lines cannot absorb demand spikes, because nobody builds new capacity for them.',
    mastery: ['Says why a shortage of old chips lasts longer than one of new chips.'],
  },
  trackName: 'The chip supply chain',
  unit: { title: 'Why shortages happen', outcome: 'Explain a chip shortage from its causes.' },
  prerequisites: ['Fabs take years to build'],
  source,
};

/** The report as the model sends it. */
const reported = {
  can_teach: true,
  fit: 'Well established.',
  source_verdict: 'supports',
  source_note: 'It says the 2021 shortages were mostly of older chips.',
  claim: 'Old chip lines run flat out, so a jump in demand for their chips turns into a shortage.',
  context: 'A chip line is depreciated once it has paid for itself.',
  evidence: 'Most shortages in 2021 were of mature-node chips.',
  why: 'Nobody builds a new line for a chip that sells cheaply, so capacity is fixed.',
  example: 'Carmakers idled plants in 2021 for want of microcontrollers made on old lines.',
  question: 'Why did the 2021 shortage hit carmakers harder than phone makers?',
  answer: 'Cars use older chips, whose lines had no spare capacity and got no new investment.',
};

/** The same lesson as the feed stores it. */
const stored = {
  name: 'Old chip lines are fragile',
  takeaway: reported.claim,
  context: reported.context,
  hook: reported.evidence,
  summary: reported.why,
  example: reported.example,
  question: reported.question,
  answer: reported.answer,
};

describe('reading the lesson report', () => {
  it('reads a lesson in the column shape, without a name', () => {
    expect(readLessonReport(reported, true)).toEqual({
      verdict: 'ready',
      card: {
        takeaway: stored.takeaway,
        context: stored.context,
        hook: stored.hook,
        summary: stored.summary,
        example: stored.example,
        question: stored.question,
        answer: stored.answer,
      },
      source: { verdict: 'supports', note: reported.source_note },
    });
  });

  it('drops a lesson the source contradicts, with the model sentence', () => {
    expect(
      readLessonReport({ ...reported, source_verdict: 'contradicts', source_note: 'It says old lines had spare capacity.' }, true),
    ).toEqual({ verdict: 'dropped', reason: 'It says old lines had spare capacity.', contradicted: true });
  });

  it('ignores a verdict on a source that was never sent', () => {
    const report = readLessonReport({ ...reported, source_verdict: 'contradicts' }, false);
    expect(report).toMatchObject({ verdict: 'ready', source: null });
  });

  it('reads a missing verdict on a sent source as unrelated', () => {
    const report = readLessonReport({ ...reported, source_verdict: null }, true);
    expect(report).toMatchObject({ verdict: 'ready', source: { verdict: 'unrelated' } });
  });

  it('drops a claim the model cannot vouch for', () => {
    expect(readLessonReport({ ...reported, can_teach: false, fit: 'The claim is false.' }, false)).toEqual({
      verdict: 'dropped',
      reason: 'The claim is false.',
      contradicted: false,
    });
  });

  it('drops a lesson with a part missing or too long', () => {
    expect(readLessonReport({ ...reported, evidence: ' ' }, true)).toMatchObject({
      verdict: 'dropped',
      reason: 'The lesson was not usable: no evidence.',
    });
    expect(readLessonReport({ ...reported, why: 'x'.repeat(901) }, true)).toMatchObject({
      verdict: 'dropped',
      reason: 'The lesson was not usable: a reason why of 901 characters.',
    });
  });

  it('leaves the question off when its answer is missing', () => {
    expect(readLessonReport({ ...reported, answer: null }, true)).toMatchObject({
      verdict: 'ready',
      card: { question: null, answer: null },
    });
  });

  it('drops a report that does not match its schema', () => {
    expect(readLessonReport({ claim: 'x' }, true)).toMatchObject({ verdict: 'dropped', contradicted: false });
  });
});

describe('the lesson prompt', () => {
  it('names the track, unit, claim, checks, prerequisites and source', () => {
    const prompt = lessonPrompt(lesson);
    expect(prompt).toContain('Track: The chip supply chain');
    expect(prompt).toContain('Unit: Why shortages happen. By its end they should be able to: Explain a chip shortage from its causes.');
    expect(prompt).toContain(`Claim: ${lesson.concept.claim}`);
    expect(prompt).toContain('- Says why a shortage of old chips lasts longer than one of new chips.');
    expect(prompt).toContain('- Fabs take years to build');
    expect(prompt).toContain('from "CHIPS and Science Act", section "Manufacturing".');
    expect(prompt).toContain(`<source>\n${source.text}\n</source>`);
    expect(prompt).not.toMatch(/\n\n\n/);
  });

  it('says when there is no source, no unit and no prerequisite', () => {
    const prompt = lessonPrompt({ ...lesson, unit: null, prerequisites: [], source: null });
    expect(prompt).not.toContain('Unit:');
    expect(prompt).toContain('It builds on nothing they have been taught here.');
    expect(prompt).toContain('No reference section is close to this claim.');
    expect(prompt).not.toContain('<source>');
  });

  it('cuts a long source and says so', () => {
    const prompt = lessonPrompt({ ...lesson, source: { ...source, text: 'a'.repeat(MAX_SOURCE_CHARS + 50) } });
    expect(prompt).toContain(`these are its first ${MAX_SOURCE_CHARS} characters`);
    expect(prompt).not.toContain('a'.repeat(MAX_SOURCE_CHARS + 1));
  });
});

describe('writing a lesson', () => {
  function stubClient(reply: unknown): { client: Anthropic; calls: unknown[] } {
    const calls: unknown[] = [];
    const client = {
      messages: {
        create: async (params: unknown) => {
          calls.push(params);
          return reply;
        },
      },
    } as unknown as Anthropic;
    return { client, calls };
  }

  const usage = { input_tokens: 1_200, output_tokens: 600 };
  const replyWith = (input: unknown) => ({
    content: [{ type: 'tool_use', name: 'report_lesson', input }],
    stop_reason: 'tool_use',
    usage,
  });

  it('forces the report, records the spend, titles it with the concept and cites a supporting source', async () => {
    const { client, calls } = stubClient(replyWith({ ...reported, name: 'Something else' }));
    const spent: string[] = [];
    const result = await writeLesson({
      lesson,
      anthropicApiKey: 'unused',
      client,
      onSpend: (report) => spent.push(report.model),
    });
    expect(result).toEqual({
      outcome: 'ready',
      card: stored,
      source: { segmentId: 'seg-1', itemTitle: 'CHIPS and Science Act', heading: 'Manufacturing' },
    });
    expect(spent).toEqual(['claude-sonnet-5']);
    expect(calls[0]).toMatchObject({ model: 'claude-sonnet-5', tool_choice: { type: 'tool', name: 'report_lesson' } });
  });

  it('leaves an unrelated source off the lesson', async () => {
    const { client } = stubClient(replyWith({ ...reported, source_verdict: 'unrelated' }));
    expect(await writeLesson({ lesson, anthropicApiKey: 'unused', client })).toMatchObject({
      outcome: 'ready',
      source: null,
    });
  });

  it('drops a contradicted lesson and keeps the source that contradicts it', async () => {
    const { client } = stubClient(
      replyWith({ ...reported, source_verdict: 'contradicts', source_note: 'It says old lines had spare capacity.' }),
    );
    expect(await writeLesson({ lesson, anthropicApiKey: 'unused', client })).toEqual({
      outcome: 'dropped',
      reason: 'It says old lines had spare capacity.',
      contradicted: true,
      source: { segmentId: 'seg-1', itemTitle: 'CHIPS and Science Act', heading: 'Manufacturing' },
    });
  });

  it('drops the lesson, and still records the spend, when there is no report', async () => {
    const { client } = stubClient({ content: [{ type: 'text', text: 'Here it is.' }], stop_reason: 'end_turn', usage });
    const spent: string[] = [];
    const result = await writeLesson({
      lesson,
      anthropicApiKey: 'unused',
      client,
      onSpend: (report) => spent.push(report.model),
    });
    expect(result).toMatchObject({ outcome: 'dropped', contradicted: false, source: null });
    expect(spent).toHaveLength(1);
  });

  it('fails, to be tried again, when the call itself fails', async () => {
    const client = {
      messages: {
        create: async () => {
          throw new Error('socket hang up');
        },
      },
    } as unknown as Anthropic;
    expect(await writeLesson({ lesson, anthropicApiKey: 'unused', client })).toEqual({
      outcome: 'failed',
      detail: 'socket hang up',
    });
  });

  it('drops a concept with no claim without calling the model', async () => {
    const { client, calls } = stubClient({});
    const result = await writeLesson({
      lesson: { ...lesson, concept: { name: 'x', claim: '  ' } },
      anthropicApiKey: 'unused',
      client,
    });
    expect(result).toMatchObject({ outcome: 'dropped' });
    expect(calls).toHaveLength(0);
  });

  it('sends no source that has no text', async () => {
    const { client, calls } = stubClient(replyWith({ ...reported, source_verdict: 'none' }));
    const result = await writeLesson({
      lesson: { ...lesson, source: { ...source, text: ' ' } },
      anthropicApiKey: 'unused',
      client,
    });
    expect(result).toMatchObject({ outcome: 'ready', source: null });
    expect(JSON.stringify(calls[0])).not.toContain('<source>');
  });
});

describe('the closest catalogue section', () => {
  const segment = (similarity: number, id = 'seg-1'): NearbySegment => ({
    segmentId: id,
    itemId: 'item-1',
    ordinal: 0,
    heading: 'Manufacturing',
    sectionAnchor: 'Manufacturing',
    tStartSeconds: null,
    tEndSeconds: null,
    text: 'Some text.',
    embeddingModel: 'voyage-4-lite',
    similarity,
    item: { title: 'CHIPS and Science Act', kind: 'article', canonicalUrl: 'https://example.org' },
  });
  const found = (segments: NearbySegment[]): NearestOutcome => ({
    ok: true,
    segments,
    model: 'voyage-4-lite',
    models: ['voyage-4-lite'],
    tokens: 12,
  });

  it('takes the first segment at or above the floor', () => {
    expect(closestFrom(found([segment(0.6)]))).toMatchObject({
      segmentId: 'seg-1',
      itemTitle: 'CHIPS and Science Act',
      heading: 'Manufacturing',
    });
    expect(closestFrom(found([segment(LESSON_SOURCE_MIN_SIMILARITY)]))).not.toBeNull();
  });

  it('returns null below the floor, for nothing, and for a failed search', () => {
    expect(closestFrom(found([segment(0.54)]))).toBeNull();
    expect(closestFrom(found([]))).toBeNull();
    expect(closestFrom({ ok: false, reason: 'index', detail: 'down', tokens: 0 })).toBeNull();
  });

  const supabase = {} as LearnSupabaseClient;

  it('asks for one segment at the floor, embedded from the trimmed claim', async () => {
    const asked: unknown[] = [];
    const result = await findLessonSource(supabase, '  a claim ', {
      find: async (_client, claim, options) => {
        asked.push({ claim, limit: options?.limit, minSimilarity: options?.minSimilarity });
        return found([segment(0.7)]);
      },
    });
    expect(result).toMatchObject({ segmentId: 'seg-1' });
    expect(asked).toEqual([{ claim: 'a claim', limit: 1, minSimilarity: LESSON_SOURCE_MIN_SIMILARITY }]);
  });

  it('returns null instead of throwing', async () => {
    const result = await findLessonSource(supabase, 'a claim', {
      find: async () => {
        throw new Error('boom');
      },
    });
    expect(result).toBeNull();
    expect(await findLessonSource(supabase, '  ')).toBeNull();
  });
});

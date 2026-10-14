import { describe, expect, it } from 'vitest';
import {
  AGREE_SIMILARITY,
  LINKS_PER_TOPIC,
  NAME_CONFIRM_SIMILARITY,
  STRONG_SIMILARITY,
  buildTopicNames,
  decideTopicUnlocks,
  findTopicNames,
  staleTopicLinkIds,
  topicSource,
  type TopicHit,
  type TopicSource,
  type TopicSourceRow,
} from './topics';

const source = (id: string, over: Partial<TopicSource> = {}): TopicSource => ({
  kind: 'note',
  id,
  document: id,
  label: `your note ${id}`,
  weight: 1,
  text: '',
  ...over,
});

const index = buildTopicNames([
  { id: 'ev', title: 'Expected value', aliases: ['Mathematical expectation', 'EV'] },
  { id: 'lbo', title: 'Leveraged buyout', aliases: ['LBO', 'the change', 'in an'] },
  { id: 'time', title: 'Time', aliases: null },
  { id: 'interest', title: 'Interest (economics)', aliases: ['Interest rate'] },
  { id: 'yale', title: 'Yale University', aliases: ['yale.edu'] },
  { id: 'stoicism', title: 'Stoicism', aliases: ['Stoic philosophy'] },
]);

describe('finding names', () => {
  it('finds a title of two words anywhere, whole words only, as a sure name', () => {
    const found = findTopicNames(index, 'The expected   value of the bet was negative.');
    expect(found.get('ev')).toEqual({ name: 'Expected value', sure: true });
    expect(findTopicNames(index, 'unexpected values').has('ev')).toBe(false);
  });

  it('matches a short name in capitals case for case, and drops two-letter ones', () => {
    expect(findTopicNames(index, 'We modelled the LBO in week three.').get('lbo')?.sure).toBe(true);
    expect(findTopicNames(index, 'an lbo model').has('lbo')).toBe(false);
    expect(findTopicNames(index, 'EV was 4.2').has('ev')).toBe(false);
  });

  it('counts a one-word title, a qualified title and a redirect as loose names', () => {
    expect(findTopicNames(index, 'Time is short').get('time')).toEqual({ name: 'Time', sure: false });
    expect(findTopicNames(index, 'interest on the loan').get('interest')?.sure).toBe(false);
    expect(findTopicNames(index, 'the interest rate rose').get('interest')?.sure).toBe(false);
    expect(findTopicNames(index, 'a stoic philosophy of work').get('stoicism')?.sure).toBe(false);
  });

  it('drops names made of small words and web addresses', () => {
    expect(findTopicNames(index, 'it came in an hour').has('lbo')).toBe(false);
    expect(findTopicNames(index, 'mail me at someone@yale.edu').has('yale')).toBe(false);
    expect(findTopicNames(index, 'my time at Yale University').get('yale')?.sure).toBe(true);
  });

  it('reads accents and curly apostrophes as plain letters', () => {
    const accents = buildTopicNames([
      { id: 'flt', title: "Fermat's Last Theorem", aliases: [] },
      { id: 'cafe', title: 'Café society', aliases: [] },
    ]);
    expect(findTopicNames(accents, 'Fermat’s last theorem took 358 years').has('flt')).toBe(true);
    expect(findTopicNames(accents, 'the cafe society of Vienna').has('cafe')).toBe(true);
  });
});

describe('deciding unlocks', () => {
  it('unlocks nothing from a single weak similarity match', () => {
    const hits: TopicHit[] = [{ topicId: 'metabolism', source: source('a'), similarity: AGREE_SIMILARITY + 0.02 }];
    expect(decideTopicUnlocks(hits)).toEqual([]);
  });

  it('unlocks nothing from a single strong similarity match either', () => {
    const hits: TopicHit[] = [{ topicId: 'metabolism', source: source('a'), similarity: 0.9 }];
    expect(decideTopicUnlocks(hits)).toEqual([]);
  });

  it('unlocks nothing from two weak matches', () => {
    const hits: TopicHit[] = [
      { topicId: 't', source: source('a'), similarity: STRONG_SIMILARITY - 0.01 },
      { topicId: 't', source: source('b'), similarity: STRONG_SIMILARITY - 0.01 },
    ];
    expect(decideTopicUnlocks(hits)).toEqual([]);
  });

  it('unlocks a topic when a strong match agrees with a second source', () => {
    const rows = decideTopicUnlocks([
      { topicId: 't', source: source('a'), similarity: STRONG_SIMILARITY },
      { topicId: 't', source: source('idea-1', { kind: 'idea', label: 'your idea "Margins"' }), similarity: AGREE_SIMILARITY },
    ]);
    expect(rows.map((r) => [r.source_id, r.matched_by, r.basis])).toEqual([
      ['a', 'similarity', 'close to your note a'],
      ['idea-1', 'similarity', 'close to your idea "Margins"'],
    ]);
  });

  it('does not count two passages of one document as two sources', () => {
    const resume = { kind: 'work' as const, document: 'resume-1' };
    const rows = decideTopicUnlocks([
      { topicId: 't', source: source('p1', resume), similarity: 0.8 },
      { topicId: 't', source: source('p2', resume), similarity: 0.7 },
    ]);
    expect(rows).toEqual([]);
  });

  it('unlocks on a sure name alone and records why', () => {
    const rows = decideTopicUnlocks([
      { topicId: 'ev', source: source('a', { weight: 0.25 }), name: { name: 'Expected value', sure: true }, similarity: null },
    ]);
    expect(rows).toEqual([
      {
        target_kind: 'topic',
        target_id: 'ev',
        source_kind: 'note',
        source_id: 'a',
        similarity: 0,
        weight: 0.25,
        basis: 'named in your note a',
        matched_by: 'name',
      },
    ]);
  });

  it('believes a loose name only where the text is about the topic', () => {
    const loose = { name: 'Time', sure: false };
    expect(
      decideTopicUnlocks([{ topicId: 'time', source: source('a'), name: loose, similarity: NAME_CONFIRM_SIMILARITY - 0.01 }]),
    ).toEqual([]);
    expect(
      decideTopicUnlocks([{ topicId: 'time', source: source('a'), name: loose, similarity: NAME_CONFIRM_SIMILARITY }]),
    ).toHaveLength(1);
  });

  it('merges a name and a vector from one source into one name link', () => {
    const rows = decideTopicUnlocks([
      { topicId: 's', source: source('a'), name: { name: 'Stoicism', sure: false }, similarity: null },
      { topicId: 's', source: source('a'), similarity: 0.7 },
    ]);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ matched_by: 'name', similarity: 0.7 });
  });

  it('keeps names first and at most a few links per topic', () => {
    const hits: TopicHit[] = [];
    for (let i = 0; i < 8; i++) hits.push({ topicId: 't', source: source(`s${i}`), similarity: 0.6 + i / 100 });
    hits.push({ topicId: 't', source: source('named', { weight: 0.25 }), name: { name: 'T T', sure: true }, similarity: 0.56 });
    const rows = decideTopicUnlocks(hits);
    expect(rows).toHaveLength(LINKS_PER_TOPIC);
    expect(rows[0].source_id).toBe('named');
    expect(rows[1].source_id).toBe('s7');
  });

  it('leaves out a source that counts for nothing', () => {
    expect(
      decideTopicUnlocks([
        { topicId: 'ev', source: source('a', { weight: 0 }), name: { name: 'Expected value', sure: true }, similarity: null },
      ]),
    ).toEqual([]);
  });
});

describe('sources', () => {
  const row = (over: Partial<TopicSourceRow>): TopicSourceRow => ({
    source_id: 'x',
    document_id: 'x',
    title: null,
    body: null,
    detail: null,
    created_at: null,
    written_at: null,
    grade: null,
    year: null,
    origin: null,
    weight: null,
    ...over,
  });

  it('weighs a clipping a quarter and names the note', () => {
    const note = topicSource(
      'note',
      row({ title: null, body: 'text', detail: 'Bulk/Saved.md', created_at: '2026-01-01T00:00:00Z', written_at: '2026-01-01T00:00:00Z' }),
      2026,
    );
    expect(note).toMatchObject({ weight: 0.25, label: 'your note Saved', text: 'Saved\ntext' });
  });

  it('weighs a course by grade and age, and drops one that counts nothing', () => {
    expect(topicSource('course', row({ title: 'Corporate Finance', detail: 'MGT 541', grade: 'A', year: 2026 }), 2026)).toMatchObject({
      label: 'MGT 541 Corporate Finance',
      weight: 1,
    });
    expect(topicSource('course', row({ title: 'Corporate Finance', grade: 'W', year: 2026 }), 2026)).toBeNull();
  });

  it('labels a work passage by where it came from', () => {
    expect(
      topicSource('work', row({ origin: 'resume', detail: 'Built the model', weight: 1, document_id: 'r' }), 2026),
    ).toMatchObject({ label: 'your résumé: "Built the model"', document: 'r' });
  });
});

describe('stale links', () => {
  it('names the topic links a refresh no longer finds', () => {
    const existing = [
      { id: '1', target_id: 't', source_kind: 'note', source_id: 'a' },
      { id: '2', target_id: 't', source_kind: 'idea', source_id: 'a' },
    ];
    expect(staleTopicLinkIds(existing, [{ target_id: 't', source_kind: 'note', source_id: 'a' }])).toEqual(['2']);
  });
});

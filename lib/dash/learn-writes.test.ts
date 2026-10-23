import { describe, expect, it, vi } from 'vitest';
import { LEARN_CHANGE_KINDS } from '@/lib/ask/learn-changes';
import { LEARN_WRITES, runLearnWrite, type LearnWriteEnv } from './learn-writes';

vi.mock('@/lib/learn/youtube/video-card-run', () => ({ settleVideoCards: vi.fn(async () => ({ withdrawn: 0, revived: 0 })) }));
vi.mock('@/lib/learn/briefs/start', () => ({ briefStarter: vi.fn() }));
vi.mock('@/lib/learn/embed/idea-embedding', () => ({
  embedIdeaClaim: vi.fn(async () => ({ embedding: null, embedding_model: null })),
}));

/**
 * The Learn writes an agent makes (plan #1894.8): each one row, scoped to the
 * person by its own filter (the connector runs them with no row level
 * security), and reported with the values its Undo needs.
 */

type Row = Record<string, unknown>;
const ME = 'me';
const READING = '11111111-1111-4111-8111-111111111111';
const TRACK = '22222222-2222-4222-8222-222222222222';
const CONCEPT = '33333333-3333-4333-8333-333333333333';
const BRIEF = '44444444-4444-4444-8444-444444444444';
const ESSAY = '55555555-5555-4555-8555-555555555555';
const NOTE = '66666666-6666-4666-8666-666666666666';

/** A learn client over in-memory tables, enough of the query builder for these writes. */
function fakeLearn(tables: Record<string, Row[]>) {
  let ids = 0;
  const from = (table: string) => {
    const rows = (tables[table] ??= []);
    let op: 'select' | 'update' | 'insert' | 'delete' = 'select';
    let patch: Row = {};
    let order: string | null = null;
    const filters: [string, unknown, boolean?][] = [];
    const matching = () =>
      rows.filter((row) => filters.every(([column, value, not]) => ((row[column] ?? null) === value) !== Boolean(not)));
    const run = (): Row[] => {
      if (op === 'insert') {
        const row = { id: `new-${++ids}`, ...patch };
        rows.push(row);
        return [row];
      }
      const found = matching();
      if (op === 'delete') {
        for (const row of found) rows.splice(rows.indexOf(row), 1);
        return found;
      }
      if (op === 'update') for (const row of found) Object.assign(row, patch);
      if (order) found.sort((a, b) => Number(b[order!]) - Number(a[order!]));
      return found.map((row) => ({ ...row }));
    };
    const builder = {
      select: () => builder,
      update: (values: Row) => ((op = 'update'), (patch = values), builder),
      insert: (values: Row) => ((op = 'insert'), (patch = values), builder),
      delete: () => ((op = 'delete'), builder),
      eq: (column: string, value: unknown) => (filters.push([column, value]), builder),
      is: (column: string, value: unknown) => (filters.push([column, value]), builder),
      neq: (column: string, value: unknown) => (filters.push([column, value, true]), builder),
      then: (resolve: (result: { data: Row[]; error: null }) => unknown) => resolve({ data: run(), error: null }),
      order: (column: string) => ((order = column), builder),
      limit: () => builder,
      maybeSingle: async () => ({ data: run()[0] ?? null, error: null }),
      single: async () => {
        const [row] = run();
        return row ? { data: row, error: null } : { data: null, error: { message: 'no row' } };
      },
    };
    return builder;
  };
  return { from } as unknown as LearnWriteEnv['learn'];
}

const write = (name: string) => LEARN_WRITES.find((entry) => entry.name === name)!;

describe('the Learn writes', () => {
  it('are the kinds Ask keeps them under, in order', () => {
    expect(LEARN_WRITES.map((entry) => entry.name)).toEqual([...LEARN_CHANGE_KINDS]);
  });

  it('marks a reading read, takes it off the shelf and keeps the row as it was', async () => {
    const tables = {
      readings: [{ id: READING, user_id: ME, title: 'Attention Is All You Need', status: 'reading', read_now_at: '2026-10-01' }],
    };
    const made = await runLearnWrite(write('change_reading'), { userId: ME, learn: fakeLearn(tables) }, {
      reading_id: READING,
      status: 'read',
    });
    if ('ok' in made) throw new Error(made.error);
    expect(made.op).toBe('update');
    expect(made.subjectRef).toBe(`learn.readings:${READING}`);
    expect(made.before).toMatchObject({ status: 'reading', read_now_at: '2026-10-01' });
    expect(made.after).toMatchObject({ status: 'read', read_now_at: null });
    expect(made.summary).toBe('Dash changed the reading "Attention Is All You Need": marked read.');
    expect(made.input.href).toBe(`/learn/r/${READING}`);
  });

  it('refuses a reading that is not the person’s, and a call that changes nothing', async () => {
    const tables = { readings: [{ id: READING, user_id: 'someone else', title: 'Theirs' }] };
    const env = { userId: ME, learn: fakeLearn(tables) };
    expect(await runLearnWrite(write('change_reading'), env, { reading_id: READING, status: 'read' })).toEqual({
      ok: false,
      error: 'There is no reading of theirs with that id. Look it up first.',
    });
    tables.readings[0].user_id = ME;
    expect(await runLearnWrite(write('change_reading'), env, { reading_id: READING })).toEqual({
      ok: false,
      error: 'Say what to change: status, read_now, note, text, clear_text or link.',
    });
  });

  it('adds a reading at the end of a list, with the source for its link', async () => {
    const tables: Record<string, Row[]> = {
      tracks: [{ id: TRACK, user_id: ME, title: 'Transformers' }],
      readings: [{ id: READING, user_id: ME, track_id: TRACK, position: 30 }],
    };
    const made = await runLearnWrite(write('add_track_reading'), { userId: ME, learn: fakeLearn(tables) }, {
      track_id: TRACK,
      title: 'The Illustrated Transformer',
      link: 'https://jalammar.github.io/illustrated-transformer/',
    });
    if ('ok' in made) throw new Error(made.error);
    expect(made.op).toBe('insert');
    expect(made.after).toMatchObject({ track_id: TRACK, position: 40, user_id: ME, open_url: 'https://jalammar.github.io/illustrated-transformer/' });
    expect(tables.sources).toEqual([expect.objectContaining({ user_id: ME, canonical_url: 'https://jalammar.github.io/illustrated-transformer/' })]);
    expect(made.summary).toBe('Dash added "The Illustrated Transformer" to the reading list "Transformers".');
  });

  it('refuses a link that is not https', async () => {
    const tables = { tracks: [{ id: TRACK, user_id: ME, title: 'Transformers' }] };
    expect(
      await runLearnWrite(write('add_track_reading'), { userId: ME, learn: fakeLearn(tables) }, {
        track_id: TRACK,
        title: 'A page',
        link: 'http://example.com',
      }),
    ).toEqual({ ok: false, error: 'link must start with https://.' });
  });

  it('rewords an idea and keeps its first wording', async () => {
    const tables = { concepts: [{ id: CONCEPT, user_id: ME, name: 'Attention', claim: 'Old words.', claim_original: null }] };
    const made = await runLearnWrite(write('reword_concept'), { userId: ME, learn: fakeLearn(tables) }, {
      concept_id: CONCEPT,
      claim: 'New words.',
    });
    if ('ok' in made) throw new Error(made.error);
    expect(made.after).toMatchObject({ claim: 'New words.', claim_original: 'Old words.' });
  });

  it('notes on exactly one of an idea or a card', async () => {
    const tables = { concepts: [{ id: CONCEPT, user_id: ME, name: 'Attention' }] };
    const env = { userId: ME, learn: fakeLearn(tables) };
    expect(await runLearnWrite(write('add_concept_note'), env, { body: 'x', concept_id: CONCEPT, card_id: CONCEPT })).toEqual({
      ok: false,
      error: 'Give one of concept_id or card_id.',
    });
    const made = await runLearnWrite(write('add_concept_note'), env, { body: 'Ask about the heads.', concept_id: CONCEPT });
    if ('ok' in made) throw new Error(made.error);
    expect(made.after).toMatchObject({ user_id: ME, concept_id: CONCEPT, card_id: null, body: 'Ask about the heads.' });
    expect(made.summary).toBe('Dash added a note to the idea "Attention": Ask about the heads.');
  });

  it('moves a video as the person’s own verdict', async () => {
    const tables = { watch_list: [{ id: 'w1', user_id: ME, video_id: 'dQw4w9WgXcQ', verdict: 'skip', verdict_by: 'judge' }] };
    const made = await runLearnWrite(write('change_video'), { userId: ME, learn: fakeLearn(tables) }, {
      video_id: 'dQw4w9WgXcQ',
      pile: 'watch',
    });
    if ('ok' in made) throw new Error(made.error);
    expect(made.subjectRef).toBe('learn.watch_list:w1');
    expect(made.after).toMatchObject({ verdict: 'watch', verdict_by: 'you' });
    expect(made.summary).toBe('Dash changed the video "video dQw4w9WgXcQ": moved to Watch.');
  });

  describe('research_topic', () => {
    const SUBS = [
      { id: 'q1', text: 'What does SOX require of controls over AI outputs?' },
      { id: 'q2', text: 'How do auditors test model changes?' },
      { id: 'q3', text: 'Which regulators have said anything?' },
    ];
    const starter = (subQuestions: typeof SUBS | null = SUBS) => ({
      frame: vi.fn(async () => subQuestions),
      start: vi.fn(),
    });

    it('makes the list and the brief, starts the run, and returns the sub-questions', async () => {
      const tables: Record<string, Row[]> = {};
      const research = starter();
      const made = await runLearnWrite(write('research_topic'), { userId: ME, learn: fakeLearn(tables), research }, {
        topic: 'How SOX controls apply to AI',
        reason: 'They are interviewing for an IT audit role.',
      });
      if ('ok' in made) throw new Error(made.error);
      expect(research.frame).toHaveBeenCalledWith('How SOX controls apply to AI', 'They are interviewing for an IT audit role.');
      expect(tables.tracks).toEqual([expect.objectContaining({ user_id: ME, title: 'How SOX controls apply to AI' })]);
      const trackId = tables.tracks[0].id;
      expect(made.after).toMatchObject({
        user_id: ME,
        track_id: trackId,
        depth: 'standard',
        status: 'researching',
        stage: 'searching',
        sub_questions: SUBS,
      });
      const id = made.after.id as string;
      expect(research.start).toHaveBeenCalledWith(id);
      expect(made).toMatchObject({
        kind: 'research_topic',
        op: 'insert',
        subjectRef: `learn.briefs:${id}`,
        undo: { archive_brief: true },
        summary: 'Dash started researching "How SOX controls apply to AI".',
      });
      expect(made.row).toMatchObject({ href: `/learn/b/${id}`, detail: { sub_questions: SUBS.map((q, i) => `${i + 1}. ${q.text}`).join('\n') } });
    });

    it('lets the run frame the question when the first call fails', async () => {
      const tables: Record<string, Row[]> = {};
      const made = await runLearnWrite(write('research_topic'), { userId: ME, learn: fakeLearn(tables), research: starter(null) }, {
        topic: 'Model risk management',
      });
      if ('ok' in made) throw new Error(made.error);
      expect(made.after).toMatchObject({ stage: 'framing', sub_questions: [], angle: '' });
    });

    it('links an open brief on the same topic and starts nothing', async () => {
      const tables: Record<string, Row[]> = {
        briefs: [
          { id: 'b-archived', user_id: ME, question: 'SOX controls and AI', status: 'ready', archived_at: '2026-10-01', created_at: '2026-10-01' },
          { id: 'b-open', user_id: ME, question: 'How do SOX controls apply to AI?', status: 'ready', archived_at: null, created_at: '2026-10-02' },
        ],
      };
      const research = starter();
      const result = await runLearnWrite(write('research_topic'), { userId: ME, learn: fakeLearn(tables), research }, {
        topic: 'I want to learn how SOX controls apply to AI',
      });
      expect(result).toMatchObject({ ok: false });
      expect('error' in result && result.error).toContain('/learn/b/b-open');
      expect(research.frame).not.toHaveBeenCalled();
      expect(tables.tracks ?? []).toEqual([]);
    });

    it('refuses where no run can be started, and a depth it does not know', async () => {
      const env = { userId: ME, learn: fakeLearn({}) };
      expect(await runLearnWrite(write('research_topic'), env, { topic: 'Evals' })).toEqual({
        ok: false,
        error: 'Research cannot be started from here. Tell them nothing was started.',
      });
      expect(await runLearnWrite(write('research_topic'), { ...env, research: starter() }, { topic: 'Evals', depth: 'huge' })).toEqual({
        ok: false,
        error: 'depth must be one of quick, standard, deep.',
      });
    });
  });

  describe('add_to_brief', () => {
    const brief = (extra: Row = {}): Row => ({
      id: BRIEF,
      user_id: ME,
      question: 'How do SOX controls apply to AI?',
      sub_questions: [
        { id: 'q1', text: 'What does SOX require of controls over AI outputs?' },
        { id: 'q2', text: 'How do auditors test model changes?' },
      ],
      archived_at: null,
      ...extra,
    });
    const source = { title: 'PCAOB AS 2201', url: 'https://pcaobus.org/as2201', quote: 'The auditor should test the design.' };

    it('adds the finding under the sub-question it names, with its sources', async () => {
      const tables: Record<string, Row[]> = { briefs: [brief()] };
      const made = await runLearnWrite(write('add_to_brief'), { userId: ME, learn: fakeLearn(tables) }, {
        brief_id: BRIEF,
        finding: 'Auditors test model changes as they test any change to a key control.',
        sub_question: 2,
        sources: [source],
      });
      if ('ok' in made) throw new Error(made.error);
      expect(tables.brief_findings).toEqual([
        expect.objectContaining({ user_id: ME, brief_id: BRIEF, sub_question_id: 'q2', sources: [source] }),
      ]);
      expect(made).toMatchObject({
        kind: 'add_to_brief',
        op: 'insert',
        subjectRef: `learn.brief_findings:${made.after.id}`,
        before: null,
        row: { href: `/learn/b/${BRIEF}` },
      });
      expect(made.summary).toBe(
        'Dash added a finding to the brief "How do SOX controls apply to AI?" under "How do auditors test model changes?", with one source: ' +
          'Auditors test model changes as they test any change to a key control.',
      );
    });

    it('keeps a finding that answers no sub-question, and one with no sources', async () => {
      const tables: Record<string, Row[]> = { briefs: [brief()] };
      const made = await runLearnWrite(write('add_to_brief'), { userId: ME, learn: fakeLearn(tables) }, {
        brief_id: BRIEF,
        finding: 'The SEC has said nothing on this yet.',
      });
      if ('ok' in made) throw new Error(made.error);
      expect(tables.brief_findings).toEqual([expect.objectContaining({ sub_question_id: null, sources: [] })]);
    });

    it('refuses a sub-question the brief does not have, a link that is not https, and an archived brief', async () => {
      const env = { userId: ME, learn: fakeLearn({ briefs: [brief()] }) };
      expect(await runLearnWrite(write('add_to_brief'), env, { brief_id: BRIEF, finding: 'x', sub_question: 3 })).toEqual({
        ok: false,
        error: 'sub_question must be a number from 1 to 2, as the brief numbers them, or left out.',
      });
      expect(
        await runLearnWrite(write('add_to_brief'), env, { brief_id: BRIEF, finding: 'x', sources: [{ title: 'A page', url: 'http://a.example' }] }),
      ).toEqual({ ok: false, error: 'link must start with https://.' });
      const archived = { userId: ME, learn: fakeLearn({ briefs: [brief({ archived_at: '2026-10-01' })] }) };
      expect(await runLearnWrite(write('add_to_brief'), archived, { brief_id: BRIEF, finding: 'x' })).toEqual({
        ok: false,
        error: 'That brief is archived. Nothing was added.',
      });
    });

    it('refuses a brief that is not theirs', async () => {
      const env = { userId: ME, learn: fakeLearn({ briefs: [brief({ user_id: 'someone else' })] }) };
      expect(await runLearnWrite(write('add_to_brief'), env, { brief_id: BRIEF, finding: 'x' })).toEqual({
        ok: false,
        error: 'There is no brief of theirs with that id. Look it up first.',
      });
    });
  });

  describe('attach_vault_note', () => {
    const essay: Row = { id: ESSAY, user_id: ME, path: 'Essays/Controls over AI.md', draft_body: '# Controls over AI\n', note_id: null };
    const note: Row = { id: NOTE, user_id: ME, path: 'Ideas/Walzer on spheres.md', title: 'Walzer on spheres', deleted_at: null };
    const env = (learn: Record<string, Row[]>, vault: Record<string, Row[]> = { notes: [{ ...note }] }) =>
      ({ userId: ME, learn: fakeLearn(learn), vault: fakeLearn(vault) as unknown as LearnWriteEnv['vault'] });

    it('attaches the note named by its path, with why', async () => {
      const tables: Record<string, Row[]> = { essays: [{ ...essay }] };
      const made = await runLearnWrite(write('attach_vault_note'), env(tables), {
        essay_id: ESSAY,
        note: 'Ideas/Walzer on spheres.md',
        why: 'The counter-argument.',
      });
      if ('ok' in made) throw new Error(made.error);
      expect(tables.essay_vault_notes).toEqual([
        expect.objectContaining({ user_id: ME, essay_id: ESSAY, note_id: NOTE, why: 'The counter-argument.' }),
      ]);
      expect(made).toMatchObject({ kind: 'attach_vault_note', op: 'insert', row: { href: `/learn/e/${ESSAY}` } });
      expect(made.summary).toBe('Dash attached the vault note "Walzer on spheres" to the notes of the essay "Controls over AI".');
    });

    it('refuses a note already attached, the essay\'s own note, and a note not in the vault', async () => {
      const attached = env({ essays: [{ ...essay }], essay_vault_notes: [{ id: 'a1', user_id: ME, essay_id: ESSAY, note_id: NOTE }] });
      expect(await runLearnWrite(write('attach_vault_note'), attached, { essay_id: ESSAY, note: NOTE })).toEqual({
        ok: false,
        error: 'That note is already attached to this essay. Nothing was changed.',
      });
      const own = env({ essays: [{ ...essay, note_id: NOTE }] });
      expect(await runLearnWrite(write('attach_vault_note'), own, { essay_id: ESSAY, note: NOTE })).toEqual({
        ok: false,
        error: 'That note is the essay itself. Nothing was attached.',
      });
      const missing = env({ essays: [{ ...essay }] }, { notes: [] });
      expect(await runLearnWrite(write('attach_vault_note'), missing, { essay_id: ESSAY, note: 'Ideas/Nothing.md' })).toEqual({
        ok: false,
        error: 'There is no vault note of theirs at that ref. Find it with vault_notes or search first.',
      });
    });

    it('is refused where the vault cannot be reached', async () => {
      expect(
        await runLearnWrite(write('attach_vault_note'), { userId: ME, learn: fakeLearn({ essays: [{ ...essay }] }) }, { essay_id: ESSAY, note: NOTE }),
      ).toEqual({ ok: false, error: 'Vault notes cannot be reached from here. Tell them nothing was attached.' });
    });
  });
});

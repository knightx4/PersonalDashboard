import { describe, expect, it, vi } from 'vitest';
import { ideaFromThemeNotes, noteExcerpt, SURVEY_NOTE_CHARS, writeSurveyIdea } from './idea';

/**
 * Writing the idea a survey question tests, against stub clients.
 *
 * What is checked is which rows get written and when the model is called: a
 * theme with notes gets one idea quoting a note, a theme without notes gets
 * nothing, and an idea that does not come from the notes is refused. The
 * subject lookup is covered in subject.test.ts.
 */

const USER = 'user-1';
const THEME = { id: 'theme-1', name: 'Stoicism', about: 'Notes on the Stoics and living by them.' };

const NOTE = {
  title: 'Epictetus, Enchiridion',
  body:
    '# Enchiridion\n\nThe first line sorts everything into two piles. ' +
    'Some things are up to us and some are not: our opinions and choices are, ' +
    'our body, reputation and office are not.\n\nI keep coming back to this.',
};

const IDEA = {
  name: 'Only judgements and choices are up to us',
  claim:
    'Epictetus puts opinions and choices under our control, and body, reputation and office outside it.',
  note_title: 'Epictetus, Enchiridion',
  quote: 'our opinions and choices are, our body, reputation and office are not',
  mastery: [
    'Says which pile a reputation belongs in and why.',
    'Explains what follows for how to treat an insult.',
  ],
  kind: 'threshold',
};

function clientReturning(input: unknown) {
  const create = vi.fn().mockResolvedValue({
    content: [{ type: 'tool_use', name: 'report_idea', input }],
    usage: { input_tokens: 10, output_tokens: 5 },
  });
  return { client: { messages: { create } } as never, create };
}

/** `obsidian.themes` and the notes linked to the theme. */
function fakeVault(notes: { title: string; body: string }[], theme = THEME) {
  const chain = (result: unknown) => {
    const self: Record<string, unknown> = {};
    for (const method of ['select', 'eq', 'is', 'order']) self[method] = () => self;
    self.maybeSingle = async () => result;
    self.limit = async () => result;
    return self;
  };
  return {
    from(table: string) {
      if (table === 'themes') return chain({ data: theme, error: null });
      if (table === 'notes') return chain({ data: notes, error: null });
      throw new Error(`unexpected table ${table}`);
    },
  } as never;
}

type Row = Record<string, unknown>;

/** `learn.subjects` and `learn.concepts`, enough for the survey subject and the insert. */
function fakeLearn() {
  const subjects: Row[] = [];
  const concepts: Row[] = [];

  function query(rows: Row[], filters: ((row: Row) => boolean)[] = []) {
    const found = () => rows.filter((row) => filters.every((keep) => keep(row)));
    const self = {
      eq: (column: string, value: unknown) =>
        query(rows, [...filters, (row) => row[column] === value]),
      ilike: (column: string, value: string) =>
        query(rows, [
          ...filters,
          (row) => String(row[column]).toLowerCase() === value.toLowerCase(),
        ]),
      order: () => self,
      maybeSingle: async () => ({ data: found()[0] ?? null, error: null }),
      then: (resolve: (value: { data: Row[]; error: null }) => void) =>
        resolve({ data: found(), error: null }),
    };
    return self;
  }

  const client = {
    from(table: string) {
      const rows = table === 'subjects' ? subjects : table === 'concepts' ? concepts : null;
      if (!rows) throw new Error(`unexpected table ${table}`);
      return {
        select: () => query(rows),
        insert: (row: Row) => ({
          select: () => ({
            single: async () => {
              const created = { id: `${table}-${rows.length + 1}`, ...row };
              rows.push(created);
              return { data: { id: created.id }, error: null };
            },
          }),
        }),
      };
    },
  };
  return { client: client as never, subjects, concepts };
}

describe('writeSurveyIdea', () => {
  it('writes one idea quoting the note into the hidden subject', async () => {
    const learn = fakeLearn();
    const { client, create } = clientReturning(IDEA);
    const spent: unknown[] = [];

    const result = await writeSurveyIdea({
      supabase: learn.client,
      vault: fakeVault([NOTE]),
      userId: USER,
      themeId: THEME.id,
      anthropicApiKey: 'key',
      client,
      onSpend: (report) => spent.push(report),
    });

    expect(result.ok).toBe(true);
    expect(learn.subjects).toEqual([
      expect.objectContaining({ name: 'Stoicism', survey: true, theme_id: THEME.id }),
    ]);
    expect(learn.concepts).toHaveLength(1);
    const concept = learn.concepts[0];
    expect(concept).toMatchObject({
      user_id: USER,
      subject_id: learn.subjects[0].id,
      name: IDEA.name,
      claim: IDEA.claim,
      origin: 'reading',
      kind: 'threshold',
    });
    expect(concept.basis).toContain('Epictetus, Enchiridion');
    expect(NOTE.body).toContain(IDEA.quote);
    expect(concept.basis).toContain(IDEA.quote);
    expect(concept.mastery).toHaveLength(2);
    expect(spent).toHaveLength(1);

    // The prompt carries the about line and the note, not only the name.
    const sent = create.mock.calls[0][0].messages[0].content as string;
    expect(sent).toContain(THEME.about);
    expect(sent).toContain('Some things are up to us');
  });

  it('skips a theme with no notes: no call, no subject, no idea', async () => {
    const learn = fakeLearn();
    const { client, create } = clientReturning(IDEA);

    const result = await writeSurveyIdea({
      supabase: learn.client,
      vault: fakeVault([]),
      userId: USER,
      themeId: THEME.id,
      anthropicApiKey: 'key',
      client,
    });

    expect(result).toMatchObject({ ok: false, reason: 'no-notes' });
    expect(create).not.toHaveBeenCalled();
    expect(learn.subjects).toEqual([]);
    expect(learn.concepts).toEqual([]);
  });

  it('skips a theme that already has a track', async () => {
    const learn = fakeLearn();
    learn.subjects.push({ id: 'track-1', name: 'stoicism', survey: false, theme_id: null });
    const { client, create } = clientReturning(IDEA);

    const result = await writeSurveyIdea({
      supabase: learn.client,
      vault: fakeVault([NOTE]),
      userId: USER,
      themeId: THEME.id,
      anthropicApiKey: 'key',
      client,
    });

    expect(result).toMatchObject({ ok: false, reason: 'tracked' });
    expect(create).not.toHaveBeenCalled();
    expect(learn.concepts).toEqual([]);
  });

  it('passes the ideas already written, and refuses a repeat', async () => {
    const learn = fakeLearn();
    learn.subjects.push({ id: 'survey-1', name: 'Stoicism', survey: true, theme_id: THEME.id });
    learn.concepts.push({ id: 'c-0', subject_id: 'survey-1', name: IDEA.name });
    const { client, create } = clientReturning(IDEA);

    const result = await writeSurveyIdea({
      supabase: learn.client,
      vault: fakeVault([NOTE]),
      userId: USER,
      themeId: THEME.id,
      anthropicApiKey: 'key',
      client,
    });

    expect(create.mock.calls[0][0].messages[0].content).toContain(`- ${IDEA.name}`);
    expect(result).toMatchObject({ ok: false, reason: 'ungrounded' });
    expect(learn.concepts).toHaveLength(1);
  });
});

describe('ideaFromThemeNotes', () => {
  const source = { theme: THEME, notes: [NOTE] };

  it('refuses a quote that is not in the note', async () => {
    const { client } = clientReturning({
      ...IDEA,
      quote: 'virtue is the only good and all else is indifferent',
    });
    const result = await ideaFromThemeNotes({ source, existing: [], anthropicApiKey: 'k', client });
    expect(result).toMatchObject({ ok: false, reason: 'ungrounded' });
  });

  it('refuses a note it was not given', async () => {
    const { client } = clientReturning({ ...IDEA, note_title: 'Meditations' });
    const result = await ideaFromThemeNotes({ source, existing: [], anthropicApiKey: 'k', client });
    expect(result).toMatchObject({ ok: false, reason: 'ungrounded' });
  });

  it("refuses the theme's name as the idea", async () => {
    const { client } = clientReturning({ ...IDEA, name: 'Stoicism' });
    const result = await ideaFromThemeNotes({ source, existing: [], anthropicApiKey: 'k', client });
    expect(result).toMatchObject({ ok: false, reason: 'ungrounded' });
  });

  it('accepts a quote with different spacing and curly quotes', async () => {
    const note = {
      title: 'Doubt',
      body: 'He said it’s   the\njudgement about a thing that hurts, not the thing.',
    };
    const { client } = clientReturning({
      ...IDEA,
      note_title: 'doubt',
      quote: '"it\'s the judgement about a thing that hurts"',
    });
    const result = await ideaFromThemeNotes({
      source: { theme: THEME, notes: [note] },
      existing: [],
      anthropicApiKey: 'k',
      client,
    });
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.idea.noteTitle).toBe('Doubt');
  });

  it('reports nothing when the notes hold no claim', async () => {
    const { client } = clientReturning({
      none: true,
      name: '',
      claim: '',
      note_title: '',
      quote: '',
    });
    const result = await ideaFromThemeNotes({ source, existing: [], anthropicApiKey: 'k', client });
    expect(result).toMatchObject({ ok: false, reason: 'nothing-in-it' });
  });

  it('refuses a quote from past the part of the note that was sent', async () => {
    const tail = 'this sentence sits far beyond the cut and was never sent';
    const long = { title: 'Long', body: 'x'.repeat(SURVEY_NOTE_CHARS) + ' ' + tail };
    expect(noteExcerpt(long.body)).not.toContain(tail);
    const { client } = clientReturning({ ...IDEA, note_title: 'Long', quote: tail });
    const result = await ideaFromThemeNotes({
      source: { theme: THEME, notes: [long] },
      existing: [],
      anthropicApiKey: 'k',
      client,
    });
    expect(result).toMatchObject({ ok: false, reason: 'ungrounded' });
  });
});

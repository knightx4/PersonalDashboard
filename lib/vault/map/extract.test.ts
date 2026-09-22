import { describe, expect, it, vi } from 'vitest';
import { proposeNoteMap, type MapNote } from './extract';
import { CREDENTIAL_PATTERN, isGenerated, quoteInNote, whyNotRead } from './rules';
import { mergeChunkReports, noteMapSchema, readChunkReport } from './proposal';

/**
 * One note into a proposed map, without a network.
 *
 * The model is a stub. What is checked is what this code decides around it:
 * which notes are never sent, what is sent when one is, which candidates a
 * quote check throws away, and that the proposal comes back as a value with
 * nothing written.
 */

const BODY = [
  'Surface parking is among the worst things to happen to cities.',
  '',
  'Cities should be built for people, not cars, even at some cost to efficiency.',
].join('\n');

const note = (overrides: Partial<MapNote> = {}): MapNote => ({
  id: 'note-1',
  path: 'Cities/Parking.md',
  title: 'Parking',
  body: BODY,
  blobSha: 'sha-1',
  ...overrides,
});

const classified = (noteClass = 'knowledge') => ({
  content: [
    {
      type: 'tool_use',
      name: 'classify_note',
      input: { class: noteClass, is_evidence: false, reason: 'Argues about parking.' },
    },
  ],
});

const report = (input: unknown) => ({
  content: [{ type: 'tool_use', name: 'report_note_map', input }],
});

const PARKING = {
  name: 'Surface parking harms cities',
  statement: 'Surface parking is among the worst things to happen to cities.',
  kind: 'claim',
  stance: 'held',
  quote: 'Surface parking is among the worst things to happen to cities.',
  basis: 'Stated in the note.',
  themes: ['Urbanism'],
};

const PEOPLE = {
  name: 'Build for people',
  statement: 'Cities should be built for people rather than cars.',
  kind: 'position',
  stance: 'held',
  quote: 'Cities should be built for people, not cars, even at some cost to efficiency.',
  basis: 'Stated in the note.',
  themes: ['Urbanism'],
};

function stub(...replies: unknown[]) {
  const create = vi.fn();
  for (const reply of replies) create.mockResolvedValueOnce(reply);
  return { client: { messages: { create } } as never, create };
}

describe('what is never sent', () => {
  it('refuses a journal without a call', async () => {
    const { client, create } = stub();
    const result = await proposeNoteMap({
      note: note({ path: 'Me/2019-04-02.md' }),
      anthropicApiKey: 't',
      client,
    });
    expect(result).toMatchObject({ ok: false, reason: 'not-read', notRead: { reason: 'journal' } });
    expect(create).not.toHaveBeenCalled();
  });

  it('refuses a note holding an API key without a call', async () => {
    const { client, create } = stub();
    const result = await proposeNoteMap({
      note: note({ body: `${BODY}\nkey: sk-ant-api03-abc` }),
      anthropicApiKey: 't',
      client,
    });
    expect(result).toMatchObject({
      ok: false,
      reason: 'not-read',
      notRead: { reason: 'credential' },
    });
    expect(create).not.toHaveBeenCalled();
  });

  it('never sends the path', async () => {
    const { client, create } = stub(classified(), report({ themes: [], positions: [], edges: [] }));
    await proposeNoteMap({
      note: note({ path: 'Private Folder/Parking.md' }),
      anthropicApiKey: 't',
      client,
    });
    for (const [request] of create.mock.calls) {
      expect(JSON.stringify(request)).not.toContain('Private Folder');
    }
  });

  it('answers a note under 80 characters as operational without a call', async () => {
    const { client, create } = stub();
    const result = await proposeNoteMap({
      note: note({ body: 'Buy milk.' }),
      anthropicApiKey: 't',
      client,
    });
    expect(result).toMatchObject({ ok: false, reason: 'operational' });
    expect(create).not.toHaveBeenCalled();
  });
});

describe('a note that is read', () => {
  it('proposes themes, positions, an edge and a verified quote each', async () => {
    const { client } = stub(
      classified(),
      report({
        themes: [{ name: 'Urbanism', about: 'How cities are laid out.' }],
        positions: [PARKING, PEOPLE],
        edges: [
          {
            from: PARKING.name,
            to: PEOPLE.name,
            type: 'example_of',
            description: 'Parking is a case of it.',
          },
        ],
      }),
    );
    const result = await proposeNoteMap({ note: note(), anthropicApiKey: 't', client });
    if (!result.ok) throw new Error(result.detail);

    const { proposal } = result;
    expect(proposal).toMatchObject({
      noteId: 'note-1',
      blobSha: 'sha-1',
      verdict: { noteClass: 'knowledge' },
    });
    expect(proposal.themes).toEqual([
      { key: 't0', name: 'Urbanism', about: 'How cities are laid out.', basis: expect.any(String) },
    ]);
    expect(proposal.positions.map((p) => [p.key, p.kind, p.themes])).toEqual([
      ['p0', 'claim', ['t0']],
      ['p1', 'position', ['t0']],
    ]);
    for (const position of proposal.positions) expect(BODY).toContain(position.quote);
    expect(proposal.edges).toEqual([
      { from: 'p0', to: 'p1', type: 'example_of', description: 'Parking is a case of it.' },
    ]);
    expect(noteMapSchema.safeParse(proposal).success).toBe(true);
  });

  it('drops a position whose quote was tidied, and the edge that needed it', async () => {
    const tidied = {
      ...PARKING,
      quote: 'Surface parking is among the worst things to happen to cities!',
    };
    const { client } = stub(
      classified(),
      report({
        themes: [{ name: 'Urbanism', about: 'How cities are laid out.' }],
        positions: [tidied, PEOPLE],
        edges: [{ from: PARKING.name, to: PEOPLE.name, type: 'example_of', description: 'x' }],
      }),
    );
    const result = await proposeNoteMap({ note: note(), anthropicApiKey: 't', client });
    if (!result.ok) throw new Error(result.detail);
    expect(result.proposal.positions.map((p) => p.name)).toEqual([PEOPLE.name]);
    expect(result.proposal.dropped).toEqual([{ name: PARKING.name, why: 'quote-missing' }]);
    expect(result.proposal.edges).toEqual([]);
  });

  it('does not read a note the classifier calls operational', async () => {
    const { client, create } = stub(classified('operational'));
    const result = await proposeNoteMap({ note: note(), anthropicApiKey: 't', client });
    expect(result).toMatchObject({ ok: false, reason: 'operational' });
    expect(create).toHaveBeenCalledTimes(1);
  });

  it('marks every position generated when a model wrote the note', async () => {
    const body = `> [!note] Created by Claude\n> Expanded from a seed idea.\n\n${BODY}`;
    const { client } = stub(
      classified(),
      report({ themes: [{ name: 'Urbanism', about: 'Cities.' }], positions: [PARKING], edges: [] }),
    );
    const result = await proposeNoteMap({ note: note({ body }), anthropicApiKey: 't', client });
    if (!result.ok) throw new Error(result.detail);
    expect(result.proposal.positions[0].stance).toBe('generated');
  });
});

describe('putting chunks together', () => {
  it('merges a theme named in two chunks and keeps each edge inside its chunk', () => {
    const merged = mergeChunkReports({
      body: BODY,
      generated: false,
      reports: [
        {
          chunk: { title: 'One' },
          report: readChunkReport({
            themes: [{ name: 'Urbanism', about: 'a' }],
            positions: [PARKING],
            edges: [],
          }),
        },
        {
          chunk: { title: 'Two' },
          report: readChunkReport({
            themes: [{ name: 'urbanism', about: 'b' }],
            positions: [PEOPLE, { ...PARKING, name: 'Again' }],
            // PARKING's name is not in this chunk, so this edge cannot be resolved.
            edges: [{ from: PARKING.name, to: PEOPLE.name, type: 'supports', description: '' }],
          }),
        },
      ],
    });
    expect(merged.themes.map((t) => t.name)).toEqual(['Urbanism']);
    expect(merged.positions.map((p) => p.name)).toEqual([PARKING.name, PEOPLE.name]);
    expect(merged.dropped).toEqual([{ name: 'Again', why: 'repeated' }]);
    expect(merged.edges).toEqual([]);
  });

  it('puts a position naming no known theme under its chunk’s first theme', () => {
    const merged = mergeChunkReports({
      body: BODY,
      generated: false,
      reports: [
        {
          chunk: { title: 'One' },
          report: readChunkReport({
            themes: [{ name: 'Urbanism', about: 'a' }],
            positions: [{ ...PARKING, themes: ['Parking policy'] }],
            edges: [],
          }),
        },
      ],
    });
    expect(merged.positions[0].themes).toEqual(['t0']);
  });

  it('keeps the good items of a report with one malformed position', () => {
    const read = readChunkReport({
      themes: [],
      positions: [PARKING, { name: 'no statement' }],
      edges: 'x',
    });
    expect(read.positions).toHaveLength(1);
    expect(read.edges).toEqual([]);
  });
});

describe('the rules', () => {
  it('checks a quote character for character', () => {
    expect(
      quoteInNote('  Surface parking is among the worst things to happen to cities. ', BODY),
    ).toBe('Surface parking is among the worst things to happen to cities.');
    expect(
      quoteInNote('surface parking is among the worst things to happen to cities.', BODY),
    ).toBeNull();
    expect(quoteInNote('   ', BODY)).toBeNull();
  });

  it('matches the four credential shapes', () => {
    for (const key of ['sk-ant-x', 'sk-proj-x', 'ghp_x', 'AKIAABCDEFGHIJKLMNOP']) {
      expect(CREDENTIAL_PATTERN.test(key)).toBe(true);
    }
    expect(CREDENTIAL_PATTERN.test('AKIA is a word here')).toBe(false);
  });

  it('treats only the Me folder as journals', () => {
    expect(whyNotRead({ path: 'Me/People/Chewy.md', body: '' })?.reason).toBe('journal');
    expect(whyNotRead({ path: 'Media/Film.md', body: '' })).toBeNull();
    expect(whyNotRead({ path: 'Me.md', body: '' })).toBeNull();
  });

  it('reads the Created by Claude callout', () => {
    expect(isGenerated('> [!note] Created by Claude\n> text')).toBe(true);
    expect(isGenerated('I asked Claude about this, and created by hand the rest.')).toBe(false);
  });
});

describe('an accepted map', () => {
  it('refuses a position under a theme the map does not have', () => {
    const parsed = noteMapSchema.safeParse({
      themes: [],
      positions: [{ ...PARKING, key: 'p0', themes: ['t9'] }],
      edges: [],
    });
    expect(parsed.success).toBe(false);
  });
});

/**
 * Accepting one note's map, against Postgres.
 *
 * obsidian.accept_note_map is the only way a proposal reaches the map, so what
 * it refuses is checked here rather than in the TypeScript that calls it: a
 * note that changed since it was read, a quote the note does not contain, and
 * a note that belongs to somebody else. What it writes is checked too, down to
 * the second accept of the same note adding nothing.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { admin, asUser, closeDb, createUser, truncateAll } from './helpers/db-vault';

const BODY = [
  '# Parking',
  '',
  'Surface parking is among the worst things to happen to cities.',
  'Cities should be built for people, not cars, even at some cost to efficiency.',
].join('\n');

let userA = '';
let userB = '';
let noteA = '';

function mapFor(overrides: { quote?: string } = {}) {
  return {
    themes: [
      {
        key: 't0',
        name: 'Urbanism',
        about: 'How cities are laid out.',
        basis: 'The note argues about parking.',
      },
    ],
    positions: [
      {
        key: 'p0',
        name: 'Surface parking harms cities',
        statement: 'Surface parking is among the worst things to happen to cities.',
        kind: 'claim',
        stance: 'held',
        basis: 'Stated in the note in the writer’s own words.',
        quote: overrides.quote ?? 'Surface parking is among the worst things to happen to cities.',
        themes: ['t0'],
      },
      {
        key: 'p1',
        name: 'Build cities for people',
        statement:
          'Cities should be built for people rather than cars, even at a cost to efficiency.',
        kind: 'position',
        stance: 'held',
        basis: 'Stated in the note in the writer’s own words.',
        quote: 'Cities should be built for people, not cars, even at some cost to efficiency.',
        themes: ['t0'],
      },
    ],
    edges: [
      {
        from: 'p0',
        to: 'p1',
        type: 'example_of',
        description: 'Parking is one case of building for cars.',
      },
    ],
  };
}

async function accept(userId: string, map: unknown, blobSha = 'sha-parking') {
  return asUser(
    userId,
    (tx) =>
      tx`select obsidian.accept_note_map(${noteA}, ${blobSha}, ${tx.json(map as never)}) as result`,
  );
}

async function counts() {
  const [row] = await admin<Record<string, number>[]>`
    select
      (select count(*)::int from themes) as themes,
      (select count(*)::int from theme_notes) as theme_notes,
      (select count(*)::int from positions) as positions,
      (select count(*)::int from theme_positions) as theme_positions,
      (select count(*)::int from position_sources) as sources,
      (select count(*)::int from position_edges) as edges`;
  return row;
}

beforeAll(async () => {
  await truncateAll();
  userA = await createUser('map-a@example.com');
  userB = await createUser('map-b@example.com');
  const [connection] = await admin<{ id: string }[]>`
    insert into vault_connections (user_id, repo_owner, repo_name, branch, access_token)
    values (${userA}, 'alice', 'alice-vault', 'main', 'encrypted')
    returning id`;
  const [note] = await admin<{ id: string }[]>`
    insert into notes (user_id, connection_id, path, title, body, blob_sha, size_bytes, git_updated_at)
    values (${userA}, ${connection.id}, 'Cities/Parking.md', 'Parking', ${BODY}, 'sha-parking',
            ${BODY.length}, now())
    returning id`;
  noteA = note.id;
});

afterAll(async () => {
  await truncateAll();
  await closeDb();
});

describe('accept_note_map', () => {
  it('refuses a note that changed since it was read, and writes nothing', async () => {
    await expect(accept(userA, mapFor(), 'sha-older')).rejects.toThrow(/changed since it was read/);
    expect((await counts()).positions).toBe(0);
  });

  it('refuses a quote the note does not contain, and writes nothing', async () => {
    // One character tidied: the note says "worst things", the quote does not.
    const tidied = 'Surface parking is among the worst thing to happen to cities.';
    await expect(accept(userA, mapFor({ quote: tidied }))).rejects.toThrow(
      /quote is not in the note/,
    );
    expect(await counts()).toMatchObject({ themes: 0, positions: 0, sources: 0 });
  });

  it('does not let another user accept a map onto your note', async () => {
    await expect(accept(userB, mapFor())).rejects.toThrow(/not in the vault/);
  });

  it('writes the themes, positions, quotes and edges of an accepted map', async () => {
    const [{ result }] = await accept(userA, mapFor());
    expect(result).toEqual({ themes: 1, positions: 2, newPositions: 2, edges: 1 });
    expect(await counts()).toEqual({
      themes: 1,
      theme_notes: 1,
      positions: 2,
      theme_positions: 2,
      sources: 2,
      edges: 1,
    });

    const sources = await admin<{ quote: string; blob_sha: string; user_id: string }[]>`
      select quote, blob_sha, user_id from position_sources`;
    for (const source of sources) {
      expect(BODY).toContain(source.quote);
      expect(source.blob_sha).toBe('sha-parking');
      expect(source.user_id).toBe(userA);
    }
  });

  it('ranks the theme by what was written about it', async () => {
    const [theme] = await admin<{ strength: string; first_seen: Date | null }[]>`
      select strength, first_seen from themes where name = 'Urbanism'`;
    // One dated, short note whose positions are all held: 1 + ln(1 + 0.14), near 1.13.
    expect(Number(theme.strength)).toBeGreaterThan(1);
    expect(Number(theme.strength)).toBeLessThan(1.2);
    expect(theme.first_seen).not.toBeNull();
  });

  it('adds nothing when the same note is accepted twice', async () => {
    const [{ result }] = await accept(userA, mapFor());
    expect(result).toMatchObject({ positions: 2, newPositions: 0, edges: 0 });
    expect(await counts()).toEqual({
      themes: 1,
      theme_notes: 1,
      positions: 2,
      theme_positions: 2,
      sources: 2,
      edges: 1,
    });
  });

  it('weights a note a model wrote below one in the writer’s own words', async () => {
    const [before] = await admin<{ strength: string }[]>`select strength from themes`;
    await admin`update positions set stance = 'generated'`;
    const [theme] = await admin<{ id: string }[]>`select id from themes`;
    await admin`select obsidian.refresh_theme_strength(${[theme.id]}::uuid[])`;
    const [after] = await admin<{ strength: string }[]>`select strength from themes`;
    expect(Number(after.strength)).toBeCloseTo(Number(before.strength) * 0.25, 3);
  });
});

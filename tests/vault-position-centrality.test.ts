/**
 * Scoring each position's centrality against Postgres (plan #817).
 *
 * obsidian.score_position_centrality (supabase/migrations-vault/0019) runs
 * PageRank over position_edges and writes it to positions.centrality. The
 * check is the step's done-when: every position with an edge scores above
 * zero, and the one the others lean on scores highest.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { admin, closeDb, createUser, truncateAll } from './helpers/db-vault';

let userA = '';
let userB = '';

async function position(userId: string, name: string, centrality = 0): Promise<string> {
  const [row] = await admin<{ id: string }[]>`
    insert into positions (user_id, name, statement, basis, kind, stance, centrality)
    values (${userId}, ${name}, ${`${name}, stated.`}, 'Stated in the note.', 'claim', 'held', ${centrality})
    returning id`;
  return row.id;
}

async function edge(userId: string, from: string, to: string, type: string) {
  await admin`insert into position_edges (user_id, from_id, to_id, type)
              values (${userId}, ${from}, ${to}, ${type}::obsidian.edge_type)`;
}

async function scores(userId: string): Promise<Record<string, number>> {
  const rows = await admin<{ name: string; centrality: string }[]>`
    select name, centrality from positions where user_id = ${userId}`;
  return Object.fromEntries(rows.map((r) => [r.name, Number(r.centrality)]));
}

async function score(userId: string | null) {
  const [row] = await admin<{ r: { written: number; remaining: number; scored: number } }[]>`
    select score_position_centrality(${userId}::uuid, 4000) as r`;
  return row.r;
}

beforeAll(async () => {
  userA = await createUser('centrality-a@example.com');
  userB = await createUser('centrality-b@example.com');
});

afterAll(async () => {
  await truncateAll();
  await closeDb();
});

describe('score_position_centrality (plan #817)', () => {
  it('scores every position with an edge above zero, the load-bearing one highest, and the rest zero', async () => {
    const hub = await position(userA, 'Hub');
    const leaves = [await position(userA, 'Leaf 1'), await position(userA, 'Leaf 2'), await position(userA, 'Leaf 3')];
    const above = await position(userA, 'Above');
    const left = await position(userA, 'Left');
    const right = await position(userA, 'Right');
    // Stale from before a merge took its edges away.
    await position(userA, 'Alone', 2.5);
    for (const leaf of leaves) await edge(userA, leaf, hub, 'supports');
    await edge(userA, hub, above, 'example_of');
    await edge(userA, left, right, 'contradicts');
    const other = await position(userB, 'Someone else', 0);
    await edge(userB, other, await position(userB, 'Their hub'), 'supports');

    const result = await score(userA);
    expect(result.remaining).toBe(0);
    expect(result.scored).toBe(7);

    const s = await scores(userA);
    for (const name of ['Hub', 'Leaf 1', 'Leaf 2', 'Leaf 3', 'Above', 'Left', 'Right']) {
      expect(s[name]).toBeGreaterThan(0);
    }
    expect(s.Alone).toBe(0);
    // Rank flows from the supporting side to the supported one.
    expect(s.Hub).toBeGreaterThan(s['Leaf 1']);
    expect(s.Above).toBeGreaterThan(s.Hub);
    // A contradiction counts both ways, so its two sides score the same.
    expect(s.Left).toBe(s.Right);
    // The average over the graph is 1.
    const graph = Object.entries(s).filter(([n]) => n !== 'Alone').map(([, v]) => v);
    expect(graph.reduce((a, b) => a + b, 0) / graph.length).toBeCloseTo(1, 1);

    // Only the named owner.
    expect(Object.values(await scores(userB))).toEqual([0, 0]);
  });

  it('writes nothing when nothing changed, and every owner when none is named', async () => {
    expect((await score(userA)).written).toBe(0);
    const all = await score(null);
    expect(all.written).toBe(2);
    expect(Object.values(await scores(userB)).every((v) => v > 0)).toBe(true);
  });
});

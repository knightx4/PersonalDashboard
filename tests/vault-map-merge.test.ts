/**
 * Merging two themes or two positions, and undoing it, against Postgres.
 *
 * obsidian.merge_themes, obsidian.merge_positions and obsidian.undo_map_merge
 * (supabase/migrations-vault/0009) are what #820 applies proposals through and
 * #821 undoes them with. The check is the step's done-when: after a merge
 * nothing names the absorbed row, and after undo every row it touched is as it
 * was before, compared column by column except the updated_at stamps.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { admin, asUser, closeDb, createUser, truncateAll } from './helpers/db-vault';

let userA = '';
let userB = '';
let connection = '';
let item = '';
let seq = 0;

async function note(path: string): Promise<string> {
  const [row] = await admin<{ id: string }[]>`
    insert into notes (user_id, connection_id, path, title, body, blob_sha, size_bytes, git_updated_at)
    values (${userA}, ${connection}, ${path}, ${path}, ${`Body of ${path}.`}, ${`sha-${path}`},
            2000, now() - interval '100 days')
    returning id`;
  return row.id;
}

async function theme(name: string): Promise<string> {
  const [row] = await admin<{ id: string }[]>`
    insert into themes (user_id, name, about) values (${userA}, ${name}, ${`About ${name}.`})
    returning id`;
  return row.id;
}

async function position(name: string, stance = 'held'): Promise<string> {
  const [row] = await admin<{ id: string }[]>`
    insert into positions (user_id, name, statement, basis, kind, stance)
    values (${userA}, ${name}, ${`${name}, stated.`}, 'Stated in the note.', 'claim', ${stance})
    returning id`;
  return row.id;
}

async function filed(themeId: string, noteIds: string[], positionIds: string[]) {
  for (const n of noteIds) {
    await admin`insert into theme_notes (user_id, theme_id, note_id, basis)
                values (${userA}, ${themeId}, ${n}, 'about it')`;
  }
  for (const p of positionIds) {
    await admin`insert into theme_positions (user_id, theme_id, position_id, basis)
                values (${userA}, ${themeId}, ${p}, 'under it')`;
  }
}

async function quote(positionId: string, noteId: string, text: string) {
  await admin`insert into position_sources (user_id, position_id, note_id, quote, blob_sha)
              values (${userA}, ${positionId}, ${noteId}, ${text}, 'sha')`;
}

async function placement(themeId: string, byHand: boolean) {
  await admin`insert into learn.theme_fields (user_id, theme_id, confidence, basis, moved_by_hand)
              values (${userA}, ${themeId}, 'none', ${byHand ? 'moved by hand' : 'placed'}, ${byHand})`;
}

async function feedCard(themeId: string, name: string) {
  // One card per segment, so each card gets a segment of its own.
  seq += 1;
  const [seg] = await admin<{ id: string }[]>`
    insert into learn.catalogue_segments (item_id, ordinal, section_anchor, heading, text)
    values (${item}, ${seq}, ${`s${seq}`}, 'Section', 'Text.')
    returning id`;
  await admin`insert into learn.feed_cards (user_id, reason, theme_id, theme_name, item_id, segment_id)
              values (${userA}, 'interest', ${themeId}, ${name}, ${item}, ${seg.id})`;
}

async function trackOffer(themeId: string, name: string) {
  await admin`insert into learn.track_offers (user_id, theme_id, theme_name, outcome)
              values (${userA}, ${themeId}, ${name}, 'not_now')`;
}

/**
 * Every row a merge can touch, keyed and sorted, without the updated_at stamps.
 * Strength is brought up to date first, as the sweep would have left it, since
 * merge and undo both recompute it.
 */
async function snapshot() {
  await admin`select refresh_theme_strength(array(select id from themes where user_id = ${userA}))`;
  const [row] = await admin<{ s: Record<string, unknown[]> }[]>`
    select jsonb_build_object(
      'themes', (select jsonb_agg(to_jsonb(t) - 'updated_at' order by t.id) from themes t where t.user_id = ${userA}),
      'positions', (select jsonb_agg(to_jsonb(p) - 'updated_at' order by p.id) from positions p where p.user_id = ${userA}),
      'theme_notes', (select jsonb_agg(to_jsonb(x) order by x.id) from theme_notes x where x.user_id = ${userA}),
      'theme_positions', (select jsonb_agg(to_jsonb(x) order by x.id) from theme_positions x where x.user_id = ${userA}),
      'position_sources', (select jsonb_agg(to_jsonb(x) order by x.id) from position_sources x where x.user_id = ${userA}),
      'position_edges', (select jsonb_agg(to_jsonb(x) order by x.id) from position_edges x where x.user_id = ${userA}),
      'tensions', (select jsonb_agg(to_jsonb(x) - 'updated_at' order by x.id) from tensions x where x.user_id = ${userA}),
      'theme_fields', (select jsonb_agg(to_jsonb(x) - 'updated_at' order by x.id) from learn.theme_fields x where x.user_id = ${userA}),
      'feed_cards', (select jsonb_agg(to_jsonb(x) - 'updated_at' order by x.id) from learn.feed_cards x where x.user_id = ${userA}),
      'track_offers', (select jsonb_agg(to_jsonb(x) order by x.id) from learn.track_offers x where x.user_id = ${userA})
    ) as s`;
  return row.s;
}

/** How many rows anywhere still name `id`. */
async function referencesTo(id: string): Promise<number> {
  const [row] = await admin<{ n: number }[]>`
    select (
      (select count(*) from theme_notes where theme_id = ${id})
      + (select count(*) from theme_positions where theme_id = ${id} or position_id = ${id})
      + (select count(*) from position_sources where position_id = ${id})
      + (select count(*) from position_edges where from_id = ${id} or to_id = ${id})
      + (select count(*) from tensions where left_id = ${id} or right_id = ${id} or resolution_id = ${id})
      + (select count(*) from learn.theme_fields where theme_id = ${id})
      + (select count(*) from learn.feed_cards where theme_id = ${id})
      + (select count(*) from learn.track_offers where theme_id = ${id})
      + (select count(*) from themes where id = ${id})
      + (select count(*) from positions where id = ${id})
    )::int as n`;
  return row.n;
}

type Summary = {
  mergeId: string;
  moved: Record<string, number>;
  removed: Record<string, number>;
  undoneAt: string | null;
};

async function mergeThemes(
  userId: string,
  survivor: string,
  absorbed: string,
  name: string | null,
) {
  const [row] = await asUser(
    userId,
    (tx) => tx<{ r: Summary }[]>`select merge_themes(${survivor}, ${absorbed}, ${name}) as r`,
  );
  return row.r;
}

async function mergePositions(
  userId: string,
  survivor: string,
  absorbed: string,
  name: string | null,
) {
  const [row] = await asUser(
    userId,
    (tx) => tx<{ r: Summary }[]>`select merge_positions(${survivor}, ${absorbed}, ${name}) as r`,
  );
  return row.r;
}

async function undo(userId: string, mergeId: string) {
  const [row] = await asUser(
    userId,
    (tx) => tx<{ r: Summary }[]>`select undo_map_merge(${mergeId}) as r`,
  );
  return row.r;
}

beforeAll(async () => {
  await truncateAll();
  userA = await createUser('merge-a@example.com');
  userB = await createUser('merge-b@example.com');
  const [conn] = await admin<{ id: string }[]>`
    insert into vault_connections (user_id, repo_owner, repo_name, branch, access_token)
    values (${userA}, 'alice', 'alice-vault', 'main', 'encrypted')
    returning id`;
  connection = conn.id;
  const [provider] = await admin<{ id: string }[]>`
    insert into learn.catalogue_providers (slug, name, home_url, licence, ingest_note)
    values ('wikipedia', 'Wikipedia', 'https://en.wikipedia.org', 'CC BY-SA', 'REST API')
    on conflict (slug) do update set name = excluded.name
    returning id`;
  // The catalogue is shared and outlives truncateAll, so the item is new each run.
  const [catalogueItem] = await admin<{ id: string }[]>`
    insert into learn.catalogue_items (provider_id, external_id, title, kind, canonical_url)
    values (${provider.id}, ${`Merge_test_${Date.now()}`}, 'Merge test', 'article',
            'https://en.wikipedia.org/wiki/Merge')
    returning id`;
  item = catalogueItem.id;
});

afterAll(async () => {
  await truncateAll();
  await closeDb();
});

describe('merge_themes and undo', () => {
  it('moves every note, position, placement, feed card and track offer, and undo restores both', async () => {
    const n1 = await note('Cities/Parking.md');
    const n2 = await note('Cities/Stairs.md');
    const n3 = await note('Cities/Walk.md');
    const p1 = await position('Parking harms cities');
    const p2 = await position('Single stairs should be legal');
    const survivor = await theme('Urbanism');
    const absorbed = await theme('City planning');
    await filed(survivor, [n1], [p1]);
    await filed(absorbed, [n1, n2, n3], [p1, p2]);
    await quote(p1, n1, 'Parking is bad.');
    await quote(p2, n2, 'Stairs.');
    await placement(survivor, false);
    await placement(absorbed, true);
    await feedCard(absorbed, 'City planning');
    await trackOffer(absorbed, 'City planning');
    // Both embedded, so undo has to give the renamed survivor its vector back.
    await admin`update themes
                set embedding = array_fill(0.1::real, array[1024])::extensions.vector,
                    embedding_model = 'voyage-4-lite', embedded_at = now()
                where id in (${survivor}, ${absorbed})`;

    const before = await snapshot();
    const merged = await mergeThemes(userA, survivor, absorbed, 'Urban design');

    expect(merged.moved).toEqual({
      theme_notes: 2,
      theme_positions: 1,
      theme_fields: 1,
      feed_cards: 1,
      track_offers: 1,
    });
    // The survivor already had n1 and p1, and an automatic placement that the
    // absorbed theme's hand-moved one replaces.
    expect(merged.removed).toEqual({ theme_notes: 1, theme_positions: 1, theme_fields: 1 });
    expect(await referencesTo(absorbed)).toBe(0);

    const [after] = await admin<
      {
        name: string;
        notes: number;
        positions: number;
        by_hand: boolean;
        cards: number;
        offers: number;
        strength: string;
      }[]
    >`
      select t.name,
             (select count(*)::int from theme_notes where theme_id = t.id) as notes,
             (select count(*)::int from theme_positions where theme_id = t.id) as positions,
             (select moved_by_hand from learn.theme_fields where theme_id = t.id) as by_hand,
             (select count(*)::int from learn.feed_cards where theme_id = t.id) as cards,
             (select count(*)::int from learn.track_offers where theme_id = t.id) as offers,
             t.strength::text as strength
      from themes t where t.id = ${survivor}`;
    expect(after).toMatchObject({
      name: 'Urban design',
      notes: 3,
      positions: 2,
      by_hand: true,
      cards: 1,
      offers: 1,
    });
    expect(Number(after.strength)).toBeGreaterThan(0);
    const [cleared] = await admin<{ embedded: boolean }[]>`
      select embedding is not null as embedded from themes where id = ${survivor}`;
    expect(cleared.embedded).toBe(false);

    const undone = await undo(userA, merged.mergeId);
    expect(undone.undoneAt).not.toBeNull();
    expect(await snapshot()).toEqual(before);

    await expect(undo(userA, merged.mergeId)).rejects.toThrow(/already been undone/);
  });

  it('refuses a name another theme already has', async () => {
    const s = await theme('Economics');
    const a = await theme('Econ');
    await theme('Money');
    await expect(mergeThemes(userA, s, a, 'money')).rejects.toThrow(/already called/);
    expect(await referencesTo(a)).toBe(1);
  });

  it('refuses to undo a merge whose survivor has been merged away since', async () => {
    const x = await theme('Learning');
    const y = await theme('How people learn');
    const z = await theme('Education');
    const first = await mergeThemes(userA, x, y, null);
    const second = await mergeThemes(userA, z, x, null);
    await expect(undo(userA, first.mergeId)).rejects.toThrow(/Undo that first/);
    await undo(userA, second.mergeId);
    await undo(userA, first.mergeId);
    expect(await referencesTo(y)).toBe(1);
  });
});

describe('merge_positions and undo', () => {
  it('moves every quote, theme and edge, drops loops and duplicates, and undo restores both', async () => {
    const n1 = await note('Transport/One.md');
    const n2 = await note('Transport/Two.md');
    const survivor = await position('Transport is a means');
    const absorbed = await position('Transportation as means not end', 'encountered');
    const x = await position('Cars shape cities');
    const y = await position('Walking is transport');
    const t1 = await theme('Transport');
    const t2 = await theme('Mobility');
    await filed(t1, [n1, n2], [survivor, absorbed]);
    await filed(t2, [n2], [absorbed]);
    await quote(survivor, n1, 'Transport is a means.');
    await quote(absorbed, n2, 'Transportation is a means, not an end.');
    await quote(absorbed, n1, 'Transport is a means.');
    await admin`insert into position_edges (user_id, from_id, to_id, type) values
      (${userA}, ${absorbed}, ${x}, 'supports'),
      (${userA}, ${survivor}, ${x}, 'supports'),
      (${userA}, ${absorbed}, ${survivor}, 'same_as'),
      (${userA}, ${y}, ${absorbed}, 'example_of')`;
    await admin`insert into tensions (user_id, left_id, right_id, kind, crux) values
      (${userA}, ${absorbed}, ${survivor}, 'scope', 'the same thing'),
      (${userA}, ${absorbed}, ${y}, 'level', 'walking counts')`;
    await admin`insert into tensions (user_id, left_id, right_id, kind, crux, status, resolution_id, resolved_at)
      values (${userA}, ${x}, ${y}, 'scope', 'cars or feet', 'resolved', ${absorbed}, now())`;

    const before = await snapshot();
    const merged = await mergePositions(userA, survivor, absorbed, 'Transport is a means');

    expect(merged.moved).toEqual({
      position_sources: 1,
      theme_positions: 1,
      position_edges: 1,
      tensions: 2,
    });
    expect(merged.removed).toEqual({
      position_sources: 1,
      theme_positions: 1,
      position_edges: 2,
      tensions: 1,
    });
    expect(await referencesTo(absorbed)).toBe(0);

    const undone = await undo(userA, merged.mergeId);
    expect(undone.undoneAt).not.toBeNull();
    expect(await snapshot()).toEqual(before);
  });
});

describe('merging across users', () => {
  it('does not let another user merge your rows or undo your merge, or see the log', async () => {
    const s = await theme('Housing');
    const a = await theme('Homes');
    await expect(mergeThemes(userB, s, a, null)).rejects.toThrow(/not in the map/);

    const merged = await mergeThemes(userA, s, a, null);
    await expect(undo(userB, merged.mergeId)).rejects.toThrow(/not in the log/);

    const seen = await asUser(userB, (tx) => tx`select id from map_merges`);
    const own = await asUser(
      userA,
      (tx) => tx`select id from map_merges where id = ${merged.mergeId}`,
    );
    expect([seen.length, own.length]).toEqual([0, 1]);

    await expect(
      asUser(
        userA,
        (tx) => tx`update map_merges set undone_at = now() where id = ${merged.mergeId}`,
      ),
    ).rejects.toThrow(/permission denied/);
  });

  it('refuses a proposal that names a different pair', async () => {
    const s = await theme('Rent');
    const a = await theme('Rents');
    const other = await theme('Prices');
    const [lo, hi] = [s, other].sort();
    const [proposal] = await admin<{ id: string }[]>`
      insert into map_merge_proposals (user_id, kind, a_id, b_id, a_name, b_name, source,
                                       verdict, survivor_id, survivor_name, reason, confidence, model)
      values (${userA}, 'theme', ${lo}, ${hi}, 'x', 'y', 'trigram', 'same', ${lo}, 'Rent',
              'One subject.', 0.9, 'claude-haiku-4-5')
      returning id`;
    await expect(
      asUser(userA, (tx) => tx`select merge_themes(${s}, ${a}, null, ${proposal.id})`),
    ).rejects.toThrow(/not about this pair/);
  });
});

describe('apply_merge_proposals (plan #820)', () => {
  async function propose(x: string, y: string, survivor: string, name: string, confidence = 0.9) {
    const [lo, hi] = [x, y].sort();
    const [labels] = await admin<{ lo: string; hi: string }[]>`
      select (select name from themes where id = ${lo}) as lo,
             (select name from themes where id = ${hi}) as hi`;
    const [row] = await admin<{ id: string }[]>`
      insert into map_merge_proposals (user_id, kind, a_id, b_id, a_name, b_name, source,
                                       verdict, survivor_id, survivor_name, reason, confidence, model)
      values (${userA}, 'theme', ${lo}, ${hi}, ${labels.lo}, ${labels.hi}, 'embedding', 'same',
              ${survivor}, ${name}, 'One subject.', ${confidence}, 'claude-haiku-4-5')
      returning id`;
    return row.id;
  }

  async function apply() {
    const [row] = await admin<{ r: Record<string, number> }[]>`
      select apply_merge_proposals('theme', ${userA}) as r`;
    return row.r;
  }

  async function outcome(proposalId: string) {
    const [row] = await admin<{ apply_outcome: string | null }[]>`
      select apply_outcome from map_merge_proposals where id = ${proposalId}`;
    return row.apply_outcome;
  }

  it('merges every same proposal, following a side already merged, and records each', async () => {
    const hub = await theme('Transit');
    const bus = await theme('Buses');
    const tram = await theme('Trams');
    const n1 = await note('Transit/Bus.md');
    const n2 = await note('Transit/Tram.md');
    await filed(bus, [n1], []);
    await filed(tram, [n2], []);
    // Bus into the hub, surer, so it goes first; then bus and tram, whose bus
    // side now lives on the hub; then hub and tram, already one by then.
    const p1 = await propose(hub, bus, hub, 'Public transit', 0.95);
    const p2 = await propose(bus, tram, bus, 'Buses', 0.9);
    const p3 = await propose(hub, tram, hub, 'Transit', 0.85);

    const result = await apply();
    expect(result).toMatchObject({ merged: 2, joined: 1, remaining: 0 });
    expect([await outcome(p1), await outcome(p2), await outcome(p3)]).toEqual([
      'merged',
      'merged',
      'joined',
    ]);

    const merges = await admin<{ proposal_id: string; survivor_id: string; absorbed_id: string }[]>`
      select proposal_id, survivor_id, absorbed_id from map_merges
      where user_id = ${userA} and proposal_id in (${p1}, ${p2}) order by merged_at`;
    expect(merges).toEqual([
      { proposal_id: p1, survivor_id: hub, absorbed_id: bus },
      { proposal_id: p2, survivor_id: hub, absorbed_id: tram },
    ]);
    const [hubRow] = await admin<{ name: string; notes: number }[]>`
      select name, (select count(*)::int from theme_notes where theme_id = ${hub}) as notes
      from themes where id = ${hub}`;
    // The first merge took the suggested name; the chained one kept it.
    expect(hubRow).toEqual({ name: 'Public transit', notes: 2 });

    // A second run finds nothing to do.
    expect(await apply()).toMatchObject({ merged: 0, joined: 0, remaining: 0 });
  });

  it('does not merge an undone pair again, and the search leaves it out', async () => {
    const a = await theme('Housing supply');
    const b = await theme('Housing shortage');
    const c = await theme('Zoning reform');
    const p1 = await propose(a, b, a, 'Housing supply');
    await apply();
    const [merge] = await admin<{ id: string }[]>`select id from map_merges where proposal_id = ${p1}`;
    await admin`select undo_map_merge(${merge.id})`;

    // A later proposal that leads to the same pair through a chain: c into a,
    // then c and b, which is a and b again.
    const p2 = await propose(a, c, a, 'Housing supply', 0.95);
    const p3 = await propose(b, c, c, 'Zoning reform', 0.9);
    const result = await apply();
    expect(result).toMatchObject({ merged: 1, undone: 1, remaining: 0 });
    expect(await outcome(p2)).toBe('merged');
    expect(await outcome(p3)).toBe('undone');
    const [rows] = await admin<{ n: number }[]>`
      select count(*)::int as n from themes where id in (${a}, ${b})`;
    expect(rows.n).toBe(2);

    // The undone pair is left out of the candidate search even with its
    // proposal gone.
    await admin`delete from map_merge_proposals where id = ${p1}`;
    const [lo, hi] = [a, b].sort();
    const found = await admin<{ a_id: string }[]>`
      select a_id from theme_merge_candidates(1000, ${userA}, 5, 0.7, 0.3)
      where a_id = ${lo} and b_id = ${hi}`;
    expect(found).toHaveLength(0);
  });
});

/**
 * The shared page reads, and does nothing else.
 *
 * eslint.config.mjs stops the read path *importing* anything that can call
 * out, and tests/lint-boundaries.test.ts proves that rule still fires. This
 * file asserts the other half: that the page does not need any of it. Every
 * test here runs with `fetch` replaced by a function that throws, so a read
 * path which quietly grew a lookup fails loudly rather than working slowly.
 *
 * The seed is deliberately the bleakest shelf the form can be handed -- no
 * cached prices, no photos, no confirmed BGG ids -- because that is exactly
 * the state in which "we could just fetch it" is tempting. It has to render.
 */
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { admin, asAnon, closeDb, createUser, truncateAll } from './helpers/db';
import { loadSharePage } from '@/lib/share/read/load-disposition';

const RICH_TOKEN = 'rich-share-token-with-real-entropy-01';
const BLEAK_TOKEN = 'bleak-share-token-with-real-entropy-1';

/**
 * A Supabase client standing in for the real one, backed by the test database
 * and connecting as `anon` -- the same role the deployed page has. It exposes
 * exactly `rpc`, because exactly `rpc` is what the loader is allowed to use.
 */
function anonClientStub() {
  return {
    rpc: async (fn: string, args: Record<string, unknown>) => {
      const [row] = await asAnon((tx) =>
        tx.unsafe<{ result: unknown }[]>(`select public.${fn}($1) as result`, [
          args.p_token as string,
        ]),
      );
      return { data: row?.result ?? null, error: null };
    },
  } as never;
}

let ownerId: string;

beforeAll(async () => {
  await truncateAll();
  ownerId = await createUser('share-read@example.com');

  // ------------------------------------------------------------------ rich
  // Two Monopolies with a photo and a hand-typed price, under a family, plus
  // a lone Wingspan with no family at all.
  const monopoly = await admin<{ id: string }[]>`
    insert into inventory_items (user_id, name, short_name, cost_cents, acquired_at, image_url)
    select ${ownerId}, 'Monopoly Classic', 'Monopoly Classic', 4599, current_date,
           'https://img.example/monopoly.jpg'
      from generate_series(1, 2)
    returning id`;
  const [monopolyJunior] = await admin<{ id: string }[]>`
    insert into inventory_items (user_id, name, short_name, cost_cents, acquired_at)
    values (${ownerId}, 'Monopoly Junior', 'Monopoly Junior', 1500, current_date)
    returning id`;
  const [wingspan] = await admin<{ id: string }[]>`
    insert into inventory_items (user_id, name, short_name, cost_cents, acquired_at)
    values (${ownerId}, 'Wingspan', 'Wingspan', 5500, current_date)
    returning id`;

  for (const row of monopoly) {
    await admin`
      insert into game_details (inventory_item_id, bgg_id, resolution_source,
                                manual_expected_price_cents)
      values (${row.id}, 1406, 'manual', 1250)`;
  }
  await admin`
    insert into game_details (inventory_item_id, bgg_id, resolution_source)
    values (${monopolyJunior.id}, 2570, 'manual')`;
  await admin`
    insert into game_details (inventory_item_id, bgg_id, resolution_source)
    values (${wingspan.id}, 266192, 'manual')`;

  // Cached only. Nothing in the read path may refresh these.
  await admin`
    insert into game_price_quotes (bgg_id, source, quoted_cents) values (2570, 'ebay_browse', 800)`;

  const [family] = await admin<{ id: string }[]>`
    insert into item_families (user_id, name, slug) values (${ownerId}, 'Monopoly', 'monopoly')
    returning id`;
  for (const row of [...monopoly, monopolyJunior]) {
    await admin`
      insert into inventory_item_families (inventory_item_id, family_id, role, confirmed_at)
      values (${row.id}, ${family.id}, 'base', now())`;
  }

  const [richShare] = await admin<{ id: string }[]>`
    insert into share_links (user_id, title, intro)
    values (${ownerId}, 'Board games', 'Keep, sell, or give away.') returning id`;
  await admin`
    insert into share_link_tokens (share_link_id, token) values (${richShare.id}, ${RICH_TOKEN})`;
  for (const row of monopoly) {
    await admin`
      insert into share_link_items (share_link_id, subject_id, group_key, family_key)
      values (${richShare.id}, ${row.id}, 'game:bgg:1406', 'monopoly')`;
  }
  await admin`
    insert into share_link_items (share_link_id, subject_id, group_key, family_key)
    values (${richShare.id}, ${monopolyJunior.id}, 'game:bgg:2570', 'monopoly')`;
  await admin`
    insert into share_link_items (share_link_id, subject_id, group_key)
    values (${richShare.id}, ${wingspan.id}, 'game:bgg:266192')`;

  // ----------------------------------------------------------------- bleak
  // Nothing known about any of it. No price anywhere, no photo, no family.
  const [bleakItem] = await admin<{ id: string }[]>`
    insert into inventory_items (user_id, name, cost_cents, acquired_at)
    values (${ownerId}, 'Unidentified box from the loft', 0, current_date)
    returning id`;
  const [bleakShare] = await admin<{ id: string }[]>`
    insert into share_links (user_id, title) values (${ownerId}, 'The loft') returning id`;
  await admin`
    insert into share_link_tokens (share_link_id, token) values (${bleakShare.id}, ${BLEAK_TOKEN})`;
  await admin`
    insert into share_link_items (share_link_id, subject_id, group_key)
    values (${bleakShare.id}, ${bleakItem.id}, 'item:title:unidentified-box')`;
});

afterAll(async () => {
  await truncateAll();
  await closeDb();
});

/**
 * The assertion that gives this file its name. Anything reaching the network
 * from here throws, so a lookup added to the read path cannot pass silently.
 */
beforeEach(() => {
  vi.stubGlobal('fetch', () => {
    throw new Error('the shared link must not call out');
  });
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('a shelf where nothing is known', () => {
  it('renders rather than reaching for the missing pieces', async () => {
    const page = await loadSharePage(anonClientStub(), BLEAK_TOKEN);
    expect(page).not.toBeNull();
    expect(page?.groups).toHaveLength(1);
  });

  it('leaves an unknown price null, all the way to the renderer', async () => {
    const page = await loadSharePage(anonClientStub(), BLEAK_TOKEN);
    // Not 0. The renderer turns null into nothing; it would turn 0 into
    // "$0.00", which is a claim, and a false one.
    expect(page?.groups[0]?.unitPriceCents).toBeNull();
  });

  it('leaves a missing photo null rather than sourcing one', async () => {
    const page = await loadSharePage(anonClientStub(), BLEAK_TOKEN);
    expect(page?.groups[0]?.imageUrl).toBeNull();
  });
});

describe('a shelf where some of it is known', () => {
  it('takes the hand-typed price and the cached quote, and no others', async () => {
    const page = await loadSharePage(anonClientStub(), RICH_TOKEN);
    const byKey = new Map(page?.groups.map((g) => [g.groupKey, g]));
    expect(byKey.get('game:bgg:1406')?.unitPriceCents).toBe(1250);
    expect(byKey.get('game:bgg:2570')?.unitPriceCents).toBe(800);
    // Wingspan has neither. It stays unknown; it does not get looked up.
    expect(byKey.get('game:bgg:266192')?.unitPriceCents).toBeNull();
  });

  it('counts the copies rather than listing them', async () => {
    const page = await loadSharePage(anonClientStub(), RICH_TOKEN);
    const monopoly = page?.groups.find((g) => g.groupKey === 'game:bgg:1406');
    expect(monopoly?.quantity).toBe(2);
    expect(page?.totals).toEqual({ products: 3, units: 4, decided: 0 });
  });

  it('reports what is still undecided, which is the whole quantity at first', async () => {
    const page = await loadSharePage(anonClientStub(), RICH_TOKEN);
    expect(page?.groups.map((g) => g.undecided).reduce((a, b) => a + b, 0)).toBe(4);
  });
});

describe('families', () => {
  it('puts the two Monopolies under one heading', async () => {
    const page = await loadSharePage(anonClientStub(), RICH_TOKEN);
    const monopoly = page?.families.find((f) => f.key === 'monopoly');
    expect(monopoly?.label).toBe('Monopoly');
    expect(monopoly?.groups.map((g) => g.groupKey).sort()).toEqual([
      'game:bgg:1406',
      'game:bgg:2570',
    ]);
  });

  it('renders a lone game flat, because a heading over one game is noise', async () => {
    const page = await loadSharePage(anonClientStub(), RICH_TOKEN);
    const loose = page?.families.find((f) => f.key === null);
    expect(loose?.groups.map((g) => g.name)).toEqual(['Wingspan']);
  });
});

describe('a token that is not a token', () => {
  it('returns null without asking the database', async () => {
    let called = false;
    const spy = {
      rpc: async () => {
        called = true;
        return { data: null, error: null };
      },
    } as never;
    expect(await loadSharePage(spy, 'short')).toBeNull();
    expect(await loadSharePage(spy, '')).toBeNull();
    expect(called).toBe(false);
  });

  it('returns null for a well-formed token nobody issued', async () => {
    expect(await loadSharePage(anonClientStub(), 'unissued-token-with-real-entropy-x')).toBeNull();
  });
});

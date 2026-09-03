/**
 * The anonymous surface.
 *
 * Everything else in this application is reachable only with a session. These
 * two functions are the exception, so this file is the thing standing between
 * "a link my girlfriend can fill in" and "a link anyone can read my spending
 * out of". It is written to fail loudly if the exception ever widens.
 *
 * Three groups of assertions, and the second is the one that matters most:
 *
 *   1. anon cannot touch the tables at all -- not the share tables, and not
 *      the inventory behind them.
 *   2. what share_page() returns is a projection, asserted key by key, so a
 *      later `select *` cannot quietly start shipping cost and merchant.
 *   3. share_respond() counts the quantity itself and refuses everything else.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { admin, asAnon, asUser, closeDb, createUser, truncateAll } from './helpers/db';

const TOKEN = 'share-token-with-plenty-of-entropy-aaaa';
const OTHER_TOKEN = 'other-token-with-plenty-of-entropy-bbbb';
const MONOPOLY_GROUP = 'game:bgg:1406';
const CATAN_GROUP = 'game:bgg:325';

const SHARE_TABLES = [
  'share_links',
  'share_link_tokens',
  'share_link_items',
  'share_link_responses',
  'share_link_events',
];

let userA: string;
let userB: string;
let shareA: string;
let tokenA: string;
let monopolyIds: string[];

type Group = {
  groupKey: string;
  familyKey: string | null;
  familyLabel: string | null;
  name: string;
  quantity: number;
  imageUrl: string | null;
  unitPriceCents: number | null;
  keepQty: number;
  sellQty: number;
  giveawayQty: number;
  note: string | null;
  answeredAt: string | null;
};

type Page = {
  title: string;
  intro: string | null;
  kind: string;
  canRespond: boolean;
  groups: Group[];
};

async function fetchPage(token: string | null): Promise<Page | null> {
  const [row] = await asAnon((tx) =>
    tx.unsafe<{ page: Page | null }[]>('select public.share_page($1) as page', [token]),
  );
  return row?.page ?? null;
}

async function respond(
  token: string | null,
  groupKey: string,
  keep: number,
  sell: number,
  giveaway: number,
  note: string | null = null,
): Promise<Record<string, unknown> | null> {
  const [row] = await asAnon((tx) =>
    tx.unsafe<{ result: Record<string, unknown> | null }[]>(
      'select public.share_respond($1, $2, $3, $4, $5, $6) as result',
      [token, groupKey, keep, sell, giveaway, note],
    ),
  );
  return row?.result ?? null;
}

function groupFor(page: Page | null, key: string): Group {
  const hit = page?.groups.find((g) => g.groupKey === key);
  if (!hit) throw new Error(`group ${key} missing from page`);
  return hit;
}

beforeAll(async () => {
  await truncateAll();
  userA = await createUser('share-owner@example.com');
  userB = await createUser('share-stranger@example.com');

  // Three identical Monopoly boxes, one Catan expansion. The three boxes are
  // the whole point: they must arrive as one group with a quantity of 3.
  const monopoly = await admin<{ id: string }[]>`
    insert into inventory_items (user_id, name, short_name, cost_cents, acquired_at,
                                 image_url, notes)
    select ${userA}, 'Monopoly Classic Edition Board Game', 'Monopoly Classic',
           4599, current_date, 'https://img.example/monopoly.jpg',
           'Bought at a car boot sale, private note'
      from generate_series(1, 3)
    returning id`;
  monopolyIds = monopoly.map((r) => r.id);

  const [catan] = await admin<{ id: string }[]>`
    insert into inventory_items (user_id, name, short_name, cost_cents, acquired_at)
    values (${userA}, 'Catan: Seafarers Expansion', 'Catan: Seafarers', 3000, current_date)
    returning id`;

  for (const id of monopolyIds) {
    await admin`
      insert into game_details (inventory_item_id, bgg_id, resolution_source,
                                manual_expected_price_cents)
      values (${id}, 1406, 'manual', 1250)`;
  }
  await admin`
    insert into game_details (inventory_item_id, bgg_id, resolution_source)
    values (${catan.id}, 325, 'manual')`;

  // Catan has no manual price, only a cached quote. The page must find it in
  // the cache and must never go looking for a fresher one.
  await admin`
    insert into game_price_quotes (bgg_id, source, quoted_cents)
    values (325, 'ebay_browse', 2199)`;

  const [family] = await admin<{ id: string }[]>`
    insert into item_families (user_id, name, slug)
    values (${userA}, 'Monopoly', 'monopoly') returning id`;
  for (const id of monopolyIds) {
    await admin`
      insert into inventory_item_families (inventory_item_id, family_id, role, confirmed_at)
      values (${id}, ${family.id}, 'base', now())`;
  }

  const [share] = await admin<{ id: string }[]>`
    insert into share_links (user_id, title, intro)
    values (${userA}, 'Board games', 'Keep, sell, or give away.') returning id`;
  shareA = share.id;

  const [tok] = await admin<{ id: string }[]>`
    insert into share_link_tokens (share_link_id, token) values (${shareA}, ${TOKEN})
    returning id`;
  tokenA = tok.id;

  for (const id of monopolyIds) {
    await admin`
      insert into share_link_items (share_link_id, subject_id, group_key, family_key)
      values (${shareA}, ${id}, ${MONOPOLY_GROUP}, 'monopoly')`;
  }
  await admin`
    insert into share_link_items (share_link_id, subject_id, group_key)
    values (${shareA}, ${catan.id}, ${CATAN_GROUP})`;

  // A second user with their own share, used to prove one token never reaches
  // across the boundary.
  const [otherShare] = await admin<{ id: string }[]>`
    insert into share_links (user_id, title) values (${userB}, 'Bob keeps things')
    returning id`;
  await admin`
    insert into share_link_tokens (share_link_id, token)
    values (${otherShare.id}, ${OTHER_TOKEN})`;
});

afterAll(async () => {
  await truncateAll();
  await closeDb();
});

describe('anon cannot reach the tables', () => {
  it('reads no rows from any share table', async () => {
    const readable: string[] = [];
    for (const table of SHARE_TABLES) {
      try {
        const [row] = await asAnon((tx) =>
          tx.unsafe<{ count: number }[]>(`select count(*)::int as count from ${table}`),
        );
        if (Number(row.count) !== 0) readable.push(table);
      } catch {
        // permission denied is the better outcome, and also a pass.
      }
    }
    expect(readable).toEqual([]);
  });

  it('reads no inventory, which is what the share links point at', async () => {
    await expect(
      asAnon((tx) => tx`select count(*) from inventory_items`),
    ).rejects.toThrow(/permission denied|does not exist/i);
  });

  it('cannot write a response directly, only through the function', async () => {
    await expect(
      asAnon(
        (tx) => tx`insert into share_link_responses (share_link_id, group_key, keep_qty)
                   values (${shareA}, ${MONOPOLY_GROUP}, 99)`,
      ),
    ).rejects.toThrow(/permission denied|row-level security/i);
  });

  it('cannot mint itself a token', async () => {
    await expect(
      asAnon(
        (tx) => tx`insert into share_link_tokens (share_link_id, token)
                   values (${shareA}, 'forged-token-with-plenty-of-entropy')`,
      ),
    ).rejects.toThrow(/permission denied|row-level security/i);
  });
});

describe('share_page', () => {
  it('renders the page for a live token', async () => {
    const page = await fetchPage(TOKEN);
    expect(page).not.toBeNull();
    expect(page?.title).toBe('Board games');
    expect(page?.canRespond).toBe(true);
  });

  it('stacks identical copies into one group with a quantity', async () => {
    const page = await fetchPage(TOKEN);
    expect(page?.groups).toHaveLength(2);
    expect(groupFor(page, MONOPOLY_GROUP).quantity).toBe(3);
    expect(groupFor(page, CATAN_GROUP).quantity).toBe(1);
  });

  it('prefers a price typed by hand over a cached quote', async () => {
    expect(groupFor(await fetchPage(TOKEN), MONOPOLY_GROUP).unitPriceCents).toBe(1250);
  });

  it('falls back to the cached quote, and never fetches a fresher one', async () => {
    expect(groupFor(await fetchPage(TOKEN), CATAN_GROUP).unitPriceCents).toBe(2199);
  });

  it('sends null for an unknown price, so the page can render it blank', async () => {
    await admin`delete from game_price_quotes where bgg_id = 325`;
    expect(groupFor(await fetchPage(TOKEN), CATAN_GROUP).unitPriceCents).toBeNull();
    await admin`
      insert into game_price_quotes (bgg_id, source, quoted_cents)
      values (325, 'ebay_browse', 2199)`;
  });

  it('labels a group with its family name, not its slug', async () => {
    expect(groupFor(await fetchPage(TOKEN), MONOPOLY_GROUP).familyLabel).toBe('Monopoly');
  });

  it('sends a projection, not the row', async () => {
    // The assertion is on the exact key set. Adding a field to the function is
    // then a deliberate edit here rather than something that happens by
    // accident when someone widens a select.
    const group = groupFor(await fetchPage(TOKEN), MONOPOLY_GROUP);
    expect(Object.keys(group).sort()).toEqual(
      [
        'answeredAt', 'familyKey', 'familyLabel', 'giveawayQty', 'groupKey',
        'imageUrl', 'keepQty', 'name', 'note', 'quantity', 'sellQty',
        'unitPriceCents',
      ].sort(),
    );
  });

  it('never sends cost, private notes or the owner id', async () => {
    const raw = JSON.stringify(await fetchPage(TOKEN));
    expect(raw).not.toContain('4599');
    expect(raw).not.toContain('car boot');
    expect(raw).not.toContain(userA);
  });

  it('returns nothing for a wrong, short, or null token', async () => {
    expect(await fetchPage('share-token-with-plenty-of-entropy-zzzz')).toBeNull();
    expect(await fetchPage('short')).toBeNull();
    expect(await fetchPage(null)).toBeNull();
  });

  it('returns nothing once the token is revoked, expired, or archived', async () => {
    await admin`update share_link_tokens set revoked_at = now() where id = ${tokenA}`;
    expect(await fetchPage(TOKEN)).toBeNull();

    await admin`
      update share_link_tokens set revoked_at = null, expires_at = now() - interval '1 day'
       where id = ${tokenA}`;
    expect(await fetchPage(TOKEN)).toBeNull();

    await admin`update share_link_tokens set expires_at = null where id = ${tokenA}`;
    await admin`update share_links set status = 'archived' where id = ${shareA}`;
    expect(await fetchPage(TOKEN)).toBeNull();

    await admin`update share_links set status = 'active' where id = ${shareA}`;
    expect(await fetchPage(TOKEN)).not.toBeNull();
  });

  it('shows one owner nothing of the other, through their own token', async () => {
    const bob = await fetchPage(OTHER_TOKEN);
    expect(bob?.title).toBe('Bob keeps things');
    expect(bob?.groups).toEqual([]);
  });
});

describe('share_respond', () => {
  it('records a split and reports what is still undecided', async () => {
    const result = await respond(TOKEN, MONOPOLY_GROUP, 1, 1, 0);
    expect(result).toMatchObject({ ok: true });
    const group = (result as { group: Record<string, unknown> }).group;
    expect(group).toMatchObject({ keepQty: 1, sellQty: 1, giveawayQty: 0, undecided: 1 });
  });

  it('shows the answer back on the page, which is what makes it live', async () => {
    await respond(TOKEN, MONOPOLY_GROUP, 2, 1, 0, '  keeping two  ');
    const group = groupFor(await fetchPage(TOKEN), MONOPOLY_GROUP);
    expect(group).toMatchObject({ keepQty: 2, sellQty: 1, giveawayQty: 0 });
    expect(group.note).toBe('keeping two');
  });

  it('lets her change her mind without creating a second answer', async () => {
    await respond(TOKEN, MONOPOLY_GROUP, 0, 3, 0);
    const [row] = await admin<{ count: number }[]>`
      select count(*)::int as count from share_link_responses
       where share_link_id = ${shareA} and group_key = ${MONOPOLY_GROUP}`;
    expect(Number(row.count)).toBe(1);
    expect(groupFor(await fetchPage(TOKEN), MONOPOLY_GROUP).sellQty).toBe(3);
  });

  it('refuses more than the quantity rather than truncating it', async () => {
    expect(await respond(TOKEN, MONOPOLY_GROUP, 2, 2, 0)).toMatchObject({
      ok: false,
      error: 'over_quantity',
      quantity: 3,
    });
  });

  it('refuses negative counts', async () => {
    expect(await respond(TOKEN, MONOPOLY_GROUP, -1, 0, 0)).toMatchObject({
      ok: false,
      error: 'negative',
    });
  });

  it('refuses a group that is not on this share', async () => {
    expect(await respond(TOKEN, 'game:bgg:999999', 1, 0, 0)).toMatchObject({
      ok: false,
      error: 'unknown_group',
    });
  });

  it('refuses a group that belongs to someone else’s share', async () => {
    // The quantity is counted within the token's own share, so another
    // owner's group key is simply not there.
    expect(await respond(OTHER_TOKEN, MONOPOLY_GROUP, 1, 0, 0)).toMatchObject({
      ok: false,
      error: 'unknown_group',
    });
  });

  it('returns nothing at all for a bad token, same as the read', async () => {
    expect(await respond('share-token-with-plenty-of-entropy-zzzz', MONOPOLY_GROUP, 1, 0, 0))
      .toBeNull();
    expect(await respond('short', MONOPOLY_GROUP, 1, 0, 0)).toBeNull();
  });

  it('refuses to write through a read-only token', async () => {
    await admin`update share_link_tokens set can_respond = false where id = ${tokenA}`;
    expect(await respond(TOKEN, MONOPOLY_GROUP, 1, 0, 0)).toMatchObject({
      ok: false,
      error: 'read_only',
    });
    await admin`update share_link_tokens set can_respond = true where id = ${tokenA}`;
  });

  it('marks the token seen, so the owner knows she has been', async () => {
    await admin`update share_link_tokens set last_seen_at = null where id = ${tokenA}`;
    await respond(TOKEN, MONOPOLY_GROUP, 1, 0, 0);
    const [row] = await admin<{ last_seen_at: Date | null }[]>`
      select last_seen_at from share_link_tokens where id = ${tokenA}`;
    expect(row.last_seen_at).not.toBeNull();
  });

  it('rate limits a token that will not stop writing', async () => {
    await admin`
      insert into share_link_events (share_link_id, token_id, kind)
      select ${shareA}, ${tokenA}, 'responded' from generate_series(1, 60)`;
    expect(await respond(TOKEN, MONOPOLY_GROUP, 1, 0, 0)).toMatchObject({
      ok: false,
      error: 'rate_limited',
    });
    await admin`
      delete from share_link_events
       where token_id = ${tokenA} and created_at > now() - interval '1 minute'`;
  });
});

describe('quantities follow the inventory, not the share row', () => {
  it('drops a deleted unit from the group, so she is never offered a box that is gone', async () => {
    const doomed = monopolyIds[2];
    await admin`delete from inventory_items where id = ${doomed}`;

    expect(groupFor(await fetchPage(TOKEN), MONOPOLY_GROUP).quantity).toBe(2);

    // And the refusal moves with it: three was legal a moment ago.
    expect(await respond(TOKEN, MONOPOLY_GROUP, 3, 0, 0)).toMatchObject({
      ok: false,
      error: 'over_quantity',
      quantity: 2,
    });

    const [row] = await admin<{ count: number }[]>`
      select count(*)::int as count from share_link_items
       where share_link_id = ${shareA} and subject_id = ${doomed}`;
    expect(Number(row.count)).toBe(0);
  });
});

describe('the owner still sees everything through their session', () => {
  it('reads the answers back', async () => {
    const rows = await asUser(userA, (tx) =>
      tx<{ group_key: string }[]>`
        select group_key from share_link_responses where share_link_id = ${shareA}`,
    );
    expect(rows.length).toBeGreaterThan(0);
  });

  it('cannot read another owner’s share', async () => {
    const rows = await asUser(userB, (tx) =>
      tx<{ id: string }[]>`select id from share_links where id = ${shareA}`,
    );
    expect(rows).toHaveLength(0);
  });

  it('cannot put another owner’s item on their own share', async () => {
    const [bobShare] = await admin<{ id: string }[]>`
      select id from share_links where user_id = ${userB} limit 1`;
    await expect(
      asUser(userB, (tx) =>
        tx`insert into share_link_items (share_link_id, subject_id, group_key)
           values (${bobShare.id}, ${monopolyIds[0]}, 'smuggled')`,
      ),
    ).rejects.toThrow(/row-level security/i);
  });
});

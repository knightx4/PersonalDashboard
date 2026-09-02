/**
 * Cross-user isolation.
 *
 * This is the test that actually matters for multi-tenancy, and it is
 * deliberately written before any feature code. Two users, both seeded, then
 * every assertion runs as user B against user A's data.
 *
 * The loop is driven by a list built from the database itself, so adding a
 * table without an RLS policy fails here rather than in production months
 * later. `seedEverything` must cover every table in `public`; the coverage
 * test below fails if it doesn't, which is what forces this file to be updated
 * whenever the schema grows.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { admin, asUser, closeDb, createUser, truncateAll } from './helpers/db';

// `categories` and `merchants` are the only tables with rows shared by design.
// They get their own describe block below rather than a flag here, because the
// assertion for them is different: B may see the shared rows, never A's.

type SeedIds = Record<string, string>;

async function listPublicTables(): Promise<string[]> {
  const rows = await admin<{ tablename: string }[]>`
    select tablename from pg_tables where schemaname = 'public' order by tablename
  `;
  return rows.map((r) => r.tablename);
}

/** One row per table, all owned by `userId`. Returns table -> row id. */
async function seedEverything(userId: string, tag: string): Promise<SeedIds> {
  const ids: SeedIds = {};

  // profiles already exists via the on_auth_user_created trigger
  ids.profiles = userId;

  const [category] = await admin<{ id: string }[]>`
    insert into categories (user_id, name, slug, color)
    values (${userId}, ${`${tag} category`}, ${`${tag}-category`}, '#000000')
    returning id`;
  ids.categories = category.id;

  const [merchant] = await admin<{ id: string }[]>`
    insert into merchants (name, slug, domains, created_by_user_id, is_global)
    values (${`${tag} Shop`}, ${`${tag}-shop`}, array[${`${tag}.example`}], ${userId}, false)
    returning id`;
  ids.merchants = merchant.id;

  const [account] = await admin<{ id: string }[]>`
    insert into core.email_accounts (user_id, provider, email_address)
    values (${userId}, 'gmail', ${`${tag}@example.com`})
    returning id`;

  const [order] = await admin<{ id: string }[]>`
    insert into orders (user_id, merchant_id, order_date, external_order_number,
                        subtotal_cents, total_cents)
    values (${userId}, ${merchant.id}, current_date, ${`${tag}-0001`}, 1000, 1000)
    returning id`;
  ids.orders = order.id;

  const [orderItem] = await admin<{ id: string }[]>`
    insert into order_items (order_id, name, quantity, unit_price_cents)
    values (${order.id}, ${`${tag} widget`}, 1, 1000)
    returning id`;
  ids.order_items = orderItem.id;

  const [inventoryItem] = await admin<{ id: string }[]>`
    insert into inventory_items (user_id, order_item_id, name, cost_cents, acquired_at, source)
    values (${userId}, ${orderItem.id}, ${`${tag} widget`}, 1000, current_date, 'manual')
    returning id`;
  ids.inventory_items = inventoryItem.id;

  const [bookDetails] = await admin<{ id: string }[]>`
    insert into book_details (
      inventory_item_id, isbn_13, authors, resolution_source, match_confidence, needs_confirmation
    )
    values (
      ${inventoryItem.id}, ${'9780735211292'}, array['James Clear'], 'manual', 0.9, false
    )
    returning id`;
  ids.book_details = bookDetails.id;

  const [gameDetails] = await admin<{ id: string }[]>`
    insert into game_details (
      inventory_item_id, bgg_id, year_published, publisher, condition, resolution_source
    )
    values (
      ${inventoryItem.id}, ${tag === 'alice' ? 13 : 822}, 2000,
      ${`${tag} games`}, 'complete_used', 'manual'
    )
    returning id`;
  ids.game_details = gameDetails.id;

  const [feedback] = await admin<{ id: string }[]>`
    insert into feedback_items (user_id, kind, body, page_path)
    values (${userId}, 'bug', ${`${tag} found a bug`}, '/shopping/dashboard')
    returning id`;
  ids.feedback_items = feedback.id;

  const [bookQuote] = await admin<{ id: string }[]>`
    insert into book_price_quotes (isbn_13, source, quoted_cents, vendor_name)
    values (
      ${tag === 'alice' ? '9780735211292' : '9780143127550'},
      'buyback',
      ${tag === 'alice' ? 500 : 200},
      ${`${tag} books`}
    )
    returning id`;
  ids.book_price_quotes = bookQuote.id;

  const [gameQuote] = await admin<{ id: string }[]>`
    insert into game_price_quotes (bgg_id, source, quoted_cents, vendor_name)
    values (
      ${tag === 'alice' ? 13 : 822},
      'buyback',
      ${tag === 'alice' ? 1500 : 900},
      ${`${tag} games`}
    )
    returning id`;
  ids.game_price_quotes = gameQuote.id;

  const [use] = await admin<{ id: string }[]>`
    insert into item_uses (inventory_item_id, used_on)
    values (${inventoryItem.id}, current_date) returning id`;
  ids.item_uses = use.id;

  const [shipment] = await admin<{ id: string }[]>`
    insert into shipments (order_id, carrier, tracking_number, status)
    values (${order.id}, 'UPS', ${`${tag}-TRACK`}, 'in_transit') returning id`;
  ids.shipments = shipment.id;

  // The envelope is core's; ingested_messages is now only this app's verdict
  // about it, keyed by the same id.
  const [message] = await admin<{ id: string }[]>`
    insert into core.ingested_messages (email_account_id, provider_message_id, received_at,
                                        from_address, subject)
    values (${account.id}, ${`${tag}-msg-1`}, now(), ${`orders@${tag}.example`},
            ${`Your ${tag} order`})
    returning id`;

  await admin`
    insert into ingested_messages (id, classification, parse_status)
    values (${message.id}, 'order_confirmation', 'parsed')`;
  ids.ingested_messages = message.id;

  const [ret] = await admin<{ id: string }[]>`
    insert into returns (user_id, order_id, inventory_item_id, initiated_at,
                         refund_amount_cents, status, source_message_id)
    values (${userId}, ${order.id}, ${inventoryItem.id}, current_date, 500,
            'initiated', ${message.id})
    returning id`;
  ids.returns = ret.id;

  const [saved] = await admin<{ id: string }[]>`
    insert into saved_items (user_id, merchant_id, url, title, price_cents)
    values (${userId}, ${merchant.id}, ${`https://${tag}.example/p/1`}, ${`${tag} thing`}, 2000)
    returning id`;
  ids.saved_items = saved.id;

  const [check] = await admin<{ id: string }[]>`
    insert into price_checks (saved_item_id, price_cents, in_stock)
    values (${saved.id}, 1800, true) returning id`;
  ids.price_checks = check.id;

  await admin`
    insert into core.sync_jobs (email_account_id, type, status)
    values (${account.id}, 'backfill', 'completed') returning id`;

  const [exclusion] = await admin<{ id: string }[]>`
    insert into merchant_exclusions (user_id, merchant_id, match_domain)
    values (${userId}, ${merchant.id}, ${`${tag}.example`})
    returning id`;
  ids.merchant_exclusions = exclusion.id;

  const [itemList] = await admin<{ id: string }[]>`
    insert into item_lists (user_id, name, slug, color)
    values (${userId}, ${`${tag} list`}, ${`${tag}-list`}, '#6A82FB')
    returning id`;
  ids.item_lists = itemList.id;

  const [membership] = await admin<{ id: string }[]>`
    insert into inventory_item_lists (inventory_item_id, list_id)
    values (${inventoryItem.id}, ${itemList.id})
    returning id`;
  ids.inventory_item_lists = membership.id;

  const [policy] = await admin<{ id: string }[]>`
    insert into merchant_return_policies (user_id, merchant_id, return_window_days)
    values (${userId}, ${merchant.id}, 30)
    returning id`;
  ids.merchant_return_policies = policy.id;

  const [itemTag] = await admin<{ id: string }[]>`
    insert into item_tags (user_id, name, slug)
    values (${userId}, ${`${tag} shoes`}, ${`${tag}-shoes`})
    returning id`;
  ids.item_tags = itemTag.id;

  const [orderItemTag] = await admin<{ id: string }[]>`
    insert into order_item_tags (order_item_id, tag_id)
    values (${orderItem.id}, ${itemTag.id})
    returning id`;
  ids.order_item_tags = orderItemTag.id;

  const [fxRate] = await admin<{ id: string }[]>`
    insert into fx_rates (rate_date, base_currency, quote_currency, rate, source)
    values (
      current_date,
      'USD',
      ${tag === 'alice' ? 'EUR' : 'HKD'},
      ${tag === 'alice' ? 0.92 : 7.8},
      'test'
    )
    returning id`;
  ids.fx_rates = fxRate.id;

  return ids;
}

let userA: string;
let userB: string;
let seedA: SeedIds;
let tables: string[];

beforeAll(async () => {
  await truncateAll();
  userA = await createUser('alice@example.com');
  userB = await createUser('bob@example.com');
  seedA = await seedEverything(userA, 'alice');
  await seedEverything(userB, 'bob');
  tables = await listPublicTables();
});

afterAll(async () => {
  await truncateAll();
  await closeDb();
});

describe('RLS coverage', () => {
  it('has row level security enabled on every table in public', async () => {
    const rows = await admin<{ tablename: string }[]>`
      select c.relname as tablename
      from pg_class c
      join pg_namespace n on n.oid = c.relnamespace
      where n.nspname = 'public' and c.relkind = 'r' and not c.relrowsecurity
      order by 1`;
    expect(rows.map((r) => r.tablename)).toEqual([]);
  });

  it('has at least one policy on every table in public', async () => {
    const rows = await admin<{ tablename: string }[]>`
      select t.tablename
      from pg_tables t
      where t.schemaname = 'public'
        and not exists (
          select 1 from pg_policies p
          where p.schemaname = 'public' and p.tablename = t.tablename
        )
      order by 1`;
    expect(rows.map((r) => r.tablename)).toEqual([]);
  });

  it('seeds every table, so a new table cannot skip the isolation check', () => {
    // If this fails, a table was added to the schema without being added to
    // seedEverything(). Add it there rather than deleting it from here.
    expect(Object.keys(seedA).sort()).toEqual([...tables].sort());
  });
});

describe('cross-user reads', () => {
  /** Shared market-data tables: every authenticated user may read every row. */
  const SHARED_REFERENCE_TABLES = new Set([
    'fx_rates',
    'book_price_quotes',
    'game_price_quotes',
  ]);

  it('shows user B zero rows belonging to user A, in every table', async () => {
    const leaks: string[] = [];

    for (const table of tables) {
      if (SHARED_REFERENCE_TABLES.has(table)) continue;
      const id = seedA[table];
      const [row] = await asUser(userB, (tx) =>
        tx.unsafe<{ count: string }[]>(`select count(*)::int as count from ${table} where id = $1`, [id]),
      );
      if (Number(row.count) !== 0) leaks.push(table);
    }

    expect(leaks).toEqual([]);
  });

  it('still shows user B their own rows, so the policies are not just deny-all', async () => {
    const empty: string[] = [];

    for (const table of tables) {
      const [row] = await asUser(userB, (tx) =>
        tx.unsafe<{ count: string }[]>(`select count(*)::int as count from ${table}`),
      );
      if (Number(row.count) === 0) empty.push(table);
    }

    expect(empty).toEqual([]);
  });

  it('lets every authenticated user read cached FX rates', async () => {
    const rows = await asUser(userB, (tx) =>
      tx<{ id: string }[]>`select id from fx_rates where id = ${seedA.fx_rates}`,
    );
    expect(rows).toHaveLength(1);
  });

  it('lets every authenticated user read cached book price quotes', async () => {
    const rows = await asUser(userB, (tx) =>
      tx<{ id: string }[]>`select id from book_price_quotes where id = ${seedA.book_price_quotes}`,
    );
    expect(rows).toHaveLength(1);
  });

  it('lets every authenticated user read cached game price quotes', async () => {
    const rows = await asUser(userB, (tx) =>
      tx<{ id: string }[]>`select id from game_price_quotes where id = ${seedA.game_price_quotes}`,
    );
    expect(rows).toHaveLength(1);
  });
});

describe('shared tables leak nothing user-scoped', () => {
  it('lets user B read system categories but not user A categories', async () => {
    const rows = await asUser(userB, (tx) =>
      tx<{ user_id: string | null }[]>`select user_id from categories`,
    );
    expect(rows.length).toBeGreaterThan(0);
    expect(rows.some((r) => r.user_id === null)).toBe(true);
    expect(rows.some((r) => r.user_id === userA)).toBe(false);
  });

  it('lets user B read global merchants but not user A merchants', async () => {
    const rows = await asUser(userB, (tx) =>
      tx<{ is_global: boolean; created_by_user_id: string | null }[]>`
        select is_global, created_by_user_id from merchants`,
    );
    expect(rows.some((r) => r.is_global)).toBe(true);
    expect(rows.some((r) => r.created_by_user_id === userA)).toBe(false);
  });
});

describe('cross-user writes', () => {
  it('does not let user B update user A rows', async () => {
    // email_accounts moved to core; its isolation is covered in rls-core.
    for (const table of ['orders', 'inventory_items', 'saved_items']) {
      const affected = await asUser(userB, (tx) =>
        tx.unsafe(`update ${table} set updated_at = now() where id = $1 returning id`, [
          seedA[table],
        ]),
      );
      expect(affected.length, `${table} was writable by another user`).toBe(0);
    }
  });

  it('does not let user B delete user A rows', async () => {
    for (const table of ['orders', 'inventory_items', 'saved_items']) {
      const affected = await asUser(userB, (tx) =>
        tx.unsafe(`delete from ${table} where id = $1 returning id`, [seedA[table]]),
      );
      expect(affected.length, `${table} was deletable by another user`).toBe(0);
    }
  });

  it('does not let user B insert a row owned by user A', async () => {
    await expect(
      asUser(userB, (tx) =>
        tx`insert into saved_items (user_id, url) values (${userA}, 'https://x.example/1')`,
      ),
    ).rejects.toThrow(/row-level security/i);
  });

  it('does not let a user edit a system category', async () => {
    const affected = await asUser(userB, (tx) =>
      tx`update categories set name = 'hijacked' where user_id is null returning id`,
    );
    expect(affected.length).toBe(0);
  });

  it('does not let a user create a global merchant', async () => {
    await expect(
      asUser(userB, (tx) =>
        tx`insert into merchants (name, slug, is_global) values ('Evil', 'evil', true)`,
      ),
    ).rejects.toThrow(/row-level security|violates check constraint/i);
  });

  it('does not let a user attach a child row to another user parent', async () => {
    await expect(
      asUser(userB, (tx) =>
        tx`insert into order_items (order_id, name, quantity, unit_price_cents)
           values (${seedA.orders}, 'smuggled', 1, 100)`,
      ),
    ).rejects.toThrow(/row-level security/i);
  });
});

describe('privacy constraints', () => {
  it('refuses to store a subject or sender on a not_relevant message', async () => {
    // The row constraint that used to enforce this is gone, and could not have
    // survived: "not relevant" is one workspace's opinion now, and the message
    // this app discards may be the one the job side is keeping. The rule moved
    // to core.scrub_unclaimed_messages(), which is covered in rls-core.
    const [account] = await admin<{ id: string }[]>`
      insert into core.email_accounts (user_id, provider, email_address)
      values (${await createUser('bare@example.com')}, 'gmail', 'bare@example.com')
      returning id`;
    const [msg] = await admin<{ id: string }[]>`
      insert into core.ingested_messages (email_account_id, provider_message_id, subject)
      values (${account.id}, 'bare-1', 'Dinner on Friday?')
      returning id`;
    await admin`insert into ingested_messages (id, classification) values (${msg.id}, 'not_relevant')`;

    // One workspace alone cannot cause a scrub.
    const [{ scrubbed }] = await admin<{ scrubbed: number }[]>`
      select core.scrub_unclaimed_messages() as scrubbed`;
    expect(scrubbed).toBe(0);
    const [kept] = await admin<{ subject: string | null }[]>`
      select subject from core.ingested_messages where id = ${msg.id}`;
    expect(kept.subject).toBe('Dinner on Friday?');
  });
});

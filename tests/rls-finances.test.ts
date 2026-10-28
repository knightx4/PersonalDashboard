/**
 * The finances schema (plan #2593.2): accounts, their daily balances,
 * transactions and holdings, each its owner's alone. The coverage test makes
 * a new table fail until it is checked here too.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { admin, asUser, closeDb, createUser, truncateAll } from './helpers/db-finances';

let userA = '';
let userB = '';

beforeAll(async () => {
  await truncateAll();
  userA = await createUser('finances-a@example.com');
  userB = await createUser('finances-b@example.com');
});

afterAll(async () => {
  await truncateAll();
  await closeDb();
});

describe('coverage', () => {
  it('checks every table, so a new one cannot skip the isolation check', async () => {
    const rows = await admin<{ tablename: string }[]>`
      select c.relname as tablename
      from pg_class c
      join pg_namespace n on n.oid = c.relnamespace
      where n.nspname = 'finances' and c.relkind = 'r'
      order by 1`;
    expect(rows.map((r) => r.tablename)).toEqual([
      'accounts',
      'balance_readings',
      'holdings',
      'links',
      'transactions',
    ]);
  });

  it('has row level security on every table', async () => {
    const rows = await admin<{ tablename: string }[]>`
      select c.relname as tablename
      from pg_class c
      join pg_namespace n on n.oid = c.relnamespace
      where n.nspname = 'finances' and c.relkind = 'r' and not c.relrowsecurity`;
    expect(rows).toEqual([]);
  });
});

describe('an account with its balances and a transaction', () => {
  let accountId = '';

  it('saves an account, two days of balances and a transaction, and reads them back to its owner only', async () => {
    const [account] = await asUser(
      userA,
      (tx) => tx<{ id: string }[]>`
        insert into accounts (user_id, name, institution_name, mask, kind, source)
        values (${userA}, 'Total Checking', 'Chase', '1234', 'checking', 'manual')
        returning id`,
    );
    accountId = account.id;
    await asUser(
      userA,
      (tx) => tx`
        insert into balance_readings (user_id, account_id, read_on, balance_cents, available_cents)
        values (${userA}, ${accountId}, '2026-10-26', 250000, 245000),
               (${userA}, ${accountId}, '2026-10-27', 241234, null)`,
    );
    await asUser(
      userA,
      (tx) => tx`
        insert into transactions (user_id, account_id, amount_cents, posted_on, description, merchant, category)
        values (${userA}, ${accountId}, -8766, '2026-10-27', 'WHOLEFDS MKT #123', 'Whole Foods', 'Groceries')`,
    );

    const balances = await asUser(
      userA,
      (tx) => tx`
        select read_on::text as read_on, balance_cents::int as balance_cents
        from balance_readings where account_id = ${accountId} order by read_on`,
    );
    expect(balances).toEqual([
      { read_on: '2026-10-26', balance_cents: 250000 },
      { read_on: '2026-10-27', balance_cents: 241234 },
    ]);
    const spent = await asUser(
      userA,
      (tx) => tx`
        select a.name, t.amount_cents::int as amount_cents, t.merchant, t.pending
        from transactions t join accounts a on a.id = t.account_id`,
    );
    expect(spent).toEqual([{ name: 'Total Checking', amount_cents: -8766, merchant: 'Whole Foods', pending: false }]);

    for (const table of ['accounts', 'balance_readings', 'transactions']) {
      const seen = await asUser(userB, (tx) => tx`select id from ${tx(table)}`);
      expect(seen, table).toHaveLength(0);
    }
  });

  it('keeps one balance a day, so a second reading replaces the first', async () => {
    await asUser(
      userA,
      (tx) => tx`
        insert into balance_readings (user_id, account_id, read_on, balance_cents)
        values (${userA}, ${accountId}, '2026-10-27', 239000)
        on conflict (account_id, read_on) do update set balance_cents = excluded.balance_cents`,
    );
    const rows = await admin`select balance_cents::int as b from balance_readings
                             where account_id = ${accountId} and read_on = '2026-10-27'`;
    expect(rows).toEqual([{ b: 239000 }]);
  });

  it("refuses a row pointing at another account's account, or written as someone else", async () => {
    await expect(
      asUser(
        userB,
        (tx) => tx`insert into transactions (user_id, account_id, amount_cents, posted_on, description)
                   values (${userB}, ${accountId}, -100, '2026-10-27', 'x')`,
      ),
    ).rejects.toThrow();
    await expect(
      asUser(
        userB,
        (tx) => tx`insert into accounts (user_id, name, kind, source)
                   values (${userA}, 'Not mine', 'savings', 'manual')`,
      ),
    ).rejects.toThrow();
    await asUser(userB, (tx) => tx`update accounts set name = 'Taken'`);
    await asUser(userB, (tx) => tx`delete from transactions`);
    const [left] = await admin`select a.name, (select count(*)::int from transactions where account_id = a.id) as n
                               from accounts a where a.id = ${accountId}`;
    expect(left).toEqual({ name: 'Total Checking', n: 1 });
  });

  it('never imports the same statement line twice', async () => {
    const insert = () =>
      admin`insert into transactions (user_id, account_id, amount_cents, posted_on, description, import_fingerprint)
            values (${userA}, ${accountId}, -500, '2026-10-20', 'COFFEE', 'fp-1')`;
    await insert();
    await expect(insert()).rejects.toThrow();
  });

  it("refuses a link to another account's Shopping order", async () => {
    const [order] = await admin<{ id: string }[]>`
      insert into public.orders (user_id, order_date) values (${userB}, '2026-10-20') returning id`;
    await expect(
      admin`insert into transactions (user_id, account_id, amount_cents, posted_on, description, order_id)
            values (${userA}, ${accountId}, -500, '2026-10-20', 'SHOP', ${order.id})`,
    ).rejects.toThrow(/does not belong/);
  });
});

describe('account shapes', () => {
  it('holds loan terms on a loan and a limit on a card, and nowhere else', async () => {
    await admin`insert into accounts (user_id, name, kind, source, interest_rate, minimum_payment_cents, next_payment_due_on)
                values (${userA}, 'Student loan 1', 'loan', 'import', 5.05, 21500, '2026-11-15')`;
    await admin`insert into accounts (user_id, name, kind, source, credit_limit_cents)
                values (${userA}, 'Apple Card', 'credit_card', 'import', 1200000)`;
    await expect(
      admin`insert into accounts (user_id, name, kind, source, interest_rate)
            values (${userA}, 'Savings', 'savings', 'manual', 4.1)`,
    ).rejects.toThrow();
    await expect(
      admin`insert into accounts (user_id, name, kind, source, credit_limit_cents)
            values (${userA}, 'Checking', 'checking', 'manual', 100)`,
    ).rejects.toThrow();
    // A Plaid account names its Plaid id, and only a Plaid account does.
    await expect(
      admin`insert into accounts (user_id, name, kind, source) values (${userA}, 'Linked', 'checking', 'plaid')`,
    ).rejects.toThrow();
  });

  it('keeps a Plaid account and its history when its link is removed, and hides the token', async () => {
    const [link] = await admin<{ id: string }[]>`
      insert into links (user_id, plaid_item_id, institution_name, access_token)
      values (${userA}, 'item-1', 'Chase', 'v1:abc') returning id`;
    const [account] = await admin<{ id: string }[]>`
      insert into accounts (user_id, link_id, name, kind, source, plaid_account_id)
      values (${userA}, ${link.id}, 'Sapphire', 'credit_card', 'plaid', 'acc-1') returning id`;
    await expect(
      asUser(userA, (tx) => tx`select access_token from links`),
    ).rejects.toThrow(/permission denied/);
    expect(await asUser(userA, (tx) => tx`select institution_name from links`)).toEqual([
      { institution_name: 'Chase' },
    ]);
    await asUser(userA, (tx) => tx`delete from links where id = ${link.id}`);
    const [kept] = await admin`select link_id, user_id from accounts where id = ${account.id}`;
    expect(kept).toEqual({ link_id: null, user_id: userA });
  });

  it('holds a brokerage position by date', async () => {
    const [account] = await admin<{ id: string }[]>`
      insert into accounts (user_id, name, kind, source) values (${userA}, 'Brokerage', 'brokerage', 'manual')
      returning id`;
    await asUser(
      userA,
      (tx) => tx`insert into holdings (user_id, account_id, ticker, security_name, quantity, value_cents, cost_basis_cents, as_of)
                 values (${userA}, ${account.id}, 'VTI', 'Vanguard Total Stock Market ETF', 12.5, 371250, 300000, '2026-10-27')`,
    );
    await expect(
      admin`insert into holdings (user_id, account_id, ticker, security_name, quantity, value_cents, as_of)
            values (${userA}, ${account.id}, 'VTI', 'Vanguard Total Stock Market ETF', 13, 380000, '2026-10-27')`,
    ).rejects.toThrow();
    expect(await asUser(userB, (tx) => tx`select id from holdings`)).toHaveLength(0);
  });
});

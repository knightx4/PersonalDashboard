import { describe, expect, it, vi } from 'vitest';
import {
  accountKind,
  accountRows,
  finishFix,
  finishLink,
  ITEMS_SPENT_REASON,
  startFix,
  startLink,
  TRIAL_ITEMS,
  type LinkDeps,
  type LinkStore,
  type PlaidAccount,
  type PlaidPort,
  type StoredLink,
} from './link';

const USER = '11111111-1111-4111-8111-111111111111';

function chaseLink(over: Partial<StoredLink> = {}): StoredLink {
  return {
    id: 'link-chase',
    plaid_item_id: 'item-chase',
    institution_id: 'ins_56',
    institution_name: 'Chase',
    status: 'active',
    needs_update: false,
    access_token: 'v1:enc(access-chase)',
    ...over,
  };
}

const CHECKING: PlaidAccount = {
  account_id: 'acc-1',
  name: 'Total Checking',
  official_name: 'CHASE TOTAL CHECKING',
  mask: '4417',
  type: 'depository',
  subtype: 'checking',
  balances: { current: 1234.56, available: 1200, limit: null, iso_currency_code: 'USD' },
};

const CARD: PlaidAccount = {
  account_id: 'acc-2',
  name: 'Sapphire Preferred',
  official_name: null,
  mask: '3381',
  type: 'credit',
  subtype: 'credit card',
  balances: { current: 410.2, available: 9589.8, limit: 10000, iso_currency_code: 'USD' },
};

function fakes(links: StoredLink[] = [], item: Partial<Awaited<ReturnType<PlaidPort['getItem']>>> = {}) {
  const plaid = {
    createLinkToken: vi.fn(async () => 'link-sandbox-token'),
    exchange: vi.fn(async () => ({ accessToken: 'access-new', itemId: 'item-new' })),
    getItem: vi.fn(async () => ({
      institutionId: 'ins_56',
      institutionName: 'Chase',
      errorCode: null,
      errorMessage: null,
      ...item,
    })),
    getAccounts: vi.fn(async () => [CHECKING, CARD]),
    removeItem: vi.fn(async () => undefined),
  } satisfies PlaidPort;
  const store = {
    listLinks: vi.fn(async () => links),
    insertLink: vi.fn(async () => ({ id: 'link-new' })),
    updateLink: vi.fn(async () => undefined),
    saveAccounts: vi.fn(async (...args: [string, unknown[], unknown[]]) => args[1].length),
  } satisfies LinkStore;
  const deps: LinkDeps = {
    plaid,
    store,
    encrypt: (plain) => `v1:enc(${plain})`,
    decrypt: (cipher) => cipher.replace(/^v1:enc\((.*)\)$/, '$1'),
    today: () => '2026-10-28',
  };
  return { plaid, store, deps };
}

describe('startLink', () => {
  it('asks for the kind’s product and the other two as optional', async () => {
    const { deps, plaid } = fakes();
    const result = await startLink(deps, { userId: USER, kind: 'brokerage', webhook: 'https://x/api/hook' });
    expect(result).toEqual({ ok: true, linkToken: 'link-sandbox-token' });
    expect(plaid.createLinkToken).toHaveBeenCalledWith({
      userId: USER,
      products: ['investments'],
      optionalProducts: ['transactions', 'liabilities'],
      webhook: 'https://x/api/hook',
      redirectUri: undefined,
    });
  });

  it('refuses once the Trial plan’s ten Items are spent, removed ones included', async () => {
    const links = Array.from({ length: TRIAL_ITEMS }, (_, i) =>
      chaseLink({ id: `l${i}`, institution_id: `ins_${i}`, status: i === 0 ? 'removed' : 'active' }),
    );
    const { deps, plaid } = fakes(links);
    expect(await startLink(deps, { userId: USER, kind: 'bank' })).toEqual({ ok: false, reason: ITEMS_SPENT_REASON });
    expect(plaid.createLinkToken).not.toHaveBeenCalled();
  });
});

describe('finishLink', () => {
  it('stores the access token encrypted and saves the accounts with today’s balance', async () => {
    const { deps, store } = fakes();
    const result = await finishLink(deps, { userId: USER, publicToken: 'public-1' });
    expect(result).toEqual({ ok: true, linkId: 'link-new', institutionName: 'Chase', accounts: 2 });
    expect(store.insertLink).toHaveBeenCalledWith({
      user_id: USER,
      plaid_item_id: 'item-new',
      institution_id: 'ins_56',
      institution_name: 'Chase',
      access_token: 'v1:enc(access-new)',
    });
    const [, accounts, balances] = store.saveAccounts.mock.calls[0]!;
    expect(accounts).toHaveLength(2);
    expect(balances).toEqual([
      { plaid_account_id: 'acc-1', read_on: '2026-10-28', balance_cents: 123456, available_cents: 120000 },
      { plaid_account_id: 'acc-2', read_on: '2026-10-28', balance_cents: 41020, available_cents: 958980 },
    ]);
  });

  it('refuses a second link to an institution already linked, and removes the Item it made', async () => {
    const { deps, store, plaid } = fakes([chaseLink()]);
    const result = await finishLink(deps, { userId: USER, publicToken: 'public-2' });
    expect(result.ok).toBe(false);
    expect(result.ok === false && result.reason).toMatch(/^Chase is already linked/);
    expect(store.insertLink).not.toHaveBeenCalled();
    expect(store.saveAccounts).not.toHaveBeenCalled();
    expect(plaid.removeItem).toHaveBeenCalledWith('access-new');
  });

  it('links an institution again once its earlier link was removed', async () => {
    const { deps, store } = fakes([chaseLink({ status: 'removed' })]);
    expect((await finishLink(deps, { userId: USER, publicToken: 'public-3' })).ok).toBe(true);
    expect(store.insertLink).toHaveBeenCalled();
  });
});

describe('update mode', () => {
  it('opens Link on the same Item’s access token, with no products and no new slot', async () => {
    const { deps, plaid } = fakes([chaseLink({ needs_update: true })]);
    const result = await startFix(deps, { userId: USER, linkId: 'link-chase' });
    expect(result).toEqual({ ok: true, linkToken: 'link-sandbox-token' });
    expect(plaid.createLinkToken).toHaveBeenCalledWith({
      userId: USER,
      accessToken: 'access-chase',
      redirectUri: undefined,
    });
  });

  it('clears needs attention once Plaid reports the Item well, without exchanging or adding a link', async () => {
    const { deps, plaid, store } = fakes([chaseLink({ needs_update: true })]);
    expect(await finishFix(deps, { userId: USER, linkId: 'link-chase' })).toEqual({ ok: true });
    expect(plaid.getItem).toHaveBeenCalledWith('access-chase');
    expect(plaid.exchange).not.toHaveBeenCalled();
    expect(store.insertLink).not.toHaveBeenCalled();
    expect(store.updateLink).toHaveBeenCalledWith(USER, 'link-chase', {
      needs_update: false,
      status: 'active',
      last_error: null,
    });
  });

  it('keeps the link needing attention while Plaid still reports the login error', async () => {
    const { deps, store } = fakes([chaseLink({ needs_update: true })], {
      errorCode: 'ITEM_LOGIN_REQUIRED',
      errorMessage: 'the login details of this item have changed',
    });
    const result = await finishFix(deps, { userId: USER, linkId: 'link-chase' });
    expect(result).toEqual({ ok: false, reason: 'the login details of this item have changed' });
    expect(store.updateLink).toHaveBeenCalledWith(USER, 'link-chase', {
      needs_update: true,
      last_error: 'the login details of this item have changed',
    });
  });

  it('refuses a link that is not the person’s', async () => {
    const { deps, plaid } = fakes([chaseLink()]);
    expect((await startFix(deps, { userId: USER, linkId: 'someone-else' })).ok).toBe(false);
    expect(plaid.createLinkToken).not.toHaveBeenCalled();
  });
});

describe('accountRows', () => {
  it('maps Plaid’s types and keeps a card’s limit', () => {
    expect(accountKind('depository', 'savings')).toBe('savings');
    expect(accountKind('investment', 'brokerage')).toBe('brokerage');
    expect(accountKind('loan', 'student')).toBe('loan');
    expect(accountKind('other', null)).toBeNull();
    const { accounts } = accountRows([CARD], { userId: USER, linkId: 'l', institutionName: 'Chase', today: '2026-10-28' });
    expect(accounts[0]).toMatchObject({ kind: 'credit_card', credit_limit_cents: 1000000, source: 'plaid' });
  });
});

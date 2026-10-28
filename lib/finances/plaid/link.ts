/**
 * Linking an institution through Plaid (plan #2593.3), with Plaid and the
 * database passed in so the rules can be tested without either.
 *
 * Four moves, each a server action on Finances settings:
 *
 *   startLink   a link token for a new Item, refused when the Trial plan's ten
 *               Items are spent.
 *   finishLink  exchanges the public token Link hands back, refuses an
 *               institution already linked, stores the access token encrypted
 *               and writes the Item's accounts with today's balance.
 *   startFix    a link token in update mode on an Item whose login has to be
 *               repeated: the same Item, so no slot is spent.
 *   finishFix   asks Plaid whether the Item still has an error and clears the
 *               link's needs_update when it has none. No exchange and no new
 *               row: update mode keeps the access token.
 *
 * A link row is never deleted: a removed Item does not give its slot back, so
 * the rows are what counts the slots used.
 */

/** What the person is linking. It picks the one product Link requires. */
export type LinkKind = 'bank' | 'brokerage' | 'loan';

/** Items the Trial plan allows, for the life of the Plaid team. */
export const TRIAL_ITEMS = 10;
/** From here the count of Items used is drawn amber. */
export const ITEMS_AMBER_AT = 8;

type Product = 'transactions' | 'investments' | 'liabilities';

/**
 * Plaid requires at least one product, and lists only institutions that
 * support every required one. So each kind requires the product it cannot do
 * without and asks for the other two as optional: an institution lacking one
 * still links, and one that has it gets it.
 */
export const KIND_PRODUCTS: Record<LinkKind, { products: Product[]; optional: Product[] }> = {
  bank: { products: ['transactions'], optional: ['liabilities', 'investments'] },
  brokerage: { products: ['investments'], optional: ['transactions', 'liabilities'] },
  loan: { products: ['liabilities'], optional: ['transactions', 'investments'] },
};

export type PlaidAccount = {
  account_id: string;
  name: string;
  official_name: string | null;
  mask: string | null;
  type: string;
  subtype: string | null;
  balances: {
    current: number | null;
    available: number | null;
    limit: number | null;
    iso_currency_code: string | null;
  };
};

/** The few Plaid calls linking makes. lib/finances/plaid/client.ts wraps the real one. */
export interface PlaidPort {
  createLinkToken(req: {
    userId: string;
    products?: Product[];
    optionalProducts?: Product[];
    accessToken?: string;
    webhook?: string;
    redirectUri?: string;
  }): Promise<string>;
  exchange(publicToken: string): Promise<{ accessToken: string; itemId: string }>;
  getItem(
    accessToken: string,
  ): Promise<{ institutionId: string | null; institutionName: string | null; errorCode: string | null; errorMessage: string | null }>;
  getAccounts(accessToken: string): Promise<PlaidAccount[]>;
  removeItem(accessToken: string): Promise<void>;
}

export type StoredLink = {
  id: string;
  plaid_item_id: string;
  institution_id: string | null;
  institution_name: string;
  status: string;
  needs_update: boolean;
  access_token: string;
};

export type AccountRow = {
  user_id: string;
  link_id: string;
  plaid_account_id: string;
  name: string;
  official_name: string | null;
  institution_name: string;
  mask: string | null;
  kind: AccountKind;
  source: 'plaid';
  currency: string;
  credit_limit_cents: number | null;
};

export type BalanceRow = {
  plaid_account_id: string;
  read_on: string;
  balance_cents: number;
  available_cents: number | null;
};

/** The database writes linking makes. lib/finances/plaid/store.ts writes them through the service role. */
export interface LinkStore {
  /** Every link of the person's, removed ones included: they still hold a slot. */
  listLinks(userId: string): Promise<StoredLink[]>;
  insertLink(row: {
    user_id: string;
    plaid_item_id: string;
    institution_id: string | null;
    institution_name: string;
    access_token: string;
  }): Promise<{ id: string }>;
  updateLink(
    userId: string,
    linkId: string,
    patch: { needs_update?: boolean; status?: 'active' | 'error'; last_error?: string | null },
  ): Promise<void>;
  /** Upserts on (user_id, plaid_account_id), then writes each balance for today. */
  saveAccounts(userId: string, accounts: AccountRow[], balances: BalanceRow[]): Promise<number>;
}

export type LinkDeps = {
  plaid: PlaidPort;
  store: LinkStore;
  encrypt: (plain: string) => string;
  decrypt: (cipher: string) => string;
  /** Today in the person's timezone, YYYY-MM-DD, for the first balance reading. */
  today: () => string;
};

export type Refusal = { ok: false; reason: string };

/** How many of the Trial plan's Items the person's links have spent. */
export function itemsUsed(links: readonly { status: string }[]): number {
  return links.length;
}

/** The live link already holding this institution, if any. */
export function linkedInstitution<T extends { institution_id: string | null; status: string }>(
  links: readonly T[],
  institutionId: string | null | undefined,
): T | undefined {
  if (!institutionId) return undefined;
  return links.find((l) => l.status !== 'removed' && l.institution_id === institutionId);
}

/** The sentence a second link to the same institution is refused with. */
export function duplicateReason(institutionName: string): string {
  return `${institutionName} is already linked. If its sign-in stopped working, use Fix sign-in on its row instead, which keeps the same link.`;
}

export const ITEMS_SPENT_REASON = `All ${TRIAL_ITEMS} links on Plaid's Trial plan are used, and a removed link does not give its slot back.`;

export async function startLink(
  deps: Pick<LinkDeps, 'plaid' | 'store'>,
  input: { userId: string; kind: LinkKind; webhook?: string; redirectUri?: string },
): Promise<{ ok: true; linkToken: string } | Refusal> {
  const links = await deps.store.listLinks(input.userId);
  if (itemsUsed(links) >= TRIAL_ITEMS) return { ok: false, reason: ITEMS_SPENT_REASON };
  const { products, optional } = KIND_PRODUCTS[input.kind];
  const linkToken = await deps.plaid.createLinkToken({
    userId: input.userId,
    products,
    optionalProducts: optional,
    webhook: input.webhook,
    redirectUri: input.redirectUri,
  });
  return { ok: true, linkToken };
}

export async function startFix(
  deps: Pick<LinkDeps, 'plaid' | 'store' | 'decrypt'>,
  input: { userId: string; linkId: string; redirectUri?: string },
): Promise<{ ok: true; linkToken: string } | Refusal> {
  const link = (await deps.store.listLinks(input.userId)).find((l) => l.id === input.linkId);
  if (!link || link.status === 'removed') return { ok: false, reason: 'That link is no longer here.' };
  // Update mode: the Item's own access token and no products, so Plaid
  // reopens the same Item rather than creating another.
  const linkToken = await deps.plaid.createLinkToken({
    userId: input.userId,
    accessToken: deps.decrypt(link.access_token),
    redirectUri: input.redirectUri,
  });
  return { ok: true, linkToken };
}

export async function finishLink(
  deps: LinkDeps,
  input: { userId: string; publicToken: string; institutionId?: string | null; institutionName?: string | null },
): Promise<{ ok: true; linkId: string; institutionName: string; accounts: number } | Refusal> {
  const links = await deps.store.listLinks(input.userId);

  // The page closes Link when the person picks a bank already linked, before
  // Plaid creates an Item. Reaching here with one anyway means the Item was
  // made: exchange it only to remove it, so it is not left billing.
  const { accessToken, itemId } = await deps.plaid.exchange(input.publicToken);
  const item = await deps.plaid.getItem(accessToken);
  const institutionId = item.institutionId ?? input.institutionId ?? null;
  const institutionName = (item.institutionName ?? input.institutionName ?? '').trim() || 'Your bank';

  const already = linkedInstitution(links, institutionId);
  if (already) {
    await deps.plaid.removeItem(accessToken).catch(() => undefined);
    return { ok: false, reason: duplicateReason(already.institution_name) };
  }

  const { id: linkId } = await deps.store.insertLink({
    user_id: input.userId,
    plaid_item_id: itemId,
    institution_id: institutionId,
    institution_name: institutionName.slice(0, 200),
    access_token: deps.encrypt(accessToken),
  });

  const plaidAccounts = await deps.plaid.getAccounts(accessToken);
  const { accounts, balances } = accountRows(plaidAccounts, {
    userId: input.userId,
    linkId,
    institutionName,
    today: deps.today(),
  });
  const saved = await deps.store.saveAccounts(input.userId, accounts, balances);
  return { ok: true, linkId, institutionName, accounts: saved };
}

export async function finishFix(
  deps: Pick<LinkDeps, 'plaid' | 'store' | 'decrypt'>,
  input: { userId: string; linkId: string },
): Promise<{ ok: true } | Refusal> {
  const link = (await deps.store.listLinks(input.userId)).find((l) => l.id === input.linkId);
  if (!link || link.status === 'removed') return { ok: false, reason: 'That link is no longer here.' };
  const item = await deps.plaid.getItem(deps.decrypt(link.access_token));
  if (item.errorCode) {
    await deps.store.updateLink(input.userId, link.id, {
      needs_update: true,
      last_error: item.errorMessage ?? item.errorCode,
    });
    return { ok: false, reason: item.errorMessage ?? `Plaid still reports ${item.errorCode}.` };
  }
  await deps.store.updateLink(input.userId, link.id, { needs_update: false, status: 'active', last_error: null });
  return { ok: true };
}

// ---------------------------------------------------------------------------
// Plaid's accounts as rows.
// ---------------------------------------------------------------------------

export type AccountKind = 'checking' | 'savings' | 'credit_card' | 'brokerage' | 'loan';

/** The finances kind for Plaid's type and subtype; null for one Finances does not hold. */
export function accountKind(type: string, subtype: string | null): AccountKind | null {
  switch (type) {
    case 'depository':
      return subtype === 'checking' || subtype === 'prepaid' || subtype === 'paypal' ? 'checking' : 'savings';
    case 'credit':
      return 'credit_card';
    case 'investment':
    case 'brokerage':
      return 'brokerage';
    case 'loan':
      return 'loan';
    default:
      return null;
  }
}

/** Dollars as Plaid sends them to integer cents. */
export function toCents(amount: number | null | undefined): number | null {
  return amount == null ? null : Math.round(amount * 100);
}

const MASK = /^[0-9A-Za-z]{1,8}$/;

export function accountRows(
  plaidAccounts: readonly PlaidAccount[],
  ctx: { userId: string; linkId: string; institutionName: string; today: string },
): { accounts: AccountRow[]; balances: BalanceRow[] } {
  const accounts: AccountRow[] = [];
  const balances: BalanceRow[] = [];
  for (const a of plaidAccounts) {
    const kind = accountKind(a.type, a.subtype);
    if (!kind) continue;
    const currency = (a.balances.iso_currency_code ?? 'USD').toUpperCase();
    accounts.push({
      user_id: ctx.userId,
      link_id: ctx.linkId,
      plaid_account_id: a.account_id,
      name: (a.name.trim() || a.official_name?.trim() || 'Account').slice(0, 200),
      official_name: a.official_name,
      institution_name: ctx.institutionName,
      mask: a.mask && MASK.test(a.mask) ? a.mask : null,
      kind,
      source: 'plaid',
      currency: /^[A-Z]{3}$/.test(currency) ? currency : 'USD',
      credit_limit_cents: kind === 'credit_card' ? toCents(a.balances.limit) : null,
    });
    // For a card or a loan Plaid's current balance is what is owed, positive,
    // which is the sign balance_readings keeps.
    const current = toCents(a.balances.current);
    if (current != null) {
      balances.push({
        plaid_account_id: a.account_id,
        read_on: ctx.today,
        balance_cents: current,
        available_cents: toCents(a.balances.available),
      });
    }
  }
  return { accounts, balances };
}

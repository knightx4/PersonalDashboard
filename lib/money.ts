/**
 * All money math. Every figure the dashboard shows comes from here.
 *
 * Three rules, and they are not negotiable:
 *
 *   1. Integer cents everywhere. Never a float, never inline arithmetic in a
 *      component. Formatting to a display string happens only at the edge, via
 *      formatMoney().
 *   2. Spend is money actually out, net of refunds, and a refund lands in the
 *      period it was refunded -- not the period of the original order. A
 *      refund in March must never rewrite a January total the user already
 *      looked at.
 *   3. Category and inventory figures use a different base (what the stuff you
 *      currently own cost) and are not supposed to tie out against spend.
 *      Label them differently in the UI.
 */

/** ISO 4217. Kept as a nominal-ish alias so mixed-currency math is visible. */
export type CurrencyCode = string;

export interface Money {
  cents: number;
  currency: CurrencyCode;
}

export function money(cents: number, currency: CurrencyCode = 'USD'): Money {
  assertIntegerCents(cents);
  return { cents, currency };
}

export function assertIntegerCents(value: number): asserts value is number {
  if (!Number.isInteger(value)) {
    throw new TypeError(
      `money must be integer cents, got ${value}. Round at the boundary, not here.`,
    );
  }
}

/**
 * Format for display. The only place cents become a string.
 *
 * Uses tabular figures at the CSS level (see globals.css); this just produces
 * the text.
 */
export function formatMoney(
  cents: number,
  currency: CurrencyCode = 'USD',
  options: { showCents?: boolean; locale?: string } = {},
): string {
  const { showCents = true, locale = 'en-US' } = options;
  return new Intl.NumberFormat(locale, {
    style: 'currency',
    currency,
    minimumFractionDigits: showCents ? 2 : 0,
    maximumFractionDigits: showCents ? 2 : 0,
  }).format(cents / 100);
}

/**
 * Parse a dollars string from a form into integer cents.
 *
 * Accepts "12", "12.3", "12.99", "$12.99", "1,299.00". Rejects more than two
 * decimal places -- round at the keyboard, not here. Empty / whitespace is 0
 * so optional tax/shipping fields can be left blank.
 *
 * Integer arithmetic only: never `parseFloat * 100`.
 */
export function parseDollarsToCents(input: string): number {
  const trimmed = input.trim();
  if (trimmed === '') return 0;

  const normalized = trimmed.replace(/[$,\s]/g, '');
  const match = normalized.match(/^(-?)(\d+)(?:\.(\d{0,2}))?$/);
  if (!match) {
    throw new TypeError(
      `expected a dollar amount with at most two decimals, got "${input}"`,
    );
  }

  const sign = match[1] === '-' ? -1 : 1;
  const dollars = Number.parseInt(match[2], 10);
  const fraction = (match[3] ?? '').padEnd(2, '0');
  const cents = dollars * 100 + Number.parseInt(fraction || '0', 10);
  return sign * cents;
}

/** Inverse of parseDollarsToCents for prefilling edit forms. */
export function formatCentsAsDollarsInput(cents: number): string {
  assertIntegerCents(cents);
  const sign = cents < 0 ? '-' : '';
  const abs = Math.abs(cents);
  const dollars = Math.floor(abs / 100);
  const fraction = String(abs % 100).padStart(2, '0');
  return `${sign}${dollars}.${fraction}`;
}

/** Line extension: quantity × unit price, both integers. */
export function lineSubtotalCents(quantity: number, unitPriceCents: number): number {
  if (!Number.isInteger(quantity) || quantity < 0) {
    throw new RangeError(`quantity must be a non-negative integer, got ${quantity}`);
  }
  assertIntegerCents(unitPriceCents);
  return quantity * unitPriceCents;
}

/** Sum of line extensions. */
export function orderSubtotalCents(
  lines: readonly { quantity: number; unitPriceCents: number }[],
): number {
  return lines.reduce(
    (sum, line) => sum + lineSubtotalCents(line.quantity, line.unitPriceCents),
    0,
  );
}

/** subtotal + tax + shipping - discount. The canonical order total. */
export function computeOrderTotalCents(parts: {
  subtotalCents: number;
  taxCents: number;
  shippingCents: number;
  discountCents: number;
}): number {
  assertIntegerCents(parts.subtotalCents);
  assertIntegerCents(parts.taxCents);
  assertIntegerCents(parts.shippingCents);
  assertIntegerCents(parts.discountCents);
  return parts.subtotalCents + parts.taxCents + parts.shippingCents - parts.discountCents;
}

/** Signed delta as a percentage, or null when the baseline is zero. */
export function percentChange(current: number, previous: number): number | null {
  if (previous === 0) return null;
  return ((current - previous) / Math.abs(previous)) * 100;
}

/**
 * Display form of percentChange for the dashboard delta line.
 * Returns null when there is no comparable baseline (caller renders an em dash).
 */
export function formatPercentChange(change: number | null): string | null {
  if (change === null) return null;
  const rounded = Math.round(change);
  if (rounded === 0) return '0%';
  const sign = rounded > 0 ? '+' : '−';
  return `${sign}${Math.abs(rounded)}%`;
}

// ---------------------------------------------------------------------------
// Landed cost allocation
// ---------------------------------------------------------------------------

export interface OrderTotals {
  subtotalCents: number;
  taxCents: number;
  shippingCents: number;
  discountCents: number;
  totalCents: number;
}

export interface AllocatableLine {
  /** Stable identifier for the order_items row. */
  id: string;
  quantity: number;
  unitPriceCents: number;
}

export interface AllocatedUnit {
  orderItemId: string;
  /** 0-based index of this physical unit within its line. */
  unitIndex: number;
  costCents: number;
}

/**
 * Split an order's total across one row per physical unit.
 *
 * Allocation is proportional to line subtotal, NOT even across units. A $400
 * coat and a $6 pair of socks in the same order do not carry equal shipping,
 * and even splitting is what gets built if this is left unstated.
 *
 *   share = unitPrice / orderSubtotal
 *   cost  = unitPrice
 *         + round(share * tax)
 *         + round(share * shipping)
 *         - round(share * discount)
 *
 * The rounding remainder is assigned to the highest-priced unit so the sum of
 * every unit's cost equals totalCents exactly. If per-item costs don't sum to
 * the order total, every category and inventory figure in the app is quietly
 * off, so this is asserted in tests.
 *
 * Degenerate orders (zero subtotal, e.g. a 100% discount or a gift) fall back
 * to an even split, since a proportional share of zero is undefined.
 */
export function allocateLandedCost(
  lines: readonly AllocatableLine[],
  totals: OrderTotals,
): AllocatedUnit[] {
  for (const line of lines) {
    assertIntegerCents(line.unitPriceCents);
    if (!Number.isInteger(line.quantity) || line.quantity < 1) {
      throw new RangeError(`quantity must be a positive integer, got ${line.quantity}`);
    }
  }
  assertIntegerCents(totals.totalCents);

  const units: { orderItemId: string; unitIndex: number; unitPriceCents: number }[] = [];
  for (const line of lines) {
    for (let i = 0; i < line.quantity; i++) {
      units.push({ orderItemId: line.id, unitIndex: i, unitPriceCents: line.unitPriceCents });
    }
  }

  if (units.length === 0) return [];

  const basis = units.reduce((sum, u) => sum + u.unitPriceCents, 0);

  const allocated: AllocatedUnit[] = units.map((unit) => {
    if (basis === 0) {
      // No price signal to weight by; even split is the only defensible answer.
      return {
        orderItemId: unit.orderItemId,
        unitIndex: unit.unitIndex,
        costCents: Math.round(totals.totalCents / units.length),
      };
    }
    const share = unit.unitPriceCents / basis;
    const cost =
      unit.unitPriceCents +
      Math.round(share * totals.taxCents) +
      Math.round(share * totals.shippingCents) -
      Math.round(share * totals.discountCents);
    return { orderItemId: unit.orderItemId, unitIndex: unit.unitIndex, costCents: cost };
  });

  // Push the rounding remainder onto the highest-priced unit so the sum is
  // exact. Highest-priced absorbs it because a cent on a $400 coat is
  // invisible and a cent on a $0.50 line is not.
  const sum = allocated.reduce((acc, u) => acc + u.costCents, 0);
  const remainder = totals.totalCents - sum;
  if (remainder !== 0) {
    let target = 0;
    for (let i = 1; i < units.length; i++) {
      if (units[i].unitPriceCents > units[target].unitPriceCents) target = i;
    }
    allocated[target].costCents += remainder;
  }

  return allocated;
}

/**
 * The extractor's arithmetic gate.
 *
 * This is the single most valuable check in the ingestion pipeline, because it
 * is deterministic: an extraction that hallucinated or dropped a line item
 * almost never reconciles. It outranks the model's self-reported confidence,
 * which clusters high regardless of correctness and must never override a
 * failed reconciliation.
 */
export function reconcilesToTotal(
  lines: readonly AllocatableLine[],
  totals: OrderTotals,
  toleranceCents = 2,
): boolean {
  const lineSum = lines.reduce((sum, l) => sum + l.quantity * l.unitPriceCents, 0);
  const expected = lineSum + totals.taxCents + totals.shippingCents - totals.discountCents;
  return Math.abs(expected - totals.totalCents) <= toleranceCents;
}

// ---------------------------------------------------------------------------
// Spend
// ---------------------------------------------------------------------------

export interface Period {
  /** Inclusive, YYYY-MM-DD in the user's timezone. */
  start: string;
  /** Inclusive, YYYY-MM-DD in the user's timezone. */
  end: string;
}

export interface SpendOrder {
  orderDate: string;
  totalCents: number;
  cancelled: boolean;
}

export interface SpendRefund {
  /** Null until the refund actually lands. */
  refundedAt: string | null;
  refundAmountCents: number;
  refunded: boolean;
}

export interface SpendBreakdown {
  /** Orders placed in the period, excluding cancelled ones. */
  grossCents: number;
  /** Refunds that landed in the period, whenever the order was placed. */
  refundedCents: number;
  /** grossCents - refundedCents. The headline number. */
  netCents: number;
}

function withinPeriod(date: string, period: Period): boolean {
  return date >= period.start && date <= period.end;
}

/**
 * spend(period) = orders placed in the period, less refunds *received* in the
 * period.
 *
 * The refund is subtracted in the period it was refunded, deliberately. The
 * alternative -- crediting it back to the original order's month -- means a
 * refund in March silently rewrites your January total, and trust in the
 * dashboard dies the first time a user notices a number they already read
 * has changed.
 *
 * It also uses the amount actually refunded, not the item's original price:
 * merchants routinely withhold original shipping or charge restocking fees, so
 * subtracting the sticker price overstates recovery and understates spend.
 */
export function spend(
  orders: readonly SpendOrder[],
  refunds: readonly SpendRefund[],
  period: Period,
): SpendBreakdown {
  const grossCents = orders
    .filter((o) => !o.cancelled && withinPeriod(o.orderDate, period))
    .reduce((sum, o) => sum + o.totalCents, 0);

  const refundedCents = refunds
    .filter((r) => r.refunded && r.refundedAt !== null && withinPeriod(r.refundedAt, period))
    .reduce((sum, r) => sum + r.refundAmountCents, 0);

  return { grossCents, refundedCents, netCents: grossCents - refundedCents };
}

/**
 * "$X gross, less $Y refunded" -- the reconciliation line that goes under the
 * headline number. Costs one line and makes an otherwise unexplainable figure
 * auditable by the person looking at it.
 */
export function formatReconciliation(
  breakdown: SpendBreakdown,
  currency: CurrencyCode = 'USD',
): string {
  const gross = formatMoney(breakdown.grossCents, currency);
  if (breakdown.refundedCents === 0) return `${gross} gross`;
  return `${gross} gross, less ${formatMoney(breakdown.refundedCents, currency)} refunded`;
}

/**
 * Value of items currently owned. A DIFFERENT base from spend() on purpose:
 * the question here is "what did the stuff I have cost me", not "what did I
 * spend this month". These two figures will not tie out, and the UI must label
 * them differently so the discrepancy reads as intentional.
 */
export function valueOwned(
  items: readonly { costCents: number; status: string }[],
): number {
  return items
    .filter((i) => i.status === 'owned')
    .reduce((sum, i) => sum + i.costCents, 0);
}

// ---------------------------------------------------------------------------
// Period breakdowns (where spend went)
// ---------------------------------------------------------------------------

export interface CategorySpendSlice {
  categoryId: string | null;
  name: string;
  color: string;
  cents: number;
}

export interface CategorizedUnit {
  /** YYYY-MM-DD of the parent order. */
  orderDate: string;
  cancelled: boolean;
  /** Landed cost for this unit -- from allocateLandedCost. */
  costCents: number;
  categoryId: string | null;
  categoryName: string | null;
  categoryColor: string | null;
}

const UNCATEGORIZED: Omit<CategorySpendSlice, 'cents'> = {
  categoryId: null,
  name: 'Uncategorized',
  color: '#9a9a94',
};

/**
 * Landed cost of units from orders placed in the period, grouped by category.
 *
 * This answers "where did the money go", not "what do I still own". It uses
 * order-date filtering (same as spend gross) and landed costs so tax/shipping
 * are included. Refunds are intentionally absent -- they belong on the
 * headline via spend(), not redistributed across categories after the fact.
 */
export function spendByCategory(
  units: readonly CategorizedUnit[],
  period: Period,
): CategorySpendSlice[] {
  const totals = new Map<string, CategorySpendSlice>();

  for (const unit of units) {
    if (unit.cancelled || !withinPeriod(unit.orderDate, period)) continue;
    assertIntegerCents(unit.costCents);

    const key = unit.categoryId ?? '__uncategorized__';
    const existing = totals.get(key);
    if (existing) {
      existing.cents += unit.costCents;
      continue;
    }
    totals.set(key, {
      categoryId: unit.categoryId,
      name: unit.categoryName ?? UNCATEGORIZED.name,
      color: unit.categoryColor ?? UNCATEGORIZED.color,
      cents: unit.costCents,
    });
  }

  return [...totals.values()].sort(
    (a, b) => b.cents - a.cents || a.name.localeCompare(b.name),
  );
}

export interface MerchantSpendSlice {
  merchantId: string | null;
  name: string;
  cents: number;
}

export interface MerchantSpendOrder {
  orderDate: string;
  totalCents: number;
  cancelled: boolean;
  merchantId: string | null;
  merchantName: string | null;
}

/**
 * Gross order totals placed in the period, grouped by merchant.
 * Same order-date / cancelled rules as spend() gross.
 */
export function spendByMerchant(
  orders: readonly MerchantSpendOrder[],
  period: Period,
): MerchantSpendSlice[] {
  const totals = new Map<string, MerchantSpendSlice>();

  for (const order of orders) {
    if (order.cancelled || !withinPeriod(order.orderDate, period)) continue;
    assertIntegerCents(order.totalCents);

    const key = order.merchantId ?? '__unknown__';
    const existing = totals.get(key);
    if (existing) {
      existing.cents += order.totalCents;
      continue;
    }
    totals.set(key, {
      merchantId: order.merchantId,
      name: order.merchantName ?? 'Unknown merchant',
      cents: order.totalCents,
    });
  }

  return [...totals.values()].sort(
    (a, b) => b.cents - a.cents || a.name.localeCompare(b.name),
  );
}

// ---------------------------------------------------------------------------
// Period boundaries
// ---------------------------------------------------------------------------

/**
 * Period boundaries in the user's timezone, not the server's. "This month"
 * must mean their month -- a user in Auckland looking at a UTC month boundary
 * sees the wrong orders for most of a day, twice a month.
 */
export function todayInTimezone(timezone: string, now: Date = new Date()): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: timezone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(now);
}

export type PresetRange =
  | 'this_month'
  | 'last_month'
  | 'last_3_months'
  | 'ytd'
  | 'last_12_months';

function ymd(year: number, month: number, day: number): string {
  return `${String(year).padStart(4, '0')}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}

function lastDayOfMonth(year: number, month: number): number {
  return new Date(Date.UTC(year, month, 0)).getUTCDate();
}

export function periodFor(
  preset: PresetRange,
  timezone: string,
  now: Date = new Date(),
): Period {
  const today = todayInTimezone(timezone, now);
  const [y, m, d] = today.split('-').map(Number);

  switch (preset) {
    case 'this_month':
      return { start: ymd(y, m, 1), end: ymd(y, m, lastDayOfMonth(y, m)) };
    case 'last_month': {
      const year = m === 1 ? y - 1 : y;
      const month = m === 1 ? 12 : m - 1;
      return { start: ymd(year, month, 1), end: ymd(year, month, lastDayOfMonth(year, month)) };
    }
    case 'last_3_months': {
      // The two full months before this one, plus this one so far.
      const total = y * 12 + (m - 1) - 2;
      const year = Math.floor(total / 12);
      const month = (total % 12) + 1;
      return { start: ymd(year, month, 1), end: ymd(y, m, d) };
    }
    case 'ytd':
      return { start: ymd(y, 1, 1), end: ymd(y, m, d) };
    case 'last_12_months': {
      const total = y * 12 + (m - 1) - 11;
      const year = Math.floor(total / 12);
      const month = (total % 12) + 1;
      return { start: ymd(year, month, 1), end: ymd(y, m, d) };
    }
  }
}

/**
 * The comparable window immediately before `periodFor(preset)`.
 *
 * Calendar presets compare against the prior calendar month / prior year-to-date
 * span. Rolling presets shift back by the same number of months so the
 * dashboard delta is apples-to-apples.
 */
export function previousPeriodFor(
  preset: PresetRange,
  timezone: string,
  now: Date = new Date(),
): Period {
  const today = todayInTimezone(timezone, now);
  const [y, m, d] = today.split('-').map(Number);

  switch (preset) {
    case 'this_month':
      return periodFor('last_month', timezone, now);
    case 'last_month': {
      const total = y * 12 + (m - 1) - 2;
      const year = Math.floor(total / 12);
      const month = (total % 12) + 1;
      return {
        start: ymd(year, month, 1),
        end: ymd(year, month, lastDayOfMonth(year, month)),
      };
    }
    case 'last_3_months': {
      // Current window starts two months back; previous is the three months
      // before that, ending on the last day of the month before current start.
      const curStart = y * 12 + (m - 1) - 2;
      const prevStart = curStart - 3;
      const prevEnd = curStart - 1;
      const startYear = Math.floor(prevStart / 12);
      const startMonth = (prevStart % 12) + 1;
      const endYear = Math.floor(prevEnd / 12);
      const endMonth = (prevEnd % 12) + 1;
      return {
        start: ymd(startYear, startMonth, 1),
        end: ymd(endYear, endMonth, lastDayOfMonth(endYear, endMonth)),
      };
    }
    case 'ytd': {
      const endDay = Math.min(d, lastDayOfMonth(y - 1, m));
      return { start: ymd(y - 1, 1, 1), end: ymd(y - 1, m, endDay) };
    }
    case 'last_12_months': {
      const curStart = y * 12 + (m - 1) - 11;
      const prevStart = curStart - 12;
      const startYear = Math.floor(prevStart / 12);
      const startMonth = (prevStart % 12) + 1;
      const endDay = Math.min(d, lastDayOfMonth(y - 1, m));
      return {
        start: ymd(startYear, startMonth, 1),
        end: ymd(y - 1, m, endDay),
      };
    }
  }
}

/** Human label for a preset, shared by the rail and the delta copy. */
export function labelForPreset(preset: PresetRange): string {
  switch (preset) {
    case 'this_month':
      return 'This month';
    case 'last_month':
      return 'Last month';
    case 'last_3_months':
      return 'Last 3 months';
    case 'ytd':
      return 'Year to date';
    case 'last_12_months':
      return 'Last 12 months';
  }
}

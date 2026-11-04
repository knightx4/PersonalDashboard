/**
 * Reading the statement file Wallet exports for Apple Card (plan #2593.5).
 *
 * Plaid has no Apple Card connection, so each month the person exports the
 * statement from Wallet (Apple Card, Card Balance, the month, Export
 * Transactions) as CSV or OFX and imports it here. This turns either file into
 * statement lines in the finances sign rule, money in positive and money out
 * negative, each with the fingerprint that keeps a month imported twice from
 * being counted twice (transactions_account_fingerprint_key).
 *
 * Pure: no database, so the rules are tested on the files themselves.
 *
 * The two formats:
 *
 *   CSV  Transaction Date, Clearing Date, Description, Merchant, Category,
 *        Type, Amount (USD), Purchased By. Dates are MM/DD/YYYY. A purchase
 *        is a positive amount and a payment or credit a negative one, so the
 *        sign is flipped. The file carries no balance.
 *
 *   OFX  A credit card statement (CCSTMTRS) with STMTTRN lines and a
 *        LEDGERBAL. Amounts are already from the cardholder's side, a charge
 *        negative, and the ledger balance is negative while money is owed.
 *
 * The fingerprint is the same for a line whichever format it came in, as far
 * as the two agree: the posted day, the amount, the first characters of the
 * description, and the line's place among identical lines in the file.
 */

export type StatementLine = {
  postedOn: string;
  authorizedOn: string | null;
  description: string;
  merchant: string | null;
  /** A Plaid primary category where Apple's maps onto one, else Apple's own word. */
  category: string | null;
  categoryDetail: string | null;
  /** Positive for money onto the card (a payment, a refund), negative for a charge. */
  amountCents: number;
  fingerprint: string;
};

export type WalletStatement = {
  format: 'csv' | 'ofx';
  lines: StatementLine[];
  /** The amount owed at the close, positive; null when the file carries none (CSV). */
  closingBalanceCents: number | null;
  /** The day the statement closes. */
  closingOn: string | null;
  /** The first and last posted days among the lines. */
  from: string | null;
  to: string | null;
};

export type WalletParse = { ok: true; statement: WalletStatement } | { ok: false; error: string };

/** What the error names as expected, so a wrong file says what a right one is. */
export const WALLET_EXPECTED =
  'Wallet exports it as a CSV with Transaction Date, Clearing Date, Description and Amount (USD) columns, or as an OFX card statement.';

/** Largest file read, in characters: a year of daily charges is well under this. */
export const WALLET_MAX_CHARS = 800_000;

const CSV_COLUMNS = {
  transactionDate: 'transaction date',
  clearingDate: 'clearing date',
  description: 'description',
  merchant: 'merchant',
  category: 'category',
  type: 'type',
  amount: 'amount (usd)',
} as const;

/**
 * Apple's categories onto Plaid's primary ones, so Spending groups an Apple
 * Card charge with the same charge on a Chase card. A category not listed
 * keeps Apple's word, which Spending shows as written.
 */
const APPLE_CATEGORIES: Record<string, [string, string | null]> = {
  restaurants: ['FOOD_AND_DRINK', 'FOOD_AND_DRINK_RESTAURANT'],
  alcohol: ['FOOD_AND_DRINK', 'FOOD_AND_DRINK_BEER_WINE_AND_LIQUOR'],
  grocery: ['FOOD_AND_DRINK', 'FOOD_AND_DRINK_GROCERIES'],
  groceries: ['FOOD_AND_DRINK', 'FOOD_AND_DRINK_GROCERIES'],
  gas: ['TRANSPORTATION', 'TRANSPORTATION_GAS'],
  transportation: ['TRANSPORTATION', null],
  travel: ['TRAVEL', null],
  airlines: ['TRAVEL', 'TRAVEL_FLIGHTS'],
  hotels: ['TRAVEL', 'TRAVEL_LODGING'],
  shopping: ['GENERAL_MERCHANDISE', null],
  entertainment: ['ENTERTAINMENT', null],
  health: ['MEDICAL', null],
  medical: ['MEDICAL', null],
  utilities: ['RENT_AND_UTILITIES', null],
};

/** A card payment, as Plaid marks one, so Spending pairs it with the bank's half. */
const PAYMENT: [string, string] = ['LOAN_PAYMENTS', 'LOAN_PAYMENTS_CREDIT_CARD_PAYMENT'];
const INTEREST: [string, string] = ['BANK_FEES', 'BANK_FEES_INTEREST_CHARGE'];

function categorize(
  appleCategory: string | null,
  type: string | null,
): { category: string | null; categoryDetail: string | null } {
  const t = (type ?? '').trim().toLowerCase();
  const c = (appleCategory ?? '').trim();
  if (t === 'payment' || c.toLowerCase() === 'payment')
    return { category: PAYMENT[0], categoryDetail: PAYMENT[1] };
  if (t === 'interest' || c.toLowerCase() === 'interest')
    return { category: INTEREST[0], categoryDetail: INTEREST[1] };
  const mapped = APPLE_CATEGORIES[c.toLowerCase()];
  if (mapped) return { category: mapped[0], categoryDetail: mapped[1] };
  return { category: c || null, categoryDetail: null };
}

/** "-1,234.567" as cents, rounded half away from zero; null when it is not a number. */
export function toCents(raw: string): number | null {
  const s = raw.trim().replace(/[$,\s]/g, '');
  const m = /^([+-]?)(\d*)(?:\.(\d*))?$/.exec(s);
  if (!m || (m[2] === '' && !m[3])) return null;
  const whole = Number(m[2] || '0');
  const frac = (m[3] ?? '').padEnd(3, '0').slice(0, 3);
  const cents = whole * 100 + Math.round(Number(frac) / 10);
  return m[1] === '-' ? -cents : cents;
}

/** MM/DD/YYYY (or M/D/YY) as YYYY-MM-DD; null when it is not a day. */
function usDay(raw: string | undefined): string | null {
  const m = /^\s*(\d{1,2})\/(\d{1,2})\/(\d{2}|\d{4})\s*$/.exec(raw ?? '');
  if (!m) return null;
  const year = m[3].length === 2 ? 2000 + Number(m[3]) : Number(m[3]);
  return validDay(year, Number(m[1]), Number(m[2]));
}

/** OFX's YYYYMMDD[HHMMSS[.XXX]][TZ] as YYYY-MM-DD. */
function ofxDay(raw: string | undefined): string | null {
  const m = /^\s*(\d{4})(\d{2})(\d{2})/.exec(raw ?? '');
  if (!m) return null;
  return validDay(Number(m[1]), Number(m[2]), Number(m[3]));
}

function validDay(year: number, month: number, day: number): string | null {
  const date = new Date(Date.UTC(year, month - 1, day));
  if (
    date.getUTCFullYear() !== year ||
    date.getUTCMonth() !== month - 1 ||
    date.getUTCDate() !== day
  )
    return null;
  return date.toISOString().slice(0, 10);
}

/** The last day of the month `day` falls in. */
export function monthEnd(day: string): string {
  const [y, m] = day.split('-').map(Number);
  return new Date(Date.UTC(y, m, 0)).toISOString().slice(0, 10);
}

/** The part of a description the fingerprint keys on: letters and digits, upper case, 24 at most. */
function descriptionKey(description: string): string {
  return description
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, '')
    .slice(0, 24);
}

type Unkeyed = Omit<StatementLine, 'fingerprint'>;

/** Gives each line its fingerprint, numbering identical lines in file order. */
function withFingerprints(lines: Unkeyed[]): StatementLine[] {
  const seen = new Map<string, number>();
  return lines.map((line) => {
    const base = `wallet:${line.postedOn}:${line.amountCents}:${descriptionKey(line.description)}`;
    const n = seen.get(base) ?? 0;
    seen.set(base, n + 1);
    return { ...line, fingerprint: `${base}:${n}` };
  });
}

function span(lines: readonly StatementLine[]): { from: string | null; to: string | null } {
  let from: string | null = null;
  let to: string | null = null;
  for (const l of lines) {
    if (from === null || l.postedOn < from) from = l.postedOn;
    if (to === null || l.postedOn > to) to = l.postedOn;
  }
  return { from, to };
}

/** One CSV record per row, honouring quotes, doubled quotes and newlines inside quotes. */
export function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = '';
  let quoted = false;
  for (let i = 0; i < text.length; i += 1) {
    const ch = text[i];
    if (quoted) {
      if (ch === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i += 1;
        } else quoted = false;
      } else field += ch;
    } else if (ch === '"') quoted = true;
    else if (ch === ',') {
      row.push(field);
      field = '';
    } else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && text[i + 1] === '\n') i += 1;
      row.push(field);
      rows.push(row);
      row = [];
      field = '';
    } else field += ch;
  }
  if (field !== '' || row.length > 0) {
    row.push(field);
    rows.push(row);
  }
  return rows.filter((r) => r.some((cell) => cell.trim() !== ''));
}

function parseWalletCsv(text: string): WalletParse {
  const rows = parseCsv(text);
  if (rows.length === 0) return { ok: false, error: `The file is empty. ${WALLET_EXPECTED}` };
  const header = rows[0].map((h) => h.trim().toLowerCase());
  const col = Object.fromEntries(
    Object.entries(CSV_COLUMNS).map(([key, name]) => [key, header.indexOf(name)]),
  ) as Record<keyof typeof CSV_COLUMNS, number>;
  const required = ['transactionDate', 'clearingDate', 'description', 'amount'] as const;
  // The columns Wallet's CSV needs are named once, in WALLET_EXPECTED.
  if (required.some((key) => col[key] < 0))
    return { ok: false, error: `It is not an Apple Card export. ${WALLET_EXPECTED}` };

  const cell = (row: string[], index: number) => (index >= 0 ? (row[index] ?? '').trim() : '');
  const lines: Unkeyed[] = [];
  for (let r = 1; r < rows.length; r += 1) {
    const row = rows[r];
    const authorizedOn = usDay(cell(row, col.transactionDate));
    const postedOn = usDay(cell(row, col.clearingDate)) ?? authorizedOn;
    const charged = toCents(cell(row, col.amount));
    const description = cell(row, col.description) || cell(row, col.merchant);
    if (!postedOn || charged === null || !description)
      return {
        ok: false,
        error: `Line ${r + 1} of the file could not be read: it needs a date, a description and an amount. ${WALLET_EXPECTED}`,
      };
    if (charged === 0) continue;
    lines.push({
      postedOn,
      authorizedOn,
      description,
      merchant: cell(row, col.merchant) || null,
      ...categorize(cell(row, col.category) || null, cell(row, col.type) || null),
      // Apple writes a purchase as a positive amount; money out is negative here.
      amountCents: -charged,
    });
  }
  const keyed = withFingerprints(lines);
  // The statement closes at the end of the month its purchases were made in.
  const lastMade = keyed.reduce<string | null>((max, l) => {
    const d = l.authorizedOn ?? l.postedOn;
    return max === null || d > max ? d : max;
  }, null);
  return {
    ok: true,
    statement: {
      format: 'csv',
      lines: keyed,
      closingBalanceCents: null,
      closingOn: lastMade ? monthEnd(lastMade) : null,
      ...span(keyed),
    },
  };
}

/** The value of `<TAG>value` in an OFX block, closed by `</TAG>`, the next tag or a line end. */
function ofxValue(block: string, tag: string): string | undefined {
  const m = new RegExp(`<${tag}>([^<\\r\\n]*)`, 'i').exec(block);
  const value = m?.[1].trim();
  return value ? decodeEntities(value) : undefined;
}

function decodeEntities(s: string): string {
  return s
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, '&');
}

function parseWalletOfx(text: string): WalletParse {
  if (!/<CCSTMTRS>/i.test(text)) {
    const bank = /<STMTRS>/i.test(text);
    return {
      ok: false,
      error: bank
        ? `This OFX file is a bank account statement, not a credit card one. ${WALLET_EXPECTED}`
        : `This OFX file holds no credit card statement. ${WALLET_EXPECTED}`,
    };
  }
  const blocks = text
    .split(/<STMTTRN>/i)
    .slice(1)
    .map((b) => b.split(/<\/STMTTRN>|<\/BANKTRANLIST>/i)[0]);
  const lines: Unkeyed[] = [];
  for (const [index, block] of blocks.entries()) {
    const postedOn = ofxDay(ofxValue(block, 'DTPOSTED'));
    const amount = toCents(ofxValue(block, 'TRNAMT') ?? '');
    const name = ofxValue(block, 'NAME');
    const memo = ofxValue(block, 'MEMO');
    const description = name ?? memo;
    if (!postedOn || amount === null || !description)
      return {
        ok: false,
        error: `Transaction ${index + 1} in the file could not be read: it needs DTPOSTED, TRNAMT and NAME. ${WALLET_EXPECTED}`,
      };
    if (amount === 0) continue;
    const type = (ofxValue(block, 'TRNTYPE') ?? '').toUpperCase();
    const payment = type === 'PAYMENT' || (amount > 0 && /\bPAYMENT\b/i.test(description));
    lines.push({
      postedOn,
      authorizedOn: ofxDay(ofxValue(block, 'DTUSER')),
      description,
      merchant: null,
      ...(payment
        ? { category: PAYMENT[0], categoryDetail: PAYMENT[1] }
        : type === 'INT'
          ? { category: INTEREST[0], categoryDetail: INTEREST[1] }
          : { category: null, categoryDetail: null }),
      amountCents: amount,
    });
  }
  const keyed = withFingerprints(lines);
  const ledger =
    /<LEDGERBAL>([\s\S]*?)(?:<\/LEDGERBAL>|<AVAILBAL>|<\/CCSTMTRS>|$)/i.exec(text)?.[1] ?? '';
  const balance = toCents(ofxValue(ledger, 'BALAMT') ?? '');
  const asOf = ofxDay(ofxValue(ledger, 'DTASOF'));
  const dtEnd = ofxDay(ofxValue(text, 'DTEND'));
  const range = span(keyed);
  return {
    ok: true,
    statement: {
      format: 'ofx',
      lines: keyed,
      // Negative while owed; the finances rule stores what is owed as positive.
      closingBalanceCents: balance === null ? null : -balance,
      closingOn: asOf ?? dtEnd ?? range.to,
      ...range,
    },
  };
}

/** Reads a Wallet export, telling CSV from OFX by what the file holds rather than its name. */
export function parseWalletExport(text: string): WalletParse {
  const body = text.replace(/^﻿/, '');
  if (body.length > WALLET_MAX_CHARS)
    return {
      ok: false,
      error: `The file is too large for a month's statement. ${WALLET_EXPECTED}`,
    };
  if (body.trim() === '') return { ok: false, error: `The file is empty. ${WALLET_EXPECTED}` };
  if (/OFXHEADER|<OFX>/i.test(body.slice(0, 4000))) return parseWalletOfx(body);
  if (/^\s*</.test(body))
    return { ok: false, error: `This file is not a Wallet export. ${WALLET_EXPECTED}` };
  return parseWalletCsv(body);
}

/**
 * The closing balance a CSV implies, from the balance at the end of the
 * statement before it: what was owed then, plus the month's charges, less
 * its payments and refunds. Null with no earlier balance to start from.
 */
export function impliedClosingBalance(
  lines: readonly Pick<StatementLine, 'amountCents'>[],
  openingOwedCents: number | null,
): number | null {
  if (openingOwedCents === null) return null;
  return lines.reduce((owed, l) => owed - l.amountCents, openingOwedCents);
}

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  impliedClosingBalance,
  parseCsv,
  parseWalletExport,
  toCents,
  WALLET_EXPECTED,
} from './wallet';

const fixture = (name: string) => readFileSync(join(__dirname, 'fixtures', name), 'utf8');

function parsed(text: string) {
  const result = parseWalletExport(text);
  if (!result.ok) throw new Error(result.error);
  return result.statement;
}

describe('a CSV from Wallet', () => {
  const statement = parsed(fixture('apple-card-2026-09.csv'));

  it('reads every line but the zero adjustment, charges out and payments in', () => {
    expect(statement.format).toBe('csv');
    expect(statement.lines).toHaveLength(7);
    const [uber, , payment, , , , refund] = statement.lines;
    expect(uber).toMatchObject({
      postedOn: '2026-10-01',
      authorizedOn: '2026-09-30',
      description: 'UBER *EATS 8005928996 CA',
      merchant: 'Uber Eats',
      category: 'FOOD_AND_DRINK',
      amountCents: -3_412,
    });
    expect(payment).toMatchObject({
      amountCents: 52_000,
      category: 'LOAN_PAYMENTS',
      categoryDetail: 'LOAN_PAYMENTS_CREDIT_CARD_PAYMENT',
    });
    expect(refund.amountCents).toBe(1_240);
  });

  it('keeps a quoted comma inside its description', () => {
    expect(statement.lines[4].description).toBe('BLUE BOTTLE COFFEE, OAKLAND CA');
  });

  it('tells two identical coffees apart by their place in the file', () => {
    const coffees = statement.lines.filter((l) => l.description.startsWith('BLUE BOTTLE'));
    expect(coffees).toHaveLength(2);
    expect(coffees[0].fingerprint).not.toBe(coffees[1].fingerprint);
  });

  it('closes at the end of the month the purchases were made in, with no balance of its own', () => {
    expect(statement.closingOn).toBe('2026-09-30');
    expect(statement.closingBalanceCents).toBeNull();
    expect(statement.from).toBe('2026-09-11');
    expect(statement.to).toBe('2026-10-01');
  });

  it('keeps Apple’s word for a category Plaid has no match for', () => {
    expect(statement.lines[1].category).toBe('Other');
  });
});

describe('an OFX from Wallet', () => {
  const statement = parsed(fixture('apple-card-2026-09.ofx'));

  it('reads the lines with the sign as given and the amount owed at the close', () => {
    expect(statement.format).toBe('ofx');
    expect(statement.lines).toHaveLength(7);
    expect(statement.lines[0]).toMatchObject({
      postedOn: '2026-10-01',
      authorizedOn: '2026-09-30',
      amountCents: -3_412,
    });
    expect(statement.lines[2]).toMatchObject({ amountCents: 52_000, category: 'LOAN_PAYMENTS' });
    expect(statement.closingBalanceCents).toBe(61_877);
    expect(statement.closingOn).toBe('2026-09-30');
  });

  it('gives a line the same fingerprint the CSV gave it', () => {
    const csv = parsed(fixture('apple-card-2026-09.csv'));
    expect(statement.lines.map((l) => l.fingerprint).sort()).toEqual(
      csv.lines.map((l) => l.fingerprint).sort(),
    );
  });
});

describe('importing the same month again', () => {
  it('produces the same fingerprints, so the database keeps one row each', () => {
    const first = parsed(fixture('apple-card-2026-09.csv'));
    const again = parsed(fixture('apple-card-2026-09.csv'));
    expect(again.lines.map((l) => l.fingerprint)).toEqual(first.lines.map((l) => l.fingerprint));
    expect(new Set(first.lines.map((l) => l.fingerprint)).size).toBe(first.lines.length);
  });
});

describe('a file that is not a Wallet export', () => {
  it('names the columns it lacks and what was expected', () => {
    const chase =
      'Card,Transaction Date,Post Date,Description,Category,Type,Amount,Memo\n3381,10/01/2026,10/02/2026,COFFEE,Food,Sale,-6.75,\n';
    const result = parseWalletExport(chase);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toMatch(/^It is not an Apple Card export\./);
      expect(result.error).toContain(WALLET_EXPECTED);
    }
  });

  it('refuses a bank statement in OFX', () => {
    const result = parseWalletExport(
      'OFXHEADER:100\n<OFX><BANKMSGSRSV1><STMTTRNRS><STMTRS></STMTRS></STMTTRNRS></BANKMSGSRSV1></OFX>',
    );
    expect(result).toMatchObject({ ok: false });
    if (!result.ok) expect(result.error).toMatch(/bank account statement/);
  });

  it('refuses an empty file', () => {
    expect(parseWalletExport('  \n')).toMatchObject({ ok: false });
  });
});

describe('an export with no transactions', () => {
  it('reads as a statement with no lines', () => {
    const statement = parsed(
      'Transaction Date,Clearing Date,Description,Merchant,Category,Type,Amount (USD),Purchased By\r\n',
    );
    expect(statement.lines).toEqual([]);
    expect(statement.closingOn).toBeNull();
  });
});

describe('the pieces', () => {
  it('reads amounts as cents', () => {
    expect(toCents('1,234.56')).toBe(123_456);
    expect(toCents('-0.5')).toBe(-50);
    expect(toCents('$12')).toBe(1_200);
    expect(toCents('12.345')).toBe(1_235);
    expect(toCents('abc')).toBeNull();
  });

  it('reads quoted CSV with newlines inside quotes', () => {
    expect(parseCsv('a,"b\nc",d\r\n1,2,3')).toEqual([
      ['a', 'b\nc', 'd'],
      ['1', '2', '3'],
    ]);
  });

  it('works out a closing balance from the last one', () => {
    expect(impliedClosingBalance([{ amountCents: -3_412 }, { amountCents: 52_000 }], 60_000)).toBe(
      60_000 + 3_412 - 52_000,
    );
    expect(impliedClosingBalance([{ amountCents: -100 }], null)).toBeNull();
  });
});

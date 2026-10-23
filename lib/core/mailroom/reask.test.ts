import { describe, expect, it } from 'vitest';
import { OWNER_ID, sqlRefusal } from '@/lib/db/sql-guard';
import { storedPilesStatement, updatePilesStatement } from './reask';

const MESSAGE = '0b6f6f0e-6c1a-4c3e-9a51-7f1f1f1f1f1f';

describe('asking Jev again (plan #2520.1)', () => {
  it('reads one account’s mail in the named piles', () => {
    const sql = storedPilesStatement(OWNER_ID, ['bill', 'order']);
    expect(sql).toContain(`core.mail_pile_comparison('${OWNER_ID}')`);
    expect(sql).toContain("array['bill', 'order']::text[]");
    expect(sqlRefusal(sql)).toBeNull();
  });

  it('refuses a pile or account id it does not know', () => {
    expect(() => storedPilesStatement(OWNER_ID, ['bills' as 'bill'])).toThrow(/not a pile/);
    expect(() => storedPilesStatement("x' or true --", ['bill'])).toThrow(/not an account id/);
    expect(() => storedPilesStatement(OWNER_ID, [])).toThrow(/at least one/);
  });

  it('updates only the account’s rows, and the guard reads it as the owner’s write', () => {
    const sql = updatePilesStatement(OWNER_ID, [
      { id: MESSAGE, user_id: OWNER_ID, pile: 'bill', confidence: 0.99, model: 'jev-1.13.0' },
    ]);
    expect(sql).toContain(`('${MESSAGE}'::uuid, 'bill', 0.99::real, 'jev-1.13.0')`);
    expect(sql).toContain(`core.mail_piles.user_id = '${OWNER_ID}'`);
    expect(sqlRefusal(sql!)).toBeNull();
    expect(sqlRefusal(sql!.replaceAll(OWNER_ID, '00000000-0000-0000-0000-000000000000'))).toMatch(/scoped to the owner/);
  });

  it('writes nothing when nothing changed, and refuses another account’s row', () => {
    expect(updatePilesStatement(OWNER_ID, [])).toBeNull();
    expect(() =>
      updatePilesStatement(OWNER_ID, [
        { id: MESSAGE, user_id: '00000000-0000-0000-0000-000000000000', pile: 'bill', confidence: 1, model: 'jev' },
      ]),
    ).toThrow(/another account/);
  });
});

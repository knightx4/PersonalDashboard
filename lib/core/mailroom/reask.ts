import { literal } from '@/lib/db/https-sql';
import type { MailPileRow } from './linker';
import { isMailPile, type MailPile } from './question';

/**
 * Asking Jev again about mail it has already sorted (plan #2520.1).
 *
 * A pile is stored once, when the email arrives, and the mailroom never asks
 * about it again (linker.ts writes with ignoreDuplicates). So when the pile
 * wording in question.ts changes, the agreement report keeps counting the
 * answers given under the old wording until the mail is asked again. This
 * builds the two statements scripts/mail-reask.ts runs for one account: the
 * read of the mail to ask about, and the update that stores the new answers.
 *
 * Run it only once the new wording is on main and deployed. The recurring
 * linker routes by the stored piles as soon as the gate opens (route.ts), so
 * answers written under wording the deployment does not use yet would open
 * the gate for mail it still sorts the old way.
 *
 * Pure, so the statements are tested without a database.
 */

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export type StoredPile = {
  id: string;
  from_address: string | null;
  reply_to_address: string | null;
  subject: string | null;
  pile: string;
  confidence: number;
  rule_piles: string[];
};

function userLiteral(userId: string): string {
  if (!UUID.test(userId)) throw new Error(`not an account id: ${userId}`);
  return literal(userId.toLowerCase());
}

/**
 * The account's sorted mail that either a linker's rules or Jev put in one of
 * `piles`: the mail whose count in the agreement report a rewording of those
 * piles can move.
 */
export function storedPilesStatement(userId: string, piles: readonly MailPile[]): string {
  if (piles.length === 0) throw new Error('name at least one pile');
  for (const pile of piles) if (!isMailPile(pile)) throw new Error(`not a pile: ${pile}`);
  const list = `array[${piles.map((p) => literal(p)).join(', ')}]::text[]`;
  return `select c.message_id as id, m.from_address, m.reply_to_address, m.subject,
       c.pile, c.confidence, c.rule_piles
  from core.mail_pile_comparison(${userLiteral(userId)}) c
  join core.ingested_messages m on m.id = c.message_id
 where c.rule_piles && ${list} or c.pile = any (${list})`;
}

/** The update that stores the new answers, or null when there are none. Scoped to the account. */
export function updatePilesStatement(userId: string, rows: readonly MailPileRow[]): string | null {
  if (rows.length === 0) return null;
  const user = userLiteral(userId);
  const values = rows.map((row) => {
    if (!UUID.test(row.id)) throw new Error(`not a message id: ${row.id}`);
    if (row.user_id.toLowerCase() !== userId.toLowerCase()) throw new Error(`row ${row.id} is another account's`);
    if (!isMailPile(row.pile)) throw new Error(`not a pile: ${row.pile}`);
    if (!Number.isFinite(row.confidence)) throw new Error(`no confidence for ${row.id}`);
    return `(${literal(row.id)}::uuid, ${literal(row.pile)}, ${row.confidence}::real, ${literal(row.model)})`;
  });
  // No alias on the table, so lib/db/sql-guard.ts reads this as a write and
  // holds it to the owner's id.
  return `update core.mail_piles
   set pile = v.pile, confidence = v.confidence, model = v.model
  from (values ${values.join(',\n              ')}) as v (id, pile, confidence, model)
 where core.mail_piles.id = v.id and core.mail_piles.user_id = ${user}
returning core.mail_piles.id`;
}

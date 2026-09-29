/**
 * The mailroom report (plan #1173): how often Jev's pile agrees with each
 * linker's rules. The counting is core.mail_pile_agreement's; this lays its
 * rows out as text for scripts/mail-piles.ts. Pure, so it is tested without
 * a database.
 */

/** One row of core.mail_pile_agreement. */
export type AgreementRow = {
  linker: string | null;
  pile: string;
  rules: number;
  jev: number;
  jev_sure: number;
  agree: number;
  rules_only: number;
  jev_only: number;
  jev_only_sure: number;
  agreement: number | string | null;
};

/** One row of core.mail_pile_comparison where the two disagree. */
export type ComparisonRow = {
  message_id: string;
  received_at: string | null;
  from_address: string | null;
  subject: string | null;
  pile: string;
  confidence: number;
  rule_piles: string[];
};

/** The piles a linker owns; a Jev pile outside these has no rule to agree with. */
const RULED = new Set(['job', 'order', 'bill', 'appointment']);

/**
 * Whether Jev and the rules disagree about an email. They agree when Jev's
 * pile is one the rules put it in, or when the rules put it nowhere and Jev
 * chose a pile no linker owns.
 */
export function disagrees(row: Pick<ComparisonRow, 'pile' | 'rule_piles'>): boolean {
  if (row.rule_piles.includes(row.pile)) return false;
  return row.rule_piles.length > 0 || RULED.has(row.pile);
}

function percent(value: number | string | null): string {
  if (value === null) return '-';
  const n = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(n) ? `${Math.round(n * 100)}%` : '-';
}

function table(header: string[], body: string[][]): string {
  const widths = header.map((h, i) => Math.max(h.length, ...body.map((row) => row[i]!.length)));
  const line = (cells: string[]) =>
    cells.map((cell, i) => (i < 2 ? cell.padEnd(widths[i]!) : cell.padStart(widths[i]!))).join('  ');
  return [line(header), ...body.map(line)].join('\n');
}

export function formatAgreement(rows: readonly AgreementRow[], sorted: number): string {
  if (sorted === 0) return 'Jev has not sorted any email for this account yet.';
  const body = rows.map((row) => [
    row.linker ?? '(none)',
    row.pile,
    String(row.rules),
    `${row.jev} (${row.jev_sure})`,
    String(row.agree),
    String(row.rules_only),
    `${row.jev_only} (${row.jev_only_sure})`,
    percent(row.agreement),
  ]);
  return [
    `${sorted} emails sorted by Jev. In brackets: how many of Jev's were at 0.8 confidence or more.`,
    '',
    table(['linker', 'pile', 'rules', 'jev', 'both', 'rules only', 'jev only', 'agree'], body),
  ].join('\n');
}

export function formatDisagreements(rows: readonly ComparisonRow[], limit: number): string {
  const differing = rows.filter(disagrees).slice(0, limit);
  if (differing.length === 0) return 'No disagreements.';
  return differing
    .map((row) => {
      const rules = row.rule_piles.length > 0 ? row.rule_piles.join(', ') : 'none';
      const what = [row.from_address ?? '(sender scrubbed)', row.subject ?? '(subject scrubbed)'].join(' | ');
      return `jev ${row.pile} ${row.confidence.toFixed(2)}, rules ${rules}: ${what}`;
    })
    .join('\n');
}

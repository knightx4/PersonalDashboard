import type { AgreementRow } from './report';

/**
 * When a linker's claim moves from its rules to Jev's pile (plan #1180).
 *
 * The step asks for Jev to be at least as good as a linker's rules on that
 * linker's mail before it takes over. The only mail whose answer is known is
 * the mail the linker kept after reading it (core.mail_pile_comparison), so
 * the test is how much of that Jev also put in the pile: at least
 * HANDOVER_MIN_AGREED emails in both, and no more than HANDOVER_MAX_MISSED of
 * the linker's mail put elsewhere by Jev. Mail only Jev put in the pile does
 * not count against it, because nothing has read it to say who was right.
 *
 * Pure, so the thresholds are tested without a database.
 */

export const HANDOVER_MIN_AGREED = 30;
export const HANDOVER_MAX_MISSED = 0.05;

export type Handover = {
  open: boolean;
  agreed: number;
  missed: number;
  /** Share of the linker's own mail Jev put elsewhere; null when there is none. */
  missRate: number | null;
};

export function handedOver(row: Pick<AgreementRow, 'agree' | 'rules_only'> | undefined): Handover {
  const agreed = row?.agree ?? 0;
  const missed = row?.rules_only ?? 0;
  const total = agreed + missed;
  const missRate = total === 0 ? null : missed / total;
  return {
    open: agreed >= HANDOVER_MIN_AGREED && missRate !== null && missRate <= HANDOVER_MAX_MISSED,
    agreed,
    missed,
    missRate,
  };
}

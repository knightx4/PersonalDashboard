import { CardSection } from '@/components/ui/card';
import { Table, TBody, TD, TH, THead, TR } from '@/components/ui/table';
import { formatMicroDollars } from '@/lib/money';
import type { EstimateComparison } from '@/lib/core/spend/comparison';

/**
 * The estimates against the ledger, on /account/spend (plan #920).
 *
 * One row per operation: what the $ hint says before a press, the median of
 * the last thirty days, and how many runs that median is from. Operations no
 * button starts get the same table in a section of their own, since their
 * spend is real even though nothing warns before it.
 *
 * On a phone the shared Table stacks each row into label/value pairs, so the
 * four columns never scroll the page sideways.
 */

/** Four decimals, as the rest of the page, and never "$0.0000" for a real cost. */
function money(micros: number): string {
  if (micros > 0 && micros < 100) return '<$0.0001';
  return formatMicroDollars(micros);
}

/** The line under the operation's name: what its figures are for and how the guess held up. */
function noteFor(row: EstimateComparison): string {
  const parts: string[] = [];
  if (row.estimate.per === 'unit') parts.push('per item');
  if (row.estimate.basis === 'measured') {
    parts.push(`the written guess was ${money(row.guess.medianMicros)}`);
  } else if (row.guessVerdict === 'above') {
    parts.push('runs so far cost more than twice the guess');
  } else if (row.guessVerdict === 'below') {
    parts.push('runs so far cost under half the guess');
  }
  const text = parts.join(' · ');
  return text && text[0].toUpperCase() + text.slice(1);
}

function ComparisonTable({ rows }: { rows: readonly EstimateComparison[] }) {
  return (
    <Table flush>
      <THead>
        <tr>
          <TH>Operation</TH>
          <TH num>Estimate</TH>
          <TH num>Actual median</TH>
          <TH num>Runs</TH>
        </tr>
      </THead>
      <TBody>
        {rows.map((row) => {
          const note = noteFor(row);
          const uncertain = row.estimate.basis === 'guess';
          return (
            <TR key={row.operation}>
              <TD primary className="max-md:flex-col max-md:items-start max-md:gap-0">
                <span className="block min-w-0 break-words">
                  {row.module} · {row.operation}
                </span>
                {note && (
                  <span className="block text-small font-normal text-ink-muted">{note}</span>
                )}
              </TD>
              <TD num label="Estimate">
                <span className="inline-flex flex-col items-end">
                  <span>{money(row.estimate.medianMicros)}</span>
                  <span className="text-small text-ink-muted">
                    {uncertain ? 'uncertain' : 'measured'}
                  </span>
                </span>
              </TD>
              <TD num label="Actual median" muted={row.actualMicros == null}>
                {row.actualMicros == null ? '—' : money(row.actualMicros)}
              </TD>
              <TD num label="Runs" muted={row.runs === 0}>
                {row.runs}
              </TD>
            </TR>
          );
        })}
      </TBody>
    </Table>
  );
}

export function EstimatesTable({
  foreground,
  background,
  days,
  minRuns,
}: {
  foreground: readonly EstimateComparison[];
  background: readonly EstimateComparison[];
  /** The window the medians are over. */
  days: number;
  /** Runs it takes before the estimate is the measured median rather than a guess. */
  minRuns: number;
}) {
  return (
    <div className="space-y-3">
      <CardSection
        title="Estimates against actual spend"
        hint={`What the $ beside each button says a press costs, next to the median of the last ${days} days. With ${minRuns} runs or more the estimate is that median, so the two match and the row shows the written guess it replaced. With fewer the estimate is the guess, marked uncertain.`}
      >
        <ComparisonTable rows={foreground} />
      </CardSection>
      <CardSection
        title="Background"
        hint="Spent by sweeps, inbox reading and scheduled jobs that no button starts, so nothing warns before it."
      >
        <ComparisonTable rows={background} />
      </CardSection>
    </div>
  );
}

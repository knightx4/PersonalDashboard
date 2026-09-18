import Link from 'next/link';
import { Table, TBody, TD, TH, THead, TR } from '@/components/ui/table';
import { formatInterviewWhen } from '@/lib/jobs/applications/load';

/**
 * The rounds table, lifted out of the page so it can be photographed.
 *
 * Nothing here changed on the way out: the page still owns the loading, the
 * splitting into upcoming and past, and the debrief banner. This is the half a
 * person looks at, and the preview gallery cannot import a page that opens a
 * database connection on the first line.
 */

/** A round as this page draws it: one line, whatever is inside it. */
export type RoundView = {
  key: string;
  /** The conversation a link lands on: the first of the round. */
  leadId: string;
  roleId: string;
  companyName: string;
  roleTitle: string;
  /** When the round starts. Null where nothing in it is scheduled yet. */
  scheduledAt: string | null;
  timeKnown: boolean;
  /** When the last of it is over, as an instant. Null when unscheduled. */
  endsAt: number | null;
  round: string | null;
  kind: string;
  /** Anything written up about the round, from the round or from inside it. */
  notes: string | null;
};

/**
 * The interview itself, not just the pursuit it belongs to.
 *
 * An interview has no page of its own -- it lives on the role's interviews
 * tab, which scrolls to it and highlights it when named in the query.
 */
export function interviewHref(roleId: string, interviewId: string): string {
  return `/jobs/roles/${roleId}?tab=interviews&interview=${interviewId}`;
}

/**
 * "Round 2 · Technical", not "Round 2 · Technical · Technical".
 *
 * A round is usually named after the kind of thing in it, so printing the
 * label and the kind side by side says the same word twice more often than
 * not. The kind is worth having when the round has no name, or is called
 * something else.
 */
function roundAndKind(row: RoundView): string {
  if (row.round === null) return row.kind;
  if (row.round.toLowerCase().includes(row.kind.toLowerCase())) return row.round;
  return `${row.round} · ${row.kind}`;
}

export function RoundsTable({
  title,
  rows,
  timezone,
}: {
  title: string;
  rows: RoundView[];
  timezone: string;
}) {
  if (rows.length === 0) return null;

  return (
    <section className="mb-6">
      <h2 className="mb-2 text-ui font-semibold text-ink">{title}</h2>
      {/*
        * Four columns, not six.
        *
        * Company and Role were two of them, and Round and Kind another two --
        * and every other surface in this module prints those pairs as one
        * thing: "Marshall Wace · Quantitative Developer" on This week, "Round
        * 2 · Technical" on the role itself. Six columns divided a 1280px
        * table so evenly that "Marshall Wace" wrapped in one and "4
        * interviews" in another, and at 390px each round stacked into six
        * label/value lines of which two read "—". Paired up, they are one line
        * each at both widths.
        */}
      <Table>
        <THead>
          <TR>
            <TH>When</TH>
            <TH>Pursuit</TH>
            <TH>Round</TH>
            <TH>Debrief</TH>
          </TR>
        </THead>
        <TBody>
          {rows.map((row) => (
            /* The round, and the role, as two separate destinations.
               Both are things you might want from this table and only one
               of them was reachable. The row goes to the round; the role
               cell keeps its own link, lifted above the row link with `relative`. */
            <TR key={row.key} href={interviewHref(row.roleId, row.leadId)}>
              <TD primary className="tabular">
                {formatInterviewWhen(row.scheduledAt, row.timeKnown, timezone)}
              </TD>
              {/* `max-md:block`: a cell with no label is drawn by the table
                  as a right-aligned `justify-between` pair, which is right for
                  "Status  replied" and wrong for one long sentence -- it
                  pushed "Marshall Wace ·" to one edge and the role title to
                  the other with a hole between them. */}
              <TD muted className="max-md:block max-md:text-left">
                {row.companyName}
                {' · '}
                <Link
                  href={`/jobs/roles/${row.roleId}`}
                  className="relative transition-colors duration-150 hover:text-accent"
                >
                  {row.roleTitle}
                </Link>
              </TD>
              <TD muted className="max-md:block max-md:text-left">
                {roundAndKind(row)}
              </TD>
              <TD label="Debrief" muted>
                {row.notes ? 'written' : '—'}
              </TD>
            </TR>
          ))}
        </TBody>
      </Table>
    </section>
  );
}

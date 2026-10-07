/**
 * The line a closed application leads with: how it ended, when, and how far it
 * got (plan #1594). The sentence is lib/jobs/role-stage.ts's `closedSummary`.
 */
export function ClosedSummary({ text }: { text: string }) {
  return <p className="rounded-card bg-sunken px-3 py-2 text-ui text-ink">{text}</p>;
}

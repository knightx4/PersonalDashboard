import { Note } from '@/components/ui/note';

/**
 * The line a closed application leads with: how it ended, when, and how far it
 * got (plan #1594). The sentence is lib/jobs/role-stage.ts's `closedSummary`.
 */
export function ClosedSummary({ text }: { text: string }) {
  return <Note>{text}</Note>;
}

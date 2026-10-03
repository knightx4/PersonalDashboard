import Link from '@/components/ui/link';
import { AGENDA_HREF } from '@/lib/day-brief/picks';
import { BRIEF_ANCHOR, type ShownBrief } from '@/lib/day-brief/shown';
import { PickLink } from './pick-link';

/**
 * This morning's brief under the date (plan #1241), and where the
 * notification opens: /home?brief=<day>#brief (lib/day-brief/opens.ts).
 *
 * Up to three picks, each a link to the thing itself with its reason under
 * it, then one line to the Agenda for everything else, because routine to-dos
 * are there rather than here. A day where nothing qualified says so and
 * links the Agenda, so the missing notification is not mistaken for a failed
 * one. A row written before the picks existed shows its paragraph.
 *
 * Following a pick's link records that it was followed, against `day`, the
 * brief's own day (plan #1242; app/home/pick-link.tsx).
 */
export function DayBrief({ brief, day }: { brief: ShownBrief; day: string }) {
  return (
    <section id={BRIEF_ANCHOR} aria-label="This morning's brief" className="mt-4 scroll-mt-bar">
      {brief.kind === 'body' && <p className="max-w-prose text-body text-ink">{brief.body}</p>}

      {brief.kind === 'picks' && (
        <ol className="space-y-2.5">
          {brief.picks.map((pick) => (
            <li key={pick.key} data-pick={pick.key} className="max-w-prose">
              <PickLink
                day={day}
                pickKey={pick.key}
                href={pick.href}
                className="text-body font-semibold text-ink underline decoration-border-strong underline-offset-4 hover:text-accent hover:decoration-current"
              >
                {pick.title}
              </PickLink>
              {pick.reason && <p className="mt-0.5 text-small text-ink-muted">{pick.reason}</p>}
            </li>
          ))}
        </ol>
      )}

      {brief.kind === 'none' && <p className="text-body text-ink">Nothing stands out today.</p>}

      {brief.kind !== 'body' && (
        <p className="mt-3 text-small text-ink-muted">
          {brief.kind === 'picks' ? 'Everything else is on the ' : 'Your to-dos are on the '}
          <Link href={AGENDA_HREF} className="font-medium text-accent underline underline-offset-2">
            Agenda
          </Link>
          .
        </p>
      )}
    </section>
  );
}

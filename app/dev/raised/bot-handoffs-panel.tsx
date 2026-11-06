import Link, { linkVariants } from '@/components/ui/link';
import { Card } from '@/components/ui/card';
import { SectionFold } from '@/components/ui/disclosure';
import { cn } from '@/lib/cn';
import { whenAgo } from '@/lib/core/when';
import type { FlaggedLine } from '@/lib/talk/bot-handoff-flags';
import { ResendHandoff } from './resend-handoff';

/**
 * Requests one bot passed to another that failed or went unanswered for 10
 * minutes (plan #3003.4). The sending bot has already said so in the thread
 * it was asked in; Home keeps the list, so a dropped request can be sent
 * again from one place. One line each: the person's words, who passed it to
 * whom, what went wrong and when, the thread to open, and Resend where the
 * receiver never started on it. Nothing is rendered when nothing failed
 * (law 1).
 *
 * `now` is passed in, so the page reads the clock once.
 */
export function BotHandoffsPanel({
  lines,
  now,
  timeZone,
}: {
  lines: readonly FlaggedLine[];
  now: number;
  timeZone: string;
}) {
  if (lines.length === 0) return null;

  return (
    <Card padding="dense" id="bot-handoffs" className="scroll-mt-16">
      <SectionFold title="Hand-offs nobody answered" count={lines.length}>
        <ul className="divide-y divide-border">
          {lines.map((line) => (
            <li key={line.id} className="row-pad">
              <p className="text-body break-words text-ink">{line.request}</p>
              <p className="break-words text-small text-ink-muted">
                <span className="text-ink">{line.route}</span>. {line.why}{' '}
                <span aria-hidden>·</span>{' '}
                <span className="tabular whitespace-nowrap">{whenAgo(line.at, { timeZone, now })}</span>
              </p>
              <div className="mt-1 flex items-center justify-between gap-3">
                <p className="flex flex-wrap gap-x-4 text-small">
                  <Link href={line.threadHref} className={cn('press-area', linkVariants())}>
                    Open the chat
                  </Link>
                  {line.receiverHref && (
                    <Link href={line.receiverHref} className={cn('press-area', linkVariants())}>
                      {line.receiverName}&rsquo;s chat
                    </Link>
                  )}
                </p>
                {line.canResend && <ResendHandoff id={line.id} to={line.receiverName} />}
              </div>
            </li>
          ))}
        </ul>
      </SectionFold>
    </Card>
  );
}

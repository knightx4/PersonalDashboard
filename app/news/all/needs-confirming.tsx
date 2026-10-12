import { cardVariants } from '@/components/ui/card';
import { ConfirmSignup } from '@/components/news/confirm-signup';
import { cn } from '@/lib/cn';
import {
  formatArrival,
  senderLabel,
  type NewsSender,
  type WaitingSignup,
} from '@/lib/news/issues/list';

/**
 * Signup emails that still need their Confirm press (plan #1725), above the
 * newsletter list. Absent when none wait. Each row names the sender and when
 * the email came, with the same button as the issue page.
 */
export function NeedsConfirming({
  signups,
  senders,
  timezone,
}: {
  signups: readonly WaitingSignup[];
  senders: ReadonlyMap<string, NewsSender>;
  timezone: string;
}) {
  if (signups.length === 0) return null;
  return (
    <section aria-labelledby="needs-confirming" className="space-y-2">
      <h2 id="needs-confirming" className="text-ui font-medium text-ink">
        Needs confirming
      </h2>
      <ul className={cn(cardVariants(), 'divide-y divide-border overflow-hidden')}>
        {signups.map((signup) => {
          const sender = senders.get(signup.senderId);
          return (
            <li
              key={signup.id}
              className="flex flex-wrap items-center justify-between gap-x-3 gap-y-2 px-4 py-3"
            >
              <span className="min-w-0 flex-1 basis-48">
                <span className="block truncate text-body text-ink">
                  {sender ? senderLabel(sender) : 'Unknown sender'}
                </span>
                <span className="mt-0.5 block truncate text-ui text-ink-muted">
                  {formatArrival(signup.receivedAt, timezone)}
                </span>
              </span>
              <ConfirmSignup
                issueId={signup.id}
                url={signup.confirmUrl}
                confirmedLabel={null}
              />
            </li>
          );
        })}
      </ul>
    </section>
  );
}

import { addressOnly, displayName } from '@/lib/jobs/followup/compose';

/**
 * The head of one message: the sender's name in bold, the date beside it, and
 * the address in small muted ink under the name. At phone width the address is
 * left out when there is a name, so a short message's head is one line. A
 * sender with no name shows the address as the name.
 */
export function MessageHead({ from, sent }: { from: string | null; sent: string | null }) {
  const name = displayName(from);
  const address = addressOnly(from);
  const title = name ?? address ?? from ?? 'Unknown sender';
  return (
    <div className="mb-3">
      <div className="flex items-baseline justify-between gap-x-3">
        <p className="min-w-0 break-words text-ui font-semibold text-ink">{title}</p>
        {sent && <p className="tabular shrink-0 text-small text-ink-muted">{sent}</p>}
      </div>
      {name && address && (
        <p className="mt-0.5 hidden break-all text-small text-ink-muted sm:block">{address}</p>
      )}
    </div>
  );
}

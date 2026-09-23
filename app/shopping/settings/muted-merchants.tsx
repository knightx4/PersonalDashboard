import { Ban } from 'lucide-react';
import { restoreMerchantExclusion } from '@/app/shopping/orders/actions';
import { Button } from '@/components/ui/button';

export type MutedMerchant = {
  id: string;
  match_domain: string | null;
  merchants: { name: string } | { name: string }[] | null;
};

export function MutedMerchantsSection({ exclusions }: { exclusions: MutedMerchant[] }) {
  return (
    <div className="space-y-3">
      <p className="text-body text-ink-muted">
        Muted senders are skipped on Import and Reset &amp; re-scan, for orders and for their
        shipping, delivery and return emails. Add one from an order with “Don’t import from…”, or
        from an email in Review with “Exclude sender”.
      </p>
      {exclusions.length === 0 ? (
        <p className="text-body text-ink-muted">Nothing muted yet.</p>
      ) : (
        // Divides and space, no frame: the settings card around this
        // already said these belong together. Law 11.
        <ul className="divide-y divide-border">
          {exclusions.map((row) => {
            const merchant = Array.isArray(row.merchants) ? row.merchants[0] : row.merchants;
            const label = merchant?.name ?? row.match_domain ?? 'Sender';
            return (
              <li
                key={row.id}
                className="row-pad flex items-center justify-between gap-3 text-body"
              >
                <div className="min-w-0">
                  <p className="truncate font-medium text-ink">{label}</p>
                  {row.match_domain && (
                    <p className="truncate text-small text-ink-muted">{row.match_domain}</p>
                  )}
                </div>
                <form action={restoreMerchantExclusion}>
                  <input type="hidden" name="exclusionId" value={row.id} />
                  <Button type="submit" variant="ghost" size="sm">
                    Import again
                  </Button>
                </form>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}

export function MutedMerchantsTitle() {
  return (
    <span className="flex items-center gap-2">
      <Ban className="size-4 text-ink-muted" strokeWidth={1.75} />
      Muted merchants
    </span>
  );
}

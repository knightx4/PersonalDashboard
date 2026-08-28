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
      <p className="text-sm text-ink-muted">
        Muted senders are skipped on Import and Reset &amp; re-scan. Open any order and choose
        “Don’t import from…” to add one — it’s remembered automatically.
      </p>
      {exclusions.length === 0 ? (
        <p className="text-sm text-ink-faint">Nothing muted yet.</p>
      ) : (
        <ul className="divide-y divide-border rounded-lg border border-border">
          {exclusions.map((row) => {
            const merchant = Array.isArray(row.merchants) ? row.merchants[0] : row.merchants;
            const label = merchant?.name ?? row.match_domain ?? 'Sender';
            return (
              <li
                key={row.id}
                className="flex items-center justify-between gap-3 px-3 py-2.5 text-sm"
              >
                <div className="min-w-0">
                  <p className="truncate font-medium text-ink">{label}</p>
                  {row.match_domain && (
                    <p className="truncate text-[12px] text-ink-faint">{row.match_domain}</p>
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

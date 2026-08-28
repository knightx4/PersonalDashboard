import Link from 'next/link';
import type { ReturnableRow } from '@/lib/dashboard/load';
import { Card, CardBody, CardHeader, CardTitle } from '@/components/ui/card';
import { deadlineLabel } from '@/lib/returns/deadline';

export function ReturnableList({ rows }: { rows: ReturnableRow[] }) {
  const shown = rows.slice(0, 8);

  return (
    <Card className="h-full">
      <CardHeader className="flex flex-row items-center justify-between gap-3">
        <CardTitle>Still returnable</CardTitle>
        <Link href="/shopping/returns" className="text-[12px] font-medium text-brand hover:underline">
          Returns tracker
        </Link>
      </CardHeader>
      <CardBody className="pt-0">
        {shown.length === 0 ? (
          <p className="text-[13px] text-ink-muted">
            Nothing with an open return window right now.
          </p>
        ) : (
          <ul className="divide-y divide-border">
            {shown.map((row) => (
              <li key={row.inventoryItemId}>
                <Link
                  href={`/shopping/inventory/${row.inventoryItemId}`}
                  className="flex items-center gap-3 py-2.5 transition-colors hover:bg-canvas"
                >
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-[13px] font-medium text-ink">{row.name}</p>
                    <p className="truncate text-[12px] text-ink-muted">{row.merchantName}</p>
                  </div>
                  <span
                    className={
                      row.daysLeft <= 7
                        ? 'shrink-0 text-[12px] font-medium text-accent-orange'
                        : 'shrink-0 text-[12px] text-ink-muted'
                    }
                  >
                    {deadlineLabel(row.daysLeft, row.returnDeadline)}
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        )}
        {rows.length > shown.length && (
          <p className="mt-2 text-[12px] text-ink-faint">
            +{rows.length - shown.length} more ·{' '}
            <Link href="/shopping/returns?view=all" className="text-brand hover:underline">
              see all
            </Link>
          </p>
        )}
      </CardBody>
    </Card>
  );
}

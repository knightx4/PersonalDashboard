import Link from 'next/link';
import type { ReturnableRow } from '@/lib/dashboard/load';
import { Card, CardBody, CardHeader, CardTitle } from '@/components/ui/card';
import { deadlineLabel } from '@/lib/returns/deadline';
import { ReturnFuse } from '@/components/ui/return-fuse';

export function ReturnableList({ rows }: { rows: ReturnableRow[] }) {
  const shown = rows.slice(0, 8);

  return (
    <Card className="h-full">
      <CardHeader className="flex flex-row items-center justify-between gap-3">
        <CardTitle>Still returnable</CardTitle>
        <Link href="/shopping/returns" className="text-ui font-medium text-accent hover:underline">
          Returns tracker
        </Link>
      </CardHeader>
      <CardBody className="pt-0">
        {shown.length === 0 ? (
          <p className="text-ui text-ink-muted">
            Nothing with an open return window right now.
          </p>
        ) : (
          <ul className="divide-y divide-border">
            {shown.map((row) => (
              <li key={row.inventoryItemId}>
                <Link
                  href={`/shopping/inventory/${row.inventoryItemId}`}
                  className="row-pad flex items-center gap-3 transition-colors duration-150 hover:bg-canvas"
                >
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-ui font-medium text-ink">{row.name}</p>
                    <p className="truncate text-small text-ink-muted">{row.merchantName}</p>
                    <ReturnFuse
                      daysLeft={row.daysLeft}
                      windowDays={row.windowDays}
                      deadline={row.returnDeadline}
                      className="mt-1.5 max-w-40"
                    />
                  </div>
                  <span
                    className={
                      row.daysLeft <= 7
                        ? 'shrink-0 text-small font-medium text-caution'
                        : 'shrink-0 text-small text-ink-muted'
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
          <p className="mt-2 text-small text-ink-muted">
            +{rows.length - shown.length} more ·{' '}
            <Link href="/shopping/returns?view=all" className="text-accent hover:underline">
              see all
            </Link>
          </p>
        )}
      </CardBody>
    </Card>
  );
}

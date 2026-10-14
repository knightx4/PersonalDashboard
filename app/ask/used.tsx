'use client';

import { useState } from 'react';
import { Paperclip } from 'lucide-react';
import Link from '@/components/ui/link';
import { DashChangeRow, type ChangePresses } from '@/components/talk/dash-changes';
import { LookupList } from '@/components/talk/lookup-lines';
import { approxDollars } from '@/lib/core/spend/estimate-types';
import { moduleById } from '@/lib/modules';
import type { ReadRow } from '@/lib/talk/chat-trail';
import type { LookupLine } from '@/lib/talk/lookups';
import type { DashChange } from '@/lib/talk/changes';
import type { TalkFile } from '@/lib/talk/talk';
import { WorkspaceDot } from './chats';

/**
 * What Dash used in the open chat (plan #1899.4), in the column beside it on
 * /ask and in the sheet that column opens as below laptop width: the rows it
 * read, the changes it made with Undo while they stand, the lookups it ran,
 * the files sent to it, and what the chat has cost. Worked out from the
 * chat's turns (lib/talk/chat-trail.ts), its changes and the spend ledger.
 */
export type ChatUsedData = {
  rows: ReadRow[];
  changes: DashChange[];
  lookups: LookupLine[];
  files: TalkFile[];
  /** Micro-dollars, or null when the ledger holds nothing for the chat. */
  costMicros: number | null;
};

function Part({
  title,
  count,
  children,
}: {
  title: string;
  count?: number;
  children: React.ReactNode;
}) {
  return (
    <section aria-label={title} className="space-y-1.5">
      <h3 className="flex items-baseline justify-between gap-2 text-small font-medium text-ink-muted">
        {title}
        {count !== undefined && <span className="tabular">{count}</span>}
      </h3>
      {children}
    </section>
  );
}

function None({ children }: { children: React.ReactNode }) {
  return <p className="text-ui text-ink-muted">{children}</p>;
}

const ROW_LINK =
  'press-area flex min-h-8 min-w-0 items-center gap-2 rounded-control text-ui text-ink hover:text-accent';

function ReadRowLink({ row }: { row: ReadRow }) {
  const where = row.workspace ? moduleById(row.workspace)?.label : row.href.startsWith('/') ? null : 'Gmail';
  const inner = (
    <>
      {row.workspace ? <WorkspaceDot id={row.workspace} className="size-2" /> : <span aria-hidden className="size-2 shrink-0" />}
      <span className="min-w-0 flex-1 truncate">{row.title}</span>
      {where && <span className="shrink-0 text-small text-ink-muted">{where}</span>}
    </>
  );
  return row.href.startsWith('/') ? (
    <Link href={row.href} className={ROW_LINK}>
      {inner}
    </Link>
  ) : (
    <a href={row.href} target="_blank" rel="noopener noreferrer" className={ROW_LINK}>
      {inner}
      <span className="sr-only"> (opens in Gmail)</span>
    </a>
  );
}

export function ChatUsed({
  used,
  presses,
  today,
}: {
  used: ChatUsedData;
  presses: ChangePresses;
  /** YYYY-MM-DD, so a due date this year leaves the year off. */
  today?: string;
}) {
  // A press here moves the change at once; a newer list from the server wins.
  const [changes, setChanges] = useState(used.changes);
  const [seen, setSeen] = useState(used.changes);
  if (used.changes !== seen) {
    setSeen(used.changes);
    setChanges(used.changes);
  }
  const shown = changes.filter((change) => change.status !== 'declined');

  return (
    <div className="space-y-5">
      <Part title="Rows Dash read" count={used.rows.length}>
        {used.rows.length === 0 ? (
          <None>Nothing read yet.</None>
        ) : (
          <ul>
            {used.rows.map((row) => (
              <li key={`${row.table}:${row.ref}`}>
                <ReadRowLink row={row} />
              </li>
            ))}
          </ul>
        )}
      </Part>

      <Part title="Changes" count={shown.length}>
        {shown.length === 0 ? (
          <None>No changes in this chat.</None>
        ) : (
          <ul className="divide-y divide-border">
            {shown.map((change) => (
              <li key={change.id} className="py-2 first:pt-0 last:pb-0">
                <DashChangeRow
                  change={change}
                  presses={presses}
                  today={today}
                  onChanged={(next) => setChanges((current) => current.map((c) => (c.id === next.id ? next : c)))}
                />
              </li>
            ))}
          </ul>
        )}
      </Part>

      <Part title="Lookups" count={used.lookups.length}>
        {used.lookups.length === 0 ? (
          <None>No lookups yet.</None>
        ) : (
          <LookupList lines={used.lookups} label="What Dash looked up in this chat" />
        )}
      </Part>

      <Part title="Files" count={used.files.length}>
        {used.files.length === 0 ? (
          <None>No files sent.</None>
        ) : (
          <ul>
            {used.files.map((file) => (
              <li key={file.id}>
                <a href={file.href} target="_blank" rel="noopener noreferrer" className={ROW_LINK}>
                  <Paperclip className="size-3.5 shrink-0 text-ink-muted" strokeWidth={1.75} aria-hidden />
                  <span className="min-w-0 flex-1 truncate">{file.name}</span>
                </a>
              </li>
            ))}
          </ul>
        )}
      </Part>

      <Part title="Cost">
        <p className="flex items-baseline justify-between gap-2 text-ui text-ink">
          This chat
          <span className="tabular">
            {used.costMicros === null ? (
              <span className="text-ink-muted">Not recorded</span>
            ) : used.costMicros < 10_000 ? (
              'Under a cent'
            ) : (
              `About ${approxDollars(used.costMicros)}`
            )}
          </span>
        </p>
      </Part>
    </div>
  );
}

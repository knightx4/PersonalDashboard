'use client';

import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { RunLinesView } from '@/components/runs/run-lines';
import type { RunActivity } from '@/lib/core/run-activities';

/**
 * A live run's card with the next line still to come (plan #1827). Pressing
 * the button stands in for Realtime delivering a line: it joins the list as
 * LiveRunLines would add it, rising in while the mark beside the title keeps
 * working. Gallery only; the real card is fed by components/runs/live-run-lines.tsx.
 */
export function RunLinesArriving({ lines }: { lines: readonly RunActivity[] }) {
  const [shown, setShown] = useState(lines.length - 1);
  const [arrived, setArrived] = useState<ReadonlySet<string>>(() => new Set());
  const more = shown < lines.length;

  return (
    <div className="space-y-2">
      <Button
        type="button"
        variant="secondary"
        data-motion-demo="run-line"
        disabled={!more}
        onClick={() => {
          setArrived((ids) => new Set(ids).add(lines[shown].id));
          setShown(shown + 1);
        }}
      >
        Dash writes its next line
      </Button>
      <RunLinesView lines={lines.slice(0, shown)} state="live" arrived={arrived} />
    </div>
  );
}

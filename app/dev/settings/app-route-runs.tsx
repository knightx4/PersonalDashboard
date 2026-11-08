import { Chip, type ChipTone } from '@/components/ui/chip';
import { Table, TBody, TD, TH, THead, TR } from '@/components/ui/table';
import { whenDate, whenTime } from '@/lib/core/when';
import {
  bytesWords,
  tookWords,
  type AppRouteRunRow,
  type AppRouteRunStatus,
} from '@/lib/dev/app-route-runs';

const STATUS: Record<AppRouteRunStatus, { label: string; tone: ChipTone }> = {
  running: { label: 'Running', tone: 'accent' },
  ok: { label: 'Done', tone: 'positive' },
  failed: { label: 'Failed', tone: 'danger' },
  refused: { label: 'Refused', tone: 'caution' },
};

/** In UTC, as the stored stamp is, so the server and the browser draw the same words. */
function at(iso: string): string {
  const zone = { timeZone: 'UTC' };
  return `${whenDate(iso, zone)}, ${whenTime(iso, zone)}`;
}

/**
 * The runs of the app's own routes (plan #3070.4): who asked, which path, when
 * it started and ended, how it ended and how much it returned. Newest first.
 * A failed or refused run carries its reason under the path, so the row says
 * why without opening anything. The result body itself is not shown or read.
 */
export function AppRouteRuns({ runs }: { runs: readonly AppRouteRunRow[] }) {
  if (runs.length === 0) {
    return (
      <p className="text-small text-ink-muted">
        No route has been run yet. When a session, Dash or a bot runs one of the app’s cron routes,
        the run is listed here.
      </p>
    );
  }
  return (
    <Table flush aria-label="Runs of the app’s own routes">
      <THead>
        <tr>
          <TH>Path</TH>
          <TH>Asked by</TH>
          <TH>Started</TH>
          <TH>Ended</TH>
          <TH>Status</TH>
          <TH num>Result</TH>
        </tr>
      </THead>
      <TBody>
        {runs.map((run) => {
          const status = STATUS[run.status];
          const took = run.status === 'refused' ? null : tookWords(run.startedAt, run.endedAt);
          return (
            <TR key={run.id}>
              <TD primary>
                <div className="min-w-0">
                  <span className="block break-all font-mono text-small">{run.path}</span>
                  {run.error && (
                    <span className="mt-0.5 block text-small font-normal text-ink-muted">
                      {run.error}
                    </span>
                  )}
                </div>
              </TD>
              <TD muted label="Asked by">
                <span className="break-words">{run.askedBy}</span>
              </TD>
              <TD muted label="Started">
                <span className="tabular whitespace-nowrap">{at(run.startedAt)}</span>
              </TD>
              <TD muted label="Ended">
                <span className="tabular whitespace-nowrap">
                  {run.endedAt ? at(run.endedAt) : '—'}
                  {took && ` (${took})`}
                </span>
              </TD>
              <TD label="Status">
                <Chip tone={status.tone} size="sm">
                  {status.label}
                  {run.httpStatus !== null && ` ${run.httpStatus}`}
                </Chip>
              </TD>
              <TD num muted label="Result">
                {run.resultBytes === null ? '—' : bytesWords(run.resultBytes)}
              </TD>
            </TR>
          );
        })}
      </TBody>
    </Table>
  );
}

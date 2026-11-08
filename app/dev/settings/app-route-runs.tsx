import { StatusGlyph } from '@/components/ui/status-glyph';
import { Table, TBody, TD, TH, THead, TR } from '@/components/ui/table';
import type { StatusGlyph as GlyphName } from '@/lib/status-glyphs';
import { whenDate, whenTime } from '@/lib/core/when';
import {
  bytesWords,
  tookWords,
  type AppRouteRunRow,
  type AppRouteRunStatus,
} from '@/lib/dev/app-route-runs';

/** A shape and plain words; colour only for the two states that need a look. */
const STATUS: Record<AppRouteRunStatus, { label: string; glyph: GlyphName; tone: string }> = {
  running: { label: 'Running', glyph: 'half', tone: 'text-ink' },
  ok: { label: 'Done', glyph: 'check', tone: 'text-ink' },
  failed: { label: 'Failed', glyph: 'cross', tone: 'text-danger' },
  refused: { label: 'Refused', glyph: 'slash', tone: 'text-caution' },
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
              <TD primary className="max-md:px-0">
                <div className="min-w-0">
                  <span className="block break-words font-mono text-small">{run.path}</span>
                  {run.error && (
                    <span className="mt-0.5 block text-small font-normal text-ink-muted">
                      {run.error}
                    </span>
                  )}
                </div>
              </TD>
              <TD muted label="Asked by" className="max-md:px-0 lg:max-w-80">
                <span className="break-words">{run.askedBy}</span>
              </TD>
              <TD muted label="Started" className="max-md:px-0">
                <span className="tabular whitespace-nowrap">{at(run.startedAt)}</span>
              </TD>
              <TD muted label="Ended" className="max-md:px-0">
                <span className="tabular whitespace-nowrap">
                  {run.endedAt ? at(run.endedAt) : '—'}
                  {took && ` (${took})`}
                </span>
              </TD>
              <TD label="Status" className="max-md:px-0">
                <span className={`tabular inline-flex items-center gap-1.5 whitespace-nowrap ${status.tone}`}>
                  <StatusGlyph glyph={status.glyph} size={14} />
                  {status.label}
                  {run.httpStatus !== null && ` ${run.httpStatus}`}
                </span>
              </TD>
              <TD num muted label="Result" className="max-md:px-0">
                {run.resultBytes === null ? '—' : bytesWords(run.resultBytes)}
              </TD>
            </TR>
          );
        })}
      </TBody>
    </Table>
  );
}

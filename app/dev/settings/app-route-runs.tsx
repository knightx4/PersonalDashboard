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

/** How a run ended: its shape, its word and the HTTP status when there is one. */
function RunStatus({ run, className = '' }: { run: AppRouteRunRow; className?: string }) {
  const status = STATUS[run.status];
  return (
    <span
      className={`tabular inline-flex items-center gap-1.5 whitespace-nowrap ${status.tone} ${className}`}
    >
      <StatusGlyph glyph={status.glyph} size={14} />
      {status.label}
      {run.httpStatus !== null && ` ${run.httpStatus}`}
    </span>
  );
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
          const took = run.status === 'refused' ? null : tookWords(run.startedAt, run.endedAt);
          return (
            <TR key={run.id}>
              <TD primary className="max-md:px-0">
                <div className="min-w-0 max-md:w-full">
                  {/* On a phone the run is two lines, the path with how it
                      ended, then who asked, when, how long and how much, in
                      place of five labelled lines. */}
                  <span className="flex items-baseline justify-between gap-3">
                    <span className="min-w-0 break-words font-mono text-small">{run.path}</span>
                    <RunStatus run={run} className="shrink-0 font-normal md:hidden" />
                  </span>
                  <span className="mt-0.5 block text-small font-normal text-ink-muted md:hidden">
                    {[
                      run.askedBy,
                      at(run.startedAt),
                      took,
                      run.resultBytes === null ? null : bytesWords(run.resultBytes),
                    ]
                      .filter(Boolean)
                      .join(' · ')}
                  </span>
                  {run.error && (
                    <span className="mt-0.5 block text-small font-normal text-ink-muted">
                      {run.error}
                    </span>
                  )}
                </div>
              </TD>
              <TD muted className="max-md:hidden lg:max-w-80">
                <span className="break-words">{run.askedBy}</span>
              </TD>
              <TD muted className="max-md:hidden">
                <span className="tabular whitespace-nowrap">{at(run.startedAt)}</span>
              </TD>
              <TD muted className="max-md:hidden">
                <span className="tabular whitespace-nowrap">
                  {run.endedAt ? at(run.endedAt) : '—'}
                  {took && ` (${took})`}
                </span>
              </TD>
              <TD className="max-md:hidden">
                <RunStatus run={run} />
              </TD>
              <TD num muted className="max-md:hidden">
                {run.resultBytes === null ? '—' : bytesWords(run.resultBytes)}
              </TD>
            </TR>
          );
        })}
      </TBody>
    </Table>
  );
}

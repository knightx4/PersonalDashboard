import { Card } from '@/components/ui/card';
import { cn } from '@/lib/cn';
import { mainCheckTitle, mainDot, type MainCheck, type MainDot } from '@/lib/plan/main-check';

/**
 * A project's main, under its page's header: a dot in CI's colour and the
 * sentence the status line's dot carries for this app (plan #2553.2). The
 * reading is the project's own row in `plan_main_checks`, which the overnight
 * tick keeps current (`refreshProjectMainChecks`).
 *
 * `now` is the server's clock at render, so a reading the tick stopped
 * refreshing draws grey and says how old it is rather than standing in for a
 * fresh one.
 */
export function ProjectMainLine({
  check,
  repo,
  now,
}: {
  check: MainCheck | null;
  /** "owner/repo", which the sentence names. */
  repo: string;
  now: number;
}) {
  const state = mainDot(check, now);
  const said = check
    ? mainCheckTitle(check, now, null)
    : `CI on ${repo} main has not been read yet.`;
  // On a quiet card of its own, as the counts panel below it is: text is
  // never left bare on the page (taste:no-bare-text).
  return (
    <Card padding="dense">
      <p className="flex items-baseline gap-2 text-small text-ink-muted">
        <span
          className={cn('size-2 shrink-0 translate-y-[-1px] rounded-full', DOT[state])}
          aria-hidden
        />
        <span className={cn(state === 'failed' && 'text-danger')}>{said}</span>
      </p>
    </Card>
  );
}

const DOT: Record<MainDot, string> = {
  passed: 'bg-positive',
  failed: 'bg-danger',
  running: 'bg-caution',
  unknown: 'bg-ink-ghost',
};

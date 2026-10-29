import { cn } from '@/lib/cn';
import { Disclosure } from '@/components/ui/disclosure';
import { Meter } from '@/components/ui/meter';
import type { ResultTheme } from '@/lib/you/personality/model';

/**
 * A typed-in result's ranked themes, such as a CliftonStrengths top five:
 * each theme with its domain, its score where the test measures one, and
 * the report's one line, and what the report
 * said about it folded beneath, so the list reads at a glance and the detail
 * is a press away.
 */

function Part({ title, items }: { title: string; items: readonly string[] }) {
  if (items.length === 0) return null;
  return (
    <div>
      <p className="text-small font-medium text-ink">{title}</p>
      <ul className="mt-1 list-disc space-y-1 pl-4 text-small text-ink-muted">
        {items.map((item, i) => (
          <li key={i}>{item}</li>
        ))}
      </ul>
    </div>
  );
}

export function ThemeList({ themes, className }: { themes: readonly ResultTheme[]; className?: string }) {
  return (
    <ol className={cn('space-y-3', className)}>
      {themes.map((theme, i) => {
        const detail =
          theme.insights.length + theme.blindSpots.length + theme.actions.length > 0;
        return (
          <li key={theme.name} className="flex gap-3">
            <span className="w-4 shrink-0 text-right text-body tabular-nums text-ink-muted">
              {i + 1}
            </span>
            <div className="min-w-0 flex-1">
              <div className="flex items-baseline justify-between gap-3">
                <p className="flex flex-wrap items-baseline gap-x-2">
                  <span className="text-body font-medium text-ink">{theme.name}</span>
                  {theme.domain ? (
                    <span className="text-small text-ink-muted">{theme.domain}</span>
                  ) : null}
                </p>
                {theme.score !== null ? (
                  <span className="shrink-0 text-body tabular-nums text-ink">
                    {theme.score}
                    <span className="text-small text-ink-muted"> / 100</span>
                  </span>
                ) : null}
              </div>
              {theme.score !== null ? (
                <Meter
                  className="mt-1.5 mb-1"
                  value={theme.score}
                  max={100}
                  height="md"
                  minFraction={0.02}
                  label={`${theme.name}: ${theme.score} of 100`}
                />
              ) : null}
              {theme.summary ? <p className="text-small text-ink-muted">{theme.summary}</p> : null}
              {detail ? (
                <Disclosure title="What the report says" className="mt-1">
                  <div className="space-y-3">
                    <Part title="How it shows up in you" items={theme.insights} />
                    <Part title="Where it can get in the way" items={theme.blindSpots} />
                    <Part title="Ways to use it" items={theme.actions} />
                  </div>
                </Disclosure>
              ) : null}
            </div>
          </li>
        );
      })}
    </ol>
  );
}

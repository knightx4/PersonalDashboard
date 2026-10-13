import { StateLabel, TONE_TEXT } from '@/components/dev/state-label';
import { cardVariants } from '@/components/ui/card';
import { DashCredit } from '@/components/ui/dash-mark';
import { LinkedText } from '@/components/ui/linked-text';
import { cn } from '@/lib/cn';
import {
  changeSincePrevious,
  PLAN_UPDATE_HEALTH,
  progressSince,
  type PlanUpdate,
} from '@/lib/plan/updates';
import { when } from './plan-run-status';

/**
 * Dash's update on a feature (plan #1666), as a card: the health it gave the
 * feature, when, what moved, and how the done count changed since the update
 * before. The Overview tab shows the latest; the Activity tab lists the rest.
 */
export function FeatureUpdate({
  update,
  earlier,
  className,
}: {
  update: PlanUpdate;
  /** The update before this one, for the change since it (plan #1834). */
  earlier?: PlanUpdate | null;
  className?: string;
}) {
  const health = PLAN_UPDATE_HEALTH[update.health];
  return (
    <article
      aria-label="Dash’s update"
      className={cn(cardVariants({ padding: 'dense' }), 'space-y-2', className)}
    >
      <header className="flex flex-wrap items-center gap-x-3 gap-y-1">
        <StateLabel
          glyph={health.glyph}
          word={health.word}
          tone={health.tone}
          title={health.title}
          className={cn('text-ui font-medium', TONE_TEXT[health.tone])}
        />
        <span className="text-small text-ink-muted">
          <DashCredit />
          Dash’s update, {when(update.createdAt)}
        </span>
      </header>
      <p className="whitespace-pre-wrap text-ui text-ink">
        <LinkedText text={update.body} />
      </p>
      <p className="text-small text-ink-muted">{progressSince(update)}</p>
      <p className="text-small text-ink-muted">
        {changeSincePrevious(update, earlier) ?? 'The first update on this feature.'}
      </p>
    </article>
  );
}

/**
 * The line saying a feature that is moving has gone a week without an update
 * (plan #1834). Shown above the latest update, or alone when there is none.
 */
export function UpdateOverdue({ days, className }: { days: number; className?: string }) {
  return (
    <p
      role="status"
      className={cn(
        cardVariants({ padding: 'dense' }),
        'text-ui font-medium',
        TONE_TEXT.caution,
        className,
      )}
    >
      Update overdue: {days} days since the last one.
    </p>
  );
}

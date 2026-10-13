import { Card } from '@/components/ui/card';
import {
  DASH_RUNNERS,
  DASH_RUNNER_VISORS,
  DASH_STATES,
  DashMark,
  type DashRunner,
  type DashState,
} from '@/components/ui/dash-mark';

/**
 * Dash and the runner's four Dashes in the surface gallery: every state at the
 * runner card's 44px and the 24px a list uses. Dash itself comes first, on the
 * brand ramp in its capsule; then each runner in its own visor and colour; and
 * last, Dash in the colour of the text beside it.
 */

const STATE_NAMES: Record<DashState, string> = {
  idle: 'Idle',
  asleep: 'Asleep',
  working: 'Working',
  asking: 'Asking',
  done: 'Done',
  failed: 'Failed',
};

const SLOT_NAMES: Record<DashRunner, string> = {
  'feature-1': 'Feature 1',
  'feature-2': 'Feature 2',
  'feature-3': 'Feature 3',
  goals: 'Goals',
};

function Row({ name, detail, runner, plain }: { name: string; detail: string; runner?: DashRunner; plain?: boolean }) {
  return (
    <li className="card-pad-x row-pad flex flex-col gap-2 sm:flex-row sm:items-center sm:gap-4">
      <div className="min-w-0 sm:w-36 sm:shrink-0">
        <p className="text-ui text-ink">{name}</p>
        <p className="text-small text-ink-muted">{detail}</p>
      </div>
      <div className={`grid flex-1 grid-cols-3 gap-2 sm:grid-cols-6 ${plain ? 'text-ink-muted' : ''}`}>
        {DASH_STATES.map((state) => (
          <div key={state} className="flex flex-col items-start gap-1">
            <div className="flex items-end gap-1">
              <DashMark state={state} runner={runner} tone={plain ? 'current' : 'brand'} size="lg" />
              <DashMark state={state} runner={runner} tone={plain ? 'current' : 'brand'} size="sm" />
            </div>
            <span className="text-micro text-ink-muted">{STATE_NAMES[state]}</span>
          </div>
        ))}
      </div>
    </li>
  );
}

export function DashMarkRunners() {
  return (
    <Card padding="none">
      <ul className="divide-y divide-border">
        <Row name="Dash" detail="The capsule, on the brand ramp" />
        {DASH_RUNNERS.map((runner) => (
          <Row key={runner} runner={runner} name={SLOT_NAMES[runner]} detail={DASH_RUNNER_VISORS[runner]} />
        ))}
        <Row name="Plain" detail="In the colour of the text beside it" plain />
      </ul>
    </Card>
  );
}

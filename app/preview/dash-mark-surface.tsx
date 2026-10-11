import { Card } from '@/components/ui/card';
import { DASH_LOOKS, DASH_LOOK_NAMES, DashMark, type DashLook, type DashState } from '@/components/ui/dash-mark';

/**
 * Dash's looks in the surface gallery (plan #1702): each hat in the three
 * states the runner card shows, at the card's 44px and the 24px a list uses,
 * on the brand ramp, with bareheaded Dash first to compare against. The last
 * row is the four idle in the colour of their place, as beside muted text.
 */

const STATES: readonly { state: DashState; name: string }[] = [
  { state: 'idle', name: 'Idle' },
  { state: 'working', name: 'Working' },
  { state: 'asleep', name: 'Asleep' },
];

/** Which slot on the runner card wears each look. */
const SLOTS: Record<DashLook, string> = {
  'top-hat': 'Feature 1',
  'ball-cap': 'Feature 2',
  'cowboy-hat': 'Feature 3',
  'newsboy-cap': 'Goals',
};

function LookRow({ look, name, detail }: { look?: DashLook; name: string; detail: string }) {
  return (
    <li className="card-pad-x row-pad flex flex-col gap-2 sm:flex-row sm:items-center sm:gap-4">
      <div className="min-w-0 sm:w-36 sm:shrink-0">
        <p className="text-ui text-ink">{name}</p>
        <p className="text-small text-ink-muted">{detail}</p>
      </div>
      <div className="grid flex-1 grid-cols-3 gap-2">
        {STATES.map(({ state, name: stateName }) => (
          <div key={state} className="flex flex-col items-start gap-1">
            <div className="flex items-end gap-2">
              <DashMark state={state} look={look} tone="brand" size="lg" />
              <DashMark state={state} look={look} tone="brand" size="sm" />
            </div>
            <span className="text-micro text-ink-muted">{stateName}</span>
          </div>
        ))}
      </div>
    </li>
  );
}

export function DashMarkLooks() {
  return (
    <Card padding="none">
      <ul className="divide-y divide-border">
        <LookRow name="No hat" detail="Dash as everywhere else" />
        {DASH_LOOKS.map((look) => (
          <LookRow
            key={look}
            look={look}
            name={DASH_LOOK_NAMES[look][0].toUpperCase() + DASH_LOOK_NAMES[look].slice(1)}
            detail={SLOTS[look]}
          />
        ))}
        <li className="card-pad-x row-pad flex flex-col gap-2 sm:flex-row sm:items-center sm:gap-4">
          <div className="min-w-0 sm:w-36 sm:shrink-0">
            <p className="text-ui text-ink">Plain</p>
            <p className="text-small text-ink-muted">In the colour of the text beside it</p>
          </div>
          <div className="flex flex-1 items-center gap-3 text-ink-muted">
            {DASH_LOOKS.map((look) => (
              <DashMark key={look} look={look} size="sm" />
            ))}
          </div>
        </li>
      </ul>
    </Card>
  );
}

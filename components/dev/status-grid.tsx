import Link from '@/components/ui/link';
import { cn } from '@/lib/cn';
import { Group } from '@/components/ui/disclosure';
import { ModuleMark } from '@/components/ui/module-mark';
import { isModuleId } from '@/lib/modules';
import { moduleAnchor } from '@/lib/plan/feature-page';
import type { ScopeState, ScopeStatuses } from '@/lib/plan/scope-status';

/**
 * Where every workspace and project stands, one tile each (plan #2903.2).
 *
 * The dot says it: a hollow grey ring when nothing is open, solid orange when
 * steps are open and every one waits on the person or on work underway, solid
 * green with the count inside when steps can be started now. Server-rendered
 * from `scopeStatuses`, with no state of its own.
 */

const MAX_SHOWN = 99;

type Tile = {
  key: string;
  label: string;
  href: string;
  state: ScopeState;
  count: number;
  mark: React.ReactNode;
};

/** What a screen reader hears: "Jobs, 3 steps ready". */
export function tileLabel(label: string, state: ScopeState, count: number): string {
  if (state === 'ready') return `${label}, ${count} ${count === 1 ? 'step' : 'steps'} ready`;
  if (state === 'waiting') return `${label}, waiting`;
  return `${label}, nothing open`;
}

function Dot({ state, count }: { state: ScopeState; count: number }) {
  if (state === 'ready') {
    return (
      <span
        aria-hidden
        className="flex h-5 min-w-5 shrink-0 items-center justify-center rounded-pill bg-positive px-1 text-micro font-semibold leading-none text-surface tabular-nums"
      >
        {count > MAX_SHOWN ? `${MAX_SHOWN}+` : count}
      </span>
    );
  }
  return (
    <span
      aria-hidden
      className={cn(
        'size-3 shrink-0 rounded-pill',
        state === 'waiting' ? 'bg-caution-fill' : 'border-2 border-ink-ghost',
      )}
    />
  );
}

function ProjectInitial({ label }: { label: string }) {
  return (
    <span
      aria-hidden
      className="flex size-6 shrink-0 items-center justify-center rounded-control bg-sunken text-ui font-semibold text-ink-muted"
    >
      {label.trim().charAt(0).toUpperCase()}
    </span>
  );
}

export function StatusGrid({ statuses }: { statuses: ScopeStatuses }) {
  const tiles: Tile[] = [
    {
      key: 'everything',
      label: 'Everything',
      href: '/dev/plan',
      ...statuses.everything,
      mark: <ModuleMark module="dash" size="sm" />,
    },
    ...statuses.scopes.map((row): Tile => ({
      key: row.scope,
      label: row.label,
      href: isModuleId(row.scope) ? `/dev/plan#${moduleAnchor(row.scope)}` : `/dev/projects/${row.scope}`,
      state: row.state,
      count: row.count,
      mark: isModuleId(row.scope) ? (
        <ModuleMark module={row.scope} size="sm" />
      ) : (
        <ProjectInitial label={row.label} />
      ),
    })),
  ];

  return (
    <Group title="Status">
      <ul className="grid grid-cols-2 gap-1.5 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5">
        {tiles.map((tile) => (
          <li key={tile.key}>
            <Link
              href={tile.href}
              aria-label={tileLabel(tile.label, tile.state, tile.count)}
              className="sheet flex min-h-11 items-center gap-2 rounded-card bg-surface px-2 py-1.5 outline-none focus-visible:ring-2 focus-visible:ring-accent"
            >
              {tile.mark}
              <span className="min-w-0 flex-1 truncate text-ui text-ink">{tile.label}</span>
              <Dot state={tile.state} count={tile.count} />
            </Link>
          </li>
        ))}
      </ul>
    </Group>
  );
}

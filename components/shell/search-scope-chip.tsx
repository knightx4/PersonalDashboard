'use client';

import { ModuleMark } from '@/components/ui/module-mark';
import { scopeLabel, toggleScope, type SearchScope } from '@/lib/search/scope';
import type { ModuleId } from '@/lib/modules';

/**
 * The chip at the right end of a search field, naming what is being searched.
 *
 * Two states and no more, which is lib/search/scope.ts: the workspace the page
 * is in, or everything you own. Pressing it swaps them, and the word on the
 * chip is the state you are in rather than the one you would get.
 *
 * Outside a workspace there is nothing to narrow to, so there is no chip. The
 * caller does not have to test for that -- both surfaces pass whatever
 * `module` the shell gave them and get nothing back on Home and the account
 * page.
 *
 * One component because the bar and the box draw the same chip. It started in
 * components/shell/search-bar.tsx and moved here when the box got one too
 * (#703), the same way SearchRowLine moved into components/shell/search-row.tsx
 * when both surfaces drew the same row.
 */
export function SearchScopeChip({
  scope,
  module,
  onPress,
}: {
  /** What is being searched now. */
  scope: SearchScope;
  /** The workspace the page is in, which is the narrow state. */
  module: ModuleId | null;
  onPress: () => void;
}) {
  if (module === null) return null;

  return (
    <button
      type="button"
      onClick={onPress}
      // Named by what it is searching and by what pressing it does, because
      // the word on it is a state rather than an instruction.
      aria-label={`Searching ${scopeLabel(scope)}. Search ${scopeLabel(toggleScope(scope, module))} instead`}
      // ui-ok: hand-rolled-box -- the pill is the button, so its edge is the
      // control rather than a frame around a group. It stands on the field's
      // own ground, so neither a shared ground nor space can say that it is
      // something you press. No primitive draws this shape: Button is
      // rounded-control and its smallest size is the height of the box this
      // sits inside, and ChipSelect and ChipInput wrap a select and an input.
      className="press flex shrink-0 items-center gap-1.5 rounded-full border border-border py-0.5 pl-1 pr-2 text-small text-ink-muted transition-colors hover:bg-sunken hover:text-ink"
    >
      {/* The mark of what is being searched: a workspace's own, or the app's
          for everything you own. */}
      <ModuleMark module={scope === 'everything' ? null : scope} size="sm" />
      <span className="whitespace-nowrap">{scopeLabel(scope)}</span>
    </button>
  );
}

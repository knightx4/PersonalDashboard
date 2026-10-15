import { Disclosure } from '@/components/ui/disclosure';
import { cardVariants } from '@/components/ui/card';
import { cn } from '@/lib/cn';
import { formatMicroDollars, formatNumber } from '@/lib/money';
import { isModuleId, moduleById } from '@/lib/modules';
import type { FunctionTotal, ModuleSpend } from '@/lib/core/spend/summary';

/**
 * Where the money goes on /account/spend, one fold per module (note
 * 7b696ccd): the closed line carries the module's total, so six lines answer
 * which workspace spends, and opening one lists its functions, dearest first.
 * The totals are over the whole ledger.
 */

/** The calls and what was not priced, under a module or a function. */
function callsLine(total: { calls: number; unpriced: number }): string {
  return `${formatNumber(total.calls)} ${total.calls === 1 ? 'call' : 'calls'}${
    total.unpriced > 0 ? ` · ${total.unpriced} not priced` : ''
  }`;
}

/** A workspace's own name, or the ledger's id for `core` and anything retired. */
function moduleName(module: string): string {
  if (module === 'core') return 'App';
  return (isModuleId(module) && moduleById(module)?.label) || module;
}

function FunctionRow({ fn }: { fn: FunctionTotal }) {
  return (
    <li className="flex items-baseline justify-between gap-3 py-2">
      <span className="min-w-0">
        <span className="block break-words text-ui text-ink">{fn.operation}</span>
        <span className="block text-small text-ink-muted">{callsLine(fn)}</span>
      </span>
      <span className="shrink-0 text-ui text-ink tabular-nums">{formatMicroDollars(fn.micros, { fromCent: true })}</span>
    </li>
  );
}

function ModuleRow({ group, open }: { group: ModuleSpend; open: boolean }) {
  const count = group.functions.length;
  return (
    <li>
      <Disclosure
        defaultOpen={open}
        title={
          <span className="flex items-baseline justify-between gap-3">
            <span className="min-w-0">
              <span className="block text-ui text-ink">{moduleName(group.module)}</span>
              <span className="block text-small font-normal text-ink-muted">
                {callsLine(group)} · {count} {count === 1 ? 'function' : 'functions'}
              </span>
            </span>
            <span className="shrink-0 text-ui text-ink tabular-nums">{formatMicroDollars(group.micros, { fromCent: true })}</span>
          </span>
        }
        summaryClassName="px-4 py-2.5 [&>span]:flex-1"
        bodyClassName="pr-4 pb-1 pl-10"
      >
        <ul className="divide-y divide-border">
          {group.functions.map((fn) => (
            <FunctionRow key={fn.operation} fn={fn} />
          ))}
        </ul>
      </Disclosure>
    </li>
  );
}

export function SpendByModule({
  groups,
  open = null,
}: {
  groups: readonly ModuleSpend[];
  /** A module to draw open, for the gallery's picture of an opened fold. */
  open?: string | null;
}) {
  return (
    <ul className={cn(cardVariants(), 'divide-y divide-border overflow-hidden')}>
      {groups.map((group) => (
        <ModuleRow key={group.module} group={group} open={group.module === open} />
      ))}
    </ul>
  );
}

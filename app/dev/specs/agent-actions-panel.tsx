import { ChevronRight } from 'lucide-react';
import { cardVariants } from '@/components/ui/card';
import { NO_TOOL_REASON_LABELS } from '@/lib/agent-actions/types';
import {
  TOOL_WHERE_LABELS,
  type AgentActionRow,
  type AgentActionSummary,
} from '@/lib/agent-actions/summary';
import { cn } from '@/lib/cn';
import { SectionHeading } from '@/components/ui/section-heading';
import { Stat } from '@/components/ui/stat';

/**
 * What Dash can do of what the pages let the person do (plan #1895), under
 * the app's vision, which asks for everything a person can do in the app to
 * be done by an agent too. The three counts come first because they are the
 * answer; the reasons and the full list fold away beneath them.
 *
 * The last count is the one the gate holds: a new action cannot add a gap
 * without closing another (`agent-action-gaps` in scripts/spec-counts.ts).
 */

function ActionRow({ row }: { row: AgentActionRow }) {
  return (
    <li className="py-1.5">
      <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-0.5">
        <span className="min-w-0 break-all font-mono text-small text-ink">{row.name}</span>
        <span className="text-small text-ink-muted">
          {row.kind === 'tool' &&
            row.tools.map((t, i) => (
              <span key={t.name}>
                {i > 0 && ', '}
                <span className="font-mono text-ink">{t.name}</span>
              </span>
            ))}
          {row.kind === 'tool' && row.tools.length > 0 && (
            <span> · {TOOL_WHERE_LABELS[row.tools[0].where]}</span>
          )}
          {row.kind === 'none' && row.reason && NO_TOOL_REASON_LABELS[row.reason]}
          {row.kind === 'gap' && <span className="font-medium text-ink">Not yet</span>}
        </span>
      </div>
      {row.note && <p className="mt-0.5 text-caption text-ink-ghost">{row.note}</p>}
    </li>
  );
}

/**
 * Disclosure's look, on a `<details>` of this panel's own. Disclosure turns
 * its chevron on any open ancestor of its group, and this panel sits inside
 * the specs page's open workspace Disclosure, so every closed fold here drew
 * its chevron open. The two levels take group names of their own.
 */
function Fold({
  title,
  meta,
  inner = false,
  children,
}: {
  title: string;
  meta: React.ReactNode;
  /** A fold inside the other fold. */
  inner?: boolean;
  children: React.ReactNode;
}) {
  return (
    // ui-ok: hand-rolled-fold -- Disclosure's chevron reads the open workspace fold around it.
    <details className={inner ? 'group/agentws' : 'group/agentfold'}>
      <summary className="press flex cursor-pointer list-none items-center gap-2 rounded-control py-1 text-ui text-ink-muted hover:text-ink focus-visible:outline-2 focus-visible:outline-offset-2 [&::-webkit-details-marker]:hidden">
        <ChevronRight
          aria-hidden
          strokeWidth={1.75}
          className={cn(
            'size-3.5 shrink-0 transition-transform duration-quick',
            inner ? 'group-open/agentws:rotate-90' : 'group-open/agentfold:rotate-90',
          )}
        />
        <span className="min-w-0 font-medium text-ink">{title}</span>
        <span className="text-small text-ink-muted">{meta}</span>
      </summary>
      <div className="mt-2 ml-5.5">{children}</div>
    </details>
  );
}

export function AgentActionsPanel({ summary }: { summary: AgentActionSummary }) {
  const figures = [
    { value: summary.tool, label: 'with a tool' },
    { value: summary.none, label: 'should not' },
    { value: summary.gap, label: 'not yet' },
  ];

  return (
    <section aria-labelledby="agent-actions" className="mt-3 space-y-2">
      <SectionHeading as="h3" id="agent-actions" title="What Dash can do of what you can" />
      <div className={cn(cardVariants({ padding: 'dense' }), 'space-y-3')}>
        <p className="text-ui text-ink-muted">
          <span className="tabular">{summary.total}</span> things the pages let you do: how many Dash
          has a tool for, how many no agent should do, and how many it cannot do yet.
        </p>

        <div className="grid grid-cols-3 gap-3">
          {figures.map((f) => (
            <Stat key={f.label} size="sm" value={f.value} label={f.label} />
          ))}
        </div>
        <p className="text-small text-ink-muted">
          The gate refuses a new action that is in no list, and the last count may only go down.
        </p>

        <div className="space-y-1 border-t border-border pt-2">
          <Fold title="Why no agent should" meta={`${summary.reasons.length} reasons`}>
            <ul className="space-y-2">
              {summary.reasons.map((r) => (
                <li key={r.reason}>
                  <p className="text-ui text-ink">
                    <span className="font-medium">{r.label}</span>
                    <span className="tabular ml-2 text-ink-muted">{r.count}</span>
                  </p>
                  <p className="text-small text-ink-muted">{r.sentence}</p>
                </li>
              ))}
            </ul>
          </Fold>

          <Fold title="Every action, by workspace" meta={`${summary.groups.length} workspaces`}>
            <div className="space-y-1">
              {summary.groups.map((group) => (
                <Fold
                  inner
                  key={group.workspace ?? 'app'}
                  title={group.label}
                  meta={
                    <span className="tabular">
                      {group.tool} with a tool · {group.gap} not yet
                    </span>
                  }
                >
                  <ul className="divide-y divide-border">
                    {group.rows.map((row) => (
                      <ActionRow key={`${row.file}#${row.name}`} row={row} />
                    ))}
                  </ul>
                </Fold>
              ))}
            </div>
          </Fold>
        </div>
      </div>
    </section>
  );
}

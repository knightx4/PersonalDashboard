import Link from 'next/link';
import { StateLabel, type DevTone } from '@/components/dev/state-label';
import { RefText } from '@/components/dev/ref-text';
import type { PlanRefTitles } from '@/lib/comments/refs';
import { MODULES, type ModuleId } from '@/lib/modules';
import { PLAN_HEALTH_GLYPHS } from '@/lib/status-glyphs';
import { WAITING_WORD } from '@/lib/dev/words';
import type { WaitingRow } from '@/lib/plan/waiting';

const MODULE_LABEL: Record<ModuleId, string> = Object.fromEntries(
  MODULES.map((module) => [module.id, module.label]),
) as Record<ModuleId, string>;

/**
 * Stopped is the one that costs something. A question can sit a day and
 * nothing is worse for it, and a proposal costs nothing until you want it; a
 * step that has stopped is work already begun and not moving. A setup job
 * takes the same tone as stopped, because it is the same cost seen a day
 * earlier: something on the plan is waiting on it and only you can do it.
 */
const TONE: Record<WaitingRow['health'], DevTone> = {
  blocked: 'caution',
  setup: 'caution',
  unanswered: 'accent',
  proposed: 'quiet',
};

/**
 * A plan step that cannot move until you do something, drawn beside the raises
 * rather than under a heading of its own.
 *
 * Dash asked one table what was waiting on you, and a step blocked on
 * something only you can supply was not in it: #499 needed a GitHub token for
 * a day while this page said nothing was waiting. The request had gone where
 * the plan skill sends it -- `block <n> --note`, into the step's own comment
 * column -- and no page read that column.
 *
 * Two lists under one heading rather than two headings, because "what is
 * waiting on me" is one question and answering it in two places is how the
 * second place stops being read.
 */
export function WaitingCard({ row, titles }: { row: WaitingRow; titles?: PlanRefTitles }) {
  return (
    <li className="space-y-1 p-3">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <Link
          href="/dev/plan"
          className="text-body font-semibold text-ink hover:underline"
        >
          #{row.number} {row.title}
        </Link>
        <StateLabel
          glyph={PLAN_HEALTH_GLYPHS[row.health]}
          word={WAITING_WORD[row.health]}
          tone={TONE[row.health]}
        />
      </div>

      {row.ask && (
        <p className="text-small text-ink-muted">
          <RefText text={row.ask} titles={titles} />
        </p>
      )}

      <p className="text-micro text-ink-ghost">
        {row.module ? MODULE_LABEL[row.module] : 'Everything'}
      </p>
    </li>
  );
}

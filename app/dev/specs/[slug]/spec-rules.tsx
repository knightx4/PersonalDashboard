import Link from 'next/link';
import { StateLabel, type DevTone } from '@/components/dev/state-label';
import { cardVariants } from '@/components/ui/card';
import { cn } from '@/lib/cn';
import { planRefHref } from '@/lib/comments/refs';
import type { RuleState, RuleStateKind } from '@/lib/specs/rule-states';
import type { StatusGlyph } from '@/lib/status-glyphs';

/**
 * A spec's rules at the top of its page, each with where it stands (plan
 * #1503). The rules themselves are still in the document below, in their own
 * section with a thread under it; this is the reading of them the gate keeps.
 */

const LOOK: Record<RuleStateKind, { glyph: StatusGlyph; word: string; tone: DevTone }> = {
  holding: { glyph: 'check', word: 'Holding', tone: 'positive' },
  counting: { glyph: 'half', word: 'Coming down', tone: 'quiet' },
  failing: { glyph: 'cross', word: 'Failing', tone: 'caution' },
  pending: { glyph: 'dashed', word: 'Check to build', tone: 'ghost' },
  audit: { glyph: 'empty', word: 'Audit', tone: 'quiet' },
};

/** The rule's sentence, with its backticked names set as code. */
function Sentence({ text }: { text: string }) {
  return (
    <>
      {text.split('`').map((part, i) => (i % 2 === 1 ? <code key={i}>{part}</code> : part))}
    </>
  );
}

function Summary({ state }: { state: RuleState }) {
  if (state.kind === 'pending' && state.pendingStep !== null) {
    const step = state.pendingStep;
    return (
      <>
        Its check is still to be built, in{' '}
        <Link href={planRefHref(step)} className="text-ink underline-offset-2 hover:underline">
          #{step}
        </Link>
        .
      </>
    );
  }
  return <Sentence text={state.summary} />;
}

export function SpecRules({ states }: { states: RuleState[] }) {
  if (states.length === 0) return null;
  const counted = states.some((s) => s.count !== null);

  return (
    <section className={cn(cardVariants(), 'px-4 py-4')} aria-labelledby="spec-rules-heading">
      <h2 id="spec-rules-heading" className="text-body font-semibold text-ink">
        Rules
      </h2>
      {counted && (
        <p className="mt-1 text-ui text-ink-muted">
          Counts are as the gate recorded them at the last commit, in{' '}
          <code>scripts/spec-baseline.json</code>.
        </p>
      )}

      <ol className="mt-3 divide-y divide-border">
        {states.map((state) => {
          const look = LOOK[state.kind];
          return (
            <li key={state.rule.number} className="space-y-1 py-3 first:pt-0 last:pb-0">
              <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
                <p className="min-w-0 flex-1 text-body text-ink">
                  <span className="font-semibold">R{state.rule.number}.</span>{' '}
                  <Sentence text={state.rule.sentence} />
                </p>
                <StateLabel glyph={look.glyph} word={look.word} tone={look.tone} />
              </div>
              <p className="text-ui text-ink-muted tabular-nums">
                <Summary state={state} />
              </p>
              {state.problems.map((problem) => (
                <p key={problem} className="text-ui text-caution">
                  {problem}
                </p>
              ))}
            </li>
          );
        })}
      </ol>
    </section>
  );
}

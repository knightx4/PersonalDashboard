'use client';

import { useId, useState, type ComponentProps } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { X } from 'lucide-react';
import { cn } from '@/lib/cn';
import { ChipSelect } from '@/components/ui/field';
import { SOURCE_LABELS, type ApplicationSource } from '@/lib/jobs/pipeline';
import {
  EXCITEMENT_MINIMUMS,
  PIPELINE_PATH,
  pipelineHref,
  type PipelineParams,
  type PipelineState,
} from '@/lib/jobs/pipeline-view';
import { CHANCE_BAND_LABELS } from '@/lib/jobs/suggest/chance-check';
import { FIT_MINIMUMS } from '@/lib/jobs/suggest/score-notes';
import { FIT_SCORE_LABEL } from '@/lib/jobs/suggest/scores';

/**
 * What Pipeline is narrowed by, as one line of chips (plan #1590): status,
 * source, excitement, fit and chance, the filters the board and the table
 * used to keep in two separate rails.
 *
 * A choice goes straight into the address, keeping everything else there. A
 * GET form underneath, with an Apply button for when scripts are off, so the
 * chips still narrow the page before JavaScript has loaded (law 6).
 */
export function PipelineFilters({
  params,
  state,
  counts,
  sources,
  scored,
}: {
  params: PipelineParams;
  state: PipelineState;
  counts: { live: number; closed: number; all: number };
  /** The sources with an application in scope, and how many each. */
  sources: readonly (readonly [ApplicationSource, number])[];
  /** Whether any application has a fit or a chance to filter by. */
  scored: boolean;
}) {
  const router = useRouter();
  // On a phone the line holds status, source and More; the other three come
  // out from behind More, or on their own once one of them is set.
  const [more, setMore] = useState(false);
  const tucked = (set: boolean) => (more || set ? undefined : 'max-sm:hidden');
  const anyTucked =
    !more && (!state.excitement || (scored && (!state.minimum.fit || state.minimum.chance === 'any')));
  const go = (changes: Partial<Record<keyof PipelineParams, string | undefined>>) =>
    router.push(pipelineHref(params, changes), { scroll: false });

  return (
    <form action={PIPELINE_PATH} className="flex flex-wrap items-center gap-x-1 gap-y-1">
      {params.view && <input type="hidden" name="view" value={params.view} />}
      {params.q && <input type="hidden" name="q" value={params.q} />}
      {state.stage && <input type="hidden" name="stage" value={state.stage.key} />}
      {state.sentDays !== null && <input type="hidden" name="sent" value={state.sentDays} />}
      {/* What a number on Today narrowed the page to (plan #1591), each with
          its own way out, ahead of the chips anybody can set here. */}
      {state.stage && (
        <ClearChip href={pipelineHref(params, { stage: undefined })} label={state.stage.label} />
      )}
      {state.sentDays !== null && (
        <ClearChip
          href={pipelineHref(params, { sent: undefined })}
          label={`Sent in the last ${state.sentDays} ${state.sentDays === 1 ? 'day' : 'days'}`}
        />
      )}
      <PressChip
        name="status"
        aria-label="Which applications"
        value={state.scope}
        onChange={(event) => {
          const value = event.currentTarget.value;
          go(value === 'live' ? { status: undefined } : { status: value, view: 'table' });
        }}
      >
        <option value="live">Live · {counts.live}</option>
        <option value="closed">Closed · {counts.closed}</option>
        <option value="all">All · {counts.all}</option>
      </PressChip>
      <PressChip
        name="source"
        aria-label="Filter by source"
        placeholderValue=""
        value={state.source ?? ''}
        onChange={(event) => go({ source: event.currentTarget.value || undefined })}
      >
        <option value="">Any source</option>
        {sources.map(([source, count]) => (
          <option key={source} value={source}>
            {SOURCE_LABELS[source]} · {count}
          </option>
        ))}
      </PressChip>
      <PressChip
        className={tucked(state.excitement !== null)}
        name="excitement"
        aria-label="Lowest excitement to show"
        placeholderValue=""
        value={state.excitement ? String(state.excitement) : ''}
        onChange={(event) => go({ excitement: event.currentTarget.value || undefined })}
      >
        <option value="">Any excitement</option>
        {EXCITEMENT_MINIMUMS.map((level) => (
          <option key={level} value={level}>
            {'★'.repeat(level)} and up
          </option>
        ))}
      </PressChip>
      {scored && (
        <PressChip
          className={tucked(state.minimum.fit > 0)}
          name="minfit"
          aria-label={`Lowest ${FIT_SCORE_LABEL.toLowerCase()} to show`}
          placeholderValue=""
          value={state.minimum.fit ? String(state.minimum.fit) : ''}
          onChange={(event) => go({ minfit: event.currentTarget.value || undefined })}
        >
          <option value="">Any {FIT_SCORE_LABEL.toLowerCase()}</option>
          {FIT_MINIMUMS.map((value) => (
            <option key={value} value={value}>
              {FIT_SCORE_LABEL} {value} and up
            </option>
          ))}
        </PressChip>
      )}
      {scored && (
        <PressChip
          className={tucked(state.minimum.chance !== 'any')}
          name="minchance"
          aria-label="Lowest chance of an interview to show"
          placeholderValue=""
          value={state.minimum.chance === 'any' ? '' : state.minimum.chance}
          onChange={(event) => go({ minchance: event.currentTarget.value || undefined })}
        >
          <option value="">Any chance of an interview</option>
          <option value="medium">{CHANCE_BAND_LABELS.medium} chance or better</option>
          <option value="high">{CHANCE_BAND_LABELS.high} chance</option>
        </PressChip>
      )}
      {anyTucked && (
        <button
          type="button"
          onClick={() => setMore(true)}
          className="press relative rounded-control px-1.5 py-0.5 text-ui text-ink-muted hover:bg-sunken hover:text-ink sm:hidden"
        >
          More
        </button>
      )}
      <noscript>
        <button type="submit" className="px-2 py-1 font-medium text-ink underline underline-offset-2">
          Apply
        </button>
      </noscript>
    </form>
  );
}

/** A filter Today set, shown as a chip that takes it off. */
function ClearChip({ href, label }: { href: string; label: string }) {
  return (
    <Link
      href={href}
      scroll={false}
      aria-label={`${label}: remove this filter`}
      className="press press-area inline-flex items-center gap-1 rounded-full bg-accent-tint px-2 py-0.5 text-ui text-ink transition-colors duration-quick hover:bg-sunken"
    >
      {label}
      <X className="size-3.5 text-ink-muted" strokeWidth={1.75} aria-hidden />
    </Link>
  );
}

/** A chip whose press area is 44px tall on a phone, as Find's are. */
function PressChip({ className, ...props }: ComponentProps<typeof ChipSelect>) {
  const id = useId();
  return (
    <span className={cn('relative inline-flex', className)}>
      <label
        htmlFor={id}
        aria-hidden
        className="absolute top-1/2 left-1/2 hidden h-11 w-full min-w-11 -translate-x-1/2 -translate-y-1/2 max-sm:block" /* ui-ok: a press area, not a control; 44px is the phone floor, as PressLabel's */
      />
      <ChipSelect id={id} {...props} className="relative" />
    </span>
  );
}

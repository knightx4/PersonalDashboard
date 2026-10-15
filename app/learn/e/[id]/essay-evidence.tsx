'use client';

import { useId, useState, useTransition } from 'react';
import { Check, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardSection } from '@/components/ui/card';
import { Chip } from '@/components/ui/chip';
import { InlineTextarea } from '@/components/ui/field';
import { IconButton } from '@/components/ui/icon-button';
import { linkVariants } from '@/components/ui/link';
import { PaidHint } from '@/components/ui/paid-hint';
import { cn } from '@/lib/cn';
import { EVIDENCE_LABELS } from '@/lib/learn/essays/evidence';
import {
  argumentMap,
  EVIDENCE_KINDS,
  SOURCES_AIM,
  withEvidenceTake,
  withoutEvidence,
  type ArgumentGap,
  type EssayPlan,
  type EvidenceKind,
  type PlanPoint,
  type PointEvidence,
  type SourceType,
} from '@/lib/learn/essays/plan';
import { textFragmentUrl } from '@/lib/learn/essays/research';
import { findPointEvidence } from './guide-actions';
import type { PlanApi } from './essay-stages';

const EVIDENCE_ACTION = 'app/learn/e/[id]/guide-actions.ts#findPointEvidence';

/** Short names for the counts on a row of the argument map. */
const KIND_SHORT: Record<EvidenceKind, string> = {
  rule: 'rule',
  for: 'evidence',
  against: 'objection',
  case: 'case',
};

const GAP_LINES: Record<ArgumentGap, string> = {
  'no-thesis':
    'No thesis yet. Every point has to serve one claim a reader could dispute; write it on the Plan step.',
  'no-points': 'No points yet.',
  unsupported:
    'Some points rest on nothing yet. Give each one a rule, a piece of evidence, a real case, or two answers from your own experience.',
  'no-objection':
    'Nothing in the plan answers the strongest objection. Find it on the point it threatens most.',
  'too-many-sources': `More than ${SOURCES_AIM} sources. Essays this length for a finance reader lean on two or three; keep the strongest.`,
  'vendor-heavy':
    'Half your sources sell something. Look for the standard or a study that says the same.',
};

/** Who published a source, toned so a vendor stands out. */
function TypeChip({ type }: { type: SourceType }) {
  const tone =
    type === 'vendor'
      ? 'caution'
      : type === 'regulator' || type === 'standard-setter'
        ? 'accent'
        : 'neutral';
  return (
    <Chip size="sm" tone={tone}>
      {type}
    </Chip>
  );
}

/**
 * The plan read as an argument, at the top of Develop: the thesis, each point
 * with what supports it, and the gaps to close first. A row is pressed to
 * work on that point.
 */
export function ArgumentMapCard({
  plan,
  chosen,
  onChoose,
}: {
  plan: EssayPlan;
  chosen: string | null;
  onChoose: (id: string) => void;
}) {
  const map = argumentMap(plan);
  return (
    <Card padding="none">
      <CardSection
        title="Your argument"
        hint="Your thesis, each point and what holds it up. Pick a point to work on."
      >
        <p className="mb-3 text-ui text-ink">
          <span className="text-ink-muted">Thesis: </span>
          {map.thesis || <span className="text-caution">not written yet</span>}
        </p>
        <ol className="flex flex-col divide-y divide-border">
          {map.reasons.map((reason, i) => {
            const on = reason.id === chosen;
            const counts = EVIDENCE_KINDS.filter((k) => reason.counts[k] > 0);
            return (
              <li key={reason.id}>
                <button
                  type="button"
                  aria-current={on ? 'true' : undefined}
                  onClick={() => onChoose(reason.id)}
                  className={cn(
                    'press flex min-h-11 w-full items-start gap-2 rounded-control px-1.5 py-2 text-left transition-colors duration-quick hover:bg-sunken lg:min-h-0',
                    on && 'bg-accent-tint',
                  )}
                >
                  <span className="w-5 shrink-0 text-right text-ui tabular-nums text-ink-muted">
                    {i + 1}.
                  </span>
                  <span className="min-w-0 flex-1 text-ui text-ink">
                    <span className="line-clamp-2">{reason.text}</span>
                    <span className="text-small text-ink-muted">
                      {[
                        reason.notes
                          ? `${reason.notes} ${reason.notes === 1 ? 'answer' : 'answers'}`
                          : null,
                        ...counts.map((k) => `${reason.counts[k]} ${KIND_SHORT[k]}`),
                      ]
                        .filter(Boolean)
                        .join(' · ') || 'nothing yet'}
                    </span>
                  </span>
                  {reason.supported ? (
                    <Check
                      className="mt-0.5 size-3.5 shrink-0 text-positive"
                      strokeWidth={1.75}
                      aria-label="Supported"
                    />
                  ) : (
                    <span className="mt-0.5 shrink-0 text-small text-caution">unsupported</span>
                  )}
                </button>
              </li>
            );
          })}
        </ol>
        <p className="mt-3 text-small text-ink-muted">
          Objection: {map.objection ? 'answered in the plan' : 'not yet'} · Sources: {map.sources}
          {map.vendors ? ` (${map.vendors} vendor)` : ''}
        </p>
        {map.gaps.filter((g) => g !== 'no-points').length > 0 && (
          <ul className="mt-2 flex list-disc flex-col gap-1 pl-4 text-ui text-ink">
            {map.gaps
              .filter((g) => g !== 'no-points')
              .map((gap) => (
                <li key={gap}>{GAP_LINES[gap]}</li>
              ))}
          </ul>
        )}
      </CardSection>
    </Card>
  );
}

/**
 * Evidence on one point (LEARN-ESSAYS-SPEC, "Evidence on a point"): four
 * buttons, each a narrow search for one kind of support, and what came back
 * kept on the point with who published it, the quoted words and a line for
 * the person's take.
 */
export function PointEvidenceCard({
  essayId,
  point,
  api,
}: {
  essayId: string;
  point: PlanPoint;
  api: PlanApi;
}) {
  const [searching, setSearching] = useState<EvidenceKind | null>(null);
  const [empty, setEmpty] = useState<EvidenceKind | null>(null);
  const [, start] = useTransition();

  const find = (kind: EvidenceKind) => {
    setSearching(kind);
    setEmpty(null);
    start(async () => {
      let found = -1;
      await api.run(async () => {
        const result = await findPointEvidence(essayId, point.id, kind);
        if (result.ok) found = result.found;
        return result;
      });
      if (found === 0) setEmpty(kind);
      setSearching(null);
    });
  };

  return (
    <Card padding="none" aria-busy={searching !== null || undefined}>
      <CardSection
        title="Evidence for this point"
        hint="Lead with the rule your reader answers to and your own experience; two or three sources carry an essay this length."
      >
        <div className="flex flex-wrap items-center gap-1.5">
          {EVIDENCE_KINDS.map((kind) => (
            <Button
              key={kind}
              type="button"
              size="sm"
              variant="secondary"
              pending={searching === kind}
              disabled={searching !== null}
              onClick={() => find(kind)}
            >
              {searching === kind ? 'Searching…' : EVIDENCE_LABELS[kind]}
            </Button>
          ))}
          <PaidHint action={EVIDENCE_ACTION} what="Cost of one search for this point" />
        </div>
        {empty && (
          <p className="mt-2 text-small text-ink-muted">
            Nothing sourced came back for “{EVIDENCE_LABELS[empty].toLowerCase()}”. Your own
            experience may be the evidence here.
          </p>
        )}
        {point.evidence.length > 0 && (
          <ul className="mt-3 flex flex-col divide-y divide-border">
            {point.evidence.map((item) => (
              <EvidenceRow key={item.id} item={item} point={point} api={api} />
            ))}
          </ul>
        )}
      </CardSection>
    </Card>
  );
}

function EvidenceRow({
  item,
  point,
  api,
}: {
  item: PointEvidence;
  point: PlanPoint;
  api: PlanApi;
}) {
  const id = useId();
  return (
    <li className="py-3 first:pt-0 last:pb-0">
      <div className="flex items-start justify-between gap-2">
        <p className="min-w-0 text-small text-ink-muted">
          <span className="font-medium text-ink">{EVIDENCE_LABELS[item.kind]}</span> ·{' '}
          <TypeChip type={item.sourceType} />
        </p>
        <IconButton
          size="sm"
          label="Remove this evidence"
          onClick={() =>
            api.change({ kind: 'drop-evidence', point: point.id, evidence: item.id }, (now) =>
              withoutEvidence(now, point.id, item.id),
            )
          }
        >
          <X strokeWidth={1.75} aria-hidden />
        </IconButton>
      </div>
      {item.title && <p className="mt-1 text-ui font-medium text-ink">{item.title}</p>}
      <p className="text-ui text-ink">
        {item.summary}{' '}
        <a
          href={textFragmentUrl(item.url, item.quote)}
          target="_blank"
          rel="noreferrer"
          title={item.sourceTitle}
          className={cn('text-small', linkVariants())}
        >
          {item.domain || item.sourceTitle}
        </a>
      </p>
      {item.quote && (
        <blockquote className="mt-1 border-l-2 border-border pl-3 text-small text-ink-muted">
          {item.quote}
        </blockquote>
      )}
      <label htmlFor={id} className="sr-only">
        Your take
      </label>
      <InlineTextarea
        id={id}
        defaultValue={item.take}
        placeholder="Your take: how it bears on your point, in your words"
        onBlur={(event) => {
          const text = event.currentTarget.value;
          if (text.trim() !== item.take.trim()) {
            api.change({ kind: 'evidence-take', point: point.id, evidence: item.id, text }, (now) =>
              withEvidenceTake(now, point.id, item.id, text),
            );
          }
        }}
        className="-mx-1 mt-1 min-h-11 text-ui text-ink lg:min-h-0"
      />
    </li>
  );
}

/** The evidence under a point in the Write step's plan card, each with Insert footnote. */
export function PlanEvidenceList({
  evidence,
  onCite,
}: {
  evidence: PointEvidence[];
  onCite?: (item: PointEvidence) => void;
}) {
  if (evidence.length === 0) return null;
  return (
    <ul className="mt-2 flex flex-col gap-2">
      {evidence.map((item) => (
        <li key={item.id}>
          <p className="text-small text-ink-muted">
            {EVIDENCE_LABELS[item.kind]} · {item.domain}
          </p>
          <p className="text-ui text-ink">{item.title || item.summary}</p>
          {item.take && <p className="text-small text-ink">You: {item.take}</p>}
          {onCite && (
            <Button
              type="button"
              size="xs"
              variant="ghost"
              onMouseDown={(event) => event.preventDefault()}
              onClick={() => onCite(item)}
            >
              Insert footnote
            </Button>
          )}
        </li>
      ))}
    </ul>
  );
}

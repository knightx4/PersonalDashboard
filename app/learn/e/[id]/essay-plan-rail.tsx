'use client';

import { Button } from '@/components/ui/button';
import { Card, CardSection } from '@/components/ui/card';
import { Disclosure } from '@/components/ui/disclosure';
import { LinkedText } from '@/components/ui/linked-text';
import { ROLE_LABELS, type EssayPlan, type PointEvidence } from '@/lib/learn/essays/plan';
import { PlanEvidenceList } from './essay-evidence';

/**
 * The plan beside the draft, in the Write step (LEARN-ESSAYS-SPEC, "The
 * stages"): the thesis, and the outline with the notes the person wrote under
 * each point. The point whose heading the cursor is under opens by itself, so
 * the notes for the section being written are the ones in view. With an
 * empty draft, Put the outline in the draft starts it with the title and one
 * heading per point, in the person's words.
 */
export function EssayPlanCard({
  plan,
  current,
  canOutline,
  onOutline,
  onEdit,
  onCite,
}: {
  plan: EssayPlan;
  /** Insert a footnote to a piece of evidence at the cursor. */
  onCite?: (item: PointEvidence) => void;
  /** The point whose heading the cursor is under, or null. */
  current: string | null;
  canOutline: boolean;
  onOutline: () => void;
  /** Go back to the stage where the plan is changed. */
  onEdit: () => void;
}) {
  const points = plan.points.filter((p) => p.text.trim());
  if (!plan.thesis.trim() && points.length === 0) {
    return (
      <Card padding="none">
        <CardSection title="Your plan">
          <p className="text-ui text-ink-muted">
            No plan yet. The Plan and Structure steps help you set out your points before you write,
            and their notes show here.
          </p>
          <Button type="button" size="sm" variant="secondary" className="mt-2" onClick={onEdit}>
            Make a plan
          </Button>
        </CardSection>
      </Card>
    );
  }
  return (
    <Card padding="none">
      <CardSection
        title="Your plan"
        action={
          <Button type="button" size="xs" variant="ghost" onClick={onEdit}>
            Edit
          </Button>
        }
      >
        {plan.thesis.trim() && (
          <p className="mb-3 text-ui text-ink">
            <span className="text-ink-muted">Thesis: </span>
            {plan.thesis.trim()}
          </p>
        )}
        <ol className="flex flex-col gap-1">
          {points.map((point, i) => (
            <li key={`${point.id}:${current === point.id}`}>
              <Disclosure
                defaultOpen={current === point.id}
                title={
                  <span className="text-ui text-ink">
                    {i + 1}. {point.text.trim()}
                  </span>
                }
                meta={point.notes.length ? `${point.notes.length}` : ROLE_LABELS[point.role]}
              >
                {point.notes.length === 0 && point.evidence.length === 0 ? (
                  <p className="text-small text-ink-muted">No notes on this point yet.</p>
                ) : (
                  <ul className="flex flex-col gap-2">
                    {point.notes.map((note, n) => (
                      <li key={n}>
                        <p className="text-small text-ink-muted">{note.ask}</p>
                        <p className="whitespace-pre-line text-ui text-ink">
                          <LinkedText text={note.answer} refs={false} />
                        </p>
                      </li>
                    ))}
                  </ul>
                )}
                <PlanEvidenceList evidence={point.evidence} onCite={onCite} />
              </Disclosure>
            </li>
          ))}
        </ol>
        {canOutline && points.length > 0 && (
          <Button type="button" size="sm" variant="primary" className="mt-3" onClick={onOutline}>
            Put the outline in the draft
          </Button>
        )}
      </CardSection>
    </Card>
  );
}

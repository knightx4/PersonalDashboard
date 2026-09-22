import { AlertTriangle, BadgeCheck } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { CardSection } from '@/components/ui/card';
import {
  commitmentLabel,
  type ClaimMaterial,
  type ClaimMaterialView,
  type MaterialAbsence,
} from '@/lib/learn/catalogue/material';
import { queueMaterial } from './actions';

/**
 * What Learn has found for this claim, and the press that queues one.
 *
 * Material is proposed here and becomes a reading when you press it, which is
 * what #725 settled: the queue stays something you assembled. The order is
 * `orderForClaim`'s and this page does not re-sort it -- what suits the rung
 * you are working at comes first, then a match a model argued for, then the
 * shorter commitment.
 *
 * Every row carries two things that are easy to mistake for one. The sentence
 * says what this material gives you about the claim, and the confidence says
 * whether anything read it before saying so. A screen that renders those
 * identically is overstating one of them, which is the rule
 * `readings.locator_basis` was written for.
 */

/**
 * How the match was arrived at.
 *
 * Ink and a shape for a judged match, and the caution colour for the one you
 * have to act on, which is the pair `LocatorLine` already uses on a reading.
 * Law 4: "something read this and argued for it" is not money coming back, so
 * it is not green.
 */
function Confidence({ row }: { row: ClaimMaterial }) {
  if (row.confidence === 'verified') {
    return (
      <span className="inline-flex items-center gap-1 text-small text-ink-muted">
        <BadgeCheck className="size-3.5 shrink-0" strokeWidth={2} aria-hidden />
        {row.model ? `Judged by ${row.model}` : 'Judged'}
      </span>
    );
  }

  return (
    <span className="inline-flex items-center gap-1 text-small text-ink-muted">
      <AlertTriangle className="size-3.5 shrink-0 text-caution" strokeWidth={2} aria-hidden />
      Near match, nothing has read it
    </span>
  );
}

function Material({ row, conceptId }: { row: ClaimMaterial; conceptId: string }) {
  return (
    <li className="row-pad first:pt-0 last:pb-0">
      <div className="flex flex-wrap items-baseline gap-x-2 gap-y-1">
        <a
          href={row.item.canonicalUrl}
          target="_blank"
          rel="noopener noreferrer"
          className="text-body font-medium text-ink hover:text-accent"
        >
          {row.item.title}
        </a>
        {row.item.author && <span className="text-small text-ink-muted">{row.item.author}</span>}
        {/* Which part of the work, in the words the catalogue keeps it in: a
            section heading, or the clip as 12:04-18:30. */}
        {row.where && <span className="text-ui text-ink-muted">{row.where}</span>}
        <span className="text-small text-ink-muted">{commitmentLabel(row)}</span>
      </div>

      <p className="mt-1 text-ui text-ink">{row.basis}</p>

      <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-2">
        {/* A plain form, so the press works before JavaScript does. Nothing
            about the material rides along: the segment is an id, and the
            sentence above is read out of the link again on the way in. */}
        <form action={queueMaterial}>
          <input type="hidden" name="conceptId" value={conceptId} />
          <input type="hidden" name="segmentId" value={row.segmentId} />
          <Button type="submit" variant="secondary" size="sm">
            Queue this
          </Button>
        </form>
        <Confidence row={row} />
      </div>
    </li>
  );
}

/**
 * Why there is nothing, which is three problems with three different fixes.
 *
 * The search runs when you press the button on the claim, so a claim with no
 * material is in one of three states and only the concept's search time tells
 * them apart. Each line says which one you are in and what would change it,
 * and no line says anybody went looking unless somebody did.
 *
 * `never-searched` names what does the searching rather than the button above
 * it, because that button is only offered on a claim you are shaky on or wrong
 * about, and this line is shown on any claim with nothing.
 */
const ABSENCE: Record<MaterialAbsence, string> = {
  'never-searched':
    'The catalogue has not been searched for this claim yet. It is searched when you ask for something to read for it.',
  'nothing-matched':
    'The catalogue was searched for this claim and nothing in it matched. More material has to be pulled in before that changes.',
  'catalogue-empty':
    'Nothing has been pulled into the catalogue yet, so there is nothing to match this claim against.',
};

/**
 * The one line a claim with no material gets.
 *
 * A line under the button that goes looking rather than a card with nothing in
 * it, which is law 1: an empty section is not rendered, and today every claim
 * in the app is in this state because the catalogue is empty.
 */
export function NoMaterialNote({ view }: { view: ClaimMaterialView }) {
  if (!view.absence) return null;

  return <p className="mt-2 text-small text-ink-muted">{ABSENCE[view.absence]}</p>;
}

export function MaterialForClaim({
  view,
  conceptId,
  className,
}: {
  view: ClaimMaterialView;
  conceptId: string;
  className?: string;
}) {
  if (view.material.length === 0) return null;

  return (
    <CardSection title="Material for this claim" className={className}>
      {/* One surface with hairlines rather than a card each, law 13. Every row
          runs to several lines, and a frame round each of them inside a card
          that already has one is the mistake law 11 names. */}
      <ul className="divide-y divide-border">
        {view.material.map((row) => (
          <Material key={row.segmentId} row={row} conceptId={conceptId} />
        ))}
      </ul>
    </CardSection>
  );
}

import { cloneElement, type ReactElement } from 'react';
import { Tooltip } from '@/components/ui/tooltip';
import { cn } from '@/lib/cn';
import { chipVariants } from '@/components/ui/chip';
import { chanceText, type ScoreFigure, type ScoreNote } from '@/lib/jobs/suggest/score-notes';
import type { ChanceBand } from '@/lib/jobs/suggest/chance-check';
import { CHANCE_LABEL, FIT_SCORE_LABEL } from '@/lib/jobs/suggest/scores';

/**
 * Fit and chance on a list row (plan #1206).
 *
 * Fit is a figure out of 100; chance is its band while CHANCE_DISPLAY says
 * so. An unsure one carries a question mark and fades, as the opening
 * answers' chips do. A row with no note draws nothing.
 */

const UNSURE_TITLE = 'Dash is not sure of this one';

/** A reason as it ends in the tooltip, with its full stop. */
function sentence(text: string): string {
  return /[.!?]$/.test(text.trim()) ? text.trim() : `${text.trim()}.`;
}

function mark(figure: ScoreFigure): string {
  return figure.unsure ? '?' : '';
}

/** The fit figure, as it reads on its own. */
export function fitText(note: ScoreNote): string | null {
  return note.fit ? `${note.fit.value}${mark(note.fit)}` : null;
}

/** The chance band (or figure), as it reads on its own. */
export function chanceFigureText(note: ScoreNote): string | null {
  return note.chance ? `${chanceText(note.chance)}${mark(note.chance)}` : null;
}

/** Both figures as chips, for beside a title. */
export function ScoreChips({ note, className }: { note: ScoreNote | null | undefined; className?: string }) {
  if (!note) return null;
  return (
    <span className={cn('inline-flex flex-wrap gap-1.5', className)}>
      {note.fit && (
        <Unsure unsure={note.fit.unsure}>
          <span className={cn(chipVariants(), note.fit.unsure && 'opacity-70')}>
            {FIT_SCORE_LABEL} {fitText(note)}
          </span>
        </Unsure>
      )}
      {note.chance && (
        <Unsure unsure={note.chance.unsure}>
          <span className={cn(chipVariants(), note.chance.unsure && 'opacity-70')}>
            {CHANCE_LABEL}: {chanceFigureText(note)?.toLowerCase()}
          </span>
        </Unsure>
      )}
    </span>
  );
}

/** What the question mark means, on hover and focus, for a figure Dash is unsure of. */
export function Unsure({
  unsure,
  children,
}: {
  unsure?: boolean;
  children: ReactElement<{ tabIndex?: number; 'aria-describedby'?: string }>;
}) {
  if (!unsure) return children;
  return <Tooltip label={UNSURE_TITLE}>{cloneElement(children, { tabIndex: 0 })}</Tooltip>;
}

/**
 * One line per figure saying what drove it, fit first. The lines carry no
 * label: each names what it counts (evidence, interviews), and the figures
 * sit beside them. Nothing when neither has a reason.
 */
export function ScoreReasons({ note, className }: { note: ScoreNote | null | undefined; className?: string }) {
  const lines = [note?.fit?.reason, note?.chance?.reason].filter((line): line is string => Boolean(line));
  if (lines.length === 0) return null;
  return (
    <span className={cn('block min-w-40 space-y-0.5 text-small font-normal text-ink-muted', className)}>
      {lines.map((line) => (
        <span key={line} className="block">
          {line}
        </span>
      ))}
    </span>
  );
}

/**
 * Both figures in micro type under a pipeline card's company, wrapping
 * rather than cut off on a narrow card. The reasons go in its tooltip: a
 * card has no room for two more lines. An unsure figure says so with the
 * question mark its text carries; it is not drawn fainter as well, which put
 * micro type under the contrast it needs (plan #1596).
 */
export function ScoreLine({ note }: { note: ScoreNote | null | undefined }) {
  if (!note) return null;
  const fit = fitText(note);
  const chance = chanceFigureText(note);
  const reasons = [
    note.fit?.reason ? `${FIT_SCORE_LABEL}: ${sentence(note.fit.reason)}` : null,
    note.chance?.reason ? `${CHANCE_LABEL}: ${sentence(note.chance.reason)}` : null,
  ].filter(Boolean);
  const figures = (
    <span
      tabIndex={reasons.length > 0 ? 0 : undefined}
      className="flex flex-wrap gap-x-2 text-micro text-ink-muted"
    >
      {fit && <span className="tabular">{FIT_SCORE_LABEL} {fit}</span>}
      {chance && (
        <span>
          {CHANCE_LABEL}: {chance.toLowerCase()}
        </span>
      )}
    </span>
  );
  if (reasons.length === 0) return figures;
  return (
    <Tooltip label={reasons.join(' ')} className="flex">
      {figures}
    </Tooltip>
  );
}

type Tone = 'good' | 'middling' | 'poor';

const TONE_CLASS: Record<Tone, string> = {
  good: 'bg-positive-tint text-positive',
  middling: 'bg-caution-tint text-caution',
  poor: 'bg-danger-tint text-danger',
};

/** Fit's tone: 70 and over is good, 50 to 69 middling, under 50 poor. */
function fitTone(value: number): Tone {
  return value >= 70 ? 'good' : value >= 50 ? 'middling' : 'poor';
}

/** Chance's tone is its band, so the colour agrees with the chance filter. */
const CHANCE_TONE: Record<ChanceBand, Tone> = { high: 'good', medium: 'middling', low: 'poor' };

/**
 * Both figures as numbers in small circles, each tinted by how good it is,
 * fit first (note 302a206e). Each says what it is and why in its tip; an
 * unsure one carries its question mark in the tip rather than the circle,
 * which has room for two digits.
 */
export function ScoreCircles({ note, className }: { note: ScoreNote | null | undefined; className?: string }) {
  if (!note || (!note.fit && !note.chance)) return null;
  return (
    <span className={cn('inline-flex shrink-0 gap-1', className)}>
      {note.fit && <ScoreCircle label={FIT_SCORE_LABEL} figure={note.fit} tone={fitTone(note.fit.value)} />}
      {note.chance && (
        <ScoreCircle label={CHANCE_LABEL} figure={note.chance} tone={CHANCE_TONE[note.chance.band]} />
      )}
    </span>
  );
}

function ScoreCircle({ label, figure, tone }: { label: string; figure: ScoreFigure; tone: Tone }) {
  const said = `${label} ${figure.value}${figure.unsure ? ', and Dash is not sure of it' : ''}`;
  const tip = figure.reason ? `${said}. ${sentence(figure.reason)}` : `${said}.`;
  return (
    <Tooltip label={tip} align="end">
      <span
        role="img"
        aria-label={said}
        className={cn(
          'tabular inline-flex size-6 items-center justify-center rounded-full text-micro font-semibold',
          TONE_CLASS[tone],
        )}
      >
        {figure.value}
      </span>
    </Tooltip>
  );
}

'use client';

import { useActionState, useState } from 'react';
import { acceptCriticStop, answerBlockedStep, type PlanActionState } from './actions';
import { Button } from '@/components/ui/button';
import { FieldError, Label, Textarea } from '@/components/ui/field';
import { QuestionPartLabel } from '@/components/dev/question';
import type { CriticStopView, StopShot, StopSurfaceView } from '@/lib/plan/ui-check-stop';

const SHOT_LABEL: Record<string, string> = {
  'phone-light': 'Phone, light',
  'phone-dark': 'Phone, dark',
  'laptop-light': 'Laptop, light',
  'laptop-dark': 'Laptop, dark',
};

function Shot({ surface, shot }: { surface: string; shot: StopShot }) {
  const label = SHOT_LABEL[shot.name] ?? shot.name;
  if (!shot.url) return null;
  return (
    <a
      href={shot.url}
      target="_blank"
      rel="noreferrer"
      className="press block space-y-1 rounded-md text-small text-ink-muted hover:text-accent"
    >
      {/* eslint-disable-next-line @next/next/no-img-element -- signed links to the private ui-shots bucket */}
      <img
        src={shot.url}
        alt={`${surface}, ${label}`}
        // ui-ok: the edge of a photograph of a screen, so a dark shot keeps its outline on the panel
        className="aspect-[3/4] w-full rounded-md border border-border bg-surface object-cover object-top"
      />
      <span>{label}</span>
    </a>
  );
}

function StoppedSurface({ view }: { view: StopSurfaceView }) {
  const shown = view.shots.filter((s) => s.url);
  return (
    <div className="space-y-2">
      <p className="text-ui text-ink">
        <span className="font-mono font-semibold">{view.surface}</span>
        <span className="text-ink-muted">
          {' '}
          · round {view.round}, {view.fixes.length} {view.fixes.length === 1 ? 'fix' : 'fixes'}
        </span>
      </p>
      {view.fixes.length > 0 && (
        <ol className="list-decimal space-y-1.5 pl-5 text-ui text-ink">
          {view.fixes.map((fix, i) => (
            <li key={i}>
              <p>{fix.problem}</p>
              {fix.change && <p className="text-ink-muted">Change: {fix.change}</p>}
              <p className="text-small text-ink-muted">
                {[SHOT_LABEL[fix.shot] ?? fix.shot, fix.where, fix.breaks]
                  .filter(Boolean)
                  .join(' · ')}
              </p>
            </li>
          ))}
        </ol>
      )}
      {shown.length > 0 ? (
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
          {shown.map((shot) => (
            <Shot key={shot.name} surface={view.surface} shot={shot} />
          ))}
        </div>
      ) : (
        <p className="text-small text-ink-muted">
          The shots were not uploaded. The session that ran this round kept them in
          .preview-shots/checks/.
        </p>
      )}
    </div>
  );
}

/**
 * A screen the design critic would not pass after its last round, and your
 * two ways on (plan #1610, decision #1535): accept it as it is, or say what to
 * change. Drawn on a blocked step whose ask says the critic stopped it.
 */
export function CriticStop({ id, view }: { id: string; view: CriticStopView }) {
  const [acceptState, acceptAction, acceptPending] = useActionState(
    acceptCriticStop,
    {} as PlanActionState,
  );
  const [redirectState, redirectAction, redirectPending] = useActionState(
    answerBlockedStep,
    {} as PlanActionState,
  );
  const [redirecting, setRedirecting] = useState(false);
  const [words, setWords] = useState('');
  const field = `critic-change-${id}`;
  const done = acceptState.message ?? redirectState.message;

  return (
    <div className="space-y-3 rounded-lg bg-caution-tint/40 px-3 py-2.5">
      <QuestionPartLabel>The critic&apos;s last round</QuestionPartLabel>
      {view.surfaces.length > 0 ? (
        view.surfaces.map((s) => <StoppedSurface key={s.surface} view={s} />)
      ) : (
        <p className="text-ui text-ink-muted">No round on record stopped this screen.</p>
      )}

      {done ? (
        <p className="text-small text-ink-muted">{done}</p>
      ) : redirecting ? (
        <form action={redirectAction} className="space-y-2">
          <input type="hidden" name="id" value={id} />
          <Label htmlFor={field}>What to change</Label>
          <Textarea
            id={field}
            name="answer"
            rows={2}
            className="min-h-12"
            autoFocus
            value={words}
            onChange={(event) => setWords(event.target.value)}
            placeholder="What the screen should do instead. The next session builds against it."
          />
          <div className="flex flex-wrap items-center gap-1">
            <Button type="submit" size="sm" pending={redirectPending}>
              Send it back
            </Button>
            <Button type="button" size="sm" variant="ghost" onClick={() => setRedirecting(false)}>
              Cancel
            </Button>
            <FieldError>{redirectState.error}</FieldError>
          </div>
        </form>
      ) : (
        <div className="flex flex-wrap items-center gap-2">
          <form action={acceptAction}>
            <input type="hidden" name="id" value={id} />
            <Button
              type="submit"
              size="sm"
              pending={acceptPending}
              disabled={view.surfaces.length === 0}
            >
              Accept as it is
            </Button>
          </form>
          <Button type="button" size="sm" variant="secondary" onClick={() => setRedirecting(true)}>
            Say what to change
          </Button>
          <FieldError>{acceptState.error}</FieldError>
        </div>
      )}
    </div>
  );
}

'use client';

import { useState, useTransition } from 'react';
import { ChevronLeft, ChevronRight, Shuffle } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { FieldError } from '@/components/ui/field';
import { IconButton } from '@/components/ui/icon-button';
import { Tooltip } from '@/components/ui/tooltip';
import {
  AVATAR_TRAITS,
  defaultAvatar,
  sameAvatar,
  shuffledAvatar,
  stepTrait,
  traitPosition,
  TRAIT_LABELS,
  withTrait,
  type AdvisorAvatar,
  type AvatarLook,
  type AvatarTrait,
} from '@/lib/you/advisor-avatar';
import { AdvisorAvatar as AvatarPicture } from './advisor-avatar';

/**
 * Changing how an advisor looks (plan #2581.3): their avatar large, Shuffle
 * for a new face, and a stepper for each trait the person can pick (hair,
 * glasses, beard). Each change is drawn on the server and shown here; Save
 * keeps it. Back to the first look returns the one they started with, and
 * saving that clears what is stored.
 */

export type DrawAvatar = (
  avatar: AdvisorAvatar,
) => Promise<{ error: string | null; svg?: string; look?: AvatarLook }>;
export type SaveAvatar = (
  advisorId: string,
  avatar: AdvisorAvatar | null,
) => Promise<{ error: string | null }>;

/** A drawing and the traits it shows. */
export type Drawn = { svg: string; look: AvatarLook };

export function AvatarEditor({
  advisor,
  start,
  draw,
  save,
  onDone,
  onDrawn,
}: {
  advisor: { id: string; key: string; name: string; avatar: AdvisorAvatar };
  /** The drawing of their current look, made when the editor was opened. */
  start: Drawn;
  draw: DrawAvatar;
  save: SaveAvatar;
  onDone: () => void;
  /**
   * Each new drawing, for a page that shows the look being tried in its own
   * avatar (the profile's header, plan #2581.5). Given it, the editor draws no
   * picture of its own, only the controls.
   */
  onDrawn?: (drawn: Drawn) => void;
}) {
  const [avatar, setAvatar] = useState(advisor.avatar);
  const [drawn, setDrawn] = useState<Drawn>(start);
  const [drawing, setDrawing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [, startTransition] = useTransition();

  const first = defaultAvatar(advisor.key);
  const changed = !sameAvatar(avatar, advisor.avatar);

  const tryOn = (next: AdvisorAvatar) => {
    setAvatar(next);
    setDrawing(true);
    setError(null);
    startTransition(async () => {
      const result = await draw(next);
      setDrawing(false);
      if (result.error || !result.svg || !result.look) {
        setError(result.error ?? 'That look could not be drawn. Try another.');
        return;
      }
      setDrawn({ svg: result.svg, look: result.look });
      onDrawn?.({ svg: result.svg, look: result.look });
    });
  };
  const step = (trait: AvatarTrait, by: 1 | -1) =>
    tryOn(withTrait(avatar, trait, stepTrait(trait, drawn.look[trait], by)));
  const keep = () => {
    setSaving(true);
    setError(null);
    startTransition(async () => {
      const result = await save(advisor.id, sameAvatar(avatar, first) ? null : avatar);
      setSaving(false);
      if (result.error) {
        setError(result.error);
        return;
      }
      onDone();
    });
  };

  return (
    <div className="space-y-3 rounded-card bg-sunken p-3 sm:w-fit sm:pr-6" aria-busy={drawing || undefined}>
      <div className="flex items-center gap-3">
        {!onDrawn && (
          <AvatarPicture
            advisorKey={advisor.key}
            name={`${advisor.name}, as drawn now`}
            size="lg"
            svg={drawn.svg}
            className={drawing ? 'opacity-60 transition-opacity duration-quick' : undefined}
          />
        )}
        <div className={onDrawn ? 'flex flex-wrap items-center gap-2' : 'flex min-w-0 flex-col items-start gap-1'}>
          <Button
            type="button"
            variant="secondary"
            size="sm"
            onClick={() => tryOn(shuffledAvatar())}
            disabled={saving}
          >
            <Shuffle aria-hidden strokeWidth={1.75} />
            Shuffle
          </Button>
          {!sameAvatar(avatar, first) && (
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={() => tryOn(first)}
              disabled={saving}
            >
              Back to the first look
            </Button>
          )}
        </div>
      </div>
      <dl className="space-y-1">
        {AVATAR_TRAITS.map((trait) => (
          <div key={trait} className="flex items-center gap-2">
            <dt className="w-16 shrink-0 text-small text-ink-muted">{TRAIT_LABELS[trait]}</dt>
            <dd className="flex items-center gap-1">
              <Tooltip label={`Previous ${TRAIT_LABELS[trait].toLowerCase()}`}>
                <IconButton
                  label={`Previous ${TRAIT_LABELS[trait].toLowerCase()}`}
                  size="sm"
                  onClick={() => step(trait, -1)}
                  disabled={saving}
                >
                  <ChevronLeft aria-hidden strokeWidth={1.75} />
                </IconButton>
              </Tooltip>
              <span className="tabular w-16 text-center text-small text-ink" aria-live="polite">
                {traitPosition(trait, drawn.look[trait])}
              </span>
              <Tooltip label={`Next ${TRAIT_LABELS[trait].toLowerCase()}`}>
                <IconButton
                  label={`Next ${TRAIT_LABELS[trait].toLowerCase()}`}
                  size="sm"
                  onClick={() => step(trait, 1)}
                  disabled={saving}
                >
                  <ChevronRight aria-hidden strokeWidth={1.75} />
                </IconButton>
              </Tooltip>
            </dd>
          </div>
        ))}
      </dl>
      <FieldError>{error}</FieldError>
      <div className="flex flex-wrap items-center gap-2">
        <Button type="button" size="sm" onClick={keep} disabled={!changed || saving || drawing}>
          {saving ? 'Saving…' : 'Save'}
        </Button>
        <Button type="button" variant="ghost" size="sm" onClick={onDone} disabled={saving}>
          Cancel
        </Button>
      </div>
    </div>
  );
}

'use client';

import { createContext, useContext, useMemo } from 'react';
import { cn } from '@/lib/cn';
import { avatarSymbolId } from '@/lib/you/advisor-avatar';
import { initials } from '@/lib/you/board-questions';

/**
 * Every advisor's illustrated avatar (plan #2581.3), the one mark an advisor
 * has wherever they appear: the debate and its drawer, the roster, a panel,
 * the Ask form and the minutes.
 *
 * The drawings are made on the server (lib/you/advisor-avatar-draw.ts) into
 * one hidden sprite that AdvisorAvatars puts on the page, and each avatar
 * points at its advisor's symbol. An advisor missing from the sprite shows
 * their initials in the same disc.
 *
 * The disc is a light ground in every theme, since the drawings are black
 * line art: the You tint in a light theme, a pale mix of the You colour in a
 * dark one.
 */

const AvatarKeys = createContext<ReadonlySet<string> | null>(null);

/** The light disc behind each drawing, in both themes. */
export const AVATAR_GROUND =
  'light-dark(var(--c-w-you-tint), color-mix(in srgb, var(--c-w-you) 45%, white))';
/** Initials on that disc: the page's ink in a light theme, its dark canvas in a dark one. */
const AVATAR_INK = 'light-dark(var(--c-ink), var(--c-canvas))';

export function AdvisorAvatars({
  sprite,
  keys,
  children,
}: {
  /** The <symbol>s avatarSprite drew. */
  sprite: string;
  /** The advisors it holds. */
  keys: readonly string[];
  children: React.ReactNode;
}) {
  const set = useMemo(() => new Set(keys), [keys]);
  return (
    <AvatarKeys value={set}>
      <svg
        aria-hidden
        width="0"
        height="0"
        className="pointer-events-none absolute size-0 overflow-hidden"
        dangerouslySetInnerHTML={{ __html: `<defs>${sprite}</defs>` }}
      />
      {children}
    </AvatarKeys>
  );
}

export type AvatarSize = 'sm' | 'md' | 'lg';

const SIZES: Record<AvatarSize, string> = {
  sm: 'size-5 text-micro',
  md: 'size-9 text-small',
  lg: 'size-24 text-title',
};

/**
 * One advisor's avatar, labelled with their name. Small sits inline beside
 * a name in a line of text, medium leads a row, large heads a profile.
 */
export function AdvisorAvatar({
  advisorKey,
  name,
  size = 'sm',
  svg,
  decorative = false,
  className,
}: {
  advisorKey: string;
  name: string;
  size?: AvatarSize;
  /** A drawing to show in place of the sprite's, as the profile's editor does while choosing. */
  svg?: string;
  /** The name is written beside it inside the same control or heading, so it is not read twice. */
  decorative?: boolean;
  className?: string;
}) {
  const keys = useContext(AvatarKeys);
  const drawn = svg !== undefined || (keys?.has(advisorKey) ?? false);
  return (
    <span
      role={decorative ? undefined : 'img'}
      aria-label={decorative ? undefined : name}
      aria-hidden={decorative || undefined}
      style={{ background: AVATAR_GROUND, color: AVATAR_INK }}
      className={cn(
        'inline-flex shrink-0 items-center justify-center overflow-hidden rounded-pill font-semibold leading-none',
        SIZES[size],
        className,
      )}
    >
      {svg !== undefined ? (
        <span
          aria-hidden
          className="size-full [&>svg]:size-full"
          dangerouslySetInnerHTML={{ __html: svg }}
        />
      ) : drawn ? (
        <svg aria-hidden className="size-full">
          <use href={`#${avatarSymbolId(advisorKey)}`} />
        </svg>
      ) : (
        <span aria-hidden className="tabular">
          {initials(name)}
        </span>
      )}
    </span>
  );
}

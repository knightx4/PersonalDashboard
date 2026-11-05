/**
 * Each advisor's illustrated avatar (plan #2581.3): what is stored in
 * you.board_advisors.avatar, the looks chosen for the advisors the board
 * started with, and the traits the person can pick on a profile.
 *
 * The drawing is DiceBear's Notionists style (CC0), drawn to SVG on the
 * server by advisor-avatar-draw.ts. This file holds no drawing code, so a
 * client component can import it without carrying DiceBear to the browser.
 *
 * A guest's look is chosen from well-known public descriptions (glasses,
 * hair, a beard), never traced from a photograph: it is an impression, and
 * the roster says so.
 */

export const AVATAR_STYLE = 'notionists';

/** The traits the person can pick, in the order the profile lists them. */
export const AVATAR_TRAITS = ['hair', 'glasses', 'beard'] as const;
export type AvatarTrait = (typeof AVATAR_TRAITS)[number];

export const TRAIT_LABELS: Record<AvatarTrait, string> = {
  hair: 'Hair',
  glasses: 'Glasses',
  beard: 'Beard',
};

const variants = (n: number): string[] =>
  Array.from({ length: n }, (_, i) => `variant${String(i + 1).padStart(2, '0')}`);

/** Every drawing a trait has in Notionists; glasses and beard can also be none. */
export const TRAIT_VARIANTS: Record<AvatarTrait, readonly string[]> = {
  hair: [...variants(63), 'hat'],
  glasses: variants(11),
  beard: variants(12),
};

/** The traits with a "none" choice, drawn or not by DiceBear's probability option. */
const OPTIONAL: Partial<Record<AvatarTrait, 'glassesProbability' | 'beardProbability'>> = {
  glasses: 'glassesProbability',
  beard: 'beardProbability',
};

/** The other parts DiceBear draws, which may be pinned in stored options but are not picked on a profile. */
type OtherPart = 'body' | 'eyes' | 'brows' | 'lips' | 'nose';
const OTHER_PARTS: Record<OtherPart, readonly string[]> = {
  body: variants(25),
  eyes: variants(5),
  brows: variants(13),
  lips: variants(30),
  nose: variants(20),
};

/** DiceBear's own options for one drawing: each part a one-item list, and a probability for the optional ones. */
export type AvatarOptions = Partial<Record<AvatarTrait | OtherPart, string[]>> &
  Partial<Record<'glassesProbability' | 'beardProbability', number>>;

/** What you.board_advisors.avatar holds (migration you_0029). */
export type AdvisorAvatar = {
  style: typeof AVATAR_STYLE;
  seed: string;
  options: AvatarOptions;
};

/** One trait as the person sees it: a variant, or none. */
export type TraitValue = string | null;

const pick = (variant: string): string[] => [variant];
const look = (seed: string, options: AvatarOptions): AdvisorAvatar => ({
  style: AVATAR_STYLE,
  seed,
  options,
});
const none = { glassesProbability: 0, beardProbability: 0 } as const;

/**
 * The looks of the advisors the board started with. The five seats are
 * invented characters; each guest is drawn from how they are usually
 * described: Buffett's glasses and thinning white hair, Franklin's
 * spectacles and long hair, Jobs's round glasses, da Vinci's long hair and
 * beard, Washington's tied-back hair. Notionists has no stubble, so Jobs
 * has a short chin beard in its place.
 */
export const SEEDED_AVATARS: Record<string, AdvisorAvatar> = {
  hiring_manager: look('hiring_manager', {
    ...none,
    hair: pick('variant29'),
    glasses: pick('variant03'),
    glassesProbability: 100,
  }),
  mentor: look('mentor', {
    ...none,
    hair: pick('variant42'),
    beard: pick('variant06'),
    beardProbability: 100,
  }),
  skeptic: look('skeptic', { ...none, hair: pick('variant44'), brows: pick('variant10') }),
  cfo: look('cfo', {
    ...none,
    hair: pick('variant25'),
    glasses: pick('variant08'),
    glassesProbability: 100,
  }),
  dreamer: look('dreamer', { ...none, hair: pick('variant46') }),
  buffett: look('buffett', {
    ...none,
    hair: pick('variant42'),
    glasses: pick('variant03'),
    glassesProbability: 100,
  }),
  franklin: look('franklin', {
    ...none,
    hair: pick('variant41'),
    glasses: pick('variant08'),
    glassesProbability: 100,
  }),
  jobs: look('jobs', {
    ...none,
    hair: pick('variant60'),
    glasses: pick('variant11'),
    glassesProbability: 100,
    beard: pick('variant12'),
    beardProbability: 100,
  }),
  da_vinci: look('da_vinci', {
    ...none,
    hair: pick('variant58'),
    beard: pick('variant02'),
    beardProbability: 100,
  }),
  washington: look('washington', { ...none, hair: pick('variant39') }),
  dalio: look('dalio', { ...none, hair: pick('variant15') }),
  dimon: look('dimon', { ...none, hair: pick('variant05') }),
  richard_feynman: look('richard_feynman', { ...none, hair: pick('variant33') }),
  marcus_aurelius: look('marcus_aurelius', {
    ...none,
    hair: pick('variant22'),
    beard: pick('variant02'),
    beardProbability: 100,
  }),
  seneca: look('seneca', {
    ...none,
    hair: pick('variant49'),
    beard: pick('variant01'),
    beardProbability: 100,
  }),
  socrates: look('socrates', {
    ...none,
    hair: pick('variant60'),
    beard: pick('variant02'),
    beardProbability: 100,
  }),
};

/** The look with nothing stored: the seeded one for a known key, otherwise one drawn from the key itself. */
export function defaultAvatar(key: string): AdvisorAvatar {
  return SEEDED_AVATARS[key] ?? look(key, { glassesProbability: 30, beardProbability: 20 });
}

const PART_VALUES: Record<string, readonly string[]> = { ...TRAIT_VARIANTS, ...OTHER_PARTS };

/**
 * A stored avatar, or null when it is missing or not the shape stored. Only
 * the parts and variants Notionists draws are kept, so whatever a run wrote
 * reaches DiceBear as options it knows.
 */
export function parseAvatar(value: unknown): AdvisorAvatar | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const v = value as Record<string, unknown>;
  if (v.style !== undefined && v.style !== AVATAR_STYLE) return null;
  if (typeof v.seed !== 'string' || !v.seed.trim() || v.seed.length > 100) return null;
  const raw =
    v.options && typeof v.options === 'object' && !Array.isArray(v.options)
      ? (v.options as Record<string, unknown>)
      : {};
  const options: AvatarOptions = {};
  for (const [part, allowed] of Object.entries(PART_VALUES)) {
    const list = raw[part];
    const first = Array.isArray(list) ? list[0] : typeof list === 'string' ? list : undefined;
    if (typeof first === 'string' && allowed.includes(first))
      options[part as AvatarTrait | OtherPart] = [first];
  }
  for (const key of ['glassesProbability', 'beardProbability'] as const) {
    const n = raw[key];
    if (typeof n === 'number' && Number.isFinite(n))
      options[key] = Math.min(100, Math.max(0, Math.round(n)));
  }
  return look(v.seed, options);
}

/** The look an advisor is drawn with: what is stored, or the default for their key. */
export function avatarFor(key: string, stored: unknown): AdvisorAvatar {
  return parseAvatar(stored) ?? defaultAvatar(key);
}

/**
 * The avatar with one trait set: a variant pinned, or for glasses and beard
 * null for none. Hair has no none.
 */
export function withTrait(
  avatar: AdvisorAvatar,
  trait: AvatarTrait,
  value: TraitValue,
): AdvisorAvatar {
  const options: AvatarOptions = { ...avatar.options };
  const probability = OPTIONAL[trait];
  if (value === null) {
    if (!probability) return avatar;
    delete options[trait];
    options[probability] = 0;
  } else {
    if (!TRAIT_VARIANTS[trait].includes(value)) return avatar;
    options[trait] = [value];
    if (probability) options[probability] = 100;
  }
  return { ...avatar, options };
}

/** The value after `value` in a trait's list, going round, with none between the last and the first where a trait has it. */
export function stepTrait(trait: AvatarTrait, value: TraitValue, by: 1 | -1): TraitValue {
  const list: TraitValue[] = OPTIONAL[trait]
    ? [null, ...TRAIT_VARIANTS[trait]]
    : [...TRAIT_VARIANTS[trait]];
  const at = Math.max(0, list.indexOf(value));
  return list[(at + by + list.length) % list.length];
}

/** Where a trait's value sits in its list, as "12 of 64" or "None". */
export function traitPosition(trait: AvatarTrait, value: TraitValue): string {
  if (value === null) return 'None';
  const at = TRAIT_VARIANTS[trait].indexOf(value);
  return `${at + 1} of ${TRAIT_VARIANTS[trait].length}`;
}

/** A new look from a fresh seed, nothing pinned: the shuffle. `random` is injected so a test can fix it. */
export function shuffledAvatar(random: () => number = Math.random): AdvisorAvatar {
  const seed = Math.floor(random() * 2 ** 32).toString(36);
  return look(seed, { glassesProbability: 30, beardProbability: 20 });
}

/** Two looks draw the same picture. */
export function sameAvatar(a: AdvisorAvatar, b: AdvisorAvatar): boolean {
  return (
    a.seed === b.seed && JSON.stringify(sortKeys(a.options)) === JSON.stringify(sortKeys(b.options))
  );
}

function sortKeys(o: AvatarOptions): [string, unknown][] {
  return Object.entries(o).sort(([x], [y]) => x.localeCompare(y));
}

/** The traits an avatar shows, as the drawing resolved them (DiceBear picks unpinned parts from the seed). */
export type AvatarLook = Record<AvatarTrait, TraitValue>;

/** The id a sprite symbol has for one advisor, safe for an HTML id. */
export function avatarSymbolId(key: string): string {
  return `advisor-avatar-${key.replace(/[^a-z0-9_]/gi, '_')}`;
}

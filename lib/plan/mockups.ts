/** The private bucket holding the pictures kept with questions (plan #2810, migration 0290). */
export const PLAN_MOCKUPS_BUCKET = 'plan-mockups';

/** The two widths a mockup is kept at: a phone and a laptop. */
export const MOCKUP_WIDTHS = [390, 1280] as const;
export type MockupWidth = (typeof MOCKUP_WIDTHS)[number];

/** One stored picture with a link that can be shown for a while (plan #2810.2). */
export type MockupPicture = {
  /** The option it shows, or null for the whole question. */
  letter: string | null;
  width: MockupWidth;
  url: string;
  /** Where the interactive mockup opens. */
  link: string | null;
};

/**
 * The pictures to draw for one option: its phone and laptop shots, when it
 * has them. Letters compare without case, as the options do.
 */
export function picturesFor(pictures: readonly MockupPicture[], letter: string | null) {
  const mine = pictures.filter((p) =>
    letter === null ? p.letter === null : p.letter?.toUpperCase() === letter.toUpperCase(),
  );
  return {
    phone: mine.find((p) => p.width === 390) ?? null,
    laptop: mine.find((p) => p.width === 1280) ?? null,
  };
}

/** True when any picture belongs to a lettered option. */
export function hasOptionPictures(pictures: readonly MockupPicture[]): boolean {
  return pictures.some((p) => p.letter !== null);
}

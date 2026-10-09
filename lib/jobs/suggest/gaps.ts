/**
 * What is missing from the person's setup that quietly changes what the
 * searches do. Each gap says what it changes, so a filter that is off because
 * nothing was set reads as a choice to make rather than going unnoticed (on
 * 9 October 2026 an empty home location let in startups from everywhere for
 * a day before anyone saw why). Find shows them under what you are aiming
 * at, and the daily health check counts them. Pure, so both share the rule.
 */
import type { JobPreferences } from './preferences';

export type SetupGap = {
  key: 'home' | 'titles' | 'goals' | 'resume' | 'jev' | 'fit';
  /** What is missing and what that does to the searches, in one sentence. */
  text: string;
  /** Where it is set, when the app has a page for it. */
  href: string | null;
};

export type SetupState = {
  preferences: JobPreferences;
  targetTitles: readonly string[];
  goalEntries: number;
  hasResume: boolean;
  jevOn: boolean;
  minFitScore: number;
};

export function setupGaps(state: SetupState): SetupGap[] {
  const gaps: SetupGap[] = [];
  if (!state.preferences.homeLocation) {
    gaps.push({
      key: 'home',
      text: 'No home location is set, so roles and startups from anywhere are shown.',
      href: '/jobs/settings',
    });
  }
  if (state.targetTitles.length === 0) {
    gaps.push({
      key: 'titles',
      text: 'No target titles are set, so roles are matched on your career goals alone and startup discovery does not run.',
      href: '/jobs/find',
    });
  }
  if (state.goalEntries === 0) {
    gaps.push({
      key: 'goals',
      text: 'No career goals entry is written, so the searches know only your titles and CV.',
      href: '/jobs/find#career-goals',
    });
  }
  if (!state.hasResume) {
    gaps.push({
      key: 'resume',
      text: 'No CV with readable text is on file, so fit is judged without it.',
      href: '/jobs/settings',
    });
  }
  if (!state.jevOn) {
    gaps.push({
      key: 'jev',
      text: 'Jev scoring is off for this account, so roles carry no fit score and your lowest fit score is not applied.',
      href: null,
    });
  } else if (state.minFitScore <= 0) {
    gaps.push({
      key: 'fit',
      text: 'Your lowest fit score is 0, so every role is shown however weak a fit.',
      href: '/jobs/settings',
    });
  }
  return gaps;
}

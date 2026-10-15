import { SettingsPage } from '@/components/patterns/settings-page';
import { Banner } from '@/components/ui/banner';
import type { JobPreferences } from '@/lib/jobs/suggest/preferences';
import type { TabAddress } from '@/lib/tabs';
import { ThoughtList, type ThoughtView } from './career-goals';
import {
  BookmarkletSection,
  ExcludedSendersSection,
  InboxSection,
  PreferenceFields,
  SearchFields,
  type InboxAccount,
} from './view';

/** The page's own three tones, in the four the Banner primitive names. */
const BANNER_TONE = { ok: 'info', warn: 'warn', err: 'bad' } as const;

export type JobsSettingsProps = {
  /** What Gmail's sign-in came back with, as the page words it; null when it did not. */
  banner: { tone: 'ok' | 'warn' | 'err'; text: string } | null;
  gmailConfigured: boolean;
  appOrigin: string;
  profile: {
    searchStartedOn: string;
    ghostThresholdDays: number;
    /** Whether the Jobs Inbox lists the nudges (job_nudges source). */
    showNudges: boolean;
    preferences: JobPreferences;
    /** The lowest Jev fit score a recommended role may have (fit-gate.ts). */
    minFitScore?: number;
  };
  accounts: InboxAccount[];
  excludedSenders: Array<{ id: string; domain: string }>;
  /** The career goals entries, newest first, which the searches read. */
  careerGoals: ThoughtView[];
  /** `searchParams.tab`: the open tab. */
  tab?: string | string[];
  /** The gallery's: the tab the row marks when the address names none. */
  opensOn?: string;
};

/**
 * Job search settings on the settings page pattern (plan #1937.11): six
 * sections behind tabs. Links from before the tabs pointed at `#inboxes`,
 * `#bookmarklet` and `#career-goals`, and the strip moves each onto its tab.
 * Coming back from Gmail's sign-in (`?inbox=`) opens Inboxes, where the
 * banner saying how it went is drawn.
 */
export function JobsSettingsView({
  banner,
  gmailConfigured,
  appOrigin,
  profile,
  accounts,
  excludedSenders,
  careerGoals,
  tab,
  opensOn,
}: JobsSettingsProps) {
  const address: TabAddress = {
    anchors: { inboxes: 'inboxes', bookmarklet: 'bookmarklet', 'career-goals': 'career-goals' },
    belongsTo: { inbox: 'inboxes' },
    ...(opensOn ? { opensOn } : banner ? { opensOn: 'inboxes' } : {}),
  };
  return (
    <SettingsPage
      title="Job search settings"
      href="/jobs/settings"
      tab={tab}
      address={address}
      sections={[
        {
          id: 'search',
          title: 'Search',
          content: () => (
            <SearchFields
              searchStartedOn={profile.searchStartedOn}
              ghostThresholdDays={profile.ghostThresholdDays}
              showNudges={profile.showNudges}
            />
          ),
        },
        {
          id: 'next-job',
          title: 'Next job',
          hint: 'Rules for the roles Dash recommends. A posting below the pay floor, at a workplace not chosen, or scored below the lowest fit is left out; none chosen means any.',
          content: () => (
            <PreferenceFields preferences={profile.preferences} minFitScore={profile.minFitScore} />
          ),
        },
        {
          id: 'career-goals',
          title: 'Career goals',
          content: () => <ThoughtList thoughts={careerGoals} />,
        },
        {
          id: 'inboxes',
          title: 'Inboxes',
          content: () => (
            <div className="space-y-4">
              {/* `ok` maps to `info` rather than to `good`: the good tone
                  means money came back and nothing else (law 4). */}
              {banner && <Banner tone={BANNER_TONE[banner.tone]}>{banner.text}</Banner>}
              <InboxSection accounts={accounts} gmailConfigured={gmailConfigured} />
            </div>
          ),
        },
        {
          id: 'bookmarklet',
          title: 'Bookmarklet',
          content: () => <BookmarkletSection appOrigin={appOrigin} />,
        },
        {
          id: 'senders',
          title: 'Senders',
          content: () => <ExcludedSendersSection excludedSenders={excludedSenders} />,
        },
      ]}
    />
  );
}

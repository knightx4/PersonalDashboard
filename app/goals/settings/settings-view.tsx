import Link, { linkVariants } from '@/components/ui/link';
import { SettingsPage } from '@/components/patterns/settings-page';
import { SettingSwitch } from '@/components/patterns/settings-fields';
import type { GoalSettings } from '@/lib/goals/settings-store';
import { setGoalRun } from './actions';

/**
 * Goals settings (plan #1937.10): whether Dash's two scheduled goal runs
 * start. Every run either makes is listed on Runs, linked from here.
 */
export function GoalsSettingsView({ settings }: { settings: GoalSettings }) {
  return (
    <SettingsPage
      title="Goals settings"
      href="/goals/settings"
      sections={[
        {
          id: 'morning',
          title: 'Morning run',
          content: (
            <>
              <SettingSwitch
                title="Run every morning"
                hint="Reads statements from your email, closes steps it finds evidence for, writes a status for each goal and readies the steps Dash can do."
                defaultChecked={settings.morningRun}
                save={setGoalRun.bind(null, 'morningRun')}
              />
              <p className="pt-1 text-small text-ink-muted">
                Every run it has made is on{' '}
                <Link href="/goals/runs" className={linkVariants()}>
                  Runs
                </Link>
                . The day it counts from follows your timezone, under{' '}
                <Link href="/account" className={linkVariants()}>
                  Account
                </Link>
                .
              </p>
            </>
          ),
        },
        {
          id: 'weekly',
          title: 'Weekly run',
          content: (
            <SettingSwitch
              title="Run once a week"
              hint="Suggests events, reading, courses and job leads for the goals that ask for help, each one a suggestion for you to take or leave."
              defaultChecked={settings.weeklyRun}
              save={setGoalRun.bind(null, 'weeklyRun')}
            />
          ),
        },
      ]}
    />
  );
}

import { ChevronRight } from 'lucide-react';
import Link from '@/components/ui/link';
import { SettingsPage } from '@/components/patterns/settings-page';
import { SettingSelect, SettingSwitch } from '@/components/patterns/settings-fields';
import { TEACH_BACK_RATES, teachBackRateLabel } from '@/lib/learn/feed/teach-back';
import { setGoalsOnly, setOfferSubjects, setTeachBackRate } from './actions';

export type LearnSettings = {
  /** Whether Now and Practice Flow draw from your goals alone. */
  goalsOnly: boolean;
  /** Whether a subject built from a theme in your notes is offered. */
  offerSubjects: boolean;
  /** One card in this many on Now asks you to explain an idea back; 0 for never. */
  teachBackEvery: number;
};

/**
 * Learn settings (plan #1937.10): what Learn offers you without being asked.
 * The subject offer was on Subjects with no way to stop it but Never on each
 * card, and the teach-back rate only on the card itself, which is still
 * there for changing it in passing. Goals only (plan #2164.1) is first,
 * since it decides what the rest draw from.
 */
export function LearnSettingsView({ settings }: { settings: LearnSettings }) {
  return (
    <SettingsPage
      title="Learn settings"
      href="/learn/settings"
      sections={[
        {
          id: 'goals',
          title: 'Goals',
          content: (
            <SettingSwitch
              title="Only from your goals"
              hint="Off, Practice asks about every subject you have prepared, and Now mixes in themes from your notes and fields you have not been tested in. On, both draw only from the subjects your goals point at."
              defaultChecked={settings.goalsOnly}
              save={setGoalsOnly}
            />
          ),
        },
        {
          id: 'subjects',
          title: 'Subjects',
          content: (
            <SettingSwitch
              title="Offer subjects from your notes"
              hint="When you have no subject for a theme you write about often, Subjects offers one built from it, and so does Practice while Only from your goals is off."
              defaultChecked={settings.offerSubjects}
              save={setOfferSubjects}
            />
          ),
        },
        {
          id: 'now',
          title: 'Now',
          content: (
            <SettingSelect
              title="Explain-back cards"
              hint="How often a card on Now asks you to explain an idea you kept in your own words."
              options={TEACH_BACK_RATES.map((rate) => ({
                value: String(rate),
                label: teachBackRateLabel(rate),
              }))}
              defaultValue={String(settings.teachBackEvery)}
              save={setTeachBackRate}
            />
          ),
        },
        {
          id: 'external',
          title: 'External check',
          content: (
            <Link
              href="/learn/settings/external"
              className="-mx-2 flex items-start justify-between gap-4 rounded-control px-2 py-2 transition-colors hover:bg-sunken max-sm:min-h-11"
            >
              <span className="min-w-0">
                <span className="block text-ui text-ink">External sets</span>
                <span className="mt-0.5 block text-small text-ink-muted">
                  Published questions answered once and scored, to compare your progress against.
                </span>
              </span>
              <ChevronRight aria-hidden strokeWidth={1.75} className="mt-0.5 size-4 shrink-0 text-ink-muted" />
            </Link>
          ),
        },
      ]}
    />
  );
}

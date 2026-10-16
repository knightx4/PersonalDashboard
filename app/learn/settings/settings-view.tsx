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
      description="What Learn offers you without being asked."
      sections={[
        {
          id: 'goals',
          title: 'Goals',
          content: (
            <SettingSwitch
              title="Only from your goals"
              hint="Now and Practice draw only from the goals you set. Turn it off to mix in themes from your notes, fields you have not been tested in, and questions about subjects in your notes."
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
      ]}
    />
  );
}

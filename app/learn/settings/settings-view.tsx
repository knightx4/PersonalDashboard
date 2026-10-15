import { SettingsPage } from '@/components/patterns/settings-page';
import { SettingSelect, SettingSwitch } from '@/components/patterns/settings-fields';
import { TEACH_BACK_RATES, teachBackRateLabel } from '@/lib/learn/feed/teach-back';
import { setOfferSubjects, setTeachBackRate } from './actions';

export type LearnSettings = {
  /** Whether a subject built from a theme in your notes is offered. */
  offerSubjects: boolean;
  /** One card in this many on Now asks you to explain an idea back; 0 for never. */
  teachBackEvery: number;
};

/**
 * Learn settings (plan #1937.10): what Learn offers you without being asked.
 * The subject offer was on Subjects with no way to stop it but Never on each
 * card, and the teach-back rate only on the card itself, which is still
 * there for changing it in passing.
 */
export function LearnSettingsView({ settings }: { settings: LearnSettings }) {
  return (
    <SettingsPage
      title="Learn settings"
      href="/learn/settings"
      description="What Learn offers you without being asked."
      sections={[
        {
          id: 'subjects',
          title: 'Subjects',
          content: (
            <SettingSwitch
              title="Offer subjects from your notes"
              hint="When you have no subject for a theme you write about often, Subjects and Practice offer one built from it."
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

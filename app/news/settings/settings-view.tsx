import { SettingsPage } from '@/components/patterns/settings-page';
import { SettingText } from '@/components/patterns/settings-fields';
import { Banner } from '@/components/ui/banner';
import type { DeliveryGap } from '@/lib/news/inbound/readiness';
import { NEWS_TOPICS, type NewsTopic } from '@/lib/news/issues/topics';
import { AddressCard } from './address-card';
import { TopicPicker } from './hidden-topics';
import { replaceAddress, setLocalArea } from './actions';

/**
 * News settings on the settings page pattern (plan #1937.11), drawn from what
 * the page read (page.tsx), so the gallery can draw it from fixtures (plan
 * #1603). Three sections, so they stack.
 */
export function NewsSettingsView({
  address,
  gap,
  hidden,
  localArea,
}: {
  /** The whole address, or null when the deployment has no mail domain. */
  address: string | null;
  gap: DeliveryGap;
  hidden: NewsTopic[];
  localArea: string | null;
}) {
  return (
    <SettingsPage
      title="News settings"
      href="/news/settings"
      sections={[
        {
          id: 'address',
          title: 'Your newsletter address',
          content: (
            <div className="space-y-4">
              {address ? (
                <AddressCard address={address} onReplace={replaceAddress} />
              ) : (
                <Banner tone="bad">
                  This deployment has no mail domain set, so there is no address to show. Set
                  NEWS_MAIL_DOMAIN to the domain Mailgun receives on. The random half of your
                  address already exists and will not change when you do.
                </Banner>
              )}
              {gap === 'no-signing-key' && (
                <Banner tone="bad">
                  This address cannot receive anything yet. MAILGUN_SIGNING_KEY is not set, so
                  the app cannot prove a delivery came from Mailgun and answers every one with an
                  error. Copy the HTTP webhook signing key from Mailgun (Sending → Webhooks, not
                  the API key) into the deployment&rsquo;s settings. The address itself is fine
                  and does not change.
                </Banner>
              )}
            </div>
          ),
        },
        {
          id: 'local',
          title: 'Local news',
          content: (
            <SettingText
              title="Your area"
              titleHidden
              defaultValue={localArea ?? ''}
              placeholder="Your city or area, like NYC"
              save={setLocalArea}
            />
          ),
        },
        {
          id: 'topics',
          title: 'Topics in Quick read',
          content: (
            <div className="space-y-4">
              <TopicPicker topics={NEWS_TOPICS} hidden={hidden} />
              <p className="text-ui text-ink-muted">
                Hidden topics still appear in the newsletter list.
              </p>
            </div>
          ),
        },
      ]}
    />
  );
}

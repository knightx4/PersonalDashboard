import { PageHeader } from '@/components/shell/page-header';
import { Banner } from '@/components/ui/banner';
import { Card, CardBody, CardHeader, CardTitle } from '@/components/ui/card';
import type { DeliveryGap } from '@/lib/news/inbound/readiness';
import { NEWS_TOPICS, type NewsTopic } from '@/lib/news/issues/topics';
import { AddressCard } from './address-card';
import { TopicPicker } from './hidden-topics';
import { LocalAreaField } from './local-area';
import { replaceAddress } from './actions';

/**
 * News settings, drawn from what the page read (page.tsx), so the gallery
 * can draw it from fixtures (plan #1603).
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
    <div className="mx-auto max-w-2xl">
      <PageHeader title="News settings" />

      <div className="space-y-5">
        <Card>
          <CardHeader>
            <CardTitle>Your newsletter address</CardTitle>
          </CardHeader>
          <CardBody className="space-y-4">
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
                This address cannot receive anything yet. MAILGUN_SIGNING_KEY is not set, so the
                app cannot prove a delivery came from Mailgun and answers every one with an
                error. Copy the HTTP webhook signing key from Mailgun (Sending → Webhooks, not
                the API key) into the deployment&rsquo;s settings. The address itself is fine and
                does not change.
              </Banner>
            )}
          </CardBody>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Local news</CardTitle>
          </CardHeader>
          <CardBody>
            <LocalAreaField area={localArea} />
          </CardBody>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Topics in Quick read</CardTitle>
          </CardHeader>
          <CardBody className="space-y-4">
            <TopicPicker topics={NEWS_TOPICS} hidden={hidden} />
            <p className="text-ui text-ink-muted">
              Hidden topics still appear in the newsletter list.
            </p>
          </CardBody>
        </Card>
      </div>
    </div>
  );
}

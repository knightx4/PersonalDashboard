import { PageHeader } from '@/components/shell/page-header';
import { Banner } from '@/components/ui/banner';
import { Card, CardBody, CardHeader, CardTitle } from '@/components/ui/card';
import { ConfirmStep } from '@/components/ui/confirm-step';
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
      <PageHeader
        title="News settings"
        description="The address newsletters are sent to, how to replace it, where Local news is about, and which topics Quick read shows."
      />

      <div className="space-y-5">
        <Card>
          <CardHeader>
            <CardTitle>Your newsletter address</CardTitle>
          </CardHeader>
          <CardBody className="space-y-4">
            {address ? (
              <AddressCard address={address} />
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
            <p className="text-body leading-relaxed text-ink-muted">
              Sign newsletters up with this instead of your own email and they arrive in News.
              Anyone who learns it can send to it, which is why it is random and why you can swap
              it for another.
            </p>
          </CardBody>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Replace it</CardTitle>
          </CardHeader>
          <CardBody className="space-y-4">
            <p className="text-body leading-relaxed text-ink-muted">
              A new address is made and the one above stops working straight away. Anything sent to
              it after that is dropped, so every newsletter you still want has to be signed up
              again with the new one. Nothing already here is deleted.
            </p>
            <ConfirmStep
              action={replaceAddress}
              prompt="The address above stops working as soon as the new one exists."
              confirmLabel="Yes, replace it"
              confirmVariant="danger"
              align="start"
              variant="secondary"
              size="md"
            >
              Replace my address
            </ConfirmStep>
          </CardBody>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Local news</CardTitle>
          </CardHeader>
          <CardBody className="space-y-3">
            <LocalAreaField area={localArea} />
            <p className="text-body leading-relaxed text-ink-muted">
              {localArea
                ? `Stories mainly about ${localArea} are filed under Local. Newsletters that arrive from now on are tagged this way; ones already here keep the topic they had.`
                : 'Name where you live and stories mainly about it are filed under Local.'}
            </p>
          </CardBody>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Topics in Quick read</CardTitle>
          </CardHeader>
          <CardBody className="space-y-4">
            <p className="text-body leading-relaxed text-ink-muted">
              Quick read shows stories on the ticked topics. Press a topic to hide it, and again to
              bring it back. Hidden topics still show in the newsletter list and in each newsletter.
            </p>
            <TopicPicker topics={NEWS_TOPICS} hidden={hidden} />
          </CardBody>
        </Card>
      </div>
    </div>
  );
}

import { PageHeader } from '@/components/shell/page-header';
import { Banner } from '@/components/ui/banner';
import { Card, CardBody, CardHeader, CardTitle } from '@/components/ui/card';
import { requireUser } from '@/lib/auth/server';
import { newsAddress, newsDomainOrNull } from '@/lib/news/address';
import { createNewsClient } from '@/lib/news/auth/server';
import { deliveryGap } from '@/lib/news/inbound/readiness';
import { loadHiddenTopics } from '@/lib/news/quick/hidden-topics';
import { loadOrCreateLocalPart } from '@/lib/news/settings/address';
import { ConfirmStep } from '@/components/ui/confirm-step';
import { AddressCard } from './address-card';
import { HiddenTopicList } from './hidden-topics';
import { LocalAreaField } from './local-area';
import { loadLocalArea } from '@/lib/news/settings/local-area';
import { replaceAddress } from './actions';

export const metadata = { title: 'News settings' };
export const dynamic = 'force-dynamic';

/**
 * The address, and the topics hidden from Quick read (plan #861).
 *
 * Opening this page for the first time is what creates the address -- there
 * is no button to press before the workspace works, and nothing to seed by
 * hand.
 */
export default async function NewsSettingsPage() {
  const user = await requireUser();
  const client = await createNewsClient();
  const [localPart, hidden, localArea] = await Promise.all([
    loadOrCreateLocalPart(client, user.id),
    loadHiddenTopics(client),
    loadLocalArea(client),
  ]);
  const domain = newsDomainOrNull();
  const address = domain ? newsAddress(localPart, domain) : null;
  const gap = deliveryGap();

  return (
    <div className="mx-auto max-w-2xl">
      <PageHeader
        title="News settings"
        description="The address newsletters are sent to, how to replace it, where Local news is about, and the topics kept out of Quick read."
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
            <CardTitle>Hidden from Quick read</CardTitle>
          </CardHeader>
          <CardBody className="space-y-4">
            <p className="text-body leading-relaxed text-ink-muted">
              {hidden.length
                ? 'Stories on these topics are left out of Quick read. They still show in the newsletter list and in each newsletter.'
                : 'Nothing is hidden from Quick read.'}
            </p>
            {hidden.length > 0 && <HiddenTopicList topics={hidden} />}
          </CardBody>
        </Card>
      </div>
    </div>
  );
}

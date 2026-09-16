import { PageHeader } from '@/components/shell/page-header';
import { Banner } from '@/components/ui/banner';
import { Card, CardBody, CardHeader, CardTitle } from '@/components/ui/card';
import { requireUser } from '@/lib/auth/server';
import { newsAddress, newsDomainOrNull } from '@/lib/news/address';
import { createNewsClient } from '@/lib/news/auth/server';
import { loadOrCreateLocalPart } from '@/lib/news/settings/address';
import { ConfirmStep } from '@/components/ui/confirm-step';
import { AddressCard } from './address-card';
import { replaceAddress } from './actions';

export const metadata = { title: 'News settings' };
export const dynamic = 'force-dynamic';

/**
 * The address, which is the whole of what there is to configure.
 *
 * Opening this page for the first time is what creates it -- there is no
 * button to press before the workspace works, and nothing to seed by hand.
 */
export default async function NewsSettingsPage() {
  const user = await requireUser();
  const client = await createNewsClient();
  const localPart = await loadOrCreateLocalPart(client, user.id);
  const domain = newsDomainOrNull();
  const address = domain ? newsAddress(localPart, domain) : null;

  return (
    <div className="mx-auto max-w-2xl">
      <PageHeader
        title="News settings"
        description="The address newsletters are sent to, and how to replace it."
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
      </div>
    </div>
  );
}

import 'server-only';

import { newsDomainOrNull } from '@/lib/news/address';
import { mailgunSigningKeyOrNull } from '@/lib/news/providers/mailgun';

/**
 * Whether this deployment can actually take delivery of a newsletter.
 *
 * Two variables stand between an address and a message arriving, and missing
 * either is silent in a way that costs real mail: you copy the address, sign
 * up somewhere, and wait. `NEWS_MAIL_DOMAIN` missing at least shows -- there
 * is no address to display. `MAILGUN_SIGNING_KEY` missing showed nothing at
 * all: the address rendered, the page promised that newsletters sent to it
 * arrive here, and every post from Mailgun was answered 500 and stored
 * nowhere.
 *
 * So the pages ask this instead of assuming. It answers for the deployment,
 * not for the account -- what is not checked here, because no code can, is
 * whether the domain's MX records actually point at Mailgun. A domain with
 * SPF and DKIM but no MX looks configured from in here and takes no mail at
 * all; docs/SETUP.md is the list to walk when this says yes and nothing
 * arrives anyway.
 */
export type DeliveryGap = 'no-domain' | 'no-signing-key' | null;

export function deliveryGap(): DeliveryGap {
  if (!newsDomainOrNull()) return 'no-domain';
  if (!mailgunSigningKeyOrNull()) return 'no-signing-key';
  return null;
}

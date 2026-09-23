import { domainFromAddress } from '@/lib/email/extract/classify';
import { isSharedSenderDomain } from '@/lib/merchants/platform';

export type SenderDomainChoice =
  | { ok: true; domain: string }
  | { ok: false; reason: string };

/**
 * Which domain to mute when the person excludes a review email's sender.
 *
 * Reply-To comes first, because a shop on a hosted platform sends From the
 * platform (shopifyemail.com) and puts its own address in Reply-To. A domain
 * many shops share is never written, following the job review's refusal of
 * ATS domains: if Reply-To is a help desk or PayPal, From is tried instead,
 * and if both are shared the exclusion is refused with the reason.
 */
export function chooseExclusionDomain(opts: {
  fromAddress: string | null;
  replyToAddress: string | null;
}): SenderDomainChoice {
  const candidates = [domainFromAddress(opts.replyToAddress), domainFromAddress(opts.fromAddress)];
  const known = candidates.filter((domain): domain is string => Boolean(domain));
  if (known.length === 0) {
    return { ok: false, reason: 'This email has no sender address to exclude.' };
  }

  const own = known.find((domain) => !isSharedSenderDomain(domain));
  if (own) return { ok: true, domain: own };

  return {
    ok: false,
    reason: `${known[0]} sends mail for many shops, so excluding it would stop all of them. Dismiss this email instead.`,
  };
}

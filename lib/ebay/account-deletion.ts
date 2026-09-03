/**
 * eBay marketplace account deletion / closure notifications.
 *
 * eBay requires every production application to either receive these or claim
 * an exemption; an application that does neither is marked Non Compliant and
 * has its production keyset restricted, which reads from the outside like
 * credentials that simply stopped working.
 *
 * This app never sees an eBay user. It authenticates with client credentials,
 * reads active listings, and keeps one number per ISBN — no usernames, no item
 * ids, no eBay account identifiers. So there is nothing to erase when a
 * notification arrives, and the handler's whole job is to prove the endpoint is
 * ours and acknowledge.
 */
import { createHash } from 'node:crypto';

/** Where the handler lives. Registered with eBay, and hashed into the reply. */
export const EBAY_DELETION_PATH = '/api/ebay/account-deletion';

/** eBay's rule: 32–80 characters of alphanumerics, underscore and hyphen. */
const VERIFICATION_TOKEN_RE = /^[A-Za-z0-9_-]{32,80}$/;

export function isValidVerificationToken(
  token: string | null | undefined,
): token is string {
  return typeof token === 'string' && VERIFICATION_TOKEN_RE.test(token);
}

/**
 * The reply to eBay's challenge.
 *
 * SHA-256 over the three values concatenated in this order — challenge code,
 * then verification token, then the endpoint URL — hex encoded. The order is
 * not negotiable and the endpoint must be byte-identical to the one registered
 * in the developer portal, which is what most failed validations come down to.
 */
export function challengeResponse(params: {
  challengeCode: string;
  verificationToken: string;
  endpoint: string;
}): string {
  return createHash('sha256')
    .update(params.challengeCode + params.verificationToken + params.endpoint, 'utf8')
    .digest('hex');
}

/**
 * The endpoint URL to hash, which must equal the one registered with eBay.
 *
 * Same shape as the Gmail redirect URI for the same reason: a preview
 * deployment answering on a vercel.app host must still hash the production URL
 * eBay was given, or validation fails on every deploy that is not production.
 */
export function ebayDeletionEndpointUrl(options: {
  /** Explicit override, for when the registered URL is not the app's own. */
  configuredUrl?: string | null;
  appUrl: string;
}): string {
  const configured = options.configuredUrl?.trim();
  if (configured) return configured.replace(/\/$/, '');
  return `${options.appUrl.trim().replace(/\/$/, '')}${EBAY_DELETION_PATH}`;
}

/**
 * Which mail the recurring-payments linker claims, from the sender and subject.
 *
 * The free half of the linker: nothing here fetches a body or calls a model.
 * A claimed message has its body read by Haiku (extract.ts), which still says
 * "not recurring" for a one-off purchase, so this errs towards claiming where a
 * subject could go either way ("Your receipt from Notion"). What it must not
 * claim is order mail: a confirmation, a shipping notice or a refund is the
 * commerce linker's, and costs a model call here for nothing.
 */

import { bareAddress, domainFromAddress } from '@/lib/email/extract/classify';

export type RecurringHint = 'subscription' | 'bill' | 'price_change' | 'cancelled';

export type RecurringVerdict =
  | { claim: true; hint: RecurringHint; reason: 'subject' | 'sender' }
  | { claim: false; reason: 'order' | 'noise' | 'no_match' };

/**
 * Senders whose payment mail is recurring by nature: streaming, software,
 * news, phone, broadband, power, insurance. Matched on the domain or any
 * subdomain of it. A sender here is claimed on any money-shaped subject, not
 * only a subscription-shaped one, because "Your receipt" from Spotify is always
 * a subscription charge.
 */
export const KNOWN_BILLER_DOMAINS: readonly string[] = [
  // Streaming and media
  'netflix.com',
  'spotify.com',
  'hulu.com',
  'hulumail.com',
  'disneyplus.com',
  'max.com',
  'hbomax.com',
  'peacocktv.com',
  'paramountplus.com',
  'crunchyroll.com',
  'audible.com',
  'siriusxm.com',
  'patreon.com',
  'nytimes.com',
  'wsj.com',
  'washingtonpost.com',
  'economist.com',
  'theatlantic.com',
  'newyorker.com',
  'ft.com',
  // Software
  'openai.com',
  'anthropic.com',
  'notion.so',
  'dropbox.com',
  'adobe.com',
  'microsoft.com',
  'canva.com',
  'grammarly.com',
  'duolingo.com',
  'headspace.com',
  'calm.com',
  '1password.com',
  'github.com',
  'zoom.us',
  'linkedin.com',
  // Fitness and memberships
  'classpass.com',
  'onepeloton.com',
  'equinox.com',
  'strava.com',
  // Phone, broadband, utilities
  'verizon.com',
  'verizonwireless.com',
  'att.com',
  'att-mail.com',
  't-mobile.com',
  'mintmobile.com',
  'xfinity.com',
  'comcast.net',
  'spectrum.com',
  'spectrum.net',
  'charter.net',
  'optimum.net',
  'coned.com',
  'nationalgrid.com',
  'nationalgridus.com',
  'pge.com',
  'sce.com',
  'duke-energy.com',
  // Insurance
  'geico.com',
  'progressive.com',
  'statefarm.com',
  'lemonade.com',
  'allstate.com',
];

/**
 * Mail from these senders is billing for many things at once (Apple and
 * Google bill every app's subscription). Their receipts are claimed and the
 * model names the actual service.
 */
export const STORE_BILLER_DOMAINS: readonly string[] = ['apple.com', 'google.com', 'amazon.com'];

/**
 * The payee keys (payeeKey in extraction.ts) that name a store rather than
 * anything it sells: "Apple", "Google Play", "Amazon.com". A store biller's
 * receipt filed under one of these is a misreading, since the store bills for
 * many subscriptions at once (plan #1212). "Apple TV", "AppleCare+" and
 * "Amazon Prime" are real services and have keys of their own.
 */
export const STORE_PAYEE_KEYS: readonly string[] = [
  'apple',
  'appstore',
  'itunes',
  'google',
  'googleplay',
  'amazon',
];

/** Whether the sender is one of the stores above, by domain or subdomain. */
export function isStoreBiller(fromAddress: string | null): boolean {
  return matchesDomain(
    domainFromAddress(bareAddress(fromAddress) ?? fromAddress),
    STORE_BILLER_DOMAINS,
  );
}

/**
 * Subjects about something paid for repeatedly. The money words alone
 * ("payment", "receipt") are too broad: they need a subscription word, or a
 * known biller, before the linker claims them.
 */
const SUBSCRIPTION_SUBJECT =
  /\b(?:subscription|subscribed|membership|renew(?:al|s|ed|ing)?|auto-?renew\w*|free trial|trial (?:ends|ending|is ending|expires)|recurring (?:payment|charge|billing)|billing (?:period|cycle|statement|reminder)|your (?:\w+ ){0,3}plan (?:has|will|is|renews|was)|annual plan|monthly plan|premium (?:plan|membership|receipt))\b/i;

const BILL_SUBJECT =
  /\b(?:(?:your )?(?:\w+ ){0,2}bill (?:is (?:ready|available|due)|due|reminder)|(?:e-?)?bill (?:is )?(?:ready|available)|statement is (?:ready|available)|new (?:e-?)?statement|payment (?:is )?due|upcoming payment|autopay|auto-?pay|scheduled payment|payment (?:scheduled|reminder))\b/i;

const PRICE_CHANGE_SUBJECT =
  /\b(?:price (?:change|increase|update|adjustment)|(?:changes?|update|updates|changing|increase) (?:to|in) your (?:\w+ )?(?:price|plan|subscription|rate|membership)|new (?:price|pricing|rate)|rate (?:change|increase))\b/i;

const CANCEL_SUBJECT =
  /\b(?:subscription|membership|plan) (?:has been |was |is )?(?:cancel(?:l)?ed|ended|ending|expired)|cancel(?:l)?ation (?:of your|confirmed|confirmation)\b/i;

/** Money-shaped subjects from a known biller. */
const MONEY_SUBJECT =
  /\b(?:receipt|payment|paid|bill|billing|billed|charge[ds]?|invoice|statement|renew\w*|membership|subscription|plan|price|trial|autopay)\b/i;

/**
 * Order mail. The commerce linker's, and one-off: an order confirmation,
 * shipping, delivery, a return or a refund.
 */
const ORDER_SUBJECT =
  /\b(?:order(?:ed)?\b|shipped|shipment|on the way|out for delivery|delivered|delivery|tracking|return(?:ed|s)?\b|refund(?:ed)?)/i;

/**
 * Subjects that name a subscription but are not a payment: newsletter opt-ins
 * and mail preferences, and job mail about a company called something like
 * "Alternative Payments".
 */
const NOISE_SUBJECT =
  /\b(?:confirm your (?:email|subscription)|subscription confirmed|you(?:'re| are) (?:now )?subscribed|unsubscribe|email preferences|newsletter|thank(?:s| you) for (?:your )?(?:applying|application|interest)|your application|interview)\b/i;

function matchesDomain(domain: string | null, list: readonly string[]): boolean {
  if (!domain) return false;
  return list.some((d) => domain === d || domain.endsWith(`.${d}`));
}

/**
 * Decide from the envelope alone. Pure, so the rules are tested against the
 * saved messages without a database or a model.
 */
export function classifyRecurring(input: {
  fromAddress: string | null;
  subject: string | null;
}): RecurringVerdict {
  const subject = (input.subject ?? '').trim();
  if (!subject) return { claim: false, reason: 'no_match' };

  // The sender's own domain, then the bare address's, for "Name via X" forms.
  const domain = domainFromAddress(bareAddress(input.fromAddress) ?? input.fromAddress);
  const knownBiller = matchesDomain(domain, KNOWN_BILLER_DOMAINS);
  const storeBiller = matchesDomain(domain, STORE_BILLER_DOMAINS);

  if (NOISE_SUBJECT.test(subject)) return { claim: false, reason: 'noise' };

  const subscriptionWord =
    SUBSCRIPTION_SUBJECT.test(subject) ||
    BILL_SUBJECT.test(subject) ||
    PRICE_CHANGE_SUBJECT.test(subject);

  // Order mail stays the commerce linker's unless the subject itself says it
  // is about a subscription ("Your order for a 12-month membership" is rare,
  // and the model sorts it out).
  if (ORDER_SUBJECT.test(subject) && !subscriptionWord) {
    return { claim: false, reason: 'order' };
  }

  if (CANCEL_SUBJECT.test(subject)) return { claim: true, hint: 'cancelled', reason: 'subject' };
  if (PRICE_CHANGE_SUBJECT.test(subject)) {
    return { claim: true, hint: 'price_change', reason: 'subject' };
  }
  if (BILL_SUBJECT.test(subject)) return { claim: true, hint: 'bill', reason: 'subject' };
  if (SUBSCRIPTION_SUBJECT.test(subject)) {
    return { claim: true, hint: 'subscription', reason: 'subject' };
  }

  if ((knownBiller || storeBiller) && MONEY_SUBJECT.test(subject)) {
    return { claim: true, hint: 'subscription', reason: 'sender' };
  }

  // A payment processor's receipt for a named company: Stripe and Paddle
  // send these for most software subscriptions.
  if (/\byour (?:\w+ )?receipt from\b/i.test(subject) || /\breceipt #?\d/i.test(subject)) {
    return { claim: true, hint: 'subscription', reason: 'subject' };
  }

  return { claim: false, reason: 'no_match' };
}

/**
 * Gmail subject terms for the catch-up over older mail (sync-account.ts
 * catchUpAccount). Wider than the rules above on purpose: listing is cheap and
 * the rules decide what is claimed.
 */
export const RECURRING_SUBJECT_TERMS: readonly string[] = [
  'subscription',
  'membership',
  'renewal',
  'renews',
  'renewed',
  '"free trial"',
  '"your bill"',
  '"bill is ready"',
  'statement',
  'autopay',
  '"payment due"',
  '"payment received"',
  '"price change"',
  '"price increase"',
  'receipt',
  'invoice',
  'billing',
];

/**
 * The Gmail search the catch-up pages through. A year and a month back, so an
 * annual renewal is seen at least once. Subjects only: a sender clause would
 * list every marketing email a streaming service has sent.
 */
export function recurringCatchUpQuery(): string {
  const subjects = RECURRING_SUBJECT_TERMS.map((t) => `subject:${t}`).join(' OR ');
  return `newer_than:400d (${subjects})`;
}

/**
 * Bumped whenever the rules or the query widen, so the catch-up runs again
 * over mail it has already paged through.
 */
export const RECURRING_CATCH_UP_VERSION = 1;

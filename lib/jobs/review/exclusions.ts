import { isKnownAtsSender, isSchedulingSender } from '@/lib/jobs/email/ats-senders';

/**
 * Which of a company's domains it is safe to stop listening to.
 *
 * A company record collects the domains its mail arrives from, and not all of
 * them belong to the company. `no-reply@us.greenhouse-mail.io` is how most of
 * this mail is sent, and greenhouse.io is on the record of every Greenhouse
 * customer -- excluding it to stop hearing from one employer would silence all
 * of them at once, permanently and invisibly, which is the worst shape a
 * mistake in this app can take. Scheduling tools are the same argument.
 *
 * So the exclusion is offered only over domains the employer itself owns. A
 * company with none on file gets no button rather than a button that would do
 * the wrong thing.
 */
export function excludableDomains(domains: readonly (string | null)[] | null): string[] {
  const out: string[] = [];
  for (const raw of domains ?? []) {
    if (!raw) continue;
    const domain = raw.trim().toLowerCase();
    if (!domain) continue;
    if (isKnownAtsSender(domain) || isSchedulingSender(domain)) continue;
    if (!out.includes(domain)) out.push(domain);
  }
  return out;
}

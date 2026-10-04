import type { ApplicationSource } from '@/lib/jobs/pipeline';

/**
 * The channel a pursuit opened from mail gets.
 *
 * Recruiter inbound means the recruiter wrote first, and only a message read
 * as recruiter outreach says that. An interview invite or a scheduling email
 * with no application behind it almost always means the confirmation was
 * never found, not that nobody applied: all 59 pursuits once labelled inbound
 * this way turned out to be cold applications (plan #1588). So everything
 * else is a portal application until you say otherwise on the role page.
 */
export function channelForMessage(classification: string | null | undefined): ApplicationSource {
  return classification === 'recruiter_outreach' ? 'recruiter_inbound' : 'portal';
}

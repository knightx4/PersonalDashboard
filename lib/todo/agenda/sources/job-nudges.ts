import 'server-only';

import { sessionClients } from '@/lib/todo/agenda/clients';
import { loadNudges, nudgesWanted, type UnpreppedRound } from '@/lib/jobs/today/nudges';
import type { DebriefDue } from '@/lib/jobs/today/debrief';
import type { AgendaItem, AgendaSource, SourceContext } from '@/lib/todo/agenda/sources';

/**
 * Two nudges Jobs' Today used to draw (plan #1937.14): a round that has ended
 * with nothing written about it, and a round coming up with no prep. Off
 * unless the person turned "Nudges" on at /jobs/settings, because the note of
 * 18 September asked for them to go.
 *
 * The switch is on the profile rather than Todo's source switches, so the
 * source is always on and asks the profile itself. Neither row has a Done:
 * writing the debrief or the prep is what clears it.
 */

export function debriefItem(round: DebriefDue): AgendaItem {
  return {
    key: `job_nudges:debrief:${round.key}`,
    source: 'job_nudges',
    ref: `job_search.interviews:${round.leadId}`,
    title: `Write up your ${round.companyName.trim() || 'interview'} round`,
    day: null,
    onYouSince: round.scheduledAt,
    at: null,
    link: {
      href: `/jobs/roles/${round.roleId}?tab=interviews&interview=${round.leadId}`,
      label: `${round.companyName} · ${round.roleTitle}`,
    },
    action: null,
    detail: 'The round is over and nothing is written about it',
    completable: false,
    workspace: 'jobs',
  };
}

export function prepItem(round: UnpreppedRound): AgendaItem {
  return {
    key: `job_nudges:prep:${round.key}`,
    source: 'job_nudges',
    ref: `job_search.interviews:${round.leadId}`,
    title: `Prepare for your ${round.companyName.trim() || 'interview'} round`,
    day: null,
    onYouSince: null,
    at: round.scheduledAt,
    link: {
      href: `/jobs/roles/${round.roleId}?tab=interviews&interview=${round.leadId}`,
      label: `${round.companyName} · ${round.roleTitle}`,
    },
    action: null,
    detail: 'No prep notes yet',
    completable: false,
    workspace: 'jobs',
  };
}

export const jobNudgesSource: AgendaSource = {
  id: 'job_nudges',
  label: 'Interview nudges',
  module: 'jobs',
  alwaysOn: true,
  description: 'Rounds to write up and rounds with no prep, when Nudges is on in Job search settings.',

  async fetch(ctx: SourceContext): Promise<AgendaItem[]> {
    const supabase = await (ctx.clients ?? sessionClients).jobs();
    if (!(await nudgesWanted(supabase, ctx.userId))) return [];
    const { debriefs, unprepped } = await loadNudges(supabase, ctx.userId, ctx.now);
    return [...debriefs.map(debriefItem), ...unprepped.map(prepItem)];
  },
};

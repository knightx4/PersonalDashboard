/**
 * Who is worth contacting, before any model is asked.
 *
 * The model writes the why and the message; which people it may choose from
 * is decided here, from the pipeline and the contact list, so the choice can
 * be tested and a person turned down is never offered again the next day.
 *
 * Two kinds of candidate:
 * - a contact already on file, scored by how much a message could do now
 *   (someone at a company with a live application beats a recruiter from a
 *   closed one, and a friend or former colleague beats a cold name);
 * - a company with a live application and nobody on file there, where the
 *   suggestion is to find the right person and send a short note.
 */

const DAY_MS = 24 * 60 * 60 * 1000;

/** A message within this many days is recent enough to leave the person alone. */
export const TOUCH_REST_DAYS = 14;
/** A person or company turned down is not offered again for this long. */
export const DISMISS_REST_DAYS = 45;
/** A suggestion acted on is not repeated for this long. */
export const DONE_REST_DAYS = 21;
/** A recruiter from a closed application is worth a reconnect after this long. */
export const RECONNECT_AFTER_DAYS = 30;
/** How many candidates the model chooses from. */
export const MAX_CANDIDATES = 12;

/** Statuses where the application is still going and a message can change it. */
export const LIVE_STATUSES = new Set([
  'lead',
  'drafting',
  'submitted',
  'acknowledged',
  'in_process',
  'final_round',
  'offer',
]);

/** Live and already sent, so there is someone reading it to be found. */
const SENT_STATUSES = new Set(['submitted', 'acknowledged', 'in_process', 'final_round', 'offer']);
const INTERVIEWING = new Set(['in_process', 'final_round', 'offer']);
const WARM = new Set(['friend', 'former_colleague', 'alum', 'second_degree']);

export type ContactFact = {
  id: string;
  name: string;
  title: string | null;
  relationship: string;
  status: string;
  howWeConnect: string | null;
  notes: string | null;
  companyId: string | null;
  hasEmail: boolean;
  hasLinkedin: boolean;
  /** The newest outbound touch, if any. */
  lastTouchAt: string | null;
};

export type ApplicationFact = {
  companyId: string;
  companyName: string;
  roleTitle: string;
  status: string;
  submittedAt: string | null;
  /** The newest event on it, for "last heard". */
  lastEventAt: string | null;
  lastEventSummary: string | null;
};

export type PastSuggestion = {
  kind: string;
  status: string;
  contactId: string | null;
  companyId: string | null;
  createdAt: string;
  actedAt: string | null;
};

export type Candidate = {
  /** What the model names it by: `c1`, `c2`, ... */
  ref: string;
  contactId: string | null;
  companyId: string | null;
  companyName: string | null;
  /** The person's name, or null for a company with nobody on file. */
  name: string | null;
  score: number;
  /** Plain lines the model reads. */
  facts: string[];
};

function daysSince(iso: string | null, now: Date): number {
  if (!iso) return Number.POSITIVE_INFINITY;
  return (now.getTime() - new Date(iso).getTime()) / DAY_MS;
}

/** Whether a past suggestion about this contact or company still rules it out. */
function resting(past: readonly PastSuggestion[], match: (s: PastSuggestion) => boolean, now: Date): boolean {
  return past.some((s) => {
    if (s.kind !== 'reach_out' || !match(s)) return false;
    if (s.status === 'open') return true;
    const days = daysSince(s.actedAt ?? s.createdAt, now);
    if (s.status === 'dismissed') return days < DISMISS_REST_DAYS;
    return days < DONE_REST_DAYS;
  });
}

function applicationLine(app: ApplicationFact, now: Date): string {
  const parts = [`${app.roleTitle} at ${app.companyName}: ${app.status.replace(/_/g, ' ')}`];
  if (app.submittedAt) parts.push(`applied ${Math.round(daysSince(app.submittedAt, now))} days ago`);
  if (app.lastEventAt) {
    const last = `last activity ${Math.round(daysSince(app.lastEventAt, now))} days ago`;
    parts.push(app.lastEventSummary ? `${last} (${app.lastEventSummary})` : last);
  }
  return parts.join('; ');
}

export function pickReachOutCandidates(
  input: {
    contacts: readonly ContactFact[];
    applications: readonly ApplicationFact[];
    past: readonly PastSuggestion[];
  },
  now: Date = new Date(),
): Candidate[] {
  const byCompany = new Map<string, ApplicationFact[]>();
  for (const app of input.applications) {
    const list = byCompany.get(app.companyId) ?? [];
    list.push(app);
    byCompany.set(app.companyId, list);
  }
  const companyName = (id: string | null) => (id ? (byCompany.get(id)?.[0]?.companyName ?? null) : null);

  const scored: Omit<Candidate, 'ref'>[] = [];

  for (const contact of input.contacts) {
    if (contact.status === 'dormant') continue;
    if (daysSince(contact.lastTouchAt, now) < TOUCH_REST_DAYS) continue;
    if (!contact.hasEmail && !contact.hasLinkedin && !WARM.has(contact.relationship)) continue;
    if (resting(input.past, (s) => s.contactId === contact.id, now)) continue;

    const apps = contact.companyId ? (byCompany.get(contact.companyId) ?? []) : [];
    const live = apps.filter((app) => LIVE_STATUSES.has(app.status));
    let score = 1;
    if (live.length > 0) {
      score = 3;
      if (live.some((app) => INTERVIEWING.has(app.status))) score += 1;
    } else if (WARM.has(contact.relationship)) {
      score = 2.5;
    } else if (
      contact.relationship === 'recruiter' &&
      contact.status === 'responded' &&
      apps.length > 0 &&
      apps.every((app) => daysSince(app.lastEventAt ?? app.submittedAt, now) > RECONNECT_AFTER_DAYS)
    ) {
      // A recruiter who wrote back once and has heard nothing since: the
      // role closed, but they hire for others.
      score = 2;
    }
    if (WARM.has(contact.relationship) && live.length > 0) score += 1;

    const facts = [
      `Person: ${contact.name}${contact.title ? `, ${contact.title}` : ''}${
        companyName(contact.companyId) ? ` at ${companyName(contact.companyId)}` : ''
      }`,
      `Relationship: ${contact.relationship.replace(/_/g, ' ')}; status: ${contact.status.replace(/_/g, ' ')}`,
      `Reachable by: ${[contact.hasEmail && 'email', contact.hasLinkedin && 'LinkedIn'].filter(Boolean).join(' and ') || 'unknown'}`,
    ];
    if (contact.lastTouchAt) {
      facts.push(`Last message from you: ${Math.round(daysSince(contact.lastTouchAt, now))} days ago`);
    } else {
      facts.push('You have never messaged them from here.');
    }
    if (contact.howWeConnect) facts.push(`How you know them: ${contact.howWeConnect}`);
    if (contact.notes) facts.push(`Notes: ${contact.notes.slice(0, 400)}`);
    for (const app of apps.slice(0, 3)) facts.push(`Application: ${applicationLine(app, now)}`);

    scored.push({
      contactId: contact.id,
      companyId: contact.companyId,
      companyName: companyName(contact.companyId),
      name: contact.name,
      score,
      facts,
    });
  }

  // Companies with a sent application and nobody on file to talk to.
  const covered = new Set(
    input.contacts.filter((c) => c.status !== 'dormant' && c.companyId).map((c) => c.companyId as string),
  );
  for (const [companyId, apps] of byCompany) {
    if (covered.has(companyId)) continue;
    const sent = apps.filter((app) => SENT_STATUSES.has(app.status));
    if (sent.length === 0) continue;
    if (resting(input.past, (s) => s.contactId === null && s.companyId === companyId, now)) continue;

    let score = 2;
    if (sent.some((app) => INTERVIEWING.has(app.status))) score += 1;
    // A referral still helps while the application is being read.
    else if (sent.some((app) => daysSince(app.submittedAt, now) <= 21)) score += 0.5;

    scored.push({
      contactId: null,
      companyId,
      companyName: apps[0].companyName,
      name: null,
      score,
      facts: [
        `Company with nobody on file: ${apps[0].companyName}`,
        ...sent.slice(0, 3).map((app) => `Application: ${applicationLine(app, now)}`),
      ],
    });
  }

  return scored
    .sort((a, b) => b.score - a.score || (a.name ?? a.companyName ?? '').localeCompare(b.name ?? b.companyName ?? ''))
    .slice(0, MAX_CANDIDATES)
    .map((candidate, index) => ({ ...candidate, ref: `c${index + 1}` }));
}

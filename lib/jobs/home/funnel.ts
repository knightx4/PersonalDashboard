import { applicationMove } from '@/lib/jobs/move';
import { formatRate, type ApplicationEventKind, type ApplicationStatus } from '@/lib/jobs/pipeline';

/**
 * The funnel at the top of Now: where every role in the search stands, and how
 * much moved between the stages in the last FUNNEL_WINDOW_DAYS days.
 *
 * PURE. The page reads the rows (funnel-load.ts) and the gallery passes
 * fixtures; both come here.
 *
 * Six stages. Sourcing is Dash's open suggestions; the other five are the
 * live applications. Traction and Waiting split the ones a person has
 * answered by whose move it is, the rule Todo uses (lib/jobs/move.ts), so the
 * split is worked out and never guessed.
 */

export const FUNNEL_WINDOW_DAYS = 30;
/** How long a role sits in one stage before its bead is drawn hollow. */
export const STALE_DAYS = 14;

export const FUNNEL_STAGES = ['sourcing', 'leads', 'applied', 'traction', 'waiting', 'offers'] as const;
export type FunnelStageKey = (typeof FUNNEL_STAGES)[number];

export interface FunnelItem {
  id: string;
  name: string;
  what: string;
  /** Days since it last moved; null when the date is not known. */
  days: number | null;
  stale: boolean;
  href: string;
}

export interface FunnelStage {
  key: FunnelStageKey;
  label: string;
  /** One line about the stage, shown when it is opened. */
  note: string;
  items: FunnelItem[];
}

/** What moved from one stage into the next in the window. */
export interface FunnelFlow {
  from: FunnelStageKey;
  count: number;
  label: string;
  /** The label beside an opened stage, where the gap is narrow. */
  short: string;
  /** A rate over the whole search, where one belongs on this band. */
  rate: string | null;
}

/** What left the search from one stage in the window. */
export interface FunnelDrop {
  from: FunnelStageKey;
  count: number;
  label: string;
  parts: string;
}

export interface FunnelHeadline {
  /** Plain text, with the one name worth the eye set apart. */
  parts: Array<{ text: string; stage?: FunnelStageKey }>;
}

export interface FunnelView {
  stages: FunnelStage[];
  flows: FunnelFlow[];
  drops: FunnelDrop[];
  /** Startups on the watchlist that Dash searches; null when not read. */
  watched: number | null;
  headline: FunnelHeadline;
}

export interface FunnelApplicationInput {
  applicationId: string;
  roleId: string;
  companyName: string;
  roleTitle: string;
  status: ApplicationStatus;
  submittedAt: string | null;
  firstHumanResponseAt: string | null;
  closedAt: string | null;
  lastActivityAt: string | null;
  lastTurnEvent: ApplicationEventKind | null;
  interviewKinds?: string[];
}

export interface FunnelSuggestionInput {
  id: string;
  name: string;
  headline: string;
  status: string;
  createdAt: string;
  actedAt: string | null;
}

export interface FunnelInput {
  now: Date;
  applications: readonly FunnelApplicationInput[];
  suggestions: readonly FunnelSuggestionInput[];
  /** Interviews already held, one per conversation. */
  interviewsHeld: ReadonlyArray<{ applicationId: string; scheduledAt: string }>;
  watched: number | null;
  /**
   * Replies over sends across the whole search, from lib/jobs/pipeline.ts's
   * funnelMetrics so the denominator rules stay in one place; null when
   * nothing has been sent.
   */
  replyRate: number | null;
}

const DAY_MS = 24 * 60 * 60 * 1000;

const LABEL: Record<FunnelStageKey, string> = {
  sourcing: 'Sourcing',
  leads: 'Leads',
  applied: 'Applied',
  traction: 'Traction',
  waiting: 'Waiting',
  offers: 'Offers',
};

export function stageLabel(key: FunnelStageKey): string {
  return LABEL[key];
}

const CLOSED_WORD: Partial<Record<ApplicationStatus, string>> = {
  role_closed: 'role closed',
  ghosted: 'ghosted',
  rejected: 'rejected',
  withdrawn: 'withdrawn',
};

const WORDS = ['No', 'One', 'Two', 'Three', 'Four', 'Five', 'Six', 'Seven', 'Eight', 'Nine', 'Ten'];

function countWord(n: number): string {
  return WORDS[n] ?? String(n);
}

function plural(n: number, one: string, many: string): string {
  return n === 1 ? one : many;
}

function daysBetween(iso: string | null, now: number): number | null {
  if (!iso) return null;
  const then = new Date(iso).getTime();
  if (!Number.isFinite(then)) return null;
  return Math.max(0, Math.floor((now - then) / DAY_MS));
}

function within(iso: string | null, since: number, now: number): boolean {
  if (!iso) return false;
  const at = new Date(iso).getTime();
  return Number.isFinite(at) && at >= since && at <= now;
}

/** Which stage a live application stands in; null when it is closed. */
export function stageOf(app: FunnelApplicationInput): Exclude<FunnelStageKey, 'sourcing'> | null {
  switch (app.status) {
    case 'lead':
    case 'drafting':
      return 'leads';
    case 'submitted':
    case 'acknowledged':
      return 'applied';
    case 'in_process':
    case 'final_round': {
      const move = applicationMove({ status: app.status, lastEvent: app.lastTurnEvent, companyName: app.companyName });
      return move?.move.state === 'on_you' ? 'traction' : 'waiting';
    }
    case 'offer':
      return 'offers';
    default:
      return null;
  }
}

/** The stage an application was in when it closed, from how far it got. */
function closedFrom(app: FunnelApplicationInput): Exclude<FunnelStageKey, 'sourcing'> {
  if (app.firstHumanResponseAt) return (app.interviewKinds ?? []).length > 0 ? 'waiting' : 'traction';
  if (app.submittedAt) return 'applied';
  return 'leads';
}

function itemOrder(a: FunnelItem, b: FunnelItem): number {
  return (a.days ?? 0) - (b.days ?? 0) || a.name.localeCompare(b.name);
}

export function buildFunnel(input: FunnelInput): FunnelView {
  const now = input.now.getTime();
  const since = now - FUNNEL_WINDOW_DAYS * DAY_MS;

  const items = new Map<FunnelStageKey, FunnelItem[]>(FUNNEL_STAGES.map((key) => [key, []]));

  for (const s of input.suggestions) {
    if (s.status !== 'open') continue;
    const days = daysBetween(s.createdAt, now);
    items.get('sourcing')!.push({
      id: s.id,
      name: s.name,
      what: s.headline,
      days,
      stale: (days ?? 0) >= STALE_DAYS,
      href: '/jobs/find',
    });
  }

  for (const app of input.applications) {
    const stage = stageOf(app);
    if (!stage) continue;
    const days = daysBetween(app.lastActivityAt, now);
    items.get(stage)!.push({
      id: app.applicationId,
      name: app.companyName,
      what: app.roleTitle,
      days,
      stale: (days ?? 0) >= STALE_DAYS,
      href: `/jobs/roles/${app.roleId}`,
    });
  }
  for (const list of items.values()) list.sort(itemOrder);

  const recent = input.suggestions.filter((s) => within(s.createdAt, since, now));
  const taken = input.suggestions.filter((s) => s.status === 'done' && within(s.actedAt ?? s.createdAt, since, now)).length;
  const dismissed = recent.filter((s) => s.status === 'dismissed').length;
  const expired = recent.filter((s) => s.status === 'expired').length;

  const sent = input.applications.filter((a) => within(a.submittedAt, since, now)).length;
  const replied = input.applications.filter((a) => within(a.firstHumanResponseAt, since, now)).length;
  const interviewed = new Set(
    input.interviewsHeld.filter((i) => within(i.scheduledAt, since, now)).map((i) => i.applicationId),
  ).size;
  const offered = input.applications.filter((a) => a.status === 'offer' && within(a.lastActivityAt, since, now)).length;

  // Over the whole search, where a month is too few to say anything.
  const replyRate = input.replyRate === null ? null : `${formatRate(input.replyRate)} reply rate`;

  const flows: FunnelFlow[] = [
    { from: 'sourcing', count: taken, label: 'taken', short: 'taken', rate: null },
    { from: 'leads', count: sent, label: 'sent', short: 'sent', rate: null },
    { from: 'applied', count: replied, label: 'heard back', short: 'replied', rate: replyRate },
    { from: 'traction', count: interviewed, label: 'interviewed', short: 'met', rate: null },
    { from: 'waiting', count: offered, label: plural(offered, 'offer', 'offers'), short: plural(offered, 'offer', 'offers'), rate: null },
  ];

  const drops: FunnelDrop[] = [];
  if (dismissed + expired > 0) {
    drops.push({
      from: 'sourcing',
      count: dismissed + expired,
      label: 'passed on',
      parts: [dismissed && `${dismissed} dismissed`, expired && `${expired} expired`].filter(Boolean).join(' · '),
    });
  }
  const closedBy = new Map<FunnelStageKey, Map<string, number>>();
  for (const app of input.applications) {
    const word = CLOSED_WORD[app.status];
    if (!word || !within(app.closedAt, since, now)) continue;
    const from = closedFrom(app);
    const counts = closedBy.get(from) ?? new Map<string, number>();
    counts.set(word, (counts.get(word) ?? 0) + 1);
    closedBy.set(from, counts);
  }
  for (const key of FUNNEL_STAGES) {
    const counts = closedBy.get(key);
    if (!counts) continue;
    const ordered = [...counts.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
    // Two causes and the rest as one, so the line fits under its own tube.
    const rest = ordered.slice(2).reduce((sum, [, n]) => sum + n, 0);
    const parts = ordered.slice(0, 2).map(([word, n]) => `${n} ${word}`);
    if (rest > 0) parts.push(`${rest} other`);
    drops.push({
      from: key,
      count: ordered.reduce((sum, [, n]) => sum + n, 0),
      label: 'closed',
      parts: parts.join(' · '),
    });
  }

  const count = (key: FunnelStageKey) => items.get(key)!.length;
  const stale = (key: FunnelStageKey) => items.get(key)!.filter((i) => i.stale).length;
  const suggested = recent.length;

  const notes: Record<FunnelStageKey, string> = {
    sourcing:
      count('sourcing') === 0
        ? `Nothing waiting on you. Dash suggested ${suggested} in ${FUNNEL_WINDOW_DAYS} days.`
        : `${count('sourcing')} ${plural(count('sourcing'), 'needs', 'need')} a yes or no; ${suggested} found in ${FUNNEL_WINDOW_DAYS} days.`,
    leads:
      stale('leads') > 0
        ? `${stale('leads')} ${plural(stale('leads'), 'has', 'have')} sat over two weeks without being sent.`
        : 'None has sat over two weeks.',
    applied:
      stale('applied') > 0
        ? `${stale('applied')} ${plural(stale('applied'), 'is', 'are')} past two weeks with nothing back.`
        : 'Nothing here is past two weeks yet.',
    traction: 'A person answered, and the next step is yours.',
    waiting: 'The next move is the company’s.',
    offers: count('offers') === 0 ? 'Nothing here yet.' : 'The next move on an offer is yours.',
  };

  const stages = FUNNEL_STAGES.map((key) => ({ key, label: LABEL[key], note: notes[key], items: items.get(key)! }));

  return { stages, flows, drops, watched: input.watched, headline: headline(stages, drops) };
}

/**
 * One sentence that says where the search stands: how many conversations are
 * live, the warmest of them, and the stage losing the most.
 */
export function headline(stages: readonly FunnelStage[], drops: readonly FunnelDrop[]): FunnelHeadline {
  const of = (key: FunnelStageKey) => stages.find((s) => s.key === key)?.items ?? [];
  const live = of('traction').length + of('waiting').length;
  const parts: FunnelHeadline['parts'] = [];

  if (live === 0) {
    const out = of('applied').length;
    parts.push({ text: `Nothing is past the first reply yet. ${countWord(out)} ${plural(out, 'application is', 'applications are')} out.` });
  } else {
    parts.push({ text: `${countWord(live)} ${plural(live, 'conversation is', 'conversations are')} live. ` });
    const warmest = [...of('traction'), ...of('waiting')].sort((a, b) => (a.days ?? 99) - (b.days ?? 99))[0]!;
    const warmStage = of('traction').includes(warmest) ? 'traction' : 'waiting';
    parts.push({ text: warmest.name, stage: warmStage });
    parts.push({ text: live === 1 ? ' is the one to watch' : ' is the warmest' });
    // Suggestions passed on are choices, not losses, so Sourcing is never the leak.
    const worst = drops.filter((d) => d.from !== 'sourcing').sort((a, b) => b.count - a.count)[0];
    parts.push({ text: worst ? `, and ${LABEL[worst.from]} is where the search leaks.` : '.' });
  }
  return { parts };
}

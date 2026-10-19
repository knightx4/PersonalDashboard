import { matchesSearch, searchTerms } from '@/lib/jobs/search';
import {
  addressHref,
  choiceColumn,
  columnFilters,
  commonValues,
  parsePage,
  parseView,
  type AddressChanges,
  type ColumnFilter,
  type FilterColumn,
  type PageAddress,
} from '@/lib/table-view';

/**
 * What the Contacts page shows, read from its address, the way Companies and
 * Pipeline read theirs (lib/jobs/companies-view.ts). Every filter, the sort,
 * the page and the view are params, so a reload or a link opens the same
 * rows. The rail's Show and Status set the same params the column headers do.
 */

export const CONTACTS_PATH = '/jobs/contacts';

/**
 * Focused, the default, leads with the potential leads in the order they want
 * a move and narrows from the rail beside the table; Table is the table
 * alone, full width, narrowed from its column headers.
 */
export const CONTACT_VIEWS = ['table', 'focus'] as const;
export type ContactsViewName = (typeof CONTACT_VIEWS)[number];

/** job_search.contact_status, in the order a conversation moves through it. */
export const CONTACT_STATUSES = ['to_contact', 'contacted', 'responded', 'met', 'dormant'] as const;

export const CONTACT_RELATIONSHIPS = [
  'cold',
  'alum',
  'second_degree',
  'former_colleague',
  'friend',
  'recruiter',
  'interviewer',
] as const;

/** Who the list is narrowed to, besides the columns. */
export const CONTACT_SHOWS = [
  { value: 'leads', label: 'Potential leads' },
  { value: 'dash', label: 'Found by Dash' },
] as const;

/** One person as the page loads them. */
export type ContactListRow = {
  id: string;
  fullName: string;
  title: string | null;
  relationship: string;
  status: string;
  companyName: string | null;
  companySlug: string | null;
  /** The company's priority, so a lead at a target ranks above one at a backup. */
  companyPriority: string | null;
  lastTouchAt: string | null;
  /** Outbound sends still waiting on an answer. */
  pendingReplies: number;
  /** Any send to them is on record. */
  hasOutbound: boolean;
  /** Someone who could lead to a job, marked on their page or by an agent that found them. */
  potentialLead: boolean;
  /** Found by Dash or an agent searching for people, not added by the person. */
  foundByDash: boolean;
};

/** The search params the page reads. Sort, group and hide are the Display panel's. */
export type ContactsParams = {
  view?: string;
  /** A value from CONTACT_SHOWS. */
  show?: string;
  q?: string;
  /** Typed in the Name column: the name or the title holds it. */
  name?: string;
  /** A company's slug, or `none` for people not attached to one. */
  company?: string;
  relationship?: string;
  status?: string;
  /** `1`: only people with a send still unanswered. */
  waiting?: string;
  /** `yes` for people you have reached out to, `no` for the ones you have not. */
  reached?: string;
  /** `1`: the form for adding someone is open. Any other link closes it. */
  add?: string;
  page?: string;
  sort?: string;
  group?: string;
  hide?: string | string[];
};

export type ContactsState = {
  view: ContactsViewName;
  show: 'leads' | 'dash' | null;
  terms: string[];
  nameTerms: string[];
  company: string | null;
  relationship: string | null;
  status: string | null;
  waitingOnly: boolean;
  reached: 'yes' | 'no' | null;
  /** One-based. */
  page: number;
};

export const NO_COMPANY = 'none';

export function parseContacts(params: ContactsParams): ContactsState {
  return {
    view: parseView(params.view, CONTACT_VIEWS, 'focus'),
    show: CONTACT_SHOWS.find((s) => s.value === params.show)?.value ?? null,
    terms: searchTerms(params.q),
    nameTerms: searchTerms(params.name),
    company: params.company || null,
    relationship: CONTACT_RELATIONSHIPS.find((r) => r === params.relationship) ?? null,
    status: CONTACT_STATUSES.find((s) => s === params.status) ?? null,
    waitingOnly: params.waiting === '1',
    reached: params.reached === 'yes' || params.reached === 'no' ? params.reached : null,
    page: parsePage(params.page),
  };
}

export function words(value: string): string {
  return value.replace(/_/g, ' ');
}

/** The filters set besides the search box, in the words a person reads them by. */
export function filterNames(state: ContactsState, rows: readonly ContactListRow[] = []): string[] {
  const names: string[] = [];
  if (state.show) names.push(CONTACT_SHOWS.find((s) => s.value === state.show)!.label);
  if (state.nameTerms.length) names.push(`Name: “${state.nameTerms.join(' ')}”`);
  if (state.company) {
    const name =
      state.company === NO_COMPANY
        ? 'none'
        : (rows.find((r) => r.companySlug === state.company)?.companyName ?? state.company);
    names.push(`Company: ${name}`);
  }
  if (state.relationship) names.push(`Relationship: ${words(state.relationship)}`);
  if (state.status) names.push(`Status: ${words(state.status)}`);
  if (state.waitingOnly) names.push('Waiting on a reply');
  if (state.reached) names.push(state.reached === 'yes' ? 'Reached out' : 'Not reached out');
  return names;
}

/** Whether anything narrows the list besides the search box. */
export function hasColumnFilters(state: ContactsState): boolean {
  return filterNames(state).length > 0;
}

function matchesShow(row: ContactListRow, show: ContactsState['show']): boolean {
  if (show === 'leads') return row.potentialLead;
  if (show === 'dash') return row.foundByDash;
  return true;
}

function matchesCompany(row: ContactListRow, company: string | null): boolean {
  if (company === null) return true;
  if (company === NO_COMPANY) return row.companySlug === null;
  return row.companySlug === company;
}

export function filterContacts<T extends ContactListRow>(
  rows: readonly T[],
  state: ContactsState,
): T[] {
  return rows.filter(
    (c) =>
      matchesShow(c, state.show) &&
      matchesCompany(c, state.company) &&
      (state.relationship === null || c.relationship === state.relationship) &&
      (state.status === null || c.status === state.status) &&
      (!state.waitingOnly || c.pendingReplies > 0) &&
      (state.reached === null || (state.reached === 'yes') === reachedOut(c)) &&
      (state.nameTerms.length === 0 || matchesSearch([c.fullName, c.title], state.nameTerms)) &&
      (state.terms.length === 0 ||
        matchesSearch([c.fullName, c.title, c.companyName], state.terms)),
  );
}

/**
 * Whether you have reached out to them: a send is on record, or their status
 * has moved past To contact, since a send made outside the app is often only
 * marked by the status.
 */
export function reachedOut(row: Pick<ContactListRow, 'status' | 'hasOutbound'>): boolean {
  return row.hasOutbound || row.status !== 'to_contact';
}

/** Days since the last touch after which a send with no answer wants a nudge. */
export const FOLLOW_UP_DAYS = 7;

const PRIORITY_ORDER = ['target', 'interested', 'backup', 'passed'];

function priorityRank(priority: string | null): number {
  const index = priority ? PRIORITY_ORDER.indexOf(priority) : -1;
  return index === -1 ? PRIORITY_ORDER.length : index;
}

function daysSince(iso: string | null, now: Date): number {
  return iso ? (now.getTime() - new Date(iso).getTime()) / 86_400_000 : Infinity;
}

/** A lead at a target company before one at a backup, then by name. */
const byPriority = (a: ContactListRow, b: ContactListRow) =>
  priorityRank(a.companyPriority) - priorityRank(b.companyPriority) ||
  a.fullName.localeCompare(b.fullName);

/** The longest unanswered first: they are the ones to nudge. */
const byOldestTouch = (a: ContactListRow, b: ContactListRow) =>
  (a.lastTouchAt ?? '').localeCompare(b.lastTouchAt ?? '') || byPriority(a, b);

/**
 * The Focused view's sections, in the order Pipeline's run: the potential
 * leads it is your move to write to (not reached yet, or they answered), the
 * leads you have written to and are waiting on, split at a week without a
 * reply, then everyone else. A lead you have met or who has gone dormant is
 * in Everyone else, since neither wants a send now.
 */
export function focusSections<T extends ContactListRow>(rows: readonly T[], now: Date = new Date()) {
  const toReach: T[] = [];
  const waiting: T[] = [];
  const rest: T[] = [];
  for (const row of rows) {
    if (row.potentialLead && (row.status === 'responded' || !reachedOut(row))) toReach.push(row);
    else if (row.potentialLead && (row.status === 'contacted' || row.pendingReplies > 0))
      waiting.push(row);
    else rest.push(row);
  }
  // Someone who answered comes before someone not yet written to.
  toReach.sort(
    (a, b) => Number(b.status === 'responded') - Number(a.status === 'responded') || byPriority(a, b),
  );
  waiting.sort(byOldestTouch);
  rest.sort(
    (a, b) => Number(b.potentialLead) - Number(a.potentialLead) || a.fullName.localeCompare(b.fullName),
  );
  return {
    toReach,
    waiting: waiting.filter((row) => daysSince(row.lastTouchAt, now) < FOLLOW_UP_DAYS),
    quiet: waiting.filter((row) => daysSince(row.lastTouchAt, now) >= FOLLOW_UP_DAYS),
    rest,
  };
}

const CONTACTS_ADDRESS: PageAddress<ContactsParams> = {
  path: CONTACTS_PATH,
  defaults: { view: 'focus' },
};

/** The link that changes `changes` and keeps everything else, back to the first page. */
export function contactsHref(
  params: ContactsParams,
  changes: AddressChanges<ContactsParams>,
): string {
  return addressHref(CONTACTS_ADDRESS, params, { add: undefined, ...changes });
}

/** The same table with every filter off, the search included; the arrangement stays. */
export function clearFiltersHref(params: ContactsParams): string {
  return contactsHref(params, {
    show: undefined,
    q: undefined,
    name: undefined,
    company: undefined,
    relationship: undefined,
    status: undefined,
    waiting: undefined,
    reached: undefined,
  });
}

/** How many companies the Company column's menu lists. */
const COLUMN_COMPANY_LIMIT = 12;

/**
 * The menu each column header opens, by column id. Counts are over everyone,
 * as the rail's are, so a choice says how many it holds whatever else is set.
 */
export function contactColumnFilters(
  params: ContactsParams,
  state: ContactsState,
  rows: readonly ContactListRow[],
): Record<string, ColumnFilter> {
  const href = (changes: AddressChanges<ContactsParams>) => contactsHref(params, changes);
  const count = (keep: (row: ContactListRow) => boolean) => rows.filter(keep).length;

  // Who the list shows sits in the Name column, under the typed field.
  const show = choiceColumn<ContactsParams>({
    id: 'name',
    param: 'show',
    prefix: 'show',
    current: state.show,
    anyLabel: 'Everyone',
    choices: CONTACT_SHOWS.map(({ value, label }) => ({
      value,
      label: `${label} · ${count((c) => (value === 'leads' ? c.potentialLead : c.foundByDash))}`,
    })),
  });
  const name: FilterColumn<ContactsParams> = {
    ...show,
    active: show.active || state.nameTerms.length > 0,
    typed: { param: 'name', placeholder: 'Name or title' },
  };

  const attached = rows.filter((row) => row.companySlug !== null);
  const companies = commonValues(
    attached,
    (row) => row.companySlug!,
    (row) => row.companyName ?? row.companySlug!,
    COLUMN_COMPANY_LIMIT,
    state.company === NO_COMPANY ? null : state.company,
  );
  const unattached = rows.length - attached.length;

  const status = choiceColumn<ContactsParams>({
    id: 'status',
    param: 'status',
    current: state.status,
    anyLabel: 'Any status',
    choices: CONTACT_STATUSES.map((s) => ({
      value: s,
      label: `${words(s)[0].toUpperCase()}${words(s).slice(1)} · ${count((c) => c.status === s)}`,
    })),
  });

  return columnFilters<ContactsParams>(
    [
      name,
      choiceColumn({
        id: 'company',
        param: 'company',
        current: state.company,
        anyLabel: 'Any company',
        choices: [
          ...companies.map(({ value, name: label, count: n }) => ({ value, label: `${label} · ${n}` })),
          ...(unattached > 0 ? [{ value: NO_COMPANY, label: `No company · ${unattached}` }] : []),
        ],
      }),
      choiceColumn({
        id: 'relationship',
        param: 'relationship',
        current: state.relationship,
        anyLabel: 'Any relationship',
        choices: CONTACT_RELATIONSHIPS.filter((r) => rows.some((c) => c.relationship === r)).map(
          (r) => ({
            value: r,
            label: `${words(r)[0].toUpperCase()}${words(r).slice(1)} · ${count((c) => c.relationship === r)}`,
          }),
        ),
      }),
      // Whether you have reached out, and whether a send is still waiting,
      // sit under the statuses: each is a toggle of its own param, so it
      // narrows whatever status is chosen.
      {
        ...status,
        active: status.active || state.waitingOnly || state.reached !== null,
        options: [
          ...status.options,
          {
            id: 'reached-yes',
            label: `Reached out · ${count(reachedOut)}`,
            changes: { reached: state.reached === 'yes' ? undefined : 'yes' },
            current: state.reached === 'yes',
          },
          {
            id: 'reached-no',
            label: `Not reached out · ${count((c) => !reachedOut(c))}`,
            changes: { reached: state.reached === 'no' ? undefined : 'no' },
            current: state.reached === 'no',
          },
          {
            id: 'waiting',
            label: `Waiting on a reply · ${count((c) => c.pendingReplies > 0)}`,
            changes: { waiting: state.waitingOnly ? undefined : '1' },
            current: state.waitingOnly,
          },
        ],
      },
    ],
    href,
  );
}

/** The line after the rows: how many are shown, of how many. */
export function contactsCount(
  state: ContactsState,
  shown: number,
  total: number,
  query?: string,
): string {
  const noun = total === 1 ? 'person' : 'people';
  if (state.terms.length) return `${shown} of ${total} ${noun} match “${query ?? ''}”.`;
  if (shown === total) return `${total} ${noun}.`;
  return `${shown} of ${total} ${noun} shown.`;
}

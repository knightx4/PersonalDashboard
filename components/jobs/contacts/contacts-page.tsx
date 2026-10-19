import { ListChecks, Plus, Table2, Users } from 'lucide-react';
import { ViewSwitch } from '@/components/shell/view-switch';
import { AddContact } from '@/app/jobs/(app)/contacts/add-contact';
import { PageHeader } from '@/components/shell/page-header';
import { EmptyState } from '@/components/ui/empty-state';
import { Table, TBody, TD, TH, THead, TR } from '@/components/ui/table';
import { SearchField } from '@/components/shell/search-field';
import { SearchEmpty } from '@/components/shell/search-empty';
import { ColumnHeading } from '@/components/shell/column-heading';
import { RowLink } from '@/components/shell/back-link';
import { DisplayMenu } from '@/components/shell/display-menu';
import { GroupHeader } from '@/components/shell/group-header';
import { PageWide } from '@/components/shell/page-width';
import { Card, CardSection } from '@/components/ui/card';
import { Chip } from '@/components/ui/chip';
import { buttonVariants } from '@/components/ui/button';
import Link, { linkVariants } from '@/components/ui/link';
import { sectionSubject } from '@/lib/core/section-path';
import { cn } from '@/lib/cn';
import { contactsDisplay } from '@/lib/jobs/roles-display';
import {
  groupRows,
  listDisplayMenu,
  NO_GROUP,
  parseListDisplay,
  sortRows,
  type DisplayChoice,
} from '@/lib/list-display';
import type { SavedView } from '@/lib/saved-views/store';
import { formatDate } from '@/lib/jobs/applications/load';
import { pageOf, withoutPage, type ColumnFilter } from '@/lib/table-view';
import {
  clearFiltersHref,
  CONTACT_SHOWS,
  contactColumnFilters,
  contactsCount,
  contactsHref,
  filterContacts,
  filterNames,
  hasColumnFilters,
  focusSections,
  parseContacts,
  reachedOut,
  words,
  type ContactListRow,
  type ContactsParams,
} from '@/lib/jobs/contacts-view';

/**
 * The Contacts page, apart from its loading so the gallery can draw it with
 * fixtures. Two views, as Pipeline has: Focused, the default, reads top to
 * bottom in Pipeline's order, the potential leads to reach out to, then the
 * ones waiting on a reply, then everyone else (focusSections); Table is every
 * person, filtered from its column headers, paged at 50 and kept in the
 * address (lib/jobs/contacts-view.ts). A row opens the person.
 */
export function ContactsPage({
  contacts,
  companies,
  params,
  savedViews = [],
  timezone = 'UTC',
  description,
  now = new Date(),
  openColumn,
}: {
  contacts: readonly ContactListRow[];
  /** For the add form's Company menu. */
  companies: Array<{ id: string; name: string }>;
  params: ContactsParams;
  savedViews?: readonly SavedView[];
  timezone?: string;
  /** The line under the title: how many sends have been answered. */
  description?: string;
  /** When "a week unanswered" is counted from; the gallery fixes it. */
  now?: Date;
  /** For the gallery: the column whose menu is drawn open. */
  openColumn?: string;
}) {
  const state = parseContacts(params);
  // Every link keeps the view the person is in.
  const href = (changes: Partial<Record<keyof ContactsParams, string | undefined>>) =>
    contactsHref(params, changes);
  const adding = params.add === '1';
  const addForm = adding && <AddContact companies={companies} closeHref={href({})} />;
  const addLink = (
    <Link
      href={href({ add: '1' })}
      className={buttonVariants({ variant: contacts.length ? 'primary' : 'secondary', size: 'sm' })}
    >
      <Plus className="size-4" strokeWidth={1.75} aria-hidden />
      Add someone
    </Link>
  );

  if (contacts.length === 0) {
    return (
      <PageWide>
        <PageHeader
          subject={sectionSubject('/jobs/contacts', 'Contacts')}
          title="Contacts"
          description="People to talk to, and a record of when you did."
        />
        {addForm || (
          <EmptyState
            icon={Users}
            title="Nobody yet"
            description="The people you reach out to, and where each conversation stands."
          >
            {addLink}
          </EmptyState>
        )}
      </PageWide>
    );
  }

  const filtered = filterContacts(contacts, state);
  const narrowed = hasColumnFilters(state);
  const focus = state.view === 'focus';

  const displaySpec = contactsDisplay<ContactListRow>();
  // The sort, grouping and columns keep every filter but not the page.
  const listParams = withoutPage(params);
  const menu = listDisplayMenu(displaySpec, listParams, savedViews);
  const display = parseListDisplay(displaySpec, listParams);
  const sorted = sortRows(filtered, display);
  const paged = pageOf(sorted, state.page);
  const sections = groupRows(paged.rows, display.groupBy);
  const filters = contactColumnFilters(params, state, contacts);
  const count = contactsCount(state, filtered.length, contacts.length, params.q);
  const searchedOut = filtered.length === 0 && state.terms.length > 0 && !narrowed;
  const rowHref = (contact: ContactListRow) => `/jobs/contacts/${contact.id}`;

  const list = (
    <>
      {/* Directly above the table it narrows. Every filter, the sort and the
          page are on the URL and the field carries them, so searching a
          narrowed table stays narrowed. */}
      <div className="mb-4 flex items-start gap-1">
        <div className="min-w-0 flex-1">
          <SearchField placeholder="Search people" />
        </div>
        <DisplayMenu menu={menu} className="sm:hidden" />
      </div>

      {/* The rail sets this one and no column header does, so the table
          names it with the way back. */}
      {state.show && (
        <p className="mb-3 text-small text-ink-muted">
          {CONTACT_SHOWS.find((s) => s.value === state.show)?.label} only ·{' '}
          <Link href={href({ show: undefined })}>Show everyone</Link>
        </p>
      )}

      {searchedOut ? (
        <SearchEmpty query={params.q ?? ''} />
      ) : filtered.length === 0 ? (
        // The header stays, so a filter can be loosened from its column.
        <Card className="overflow-hidden">
          <ContactsTable
            rows={[]}
            sorts={menu.sorts}
            defaultSort={displaySpec.defaultSort}
            hidden={display.hidden}
            filters={filters}
            openColumn={openColumn}
            rowHref={rowHref}
            timezone={timezone}
          />
          <div className="border-border px-4 py-10 text-center md:border-t">
            <p className="text-body font-medium text-ink">No rows match these filters</p>
            <p className="mt-1 text-small text-ink-muted">
              {filterNames(state, contacts).join(' · ')}
            </p>
            <Link
              href={clearFiltersHref(params)}
              className={cn(buttonVariants({ variant: 'secondary', size: 'sm' }), 'mt-4')}
            >
              Clear filters
            </Link>
          </div>
        </Card>
      ) : (
        <div className="space-y-5">
          {
            /* ui-ok: one card per group of rows, each holding its rows as one table, not a card per row */ sections.map(
              (section) => (
                <div key={section.key} className="space-y-2">
                  {display.group !== NO_GROUP && (
                    <GroupHeader label={section.label} count={section.count} />
                  )}
                  <Card className="overflow-hidden">
                    <ContactsTable
                      rows={section.rows}
                      sorts={menu.sorts}
                      defaultSort={displaySpec.defaultSort}
                      hidden={display.hidden}
                      filters={filters}
                      openColumn={section === sections[0] ? openColumn : undefined}
                      rowHref={rowHref}
                      timezone={timezone}
                    />
                  </Card>
                </div>
              ),
            )
          }
          <nav aria-label="Pages" className="flex items-center justify-between gap-3">
            <span className="tabular text-small text-ink-muted">
              {paged.pages > 1 ? `${paged.first}–${paged.last} · ${count}` : count}
            </span>
            {paged.pages > 1 && (
              <span className="flex gap-2">
                {paged.page > 1 && (
                  <Link
                    href={href({ page: String(paged.page - 1) })}
                    className={buttonVariants({ variant: 'secondary', size: 'sm' })}
                  >
                    Previous
                  </Link>
                )}
                {paged.page < paged.pages && (
                  <Link
                    href={href({ page: String(paged.page + 1) })}
                    className={buttonVariants({ variant: 'secondary', size: 'sm' })}
                  >
                    Next
                  </Link>
                )}
              </span>
            )}
          </nav>
        </div>
      )}
    </>
  );

  return (
    <PageWide>
      <PageHeader
        subject={sectionSubject('/jobs/contacts', 'Contacts')}
        title="Contacts"
        description={description}
        actions={
          <>
            <ViewSwitch
              label="Contacts view"
              current={state.view}
              views={[
                { value: 'focus', label: 'Focused', Icon: ListChecks, href: href({ view: undefined }) },
                { value: 'table', label: 'Table', Icon: Table2, href: href({ view: 'table' }) },
              ]}
            />
            <DisplayMenu menu={menu} className="max-sm:hidden" />
            {!adding && addLink}
          </>
        }
      />

      {addForm}

      {focus ? (
        <ContactsFocus
          rows={filtered}
          now={now}
          timezone={timezone}
          searchedOut={searchedOut}
          query={params.q ?? ''}
          filtersLine={
            narrowed ? (
              <p className="text-small text-ink-muted">
                {filterNames(state, contacts).join(' · ')} ·{' '}
                <Link href={clearFiltersHref(params)}>Clear filters</Link>
              </p>
            ) : null
          }
          tableHref={href({ view: 'table' })}
        />
      ) : (
        list
      )}
    </PageWide>
  );
}

/**
 * The Focused view: the search, then one surface a section, each person one
 * line, as Pipeline's Focused view draws its pursuits. A section with nobody
 * in it is not drawn.
 */
function ContactsFocus({
  rows,
  now,
  timezone,
  searchedOut,
  query,
  filtersLine,
  tableHref,
}: {
  rows: readonly ContactListRow[];
  now: Date;
  timezone: string;
  searchedOut: boolean;
  query: string;
  filtersLine: React.ReactNode;
  tableHref: string;
}) {
  const { toReach, waiting, quiet, rest } = focusSections(rows, now);
  const leads = toReach.length + waiting.length + quiet.length;

  return (
    <div className="space-y-6">
      <div className="space-y-2">
        <SearchField placeholder="Search people" />
        {filtersLine}
      </div>

      {searchedOut ? (
        <SearchEmpty query={query} />
      ) : (
        <>
          {rows.length === 0 && (
            <p className="px-2 text-ui text-ink-muted">Nobody matches these filters.</p>
          )}
          {rows.length > 0 && leads === 0 && (
            <p className="px-2 text-ui text-ink-muted">
              No potential leads to write to or waiting on. Mark someone as a potential lead on
              their page and they show here.
            </p>
          )}

          {toReach.length > 0 && (
            <FocusSection label="To reach out to" count={toReach.length}>
              {toReach.map((contact) => (
                <FocusLine
                  key={contact.id}
                  contact={contact}
                  now={now}
                  timezone={timezone}
                  detail={contact.status === 'responded' ? 'They replied' : null}
                  highlight={contact.status === 'responded'}
                />
              ))}
            </FocusSection>
          )}

          {waiting.length + quiet.length > 0 && (
            <FocusSection label="Reached out, waiting on a reply" count={waiting.length + quiet.length}>
              {waiting.map((contact) => (
                <FocusLine key={contact.id} contact={contact} now={now} timezone={timezone} detail={sentLine(contact, now)} />
              ))}
              {quiet.length > 0 && (
                <li className="px-2 pt-3 pb-1 text-small text-ink-muted">
                  A week or more without a reply · {quiet.length}
                </li>
              )}
              {quiet.map((contact) => (
                <FocusLine
                  key={contact.id}
                  contact={contact}
                  now={now}
                  timezone={timezone}
                  detail={sentLine(contact, now)}
                  stale
                />
              ))}
            </FocusSection>
          )}

          {rest.length > 0 && (
            <FocusSection label="Everyone else" count={rest.length}>
              {rest.map((contact) => (
                <FocusLine
                  key={contact.id}
                  contact={contact}
                  now={now}
                  timezone={timezone}
                  detail={reachedOut(contact) ? words(contact.status) : 'Not reached out'}
                />
              ))}
            </FocusSection>
          )}

          {rows.length > 0 && (
            <p className="px-2 text-small text-ink-muted">
              <Link href={tableHref}>Open the table</Link> to filter by company, relationship,
              status or whether you have reached out.
            </p>
          )}
        </>
      )}
    </div>
  );
}

/** "today" or "12d", counted from `now`, as Pipeline's ages read. */
function ageSince(iso: string, now: Date): string {
  const days = Math.floor((now.getTime() - new Date(iso).getTime()) / 86_400_000);
  return days <= 0 ? 'today' : `${days}d`;
}

function sentLine(contact: ContactListRow, now: Date): string | null {
  if (!contact.lastTouchAt) return 'No send on record';
  const age = ageSince(contact.lastTouchAt, now);
  const unanswered = contact.pendingReplies > 1 ? ` · ${contact.pendingReplies} unanswered` : '';
  return (age === 'today' ? 'Sent today' : `Sent ${age} ago`) + unanswered;
}

function FocusSection({
  label,
  count,
  children,
}: {
  label: string;
  count: number;
  children: React.ReactNode;
}) {
  // One surface a section, its rows hairlined inside it (law 13), folding by
  // its heading as Pipeline's sections do.
  return (
    <CardSection title={label} meta={count} fold={`jobs.fold.Contacts ${label}`}>
      <ul className="-mx-2 divide-y divide-border">{children}</ul>
    </CardSection>
  );
}

/**
 * One person, one line: the name and company, where it stands, and how long
 * since the last touch. The detail drops below `sm`, where the name needs the
 * width more.
 */
function FocusLine({
  contact,
  now,
  timezone,
  detail = null,
  highlight = false,
  stale = false,
}: {
  contact: ContactListRow;
  now: Date;
  timezone: string;
  detail?: string | null;
  highlight?: boolean;
  stale?: boolean;
}) {
  return (
    <li>
      <RowLink
        href={`/jobs/contacts/${contact.id}`}
        // ui-ok: fixed-control-height -- a row, not a control: 44px on a
        // phone for a thumb, 40 above it, as Pipeline's focus rows are.
        className="flex min-h-11 items-center gap-2.5 rounded-control px-2 py-1.5 transition-colors duration-quick hover:bg-shell-hover sm:min-h-10"
      >
        <span className="min-w-28 flex-1 truncate text-ui text-ink">
          {contact.fullName}
          {(contact.companyName || contact.title) && (
            <span className="ml-2 text-ink-muted">
              {[contact.title, contact.companyName].filter(Boolean).join(' · ')}
            </span>
          )}
        </span>
        {detail && (
          <span
            className={cn(
              'hidden shrink-0 text-small sm:inline',
              highlight ? 'font-medium text-accent' : 'text-ink-muted',
            )}
          >
            {detail}
          </span>
        )}
        <span
          className={cn('tabular w-14 shrink-0 text-right text-micro', stale ? 'text-caution' : 'text-ink-muted')}
          title={contact.lastTouchAt ? `Last touch ${formatDate(contact.lastTouchAt, timezone)}` : undefined}
        >
          {contact.lastTouchAt ? ageSince(contact.lastTouchAt, now) : '—'}
        </span>
      </RowLink>
    </li>
  );
}

/** "21 Aug", with the year only when it is not this one, so the subline keeps its room. */
function shortDate(iso: string, timezone: string, now: Date): string {
  const full = formatDate(iso, timezone);
  const year = String(now.getFullYear());
  return full.endsWith(` ${year}`) ? full.slice(0, -year.length - 1) : full;
}

/** On a phone a send still waiting says the whole of it: "1 unanswered" means contacted. */
function shortStatus(contact: ContactListRow): string {
  return contact.pendingReplies > 0 ? `${contact.pendingReplies} unanswered` : words(contact.status);
}

function ContactName({ contact, marks = false }: { contact: ContactListRow; marks?: boolean }) {
  return (
    <>
      {contact.fullName}
      {marks && contact.potentialLead && <Chip className="ml-1.5">lead</Chip>}
      {marks && contact.foundByDash && <Chip className="ml-1.5">found by Dash</Chip>}
      {/* Under the name, so the name column does not crowd the date off the
          table's edge (law 18). */}
      {contact.title && (
        <span className="block max-w-60 truncate text-small font-normal text-ink-muted">
          {contact.title}
        </span>
      )}
    </>
  );
}

function CompanyCell({ contact }: { contact: ContactListRow }) {
  if (!contact.companySlug) return <>—</>;
  // `relative` lifts this above the row link the primary cell stretches, so
  // the company is still its own destination.
  return (
    <Link
      href={`/jobs/companies/${contact.companySlug}`}
      className={cn(linkVariants({ tone: 'quiet' }), 'relative')}
    >
      {contact.companyName}
    </Link>
  );
}

/** The column headers, in the order the table draws them, with what each is called. */
const COLUMNS = [
  { id: 'name', label: 'Name' },
  { id: 'company', label: 'Company' },
  { id: 'relationship', label: 'Relationship' },
  { id: 'status', label: 'Status' },
  { id: 'touch', label: 'Last touch', num: true },
] as const;

/**
 * A header's sort, drawn as chosen only when the person chose it: the sort
 * the table opens on is a default, and a default is drawn plain (law 17).
 */
function headerSort(
  sort: DisplayChoice | undefined,
  defaultSort: string | undefined,
): DisplayChoice | undefined {
  return sort && sort.id === defaultSort ? { ...sort, chosen: false } : sort;
}

function ContactsTable({
  rows,
  sorts,
  defaultSort,
  hidden,
  filters,
  openColumn,
  rowHref,
  timezone,
}: {
  rows: readonly ContactListRow[];
  rowHref: (contact: ContactListRow) => string;
  /** The Display panel's sort links, so a header and the panel agree. */
  sorts: readonly DisplayChoice[];
  /** The sort the table opens on, whose header stays grey (law 17). */
  defaultSort?: string;
  hidden: readonly string[];
  filters: Readonly<Record<string, ColumnFilter>>;
  openColumn?: string;
  timezone: string;
}) {
  const showing = (id: string) => id === 'name' || !hidden.includes(id);
  return (
    <>
      {/* A phone gets two lines a person: who they are, then where things
          stand as plain values (law 9). */}
      <ul className="divide-y divide-border md:hidden">
        {rows.map((contact) => {
          const facts = [
            showing('company') ? contact.companyName : null,
            showing('relationship') ? words(contact.relationship) : null,
            showing('status') && !reachedOut(contact) ? 'not reached out' : null,
            showing('status') ? shortStatus(contact) : null,
          ].filter(Boolean);
          return (
            <li key={contact.id}>
              <RowLink href={rowHref(contact)} className="group block row-pad px-4 hover:bg-sunken">
                <span className="block truncate text-ui font-medium text-ink group-hover:text-accent">
                  {contact.fullName}
                  {contact.title && (
                    <span className="ml-1.5 font-normal text-ink-muted">{contact.title}</span>
                  )}
                  {contact.potentialLead && <Chip className="ml-1.5">lead</Chip>}
                  {contact.foundByDash && <Chip className="ml-1.5">found by Dash</Chip>}
                </span>
                {/* The date keeps its place at the right end; what comes
                    before it is what shortens when the line runs out. */}
                <span className="mt-1 flex items-baseline gap-3 text-small text-ink-muted">
                  <span className="min-w-0 flex-1 truncate">{facts.join(' · ')}</span>
                  {showing('touch') && contact.lastTouchAt && (
                    <span className="tabular shrink-0">
                      {shortDate(contact.lastTouchAt, timezone, new Date())}
                    </span>
                  )}
                </span>
              </RowLink>
            </li>
          );
        })}
      </ul>
      <div className="max-md:hidden">
        <Table>
          <THead>
            <TR>
              {COLUMNS.filter((column) => showing(column.id)).map((column) => (
                <TH
                  key={column.id}
                  num={'num' in column && column.num}
                  className={column.id === 'name' ? undefined : 'whitespace-nowrap'}
                >
                  <ColumnHeading
                    sort={headerSort(
                      sorts.find((entry) => entry.id === column.id),
                      defaultSort,
                    )}
                    label={column.label}
                    filter={filters[column.id]}
                    open={openColumn === column.id}
                  />
                </TH>
              ))}
            </TR>
          </THead>
          <TBody>
            {rows.map((contact) => (
              <TR key={contact.id} href={rowHref(contact)}>
                <TD primary className="min-w-48">
                  <ContactName contact={contact} marks />
                </TD>
                {showing('company') && (
                  <TD label="Company" muted>
                    {/* Cut to one line at a fixed width, so a long company
                        name does not squeeze the Name column. */}
                    <span className="block max-w-40 truncate">
                      <CompanyCell contact={contact} />
                    </span>
                  </TD>
                )}
                {showing('relationship') && (
                  <TD label="Relationship" muted>
                    {words(contact.relationship)}
                  </TD>
                )}
                {showing('status') && (
                  <TD label="Status" muted className="whitespace-nowrap">
                    {words(contact.status)}
                  </TD>
                )}
                {showing('touch') && (
                  <TD label="Last touch" num muted className="whitespace-nowrap">
                    {contact.lastTouchAt ? formatDate(contact.lastTouchAt, timezone) : '—'}
                  </TD>
                )}
              </TR>
            ))}
          </TBody>
        </Table>
      </div>
    </>
  );
}

import { parse } from 'csv-parse/sync';
import { unzipSync } from 'fflate';
import { parseInstant, parsePartialDate } from './dates';
import { jobIdFromUrl, keyText, profileSlugFromUrl, rowHash } from './keys';
import type {
  ApplicationAnswer,
  ArchiveFile,
  ArchiveKind,
  ArchiveRecord,
  LinkedInArchive,
} from './types';

// Reads the zip LinkedIn sends ("Get a copy of your data") into one typed
// record list per file. Pure: the same bytes give the same records, keys and
// dates on every run, whatever order the zip stores its entries in.
//
// Files are found by name wherever they sit in the zip, so "Jobs/Saved
// Jobs.csv" and "Saved Jobs.csv" both read. A file split into parts
// ("Job Applications.csv", "Job Applications_1.csv") reads as one list, in
// part order, and a row whose key an earlier row already had is dropped and
// counted. Columns are looked up by header, ignoring case and punctuation, so
// a header LinkedIn renames slightly still reads, and a missing column gives
// null rather than an error.

/** Lower-case, punctuation to spaces, collapsed: "Content Saved (if saved)" → "content saved if saved". */
function normHeader(header: string): string {
  return header.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
}

class Row {
  constructor(
    private readonly cells: Map<string, string>,
    readonly values: Record<string, string>,
  ) {}

  /** The first non-empty cell among the given headers, trimmed, or null. */
  get(...headers: string[]): string | null {
    for (const header of headers) {
      const value = this.cells.get(normHeader(header));
      if (value !== undefined && value.trim() !== '') return value.trim();
    }
    return null;
  }
}

/** Collects cells that did not parse, to report once per column. */
class Problems {
  private readonly failed = new Map<string, { count: number; sample: string }>();
  readonly lines: string[] = [];

  fail(column: string, value: string, what: string): void {
    const key = `${column}\u0000${what}`;
    const seen = this.failed.get(key);
    if (seen) seen.count += 1;
    else this.failed.set(key, { count: 1, sample: value });
  }

  summary(): string[] {
    const out = [...this.lines];
    for (const [key, { count, sample }] of this.failed) {
      const [column, what] = key.split('\u0000');
      out.push(
        `${count} ${count === 1 ? 'value' : 'values'} in "${column}" did not read as ${what}, such as "${sample}"`,
      );
    }
    return out;
  }
}

class Cells {
  constructor(
    readonly row: Row,
    private readonly problems: Problems,
  ) {}

  text(...headers: string[]): string | null {
    return this.row.get(...headers);
  }

  instant(...headers: string[]): string | null {
    const raw = this.row.get(...headers);
    if (raw === null) return null;
    const at = parseInstant(raw);
    if (at === null) this.problems.fail(headers[0], raw, 'a date');
    return at;
  }

  partial(...headers: string[]): string | null {
    const raw = this.row.get(...headers);
    if (raw === null) return null;
    const at = parsePartialDate(raw);
    if (at === null) this.problems.fail(headers[0], raw, 'a date');
    return at;
  }

  bool(...headers: string[]): boolean | null {
    const raw = this.row.get(...headers);
    if (raw === null) return null;
    const v = raw.toLowerCase();
    if (v === 'true' || v === 'yes' || v === 'y') return true;
    if (v === 'false' || v === 'no' || v === 'n') return false;
    this.problems.fail(headers[0], raw, 'yes or no');
    return null;
  }

  amount(...headers: string[]): number | null {
    const raw = this.row.get(...headers);
    if (raw === null) return null;
    const n = Number(raw.replace(/[^0-9.\-]/g, ''));
    if (!Number.isFinite(n) || !/\d/.test(raw)) {
      this.problems.fail(headers[0], raw, 'an amount');
      return null;
    }
    return n;
  }
}

/** Splits several profile URLs written in one cell. */
function urlList(value: string | null): string[] {
  if (!value) return [];
  return value.split(/[\s,]+/).filter((part) => part.length > 0);
}

/**
 * Splits Job Applications' "Question And Answers" cell, written as
 * "question:answer | question:answer". A question that ends in "?" is split at
 * its "?:", so an answer may hold a colon ("Start time?:9:30"); otherwise the
 * split is at the first colon. A piece with no colon at all is the rest of the
 * previous answer, which held a " | " of its own.
 */
export function splitAnswers(value: string | null | undefined): ApplicationAnswer[] {
  const text = (value ?? '').trim();
  if (!text) return [];
  const out: ApplicationAnswer[] = [];
  for (const piece of text.split(/\s*\|\s*/)) {
    if (!piece) continue;
    const asked = piece.indexOf('?:');
    const at = asked >= 0 ? asked + 1 : piece.indexOf(':');
    if (at < 0) {
      const last = out[out.length - 1];
      if (last) last.answer = last.answer ? `${last.answer} | ${piece}` : piece;
      else out.push({ question: piece.trim(), answer: '' });
      continue;
    }
    const question = piece.slice(0, at).trim();
    const answer = piece.slice(at + 1).trim();
    if (!question && !answer) continue;
    out.push({ question, answer });
  }
  return out;
}

interface FileSpec<K extends ArchiveKind = ArchiveKind> {
  kind: K;
  /** Matched against the file's name, without its folder. */
  name: RegExp;
  /** A header the file's header row holds, to find it below any notes. */
  anchor: string;
  /** One row to one record, or null for a row with nothing in it to keep. */
  map: (cells: Cells, file: string, index: number) => LinkedInArchive[K][number] | null;
}

/** Types each spec's mapper against its own record type. */
function spec<K extends ArchiveKind>(s: FileSpec<K>): FileSpec {
  return s as unknown as FileSpec;
}

const part = (base: string) =>
  new RegExp(`^${base.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(?:_\\d+)?\\.csv$`, 'i');

const SPECS: FileSpec[] = [
  spec({
    kind: 'applications',
    name: part('Job Applications'),
    anchor: 'Job Url',
    map: (c, file) => {
      const jobUrl = c.text('Job Url', 'Job URL');
      const jobId = jobIdFromUrl(jobUrl);
      const appliedAt = c.instant('Application Date');
      const companyName = c.text('Company Name', 'Company');
      const jobTitle = c.text('Job Title', 'Title');
      if (!jobUrl && !companyName && !jobTitle) return null;
      return {
        key: jobId ?? rowHash(companyName, jobTitle, appliedAt),
        file,
        jobId,
        appliedAt,
        contactEmail: c.text('Contact Email'),
        contactPhone: c.text('Contact Phone Number', 'Contact Phone'),
        companyName,
        jobTitle,
        jobUrl,
        resumeName: c.text('Resume Name'),
        answers: splitAnswers(c.text('Question And Answers', 'Questions And Answers')),
      };
    },
  }),
  spec({
    kind: 'screeningAnswers',
    name: /^Job Applicant Saved (?:Answers|Screening Question Responses)(?:_\d+)?\.csv$/i,
    anchor: 'Question',
    map: (c, file) => {
      const question = c.text('Question');
      if (!question) return null;
      return { key: rowHash(question), file, question, answer: c.text('Answer') };
    },
  }),
  spec({
    kind: 'connections',
    name: part('Connections'),
    anchor: 'First Name',
    map: (c, file) => {
      const profileUrl = c.text('URL', 'Profile URL');
      const profileSlug = profileSlugFromUrl(profileUrl);
      const firstName = c.text('First Name');
      const lastName = c.text('Last Name');
      if (!profileUrl && !firstName && !lastName) return null;
      const connectedOn = c.partial('Connected On');
      return {
        key: profileSlug ?? rowHash(firstName, lastName, connectedOn),
        file,
        profileSlug,
        profileUrl,
        firstName,
        lastName,
        email: c.text('Email Address', 'Email'),
        company: c.text('Company'),
        position: c.text('Position'),
        connectedOn,
      };
    },
  }),
  spec({
    kind: 'messages',
    name: part('messages'),
    anchor: 'Conversation ID',
    map: (c, file) => {
      const conversationId = c.text('Conversation ID');
      const senderProfileUrl = c.text('Sender Profile URL');
      const from = c.text('From');
      const sentAt = c.instant('Date');
      const content = c.text('Content');
      if (!conversationId && !content) return null;
      const recipientProfileUrls = urlList(c.text('Recipient Profile URLs', 'Recipient Profile URL'));
      const message = rowHash(sentAt, senderProfileUrl ?? from, content);
      return {
        key: conversationId ? `${conversationId}:${message}` : message,
        file,
        conversationId,
        conversationTitle: c.text('Conversation Title'),
        from,
        senderProfileUrl,
        senderProfileSlug: profileSlugFromUrl(senderProfileUrl),
        to: c.text('To'),
        recipientProfileUrls,
        recipientProfileSlugs: recipientProfileUrls
          .map(profileSlugFromUrl)
          .filter((slug): slug is string => slug !== null),
        sentAt,
        subject: c.text('Subject'),
        content,
        folder: c.text('Folder'),
        attachments: c.text('Attachments'),
        isDraft: c.bool('Is Message Draft') ?? false,
      };
    },
  }),
  spec({
    kind: 'invitations',
    name: part('Invitations'),
    anchor: 'Direction',
    map: (c, file) => {
      const from = c.text('From');
      const to = c.text('To');
      const sentAt = c.instant('Sent At');
      const direction = c.text('Direction')?.toUpperCase() ?? null;
      const inviterProfileUrl = c.text('inviterProfileUrl', 'Inviter Profile URL');
      const inviteeProfileUrl = c.text('inviteeProfileUrl', 'Invitee Profile URL');
      const inviterProfileSlug = profileSlugFromUrl(inviterProfileUrl);
      const inviteeProfileSlug = profileSlugFromUrl(inviteeProfileUrl);
      if (!from && !to && !inviterProfileUrl && !inviteeProfileUrl) return null;
      return {
        key: rowHash(direction, inviterProfileSlug ?? from, inviteeProfileSlug ?? to, sentAt),
        file,
        from,
        to,
        sentAt,
        message: c.text('Message'),
        direction,
        inviterProfileUrl,
        inviterProfileSlug,
        inviteeProfileUrl,
        inviteeProfileSlug,
      };
    },
  }),
  spec({
    kind: 'savedJobs',
    name: part('Saved Jobs'),
    anchor: 'Job Url',
    map: (c, file) => {
      const jobUrl = c.text('Job Url', 'Job URL');
      const jobId = jobIdFromUrl(jobUrl);
      const jobTitle = c.text('Job Title');
      const companyName = c.text('Company Name');
      if (!jobUrl && !jobTitle) return null;
      return {
        key: jobId ?? rowHash(jobUrl, companyName, jobTitle),
        file,
        jobId,
        savedAt: c.instant('Saved Date'),
        jobUrl,
        jobTitle,
        companyName,
      };
    },
  }),
  spec({
    kind: 'companyFollows',
    name: part('Company Follows'),
    anchor: 'Organization',
    map: (c, file) => {
      const organization = c.text('Organization');
      if (!organization) return null;
      return {
        key: keyText(organization),
        file,
        organization,
        followedAt: c.instant('Followed On'),
      };
    },
  }),
  spec({
    kind: 'jobSeekerPreferences',
    name: part('Job Seeker Preferences'),
    anchor: 'Locations',
    map: (c, file, index) => ({
      key: index === 0 ? 'job-seeker-preferences' : `job-seeker-preferences:${index}`,
      file,
      locations: c.text('Locations'),
      industries: c.text('Industries'),
      jobTitles: c.text('Job Titles'),
      preferredJobTypes: c.text('Preferred Job Types'),
      openToRecruiters: c.bool('Open To Recruiters'),
      dreamCompanies: c.text('Dream Companies'),
      introductionStatement: c.text('Introduction Statement'),
      values: c.row.values,
    }),
  }),
  spec({
    kind: 'savedJobAlerts',
    name: part('SavedJobAlerts'),
    anchor: 'Alert Parameters',
    map: (c, file) => {
      const savedSearchId = c.text('Saved Search Id', 'Saved Search ID', 'Search Id');
      const parameters = c.text('Alert Parameters');
      if (!savedSearchId && !parameters) return null;
      return {
        key: savedSearchId ?? rowHash(parameters),
        file,
        savedSearchId,
        alertDate: c.instant('Alert Date'),
        parameters,
        values: c.row.values,
      };
    },
  }),
  spec({
    kind: 'positions',
    name: part('Positions'),
    anchor: 'Company Name',
    map: (c, file) => {
      const companyName = c.text('Company Name');
      const title = c.text('Title');
      if (!companyName && !title) return null;
      const startedOn = c.partial('Started On');
      return {
        key: rowHash(companyName, title, startedOn),
        file,
        companyName,
        title,
        description: c.text('Description'),
        location: c.text('Location'),
        startedOn,
        finishedOn: c.partial('Finished On'),
      };
    },
  }),
  spec({
    kind: 'education',
    name: part('Education'),
    anchor: 'School Name',
    map: (c, file) => {
      const schoolName = c.text('School Name');
      const degreeName = c.text('Degree Name');
      if (!schoolName && !degreeName) return null;
      const startDate = c.partial('Start Date');
      return {
        key: rowHash(schoolName, degreeName, startDate),
        file,
        schoolName,
        degreeName,
        startDate,
        endDate: c.partial('End Date'),
        notes: c.text('Notes'),
        activities: c.text('Activities'),
      };
    },
  }),
  spec({
    kind: 'courses',
    name: part('Courses'),
    anchor: 'Name',
    map: (c, file) => {
      const name = c.text('Name');
      if (!name) return null;
      const number = c.text('Number');
      return { key: rowHash(name, number), file, name, number };
    },
  }),
  spec({
    kind: 'certifications',
    name: part('Certifications'),
    anchor: 'Authority',
    map: (c, file) => {
      const name = c.text('Name');
      if (!name) return null;
      const authority = c.text('Authority');
      const startedOn = c.partial('Started On');
      return {
        key: rowHash(name, authority, startedOn),
        file,
        name,
        url: c.text('Url', 'URL'),
        authority,
        startedOn,
        finishedOn: c.partial('Finished On'),
        licenseNumber: c.text('License Number'),
      };
    },
  }),
  spec({
    kind: 'honors',
    name: part('Honors'),
    anchor: 'Title',
    map: (c, file) => {
      const title = c.text('Title');
      if (!title) return null;
      const issuedOn = c.partial('Issued On');
      return { key: rowHash(title, issuedOn), file, title, description: c.text('Description'), issuedOn };
    },
  }),
  spec({
    kind: 'skills',
    name: part('Skills'),
    anchor: 'Name',
    map: (c, file) => {
      const name = c.text('Name');
      if (!name) return null;
      return { key: keyText(name), file, name };
    },
  }),
  spec({
    kind: 'learning',
    name: part('Learning'),
    anchor: 'Content Title',
    map: (c, file) => {
      const title = c.text('Content Title');
      if (!title) return null;
      const contentType = c.text('Content Type');
      return {
        key: rowHash(title, contentType),
        file,
        title,
        description: c.text('Content Description'),
        contentType,
        lastWatchedAt: c.instant('Content Last Watched Date (if viewed)', 'Content Last Watched Date'),
        completedAt: c.instant('Content Completed At (if completed)', 'Content Completed At'),
        saved: c.bool('Content Saved'),
        notes: c.text('Notes taken on videos (if taken)', 'Notes taken on videos', 'Notes'),
      };
    },
  }),
  spec({
    kind: 'receipts',
    name: part('Receipts_v2'),
    anchor: 'Transaction Made At',
    map: (c, file) => {
      const invoiceNumber = c.text('Invoice Number');
      const transactionAt = c.instant('Transaction Made At');
      const productName = c.text('Product Name', 'Description');
      const totalAmount = c.amount('Total Amount', 'Total');
      if (!invoiceNumber && !transactionAt && !productName) return null;
      return {
        key: invoiceNumber ?? rowHash(transactionAt, productName, String(totalAmount ?? '')),
        file,
        invoiceNumber,
        transactionAt,
        productName,
        currency: c.text('Currency Code', 'Currency'),
        subTotal: c.amount('Sub Total', 'Subtotal'),
        taxAmount: c.amount('Tax Amount'),
        totalAmount,
        billingPeriod: c.text('Billing Period'),
        paymentMethod: c.text('Payment Method', 'Payment Method Type'),
        values: c.row.values,
      };
    },
  }),
  spec({
    kind: 'identityAssets',
    name: part('Private_identity_asset'),
    anchor: 'Private Identity Asset Name',
    map: (c, file) => {
      const name = c.text('Private Identity Asset Name');
      if (!name) return null;
      return {
        key: rowHash(name),
        file,
        name,
        text: c.text('Private Identity Asset Raw Text', 'Private Identity Asset Text'),
      };
    },
  }),
];

function emptyArchive(): LinkedInArchive {
  return {
    applications: [], screeningAnswers: [], connections: [], messages: [],
    invitations: [], savedJobs: [], companyFollows: [], jobSeekerPreferences: [],
    savedJobAlerts: [], positions: [], education: [], courses: [],
    certifications: [], honors: [], skills: [], learning: [], receipts: [],
    identityAssets: [], files: [], unread: [],
  };
}

/** The spec that reads a file at this path, or null. */
export function specFor(path: string): ArchiveKind | null {
  const base = path.split('/').pop() ?? path;
  return SPECS.find((s) => s.name.test(base))?.kind ?? null;
}

function readRows(text: string, anchor: string, problems: Problems): Row[] {
  let table: string[][];
  try {
    table = parse(text, {
      bom: true,
      relax_column_count: true,
      relax_quotes: true,
      skip_empty_lines: true,
    }) as string[][];
  } catch (error) {
    problems.lines.push(`The file did not read as CSV: ${(error as Error).message}`);
    return [];
  }
  // Connections.csv opens with a few lines of notes before its header; look
  // for the header row rather than assuming it is first.
  const want = normHeader(anchor);
  const headerAt = table.findIndex((cells) => cells.some((cell) => normHeader(cell) === want));
  if (headerAt < 0) {
    problems.lines.push(`No header row with "${anchor}" was found`);
    return [];
  }
  const headers = table[headerAt].map((cell) => cell.trim());
  const rows: Row[] = [];
  for (const cells of table.slice(headerAt + 1)) {
    if (cells.every((cell) => cell.trim() === '')) continue;
    const byNorm = new Map<string, string>();
    const values: Record<string, string> = {};
    headers.forEach((header, i) => {
      const value = cells[i] ?? '';
      if (!header) return;
      values[header] = value;
      const norm = normHeader(header);
      if (!byNorm.has(norm)) byNorm.set(norm, value);
    });
    rows.push(new Row(byNorm, values));
  }
  return rows;
}

/**
 * Reads a LinkedIn export zip into typed records. Throws only when the bytes
 * are not a zip; a file that does not read is listed with its problem.
 */
export function readLinkedInArchive(bytes: Uint8Array): LinkedInArchive {
  let entries: Record<string, Uint8Array>;
  try {
    entries = unzipSync(bytes);
  } catch (error) {
    throw new Error(`This is not a zip file LinkedIn sent: ${(error as Error).message}`);
  }

  const archive = emptyArchive();
  const lists = archive as unknown as Record<ArchiveKind, ArchiveRecord[]>;
  const seen = new Map<ArchiveKind, Set<string>>();
  const decoder = new TextDecoder('utf-8');

  const paths = Object.keys(entries)
    .filter((path) => !path.endsWith('/') && !path.split('/').some((p) => p.startsWith('__MACOSX')))
    .sort();

  for (const path of paths) {
    const base = path.split('/').pop() ?? path;
    const spec = SPECS.find((s) => s.name.test(base));
    if (!spec) {
      archive.files.push({ path, kind: null, records: 0, duplicates: 0, problems: [] });
      archive.unread.push(path);
      continue;
    }
    const problems = new Problems();
    const rows = readRows(decoder.decode(entries[path]), spec.anchor, problems);
    const keys = seen.get(spec.kind) ?? new Set<string>();
    seen.set(spec.kind, keys);
    let records = 0;
    let duplicates = 0;
    rows.forEach((row, index) => {
      const record = spec.map(new Cells(row, problems), path, index);
      if (!record) return;
      if (keys.has(record.key)) {
        duplicates += 1;
        return;
      }
      keys.add(record.key);
      lists[spec.kind].push(record);
      records += 1;
    });
    const file: ArchiveFile = { path, kind: spec.kind, records, duplicates, problems: problems.summary() };
    archive.files.push(file);
  }

  return archive;
}

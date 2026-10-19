// The typed records the archive reader returns, one list per kind of file.
//
// Every record has `key`, stable across runs and exports, and `file`, the path
// inside the zip it came from. Instants are ISO strings in UTC; partial dates
// are "YYYY-MM", "YYYY" or "YYYY-MM-DD" (see dates.ts). A cell the export left
// empty is null, never "".

/** Fields every record has. */
export interface ArchiveRecord {
  key: string;
  /** Path of the file inside the zip, e.g. "Jobs/Job Applications_1.csv". */
  file: string;
}

export interface ApplicationAnswer {
  question: string;
  answer: string;
}

/** Jobs/Job Applications.csv and its further parts (Job Applications_1.csv, …). */
export interface JobApplicationRecord extends ArchiveRecord {
  /** The LinkedIn job id; also the key when present. */
  jobId: string | null;
  appliedAt: string | null;
  contactEmail: string | null;
  contactPhone: string | null;
  companyName: string | null;
  jobTitle: string | null;
  jobUrl: string | null;
  resumeName: string | null;
  /** "question:answer | question:answer", split. */
  answers: ApplicationAnswer[];
}

/** Jobs/Job Applicant Saved Answers.csv and …Saved Screening Question Responses.csv. */
export interface ScreeningAnswerRecord extends ArchiveRecord {
  question: string;
  answer: string | null;
}

/** Connections.csv. The key is the profile slug. */
export interface ConnectionRecord extends ArchiveRecord {
  profileSlug: string | null;
  profileUrl: string | null;
  firstName: string | null;
  lastName: string | null;
  email: string | null;
  company: string | null;
  position: string | null;
  /** A day, "YYYY-MM-DD". */
  connectedOn: string | null;
}

/** messages.csv, one record per message. */
export interface MessageRecord extends ArchiveRecord {
  conversationId: string | null;
  conversationTitle: string | null;
  from: string | null;
  senderProfileUrl: string | null;
  senderProfileSlug: string | null;
  to: string | null;
  recipientProfileUrls: string[];
  recipientProfileSlugs: string[];
  sentAt: string | null;
  subject: string | null;
  content: string | null;
  folder: string | null;
  attachments: string | null;
  isDraft: boolean;
}

/** Invitations.csv. */
export interface InvitationRecord extends ArchiveRecord {
  from: string | null;
  to: string | null;
  sentAt: string | null;
  message: string | null;
  /** "INCOMING" or "OUTGOING" as LinkedIn writes it, upper-cased. */
  direction: string | null;
  inviterProfileUrl: string | null;
  inviterProfileSlug: string | null;
  inviteeProfileUrl: string | null;
  inviteeProfileSlug: string | null;
}

/** Jobs/Saved Jobs.csv. The key is the job id. */
export interface SavedJobRecord extends ArchiveRecord {
  jobId: string | null;
  savedAt: string | null;
  jobUrl: string | null;
  jobTitle: string | null;
  companyName: string | null;
}

/** Company Follows.csv. The key is the organisation's name, normalised. */
export interface CompanyFollowRecord extends ArchiveRecord {
  organization: string;
  followedAt: string | null;
}

/**
 * Jobs/Job Seeker Preferences.csv: one row of settings. The common ones are
 * typed; `values` keeps every column by its header.
 */
export interface JobSeekerPreferencesRecord extends ArchiveRecord {
  locations: string | null;
  industries: string | null;
  jobTitles: string | null;
  preferredJobTypes: string | null;
  openToRecruiters: boolean | null;
  dreamCompanies: string | null;
  introductionStatement: string | null;
  values: Record<string, string>;
}

/** Jobs/SavedJobAlerts.csv. */
export interface SavedJobAlertRecord extends ArchiveRecord {
  savedSearchId: string | null;
  alertDate: string | null;
  parameters: string | null;
  values: Record<string, string>;
}

/** Positions.csv. */
export interface PositionRecord extends ArchiveRecord {
  companyName: string | null;
  title: string | null;
  description: string | null;
  location: string | null;
  startedOn: string | null;
  finishedOn: string | null;
}

/** Education.csv. */
export interface EducationRecord extends ArchiveRecord {
  schoolName: string | null;
  degreeName: string | null;
  startDate: string | null;
  endDate: string | null;
  notes: string | null;
  activities: string | null;
}

/** Courses.csv (courses listed on the profile, not LinkedIn Learning). */
export interface CourseRecord extends ArchiveRecord {
  name: string;
  number: string | null;
}

/** Certifications.csv. */
export interface CertificationRecord extends ArchiveRecord {
  name: string;
  url: string | null;
  authority: string | null;
  startedOn: string | null;
  finishedOn: string | null;
  licenseNumber: string | null;
}

/** Honors.csv. */
export interface HonorRecord extends ArchiveRecord {
  title: string;
  description: string | null;
  issuedOn: string | null;
}

/** Skills.csv. The key is the skill's name, normalised. */
export interface SkillRecord extends ArchiveRecord {
  name: string;
}

/** Learning.csv: LinkedIn Learning videos and courses. */
export interface LearningRecord extends ArchiveRecord {
  title: string;
  description: string | null;
  contentType: string | null;
  lastWatchedAt: string | null;
  completedAt: string | null;
  saved: boolean | null;
  notes: string | null;
}

/** Receipts_v2.csv: LinkedIn Premium and other purchases. */
export interface ReceiptRecord extends ArchiveRecord {
  invoiceNumber: string | null;
  transactionAt: string | null;
  productName: string | null;
  currency: string | null;
  subTotal: number | null;
  taxAmount: number | null;
  totalAmount: number | null;
  billingPeriod: string | null;
  paymentMethod: string | null;
  values: Record<string, string>;
}

/** Private_identity_asset.csv: the text of resumes uploaded to LinkedIn. */
export interface IdentityAssetRecord extends ArchiveRecord {
  name: string;
  text: string | null;
}

/** What the reader made of one file in the zip. */
export interface ArchiveFile {
  path: string;
  /** The kind the reader recognised, or null for a file it does not read. */
  kind: ArchiveKind | null;
  /** Records returned from this file, after rows that shared a key were folded. */
  records: number;
  /** Rows dropped because an earlier row (in this or another part) had the same key. */
  duplicates: number;
  /** Rows skipped as unreadable, and cells that did not parse, in words. */
  problems: string[];
}

export interface LinkedInArchive {
  applications: JobApplicationRecord[];
  screeningAnswers: ScreeningAnswerRecord[];
  connections: ConnectionRecord[];
  messages: MessageRecord[];
  invitations: InvitationRecord[];
  savedJobs: SavedJobRecord[];
  companyFollows: CompanyFollowRecord[];
  jobSeekerPreferences: JobSeekerPreferencesRecord[];
  savedJobAlerts: SavedJobAlertRecord[];
  positions: PositionRecord[];
  education: EducationRecord[];
  courses: CourseRecord[];
  certifications: CertificationRecord[];
  honors: HonorRecord[];
  skills: SkillRecord[];
  learning: LearningRecord[];
  receipts: ReceiptRecord[];
  identityAssets: IdentityAssetRecord[];
  /** Every file in the zip, sorted by path, read or not. */
  files: ArchiveFile[];
  /** Paths of the files the reader does not read, sorted. */
  unread: string[];
  /**
   * The day the export was made, "YYYY-MM-DD", when the caller knows it (from
   * the zip's file name). The reader never sets it.
   */
  exportedOn?: string | null;
}

export type ArchiveKind = Exclude<keyof LinkedInArchive, 'files' | 'unread' | 'exportedOn'>;

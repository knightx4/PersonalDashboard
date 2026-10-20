import { CONTACT_RELATIONSHIPS } from '@/lib/jobs/contacts-view';

/**
 * What a contact's page and a company's People card share. The list itself is
 * components/jobs/contacts/contacts-page.tsx, read from the address the way
 * Companies is (lib/jobs/contacts-view.ts).
 */

export const RELATIONSHIPS = CONTACT_RELATIONSHIPS;

export interface ContactRow {
  id: string;
  fullName: string;
  title: string | null;
  relationship: string;
  status: string;
  linkedinUrl: string | null;
  email: string | null;
  howWeConnect: string | null;
  notes: string | null;
  potentialLead: boolean;
  foundByDash: boolean;
  /** Came from a LinkedIn connection, so you are connected there. */
  linkedinConnection: boolean;
  companyName: string | null;
  companySlug: string | null;
  touches: Array<{
    id: string;
    channel: string;
    direction: string;
    sentAt: string;
    respondedAt: string | null;
    message: string | null;
    /** Written and kept, not sent; `sentAt` is when it was saved. */
    draft: boolean;
  }>;
}

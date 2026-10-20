import { redirect } from 'next/navigation';
import { createClient, requireUser } from '@/lib/jobs/auth/server';
import { createCoreClient } from '@/lib/core/auth/server';
import { defaultViewHref, savedViewsFor } from '@/lib/saved-views/store';
import { contactsDisplay } from '@/lib/jobs/roles-display';
import { ContactsPage as ContactsView } from '@/components/jobs/contacts/contacts-page';
import type { ContactsParams } from '@/lib/jobs/contacts-view';

export const metadata = { title: 'Contacts' };

/**
 * Loads the people and hands them to the page component, which the gallery
 * draws with fixtures (components/jobs/contacts/contacts-page.tsx).
 */
export default async function ContactsPage({ searchParams }: { searchParams: Promise<ContactsParams> }) {
  const user = await requireUser();
  const supabase = await createClient();
  const params = await searchParams;

  const savedViews = await savedViewsFor(await createCoreClient(), contactsDisplay().pathname);
  const openOn = defaultViewHref(savedViews, params);
  if (openOn) redirect(openOn);

  // The people Dash recommends meeting are on Find now (plan #1589).
  const [{ data: contacts }, { data: companies }, { data: touches }, { data: profile }] =
    await Promise.all([
      supabase
        .from('contacts')
        .select(
          'id, full_name, title, relationship, status, potential_lead, found_by_dash, linkedin_connection, company_id, companies ( name, slug, priority )',
        )
        .eq('user_id', user.id)
        .order('full_name'),
      supabase.from('companies').select('id, name').eq('user_id', user.id).order('name'),
      supabase
        .from('contact_touches')
        .select('contact_id, direction, sent_at, responded_at')
        .eq('user_id', user.id)
        .eq('draft', false)
        .order('sent_at', { ascending: false }),
      supabase.from('profiles').select('timezone').eq('id', user.id).maybeSingle(),
    ]);

  // Last touch and pending-reply count per contact -- everything else about a
  // send lives on the contact's own page.
  const lastTouchByContact = new Map<string, string>();
  const pendingByContact = new Map<string, number>();
  for (const touch of touches ?? []) {
    const contactId = touch.contact_id as string;
    if (!lastTouchByContact.has(contactId)) {
      lastTouchByContact.set(contactId, touch.sent_at as string);
    }
    if (touch.direction === 'outbound' && touch.responded_at === null) {
      pendingByContact.set(contactId, (pendingByContact.get(contactId) ?? 0) + 1);
    }
  }

  const outbound = (touches ?? []).filter((t) => t.direction === 'outbound');
  const answered = outbound.filter((t) => t.responded_at !== null);
  const outboundContacts = new Set(outbound.map((t) => t.contact_id as string));

  return (
    <ContactsView
      params={params}
      savedViews={savedViews}
      timezone={(profile?.timezone as string | undefined) ?? 'UTC'}
      description={
        outbound.length > 0
          ? `${answered.length} of ${outbound.length} outbound messages have been answered.`
          : 'People to talk to, and a record of when you did.'
      }
      companies={(companies ?? []).map((c) => ({ id: c.id as string, name: c.name as string }))}
      contacts={((contacts ?? []) as unknown as Array<{
        id: string;
        full_name: string;
        title: string | null;
        relationship: string;
        status: string;
        potential_lead: boolean;
        found_by_dash: boolean;
        linkedin_connection: boolean;
        companies: { name: string; slug: string; priority: string } | null;
      }>).map((contact) => ({
        id: contact.id,
        fullName: contact.full_name,
        title: contact.title,
        relationship: contact.relationship,
        status: contact.status,
        companyName: contact.companies?.name ?? null,
        companySlug: contact.companies?.slug ?? null,
        companyPriority: contact.companies?.priority ?? null,
        lastTouchAt: lastTouchByContact.get(contact.id) ?? null,
        pendingReplies: pendingByContact.get(contact.id) ?? 0,
        hasOutbound: outboundContacts.has(contact.id),
        potentialLead: contact.potential_lead ?? false,
        foundByDash: contact.found_by_dash ?? false,
        linkedinConnection: contact.linkedin_connection ?? false,
      }))}
    />
  );
}

import { Users } from 'lucide-react';
import { createClient, requireUser } from '@/lib/jobs/auth/server';
import { PageHeader } from '@/components/shell/page-header';
import { EmptyState } from '@/components/ui/empty-state';
import { ContactsView } from './view';

export const metadata = { title: 'Contacts' };

export default async function ContactsPage() {
  const user = await requireUser();
  const supabase = await createClient();

  const [{ data: contacts }, { data: companies }, { data: touches }, { data: profile }] =
    await Promise.all([
      supabase
        .from('contacts')
        .select('id, full_name, title, relationship, status, company_id, companies ( name, slug )')
        .eq('user_id', user.id)
        .order('full_name'),
      supabase.from('companies').select('id, name').eq('user_id', user.id).order('name'),
      supabase
        .from('contact_touches')
        .select('contact_id, direction, sent_at, responded_at')
        .eq('user_id', user.id)
        .order('sent_at', { ascending: false }),
      supabase.from('profiles').select('timezone').eq('id', user.id).single(),
    ]);

  const timezone = (profile?.timezone as string) ?? 'UTC';

  if ((contacts ?? []).length === 0 && (companies ?? []).length === 0) {
    return (
      <>
        <PageHeader
          title="Contacts"
          description="People to talk to, and a record of when you did."
        />
        <EmptyState
          icon={Users}
          title="No contacts yet"
          description="Add a role first so there is a company to attach people to — or add someone unattached and link them later."
          action={{ label: 'Add a role', href: '/jobs/roles/new' }}
        />
      </>
    );
  }

  // Last touch and pending-reply count per contact -- everything else about a
  // send now lives on the contact's own page.
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

  return (
    <>
      <PageHeader
        title="Contacts"
        description={
          outbound.length > 0
            ? `${answered.length} of ${outbound.length} outbound messages have been answered.`
            : 'Recording the sends is what makes the response rate computable later.'
        }
      />

      <ContactsView
        timezone={timezone}
        companies={(companies ?? []).map((c) => ({
          id: c.id as string,
          name: c.name as string,
        }))}
        contacts={((contacts ?? []) as unknown as Array<{
          id: string;
          full_name: string;
          title: string | null;
          relationship: string;
          status: string;
          company_id: string | null;
          companies: { name: string; slug: string } | null;
        }>).map((contact) => ({
          id: contact.id,
          fullName: contact.full_name,
          title: contact.title,
          relationship: contact.relationship,
          status: contact.status,
          companyName: contact.companies?.name ?? null,
          companySlug: contact.companies?.slug ?? null,
          lastTouchAt: lastTouchByContact.get(contact.id) ?? null,
          pendingReplies: pendingByContact.get(contact.id) ?? 0,
        }))}
      />
    </>
  );
}

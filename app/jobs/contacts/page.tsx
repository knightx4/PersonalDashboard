import { Users } from 'lucide-react';
import { createClient, requireUser } from '@/lib/jobs/auth/server';
import { PageHeader } from '@/components/jobs/shell/page-header';
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
        .select(
          'id, full_name, title, relationship, status, linkedin_url, email, how_we_connect, notes, company_id, companies ( name, slug )',
        )
        .eq('user_id', user.id)
        .order('full_name'),
      supabase.from('companies').select('id, name').eq('user_id', user.id).order('name'),
      supabase
        .from('contact_touches')
        .select('id, contact_id, channel, direction, sent_at, responded_at, message')
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

  const touchesByContact = new Map<string, Array<{
    id: string;
    channel: string;
    direction: string;
    sentAt: string;
    respondedAt: string | null;
    message: string | null;
  }>>();

  for (const touch of touches ?? []) {
    const list = touchesByContact.get(touch.contact_id as string) ?? [];
    list.push({
      id: touch.id as string,
      channel: touch.channel as string,
      direction: touch.direction as string,
      sentAt: touch.sent_at as string,
      respondedAt: (touch.responded_at as string) ?? null,
      message: (touch.message as string) ?? null,
    });
    touchesByContact.set(touch.contact_id as string, list);
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
          linkedin_url: string | null;
          email: string | null;
          how_we_connect: string | null;
          notes: string | null;
          company_id: string | null;
          companies: { name: string; slug: string } | null;
        }>).map((contact) => ({
          id: contact.id,
          fullName: contact.full_name,
          title: contact.title,
          relationship: contact.relationship,
          status: contact.status,
          linkedinUrl: contact.linkedin_url,
          email: contact.email,
          howWeConnect: contact.how_we_connect,
          notes: contact.notes,
          companyName: contact.companies?.name ?? null,
          companySlug: contact.companies?.slug ?? null,
          touches: touchesByContact.get(contact.id) ?? [],
        }))}
      />
    </>
  );
}

import Link from 'next/link';
import { notFound } from 'next/navigation';
import { ChevronLeft } from 'lucide-react';
import { createClient, requireUser } from '@/lib/jobs/auth/server';
import { PageHeader } from '@/components/shell/page-header';
import { ContactDetail } from './contact-detail';
import { LinkedTasks } from '@/components/todo/linked-tasks';
import { loadTasksFor } from '@/lib/todo/links/load';

export const metadata = { title: 'Contact' };

export default async function ContactPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const user = await requireUser();
  const supabase = await createClient();

  const [{ data: contact }, { data: touches }, { data: profile }] = await Promise.all([
    supabase
      .from('contacts')
      .select(
        'id, full_name, title, relationship, status, linkedin_url, email, how_we_connect, notes, company_id, companies ( name, slug )',
      )
      .eq('id', id)
      .eq('user_id', user.id)
      .maybeSingle(),
    supabase
      .from('contact_touches')
      .select('id, channel, direction, sent_at, responded_at, message')
      .eq('contact_id', id)
      .eq('user_id', user.id)
      .order('sent_at', { ascending: false }),
    supabase.from('profiles').select('timezone').eq('id', user.id).single(),
  ]);

  if (!contact) notFound();

  const timezone = (profile?.timezone as string) ?? 'UTC';
  const linkedTasks = await loadTasksFor(user.id, 'contact', id);
  const row = contact as unknown as {
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
  };

  return (
    <>
      <Link
        href="/jobs/contacts"
        className="mb-2 inline-flex items-center gap-1 text-ui text-ink-muted hover:text-ink"
      >
        <ChevronLeft className="size-4" strokeWidth={1.75} aria-hidden />
        Contacts
      </Link>
      <PageHeader
        title={row.full_name}
        description={row.companies ? `at ${row.companies.name}` : 'Not attached to a company'}
      />

      <div className="mb-6">
        <LinkedTasks
          target="contact"
          targetId={row.id}
          returnTo={`/jobs/contacts/${row.id}`}
          tasks={linkedTasks}
          timezone={timezone}
        />
      </div>

      <ContactDetail
        timezone={timezone}
        contact={{
          id: row.id,
          fullName: row.full_name,
          title: row.title,
          relationship: row.relationship,
          status: row.status,
          linkedinUrl: row.linkedin_url,
          email: row.email,
          howWeConnect: row.how_we_connect,
          notes: row.notes,
          companyName: row.companies?.name ?? null,
          companySlug: row.companies?.slug ?? null,
          touches: (touches ?? []).map((touch) => ({
            id: touch.id as string,
            channel: touch.channel as string,
            direction: touch.direction as string,
            sentAt: touch.sent_at as string,
            respondedAt: (touch.responded_at as string) ?? null,
            message: (touch.message as string) ?? null,
          })),
        }}
      />
    </>
  );
}

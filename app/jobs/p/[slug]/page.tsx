import { notFound } from 'next/navigation';
import type { Metadata } from 'next';
import { createPublicClient } from '@/lib/jobs/auth/public';

/**
 * The case page: the requirement map, with your evidence beside each line,
 * rendered for someone with no account.
 *
 * It is a work sample and a cover letter in one, and it costs nothing once the
 * requirement map exists — which is the whole argument for building it here
 * rather than as its own artifact. Standalone cover letter generation is
 * dropped; `cover_letters` carries this instead.
 *
 * This is the only unauthenticated read in the application. The read goes
 * through `job_search.public_case_page()`, a `security definer` function that
 * checks expiry and returns exactly one shared page — not a service-role
 * client, and not an RLS exemption on the table. Gap lines and uncited
 * evidence never leave the database at all: see the migration, and the
 * negative cases in tests/rls-jobs.test.ts.
 */

/**
 * A link you send to one employer is not a page you want indexed. `noindex`
 * belongs on the page rather than in a robots file because the URL is
 * unguessable — a robots rule would have to name the path pattern, and the
 * page is the thing that knows it is private.
 */
export const metadata: Metadata = {
  robots: { index: false, follow: false, nocache: true },
};

export const dynamic = 'force-dynamic';

interface CaseMatch {
  requirement: string;
  kind: string;
  verdict: string;
  why: string;
  evidenceItemId: string | null;
}

interface CaseEvidence {
  id: string;
  title: string;
  body: string;
  context: string | null;
  metrics: string | null;
}

interface CasePage {
  company: string | null;
  role: string | null;
  body: string | null;
  matches: CaseMatch[];
  evidence: CaseEvidence[];
}

export default async function PublicCasePage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  const supabase = createPublicClient();

  const { data, error } = await supabase.rpc('public_case_page', { p_slug: slug });

  // An expired link, a wrong slug and a link that was never shared are one
  // outcome on purpose: a distinct "this expired" page would confirm the slug
  // was real to anyone who guessed at one.
  if (error || !data) notFound();

  const page = data as unknown as CasePage;
  const byId = new Map(page.evidence.map((item) => [item.id, item]));

  const groups = [
    { kind: 'must_have', label: 'What the role asks for' },
    { kind: 'nice_to_have', label: 'Also mentioned' },
  ];

  return (
    <main className="mx-auto max-w-2xl px-5 py-12">
      <header>
        <p className="text-ui text-ink-muted">{page.company}</p>
        <h1 className="font-display mt-0.5 text-2xl text-ink">{page.role}</h1>
      </header>

      {page.body && (
        <section className="mt-6 whitespace-pre-wrap text-lead leading-relaxed text-ink">
          {page.body}
        </section>
      )}

      {page.matches.length > 0 && (
        <section className="mt-10">
          <h2 className="text-body font-semibold text-ink">The role, line by line</h2>
          <p className="mt-0.5 text-ui text-ink-muted">
            Each requirement below, and the work behind it.
          </p>

          {groups.map((group) => {
            const lines = page.matches.filter((match) => match.kind === group.kind);
            if (lines.length === 0) return null;
            return (
              <div key={group.kind} className="mt-5">
                <h3 className="text-micro font-semibold uppercase tracking-wider text-ink-muted">
                  {group.label}
                </h3>
                <ul className="mt-2 space-y-4">
                  {lines.map((match, index) => {
                    const item = match.evidenceItemId ? byId.get(match.evidenceItemId) : null;
                    return (
                      <li key={`${group.kind}-${index}`} className="border-l-2 border-border pl-3">
                        <p className="text-body font-medium text-ink">{match.requirement}</p>
                        {item && (
                          <div className="mt-1">
                            <p className="text-ui text-ink">
                              <span className="font-medium">{item.title}</span>
                              {item.context && (
                                <span className="text-ink-muted"> · {item.context}</span>
                              )}
                            </p>
                            <p className="mt-0.5 text-ui leading-relaxed text-ink-muted">
                              {item.body}
                            </p>
                            {item.metrics && (
                              <p className="tabular mt-0.5 text-ui text-ink">{item.metrics}</p>
                            )}
                          </div>
                        )}
                      </li>
                    );
                  })}
                </ul>
              </div>
            );
          })}
        </section>
      )}

      <footer className="mt-12 border-t border-border pt-4 text-small text-ink-muted">
        A private link, shared for this application. It expires.
      </footer>
    </main>
  );
}

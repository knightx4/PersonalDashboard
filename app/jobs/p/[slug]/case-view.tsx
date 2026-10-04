import { LinkedText } from '@/components/ui/linked-text';

export interface CaseMatch {
  requirement: string;
  kind: string;
  verdict: string;
  why: string;
  evidenceItemId: string | null;
}

export interface CaseEvidence {
  id: string;
  title: string;
  body: string;
  context: string | null;
  metrics: string | null;
}

export interface CasePage {
  company: string | null;
  role: string | null;
  body: string | null;
  matches: CaseMatch[];
  evidence: CaseEvidence[];
}

/**
 * A shared case page as it draws (plan #1601): the cover note, then each
 * requirement with the evidence cited for it. The gallery draws it from
 * fixtures.
 */
export function CaseView({ page }: { page: CasePage }) {
  const byId = new Map(page.evidence.map((item) => [item.id, item]));

  const groups = [
    { kind: 'must_have', label: 'What the role asks for' },
    { kind: 'nice_to_have', label: 'Also mentioned' },
  ];

  return (
    <main className="mx-auto max-w-2xl px-5 py-12">
      <header>
        <p className="text-ui text-ink-muted">{page.company}</p>
        <h1 className="font-display mt-0.5 text-title tracking-tight text-ink">{page.role}</h1>
      </header>

      {page.body && (
        <section className="mt-6 whitespace-pre-wrap text-body leading-relaxed text-ink">
          <LinkedText text={page.body} />
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

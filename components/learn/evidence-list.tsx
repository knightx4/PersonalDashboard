import { BookOpen, Briefcase, FileText, GraduationCap, PlayCircle, type LucideIcon } from 'lucide-react';
import {
  CARD_EVIDENCE_LIMIT,
  basisSentence,
  type EvidenceLink,
  type EvidenceSourceKind,
} from '@/lib/learn/evidence/model';
import { EVIDENCE_CEILING } from '@/lib/learn/strength';

const KIND_ICON: Record<EvidenceSourceKind, LucideIcon> = {
  note: FileText,
  course: GraduationCap,
  work: Briefcase,
  reading: BookOpen,
  video: PlayCircle,
};

const CEILING_PERCENT = Math.round(EVIDENCE_CEILING * 100);

/**
 * What backs an idea: the strongest three of its notes, courses and work,
 * each with the sentence saying why it counts (plan #2006.6). Shared by the
 * Idea Space rail and the concept page. An idea no question has been asked
 * about also says how far this evidence lights it, so a glow from notes is
 * never read as a passed test. Nothing at all with no evidence.
 */
export function EvidenceList({
  links,
  untested,
  className,
}: {
  links: readonly EvidenceLink[];
  /** True when no question has been asked about the idea, so the evidence is what lights it. */
  untested: boolean;
  className?: string;
}) {
  if (links.length === 0) return null;
  const shown = links.slice(0, CARD_EVIDENCE_LIMIT);
  return (
    <section className={className} aria-label="What backs it">
      <h3 className="text-ui font-semibold text-ink">What backs it</h3>
      {untested && (
        <p className="mt-0.5 text-small text-ink-muted">
          Counts towards its strength up to {CEILING_PERCENT}% until a question confirms it.
        </p>
      )}
      <ul className="mt-1.5 space-y-1.5">
        {shown.map((link) => {
          const Icon = KIND_ICON[link.sourceKind];
          return (
            <li key={link.id} className="flex items-start gap-2 text-ui text-ink">
              <Icon className="mt-0.5 size-4 shrink-0 text-ink-muted" strokeWidth={1.75} aria-hidden />
              <span className="min-w-0 break-words">{basisSentence(link.basis)}</span>
            </li>
          );
        })}
      </ul>
    </section>
  );
}

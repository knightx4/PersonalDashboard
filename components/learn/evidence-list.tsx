import { BookOpen, Briefcase, FileText, GraduationCap, PlayCircle, type LucideIcon } from 'lucide-react';
import {
  CARD_EVIDENCE_LIMIT,
  basisSentence,
  type EvidenceLink,
  type EvidenceSourceKind,
} from '@/lib/learn/evidence/model';
import { bandWords } from '@/lib/learn/evidence/course-bands';
import { testedWords } from '@/lib/learn/evidence/course-explain';
import { KIND_WORDS } from '@/lib/learn/evidence/kinds';
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
 * The most one link can add, on the same scale as the line above the list
 * (plan #2172.2), and for a course named for the topic the band of levels it
 * likely reached (plan #2172.4.1), or once its explain prompt was answered
 * the level it was tested at (plan #2172.4.2). The basis above it gives the
 * reason.
 */
function markLine(link: Pick<EvidenceLink, 'kind' | 'ceiling' | 'band' | 'tested'>): string {
  const percent = Math.round(Math.max(0, link.ceiling) * EVIDENCE_CEILING * 100);
  const band = link.tested ? ` · ${testedWords(link.tested)}` : link.band ? ` · ${bandWords(link.band)}` : '';
  return `${KIND_WORDS[link.kind]}${band} · counts up to ${percent}%`;
}

/**
 * What backs an idea: the strongest three of its notes, courses and work,
 * each with the sentence saying why it counts (plan #2006.6). Shared by the
 * Idea Space rail and the concept page. An idea no question has been asked
 * about also says how far this evidence lights it, so a glow from notes is
 * never read as a passed test. Each mark names its kind and the most it can
 * add (plan #2172.2): work and courses reach furthest, a note half as far, a
 * clipping a quarter. Nothing at all with no evidence.
 */
export function EvidenceList({
  links,
  untested,
  limit = CARD_EVIDENCE_LIMIT,
  heading = true,
  className,
}: {
  links: readonly EvidenceLink[];
  /** True when no question has been asked about the idea, so the evidence is what lights it. */
  untested: boolean;
  /** How many marks to list. */
  limit?: number;
  /** False where a fold above already says "What backs it". */
  heading?: boolean;
  className?: string;
}) {
  if (links.length === 0) return null;
  const shown = links.slice(0, limit);
  return (
    <section className={className} aria-label="What backs it">
      {heading && <h3 className="text-ui font-semibold text-ink">What backs it</h3>}
      {untested && (
        <p className={heading ? 'mt-0.5 text-small text-ink-muted' : 'text-small text-ink-muted'}>
          Counts towards its strength up to {CEILING_PERCENT}% until a question confirms it.
        </p>
      )}
      <ul className="mt-1.5 space-y-1.5">
        {shown.map((link) => {
          const Icon = KIND_ICON[link.sourceKind];
          return (
            <li key={link.id} className="flex items-start gap-2 text-ui text-ink">
              <Icon className="mt-0.5 size-4 shrink-0 text-ink-muted" strokeWidth={1.75} aria-hidden />
              <span className="min-w-0">
                <span className="block break-words">{basisSentence(link.basis)}</span>
                <span className="block text-small text-ink-muted">{markLine(link)}</span>
              </span>
            </li>
          );
        })}
      </ul>
    </section>
  );
}

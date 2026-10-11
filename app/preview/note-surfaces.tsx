import { FeedbackButton } from '@/components/shell/feedback-button';
import type { UploadedAttachment } from '@/lib/attachments/rules';

/**
 * The note button in the top bar, open, with a screenshot already added
 * (plan #1713). Drawn under a strip the height of the top bar, at its right
 * end where the shell puts it, so the panel hangs where it does in the app.
 */
const ADDED: UploadedAttachment[] = [
  {
    path: 'preview/plan-scrolls-sideways.png',
    name: 'plan-scrolls-sideways.png',
    contentType: 'image/png',
    size: 412_000,
  },
  {
    path: 'preview/Screen Recording 2026-10-09 at 14.02.11 showing the plan page.pdf',
    name: 'Screen Recording 2026-10-09 at 14.02.11 showing the plan page.pdf',
    contentType: 'application/pdf',
    size: 2_400_000,
  },
];

export function NoteButtonSurface() {
  return (
    <div className="min-h-[44rem]">
      <div className="flex h-(--bar-h) items-center justify-end px-3 sm:px-5">
        <FeedbackButton isOwner initialOpen initialFiles={ADDED} />
      </div>
    </div>
  );
}

/**
 * The same panel just after a note saved (plans #1674, #1675). Triage was
 * sure it needs planning, so it was filed as an idea: the filed line with
 * the flip back to notes, "Shape it now" under it, and Jev's triage below.
 */
export function NoteSavedSurface() {
  return (
    <div className="min-h-[44rem]">
      <div className="flex h-(--bar-h) items-center justify-end px-3 sm:px-5">
        <FeedbackButton
          isOwner
          initialOpen
          initialSaved={{
            filedAs: 'idea',
            triage: {
              parts: ['Request', 'Dev', 'Priority: Normal', 'Plan'],
              match: null,
              maybeMatch: {
                table: 'feedback_items',
                id: 'n1',
                line: 'The plan page scrolls sideways on my phone when a step title is long',
              },
            },
          }}
        />
      </div>
    </div>
  );
}

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

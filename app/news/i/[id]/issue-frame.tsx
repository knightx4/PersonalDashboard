import { issueDocument } from '@/lib/news/issues/frame';

/**
 * The room a newsletter is shown in.
 *
 * `sandbox` is the list of what is allowed, and everything left out is
 * refused: no form can be submitted, no link can move the page around the
 * frame, no window can be opened, and without `allow-same-origin` what runs
 * inside has no origin in common with the app and cannot read anything of
 * yours. `allow-scripts` is in the list because #459 settled that the frame
 * measures itself, which takes a few lines of the app's own script inside it.
 *
 * The height is a starting height. #464 is what replaces it with the height
 * the newsletter actually is.
 */
export function IssueFrame({ html }: { html: string }) {
  return (
    <iframe
      title="The newsletter"
      srcDoc={issueDocument(html)}
      sandbox="allow-scripts"
      referrerPolicy="no-referrer"
      className="block h-[70vh] w-full rounded-card border border-border bg-white"
    />
  );
}

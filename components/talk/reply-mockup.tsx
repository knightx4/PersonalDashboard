import { mockupDocument, turnMockups } from '@/lib/talk/mockup';
import type { TalkToolCall } from '@/lib/talk/talk';

/**
 * The mockups Dash drew in a thought-through answer (plan #2789.10), read
 * from the turn's kept tool calls (lib/talk/mockup.ts), each in a frame that
 * runs no scripts and loads nothing: `sandbox` with no permissions, and the
 * document's own content security policy. A sandboxed page cannot say how
 * tall it is, so the frame is drawn at the height the mockup gave, and
 * scrolls inside past it.
 */
export function ReplyMockups({ calls }: { calls: readonly TalkToolCall[] | undefined }) {
  const mockups = turnMockups(calls);
  if (mockups.length === 0) return null;
  return (
    <div className="mt-3 space-y-3">
      {mockups.map((mockup, i) => (
        <figure
          key={`${i}-${mockup.title}`}
          className="overflow-hidden rounded-card border border-border" /* ui-ok: the edge of another page drawn in a frame, as a picture's would be, not a group of content */
        >
          <figcaption className="border-b border-border px-3 py-1.5 text-small text-ink-muted">
            <span className="text-ink">{mockup.title}</span> · mockup
          </figcaption>
          <iframe
            title={`Mockup: ${mockup.title}`}
            sandbox=""
            referrerPolicy="no-referrer"
            srcDoc={mockupDocument(mockup)}
            className="block w-full"
            style={{ height: mockup.height }}
          />
        </figure>
      ))}
    </div>
  );
}

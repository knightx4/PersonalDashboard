import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import type { ThemeOffer } from '@/lib/learn/levels/theme-offer';

/**
 * The offer at the end of a practice run to make a lens of a vault theme
 * (plan #2138.14). Shown when levels were missed on topics tied to a theme
 * that no subject or goal lens covers. One press makes the lens, at the levels
 * missed; the other is remembered, so the theme is not offered again.
 *
 * The two actions are server actions the flow passes in. The gallery passes
 * none and draws the same buttons.
 */
export function ThemeLensOffer({
  offer,
  since,
  make,
  decline,
}: {
  offer: ThemeOffer;
  /** When the run began, so the actions can work the offer out again. */
  since?: string;
  make?: (formData: FormData) => void | Promise<void>;
  decline?: (formData: FormData) => void | Promise<void>;
}) {
  const hidden = (
    <>
      <input type="hidden" name="themeId" value={offer.themeId} />
      {since && <input type="hidden" name="since" value={since} />}
    </>
  );
  return (
    <Card padding="standard" className="mt-3">
      <p className="text-small text-ink-muted">From your notes</p>
      <p className="mt-1 text-body font-semibold text-ink">Make a lens of {offer.themeName}?</p>
      <p className="mt-1 text-ui text-ink-muted">
        You are learning this, and no subject or goal covers it. A lens would track these at the levels you
        missed.
      </p>
      <ul className="mt-2 space-y-1">
        {offer.topics.map((t) => (
          <li key={t.topicId} className="text-ui text-ink">
            {t.name}, to level {t.level}
          </li>
        ))}
      </ul>
      <div className="mt-3 flex flex-wrap items-center justify-end gap-2">
        <form action={decline}>
          {hidden}
          <Button type={decline ? 'submit' : 'button'} variant="ghost">
            No thanks
          </Button>
        </form>
        <form action={make}>
          {hidden}
          <Button type={make ? 'submit' : 'button'} variant="secondary">
            Make the lens
          </Button>
        </form>
      </div>
    </Card>
  );
}

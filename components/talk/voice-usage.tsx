import { CardSection } from '@/components/ui/card';
import { Meter } from '@/components/ui/meter';
import { cn } from '@/lib/cn';
import { whenDate } from '@/lib/core/when';
import { formatMicroDollars, formatNumber } from '@/lib/money';
import { speechResetDay, type SpeechUsage } from '@/lib/talk/speech/usage';

/** Dollars to the cent: "$0.00" for nothing, "under $0.01" for a sliver of a cent. */
function cents(micros: number): string {
  if (micros <= 0) return '$0.00';
  if (micros < 10_000) return 'under $0.01';
  return formatMicroDollars(micros, { fromCent: true });
}

/**
 * Spoken replies this month, against the cap that keeps voice under $5
 * (plan #3006.2).
 *
 * Drawn on the Spend page beside the TranscriptAPI credits, since both are a
 * monthly allowance counted in something other than tokens, and meant to sit
 * beside the speaking switch as well. The count is core.speech_usage, which
 * moves before each reply is sent, so it is what Fish has been asked to bill.
 *
 * The meter turns to the danger colour at nine tenths, as the credits meter
 * does: past it the month has a handful of replies left.
 */
export function VoiceUsage({ usage, className }: { usage: SpeechUsage | null; className?: string }) {
  if (!usage) {
    return (
      <CardSection title="Spoken replies" className={className}>
        <p className="text-small text-ink-muted">Could not read this month&rsquo;s voice count. Reload to try again.</p>
      </CardSection>
    );
  }
  const nearlyOut = usage.used >= usage.cap * 0.9;
  const resets = whenDate(speechResetDay(usage.month), { timeZone: 'UTC', year: 'never' });

  return (
    <CardSection
      title="Spoken replies"
      className={className}
      action={
        <span className="text-ui tabular-nums text-ink">
          {formatNumber(usage.used)} of {formatNumber(usage.cap)}
        </span>
      }
    >
      <Meter
        value={usage.used}
        max={usage.cap}
        label={`${usage.used} of ${usage.cap} characters spoken this month`}
        fill={nearlyOut ? 'bg-danger' : 'bg-accent'}
        height="md"
      />
      <p className={cn('mt-2 text-small tabular-nums', nearlyOut ? 'text-danger' : 'text-ink-muted')}>
        {usage.paused
          ? `Voice is paused until ${resets}`
          : `${formatNumber(usage.left)} characters left · resets ${resets}`}
      </p>
      <p className="mt-1 text-small tabular-nums text-ink-muted">
        About {cents(usage.costMicros)} of {formatMicroDollars(usage.capMicros)} this
        month · {usage.replies === 1 ? '1 reply' : `${formatNumber(usage.replies)} replies`} read aloud by Fish Audio
      </p>
    </CardSection>
  );
}

import { Button } from '@/components/ui/button';
import { FieldError } from '@/components/ui/field';

/**
 * A patch of fog: what is not known yet about a feature on the dev plan, or
 * about a goal (plan #960). Quiet and dashed, so it does not read as detail,
 * with Not now to put it aside and Bring back once it is.
 *
 * The form posts `id` and `dismissed` ('1' to put it aside, '0' to bring it
 * back), which is what dismissPlanFog and the goals' setFogAsideAction read.
 */
export function FogNote({
  id,
  fog,
  aside,
  action,
  pending,
  error,
}: {
  id: string;
  fog: string;
  /** Whether it has been put aside. */
  aside: boolean;
  action: (form: FormData) => void;
  pending: boolean;
  error?: string;
}) {
  return (
    <div className="border-l-2 border-dashed border-border-strong pl-2.5">
      <p className="text-micro font-semibold uppercase tracking-wide text-ink-ghost">
        Not yet specified
      </p>
      <p className="whitespace-pre-wrap text-small text-ink-muted">{fog}</p>
      <form action={action} className="mt-1">
        <input type="hidden" name="id" value={id} />
        <input type="hidden" name="dismissed" value={aside ? '0' : '1'} />
        <Button type="submit" size="sm" variant="ghost" pending={pending}>
          {aside ? 'Bring back' : 'Not now'}
        </Button>
      </form>
      <FieldError>{error}</FieldError>
    </div>
  );
}

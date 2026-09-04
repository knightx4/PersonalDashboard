import { cn } from '@/lib/cn';

/**
 * Form controls.
 *
 * The border is `border-control` rather than the container hairline: an
 * input's border is often the only thing identifying it as an input, which
 * makes it a user-interface component under WCAG 1.4.11 and owes 3:1. A
 * container's border does not -- the container is also identified by its fill
 * and its contents -- which is why there are two border tokens.
 *
 * `text-base sm:text-body` on every field is load-bearing: 16px is what stops
 * iOS zooming the page on focus, and anything smaller silently destroys the
 * layout on a phone.
 */
export function Label({ className, ...props }: React.LabelHTMLAttributes<HTMLLabelElement>) {
  return (
    <label
      className={cn('mb-1.5 block text-ui font-medium text-ink', className)}
      {...props}
    />
  );
}

const control =
  'w-full rounded-lg border border-control bg-surface text-base text-ink sm:text-ui ' +
  'placeholder:text-ink-ghost focus:border-accent focus:outline-none focus:ring-2 focus:ring-accent/25 ' +
  'disabled:cursor-not-allowed disabled:opacity-50';

export const Input = function Input({
  className,
  ref,
  ...props
}: React.ComponentProps<'input'>) {
  return <input ref={ref} className={cn(control, 'h-10 px-3', className)} {...props} />;
};

export function Select({
  className,
  children,
  ...props
}: React.SelectHTMLAttributes<HTMLSelectElement>) {
  return (
    <select className={cn(control, 'h-10 px-3', className)} {...props}>
      {children}
    </select>
  );
}

export function Textarea({
  className,
  ...props
}: React.TextareaHTMLAttributes<HTMLTextAreaElement>) {
  return <textarea className={cn(control, 'min-h-24 px-3 py-2', className)} {...props} />;
}

export function FieldError({ children }: { children?: React.ReactNode }) {
  if (!children) return null;
  return <p className="mt-1.5 text-ui text-danger">{children}</p>;
}

export function FieldHint({ children }: { children?: React.ReactNode }) {
  if (!children) return null;
  return <p className="mt-1 text-small text-ink-muted">{children}</p>;
}

/**
 * Label, control, hint and error in one place.
 *
 * Hints were being hand-rolled as `text-micro text-ink-muted` in dozens of
 * files -- both off the type scale and under the contrast floor -- so this
 * lands two fixes at once and stops the third from being written.
 */
export function Field({
  id,
  label,
  hint,
  error,
  children,
  className,
}: {
  id: string;
  label: React.ReactNode;
  hint?: React.ReactNode;
  error?: React.ReactNode;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <div className={className}>
      <Label htmlFor={id}>{label}</Label>
      {children}
      <FieldHint>{hint}</FieldHint>
      <FieldError>{error}</FieldError>
    </div>
  );
}

import { cloneElement, isValidElement } from 'react';
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
 * `text-base sm:text-ui` on every field is load-bearing: 16px is what stops
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

/**
 * `aria-invalid:` is the whole inline-validation story at the control level:
 * a field the Field below has marked wrong turns its border to the danger
 * colour without a second class on the call site.
 */
const control =
  // eslint-disable-next-line no-restricted-syntax -- text-base is the one deliberate off-scale size: 16px stops iOS zooming on focus.
  'w-full rounded-lg border border-control bg-surface text-base text-ink sm:text-ui ' +
  'placeholder:text-ink-ghost focus:border-accent focus:outline-none focus:ring-2 focus:ring-accent/25 ' +
  'aria-invalid:border-danger aria-invalid:focus:border-danger aria-invalid:focus:ring-danger/25 ' +
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

/**
 * `role="alert"`: an error that appears after a submit is exactly the thing a
 * screen reader should interrupt to say, and without this it is silent.
 */
export function FieldError({ children, id }: { children?: React.ReactNode; id?: string }) {
  if (!children) return null;
  return (
    <p id={id} role="alert" className="mt-1.5 text-ui text-danger">
      {children}
    </p>
  );
}

export function FieldHint({ children, id }: { children?: React.ReactNode; id?: string }) {
  if (!children) return null;
  return (
    <p id={id} className="mt-1 text-small text-ink-muted">
      {children}
    </p>
  );
}

/**
 * Label, control, hint and error in one place.
 *
 * Hints were being hand-rolled as `text-micro text-ink-muted` in dozens of
 * files -- both off the type scale and under the contrast floor -- so this
 * lands two fixes at once and stops the third from being written.
 *
 * When the child is a single control it is also wired up: `aria-invalid` when
 * there is an error, and `aria-describedby` pointing at the hint and the
 * error, so what a sighted person reads under the field is what a screen
 * reader hears after it. Cloning rather than a context, because this renders
 * on the server and so do most of the forms that use it.
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
  const hintId = hint ? `${id}-hint` : undefined;
  const errorId = error ? `${id}-error` : undefined;
  const describedBy = [hintId, errorId].filter(Boolean).join(' ') || undefined;

  const control = isValidElement<Record<string, unknown>>(children)
    ? cloneElement(children, {
        'aria-invalid': error ? true : children.props['aria-invalid'],
        'aria-describedby':
          [children.props['aria-describedby'], describedBy].filter(Boolean).join(' ') ||
          undefined,
      })
    : children;

  return (
    <div className={className}>
      <Label htmlFor={id}>{label}</Label>
      {control}
      <FieldHint id={hintId}>{hint}</FieldHint>
      <FieldError id={errorId}>{error}</FieldError>
    </div>
  );
}

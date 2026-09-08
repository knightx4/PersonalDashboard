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
 *
 * Height, inset and radius come from the density dial rather than from a
 * class, so a form's controls cannot disagree with each other and cannot
 * disagree with the buttons beside them. See the Density block in
 * app/globals.css for why the default came down.
 */

/**
 * The label is deliberately quieter than the thing it names.
 *
 * It was `text-ui font-medium text-ink` -- the same weight and the same ink as
 * the value below it, on its own line, above every field. Six fields meant six
 * lines of black text competing with six lines of black text, and the form
 * read as a wall before it read as a form. A label is a caption: it should be
 * legible when looked for and quiet when not.
 */
export function Label({ className, ...props }: React.LabelHTMLAttributes<HTMLLabelElement>) {
  return (
    <label
      className={cn('mb-1 block text-small font-medium text-ink-muted', className)}
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
  'w-full rounded-control border border-control bg-surface text-base text-ink sm:text-ui ' +
  // ring-1, not ring-2. Focus was a 2px halo *plus* a border colour change,
  // which on a 32px control is a visible thickening of the whole box; at 1px
  // the border does the identifying and the ring only confirms it.
  'placeholder:text-ink-ghost focus:border-accent focus:outline-none focus:ring-1 focus:ring-accent/40 ' +
  'aria-invalid:border-danger aria-invalid:focus:border-danger aria-invalid:focus:ring-danger/40 ' +
  'disabled:cursor-not-allowed disabled:opacity-50';

/** Height and inset from the dial, so an input, a select and a button agree. */
const controlBox = 'h-(--control-h) px-(--control-px)';

export const Input = function Input({
  className,
  ref,
  ...props
}: React.ComponentProps<'input'>) {
  return <input ref={ref} className={cn(control, controlBox, className)} {...props} />;
};

/**
 * A control that reads as text until you touch it.
 *
 * Law 12: a value and its editor are the same object in the same place at the
 * same size. The alternative this replaces is the pattern the app reached for
 * everywhere -- click a row, a panel opens above it carrying a label, a
 * bordered field and a Save button, all to change one number -- and the reason
 * it kept being reached for is that there was no other way to spell it.
 *
 * At rest: no border, no fill, sized and set exactly like the text it stands
 * in for, so a page of these looks like a page of values rather than a page of
 * inputs. On hover it picks up a ground, on focus the full control border, so
 * it is discoverable by pointing at it and unmistakable once entered.
 *
 * It is still an `<input>` all the way down, so the caret, selection,
 * keyboard, autofill and the accessibility tree are the real ones. Give it an
 * `aria-label` -- there is no visible label by construction, which is the
 * point of it and also the one way it can go wrong.
 */
export function InlineInput({
  className,
  ref,
  ...props
}: React.ComponentProps<'input'>) {
  return (
    <input
      ref={ref}
      className={cn(
        // eslint-disable-next-line no-restricted-syntax -- text-base is the one deliberate off-scale size: 16px stops iOS zooming on focus.
        'w-full rounded-control border border-transparent bg-transparent px-1 py-0.5 text-base text-ink sm:text-ui',
        'hover:border-border hover:bg-sunken',
        'focus:border-accent focus:bg-surface focus:outline-none focus:ring-1 focus:ring-accent/40',
        'placeholder:text-ink-ghost aria-invalid:border-danger',
        'disabled:cursor-not-allowed disabled:opacity-50',
        className,
      )}
      {...props}
    />
  );
}

export function Select({
  className,
  children,
  ...props
}: React.SelectHTMLAttributes<HTMLSelectElement>) {
  return (
    <select className={cn(control, controlBox, className)} {...props}>
      {children}
    </select>
  );
}

/**
 * Grows with what is typed into it.
 *
 * `field-sizing: content` is the whole mechanism -- no ref, no resize
 * observer, no client component, which matters because most of the forms
 * using this render on the server. Where it is unsupported the browser falls
 * back to `rows` and the min-height, which is the old behaviour, so nothing
 * breaks; where it is supported a box for a one-line note starts one line
 * tall instead of ninety-six pixels tall and grows as it is filled.
 *
 * The max-height is not optional: without it a long note pushes its own
 * submit button off the bottom of the screen.
 */
export function Textarea({
  className,
  ...props
}: React.TextareaHTMLAttributes<HTMLTextAreaElement>) {
  return (
    <textarea
      className={cn(control, 'field-sizing-content max-h-64 min-h-16 px-(--control-px) py-1.5', className)}
      {...props}
    />
  );
}

/**
 * `role="alert"`: an error that appears after a submit is exactly the thing a
 * screen reader should interrupt to say, and without this it is silent.
 */
export function FieldError({ children, id }: { children?: React.ReactNode; id?: string }) {
  if (!children) return null;
  return (
    <p id={id} role="alert" className="mt-1 text-small text-danger">
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

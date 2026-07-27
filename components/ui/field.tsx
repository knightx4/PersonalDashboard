import { cn } from '@/lib/cn';

export function Label({
  className,
  ...props
}: React.LabelHTMLAttributes<HTMLLabelElement>) {
  return (
    <label
      className={cn('mb-1.5 block text-[13px] font-medium text-ink', className)}
      {...props}
    />
  );
}

export function Input({
  className,
  ...props
}: React.InputHTMLAttributes<HTMLInputElement>) {
  return (
    <input
      className={cn(
        'h-10 w-full rounded-lg border border-border bg-surface px-3 text-sm text-ink',
        'placeholder:text-ink-faint focus:border-brand focus:outline-none focus:ring-2 focus:ring-brand/20',
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
    <select
      className={cn(
        'h-10 w-full rounded-lg border border-border bg-surface px-3 text-sm text-ink',
        'focus:border-brand focus:outline-none focus:ring-2 focus:ring-brand/20',
        'disabled:cursor-not-allowed disabled:opacity-50',
        className,
      )}
      {...props}
    >
      {children}
    </select>
  );
}

export function Textarea({
  className,
  ...props
}: React.TextareaHTMLAttributes<HTMLTextAreaElement>) {
  return (
    <textarea
      className={cn(
        'min-h-24 w-full rounded-lg border border-border bg-surface px-3 py-2 text-sm text-ink',
        'placeholder:text-ink-faint focus:border-brand focus:outline-none focus:ring-2 focus:ring-brand/20',
        'disabled:cursor-not-allowed disabled:opacity-50',
        className,
      )}
      {...props}
    />
  );
}

export function FieldError({ children }: { children?: React.ReactNode }) {
  if (!children) return null;
  return <p className="mt-1.5 text-[13px] text-red-600">{children}</p>;
}

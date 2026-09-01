import Link from 'next/link';

export default function AuthLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex min-h-dvh flex-col items-center justify-center px-4 py-12">
      <Link href="/" className="mb-8 flex items-center gap-2">
        <span
          className="size-7 rounded-md"
          style={{
            backgroundImage:
              'linear-gradient(135deg, var(--color-brand) 0%, var(--color-accent-pink) 100%)',
          }}
          aria-hidden
        />
        <span className="font-display text-base font-semibold tracking-tight text-ink">
          Personal Dashboard
        </span>
      </Link>

      <div className="w-full max-w-sm rounded-card border border-border bg-surface p-6">
        {children}
      </div>

      <p className="mt-6 text-xs text-ink-faint">
        <Link href="/privacy" className="hover:text-ink-muted">
          Privacy
        </Link>
        {' · '}
        <Link href="/terms" className="hover:text-ink-muted">
          Terms
        </Link>
      </p>
    </div>
  );
}

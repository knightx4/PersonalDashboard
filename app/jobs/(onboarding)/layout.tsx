import Link from 'next/link';

export default function OnboardingLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-dvh">
      <header className="mx-auto flex h-16 max-w-[1100px] items-center px-6">
        <Link href="/jobs/pipeline" className="flex items-center gap-2">
          <span
            className="size-6 rounded-md"
            style={{
              backgroundImage:
                'linear-gradient(135deg, var(--color-accent) 0%, var(--color-status-final) 100%)',
            }}
            aria-hidden
          />
          <span className="text-lead font-semibold tracking-tight text-ink">
            Job search
          </span>
        </Link>
      </header>
      <main className="mx-auto max-w-[1100px] px-6 py-8">{children}</main>
    </div>
  );
}

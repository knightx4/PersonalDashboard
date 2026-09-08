import Link from 'next/link';
import { ModuleMark } from '@/components/ui/module-mark';

export default function OnboardingLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-dvh">
      <header className="mx-auto flex h-16 max-w-5xl items-center px-6">
        <Link href="/jobs/pipeline" className="flex items-center gap-2">
          {/* The shell's own mark, not a gradient tile of its own: the mark is
              the one thing that says "same app" before the shell exists. */}
          <ModuleMark module="jobs" size="sm" />
          <span className="text-lead font-semibold tracking-tight text-ink">
            Job search
          </span>
        </Link>
      </header>
      <main className="mx-auto max-w-5xl px-6 py-8">{children}</main>
    </div>
  );
}

import Link from 'next/link';
import { ModuleMark } from '@/components/ui/module-mark';

export default function LegalLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-dvh">
      <header className="border-b border-border">
        <div className="mx-auto flex h-14 max-w-[760px] items-center px-6">
          <Link href="/" className="flex items-center gap-2">
            <ModuleMark module={null} size="sm" />
            <span className="text-body font-semibold tracking-tight">
              Personal Dashboard
            </span>
          </Link>
        </div>
      </header>

      <main
        className="mx-auto max-w-[760px] px-6 py-12
          [&_h1]:font-display [&_h1]:text-2xl [&_h1]:font-normal [&_h1]:tracking-tight
          [&_h2]:mt-9 [&_h2]:mb-2 [&_h2]:text-base [&_h2]:font-semibold [&_h2]:text-ink
          [&_li]:mb-1.5 [&_li]:text-body [&_li]:leading-relaxed [&_li]:text-ink-muted
          [&_p]:mb-3 [&_p]:text-body [&_p]:leading-relaxed [&_p]:text-ink-muted
          [&_ul]:mb-3 [&_ul]:list-disc [&_ul]:pl-5"
      >
        {children}
      </main>
    </div>
  );
}

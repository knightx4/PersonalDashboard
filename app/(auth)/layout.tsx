import Link from 'next/link';
import { ModuleMark } from '@/components/ui/module-mark';
import { cardVariants } from '@/components/ui/card';
import { cn } from '@/lib/cn';

export default function AuthLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex min-h-dvh flex-col items-center justify-center px-4 py-12">
      <Link href="/" className="mb-8 flex items-center gap-2">
        <ModuleMark module={null} size="md" />
        <span className="text-body font-semibold tracking-tight text-ink">
          Personal Dashboard
        </span>
      </Link>

      <div className={cn(cardVariants({ padding: 'standard' }), 'w-full max-w-sm')}>
        {children}
      </div>

      <p className="mt-6 text-small text-ink-muted">
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

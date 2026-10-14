import { GalleryHorizontalEnd } from 'lucide-react';
import Link from '@/components/ui/link';
import { buttonVariants } from '@/components/ui/button';
import { cn } from '@/lib/cn';

/**
 * Quick read, on a brief's page (plan #2023.6): opens the deck of the cards
 * written from the brief's sources, at /learn/b/<id>/quick. The deck says so
 * itself when the brief has no cards yet, so the button is always there.
 */
export function QuickReadButton({ briefId, className }: { briefId: string; className?: string }) {
  return (
    <Link
      href={`/learn/b/${briefId}/quick`}
      className={cn(buttonVariants({ variant: 'secondary', size: 'md' }), 'gap-1.5', className)}
    >
      <GalleryHorizontalEnd className="size-4" strokeWidth={1.75} aria-hidden />
      Quick read
    </Link>
  );
}

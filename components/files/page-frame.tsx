import { ExternalLink } from 'lucide-react';
import { Card } from '@/components/ui/card';
import { linkVariants } from '@/components/ui/link';
import { cn } from '@/lib/cn';

/**
 * A page a bot had made (plan #2997), framed on its file's page. The page is
 * its own document, served sandboxed from `src` (PAGE_VIEW_HEADERS in
 * lib/files/files.ts); the frame adds its own sandbox on top, without
 * same-origin, so the page's scripts run but cannot reach the app. Under it,
 * a link opens the page full screen, which reads better on a phone.
 *
 * `srcDoc` is for the gallery, which has no file to serve.
 */
export function PageFrame({ title, src, srcDoc }: { title: string; src?: string; srcDoc?: string }) {
  const open = src ?? null;
  return (
    <div className="space-y-2">
      <Card className="overflow-hidden">
        <iframe
          title={title}
          {...(srcDoc !== undefined ? { srcDoc } : { src })}
          sandbox="allow-scripts allow-forms allow-modals"
          referrerPolicy="no-referrer"
          // A sandboxed page cannot be measured from here, so the frame fills the screen under the header instead.
          className="block h-[calc(100dvh-13rem)] min-h-[28rem] w-full bg-white"
        />
      </Card>
      {open && (
        <p className="px-1">
          <a href={open} target="_blank" rel="noreferrer" className={cn('press-area inline-flex items-center gap-1.5 text-ui', linkVariants())}>
            <ExternalLink className="size-4" strokeWidth={1.75} aria-hidden />
            Open full screen
          </a>
        </p>
      )}
    </div>
  );
}

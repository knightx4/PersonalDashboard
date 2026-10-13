import { cn } from '@/lib/cn';

/**
 * A shortcut, shown only while a modifier is held. Hidden from the
 * accessibility tree: the control it sits on already has a name, and the
 * shortcut is announced nowhere else either, which is the honest state of it.
 */
/**
 * `text-micro`, which is the bottom of the scale, and not the 10px this was
 * written at. A tenth size in a mono face is a size nobody chose -- it was one
 * step below the floor because a keycap felt like it wanted to be small -- and
 * the cap is 18px tall with `leading-none`, so the extra pixel changes nothing
 * about the box and only makes ⌥ and ⌘ legible at the size they are actually
 * read at.
 */
export function Kbd({
  children,
  className,
  always = false,
  announce = false,
}: {
  children: React.ReactNode;
  className?: string;
  /** Show regardless of the modifier -- inside a menu that is already open. */
  always?: boolean;
  /**
   * Read the key out. Off by default, because a shortcut hint sits on a
   * control that already has a name; on for a key named in running text
   * ("j/k to move"), where hiding it would leave the sentence with a hole.
   */
  announce?: boolean;
}) {
  return (
    <kbd
      aria-hidden={announce ? undefined : true}
      className={cn(
        !always && 'keyhint',
        'inline-flex h-4.5 min-w-4.5 items-center justify-center keycap border border-border-strong border-b-2 px-1 font-mono text-micro leading-none text-ink-muted',
        className,
      )}
    >
      {children}
    </kbd>
  );
}
